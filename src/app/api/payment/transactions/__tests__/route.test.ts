import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock withSecurity to execute the handler directly
vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => handler,
}));

vi.mock('@/lib/security/rate-limiter', () => ({
  RateLimits: { READ: {} },
}));

const mockGetAllPayments = vi.hoisted(() => vi.fn());
const mockGetPaymentsByStudent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/payment/payment.service', () => ({
  getAllPayments: (...args: any[]) => mockGetAllPayments(...args),
  getPaymentsByStudent: (...args: any[]) => mockGetPaymentsByStudent(...args),
}));

vi.mock('@/domains/identity', () => ({
  getUserById: vi.fn().mockResolvedValue(null),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  getUsersByIds: vi.fn().mockResolvedValue([]),
  getUsersByEmails: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/domains/student', () => ({
  getByUid: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/domains/application', () => ({
  getByApplicantUid: vi.fn().mockResolvedValue(null),
}));

import { GET } from '../route';

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe('GET /api/payment/transactions Parameter Validation & Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Returns 400 Bad Request when an invalid status parameter is passed', async () => {
    const req = makeRequest('http://localhost:3000/api/payment/transactions?status=unknown_invalid_status');
    const ctx = { auth: { uid: 'admin_1', role: 'admin' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain('Invalid status parameter');
    expect(body.error).toContain('Duplicate_Pending_Refund');
  });

  it('2. Normalizes case-insensitive duplicate status and queries getAllPayments with Duplicate_Pending_Refund', async () => {
    mockGetAllPayments.mockResolvedValue({
      payments: [
        {
          paymentId: 'pay_dup_001',
          amount: 15000,
          status: 'Duplicate_Pending_Refund',
          method: 'Online',
          createdAt: new Date('2026-07-01T10:00:00Z'),
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    const req = makeRequest('http://localhost:3000/api/payment/transactions?status=duplicate_pending_refund&page=1&limit=20');
    const ctx = { auth: { uid: 'admin_1', role: 'admin' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGetAllPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'Duplicate_Pending_Refund',
      }),
      1,
      20
    );

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.transactions[0].status).toBe('Duplicate_Pending_Refund');
  });

  it('3. Successfully composes year, method, studentId, and status filters', async () => {
    mockGetAllPayments.mockResolvedValue({
      payments: [],
      total: 0,
      page: 2,
      totalPages: 1,
    });

    const req = makeRequest(
      'http://localhost:3000/api/payment/transactions?year=2026&method=Online&studentId=STU001&status=Completed&page=2&limit=25'
    );
    const ctx = { auth: { uid: 'mod_1', role: 'moderator' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGetAllPayments).toHaveBeenCalledWith(
      {
        year: 2026,
        studentId: 'STU001',
        studentUid: undefined,
        method: 'Online',
        status: 'Completed',
      },
      2,
      25
    );
  });

  it('4. Allows status=all without applying status filter', async () => {
    mockGetAllPayments.mockResolvedValue({
      payments: [],
      total: 0,
      page: 1,
      totalPages: 1,
    });

    const req = makeRequest('http://localhost:3000/api/payment/transactions?status=all');
    const ctx = { auth: { uid: 'admin_1', role: 'admin' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGetAllPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: undefined,
      }),
      1,
      50
    );
  });

  it('5. Rejects unauthorized roles with 403 Forbidden', async () => {
    const req = makeRequest('http://localhost:3000/api/payment/transactions');
    const ctx = { auth: { uid: 'driver_1', role: 'driver' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Insufficient permissions');
  });

  it('6. Normalizes captured_pending_review status filter to Captured_Pending_Review', async () => {
    mockGetAllPayments.mockResolvedValue({
      payments: [
        {
          paymentId: 'pay_unresolved_001',
          amount: 12000,
          status: 'Captured_Pending_Review',
          method: 'Online',
          createdAt: new Date('2026-07-02T10:00:00Z'),
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });

    const req = makeRequest('http://localhost:3000/api/payment/transactions?status=captured_pending_review');
    const ctx = { auth: { uid: 'admin_1', role: 'admin' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGetAllPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'Captured_Pending_Review',
      }),
      1,
      50
    );
  });

  it('7. Normalizes refunded status filter to Refunded', async () => {
    mockGetAllPayments.mockResolvedValue({
      payments: [],
      total: 0,
      page: 1,
      totalPages: 1,
    });

    const req = makeRequest('http://localhost:3000/api/payment/transactions?status=refunded');
    const ctx = { auth: { uid: 'admin_1', role: 'admin' } };

    const res = await (GET as any)(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGetAllPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'Refunded',
      }),
      1,
      50
    );
  });
});
