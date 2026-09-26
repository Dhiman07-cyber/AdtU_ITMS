/**
 * GPS Reliability Failure Tests — Phase 04
 *
 * Actively injects GPS failure modes and asserts deterministic rejection.
 * Does not mock success — every test verifies a real failure path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock persistence layer — tests focus on pipeline validation logic only
vi.mock('@/domains/gps/services/gps-persistence.service', () => ({
  checkActiveTrip: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/security/location-validation-service', () => {
  function LocationValidationService() {}
  LocationValidationService.prototype.validateLocation = () => ({ valid: true, reasons: [] });
  LocationValidationService.prototype.clearHistory = () => {};
  return { LocationValidationService };
});

import { processLocationUpdate, clearInMemoryLastLocation, setInMemoryLastLocation } from '../services/gps-pipeline.service';

const base = {
  driverId: 'driver-1',
  busId: 'bus-1',
  tripId: 'trip-1',
  routeId: 'route-1',
  lat: 12.9716,
  lng: 77.5946,
  timestamp: new Date().toISOString(),
};

describe('GPS Reliability — Coordinate Validation', () => {
  beforeEach(() => {
    clearInMemoryLastLocation('bus-1');
  });

  it('rejects null island coordinates (0,0) — GPS fix not acquired', async () => {
    const result = await processLocationUpdate({ ...base, lat: 0, lng: 0 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/null island/i);
  });

  it('rejects NaN latitude', async () => {
    const result = await processLocationUpdate({ ...base, lat: NaN, lng: 77.5946 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/latitude and longitude/i);
  });

  it('rejects coordinates out of global range', async () => {
    const result = await processLocationUpdate({ ...base, lat: 95, lng: 77.5946 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/out of range/i);
  });

  it('rejects speed exceeding 200 km/h', async () => {
    const result = await processLocationUpdate({ ...base, speed: 250 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/speed/i);
  });

  it('accepts valid coordinates with no prior location', async () => {
    clearInMemoryLastLocation('bus-1');
    const result = await processLocationUpdate(base);
    expect(result.accepted).toBe(true);
  });
});

describe('GPS Reliability — Timestamp Ordering', () => {
  const lastLocation = {
    lat: '12.9716',
    lng: '77.5946',
    timestamp: new Date(Date.now() - 5000).toISOString(), // 5s ago
  };

  beforeEach(() => {
    setInMemoryLastLocation('bus-1', lastLocation as any);
  });

  it('rejects out-of-order GPS packet (timestamp older than last accepted)', async () => {
    const staleTime = new Date(Date.now() - 10000).toISOString(); // 10s ago — older than last
    const result = await processLocationUpdate({ ...base, timestamp: staleTime });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/out-of-order/i);
  });

  it('rejects duplicate timestamp with significant coordinate jump', async () => {
    const sameTime = lastLocation.timestamp; // exact same timestamp
    const result = await processLocationUpdate({
      ...base,
      lat: 12.9725,
      lng: 77.5946,
      timestamp: sameTime,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/duplicate timestamp/i);
  });

  it('accepts duplicate timestamp with same coordinates (idempotent packet)', async () => {
    const result = await processLocationUpdate({
      ...base,
      lat: 12.9716,
      lng: 77.5946,
      timestamp: lastLocation.timestamp,
    });
    expect(result.accepted).toBe(true);
  });

  it('rejects location jump > 5000m', async () => {
    const result = await processLocationUpdate({
      ...base,
      lat: 13.1716, // ~22km north
      lng: 77.5946,
      timestamp: new Date().toISOString(),
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/jump too large/i);
  });
});

describe('GPS Reliability — Replay Resistance (raw client clock)', () => {
  beforeEach(() => {
    clearInMemoryLastLocation('bus-1');
  });

  it('rejects a replayed stale packet that normalization would clamp to ~now', async () => {
    const first = await processLocationUpdate({ ...base, timestamp: new Date().toISOString() });
    expect(first.accepted).toBe(true);

    // Replayed packet from 1h ago, same position: the skew clamp rewrites its
    // timestamp to ~now, so only the raw-clock guard can catch it.
    const replay = await processLocationUpdate({
      ...base,
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(replay.accepted).toBe(false);
    expect(replay.reason).toMatch(/out-of-order/i);
  });

  it('accepts a monotonic but absolutely-wrong device clock (stable skew)', async () => {
    const skewedBase = Date.now() - 3600_000; // device clock 1h behind
    const first = await processLocationUpdate({
      ...base,
      timestamp: new Date(skewedBase).toISOString(),
    });
    expect(first.accepted).toBe(true);

    const second = await processLocationUpdate({
      ...base,
      timestamp: new Date(skewedBase + 2000).toISOString(),
    });
    expect(second.accepted).toBe(true);
  });

  it('still accepts exact duplicate packets (idempotent retry)', async () => {
    const ts = new Date().toISOString();
    expect((await processLocationUpdate({ ...base, timestamp: ts })).accepted).toBe(true);
    expect((await processLocationUpdate({ ...base, timestamp: ts })).accepted).toBe(true);
  });

  it('recovers after a far-future clock glitch (bounded stall, not permanent)', async () => {
    // One fix with a +1h wall-clock glitch is accepted (clamped for storage).
    const glitch = await processLocationUpdate({
      ...base,
      timestamp: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(glitch.accepted).toBe(true);

    // The very next correct-clock fix may briefly reject (raw behind the
    // bounded stored clock), but fixes must resume — never stall for an hour.
    // Advance past the skew bound: this must be accepted.
    const recovered = await processLocationUpdate({
      ...base,
      timestamp: new Date(Date.now() + 3 * 60_000).toISOString(),
    });
    expect(recovered.accepted).toBe(true);
  });
});

describe('GPS Reliability — High-Frequency Burst & Jitter Resilience', () => {
  beforeEach(() => {
    clearInMemoryLastLocation('bus-1');
  });

  it('accepts a rapid burst of monotonic coordinates along a realistic road trajectory', async () => {
    const startMs = Date.now();
    for (let i = 0; i < 5; i++) {
      const res = await processLocationUpdate({
        ...base,
        lat: 12.9716 + i * 0.0001, // ~11m step
        lng: 77.5946 + i * 0.0001,
        timestamp: new Date(startMs + i * 1000).toISOString(),
      });
      expect(res.accepted).toBe(true);
    }
  });

  it('filters out-of-order jitter while accepting strictly increasing subsequent packets', async () => {
    const t0 = Date.now();
    // 1. First packet at t0
    const p1 = await processLocationUpdate({ ...base, lat: 12.9716, lng: 77.5946, timestamp: new Date(t0).toISOString() });
    expect(p1.accepted).toBe(true);

    // 2. Second packet at t0 + 2000ms
    const p2 = await processLocationUpdate({ ...base, lat: 12.9718, lng: 77.5948, timestamp: new Date(t0 + 2000).toISOString() });
    expect(p2.accepted).toBe(true);

    // 3. Stale lagging packet at t0 + 1000ms (arrived late over cellular network) -> must reject
    const pLag = await processLocationUpdate({ ...base, lat: 12.9717, lng: 77.5947, timestamp: new Date(t0 + 1000).toISOString() });
    expect(pLag.accepted).toBe(false);
    expect(pLag.reason).toMatch(/out-of-order/i);

    // 4. Fresh packet at t0 + 3000ms -> must accept
    const p3 = await processLocationUpdate({ ...base, lat: 12.9720, lng: 77.5950, timestamp: new Date(t0 + 3000).toISOString() });
    expect(p3.accepted).toBe(true);
  });

  it('rejects calculated velocity exceeding speed limit during short intervals', async () => {
    const t0 = Date.now();
    const p1 = await processLocationUpdate({ ...base, lat: 12.9716, lng: 77.5946, timestamp: new Date(t0).toISOString() });
    expect(p1.accepted).toBe(true);

    // Moves 600 meters in 1 second (~2160 km/h)
    const pSuperFast = await processLocationUpdate({
      ...base,
      lat: 12.9770, // ~600m away
      lng: 77.5946,
      timestamp: new Date(t0 + 1000).toISOString(),
    });
    expect(pSuperFast.accepted).toBe(false);
    expect(pSuperFast.reason).toMatch(/calculated speed/i);
  });
});
