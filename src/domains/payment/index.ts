// D5 Payment — public surface. Only this file may be imported by other domains.
//
// OWNERSHIP BOUNDARIES
// ──────────────────────────────────────────────────────────────────────────────
// D5 Payment owns:
//   - payments (PostgreSQL) — immutable financial ledger
//   - processed_payments (PostgreSQL) — idempotency markers (7-day TTL)
//
// D5 Payment does NOT own:
//   - renewal_requests — owned by Renewal domain (future D6+)
//   - student validity — owned by Student domain (D3)
//     Payment calls Student.applyPaymentValidity(), never update() directly
//   - student profiles — owned by Student domain (D3)
//   - user/identity data — owned by Identity domain (D1)
//   - applications — owned by Application domain (D4)
//   - notifications — owned by Notification domain (D10)
//   - audit_logs — owned by Audit domain (D11)
//
// Cross-domain reads:
//   - Payment reads Student (enrollmentId resolution) via Student domain API
//   - Payment reads Application (targetSession) via Application domain API
//   - Payment reads Identity (approver details) via Identity domain API
//
// Cross-domain writes:
//   - Payment writes Student (validity extension) via Student.applyPaymentValidity()
//   - Payment writes Notification (staff alerts) via Notification domain API
//
// FIRESTORE FROZEN COLLECTIONS:
//   - processed_payments — DO NOT write to Firestore, use PostgreSQL
//   - renewal_requests — still in Firestore (excluded from D5, future domain)
//
// ponytail: Razorpay gateway helpers (order creation, signature verification)
// and the raw Postgres repository are implementation details, not exposed
// here — only payment business outcomes are.
export {
  createOnlinePayment,
  processCapturedPayment,
  createOfflinePaymentAtApproval,
  approveOfflinePayment,
  rejectOfflinePayment,
  getByStudent,
  getAll,
  getPending,
  getById,
  getDetails,
  isProcessed,
} from './services/payment.service';
