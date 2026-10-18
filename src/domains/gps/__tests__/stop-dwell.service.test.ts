import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  trackStopDwell,
  getActiveDwellState,
  clearStopDwellState,
  flushStopDwellOnTripEnd,
  processWaitingFlagsOnGpsTick,
} from '../services/stop-dwell.service';
import { enrichRouteStops } from '@/domains/route/data/canonical-route-geometries';
import { projectPointToRouteCorridor } from '@/domains/route/services/route-alignment-engine';
import {
  setRedisActiveFlag,
  getRedisActiveFlags,
  clearRedisActiveFlags,
  isRedisFlagsHydrated,
  clearRedisFlagsHydrated,
} from '../services/gps-redis-guard';

// Mock Supabase
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});
const mockSelectIn = vi.fn().mockResolvedValue({ data: [], error: null });
const mockSelectEq = vi.fn().mockReturnValue({
  in: mockSelectIn,
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
});
const mockSelect = vi.fn().mockReturnValue({
  eq: mockSelectEq,
});
const mockFrom = vi.fn().mockReturnValue({
  insert: mockInsert,
  update: mockUpdate,
  select: mockSelect,
});

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    from: mockFrom,
  }),
}));

// Mock realtime event emitter
const mockEmitEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@/domains/realtime/event-emitter', () => ({
  emitEvent: (...args: any[]) => mockEmitEvent(...args),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Stop Dwell Audit Service & Hands-Free Waiting Flag Engine', () => {
  const busId = 'bus_test_101';
  const tripId = 'trip_test_001';
  const driverId = 'driver_test_001';
  const routeId = 'route_1';

  // Verified Boragaon coordinates on route_1: lat: 26.1128, lng: 91.6876
  const boragaonLat = 26.1128;
  const boragaonLng = 91.6876;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectIn.mockResolvedValue({ data: [], error: null });
    clearStopDwellState(busId);
    clearRedisActiveFlags(busId);
    clearRedisFlagsHydrated(busId);
  });

  it('starts dwell tracking when bus enters within 80m of a canonical stop', async () => {
    const startTime = new Date('2026-10-17T10:00:00.000Z');

    // Exactly at Boragaon
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat,
      lng: boragaonLng,
      speed: 0,
      timestamp: startTime,
    });

    const active = getActiveDwellState(busId);
    expect(active).toBeDefined();
    expect(active?.stopName).toBe('Boragaon');
    expect(active?.dwellSeconds).toBe(0);
    expect(active?.arrivedAt).toBe(startTime.toISOString());
    expect(active?.isRoadside).toBe(false);
  });

  it('accumulates dwell seconds while stationary (<5 km/h) inside 80m of named stop', async () => {
    const t0 = new Date('2026-10-17T10:00:00.000Z');
    const t1 = new Date('2026-10-17T10:00:15.000Z'); // 15s later

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat,
      lng: boragaonLng,
      speed: 0,
      timestamp: t0,
    });

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat + 0.0001, // ~11 meters away (well within 80m)
      lng: boragaonLng,
      speed: 2.5, // Stationary threshold is < 5 km/h
      timestamp: t1,
    });

    const active = getActiveDwellState(busId);
    expect(active).toBeDefined();
    expect(active?.dwellSeconds).toBe(15);
  });

  it('records roadside halt along corridor between named stops when stationary >= 15s', async () => {
    // Coordinate on Route 1 between Boragaon and Garchuk (lat: 26.1125, lng: 91.6987)
    // ~1.1 km from Boragaon, ~1.1 km from Garchuk (way outside 80m of both), exactly on road polyline
    const corridorLat = 26.1125;
    const corridorLng = 91.6987;

    const t0 = new Date('2026-10-17T10:00:00.000Z');
    const t1 = new Date('2026-10-17T10:00:20.000Z'); // 20s dwell
    const t2 = new Date('2026-10-17T10:00:50.000Z'); // Departure

    // 1. Bus halts along corridor
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: corridorLat,
      lng: corridorLng,
      speed: 0,
      timestamp: t0,
    });

    const active = getActiveDwellState(busId);
    expect(active).toBeDefined();
    expect(active?.isRoadside).toBe(true);
    expect(active?.stopName).toContain('Roadside Halt');

    // 2. Accumulate dwell time
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: corridorLat,
      lng: corridorLng,
      speed: 1.0,
      timestamp: t1,
    });
    expect(active?.dwellSeconds).toBe(20);

    // 3. Bus resumes driving and exits > 100m
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: corridorLat + 0.005, // ~550m away
      lng: corridorLng,
      speed: 30.0,
      timestamp: t2,
    });

    // Verify insert into stop_dwell_logs with roadside label
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        trip_id: tripId,
        bus_id: busId,
        dwell_seconds: 20,
        stop_name: expect.stringContaining('Roadside Halt'),
      })
    );
  });

  it('discards brief roadside traffic pauses (< 15s) without inserting into stop_dwell_logs', async () => {
    const corridorLat = 26.1125;
    const corridorLng = 91.6987;

    const t0 = new Date('2026-10-17T10:00:00.000Z');
    const t1 = new Date('2026-10-17T10:00:08.000Z'); // 8s pause only
    const t2 = new Date('2026-10-17T10:00:20.000Z'); // Accelerated away

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: corridorLat,
      lng: corridorLng,
      speed: 0,
      timestamp: t0,
    });

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: corridorLat,
      lng: corridorLng,
      speed: 0,
      timestamp: t1,
    });

    // Exits > 100m
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: corridorLat + 0.005,
      lng: corridorLng,
      speed: 30.0,
      timestamp: t2,
    });

    // Sub-15s roadside tap must NOT produce a stop_dwell_logs insert
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('concludes dwell and persists to public.stop_dwell_logs when bus exits >100m from named stop', async () => {
    const t0 = new Date('2026-10-17T10:00:00.000Z');
    const t1 = new Date('2026-10-17T10:00:30.000Z'); // 30s dwell
    const t2 = new Date('2026-10-17T10:01:00.000Z'); // Departure

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat,
      lng: boragaonLng,
      speed: 0,
      timestamp: t0,
    });

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat,
      lng: boragaonLng,
      speed: 0,
      timestamp: t1,
    });

    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat + 0.005,
      lng: boragaonLng,
      speed: 35.0,
      timestamp: t2,
    });

    expect(getActiveDwellState(busId)).toBeUndefined();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        trip_id: tripId,
        bus_id: busId,
        driver_id: driverId,
        stop_name: 'Boragaon',
        dwell_seconds: 30,
        arrived_at: t0.toISOString(),
        departed_at: t2.toISOString(),
      })
    );
  });

  it('hands-free waiting flags: auto-acknowledges when bus is <= 600m upstream', async () => {
    const busLat = 26.1124;
    const busLng = 91.7010;
    const busCorridor = projectPointToRouteCorridor({ lat: busLat, lng: busLng }, 'route_1');

    // Add active waiting flag to Redis 300m upstream of bus
    await setRedisActiveFlag(busId, {
      flagId: 'flag_hf_1',
      studentUid: 'student_hf_1',
      studentName: 'Test Commuter',
      stopName: 'Roadside Halt',
      lat: 26.1123,
      lng: 91.7050,
      routeProgressMeters: busCorridor.routeProgressMeters + 300,
      ackSent: false,
      busId,
      routeId: 'route_1',
      tripId,
      createdAt: Date.now(),
    });

    // Bus is at busLat, busLng (300m upstream, within 600m auto-ack window)
    await processWaitingFlagsOnGpsTick({
      busId,
      routeId: 'route_1',
      lat: busLat,
      lng: busLng,
    });

    // Check that waiting_flag_acknowledged was broadcasted without any DB write
    expect(mockEmitEvent).toHaveBeenCalledWith(
      `waiting_flags_${busId}`,
      'waiting_flag_acknowledged',
      expect.objectContaining({
        flagId: 'flag_hf_1',
        autoAck: true,
      })
    );

    const flags = await getRedisActiveFlags(busId);
    expect(flags['flag_hf_1']?.ackSent).toBe(true);
  });

  it('hands-free waiting flags: auto-cleans flag when bus advances > 200m past flag', async () => {
    // Flag at progress 1000m
    await setRedisActiveFlag(busId, {
      flagId: 'flag_hf_pass',
      studentUid: 'student_hf_pass',
      studentName: 'Test Commuter',
      stopName: 'Roadside Halt',
      lat: 26.1125,
      lng: 91.6970,
      routeProgressMeters: 1000,
      ackSent: true,
      busId,
      routeId: 'route_1',
      tripId,
      createdAt: Date.now(),
    });

    // Bus advances to Garchuk (progress ~2.2 km, which is > 1000m + 200m)
    await processWaitingFlagsOnGpsTick({
      busId,
      routeId: 'route_1',
      lat: 26.1122,
      lng: 91.7098, // Garchuk
    });

    // Flag removed from Redis
    const flags = await getRedisActiveFlags(busId);
    expect(flags['flag_hf_pass']).toBeUndefined();

    // Broadcasts removal to driver & student
    expect(mockEmitEvent).toHaveBeenCalledWith(
      `waiting_flags_${busId}`,
      'waiting_flag_removed',
      expect.objectContaining({
        flagId: 'flag_hf_pass',
        reason: 'bus_passed',
      })
    );

    // Single async DB cleanup fired
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'expired',
      })
    );
  });

  it('enriches non-empty DB stops missing lat/lng from canonical geometry dictionary', () => {
    const rawDbStops = [
      { name: 'Boragaon', stopId: 'stop_bora', sequence: 1 },
      { name: 'Garchuk', stopId: 'stop_gar', sequence: 2 },
      { name: 'Beltola Tiniali', stopId: 'stop_bel', sequence: 6 },
    ];

    const enriched = enrichRouteStops('route_1', rawDbStops);

    expect(enriched).toHaveLength(3);
    expect(enriched[0].lat).toBe(26.1128);
    expect(enriched[0].lng).toBe(91.6876);
    expect(enriched[1].lat).toBe(26.1122);
    expect(enriched[1].lng).toBe(91.7098);
    expect(enriched[2].lat).toBe(26.1241);
    expect(enriched[2].lng).toBe(91.7994);
  });

  it('directional progress: auto-acknowledges and cleans up waiting flags in Evening (return) direction', async () => {
    // In Evening shift, travel is from AdtU Campus back toward City along Route 1.
    // Progress meters on the canonical polyline decrease from Campus (high progress) to City (low progress).
    // Bus is at Garchuk (~2200m) traveling toward Boragaon (~0m).
    const busLat = 26.1122; // Garchuk
    const busLng = 91.7098;
    const busCorridor = projectPointToRouteCorridor({ lat: busLat, lng: busLng }, 'route_1');

    await setRedisActiveFlag(busId, {
      flagId: 'flag_eve_1',
      studentUid: 'student_eve_1',
      studentName: 'Evening Commuter',
      stopName: 'Roadside Halt',
      lat: 26.1124,
      lng: 91.7010,
      routeProgressMeters: busCorridor.routeProgressMeters - 300, // 300m downstream in canonical polyline = ahead in Evening travel
      ackSent: false,
      busId,
      routeId: 'route_1',
      tripId,
      shift: 'Evening',
      createdAt: Date.now(),
    });

    // 1. Bus at Garchuk in Evening shift processes flags:
    await processWaitingFlagsOnGpsTick({
      busId,
      routeId: 'route_1',
      lat: busLat,
      lng: busLng,
      shift: 'Evening',
    });

    // Student is 300m ahead of the reverse-heading bus -> within 600m auto-ack window:
    expect(mockEmitEvent).toHaveBeenCalledWith(
      `waiting_flags_${busId}`,
      'waiting_flag_acknowledged',
      expect.objectContaining({
        flagId: 'flag_eve_1',
        autoAck: true,
      })
    );

    // 2. Bus advances further toward City (past student by > 200m, e.g. to Boragaon ~0m progress):
    await processWaitingFlagsOnGpsTick({
      busId,
      routeId: 'route_1',
      lat: boragaonLat,
      lng: boragaonLng,
      shift: 'Evening',
    });

    // Bus has passed student in Evening direction -> auto-cleanup
    const flags = await getRedisActiveFlags(busId);
    expect(flags['flag_eve_1']).toBeUndefined();

    expect(mockEmitEvent).toHaveBeenCalledWith(
      `waiting_flags_${busId}`,
      'waiting_flag_removed',
      expect.objectContaining({
        flagId: 'flag_eve_1',
        reason: 'bus_passed',
      })
    );
  });

  it('lazy self-healing Redis hydration: repopulates Redis from Supabase on cold restart and preserves 0 DB reads afterwards', async () => {
    // 1. Ensure Redis is cold for this bus
    clearRedisFlagsHydrated(busId);
    clearRedisActiveFlags(busId);
    expect(await isRedisFlagsHydrated(busId)).toBe(false);

    // 2. Mock Supabase returning 1 active waiting flag from DB
    mockSelectIn.mockResolvedValueOnce({
      data: [
        {
          id: 'flag_db_hydrated',
          student_uid: 'student_db_1',
          student_id: 'student_db_1',
          bus_id: busId,
          route_id: 'route_1',
          trip_id: tripId,
          status: 'waiting',
          route_progress_meters: 500,
          created_at: new Date().toISOString(),
          shift: 'Morning',
        },
      ],
      error: null,
    });

    // 3. First GPS tick: cold hydration should query Supabase once and populate Redis
    await processWaitingFlagsOnGpsTick({
      busId,
      routeId: 'route_1',
      lat: boragaonLat,
      lng: boragaonLng,
      shift: 'Morning',
    });

    expect(mockSelectIn).toHaveBeenCalledTimes(1);
    expect(await isRedisFlagsHydrated(busId)).toBe(true);

    const hydratedFlags = await getRedisActiveFlags(busId);
    expect(hydratedFlags['flag_db_hydrated']).toBeDefined();
    expect(hydratedFlags['flag_db_hydrated'].studentUid).toBe('student_db_1');

    // 4. Second GPS tick: warm hydration sentinel prevents any DB query (0 hot-path DB reads)
    mockSelectIn.mockClear();
    await processWaitingFlagsOnGpsTick({
      busId,
      routeId: 'route_1',
      lat: boragaonLat,
      lng: boragaonLng,
      shift: 'Morning',
    });

    expect(mockSelectIn).not.toHaveBeenCalled();
  });

  it('stationary dwell resilience: multipath GPS speed jitter does not truncate continuous zone residency dwell duration', async () => {
    const t0 = new Date('2026-10-17T10:00:00.000Z');
    const t1 = new Date('2026-10-17T10:00:10.000Z'); // 10s later
    const t2 = new Date('2026-10-17T10:00:25.000Z'); // 25s later
    const t3 = new Date('2026-10-17T10:00:40.000Z'); // 40s later (departure)

    // Tick 0: Bus enters Boragaon stop (speed 0)
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat,
      lng: boragaonLng,
      speed: 0,
      timestamp: t0,
    });

    // Tick 1: Bus remains stationary at stop (11m away <= 80m), but GPS multipath noise causes 8.5 km/h instantaneous speed spike!
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat + 0.0001,
      lng: boragaonLng,
      speed: 8.5, // Jitter > 5 km/h threshold
      timestamp: t1,
    });

    // Tick 2: Bus still stationary at stop, another speed jitter spike (6.2 km/h)
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat + 0.00015,
      lng: boragaonLng,
      speed: 6.2, // Jitter > 5 km/h threshold
      timestamp: t2,
    });

    // Tick 3: Bus actually accelerates and exits stop (>100m away, speed 35 km/h)
    await trackStopDwell({
      busId,
      tripId,
      driverId,
      routeId,
      lat: boragaonLat + 0.005,
      lng: boragaonLng,
      speed: 35.0,
      timestamp: t3,
    });

    // Verify dwell record saved in DB with full residency duration (25s from t0 to t2)
    // rather than 0s (which would happen if jitter cancelled low-speed accumulation)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        trip_id: tripId,
        bus_id: busId,
        stop_name: 'Boragaon',
        dwell_seconds: 25,
      })
    );
  });
});

