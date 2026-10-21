/**
 * PaymentService
 *
 * Responsibilities: payment creation (online/offline), capture processing,
 * approval/rejection, idempotency, history/lookup.
 *
 * Delegates to payment business logic and PostgreSQL repository.
 * Gateway calls (order creation, signature verification) remain internal to
 * this module, exposing business outcomes to external callers.
 */
import {
	approveOfflinePayment,
	createOfflinePaymentAtApproval,
	createOnlinePayment,
	getAllPayments,
	getPaymentById as getPaymentByIdLegacy,
	getPaymentDetails,
	getPaymentsByStudent,
	getPendingPayments,
	isPaymentProcessed,
	processCapturedPayment,
	rejectOfflinePayment,
} from '@/lib/payment/payment.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';

export {
	approveOfflinePayment,createOfflinePaymentAtApproval,createOnlinePayment,
	processCapturedPayment,rejectOfflinePayment
};

export async function getByStudent(studentUid: string, studentId?: string) {
  return getPaymentsByStudent(studentUid, studentId);
}

export async function getAll(...args: Parameters<typeof getAllPayments>) {
  return getAllPayments(...args);
}

export async function getPending() {
  return getPendingPayments();
}

export async function getById(paymentId: string) {
  return getPaymentByIdLegacy(paymentId);
}

export async function getDetails(paymentId: string) {
  return getPaymentDetails(paymentId);
}

export async function isProcessed(paymentId: string): Promise<boolean> {
  return isPaymentProcessed(paymentId);
}

/**
 * H2: Upsert an approval payment record via the Payment domain boundary.
 * Application domain MUST use this instead of directly calling
 * paymentsSupabaseService.upsertPayment().
 */
export async function upsertApprovalPayment(input: {
  paymentId: string;
  studentId?: string;
  studentUid?: string;
  studentName?: string;
  amount?: number;
  method: 'Online' | 'Offline';
  status?: 'Pending' | 'Completed' | 'Rejected';
  sessionStartYear?: number;
  sessionEndYear?: number;
  durationYears?: number;
  validUntil?: Date;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  approvedAt?: Date;
  busId?: string;
  routeId?: string;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  return paymentsSupabaseService.upsertPayment(input);
}

/**
 * H2: Reject an application's pending payment record via the Payment domain boundary.
 * Application domain MUST use this instead of directly calling
 * paymentsSupabaseService.updatePaymentStatus().
 */
export async function rejectApplicationPayment(
  paymentId: string,
  rejectorInfo: { userId: string; name: string; empId?: string; role: string },
  rejectionReason?: string,
  applicationId?: string
): Promise<boolean> {
  if (!paymentId) return false;
  const payment = (await paymentsSupabaseService.getPaymentById(paymentId)) ||
                  (await paymentsSupabaseService.getPaymentByRazorpayId(paymentId));
  if (!payment) return false;

  if (payment.status === 'Pending') {
    return paymentsSupabaseService.updatePaymentStatus(payment.payment_id, 'Rejected', rejectorInfo);
  }

  if (payment.status === 'Completed') {
    // SEAM FIX 3: Real captured money: never mutate Completed to Rejected (forbidden by DB trigger).
    // Mark entitlement as unconsumed and flag for refund review so student can re-bind without double paying.
    return paymentsSupabaseService.updatePaymentMetadata(
      payment.payment_id,
      {
        entitlement_status: 'application_rejected_unconsumed',
        requires_refund_review: true,
        rejected_application_id: applicationId || null,
        rejection_reason: rejectionReason || null,
        rejected_by: rejectorInfo,
        rejected_at: new Date().toISOString(),
      },
      { allowEntitlementStatusTransition: true } as any
    );
  }

  return false;
}
