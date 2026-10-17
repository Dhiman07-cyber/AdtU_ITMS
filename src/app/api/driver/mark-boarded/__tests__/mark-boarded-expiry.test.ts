import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());
const mockEmitEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/domains/realtime/event-emitter', () => ({
  emitEvent: mockEmitEvent,
}));

vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => handler,
}));

vi.mock('@/lib/security/rate-limiter', () => ({
  RateLimits: { CREATE: {} },
}));

import { POST } from '../route';

function makeChain(data: any, error: any = null) {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.gt = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data, error });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  chain.update = vi.fn(() => chain);
  return chain;
}

function makeRequest(body: any) {
  return new Request('http://localhost/api/driver/mark-boarded', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/driver/mark-boarded — expiry and malformed timestamp verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects boarding when waiting flag is expired', async () => {
    const flag = {
      id: 'f-exp',
      bus_id: 'bus-1',
      student_uid: 'stud-1',
      status: 'acknowledged',
      expires_at: new Date(Date.now() - 60000).toISOString(),
      created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    };
    const activeTrip = { trip_id: 'trip-1', bus_id: 'bus-1' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') return makeChain(flag);
      if (table === 'active_trips') return makeChain(activeTrip);
      return makeChain(null);
    });

    const req = makeRequest({ flagId: 'f-exp' });
    const ctx = { auth: { uid: 'driver-1', role: 'driver' }, body: { flagId: 'f-exp' } };
    const res = await (POST as any)(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('flag has expired');
  });

  it('rejects boarding when waiting flag has malformed timestamps (fails closed)', async () => {
    const flag = {
      id: 'f-malformed',
      bus_id: 'bus-1',
      student_uid: 'stud-1',
      status: 'acknowledged',
      expires_at: 'NOT-A-VALID-DATE',
      created_at: 'CORRUPTED-DATE',
    };
    const activeTrip = { trip_id: 'trip-1', bus_id: 'bus-1' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') return makeChain(flag);
      if (table === 'active_trips') return makeChain(activeTrip);
      return makeChain(null);
    });

    const req = makeRequest({ flagId: 'f-malformed' });
    const ctx = { auth: { uid: 'driver-1', role: 'driver' }, body: { flagId: 'f-malformed' } };
    const res = await (POST as any)(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('flag has expired');
  });

  it('allows boarding when waiting flag is within valid TTL', async () => {
    const flag = {
      id: 'f-valid',
      bus_id: 'bus-1',
      student_uid: 'stud-1',
      status: 'acknowledged',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    const activeTrip = { trip_id: 'trip-1', bus_id: 'bus-1' };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        const c = makeChain(flag);
        c.update = vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() => ({
              select: vi.fn().mockResolvedValue({ data: [{ id: 'f-valid' }], error: null }),
            })),
          })),
        }));
        return c;
      }
      if (table === 'active_trips') return makeChain(activeTrip);
      return makeChain(null);
    });

    const req = makeRequest({ flagId: 'f-valid' });
    const ctx = { auth: { uid: 'driver-1', role: 'driver' }, body: { flagId: 'f-valid' } };
    const res = await (POST as any)(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.flagId).toBe('f-valid');
  });
});
