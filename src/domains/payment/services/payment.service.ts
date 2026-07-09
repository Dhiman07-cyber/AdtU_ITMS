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
