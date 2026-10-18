import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());
const mockVerifyIdToken = vi.hoisted(() => vi.fn().mockResolvedValue({ uid: 'student1', email: 's@t.com' }));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
}));

vi.mock('@/domains/student', () => ({
  getByUid: vi.fn(() => Promise.resolve({ fullName: 'Test', busId: 'b1' })),
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

import { POST, DELETE } from '../route';
import { clearStudentTripFlagCounts } from '@/domains/gps/services/gps-redis-guard';

interface MockChain {
  select: any; eq: any; in: any; limit: any; maybeSingle: any; single: any; insert: any; update: any; gte: any; order: any;
}

let currentInsertResult: any = null;

function makeChain(data: any): MockChain {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  chain.single = vi.fn(() => {
    const r = currentInsertResult || { data, error: null };
    currentInsertResult = null;
    return Promise.resolve(r);
  });
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  return chain;
}

function setInsertResult(result: any) {
  currentInsertResult = result;
}

function makeRequest(overrides = {}) {
  return new Request('http://localhost/api/student/waiting-flag', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ busId: 'b1', lat: 26.1128, lng: 91.6876, ...overrides }),
  });
}

describe('WaitingFlag POST & DELETE — concurrency & real-world invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStudentTripFlagCounts();
    currentInsertResult = null;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'active-trip-1' });
      }
      return makeChain(null);
    });
  });

  it('returns 409 when pre-check detects existing active flag', async () => {
    // Simulates: student queries waiting_flags, found an active flag
    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        const chain = makeChain(null);
        // Pre-check select returns active flag with future expires_at
        chain.limit = vi.fn().mockResolvedValue({
          data: [{ id: 'flag-existing-1', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }],
          error: null,
        });
        return chain;
      }
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'active-trip-1' });
      }
      return makeChain(null);
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already have an active waiting flag');
  });

  it('allows raising a new flag when existing flag has expired past TTL (expires_at in past)', async () => {
    // Simulates: student has a flag whose 15-minute TTL has elapsed, but cron hasn't swept it yet
    const expiredIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        const chain = makeChain(null);
        chain.limit = vi.fn().mockResolvedValue({
          data: [{ id: 'flag-expired-1', expires_at: expiredIso }],
          error: null,
        });
        return chain;
      }
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'active-trip-1' });
      }
      return makeChain(null);
    });

    setInsertResult({ data: { id: 'flag-new-1' }, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('allows raising a new flag when existing flag has malformed timestamps (fails closed as expired, unblocking re-raise)', async () => {
    // Simulates: student has an existing row with malformed or missing timestamps
    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        const chain = makeChain(null);
        chain.limit = vi.fn().mockResolvedValue({
          data: [{ id: 'flag-malformed-1', expires_at: 'NOT-A-DATE', created_at: 'INVALID-DATE' }],
          error: null,
        });
        return chain;
      }
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'active-trip-1' });
      }
      return makeChain(null);
    });

    setInsertResult({ data: { id: 'flag-new-2' }, error: null });
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 409 when unique violation (23505) occurs on insert (idx_waiting_flags_one_active_student)', async () => {
    setInsertResult({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_waiting_flags_one_active_student"' },
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already have an active waiting flag');
  });

  it('handles concurrent POSTs — only first succeeds, rest get 409', async () => {
    let insertCount = 0;
    const chain = makeChain(null);
    chain.single = vi.fn(() => {
      insertCount++;
      if (insertCount === 1) return Promise.resolve({ data: { id: 'f1' }, error: null });
      return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return makeChain({ trip_id: 'active-trip-1' });
      }
      return chain;
    });

    const results = await Promise.all([POST(makeRequest()), POST(makeRequest())]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects flag creation when no active trip is running on the bus (CRIT-07 / R-WAIT-01)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return makeChain(null); // No active trip
      }
      return makeChain(null);
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('No active trip is currently running');
    expect(body.code).toBe('NO_ACTIVE_TRIP');
  });

  it('rejects flag creation for an unassigned bus with 403', async () => {
    const res = await POST(makeRequest({ busId: 'bus-other-unassigned' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Forbidden');
  });

  it('allows student to cancel active flag via DELETE /api/student/waiting-flag', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        const chain: any = {};
        chain.update = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.in = vi.fn(() => chain);
        chain.select = vi.fn().mockResolvedValue({ data: [{ id: 'f1' }], error: null });
        return chain;
      }
      return makeChain(null);
    });

    const req = new Request('http://localhost/api/student/waiting-flag', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ flagId: 'f1', busId: 'b1' }),
    });

    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
