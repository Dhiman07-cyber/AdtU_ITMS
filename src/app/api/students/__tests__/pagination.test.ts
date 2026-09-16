import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  mockVerifyApiAuth,
  mockApplyRateLimit,
  mockSelect,
  mockEq,
  mockOrder,
  mockRange,
} = vi.hoisted(() => ({
  mockVerifyApiAuth: vi.fn(),
  mockApplyRateLimit: vi.fn(),
  mockSelect: vi.fn(),
  mockEq: vi.fn(),
  mockOrder: vi.fn(),
  mockRange: vi.fn(),
}));

vi.mock('@/lib/security/api-auth', () => ({
  verifyApiAuth: mockVerifyApiAuth,
}));

vi.mock('@/lib/security/rate-limiter', () => ({
  applyRateLimit: mockApplyRateLimit,
  createRateLimitId: vi.fn().mockReturnValue('test-rate-id'),
  RateLimits: { READ: { maxRequests: 100, windowMs: 60000 } },
}));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
    })),
  })),
}));

vi.mock('@/domains/identity', () => ({
  getStudentsByBusIds: vi.fn().mockResolvedValue([]),
  getStudentsByStatus: vi.fn().mockResolvedValue([]),
}));

import { GET } from '../route';

describe('/api/students — Server-side Pagination & Truncation Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyApiAuth.mockResolvedValue({
      authenticated: true,
      uid: 'admin-1',
      role: 'admin',
    });
    mockApplyRateLimit.mockResolvedValue({
      allowed: true,
      headers: {},
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ range: mockRange });
  });

  it('correctly handles page 1 with hasMore = true and accurate total count', async () => {
    const TOTAL = 120;
    const PAGE_SIZE = 50;
    const page1Data = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      uid: `student-${i}`,
      full_name: `Student ${i}`,
      email: `s${i}@adtu.in`,
      status: 'active',
    }));

    mockRange.mockResolvedValue({
      data: page1Data,
      error: null,
      count: TOTAL,
    });

    const req = new NextRequest('http://localhost:3000/api/students?limit=50&offset=0&paginate=true');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Total-Count')).toBe('120');
    expect(res.headers.get('X-Has-More')).toBe('true');
    expect(res.headers.get('X-Page-Offset')).toBe('0');
    expect(res.headers.get('X-Page-Limit')).toBe('50');

    const body = await res.json();
    expect(body.students.length).toBe(50);
    expect(body.total).toBe(120);
    expect(body.hasMore).toBe(true);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(50);
  });

  it('correctly handles page 2 with hasMore = true', async () => {
    const TOTAL = 120;
    const PAGE_SIZE = 50;
    const page2Data = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      uid: `student-${i + 50}`,
      full_name: `Student ${i + 50}`,
      email: `s${i + 50}@adtu.in`,
      status: 'active',
    }));

    mockRange.mockResolvedValue({
      data: page2Data,
      error: null,
      count: TOTAL,
    });

    const req = new NextRequest('http://localhost:3000/api/students?limit=50&offset=50&paginate=true');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Total-Count')).toBe('120');
    expect(res.headers.get('X-Has-More')).toBe('true');
    expect(res.headers.get('X-Page-Offset')).toBe('50');

    const body = await res.json();
    expect(body.students.length).toBe(50);
    expect(body.total).toBe(120);
    expect(body.hasMore).toBe(true);
  });

  it('correctly handles final page with hasMore = false', async () => {
    const TOTAL = 120;
    const finalPageData = Array.from({ length: 20 }, (_, i) => ({
      uid: `student-${i + 100}`,
      full_name: `Student ${i + 100}`,
      email: `s${i + 100}@adtu.in`,
      status: 'active',
    }));

    mockRange.mockResolvedValue({
      data: finalPageData,
      error: null,
      count: TOTAL,
    });

    const req = new NextRequest('http://localhost:3000/api/students?limit=50&offset=100&paginate=true');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Total-Count')).toBe('120');
    expect(res.headers.get('X-Has-More')).toBe('false');
    expect(res.headers.get('X-Page-Offset')).toBe('100');

    const body = await res.json();
    expect(body.students.length).toBe(20);
    expect(body.total).toBe(120);
    expect(body.hasMore).toBe(false);
  });

  it('correctly handles empty page beyond bounds with hasMore = false', async () => {
    mockRange.mockResolvedValue({
      data: [],
      error: null,
      count: 120,
    });

    const req = new NextRequest('http://localhost:3000/api/students?limit=50&offset=150&paginate=true');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Total-Count')).toBe('120');
    expect(res.headers.get('X-Has-More')).toBe('false');

    const body = await res.json();
    expect(body.students.length).toBe(0);
    expect(body.total).toBe(120);
    expect(body.hasMore).toBe(false);
  });

  it('preserves backwards-compatible array payload when paginate param is omitted', async () => {
    const page1Data = Array.from({ length: 10 }, (_, i) => ({
      uid: `student-${i}`,
      full_name: `Student ${i}`,
      email: `s${i}@adtu.in`,
      status: 'active',
    }));

    mockRange.mockResolvedValue({
      data: page1Data,
      error: null,
      count: 10,
    });

    const req = new NextRequest('http://localhost:3000/api/students?limit=50&offset=0');
    const res = await GET(req);

    expect(res.status).toBe(200);
    // Headers still present for clients reading headers
    expect(res.headers.get('X-Total-Count')).toBe('10');
    expect(res.headers.get('X-Has-More')).toBe('false');

    // Body is a direct array
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(10);
  });
});
