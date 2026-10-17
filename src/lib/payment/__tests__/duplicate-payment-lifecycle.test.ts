import { describe, expect, it, vi, beforeEach } from 'vitest';
import { processCapturedPayment, isPaymentProcessed } from '@/lib/payment/payment.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { getStatusBadgeClass } from '@/lib/types/payment';

// Mock Supabase Server to prevent environment variable errors
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
  },
}));

// Mock application domain
const mockSubmitFinal = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/domains/application', () => ({
  getById: vi.fn().mockResolvedValue(null),
  submitFinal: (...args: any[]) => mockSubmitFinal(...args),
}));

// Mock student domain
vi.mock('@/domains/student', () => ({
  getByUid: vi.fn().mockResolvedValue({
    uid: 'stud_123',
    fullName: 'Test Student',
    currentBusId: 'bus_1',
    sessionStartYear: 2026,
    sessionEndYear: 2027,
  }),
  getByEnrollmentId: vi.fn().mockResolvedValue(null),
  applyPaymentValidity: vi.fn().mockResolvedValue(undefined),
  SeatReclaimRequiredError: class extends Error {},
}));

// Mock identity domain
vi.mock('@/domains/identity', () => ({
  getUsersByRole: vi.fn().mockResolvedValue([{ uid: 'staff_1' }]),
}));

// Mock notification domain
vi.mock('@/domains/notification', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

// Mock audit domain
vi.mock('@/domains/audit', () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock receipt service
vi.mock('@/lib/services/receipt.service', () => ({
  ensureReceiptSignature: vi.fn().mockResolvedValue('sig_123'),
}));

describe('Duplicate Payment Lifecycle & Financial Ledger Integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. A first ordinary captured payment records successfully', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.createPayment).mockResolvedValue('pay_AAA');

    const result = await processCapturedPayment({
      paymentId: 'pay_AAA',
      orderId: 'order_AAA',
      amount: 15000,
      method: 'Online',
      notes: {
        userId: 'stud_123',
        studentName: 'Test Student',
        type: 'renewal',
        durationYears: '1',
      },
      source: 'webhook',
    });

    expect(result.status).toBe('success');
    expect(paymentsSupabaseService.createPayment).toHaveBeenCalledTimes(1);
    expect(mockSubmitFinal).toHaveBeenCalledTimes(1);
  });

  it('2. The same provider payment processed twice is recognized by isPaymentProcessed and returns true', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue({
      id: 'row_1',
      payment_id: 'pay_AAA',
      status: 'Completed',
    } as any);

    const isProcessed = await isPaymentProcessed('pay_AAA');
    expect(isProcessed).toBe(true);
  });

  it('3. Racing webhook and verify-payment for the same paymentId resolve idempotently', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue({
      id: 'row_1',
      payment_id: 'pay_AAA',
      status: 'Completed',
    } as any);

    const result = await processCapturedPayment({
      paymentId: 'pay_AAA',
      orderId: 'order_AAA',
      amount: 15000,
      notes: { type: 'registration' },
    });

    expect(result.status).toBe('already_processed');
  });

  it('4. Two distinct captured payment IDs for same session: second is durably recorded as Duplicate_Pending_Refund', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.createPayment).mockRejectedValue(new Error('DUPLICATE_SESSION_PAYMENT'));
    vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockResolvedValue('pay_BBB');

    const result = await processCapturedPayment({
      paymentId: 'pay_BBB',
      orderId: 'order_BBB',
      amount: 15000,
      method: 'Online',
      notes: {
        userId: 'stud_123',
        studentName: 'Test Student',
        type: 'renewal',
        sessionStartYear: '2026',
        sessionEndYear: '2027',
      },
      source: 'webhook',
    });

    expect(result.status).toBe('already_paid_for_session');
    expect(paymentsSupabaseService.createDuplicatePaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_BBB',
        status: 'Duplicate_Pending_Refund',
        amount: 15000,
        razorpayPaymentId: 'pay_BBB',
      })
    );
  });

  it('5. Failed duplicate-record insert fails closed and returns error so provider retries', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.createPayment).mockRejectedValue(new Error('DUPLICATE_SESSION_PAYMENT'));
    // DB returns null indicating insert failed
    vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockResolvedValue(null);

    const result = await processCapturedPayment({
      paymentId: 'pay_CCC',
      orderId: 'order_CCC',
      amount: 15000,
      notes: {
        userId: 'stud_123',
        type: 'renewal',
      },
      source: 'webhook',
    });

    // MUST fail closed so webhook returns HTTP 500 and Razorpay retries
    expect(result.status).toBe('error');
    expect(result.error).toContain('Failed to record duplicate payment');
  });

  it('6. Duplicate record insert exception also fails closed', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.createPayment).mockRejectedValue(new Error('DUPLICATE_SESSION_PAYMENT'));
    vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockRejectedValue(new Error('DB connection reset'));

    const result = await processCapturedPayment({
      paymentId: 'pay_DDD',
      orderId: 'order_DDD',
      amount: 15000,
      notes: { userId: 'stud_123' },
    });

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('7. Repeated webhook delivery after duplicate event is recorded returns already_paid_for_session via isPaymentProcessed', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue({
      id: 'row_dup',
      payment_id: 'pay_BBB',
      status: 'Duplicate_Pending_Refund',
    } as any);
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue({
      id: 'row_dup',
      payment_id: 'pay_BBB',
      status: 'Duplicate_Pending_Refund',
    } as any);

    // 1. isPaymentProcessed detects Duplicate_Pending_Refund as processed
    const processed = await isPaymentProcessed('pay_BBB');
    expect(processed).toBe(true);

    // 2. processCapturedPayment short-circuits safely without creating any renewal application
    const result = await processCapturedPayment({
      paymentId: 'pay_BBB',
      orderId: 'order_BBB',
      amount: 15000,
      notes: { type: 'renewal', userId: 'stud_123' },
    });

    expect(result.status).toBe('already_paid_for_session');
    expect(paymentsSupabaseService.createPayment).not.toHaveBeenCalled();
    expect(mockSubmitFinal).not.toHaveBeenCalled();
  });

  it('8. Duplicate payment record does not grant entitlement or create new application', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.createPayment).mockRejectedValue(new Error('DUPLICATE_SESSION_PAYMENT'));
    vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockResolvedValue('pay_BBB');

    await processCapturedPayment({
      paymentId: 'pay_BBB',
      orderId: 'order_BBB',
      amount: 15000,
      notes: { type: 'renewal', userId: 'stud_123' },
    });

    // Verification: Renewal application submitFinal is NEVER called for duplicate payment
    expect(mockSubmitFinal).not.toHaveBeenCalled();
  });

  it('9. Status badge helper correctly formats Duplicate_Pending_Refund with warning styling', () => {
    const badgeClass = getStatusBadgeClass('Duplicate_Pending_Refund');
    expect(badgeClass).toContain('amber');
  });

  it('10. Status badge helper maintains valid styling for standard statuses and new review statuses', () => {
    expect(getStatusBadgeClass('Completed')).toContain('green');
    expect(getStatusBadgeClass('Pending')).toContain('yellow');
    expect(getStatusBadgeClass('Rejected')).toContain('red');
    expect(getStatusBadgeClass('Captured_Pending_Review')).toContain('indigo');
    expect(getStatusBadgeClass('Refunded')).toContain('slate');
  });

  it('11. mapRecoverStatusToState correctly maps duplicate_pending_refund and captured_pending_review', async () => {
    const { mapRecoverStatusToState } = await import('@/lib/payment/payment-state');
    expect(mapRecoverStatusToState('duplicate_pending_refund')).toBe('duplicate_pending_refund');
    expect(mapRecoverStatusToState('captured_pending_review')).toBe('captured_pending_review');
    expect(mapRecoverStatusToState('success')).toBe('success');
    expect(mapRecoverStatusToState('processing')).toBe('processing');
    expect(mapRecoverStatusToState('failed')).toBe('failed');
    expect(mapRecoverStatusToState('not_found')).toBe('failed');
  });

  it('12. PAYMENT_STATE_CONTENT provides clear non-misleading copy for duplicate_pending_refund and captured_pending_review', async () => {
    const { PAYMENT_STATE_CONTENT } = await import('@/lib/payment/payment-state');
    const dupContent = PAYMENT_STATE_CONTENT.duplicate_pending_refund;
    expect(dupContent.title).toBe('Duplicate Payment Recorded');
    expect(dupContent.lines).toHaveLength(3);
    expect(dupContent.lines[0]).toContain('already covers this academic session');
    expect(dupContent.lines[2]).toContain('refund review');

    const revContent = PAYMENT_STATE_CONTENT.captured_pending_review;
    expect(revContent.title).toBe('Payment Recorded — Review Required');
    expect(revContent.lines).toHaveLength(3);
    expect(revContent.lines[0]).toContain('securely recorded in the university ledger');
    expect(revContent.lines[1]).toContain('Academic session details could not be automatically verified');
  });

  it('13. formatPaymentStatusDisplay returns clear non-misleading review messaging', async () => {
    const { formatPaymentStatusDisplay } = await import('@/lib/types/payment');
    expect(formatPaymentStatusDisplay('Duplicate_Pending_Refund')).toBe('Duplicate Payment — Review Required');
    expect(formatPaymentStatusDisplay('duplicate_pending_refund')).toBe('Duplicate Payment — Review Required');
    expect(formatPaymentStatusDisplay('Captured_Pending_Review')).toBe('Captured — Review Required');
    expect(formatPaymentStatusDisplay('captured_pending_review')).toBe('Captured — Review Required');
    expect(formatPaymentStatusDisplay('Refunded')).toBe('Refunded');
    expect(formatPaymentStatusDisplay('refunded')).toBe('Refunded');
    expect(formatPaymentStatusDisplay('Completed')).toBe('Completed');
    expect(formatPaymentStatusDisplay('Pending')).toBe('Pending');
    expect(formatPaymentStatusDisplay('Rejected')).toBe('Rejected');
  });

  it('14. Captured payment with unestablished session is recorded as Captured_Pending_Review (not Duplicate)', async () => {
    const { getByUid } = await import('@/domains/student');
    vi.mocked(getByUid).mockResolvedValueOnce(null);
    vi.mocked(paymentsSupabaseService.getPaymentById).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue(null);
    vi.mocked(paymentsSupabaseService.createDuplicatePaymentRecord).mockResolvedValue('pay_UNRESOLVED');

    const result = await processCapturedPayment({
      paymentId: 'pay_UNRESOLVED',
      orderId: 'order_UNRESOLVED',
      amount: 12000,
      notes: {
        type: 'renewal',
        userId: 'student_without_session',
        // Omitting sessionStartYear and sessionEndYear, and no active calendar
      },
    });

    expect(result.status).toBe('captured_pending_review');
    expect(paymentsSupabaseService.createDuplicatePaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_UNRESOLVED',
        status: 'Captured_Pending_Review',
        metadata: expect.objectContaining({
          requires_manual_review: true,
          unresolved_academic_session: true,
          duplicate_session_capture: false,
        }),
      })
    );
    // Crucial: Must NEVER submit a completed renewal application for unresolved sessions
    expect(mockSubmitFinal).not.toHaveBeenCalled();
  });

  it('15. Fast-path handles already-recorded Captured_Pending_Review idempotently', async () => {
    vi.mocked(paymentsSupabaseService.getPaymentByRazorpayId).mockResolvedValue({
      id: 'row_rev',
      payment_id: 'pay_UNRESOLVED',
      status: 'Captured_Pending_Review',
    } as any);

    const result = await processCapturedPayment({
      paymentId: 'pay_UNRESOLVED',
      orderId: 'order_UNRESOLVED',
      amount: 12000,
      notes: { type: 'renewal', userId: 'stud_123' },
    });

    expect(result.status).toBe('captured_pending_review');
    expect(mockSubmitFinal).not.toHaveBeenCalled();
  });
});
