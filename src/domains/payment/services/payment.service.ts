/**
 * D5 PaymentService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: payment creation (online/offline), capture processing,
 * approval/rejection, idempotency, history/lookup.
 *
 * ponytail: delegates entirely to existing production logic in
 * src/lib/payment/payment.service.ts (business logic) and
 * paymentRepository (Postgres persistence, via ../repositories) — zero
 * behavior change. Razorpay gateway calls (order creation, signature
 * verification) stay internal to this module, not part of the domain's
 * public capability surface — callers get payment *outcomes*, not gateway
 * plumbing.
 */
import {
  createOnlinePayment,
  processCapturedPayment,
  createOfflinePaymentAtApproval,
  approveOfflinePayment,
  rejectOfflinePayment,
  getPaymentsByStudent,
  getAllPayments,
  getPendingPayments,
  getPaymentById as getPaymentByIdLegacy,
  getPaymentDetails,
  isPaymentProcessed,
} from '@/lib/payment/payment.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';

export {
  createOnlinePayment,
  processCapturedPayment,
  createOfflinePaymentAtApproval,
  approveOfflinePayment,
  rejectOfflinePayment,
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
  rejectorInfo: { userId: string; name: string; empId?: string; role: string }
): Promise<boolean> {
  return paymentsSupabaseService.updatePaymentStatus(paymentId, 'Rejected', rejectorInfo);
}
