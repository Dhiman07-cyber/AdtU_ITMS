# Financial Ledger, Offline Payments & Bus Pass Renewal Lifecycle

**Document Metadata:**
- **Domain:** Domain 12 (Payment & Ledger) & Domain 4 (Application & Seat Lifecycle)
- **Status:** Verified against Active Production Codebase (`c:\Users\ADMIN\Desktop\Projects\ITMS`)
- **Key Modules Audited:**
  - Supabase Financial Service: [`src/lib/services/payments-supabase.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/services/payments-supabase.ts)
  - Core Payment Service: [`src/lib/payment/payment.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/payment/payment.service.ts)
  - Student Validity Extension: [`src/domains/student/services/student.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/student/services/student.service.ts)
  - Application Approval & Payment Linking: [`src/domains/application/services/application.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/application/services/application.service.ts)
  - Offline Approval API: [`src/app/api/payments/approve/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payments/approve/route.ts)
  - Offline Rejection API: [`src/app/api/payments/reject/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payments/reject/route.ts)
  - Admin Reconciliation & Refund API: [`src/app/api/admin/payments/reconcile/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/admin/payments/reconcile/route.ts)
  - Student Self-Healing Endpoint: [`src/app/api/payment/recover/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/recover/route.ts)
  - Daily Sweep Cron: [`src/app/api/cron/payment-reconciliation/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/cron/payment-reconciliation/route.ts)
  - Modal UI & Actions: [`src/components/payment/PaymentDetailModal.tsx`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/components/payment/PaymentDetailModal.tsx)
  - Database Schema & RPCs: [`supabase/COMPLETE_SCHEMA.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql) & [`supabase/migrations/20261009_payment_immutability_and_preflight.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/migrations/20261009_payment_immutability_and_preflight.sql)

---

## 1. Authoritative Financial Ledger Architecture (`public.payments`)

The financial ledger in ITMS is designed as an append-only accounting ledger stored in PostgreSQL (`public.payments`). It acts as the immutable legal evidence of transportation fee settlements across Assam down town University.

### 1.1 Complete Schema Definition
```sql
-- Authoritative Schema in supabase/COMPLETE_SCHEMA.sql (Lines 397-434)
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uid TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_method TEXT,
  method TEXT,                                      -- 'Online' | 'Offline'
  status TEXT NOT NULL DEFAULT 'Pending',           -- Status machine state
  order_id TEXT,
  payment_id TEXT UNIQUE,                           -- Canonical internal ID (e.g. pay_on_... or pay_off_...)
  razorpay_payment_id TEXT,                         -- External gateway capture ID
  razorpay_order_id TEXT,                           -- External gateway order ID
  receipt_id TEXT,                                  -- Formatted receipt voucher ID
  academic_year TEXT,
  session_start_year INTEGER,                       -- Academic session start (e.g. 2026)
  session_end_year INTEGER,                         -- Academic session end (e.g. 2027)
  duration_years INTEGER,                           -- Number of academic years paid
  transaction_date TIMESTAMPTZ,                     -- Physical payment timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  student_name TEXT,                                -- AES-256-GCM encrypted
  student_id TEXT,                                  -- AES-256-GCM encrypted (Enrollment ID)
  offline_transaction_id TEXT,                      -- AES-256-GCM encrypted (Bank UTR / Challan No.)
  document_signature TEXT,                          -- HMAC SHA-256 non-repudiation seal
  approved_by JSONB,                                -- { type, userId, name, empId, role }
  approved_at TIMESTAMPTZ,
  fee_tier TEXT,
  bus_id TEXT,
  route_id TEXT,
  stop_name TEXT,
  shift TEXT,
  application_id TEXT,
  renewal_id TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,                          -- Entitlement expiry granted by this payment
  metadata JSONB                                    -- Flexible audit trail & refund history
);
```

### 1.2 Data Privacy & Cryptographic Signatures
To satisfy OWASP ASVS Chapter V8 (Data Protection) and university financial auditing standards:
1. **PII Field Encryption**: Student full names, enrollment IDs, and bank reference numbers are encrypted at rest using AES-256-GCM via [`encryptData`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/security/encryption.service.ts). Even if raw database backups are leaked, student identity and financial accounts remain protected.
2. **Cryptographic Document Signature**: Every completed payment generates an HMAC SHA-256 cryptographic seal stored in `document_signature`. This seal binds `payment_id`, `amount`, `student_uid`, `session_start_year`, `session_end_year`, and `transaction_date`. If any database administrator manually tampers with the row, signature validation immediately detects tampering.

---

## 2. PostgreSQL Immutability & Transition Guards

### Implementation: Trigger `protect_completed_payments_trigger`

Financial integrity cannot rely solely on application-layer code. The database engine actively prevents accidental or malicious data modification via `protect_completed_payments()`.

```sql
-- Migration 20261009_payment_immutability_and_preflight.sql (Lines 78-230)
CREATE OR REPLACE FUNCTION public.protect_completed_payments()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. DELETE PROTECTION: Hard block on deleting finalized records
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected') THEN
            RAISE EXCEPTION 'Cannot delete finalized or audit payment record %', OLD.payment_id;
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 2. FIELD IMMUTABILITY: Identity and financial figures can NEVER mutate
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied', 'Rejected') AND (
            NEW.amount IS DISTINCT FROM OLD.amount OR
            NEW.currency IS DISTINCT FROM OLD.currency OR
            NEW.method IS DISTINCT FROM OLD.method OR
            NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
            NEW.student_id IS DISTINCT FROM OLD.student_id OR
            NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
            NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
            NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
            NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
        ) THEN
            RAISE EXCEPTION 'Cannot mutate financial or identity fields of finalized/audit payment record %', OLD.payment_id;
        END IF;

        -- 3. STATUS TRANSITION CONSTRAINTS:
        -- Completed may ONLY transition to 'Refunded' when verified refund evidence is attached
        IF OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Refunded' THEN
                IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot refund payment without authorized actor and timestamp';
                END IF;
                IF NEW.metadata IS NULL OR (NEW.metadata->>'refund_id' IS NULL AND NEW.metadata->>'external_refund_ref' IS NULL) THEN
                    RAISE EXCEPTION 'Cannot refund payment without external refund reference';
                END IF;
            ELSE
                RAISE EXCEPTION 'Cannot mutate status of Completed payment record %: permitted transition is only to Refunded upon verified full refund', OLD.payment_id;
            END IF;
        END IF;

        -- 4. TERMINAL STATES: Refunded, Refund_Denied, and Rejected cannot be changed
        IF OLD.status IN ('Refunded', 'Refund_Denied', 'Rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Cannot mutate status of terminal payment record %', OLD.payment_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 3. Offline Payment & Approval Workflow

Many university students pay semester fees via offline bank challans, NEFT/RTGS counter deposits, or direct cash deposits at the campus finance counter.

### 3.1 The "Zero Pre-Creation" Architectural Invariant
> [!IMPORTANT]
> When a student submits an application or renewal requesting offline payment, **NO row is inserted into the `payments` table**.

**Why the system fails without this**: If user submissions created unverified `Pending` payment rows in the financial ledger, students could submit bogus challan numbers to spoof payment records, bloating financial reports with fake revenue and skewing university accounting audits. The financial ledger contains **ONLY verified financial events, not user claims**.

### 3.2 Offline Payment Life Cycle

```
[ Student Form Submission ] ──► Uploads Challan Slip & Reference ──► Saved in applications table
                                                                              │
                                                                              ▼
                                                    [ Moderator / Admin Verification Desk ]
                                                    (/admin/verification or /admin/applications/[id])
                                                                              │
                                       ┌──────────────────────────────────────┴──────────────────────────────────────┐
                                       ▼ Verified Valid Deposit                                                      ▼ Fraudulent / Invalid Deposit
                            [ POST /api/payments/approve ]                                                [ POST /api/payments/reject ]
                                       │                                                                             │
                            ├── 1. requireModeratorPermission('payments', 'canApprove')                   ├── 1. requireModeratorPermission('payments', 'canReject')
                            ├── 2. Check student.seatReleasedAt (LC-01 Guard)                             ├── 2. If row exists: UPDATE status = 'Rejected'
                            ├── 3. createOfflinePaymentAtApproval()                                       ├── 3. Emit payment_rejected audit event
                            │      - Inserts Completed row into payments table                            └── 4. Student notified to re-submit
                            ├── 4. applyPaymentValidityToStudent()
                            │      - Extends valid_until (max-of-old-and-new)
                            │      - Resets soft_block & hard_block dates
                            ├── 5. Generate HMAC-signed receipt PDF
                            └── 6. Emit payment_approved audit event
```

### 3.3 Core Code Implementation (`createOfflinePaymentAtApproval`)
```typescript
// File: src/lib/payment/payment.service.ts (Lines 772-856)
export async function createOfflinePaymentAtApproval(request: OfflineApprovalInput): Promise<OfflinePaymentDocument> {
  const paymentId = generateOfflinePaymentId(request.purpose);
  const now = new Date();

  const paymentDoc: OfflinePaymentDocument = {
    paymentId,
    studentId: request.studentId,
    studentUid: request.studentUid,
    studentName: request.studentName,
    amount: request.amount,
    durationYears: request.durationYears,
    method: 'Offline',
    status: 'Completed',
    sessionStartYear: request.sessionStartYear,
    sessionEndYear: request.sessionEndYear,
    validUntil: request.validUntil,
    createdAt: now,
    updatedAt: now,
    offlineTransactionId: request.transactionId,
    approvedBy: {
      type: 'Manual',
      userId: request.approverUserId,
      name: request.approverName,
      empId: request.approverEmpId,
      role: request.approverRole,
    },
    approvedAt: now,
  };

  await paymentsSupabaseService.createPayment({
    paymentId,
    studentId: request.studentId,
    studentUid: request.studentUid,
    studentName: request.studentName,
    amount: request.amount,
    method: 'Offline',
    status: 'Completed',
    sessionStartYear: request.sessionStartYear,
    sessionEndYear: request.sessionEndYear,
    durationYears: request.durationYears,
    validUntil: new Date(request.validUntil),
    transactionDate: request.paidAt,
    offlineTransactionId: request.transactionId,
    approvedBy: paymentDoc.approvedBy,
    approvedAt: now,
  });

  return paymentDoc;
}
```

---

## 4. Student Transit Entitlement & Bus Pass Math

### 4.1 Bus Pass Validity Ledger in `student_profiles`
Each enrolled commuter profile maintains exact entitlement timestamps that govern boarding access:

| Column | Type | Business Logic & Boarding Enforcement |
|---|---|---|
| `valid_until` | `TIMESTAMPTZ` | The date through which transportation fees are paid in full (anchored to June 30 of expiration year). |
| `soft_block` | `TIMESTAMPTZ` | Grace period threshold (typically 15–30 days past `valid_until`). Driver scanner alerts student to renew, but still permits boarding. |
| `hard_block` | `TIMESTAMPTZ` | Absolute cutoff date. Driver boarding scanner displays red `DENIED` and strictly blocks vehicle entry. |
| `seat_released_at` | `TIMESTAMPTZ` | Timestamp when physical bus seating was relinquished back to open university quota due to non-renewal. |

### 4.2 The Canonical "Max-of-Old-and-New" Rule
When calculating validity on renewal, naive systems often execute `validUntil = now + duration`. This causes catastrophic loss of days: if a student renews 2 months before their pass expires, they lose 60 days of already-paid transit!

```typescript
// Implementation in src/domains/student/services/student.service.ts (Lines 93-104)
const newValidUntil = payment.valid_until ? new Date(payment.valid_until) : null;
const existingValidUntil = (student as any).validUntil ? new Date((student as any).validUntil) : null;

// Invariant: older payment cannot overwrite newer validity
const finalValidUntil = (existingValidUntil && newValidUntil && existingValidUntil > newValidUntil)
  ? existingValidUntil
  : newValidUntil;

const finalSessionEndYear = ((student as any).sessionEndYear && payment.session_end_year && (student as any).sessionEndYear > payment.session_end_year)
  ? (student as any).sessionEndYear
  : payment.session_end_year;
```

### 4.3 LC-01 Guard: Preventing Over-Allocation of Released Seats
```typescript
// Guard in src/domains/student/services/student.service.ts (Lines 73-91)
if ((student as any).seatReleasedAt) {
  console.error(`[applyPaymentValidity] Refused to reactivate ${studentUid}: seat was released`);
  throw new SeatReclaimRequiredError(studentUid, String((student as any).seatReleasedAt));
}
```
**Why this guard is critical**: If a student entered soft-block months ago, their seat was returned to the open bus pool and assigned to another commuter. If offline payment approval directly reactivated the student via `applyPaymentValidity()`, the student would board the bus, resulting in **51 students occupying a 50-seater vehicle**. The system requires seat-released students to be processed through the atomic seat reclamation RPC ([`approve_renewal_with_seat`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql#L2161)).

---

## 5. Atomic Seat Reclamation (`approve_renewal_with_seat`)

When approving renewals where seat reclamation is necessary, PostgreSQL executes the atomic stored procedure `approve_renewal_with_seat`.

### Key ACID Invariants Enforced:
1. **Row-Level Serialization Lock**: Executes `SELECT capacity, morning_load, evening_load FROM buses WHERE id = p_bus_id FOR UPDATE;`. No other concurrent student application or renewal can modify this bus until the transaction finishes.
2. **Quota Barrier**: Evaluates `load >= capacity`. If full, immediately rolls back with error `BUS_CAPACITY_FULL`.
3. **Atomic Multi-Table Mutation**:
   - Increments vehicle load counter in `buses`.
   - Clears `seat_released_at` and updates `valid_until`, `soft_block`, `hard_block`, and `status = 'active'` in `student_profiles`.
   - Transitions `applications` record to `approved`.
4. **Zero Distributed 2PC**: All changes commit or abort in a single database transaction, completely eliminating partial allocations.

---

## 6. Atomic Cumulative Refund State Machine (`process_payment_refund_atomic`)

### Implementation: [`supabase/migrations/20261009_payment_immutability_and_preflight.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/migrations/20261009_payment_immutability_and_preflight.sql) (Lines 267–453)

Administrative refunds and gateway webhook refunds execute via `process_payment_refund_atomic`.

```sql
CREATE OR REPLACE FUNCTION public.process_payment_refund_atomic(
    p_payment_id TEXT,
    p_refund_id TEXT,
    p_amount_paise BIGINT,
    p_authorized_by JSONB,
    p_reason TEXT DEFAULT 'Processed refund'
) RETURNS JSONB AS $$
DECLARE
    v_payment RECORD;
    v_original_paise BIGINT;
    v_new_cumulative_paise BIGINT;
    v_is_fully_refunded BOOLEAN;
BEGIN
    -- 1. Exclusive row-level lock on target payment
    SELECT * INTO v_payment FROM public.payments WHERE payment_id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
    END IF;

    -- 2. Prevent over-refunding
    v_original_paise := ROUND(COALESCE(v_payment.amount, 0) * 100)::BIGINT;
    v_new_cumulative_paise := v_other_refunded_paise + p_amount_paise;
    IF v_new_cumulative_paise > v_original_paise THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cumulative refund cannot exceed original amount');
    END IF;

    -- 3. Transition check: Full vs Partial
    v_is_fully_refunded := (v_new_cumulative_paise >= v_original_paise);
    IF v_is_fully_refunded THEN
        UPDATE public.payments
        SET status = 'Refunded', approved_by = p_authorized_by, approved_at = clock_timestamp(), metadata = v_updated_metadata
        WHERE payment_id = p_payment_id;
    ELSE
        -- Partial refund: retain status as Completed, append to refund_history
        UPDATE public.payments SET metadata = v_updated_metadata WHERE payment_id = p_payment_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'is_partial', NOT v_is_fully_refunded);
END;
$$ LANGUAGE plpgsql;
```

---

## 7. Self-Healing & Background Reconciliation Engines

Distributed networks inevitably experience interrupted connections. ITMS maintains two self-healing mechanisms to guarantee convergence:

### 7.1 Student Self-Healing Endpoint (`/api/payment/recover`)
When a student returns to their dashboard after a payment that failed to redirect:
- **Upstash Redis Rate Throttle**: Checks key `payment-recovery:${uid}` with a 15-second TTL (`RECOVERY_THROTTLE_SECONDS`). Prevents students from hammering the Razorpay API during payment processing.
- **Strict Anti-IDOR Ownership**: Verifies that the student owns the requested payment and order IDs.
- **Direct Gateway Query with Timeout**: Calls `fetchOrderPayments(orderId)` with a 6,000ms timeout (`RAZORPAY_TIMEOUT_MS`).
- **Instant Digital Pass Unlock**: If Razorpay reports `captured`, runs `processCapturedPayment`, inserts the ledger row, extends validity, and restores pass access immediately without filing support tickets.

### 7.2 Three-Phase Nightly Sweep Cron (`/api/cron/payment-reconciliation`)
Configured in `vercel.json` to execute daily at 01:00 AM UTC (`0 1 * * *`):
- **Concurrency Guard**: `isSweepRunning` with a 5-minute timeout prevents overlapping cron runs.
- **Phase 1 (Rolling 0–48h Window)**: Queries all `Pending` orders created in the last 48 hours. If Razorpay indicates captured, completes ledger and activates bus pass.
- **Phase 2 (Stale >48h Pending Orders)**: Sweeps orders older than 48 hours (batch of 50) to ensure no stranded funds remain un-audited.
- **Phase 3 (Entitlement Durability Recovery)**: Queries `Completed` payments from the last 72 hours where `metadata.entitlement_status != 'active'`. Acquires a distributed lease via `claimPaymentForEntitlementRecovery` and retries student validity extension.
