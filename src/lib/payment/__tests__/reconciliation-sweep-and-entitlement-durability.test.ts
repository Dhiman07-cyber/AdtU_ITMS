import crypto from 'crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as reconciliationCronGet } from '@/app/api/cron/payment-reconciliation/route';
import { POST as createOrderPost } from '@/app/api/payment/razorpay/create-order/route';
import { POST as webhookPost } from '@/app/api/payment/webhook/razorpay/route';
import { POST as verifyPaymentPost } from '@/app/api/payment/razorpay/verify-payment/route';
import { processCapturedPayment, recoverPaymentEntitlement } from '@/lib/payment/payment.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import {
  fetchOrderPayments,
  createRazorpayOrder,
  fetchOrderDetails,
  fetchPaymentDetails,
  verifyRazorpaySignature,
} from '@/lib/payment/razorpay.service';
import { NextRequest } from 'next/server';

// Mock Supabase Server
vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
}));

// Mock payments Supabase service
vi.mock('@/lib/services/payments-supabase', () => ({
  paymentsSupabaseService: {
    getPaymentById: vi.fn(),
    getPaymentByRazorpayId: vi.fn(),
    createPayment: vi.fn(),
    upsertPayment: vi.fn(),
    createDuplicatePaymentRecord: vi.fn(),
    updatePaymentStatus: vi.fn(),
    updatePaymentMetadata: vi.fn(),
    getRecentPendingOrders: vi.fn(),
    getStalePendingOrders: vi.fn(),
    getCompletedPaymentsWithPendingEntitlements: vi.fn(),
    claimPaymentForEntitlementRecovery: vi.fn(),
  },
}));

// Mock Razorpay service
vi.mock('@/lib/payment/razorpay.service', () => ({
  createRazorpayOrder: vi.fn(),
  fetchOrderPayments: vi.fn(),
  fetchOrderDetails: vi.fn(),
  fetchPaymentDetails: vi.fn(),
  verifyRazorpaySignature: vi.fn(),
  generateReceiptId: vi.fn().mockReturnValue('rec_bus_123'),
}));

// Mock api-security withSecurity wrapper
vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => {
    return async (req: any) => {
      const body = await req.json();
      return handler(req, {
        auth: { uid: body.studentUid || 'student_123', name: 'Test Student', role: 'student' },
        body,
      });
    };
  },
  getClientIp: () => '127.0.0.1',
}));

// Mock admin system config
vi.mock('@/domains/admin', () => ({
  getSystemConfig: vi.fn().mockResolvedValue({
    data: {
      busFee: { amount: 15000 },
    },
  }),
}));

// Mock application domain
const mockGetApplicationById = vi.fn().mockResolvedValue(null);
const mockGetByApplicantUid = vi.fn().mockResolvedValue(null);
const mockSubmitFinal = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/domains/application', () => ({
  getById: (...args: any[]) => mockGetApplicationById(...args),
  getByApplicantUid: (...args: any[]) => mockGetByApplicantUid(...args),
  submitFinal: (...args: any[]) => mockSubmitFinal(...args),
}));

// Mock student domain
const mockApplyPaymentValidity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/domains/student', () => ({
  getByUid: vi.fn().mockResolvedValue({
    uid: 'student_123',
    fullName: 'Test Commuter',
    currentBusId: 'bus_01',
    sessionStartYear: 2026,
    sessionEndYear: 2027,
  }),
  getByEnrollmentId: vi.fn().mockResolvedValue(null),
  applyPaymentValidity: (...args: any[]) => mockApplyPaymentValidity(...args),
  SeatReclaimRequiredError: class extends Error {},
}));

// Mock identity domain
vi.mock('@/domains/identity', () => ({
  getUsersByRole: vi.fn().mockResolvedValue([{ uid: 'admin_1' }]),
}));

// Mock notification domain
vi.mock('@/domains/notification', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock audit domain
const mockCreateAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@/domains/audit', () => ({
  createAuditEvent: (...args: any[]) => mockCreateAuditEvent(...args),
}));

// Mock receipt service
vi.mock('@/lib/services/receipt.service', () => ({
  ensureReceiptSignature: vi.fn().mockResolvedValue({ ok: true, status: 'valid' }),
}));

// Mock deadline config
vi.mock('@/lib/deadline-config', () => ({
  getDeadlineConfig: vi.fn().mockResolvedValue({
    academicYearStartMonth: 6,
    renewalDeadlineMonth: 7,
    renewalDeadlineDay: 15,
  }),
}));

describe('Payment Reconciliation Sweep & Entitlement Durability Forensic Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(paymentsSupabaseService.claimPaymentForEntitlementRecovery).mockResolvedValue({
      claimed: true,
      leaseTime: '2026-10-10T12:00:00.000Z',
    });
  });

  describe('1. Pre-Checkout Pending Record Durability', () => {
    it('durably records Pending payment with trusted student and session attribution before checkout begins', async () => {
      vi.mocked(createRazorpayOrder).mockResolvedValue({
        id: 'order_test_999',
        amount: 1500000,
        currency: 'INR',
        receipt: 'rec_01',
        status: 'created',
      } as any);

      vi.mocked(paymentsSupabaseService.upsertPayment).mockResolvedValue('order_test_999');

      const request = new NextRequest('http://localhost:3000/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 15000,
          studentUid: 'student_123',
          studentId: 'ADTU/2026/001',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
          durationYears: 1,
        }),
      });

      const response = await createOrderPost(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.order.id).toBe('order_test_999');

      // Verify that paymentsSupabaseService.upsertPayment was invoked with trusted server state
      expect(paymentsSupabaseService.upsertPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'Pending',
          razorpayOrderId: 'order_test_999',
          studentUid: 'student_123',
          amount: 15000,
        })
      );
    });

    it('fails closed with HTTP 500 and hides order ID when pending-row persistence throws an error', async () => {
      vi.mocked(createRazorpayOrder).mockResolvedValue({
        id: 'order_test_fail_closed_1',
        amount: 1500000,
        currency: 'INR',
        receipt: 'rec_02',
        status: 'created',
      } as any);

      vi.mocked(paymentsSupabaseService.upsertPayment).mockRejectedValue(new Error('Supabase connection lost'));

      const request = new NextRequest('http://localhost:3000/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 15000,
          studentUid: 'student_123',
          studentId: 'ADTU/2026/001',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
          durationYears: 1,
        }),
      });

      const response = await createOrderPost(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.order).toBeUndefined();
      expect(json.key_id).toBeUndefined();
      expect(json.error).toContain('Database service failure');
    });

    it('fails closed with HTTP 500 and hides order ID when upsertPayment returns null', async () => {
      vi.mocked(createRazorpayOrder).mockResolvedValue({
        id: 'order_test_fail_closed_2',
        amount: 1500000,
        currency: 'INR',
        receipt: 'rec_03',
        status: 'created',
      } as any);

      vi.mocked(paymentsSupabaseService.upsertPayment).mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 15000,
          studentUid: 'student_123',
          studentId: 'ADTU/2026/001',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
          durationYears: 1,
        }),
      });

      const response = await createOrderPost(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.success).toBe(false);
      expect(json.order).toBeUndefined();
      expect(json.key_id).toBeUndefined();
      expect(json.error).toContain('Failed to record pending checkout order in financial ledger');
    });
  });

  describe('2. Entitlement Durability & Failure Window Recovery (Scenarios A - H)', () => {
    it('Scenario A/G: Completed payment records failed entitlement status when validity update throws', async () => {
      // Mock payment row created in completed state
      vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.createPayment).mockResolvedValue('pay_capture_fail_1');
      vi.mocked(paymentsSupabaseService.updatePaymentMetadata).mockResolvedValue(true);

      // Force renewal submission / entitlement update to fail
      mockSubmitFinal.mockResolvedValueOnce({ success: false, error: 'Database constraint violation' });

      const result = await processCapturedPayment({
        paymentId: 'pay_capture_fail_1',
        orderId: 'order_test_001',
        amount: 15000,
        method: 'Online',
        notes: {
          userId: 'student_123',
          sessionStartYear: '2026',
          sessionEndYear: '2027',
          durationYears: '1',
          renewalApplicationId: 'app_ren_123',
        },
      });

      expect(result.status).toBe('success');
      // Payment ledger record must be preserved as Completed
      expect(paymentsSupabaseService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: 'pay_capture_fail_1',
          status: 'Completed',
        })
      );

      // Entitlement status must be durably marked as failed with error details
      expect(paymentsSupabaseService.updatePaymentMetadata).toHaveBeenCalledWith(
        'pay_capture_fail_1',
        expect.objectContaining({
          entitlement_status: 'failed',
          entitlement_error: 'Database constraint violation',
        })
      );
    });

    it('Scenario B & H: Background sweep recovers entitlement for previously stranded Completed payment', async () => {
      const strandedPayment: any = {
        payment_id: 'pay_stranded_1',
        student_uid: 'student_123',
        status: 'Completed',
        session_start_year: 2026,
        session_end_year: 2027,
        valid_until: '2027-06-30T00:00:00.000Z',
        metadata: { entitlement_status: 'failed', entitlement_retry_count: 1 },
      };

      vi.mocked(paymentsSupabaseService.updatePaymentMetadata).mockResolvedValue(true);

      const recoveryRes = await recoverPaymentEntitlement(strandedPayment);

      expect(recoveryRes.success).toBe(true);
      expect(mockApplyPaymentValidity).toHaveBeenCalledWith('student_123', {
        valid_until: '2027-06-30T00:00:00.000Z',
        session_start_year: 2026,
        session_end_year: 2027,
      });

      expect(paymentsSupabaseService.updatePaymentMetadata).toHaveBeenCalledWith(
        'pay_stranded_1',
        expect.objectContaining({
          entitlement_status: 'active',
        }),
        expect.objectContaining({
          expectedClaimTime: '2026-10-10T12:00:00.000Z',
        })
      );
    });

    it('Scenario C & D: Retrying processCapturedPayment on existing Completed payment is idempotent', async () => {
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue({
        payment_id: 'pay_existing_done',
        status: 'Completed',
        amount: 15000,
        student_uid: 'student_123',
        metadata: { entitlement_status: 'active' },
      } as any);

      const result = await processCapturedPayment({
        paymentId: 'pay_existing_done',
        orderId: 'order_123',
        amount: 15000,
        method: 'Online',
        notes: { userId: 'student_123' },
      });

      expect(result.status).toBe('already_processed');
      // Must not re-insert payment or re-execute submitFinal
      expect(paymentsSupabaseService.createPayment).not.toHaveBeenCalled();
      expect(mockSubmitFinal).not.toHaveBeenCalled();
    });

    it('Scenario E & F: Concurrent recovery workers coordinate via atomic claim lease', async () => {
      const strandedPayment: any = {
        payment_id: 'pay_concurrent_1',
        student_uid: 'student_123',
        status: 'Completed',
        session_start_year: 2026,
        session_end_year: 2027,
        valid_until: '2027-06-30T00:00:00.000Z',
        metadata: { entitlement_status: 'failed' },
      };

      // First worker acquires claim
      vi.mocked(paymentsSupabaseService.claimPaymentForEntitlementRecovery).mockResolvedValueOnce({
        claimed: true,
        leaseTime: '2026-10-10T12:00:00.000Z',
      });
      const resWorker1 = await recoverPaymentEntitlement(strandedPayment);
      expect(resWorker1.success).toBe(true);
      expect(resWorker1.alreadyClaimed).toBeUndefined();

      // Second worker attempting concurrent recovery is rejected by active lease
      vi.mocked(paymentsSupabaseService.claimPaymentForEntitlementRecovery).mockResolvedValueOnce({
        claimed: false,
      });
      const resWorker2 = await recoverPaymentEntitlement(strandedPayment);
      expect(resWorker2.success).toBe(true);
      expect(resWorker2.alreadyClaimed).toBe(true);
      // Second worker must not invoke student validity extension again
      expect(mockApplyPaymentValidity).toHaveBeenCalledTimes(1);
    });

    it('Scenario I: pending_registration_submission does not falsely count as recovered while application is unsubmitted, and activates once submitted', async () => {
      const regPayment: any = {
        payment_id: 'pay_reg_unsubmitted',
        student_uid: 'applicant_user_99',
        student_id: 'ADTU/2026/099',
        status: 'Completed',
        amount: 15000,
        session_start_year: 2026,
        session_end_year: 2027,
        metadata: {
          entitlement_status: 'pending_registration_submission',
          application_id: 'app_user_99',
        },
      };

      vi.mocked(paymentsSupabaseService.claimPaymentForEntitlementRecovery).mockResolvedValue({
        claimed: true,
        leaseTime: '2026-10-10T12:00:00.000Z',
      });

      // 1. Student has not submitted application yet -> returns pendingSubmission: true, success: false
      mockGetApplicationById.mockResolvedValueOnce(null);
      mockGetByApplicantUid.mockResolvedValueOnce(null);

      const unsubmittedRes = await recoverPaymentEntitlement(regPayment);
      expect(unsubmittedRes.success).toBe(false);
      expect(unsubmittedRes.pendingSubmission).toBe(true);

      // Verifies lease was released and status remains pending_registration_submission
      expect(paymentsSupabaseService.updatePaymentMetadata).toHaveBeenCalledWith(
        'pay_reg_unsubmitted',
        {
          entitlement_status: 'pending_registration_submission',
          recovering_since: null,
        },
        { expectedClaimTime: '2026-10-10T12:00:00.000Z' }
      );

      // 2. Student subsequently submits application -> resolves application and activates entitlement
      mockGetByApplicantUid.mockResolvedValueOnce({
        applicationId: 'app_user_99',
        state: 'submitted',
      } as any);

      const submittedRes = await recoverPaymentEntitlement(regPayment);
      expect(submittedRes.success).toBe(true);
      expect(paymentsSupabaseService.updatePaymentMetadata).toHaveBeenCalledWith(
        'pay_reg_unsubmitted',
        expect.objectContaining({
          entitlement_status: 'active',
          recovering_since: null,
        }),
        { expectedClaimTime: '2026-10-10T12:00:00.000Z' }
      );
    });

    it('Scenario J: Distinguishes claim database error from legitimate active lease', async () => {
      const payment: any = {
        payment_id: 'pay_db_err_test',
        status: 'Completed',
        metadata: { entitlement_status: 'failed' },
      };

      vi.mocked(paymentsSupabaseService.claimPaymentForEntitlementRecovery).mockResolvedValueOnce({
        claimed: false,
        error: new Error('PostgreSQL connection timeout'),
        reason: 'error',
      } as any);

      const res = await recoverPaymentEntitlement(payment);
      expect(res.success).toBe(false);
      expect(res.claimError).toBe(true);
      expect(res.alreadyClaimed).toBeUndefined();
      expect(res.error).toContain('PostgreSQL connection timeout');
    });

    it('Scenario K: Expired worker cannot report success when database update matches 0 rows', async () => {
      const payment: any = {
        payment_id: 'pay_zero_rows_test',
        student_uid: 'stud_123',
        status: 'Completed',
        session_start_year: 2026,
        session_end_year: 2027,
        metadata: { entitlement_status: 'failed' },
      };

      vi.mocked(paymentsSupabaseService.claimPaymentForEntitlementRecovery).mockResolvedValueOnce({
        claimed: true,
        leaseTime: '2026-10-10T10:00:00.000Z',
      });

      // Simulate conditional update matching 0 rows because lease expired and was claimed by another worker
      vi.mocked(paymentsSupabaseService.updatePaymentMetadata).mockResolvedValueOnce(false);

      const res = await recoverPaymentEntitlement(payment);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Lost lease or concurrent update collision');
    });
  });

  describe('3. Automated Sweep Route Execution & Boundaries', () => {
    const validCronSecret = 'test_cron_secret_key_12345';

    beforeEach(() => {
      process.env.CRON_SECRET = validCronSecret;
    });

    it('Enforces fail-closed authentication when Authorization header is invalid or missing', async () => {
      const reqNoAuth = new NextRequest('http://localhost:3000/api/cron/payment-reconciliation');
      const resNoAuth = await reconciliationCronGet(reqNoAuth);
      expect(resNoAuth.status).toBe(401);

      const reqBadAuth = new NextRequest('http://localhost:3000/api/cron/payment-reconciliation', {
        headers: { Authorization: 'Bearer wrong_secret' },
      });
      const resBadAuth = await reconciliationCronGet(reqBadAuth);
      expect(resBadAuth.status).toBe(401);
    });

    it('Scans recent 48h orders, stale queue (>48h), and incomplete entitlements under valid auth', async () => {
      // Mock recent pending orders
      vi.mocked(paymentsSupabaseService.getRecentPendingOrders).mockResolvedValue({
        data: [
          {
            payment_id: 'pending_rec_1',
            razorpay_order_id: 'order_rec_1',
            student_uid: 'student_123',
            student_id: 'ADTU/2026/001',
            status: 'Pending',
          } as any,
        ],
        error: null,
      });

      // Mock stale pending orders (>48h)
      vi.mocked(paymentsSupabaseService.getStalePendingOrders).mockResolvedValue({
        data: [
          {
            payment_id: 'pending_stale_1',
            razorpay_order_id: 'order_stale_1',
            student_uid: 'student_456',
            status: 'Pending',
          } as any,
        ],
        error: null,
      });

      // Mock completed payments with pending entitlements
      vi.mocked(paymentsSupabaseService.getCompletedPaymentsWithPendingEntitlements).mockResolvedValue({
        data: [
          {
            payment_id: 'pay_comp_missing_ent',
            student_uid: 'student_789',
            status: 'Completed',
            session_start_year: 2026,
            session_end_year: 2027,
            valid_until: '2027-06-30T00:00:00.000Z',
            metadata: { entitlement_status: 'failed' },
          } as any,
        ],
        error: null,
      });

      // Mock Razorpay provider responses
      vi.mocked(fetchOrderPayments).mockImplementation(async (orderId) => {
        if (orderId === 'order_rec_1') {
          return [{ id: 'pay_captured_rec', status: 'captured', amount: 1500000, notes: {} }];
        }
        if (orderId === 'order_stale_1') {
          // Abandoned checkout - no capture
          return [{ id: 'pay_attempt_failed', status: 'failed', amount: 1500000, notes: {} }];
        }
        return [];
      });

      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.createPayment).mockResolvedValue('pay_captured_rec');
      vi.mocked(paymentsSupabaseService.updatePaymentMetadata).mockResolvedValue(true);

      const req = new NextRequest('http://localhost:3000/api/cron/payment-reconciliation', {
        headers: { Authorization: `Bearer ${validCronSecret}` },
      });

      const res = await reconciliationCronGet(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.scannedOrders).toBe(1);
      expect(data.recoveredCount).toBe(1);
      expect(data.staleOrdersScanned).toBe(1);
      expect(data.staleAbandonedCount).toBe(1);
      expect(data.entitlementsScanned).toBe(1);
      expect(data.entitlementsRecoveredCount).toBe(1);
    });

    it('Avoids duplicate audit events and skips already_processed payments during sweep', async () => {
      vi.mocked(paymentsSupabaseService.getRecentPendingOrders).mockResolvedValue({
        data: [
          {
            payment_id: 'pending_dup_1',
            razorpay_order_id: 'order_dup_1',
            student_uid: 'student_123',
            status: 'Pending',
          } as any,
        ],
        error: null,
      });
      vi.mocked(paymentsSupabaseService.getStalePendingOrders).mockResolvedValue({ data: [], error: null });
      vi.mocked(paymentsSupabaseService.getCompletedPaymentsWithPendingEntitlements).mockResolvedValue({ data: [], error: null });

      vi.mocked(fetchOrderPayments).mockResolvedValue([
        { id: 'pay_dup_done', status: 'captured', amount: 1500000, notes: {} },
      ]);

      // Mock payment as already completed in ledger
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue({
        payment_id: 'pay_dup_done',
        status: 'Completed',
        metadata: { entitlement_status: 'active' },
      } as any);

      const req = new NextRequest('http://localhost:3000/api/cron/payment-reconciliation', {
        headers: { Authorization: `Bearer ${validCronSecret}` },
      });

      const res = await reconciliationCronGet(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.recoveredCount).toBe(0);
      expect(data.skippedCount).toBe(1);
      // Ensure no duplicate payment_reconciled_via_cron_sweep audit event was emitted
      expect(mockCreateAuditEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payment_reconciled_via_cron_sweep' })
      );
    });
  });

  describe('4. Webhook Route vs Client Checkout Verification Route Distinction', () => {
    it('Razorpay server webhook handler validates X-Razorpay-Signature over raw text body using RAZORPAY_WEBHOOK_SECRET', async () => {
      const webhookSecret = 'test_webhook_secret_999';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_test_1',
              order_id: 'order_webhook_test_1',
              amount: 1500000,
              currency: 'INR',
              method: 'card',
            },
          },
        },
      });

      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawPayload)
        .digest('hex');

      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_webhook_test_1',
        amount: 1500000,
        currency: 'INR',
        notes: {
          userId: 'student_123',
          enrollmentId: 'ADTU/2026/001',
          purpose: 'renewal',
          sessionStartYear: '2026',
          sessionEndYear: '2027',
          durationYears: '1',
        },
      } as any);

      vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.createPayment).mockResolvedValue('pay_webhook_test_1');

      const webhookReq = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': validSignature,
        },
        body: rawPayload,
      });

      const webhookRes = await webhookPost(webhookReq);
      expect(webhookRes.status).toBe(200);

      // Verify rejection if signature is invalid
      const badWebhookReq = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': 'invalid_signature_hex',
        },
        body: rawPayload,
      });

      const badWebhookRes = await webhookPost(badWebhookReq);
      expect(badWebhookRes.status).toBe(400);
    });

    it('Client checkout verification handler validates checkout modal signature using RAZORPAY_KEY_SECRET', async () => {
      vi.mocked(verifyRazorpaySignature).mockReturnValue({ isValid: true });
      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_verify_1',
        amount: 1500000,
        currency: 'INR',
        notes: {
          userId: 'student_123',
          studentId: 'ADTU/2026/001',
          studentName: 'Test Student',
          purpose: 'renewal',
          sessionStartYear: '2026',
          sessionEndYear: '2027',
          durationYears: '1',
        },
      } as any);
      vi.mocked(fetchPaymentDetails).mockResolvedValue({
        id: 'pay_verify_1',
        order_id: 'order_verify_1',
        amount: 1500000,
        currency: 'INR',
        status: 'captured',
      } as any);

      vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.createPayment).mockResolvedValue('pay_verify_1');

      const verifyReq = new NextRequest('http://localhost:3000/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_payment_id: 'pay_verify_1',
          razorpay_order_id: 'order_verify_1',
          razorpay_signature: 'modal_signature_xyz',
          studentUid: 'student_123',
        }),
      });

      const verifyRes = await verifyPaymentPost(verifyReq);
      const verifyJson = await verifyRes.json();
      expect(verifyRes.status).toBe(200);
      expect(verifyJson.success).toBe(true);
      expect(verifyRazorpaySignature).toHaveBeenCalledWith({
        razorpay_payment_id: 'pay_verify_1',
        razorpay_order_id: 'order_verify_1',
        razorpay_signature: 'modal_signature_xyz',
      });
    });
  });
});
