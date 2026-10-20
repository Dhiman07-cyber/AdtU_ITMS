import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());
const mockVerifyIdToken = vi.hoisted(() => vi.fn().mockResolvedValue({ uid: 'student_geofence_1', email: 'student@adtu.ac.in' }));
const mockGetGpsState = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockIncrementFlagCount = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockGetFlagCount = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
}));

vi.mock('@/domains/student', () => ({
  getByUid: vi.fn(() =>
    Promise.resolve({
      fullName: 'Geofence Test Student',
      busId: 'bus_1',
      routeId: 'route_4',
      stopName: 'Six Mile Bus Stop',
    })
  ),
}));

vi.mock('@/lib/entitlement/transport-entitlement', () => ({
  getTransportEntitlement: vi.fn(() => ({ entitled: true })),
}));

vi.mock('@/domains/realtime/event-emitter', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/security/rate-limiter', () => ({
  RateLimits: { WAITING_FLAG: { windowMs: 1000, max: 100 }, READ: {} },
  applyRateLimit: vi.fn().mockResolvedValue({ allowed: true, headers: { 'X-RateLimit-Remaining': '99' } }),
  createRateLimitId: vi.fn(() => 'test'),
}));

vi.mock('@/lib/security/role-cache', () => ({
  resolveUserRole: vi.fn().mockResolvedValue({ role: 'student', name: 'Student' }),
}));

vi.mock('@/domains/gps/services/gps-redis-guard', () => ({
  getGpsStateFromRedis: mockGetGpsState,
  setRedisActiveFlag: vi.fn().mockResolvedValue(undefined),
  removeRedisActiveFlag: vi.fn().mockResolvedValue(undefined),
  incrementStudentTripFlagCount: mockIncrementFlagCount,
  getStudentTripFlagCount: mockGetFlagCount,
}));

import { POST } from '../route';

function makeChain(data: any) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn().mockResolvedValue({
    data: { id: 'flag_test_id', student_uid: 'student_geofence_1', bus_id: 'bus_1', status: 'raised' },
    error: null,
  });
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  return chain;
}

function makeRequest(bodyOverrides = {}) {
  return new Request('http://localhost/api/student/waiting-flag', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({
      busId: 'bus_1',
      routeId: 'route_4',
      stop_name: 'Six Mile Bus Stop',
      lat: 26.1348,
      lng: 91.8062,
      accuracy: 10,
      timestamp: Date.now(),
      ...bodyOverrides,
    }),
  });
}

describe('Waiting Flag 3-Lock Route Corridor & Approach Window Validation Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGpsState.mockResolvedValue(null);
    mockIncrementFlagCount.mockResolvedValue(1);
    mockGetFlagCount.mockResolvedValue(0);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'trip_active_123', bus_id: 'bus_1', route_id: 'route_4' });
      }
      if (table === 'waiting_flags') {
        const chain = makeChain(null);
        chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
        return chain;
      }
      return makeChain(null);
    });
  });

  it('rejects stale timestamp (>60s clock drift) with HTTP 400 TIMESTAMP_EXPIRED', async () => {
    const staleTime = Date.now() - 75_000;
    const req = makeRequest({ timestamp: staleTime });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('TIMESTAMP_EXPIRED');
    expect(json.error).toContain('clock drifted > 60s');
  });

  it('rejects future drifted timestamp (>60s in the future) with HTTP 400 TIMESTAMP_EXPIRED', async () => {
    const futureTime = Date.now() + 90_000;
    const req = makeRequest({ timestamp: futureTime });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('TIMESTAMP_EXPIRED');
  });

  it('rejects GPS accuracy > 150m with HTTP 400 ACCURACY_TOO_LOW', async () => {
    const req = makeRequest({ accuracy: 180 });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('ACCURACY_TOO_LOW');
    expect(json.error).toContain('Reported GPS accuracy (180m) is too low');
  });

  it('Lock 1: accepts student standing on the route corridor BETWEEN two stops (600m from stop, 15m from road)', async () => {
    // Route 4 between Six Mile (26.1348, 91.8062) and Barbari (26.1518, 91.8152).
    // Midpoint along VIP Road (~1 km from Six Mile, ~1 km from Barbari), exactly on the road polyline.
    const betweenStopsLat = (26.1348 + 26.1518) / 2; // 26.1433
    const betweenStopsLng = (91.8062 + 91.8152) / 2; // 91.8107

    const req = makeRequest({
      lat: betweenStopsLat,
      lng: betweenStopsLng,
      accuracy: 15,
      timestamp: Date.now(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.flagId || json.flag?.id).toBe('flag_test_id');
  });

  it('Lock 1: rejects student sitting 400m off the route corridor in a by-lane or in Meghalaya with HTTP 403 OUT_OF_ROUTE_CORRIDOR', async () => {
    // Coordinate 400m perpendicular off the road into a deep by-lane
    const offCorridorLat = 26.1433;
    const offCorridorLng = 91.8107 + 0.0045; // ~450m east of VIP Road

    const req = makeRequest({
      lat: offCorridorLat,
      lng: offCorridorLng,
      accuracy: 20,
      timestamp: Date.now(),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('OUT_OF_ROUTE_CORRIDOR');
    expect(json.error).toContain('You must be at the roadside along your bus route');
  });

  it('Lock 2: rejects waiting flag if bus has already passed student by >150m with HTTP 409 BUS_ALREADY_PASSED', async () => {
    // Student is waiting at Six Mile (26.1348, 91.8062)
    // Bus is already downstream at Barbari (26.1518, 91.8152), ~2km past student
    mockGetGpsState.mockResolvedValueOnce({
      lat: 26.1518,
      lng: 91.8152,
      timestamp: new Date().toISOString(),
      speed: 25,
      heading: 45,
      accuracy: 10,
    });

    const req = makeRequest({
      lat: 26.1348,
      lng: 91.8062,
      accuracy: 10,
      timestamp: Date.now(),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('BUS_ALREADY_PASSED');
    expect(json.error).toContain('Your bus has already passed your location');
  });

  it('Lock 2: rejects waiting flag if bus is still >4 km upstream away with HTTP 400 BUS_TOO_FAR_UPSTREAM', async () => {
    // Student is waiting at Barbari VIP Road (26.1518, 91.8152)
    // Bus is still at Paltan Bazar ASTC (26.1818, 91.7516), ~8 km upstream
    mockGetGpsState.mockResolvedValueOnce({
      lat: 26.1818,
      lng: 91.7516,
      timestamp: new Date().toISOString(),
      speed: 20,
      heading: 120,
      accuracy: 15,
    });

    const req = makeRequest({
      lat: 26.1518,
      lng: 91.8152,
      accuracy: 10,
      timestamp: Date.now(),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('BUS_TOO_FAR_UPSTREAM');
    expect(json.error).toContain('within 4 km of your location');
  });

  it('Lock 3: enforces per-trip anti-spam cooldown limit (<= 2 flags per trip) with HTTP 429 FLAG_COOLDOWN_ACTIVE', async () => {
    // Current count is 2 (student already reached limit)
    mockGetFlagCount.mockResolvedValueOnce(2);

    const req = makeRequest({
      lat: 26.1348,
      lng: 91.8062,
      accuracy: 10,
      timestamp: Date.now(),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe('FLAG_COOLDOWN_ACTIVE');
    expect(json.error).toContain('maximum of 2 waiting flag raises');
    expect(mockIncrementFlagCount).not.toHaveBeenCalled();
  });

  it('MANDATORY FIX 2: failed waiting-flag attempts (BUS_TOO_FAR_UPSTREAM & OUT_OF_ROUTE_CORRIDOR) do NOT burn cooldown quota', async () => {
    // 1. Out of corridor attempt
    const offCorridorLat = 26.1433;
    const offCorridorLng = 91.8107 + 0.0045; // ~450m east
    const req1 = makeRequest({ lat: offCorridorLat, lng: offCorridorLng, accuracy: 20 });
    const res1 = await POST(req1);
    expect(res1.status).toBe(403);
    expect(mockIncrementFlagCount).not.toHaveBeenCalled();

    // 2. Bus too far upstream attempt
    mockGetGpsState.mockResolvedValueOnce({
      lat: 26.1818,
      lng: 91.7516,
      timestamp: new Date().toISOString(),
      speed: 20,
      heading: 120,
      accuracy: 15,
    });
    const req2 = makeRequest({ lat: 26.1518, lng: 91.8152, accuracy: 10 });
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);
    expect(mockIncrementFlagCount).not.toHaveBeenCalled();
  });

  it('MANDATORY FIX 3: rejects cross-shift waiting flag requests with HTTP 403 SHIFT_MISMATCH', async () => {
    // Student profile has morning shift, but active trip is evening shift
    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'trip_evening_99', bus_id: 'bus_1', route_id: 'route_4', shift: 'evening' });
      }
      return makeChain(null);
    });

    const req = makeRequest({
      lat: (26.1348 + 26.1518) / 2,
      lng: (91.8062 + 91.8152) / 2,
      accuracy: 15,
      timestamp: Date.now(),
    });

    const studentModule = await import('@/domains/student');
    (studentModule.getByUid as any).mockResolvedValueOnce({
      fullName: 'Shift Test Student',
      busId: 'bus_1',
      routeId: 'route_4',
      stopName: 'Six Mile Bus Stop',
      shift: 'morning',
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('SHIFT_MISMATCH');
    expect(json.error).toContain('outside your assigned shift');
    expect(mockIncrementFlagCount).not.toHaveBeenCalled();
  });

  it('MANDATORY FIX 4: canonical bus ID matching accepts "01" vs "bus_01" for student assignment', async () => {
    // Student assigned to '01', active trip has 'bus_01', request sends 'bus_01'
    const studentModule = await import('@/domains/student');
    (studentModule.getByUid as any).mockResolvedValueOnce({
      fullName: 'Canonical Bus Student',
      busId: '01',
      routeId: 'route_4',
      stopName: 'Six Mile Bus Stop',
      shift: 'morning',
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'trip_active_123', bus_id: 'bus_01', route_id: 'route_4', shift: 'morning' });
      }
      if (table === 'waiting_flags') {
        const chain = makeChain(null);
        chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
        return chain;
      }
      return makeChain(null);
    });

    const req = makeRequest({
      busId: 'bus_01',
      lat: (26.1348 + 26.1518) / 2,
      lng: (91.8062 + 91.8152) / 2,
      accuracy: 15,
      timestamp: Date.now(),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockIncrementFlagCount).toHaveBeenCalledTimes(1);
  });
});
