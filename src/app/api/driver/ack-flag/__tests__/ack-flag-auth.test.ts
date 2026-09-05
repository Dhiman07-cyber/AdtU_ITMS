import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/firebase-admin', () => ({
  auth: { verifyIdToken: vi.fn() },
}));

vi.mock('@/domains/identity', () => ({
  getDriverById: vi.fn(),
}));

vi.mock('@/domains/realtime/event-emitter', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => handler,
}));

vi.mock('@/lib/security/rate-limiter', () => ({
  RateLimits: { CREATE: {} },
}));

vi.mock('@/lib/security/validation-schemas', () => ({
  MarkBoardedSchema: {},
}));

import { POST } from '../route';

function makeRequest(body: any) {
  return new Request('http://localhost/api/driver/ack-flag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeFlagQuery(flagData: any) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: flagData, error: null }),
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: flagData.id }], error: null }),
        }),
      })),
    })),
  };
}

function makeActiveTripQuery(tripData: any) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: tripData, error: null }),
          })),
        })),
      })),
    })),
  };
}

describe('WAIT-001: ack-flag authorization — bus-scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a driver whose active trip is on a DIFFERENT bus than the flag', async () => {
    const flag = { id: 'flag-1', bus_id: 'bus-Y', trip_id: 'trip-Y', student_uid: 'student-1', status: 'raised' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') return makeFlagQuery(flag);
      if (table === 'active_trips') {
        // Query now filters by bus_id = flagData.bus_id (bus-Y).
        // Driver's trip is on bus-X, so no match → null.
        return makeActiveTripQuery(null);
      }
      return { select: vi.fn() };
    });

    const req = makeRequest({ flagId: 'flag-1' });
    const ctx = { auth: { uid: 'driver-1', role: 'driver' }, body: { flagId: 'flag-1' }, requestId: 'test' };
    const res = await (POST as any)(req, ctx);
    const body = await res.json();

    // BUG DEMONSTRATION: Current code returns 200 because activeTrip !== null
    // passes even though the trip is on Bus X and the flag is on Bus Y.
    // The query at ack-flag/route.ts:33 does NOT filter by bus_id.
    // After fix: should return 403.
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/not assigned/i);
  });

  it('allows a driver whose active trip IS on the same bus as the flag', async () => {
    const flag = { id: 'flag-1', bus_id: 'bus-Y', trip_id: 'trip-Y', student_uid: 'student-1', status: 'raised' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') return makeFlagQuery(flag);
      if (table === 'active_trips') return makeActiveTripQuery({ trip_id: 'trip-Y' }); // Same bus
      return { select: vi.fn() };
    });

    const req = makeRequest({ flagId: 'flag-1' });
    const ctx = { auth: { uid: 'driver-1', role: 'driver' }, body: { flagId: 'flag-1' }, requestId: 'test' };
    const res = await (POST as any)(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
