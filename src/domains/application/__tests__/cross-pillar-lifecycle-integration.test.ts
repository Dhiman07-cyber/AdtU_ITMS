import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { syncSystemConfigDates } from '@/app/api/settings/deadline-config/route';
import {
  calculateAcademicSessionStartYear,
  resolveApplicationType,
  isUpcomingApplication,
} from '@/lib/utils/application-eligibility';
import { invalidateStudentAssignmentCache } from '@/domains/student';
import { invalidateConfigCache } from '@/domains/admin/services/config.service';

// ── Hoisted Mocks ─────────────────────────────────────────────────────────────
const {
  mockRpc,
  mockSupabaseFrom,
  mockCreateRazorpayOrder,
  mockGetCurrentBusFee,
  mockGetSystemConfig,
  mockGetStudentById,
  mockVerifyApiAuth,
  mockInsertPayment,
} = vi.hoisted(() => {
  return {
    mockRpc: vi.fn(),
    mockSupabaseFrom: vi.fn(),
    mockCreateRazorpayOrder: vi.fn(),
    mockGetCurrentBusFee: vi.fn(),
    mockGetSystemConfig: vi.fn(),
    mockGetStudentById: vi.fn(),
    mockVerifyApiAuth: vi.fn(),
    mockInsertPayment: vi.fn(),
  };
});

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    rpc: mockRpc,
    from: mockSupabaseFrom,
  }),
}));

vi.mock('@/domains/student', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domains/student')>();
  return {
    ...actual,
    getByUid: mockGetStudentById,
    getStudentByUid: mockGetStudentById,
    invalidateStudentAssignmentCache: vi.fn().mockResolvedValue(undefined),
    invalidateStudentAssignment: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/domains/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domains/admin')>();
  return {
    ...actual,
    getSystemConfig: mockGetSystemConfig,
    invalidateConfigCache: vi.fn(),
  };
});

vi.mock('@/domains/admin/services/config.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domains/admin/services/config.service')>();
  return {
    ...actual,
    getSystemConfig: mockGetSystemConfig,
    invalidateConfigCache: vi.fn(),
  };
});

vi.mock('@/lib/bus-fee-service', () => ({
  getCurrentBusFee: mockGetCurrentBusFee,
}));

vi.mock('@/domains/identity', () => ({
  getStudentById: mockGetStudentById,
}));

vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => {
    return async (req: any) => {
      const body = await req.json();
      return handler(req, {
        auth: { uid: 'student_123', role: 'student', name: 'John Doe', email: 'john@adtu.edu' },
        body,
      });
    };
  },
}));

vi.mock('@/lib/security/api-auth', () => ({
  verifyApiAuth: mockVerifyApiAuth,
  verifyTokenOnly: vi.fn().mockResolvedValue({ uid: 'mock_uid' }),
}));

vi.mock('@/lib/payment/razorpay.service', () => ({
  createRazorpayOrder: mockCreateRazorpayOrder,
  generateReceiptId: vi.fn().mockReturnValue('ADTU_BUS_REC_123'),
}));

vi.mock('@/lib/services/payments-supabase', () => ({
  paymentsSupabaseService: {
    createPayment: mockInsertPayment,
    upsertPayment: mockInsertPayment,
  },
}));

vi.mock('@/lib/deadline-config-service', () => ({
  getDeadlineConfig: vi.fn().mockResolvedValue({
    academicSessionStart: { month: 11, day: 1 },
    academicYear: { anchorMonth: 10, anchorDay: 30 },
  }),
  updateDeadlineConfig: vi.fn().mockResolvedValue({ success: true }),
  invalidateActiveConfigCache: vi.fn(),
}));

describe('Cross-Pillar Lifecycle Integration & Zero-Redis-Load Cache Healing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Mid-Session Calendar Shift Cascade (July 1 -> December 1)', () => {
    it('should invoke recalculate_academic_lifecycle_dates RPC with exact month/day parameters', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          success: true,
          students_updated: 42,
          applications_updated: 15,
        },
        error: null,
      });

      const deadlineConfig = {
        academicSessionStart: { month: 11, day: 1 }, // December 1 (0-indexed month 11)
      } as any;

      await syncSystemConfigDates(deadlineConfig, 'admin_user_1');

      expect(mockRpc).toHaveBeenCalledWith('recalculate_academic_lifecycle_dates', {
        p_start_month: 11,
        p_start_day: 1,
      });
      expect(invalidateStudentAssignmentCache).toHaveBeenCalledWith('*');
    });

    it('should execute TypeScript fallback cascade when RPC fails, recalculating valid_until and eligible_approval', async () => {
      // Simulate RPC failure to test TypeScript fallback
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Function recalculate_academic_lifecycle_dates does not exist' },
      });

      const updatedStudentProfiles: any[] = [];
      const updatedApplications: any[] = [];

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'student_profiles') {
          return {
            select: () => ({
              gt: () => ({
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        uid: 'student_cohort_2026',
                        session_end_year: 2026,
                        status: 'active',
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
            update: (payload: any) => ({
              eq: (col: string, val: any) => ({
                in: () => {
                  updatedStudentProfiles.push({
                    uid: col === 'uid' ? val : 'student_cohort_2026',
                    session_end_year: col === 'session_end_year' ? val : 2026,
                    ...payload,
                  });
                  return Promise.resolve({ error: null });
                },
                then: (resolve: any) => {
                  updatedStudentProfiles.push({
                    uid: col === 'uid' ? val : 'student_cohort_2026',
                    session_end_year: col === 'session_end_year' ? val : 2026,
                    ...payload,
                  });
                  return Promise.resolve({ error: null }).then(resolve);
                },
              }),
            }),
          };
        }

        if (table === 'applications') {
          return {
            select: () => ({
              in: () =>
                Promise.resolve({
                  data: [
                    {
                      application_id: 'app_future_2027',
                      session_start_year: 2027,
                      application_type: 'future',
                    },
                  ],
                  error: null,
                }),
            }),
            update: (payload: any) => ({
              eq: (_col: string, val: any) => {
                updatedApplications.push({ applicationId: val, ...payload });
                return Promise.resolve({ error: null });
              },
              in: (_col: string, vals: any[]) => {
                for (const v of vals) {
                  updatedApplications.push({ applicationId: v, ...payload });
                }
                return Promise.resolve({ error: null });
              },
            }),
          };
        }

        return {
          select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        };
      });

      const deadlineConfig = {
        academicSessionStart: { month: 11, day: 1 }, // December 1
      } as any;

      await syncSystemConfigDates(deadlineConfig, 'admin_user_1');

      // Verify student profiles were updated to November 30 (expiry) and December 1 (soft block)
      expect(updatedStudentProfiles.length).toBe(1);
      const updatedStudent = updatedStudentProfiles[0];
      expect(updatedStudent.uid).toBe('student_cohort_2026');

      const validUntil = new Date(updatedStudent.valid_until);
      expect(validUntil.getUTCFullYear()).toBe(2026);
      expect(validUntil.getUTCMonth()).toBe(10); // November (0-indexed 10)
      expect(validUntil.getUTCDate()).toBe(30);

      const softBlock = new Date(updatedStudent.soft_block);
      expect(softBlock.getUTCFullYear()).toBe(2026);
      expect(softBlock.getUTCMonth()).toBe(11); // December (0-indexed 11)
      expect(softBlock.getUTCDate()).toBe(1);

      // Verify future application eligible_approval was updated
      expect(updatedApplications.length).toBe(1);
      const updatedApp = updatedApplications[0];
      expect(updatedApp.applicationId).toBe('app_future_2027');
      expect(updatedApp.eligible_approval).toBeDefined();

      const eligibleDate = new Date(updatedApp.eligible_approval);
      expect(eligibleDate.getUTCFullYear()).toBe(2027);
      expect(eligibleDate.getUTCMonth()).toBe(11); // December
      expect(eligibleDate.getUTCDate()).toBe(2); // soft_block + 1 day

      // Verify student assignment cache wildcard invalidation
      expect(invalidateStudentAssignmentCache).toHaveBeenCalledWith('*');
    });
  });

  describe('2. Dynamic calculateAcademicSessionStartYear & Application Eligibility', () => {
    it('should dynamically calculate session start year according to configured month/day', () => {
      // Date: August 15, 2026
      const testDate = new Date(Date.UTC(2026, 7, 15, 12, 0, 0));

      // With default (July 1, month 6): August 15 is after July 1 -> start year is 2026
      const julyConfig = { academicSessionStart: { month: 6, day: 1 } };
      expect(calculateAcademicSessionStartYear(testDate, julyConfig)).toBe(2026);

      // With December 1 start (month 11): August 15 is before December 1 -> start year is 2025
      const decConfig = { academicSessionStart: { month: 11, day: 1 } };
      expect(calculateAcademicSessionStartYear(testDate, decConfig)).toBe(2025);
    });

    it('should resolve application type and upcoming status dynamically based on configured calendar', () => {
      // Date: August 15, 2026
      const testDate = new Date(Date.UTC(2026, 7, 15, 12, 0, 0));

      const application = {
        applicationId: 'app_test_1',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        state: 'submitted',
        eligibleApproval: '2026-12-02T00:00:00.000Z',
      } as any;

      // Under December 1 start config, current session is 2025, so target 2026 is FUTURE
      const decConfig = { academicSessionStart: { month: 11, day: 1 } } as any;
      expect(resolveApplicationType(application, testDate, decConfig)).toBe('future');
      expect(isUpcomingApplication(application, testDate, decConfig)).toBe(true);

      // Under July 1 start config, current session is 2026, and eligibleApproval has passed if set to July 2
      const pastEligibleApp = {
        ...application,
        eligibleApproval: '2026-07-02T00:00:00.000Z',
      };
      const julyConfig = { academicSessionStart: { month: 6, day: 1 } } as any;
      expect(resolveApplicationType(pastEligibleApp, testDate, julyConfig)).toBe('fresh');
      expect(isUpcomingApplication(pastEligibleApp, testDate, julyConfig)).toBe(false);
    });
  });

  describe('3. Zero-Redis-Load Stale Fee Self-Healing on create-order', () => {
    it('should invalidate stale L1 fee cache, re-fetch fresh fee from DB, and succeed without false rejection', async () => {
      const { POST: createOrderPost } = await import('@/app/api/payment/razorpay/create-order/route');

      // 1. Setup authenticated student
      mockVerifyApiAuth.mockResolvedValueOnce({
        authenticated: true,
        uid: 'student_123',
        role: 'student',
        name: 'John Doe',
        email: 'john@adtu.edu',
      });

      mockGetStudentById.mockResolvedValueOnce({
        uid: 'student_123',
        fullName: 'John Doe',
        enrollmentId: 'ENR-2026-001',
        sessionEndYear: 2026,
        validUntil: '2026-06-30T23:59:59.999Z',
      });

      // 2. First call to getCurrentBusFee returns STALE 5000 (cached in L1)
      // Fresh second call returns 6000 (updated in DB)
      mockGetCurrentBusFee
        .mockResolvedValueOnce({ amount: 5000 }) // Stale check
        .mockResolvedValueOnce({ amount: 6000 }); // Fresh read after cache invalidation

      mockGetSystemConfig
        .mockResolvedValueOnce({ data: { busFee: { amount: 5000 } } })
        .mockResolvedValueOnce({ data: { busFee: { amount: 6000 } } });

      mockCreateRazorpayOrder.mockResolvedValueOnce({
        id: 'order_fresh_789',
        amount: 600000, // paise
        currency: 'INR',
        receipt: 'ADTU_BUS_REC_123',
        status: 'created',
      });

      mockInsertPayment.mockResolvedValueOnce({
        id: 'pay_db_123',
        order_id: 'order_fresh_789',
      });

      // 3. Client sends 6000 (matching the freshly updated fee)
      const request = new NextRequest('http://localhost:3000/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 6000,
          durationYears: 1,
        }),
      });

      const response = await createOrderPost(request);
      const json = await response.json();

      // Assert self-healing succeeded and order was generated
      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.order.id).toBe('order_fresh_789');
      expect(mockCreateRazorpayOrder).toHaveBeenCalledWith(
        6000,
        expect.any(String),
        expect.objectContaining({
          durationYears: '1',
          userId: 'student_123',
        })
      );
    });

    it('should reject with 400 and return fresh currentFee if amount still mismatches after DB re-read', async () => {
      const { POST: createOrderPost } = await import('@/app/api/payment/razorpay/create-order/route');

      mockVerifyApiAuth.mockResolvedValueOnce({
        authenticated: true,
        uid: 'student_123',
        role: 'student',
        name: 'John Doe',
      });

      mockGetStudentById.mockResolvedValueOnce({
        uid: 'student_123',
        fullName: 'John Doe',
      });

      // Stale fee was 5000, DB fee is 6000, but client sent 9999
      mockGetCurrentBusFee
        .mockResolvedValueOnce({ amount: 5000 })
        .mockResolvedValueOnce({ amount: 6000 });

      mockGetSystemConfig
        .mockResolvedValueOnce({ data: { busFee: { amount: 5000 } } })
        .mockResolvedValueOnce({ data: { busFee: { amount: 6000 } } });

      const request = new NextRequest('http://localhost:3000/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 9999,
          durationYears: 1,
        }),
      });

      const response = await createOrderPost(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toBe('Payment amount does not match the official bus fee');
      expect(json.currentFee).toBe(6000);
    });
  });
});
