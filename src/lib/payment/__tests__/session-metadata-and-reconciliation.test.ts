import { describe, expect, it, vi, beforeEach } from 'vitest';
import { processCapturedPayment, reconcileUnresolvedCapture, confirmManualRefund, denyManualRefund } from '@/lib/payment/payment.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { getStatusBadgeClass, formatPaymentStatusDisplay } from '@/lib/types/payment';

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
    createDuplicatePaymentRecord: vi.fn(),
    updatePaymentStatus: vi.fn(),
    reconcileCapturedPendingReviewPayment: vi.fn(),
    confirmManualRefundRecord: vi.fn(),
    denyRefundRecord: vi.fn(),
    getRecentPendingOrders: vi.fn(),
  },
}));

// Mock application domain
const mockSubmitFinal = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/domains/application', () => ({
  getById: vi.fn().mockResolvedValue(null),
  getByApplicantUid: vi.fn().mockResolvedValue(null),
  submitFinal: (...args: any[]) => mockSubmitFinal(...args),
}));

// Mock student domain
const mockApplyPaymentValidity = vi.fn().mockResolvedValue(undefined);
vi.mock('@/domains/student', () => ({
  getByUid: vi.fn().mockResolvedValue({
    uid: 'student_xyz',
    fullName: 'Jane Doe',
    currentBusId: 'bus_42',
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
  ensureReceiptSignature: vi.fn().mockResolvedValue('sig_valid_receipt'),
}));

// Mock deadline config
vi.mock('@/lib/deadline-config', () => ({
  getDeadlineConfig: vi.fn().mockResolvedValue({
    academicYearStartMonth: 6,
    renewalDeadlineMonth: 7,
    renewalDeadlineDay: 15,
  }),
}));

describe('Session Metadata Trust, Reconciliation State Machine & Refund Audit Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Session Metadata Trust & Undetermined Attribution', () => {
    it('records captured payment with missing session metadata as Captured_Pending_Review (not arbitrary year)', async () => {
      vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockResolvedValue('pay_unresolved_1');

      const result = await processCapturedPayment({
        paymentId: 'pay_unresolved_1',
        orderId: 'order_no_session',
        amount: 15000,
        method: 'Online',
        notes: {
          userId: 'applicant_new_1',
          studentName: 'Jane Doe',
          type: 'registration',
          // Explicitly omit sessionStartYear and sessionEndYear
        },
        source: 'webhook',
      });

      expect(result.status).toBe('captured_pending_review');
      expect(paymentsSupabaseService.createDuplicatePaymentRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: 'pay_unresolved_1',
          status: 'Captured_Pending_Review',
          sessionStartYear: undefined,
          sessionEndYear: undefined,
        })
      );
      // Transit validity must NOT be activated for unresolved captures
      expect(mockApplyPaymentValidity).not.toHaveBeenCalled();
    });

    it('records captured payment with invalid inverted session boundaries as Captured_Pending_Review', async () => {
      vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
      vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockResolvedValue('pay_unresolved_2');

      const result = await processCapturedPayment({
        paymentId: 'pay_unresolved_2',
        orderId: 'order_inverted_session',
        amount: 15000,
        method: 'Online',
        notes: {
          userId: 'applicant_new_2',
          studentName: 'Jane Doe',
          type: 'registration',
          sessionStartYear: '2028',
          sessionEndYear: '2026', // Inverted! (start >= end)
        },
        source: 'webhook',
      });

      expect(result.status).toBe('captured_pending_review');
      expect(paymentsSupabaseService.createDuplicatePaymentRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'Captured_Pending_Review',
          sessionStartYear: undefined,
          sessionEndYear: undefined,
        })
      );
    });
  });

  describe('2. Controlled Reconciliation Operation (Captured_Pending_Review -> Completed)', () => {
    it('rejects reconciliation if caller is not an authorized administrator', async () => {
      const result = await reconcileUnresolvedCapture({
        paymentId: 'pay_unresolved_1',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        reconcilerUserId: 'student_attacker',
        reconcilerName: 'Attacker',
        reconcilerRole: 'student',
        evidence: 'Self-claimed reconciliation',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only authorized administrators');
      expect(paymentsSupabaseService.reconcileCapturedPendingReviewPayment).not.toHaveBeenCalled();
    });

    it('rejects reconciliation if session boundaries are invalid (start >= end)', async () => {
      const result = await reconcileUnresolvedCapture({
        paymentId: 'pay_unresolved_1',
        sessionStartYear: 2027,
        sessionEndYear: 2026,
        reconcilerUserId: 'admin_1',
        reconcilerName: 'Admin Officer',
        reconcilerRole: 'admin',
        evidence: 'Verified session',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid session boundaries');
      expect(paymentsSupabaseService.reconcileCapturedPendingReviewPayment).not.toHaveBeenCalled();
    });

    it('rejects reconciliation if explicit audit evidence is omitted', async () => {
      const result = await reconcileUnresolvedCapture({
        paymentId: 'pay_unresolved_1',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        reconcilerUserId: 'admin_1',
        reconcilerName: 'Admin Officer',
        reconcilerRole: 'admin',
        evidence: '   ', // Blank
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('audit evidence is mandatory');
      expect(paymentsSupabaseService.reconcileCapturedPendingReviewPayment).not.toHaveBeenCalled();
    });

    it('successfully reconciles Captured_Pending_Review to Completed and activates transit validity only after persistence succeeds', async () => {
      const reconciledPayment = {
        id: 'row_reconciled_1',
        payment_id: 'pay_unresolved_1',
        status: 'Completed' as const,
        student_uid: 'student_xyz',
        student_id: 'ADTU2026-001',
        student_name: 'Jane Doe',
        session_start_year: 2026,
        session_end_year: 2027,
        duration_years: 1,
        amount: 15000,
        approved_by: { userId: 'admin_1', name: 'Admin Officer', role: 'admin' },
      };

      vi.mocked(paymentsSupabaseService.reconcileCapturedPendingReviewPayment).mockResolvedValue({
        success: true,
        payment: reconciledPayment,
      });

      const result = await reconcileUnresolvedCapture({
        paymentId: 'pay_unresolved_1',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        reconcilerUserId: 'admin_1',
        reconcilerName: 'Admin Officer',
        reconcilerRole: 'admin',
        evidence: 'Student admission slip verified against ERP ref #ADTU-REG-9876',
      });

      expect(result.success).toBe(true);
      expect(result.payment?.status).toBe('Completed');
      expect(paymentsSupabaseService.reconcileCapturedPendingReviewPayment).toHaveBeenCalledTimes(1);

      // Entitlement activation must have been called with the reconciled payment
      expect(mockApplyPaymentValidity).toHaveBeenCalledTimes(1);

      // Audit trail must record high-severity payment_reconciled event
      expect(mockCreateAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_reconciled',
          category: 'renewals',
          severity: 'high',
          target_id: 'pay_unresolved_1',
        })
      );
    });

    it('fails safely and does NOT activate entitlement if durable database update fails', async () => {
      vi.mocked(paymentsSupabaseService.reconcileCapturedPendingReviewPayment).mockResolvedValue({
        success: false,
        error: 'Unique constraint violation: idx_payments_one_completed_per_session',
      });

      const result = await reconcileUnresolvedCapture({
        paymentId: 'pay_unresolved_1',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        reconcilerUserId: 'admin_1',
        reconcilerName: 'Admin Officer',
        reconcilerRole: 'admin',
        evidence: 'Duplicate session reconciliation attempt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unique constraint violation');
      // Must NOT activate entitlement
      expect(mockApplyPaymentValidity).not.toHaveBeenCalled();
    });
  });

  describe('3. Genuine Refund State Transitions & Distinguishing Refund_Denied', () => {
    it('confirmManualRefund requires admin role and valid external refund reference', async () => {
      vi.mocked(paymentsSupabaseService.confirmManualRefundRecord).mockResolvedValue({
        success: true,
      });

      const unauthorizedRes = await confirmManualRefund({
        paymentId: 'pay_dup_1',
        refundReference: 'rfnd_razorpay_999',
        refundedAmount: 15000,
        authorizerUserId: 'driver_1',
        authorizerName: 'Driver',
        authorizerRole: 'driver',
        reason: 'Refunded via portal',
      });
      expect(unauthorizedRes.success).toBe(false);
      expect(unauthorizedRes.error).toContain('Only administrators');

      const authorizedRes = await confirmManualRefund({
        paymentId: 'pay_dup_1',
        refundReference: 'rfnd_razorpay_999',
        refundedAmount: 15000,
        authorizerUserId: 'admin_1',
        authorizerName: 'Finance Officer',
        authorizerRole: 'admin',
        reason: 'Processed via Razorpay Merchant Dashboard refund #rfnd_razorpay_999',
      });
      expect(authorizedRes.success).toBe(true);
      expect(mockCreateAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_refunded',
          category: 'finance',
          target_id: 'pay_dup_1',
        })
      );
    });

    it('denyManualRefund records Refund_Denied status with mandatory denial reason and preserves financial traceability', async () => {
      vi.mocked(paymentsSupabaseService.denyRefundRecord).mockResolvedValue({
        success: true,
      });

      const emptyReasonRes = await denyManualRefund({
        paymentId: 'pay_dup_1',
        denierUserId: 'admin_1',
        denierName: 'Finance Officer',
        denierRole: 'admin',
        reason: '',
      });
      expect(emptyReasonRes.success).toBe(false);
      expect(emptyReasonRes.error).toContain('Mandatory audit denial reason is required');

      const successRes = await denyManualRefund({
        paymentId: 'pay_dup_1',
        denierUserId: 'admin_1',
        denierName: 'Finance Officer',
        denierRole: 'admin',
        reason: 'Non-refundable policy applied per University Transport Regulations 2026 Section 4.2',
      });
      expect(successRes.success).toBe(true);
      expect(paymentsSupabaseService.denyRefundRecord).toHaveBeenCalledWith({
        paymentId: 'pay_dup_1',
        deniedBy: { userId: 'admin_1', name: 'Finance Officer', role: 'admin' },
        denialReason: 'Non-refundable policy applied per University Transport Regulations 2026 Section 4.2',
      });
      expect(mockCreateAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payment_refund_denied',
          category: 'finance',
          severity: 'high',
          target_id: 'pay_dup_1',
        })
      );
    });

    it('formatPaymentStatusDisplay and getStatusBadgeClass handle Refund_Denied with rose badge styling', () => {
      expect(formatPaymentStatusDisplay('Refund_Denied')).toBe('Refund Denied');
      expect(formatPaymentStatusDisplay('refund_denied')).toBe('Refund Denied');

      const badgeClass = getStatusBadgeClass('Refund_Denied');
      expect(badgeClass).toContain('rose-600');
    });
  });
});
