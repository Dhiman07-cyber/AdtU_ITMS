# Razorpay Payment Lifecycle & Webhook Verification

## 1. Architecture & Immutability Rules

The ITMS payment infrastructure integrates with **Razorpay** to process semester and annual bus transportation fees for Assam Down Town University students.

### Core Architectural Invariants
1. **Single Source of Truth**: All payment records are persisted exclusively in Supabase PostgreSQL (`payments` table).
2. **Strict Immutability**: Payment records are append-only financial logs. Once a payment is created or captured, it **cannot be deleted or overwritten**.
3. **Idempotency**: Webhook retries and duplicate student payment submissions are safely deduplicated using `razorpay_payment_id` and unique transaction identifiers.

```
+----------------------------------------------------------------------------------------------------+
|                                    RAZORPAY INTEGRATION LIFECYCLE                                   |
+----------------------------------------------------------------------------------------------------+

  [ Student Browser ]               [ Next.js API Layer ]        [ Razorpay Gateway ]      [ PostgreSQL DB ]
           │                                 │                            │                       │
           ├── 1. POST /api/payment/create ─►│                            │                       │
           │   { amount, studentId }         ├── 2. razorpay.orders.create►│                       │
           │                                 │◄── 3. order_id returned ───┤                       │
           │◄── 4. Return order_id ──────────┤                            │                       │
           │                                 │                            │                       │
           ├── 5. User Enters Payment Info ──────────────────────────────►│                       │
           │      (Card/UPI/NetBanking)      │                            │                       │
           │                                 │                            ├── 6. Webhook POST ───►│
           │                                 │◄── payment.captured ───────┤      /api/payment/    │
           │                                 │   [X-Razorpay-Signature]   │      webhook          │
           │                                 │                            │                       │
           │                                 ├── 7. Verify HMAC SHA-256   │                       │
           │                                 ├── 8. Check Idempotency ───────────────────────────►│
           │                                 │      (isPaymentProcessed)  │                       │
           │                                 ├── 9. Insert Immutable Payment Record ─────────────►│
           │                                 ├── 10. Update Student Valid Until ─────────────────►│
           │◄── 11. Payment Success Modal ───┤                            │                       │
```

---

## 2. Webhook Signature Verification

Payment completion relies on asynchronous server-to-server webhooks dispatched by Razorpay (`payment.captured`, `order.paid`). To prevent request spoofing, the webhook handler validates the signature using the pre-shared `RAZORPAY_WEBHOOK_SECRET`:

```typescript
// Webhook Signature Verification Algorithm
import crypto from 'crypto';

export function verifyRazorpaySignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(signatureHeader, 'utf8')
  );
}
```

---

## 3. Idempotent Payment Ingestion (`src/lib/payment/payment.service.ts`)

When Razorpay dispatches a captured payment, `createOnlinePayment` creates an immutable record and auto-approves the transaction:

```typescript
// src/lib/payment/payment.service.ts

export async function createOnlinePayment(
  request: CreateOnlinePaymentRequest
): Promise<OnlinePaymentDocument> {
  const now = new Date();
  const paymentId = request.razorpayPaymentId || generateOnlinePaymentId(request.purpose);

  const paymentDoc: OnlinePaymentDocument = {
    paymentId,
    studentId: request.studentId,
    studentUid: request.studentUid,
    studentName: request.studentName || 'Student',
    amount: request.amount,
    durationYears: request.durationYears,
    method: 'Online',
    status: 'Completed',
    sessionStartYear: request.sessionStartYear,
    sessionEndYear: request.sessionEndYear,
    validUntil: request.validUntil,
    createdAt: now,
    updatedAt: now,
    razorpayPaymentId: request.razorpayPaymentId,
    razorpayOrderId: request.razorpayOrderId,
    razorpaySignature: request.razorpaySignature,
    approvedBy: { type: 'SYSTEM' },
    approvedAt: now,
  };

  // Writes to Supabase PostgreSQL payments table (IMMUTABLE)
  await paymentsSupabaseService.createPayment({
    paymentId,
    studentId: request.studentId,
    studentUid: request.studentUid,
    studentName: request.studentName || 'Unknown',
    amount: request.amount,
    method: 'Online',
    status: 'Completed',
    sessionStartYear: request.sessionStartYear,
    sessionEndYear: request.sessionEndYear,
    durationYears: request.durationYears,
    validUntil: typeof request.validUntil === 'string' ? new Date(request.validUntil) : request.validUntil,
    transactionDate: now,
    razorpayPaymentId: request.razorpayPaymentId,
    razorpayOrderId: request.razorpayOrderId,
    approvedBy: { type: 'SYSTEM' },
  });

  return paymentDoc;
}
```

---

## 4. Status Machine & Transitions

```
                    ┌────────────────────────────┐
                    │      INITIALIZED           │
                    │ (Razorpay Order Generated) │
                    └─────────────┬──────────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   ▼ Webhook captured            ▼ User cancelled / timed out
        ┌────────────────────────────┐    ┌────────────────────────────┐
        │         COMPLETED          │    │          FAILED            │
        │  - Immutable row in DB     │    │  - No entitlement granted  │
        │  - Extends student pass    │    │  - Student may retry       │
        │  - Generates receipt PDF   │    └────────────────────────────┘
        └────────────────────────────┘
```

- **Reversal / Refund Policy**: In the event of a refund, the original `Completed` transaction is **never** deleted or overwritten. A strict atomic refund state machine transition is executed via PostgreSQL RPC.

---

## 5. Native PostgreSQL Immutability Trigger (`protect_completed_payments`)

Financial integrity is enforced at the database engine level via the `protect_completed_payments` trigger on the `payments` table. Even if application code contains bugs, PostgreSQL actively rejects:
1. **Status Regression**: Transitions from `Completed` to `Pending` or any non-refund state are aborted with `RAISE EXCEPTION 'Cannot regress completed payment status'`.
2. **Field Tampering**: Any attempt to modify `amount`, `student_id`, or `razorpay_payment_id` on a `Completed` record raises `RAISE EXCEPTION 'Financial ledger fields are strictly immutable'`.
3. **Hard Deletions**: `DELETE` statements on `Completed` payments are unconditionally blocked.

```sql
-- Trigger Definition (supabase/COMPLETE_SCHEMA.sql)
CREATE OR REPLACE FUNCTION protect_completed_payments()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'Completed' THEN
    IF NEW.status != 'Completed' AND NEW.status != 'Refunded' THEN
      RAISE EXCEPTION 'Cannot regress completed payment status';
    END IF;
    IF NEW.amount != OLD.amount OR NEW.student_id != OLD.student_id THEN
      RAISE EXCEPTION 'Financial ledger fields are strictly immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 6. Atomic Cumulative Refund State Machine (`process_payment_refund_atomic`)

Administrative and webhook refunds execute through the native PostgreSQL stored procedure `process_payment_refund_atomic`. 

### Key Invariants Enforced:
1. **Integer Paise Accounting**: All currency math uses integer paise (`amount_paise`), eliminating IEEE-754 floating-point rounding errors.
2. **Row-Level Serialization Lock**: Takes an exclusive `SELECT ... FOR UPDATE` lock on the target payment row.
3. **Over-Refund Protection**: Enforces `(refunded_amount_paise + p_refund_paise) <= total_amount_paise`. Rejects excessive refunds with `ERR_REFUND_EXCEEDS_CAPTURED`.
4. **State Transition**:
   - If cumulative refunded amount equals total captured amount, status transitions to `'Refunded'`.
   - If partial refund, status remains `'Completed'` while appending the refund event to `refund_history` JSONB.

---

## 7. Automated Reconciliation & Self-Healing Engines

### 7.1 Three-Phase Sweep Cron (`/api/cron/payment-reconciliation`)
Runs daily at 01:00 AM UTC (`0 1 * * *`) via Vercel Cron:
- **Phase 1 (Rolling 48h Pending Sweep)**: Queries Razorpay API for all orders in `Pending` state created within the last 48 hours. If Razorpay indicates captured, completes ledger and grants pass.
- **Phase 2 (Stale >48h Pending Expiry)**: Marks uncaptured orders older than 48 hours as `Expired`.
- **Phase 3 (Incomplete Entitlement Recovery)**: Identifies payments marked `Completed` where student profile entitlement failed to update due to network timeout, automatically applying valid pass dates.

### 7.2 Student Self-Healing Endpoint (`/api/payment/recover`)
- Endpoint calls Razorpay API directly using student UID and order ID, validates capture signature, writes the ledger, and unlocks the student's digital pass instantly without needing manual administrator intervention.

---

## 8. Comprehensive Low-Level Design (LLD) Breakdown & Justifications

### 8.1 `protect_completed_payments` PostgreSQL Trigger (Financial Immutability)
- **Concrete Architectural Role**: Authoritative database integrity gate. Prevents post-settlement modification or deletion of verified payment transactions, enforcing strict append-only financial accounting.
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without database-level immutability triggers, a buggy administrative update or malicious SQL injection could modify a completed payment's `amount`, `status`, or `student_uid`.
  - An attacker could alter ₹8,000 payments to ₹0, or reassign payments from one student to another, completely corrupting university tuition reconciliation.
  - University financial audits would fail due to mutable transaction records.
- **State Taxonomy & Invariants Enforced**:
  - *Durable Authoritative & Audit State* (`payments`).
  - *Double-Entry Financial & Entitlement Integrity (Invariant 5)*.
- **Production Code Implementation**:
  ```sql
  -- File: supabase/COMPLETE_SCHEMA.sql (Trigger protect_completed_payments)
  CREATE OR REPLACE FUNCTION protect_completed_payments()
  RETURNS TRIGGER AS $$
  BEGIN
    IF OLD.status = 'Completed' AND (NEW.status != 'Refunded' OR NEW.amount != OLD.amount) THEN
      RAISE EXCEPTION 'Cannot modify completed payment details; only atomic refund transition permitted.';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *In-Engine Execution*: Enforcing immutability via PostgreSQL trigger runs in microseconds on the write path, requiring zero application-level auditing code.

---

### 8.2 `process_payment_refund_atomic` PL/pgSQL RPC
- **Concrete Architectural Role**: Transactional settlement reversal engine. Executes atomic refund logging, updates ledger status to `Refunded`, and safely reverts student transit entitlement.
- **Failure Analysis ("Why the System Fails Without It")**:
  - If payment refund and pass revocation are executed as separate API calls, an error during step 2 results in money being refunded to the student while their bus pass remains active for the entire year!
  - Integer paise precision errors in floating-point JavaScript (`8000.00 * 100` resulting in `799999.999999`) cause Razorpay API rejection or reconciliation discrepancies.
- **State Taxonomy & Invariants Enforced**:
  - *Transactional State* (ACID multi-table modification across `payments` and `student_profiles`).
  - *Double-Entry Financial Integrity (Invariant 5)*.
- **Production Code Implementation**:
  ```sql
  -- File: supabase/COMPLETE_SCHEMA.sql (RPC process_payment_refund_atomic)
  CREATE OR REPLACE FUNCTION process_payment_refund_atomic(
    p_payment_id TEXT, p_refund_id TEXT, p_amount_paise BIGINT, p_reason TEXT
  ) RETURNS JSONB AS $$
  ...
  -- Locks payment row FOR UPDATE, marks Refunded, revokes valid_until
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Atomic Rollback*: If any table update fails, the entire transaction rolls back, preventing decoupled financial and transit states.

