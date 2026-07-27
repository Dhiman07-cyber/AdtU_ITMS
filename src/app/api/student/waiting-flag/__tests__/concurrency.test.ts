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

import { POST } from '../route';

interface MockChain {
  select: any; eq: any; in: any; limit: any; maybeSingle: any; single: any; insert: any; gte: any; order: any;
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
    body: JSON.stringify({ busId: 'b1', lat: 14.5, lng: 121.0, ...overrides }),
  });
}

describe('WaitingFlag POST — concurrency safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentInsertResult = null;
    mockFrom.mockReturnValue(makeChain(null));
  });

  it('returns 409 when unique violation (23505) occurs on insert', async () => {
    setInsertResult({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_waiting_flags_one_active"' },
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
    mockFrom.mockReturnValue(chain);

    const results = await Promise.all([POST(makeRequest()), POST(makeRequest())]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBeGreaterThanOrEqual(1);
  });
});
