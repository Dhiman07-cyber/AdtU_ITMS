import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 1. Mock firebase-admin verifyToken
const mockVerifyToken = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase-admin', () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
}));

// 2. Mock identity domain getUserById
const mockGetUserById = vi.hoisted(() => vi.fn());
vi.mock('@/domains/identity', () => ({
  getUserById: (...args: any[]) => mockGetUserById(...args),
}));

// 3. Mock payment service getPaymentDetails
const mockGetPaymentDetails = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payment/payment.service', () => ({
  getPaymentDetails: (...args: any[]) => mockGetPaymentDetails(...args),
}));

import { GET } from '../route';

function makeRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new NextRequest('http://localhost:3000/api/payments/pay_123', {
    headers,
  });
}

function makeParams(paymentId: string) {
  return { params: Promise.resolve({ paymentId }) };
}

describe('GET /api/payments/[paymentId] Authentication, Authorization & IDOR Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Rejects request without Authorization header with 401 Unauthorized', async () => {
    const req = makeRequest(); // no token
    const res = await GET(req, makeParams('pay_123'));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
  });

  it('2. Rejects request with expired or invalid token with 401 Unauthorized', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Firebase ID token has expired.'));

    const req = makeRequest('expired_token_xyz');
    const res = await GET(req, makeParams('pay_123'));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid or expired authentication token');
  });

  it('3. Returns 404 when user is not found in identity domain', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'unknown_user_uid' });
    mockGetUserById.mockResolvedValue(null);

    const req = makeRequest('valid_token');
    const res = await GET(req, makeParams('pay_123'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('User not found');
  });

  it('4. Returns 404 when payment record does not exist', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'admin_uid' });
    mockGetUserById.mockResolvedValue({ uid: 'admin_uid', role: 'admin' });
    mockGetPaymentDetails.mockResolvedValue(null);

    const req = makeRequest('valid_token');
    const res = await GET(req, makeParams('non_existent_pay_id'));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Payment not found');
  });

  it('5. IDOR Prevention: Rejects student attempting to view another student payment with 403 Forbidden', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'student_attacker_uid' });
    mockGetUserById.mockResolvedValue({ uid: 'student_attacker_uid', role: 'student' });
    mockGetPaymentDetails.mockResolvedValue({
      paymentId: 'pay_victim',
      studentUid: 'student_victim_uid', // Belongs to different student
      studentName: 'Victim Student',
      studentId: 'VICTIM001',
      amount: 15000,
      method: 'Online',
      status: 'Completed',
      durationYears: 1,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      validUntil: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    });

    const req = makeRequest('student_token');
    const res = await GET(req, makeParams('pay_victim'));
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Access denied');
  });

  it('6. Rejects non-staff, non-student roles (e.g. driver) with 403 Forbidden', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'driver_uid' });
    mockGetUserById.mockResolvedValue({ uid: 'driver_uid', role: 'driver' });
    mockGetPaymentDetails.mockResolvedValue({
      paymentId: 'pay_123',
      studentUid: 'stud_123',
      amount: 15000,
      method: 'Online',
      status: 'Completed',
      durationYears: 1,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      validUntil: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    });

    const req = makeRequest('driver_token');
    const res = await GET(req, makeParams('pay_123'));
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Access denied');
  });

  it('7. Allows student to view their own payment record (matching studentUid)', async () => {
    const ownStudentUid = 'student_owner_uid';
    mockVerifyToken.mockResolvedValue({ uid: ownStudentUid });
    mockGetUserById.mockResolvedValue({ uid: ownStudentUid, role: 'student' });
    mockGetPaymentDetails.mockResolvedValue({
      paymentId: 'pay_own',
      studentUid: ownStudentUid,
      studentName: 'Legitimate Owner',
      studentId: 'STUD001',
      amount: 15000,
      method: 'Online',
      status: 'Completed',
      durationYears: 1,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      validUntil: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    });

    const req = makeRequest('owner_token');
    const res = await GET(req, makeParams('pay_own'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.paymentId).toBe('pay_own');
    expect(body.data.studentUid).toBe(ownStudentUid);
    expect(body.data.validUntil).toBe('2027-06-30T00:00:00.000Z');
  });

  it('8. Allows admin to view any payment record (including Duplicate_Pending_Refund)', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'admin_uid' });
    mockGetUserById.mockResolvedValue({ uid: 'admin_uid', role: 'admin' });
    mockGetPaymentDetails.mockResolvedValue({
      paymentId: 'pay_duplicate_123',
      studentUid: 'student_abc',
      studentName: 'Commuter Student',
      studentId: 'COMMUTER001',
      amount: 15000,
      method: 'Online',
      status: 'Duplicate_Pending_Refund',
      durationYears: 1,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      validUntil: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
    });

    const req = makeRequest('admin_token');
    const res = await GET(req, makeParams('pay_duplicate_123'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('Duplicate_Pending_Refund');
    expect(body.data.amount).toBe(15000);
  });

  it('9. Allows moderator to view any payment record with approver info', async () => {
    mockVerifyToken.mockResolvedValue({ uid: 'mod_uid' });
    mockGetUserById.mockResolvedValue({ uid: 'mod_uid', role: 'moderator' });
    mockGetPaymentDetails.mockResolvedValue({
      paymentId: 'pay_offline_approved',
      studentUid: 'student_xyz',
      studentName: 'Offline Commuter',
      studentId: 'COMMUTER002',
      amount: 12000,
      method: 'Offline',
      status: 'Completed',
      durationYears: 1,
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      validUntil: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-07-01T10:00:00Z'),
      updatedAt: new Date('2026-07-01T10:00:00Z'),
      approver: {
        userId: 'mod_uid',
        name: 'Staff Moderator',
        empId: 'MOD01',
        role: 'moderator',
        approvedAt: new Date('2026-07-01T12:00:00Z'),
      },
    });

    const req = makeRequest('mod_token');
    const res = await GET(req, makeParams('pay_offline_approved'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.approver.name).toBe('Staff Moderator');
    expect(body.data.approver.approvedAt).toBe('2026-07-01T12:00:00.000Z');
  });
});
