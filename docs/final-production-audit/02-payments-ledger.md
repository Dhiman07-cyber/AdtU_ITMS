# 02 — Payments & Ledger Audit

## Business Understanding
Students pay for bus passes online (Razorpay) or offline (bus office, manual entry by admin/moderator). Money movement is real; the ledger is the financial record. Renewal payments map 1:1 to renewal applications (`online_<paymentId>`). A receipt with a QR signature is issued. PII inside the ledger is encrypted at rest (AES-256-GCM).

## Architecture
- `payment.service.ts` — `processCapturedPayment` canonical completion path, used by webhook-verify, client-verify, recovery and restore endpoints.
- `payments-supabase.service.ts` — ledger CRUD (append-only; `payments_no_delete` RLS), AES-GCM encrypted PII columns.
- Receipt service + `document-crypto.service.ts` (signature generation/verification).
- Razorpay webhook with HMAC-SHA256 verification.
- Firestore keeps a mirrored payment history; PG is canonical.

## Workflow & Execution Traces
1. Order created → payment → Razorpay webhook or client-side verify → `processCapturedPayment`.
2. Idempotency gate: `isPaymentProcessed(paymentId)` → if processed and renewal → self-healing branch → else `already_processed`.
3. New registration: creates payment + session-derived `validUntil`. Renewal: payment + `online_<paymentId>` application.
4. Offline: `renew-services` route; manual mode requires `transactionId`.

## Verified Findings

### H3 — "Self-healing" for renewal applications is log-only [VERIFIED]
- **Where:** `src/lib/payment/payment.service.ts:137-152`
- **Issue:** When `isProcessed` is true, purpose is renewal, and the `online_<paymentId>` application is missing, the code only logs `"Self-healing missing renewal application…"` and falls through past the branch — it never creates the application. Execution continues to the regular payment flow which hits the ledger insert → primary-key conflict → error path.
- **Impact:** A payment captured once, whose application creation failed mid-crash (network/db outage), can never be completed: student paid, no pass, every retry returns `already_processed` (or errors). Real money, no service.
- **Fix:** Inside the branch, actually create the renewal application (and return success), instead of logging and falling through.

### H9 — renew-services idempotency key is dead code [VERIFIED]
- **Where:** `src/app/api/renew-services/route.ts:94-99`
- **Issue:** `opKey`/`operationKey` computed from body hash but never stored, never checked anywhere. Comment claims "Idempotency claim" — there is none.
- **Impact:** Double-submit of the same offline renewal (same transactionId) re-runs the loop: second run re-increments `validUntil`, `expiryReminderCount`, and `paid_on`. Double-charging/extension errors for offline payments.
- **Fix:** Either persist the key (e.g., `reassignment_logs`-style table or a `processed_operations` table) or document that the endpoint is NOT idempotent and guard at the client + require unique transactionId (add a partial unique index on manual payments transaction_id).

## Agent-reported findings (payments domain, medium/high confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| F1: Webhook double-charge — ack without refund: when `createPayment` fails after Razorpay capture, recovery returns success but no refund/compensation path exists | payment.service.ts / webhook route | High |
| F2: `maybeSingle` on payments lookups can 406 → 500 (see report 11, H4-analog) | payments-supabase.service.ts | Medium |
| F4/F5: Recovery notes trust — `notes` in recovery payloads are client/recovery input, not verified against the captured payment | recovery route | Medium |
| F6: Receipt re-sign risk — 64-char signature prefix truncated into QR; QR content may be re-signable for different amount/date | receipt service | Medium |
| F7: Renewal upsert path — upsert on renewal may overwrite `validUntil` fields across retries | payment.service.ts | Medium |
| Encryption: AES-256-GCM key derived from `payment_id` (per-row salt = payment id) — collision/derivation weakness | `document-crypto`/encryption service | Medium |

## What is solid (verified)
- Webhook HMAC-SHA256 with `timingSafeEqual` — no timing side channel.
- Ledger is immutable: `payments_no_delete` RLS; no UPDATE on completed payment rows in the main path.
- Partial unique index `idx_payments_one_completed_per_student_session` — one Completed online payment per (student, session).
- `end_trip_atomically`-style single-statement transactions for capacity (report 03).

## Recommendations
1. H3: actually create the renewal application in the self-healing branch (one function call; verify with the existing renewal-application factory).
2. H9: unique manual-payment transaction_id or a real idempotency store.
3. Medium items: derive encryption key from a random salt stored alongside (not payment_id); sign receipts with full signature; verify recovery `notes` against ledger payment row before acting.

## Confidence
High (VERIFIED rows re-read this session); Medium for agent rows (evidence cited from their source walkthrough).
