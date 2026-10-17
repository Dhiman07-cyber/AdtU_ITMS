# Financial Ledger & Bus Pass Renewal Lifecycle

## 1. Bus Pass Validity & Entitlement Model

Bus pass access in ITMS is governed by an academic calendar ledger. Each enrolled student record in `student_profiles` carries explicit entitlement timestamps:

| Column | Data Type | Business Meaning |
| :--- | :--- | :--- |
| `valid_until` | `TIMESTAMPTZ` | The date through which transportation fees are paid in full. |
| `soft_block` | `TIMESTAMPTZ` | Grace period threshold. When passed, student receives warnings on pass scan but may still board. |
| `hard_block` | `TIMESTAMPTZ` | Absolute cutoff date. When passed, driver boarding scanner displays `DENIED` and blocks vehicle entry. |
| `session_start_year` | `INTEGER` | Academic year start (e.g. `2026`). |
| `session_end_year` | `INTEGER` | Academic year end (e.g. `2027`). |

---

## 2. Pass Renewal Workflow

```
[ Active Student ] ──► [ Approaching Expiry ] ──► [ Soft Block Window ] ──► [ Hard Block / Inactive ]
 (valid_until > now)     (Notification dispatched) (Grace period active)       (Boarding Denied)
                                │
                                ▼ Student clicks /student/renew
                       +─────────────────────────────────+
                       | Payment Checkout / Offline Slip |
                       +────────────────┬────────────────+
                                        │
                         ┌──────────────┴──────────────┐
                         ▼ Online Razorpay             ▼ Offline Bank Deposit
               [ Webhook Auto-Approval ]     [ Moderator Review & Approval ]
                         │                             │
                         └──────────────┬──────────────┘
                                        ▼
                       +─────────────────────────────────+
                       | applyPaymentValidity()          |
                       | - valid_until extended to next  |
                       |   academic session end date     |
                       | - soft/hard blocks reset        |
                       | - Digitally signed receipt      |
                       +─────────────────────────────────+
```

---

## 3. Offline Payment & Moderator Ledger Approval

For students who pay tuition or transport fees via offline bank challans, moderators or financial administrators review the deposit receipt before granting entitlement:

```typescript
// src/lib/payment/payment.service.ts

export async function approveOfflinePayment(
  paymentId: string,
  approverInfo: { userId: string; name: string; empId?: string; role: string }
): Promise<boolean> {
  const supabase = getSupabaseServer();

  // 1. Fetch payment record
  const payment = await paymentsSupabaseService.getPaymentById(paymentId);
  if (!payment || payment.status !== 'Pending') {
    throw new Error('Payment not found or already processed');
  }

  // 2. Compute academic validity dates
  const newValidUntil = calculateValidUntilDate(
    payment.sessionEndYear || new Date().getFullYear() + 1
  );

  // 3. Update payment status to Completed (IMMUTABLE record updated in place)
  await paymentsSupabaseService.updatePaymentStatus(paymentId, 'Completed', {
    ...approverInfo,
    approvedAt: new Date(),
  });

  // 4. Update student profile with new validity
  await applyPaymentValidity(payment.studentUid, {
    validUntil: newValidUntil,
    sessionStartYear: payment.sessionStartYear,
    sessionEndYear: payment.sessionEndYear,
  });

  return true;
}
```

---

## 4. Automated Expiry & Scheduled Jobs

Transportation validity is monitored by automated Vercel Cron routes configured in [`vercel.json`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/vercel.json):

1. `/api/cron/expiry-check?type=main`:
   - Runs on the 1st of March, April, and June.
   - Evaluates upcoming graduations and semester transitions.
   - Dispatches FCM push notifications and emails alerting students to renew.
2. `/api/cron/cleanup-expired-students`:
   - Runs daily at midnight.
   - Identifies students past their `hard_block` threshold and updates status from `active` to `expired`.
3. `/api/cron/session-activation`:
   - Activates upcoming academic sessions, transitioning verified renewal applications into the active student roster.

---

## 5. Renewal Concurrency & Capacity Atomicity

### 5.1 Partial Unique Index on Active Applications
To eliminate duplicate renewal applications and race conditions during high-volume registration:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_active_student_session 
ON applications (applicant_uid, session_start_year) 
WHERE state NOT IN ('rejected', 'cancelled', 'expired');
```
This partial index guarantees at the PostgreSQL engine level that a student can have at most one active application per academic session. Concurrent payment callbacks or duplicate user submissions attempting to create a second application immediately encounter a unique constraint violation and abort safely.

### 5.2 Atomic Renewal Seat Assignment (`approve_renewal_with_seat`)
When approving a student renewal that reclaims bus seating capacity after a soft block:
- RPC `approve_renewal_with_seat` locks the student profile and bus row atomically with `FOR UPDATE`.
- Re-checks remaining bus capacity against current shift load (`morning_load` / `evening_load`).
- Increments occupied seats, extends `valid_until`, resets soft/hard block dates, and transitions application state to `approved` in a single ACID PostgreSQL transaction.
- If capacity is exceeded or any step fails, the entire transaction rolls back, preserving original student validity and seat counts without partial side effects.

---

## 6. Comprehensive Low-Level Design (LLD) Breakdown & Justifications

### 6.1 `src/lib/payment/payment.service.ts` & `applyPaymentValidity` (Entitlement Extension)
- **Concrete Architectural Role**: Authoritative business logic bridging financial settlement with student transit access. Computes academic session boundaries, resets grace-period and block cutoffs, and issues digitally verifiable transit passes.
- **Failure Analysis ("Why the System Fails Without It")**:
  - If renewal simply adds +365 days from the current date, a student renewing 1 month early loses their remaining month of validity!
  - `applyPaymentValidity` enforces the canonical **max-of-old-and-new** invariant: `validUntil = max(existingValidUntil, newValidUntil)`, ensuring early payers retain all accumulated days.
  - Without resetting `soft_block` and `hard_block` timestamps on renewal, a student who paid their fees would still have their boarding pass blocked by driver scanners the following morning.
- **State Taxonomy & Invariants Enforced**:
  - *Durable Authoritative State* (`student_profiles`).
  - *Double-Entry Financial & Entitlement Integrity (Invariant 5)*.
- **Production Code Implementation**:
  ```typescript
  // File: src/lib/payment/payment.service.ts (lines 65-80)
  const newValidUntil = calculateValidUntilDate(payment.sessionEndYear || new Date().getFullYear() + 1);

  await paymentsSupabaseService.updatePaymentStatus(paymentId, 'Completed', {
    ...approverInfo,
    approvedAt: new Date(),
  });

  await applyPaymentValidity(payment.studentUid, {
    validUntil: newValidUntil,
    sessionStartYear: payment.sessionStartYear,
    sessionEndYear: payment.sessionEndYear,
  });
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Single Write Step*: Computes all derived dates in memory before issuing a single consolidated `UPDATE student_profiles` statement, eliminating multi-stage database locks.

---

### 6.2 Partial Unique Index `idx_applications_active_student_session`
- **Concrete Architectural Role**: Engine-level duplicate submission barrier. Guarantees that a student cannot have multiple concurrent active applications for the same academic session.
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without engine-level constraints, if a student opens two browser tabs or double-clicks "Submit Renewal", two applications enter the queue.
  - When moderators approve both, vehicle capacity is incremented twice for the same student (`morning_load = 51 / 50`), overbooking the bus and stealing a seat from another commuter.
- **State Taxonomy & Invariants Enforced**:
  - *Transactional State* (`applications`).
  - *Seat & Capacity Non-Overbooking Guarantee*.
- **Production Code Implementation**:
  ```sql
  -- File: supabase/COMPLETE_SCHEMA.sql (Partial Unique Index)
  CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_active_student_session 
  ON applications (applicant_uid, session_start_year) 
  WHERE state NOT IN ('rejected', 'cancelled', 'expired');
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Partial Index Efficiency*: Only indexes active applications, keeping the B-tree tiny (<100KB) and indexing overhead negligible, while ignoring historical rejected/expired records.

---

### 6.3 `approve_renewal_with_seat` PL/pgSQL RPC
- **Concrete Architectural Role**: Atomic quota re-allocation for students whose seats were previously released during a soft-block period.
- **Failure Analysis ("Why the System Fails Without It")**:
  - When a student enters soft-block, their seat is surrendered back to the open pool.
  - If they renew weeks later, the bus may now be 100% full.
  - If renewal approval does not lock the `buses` row with `FOR UPDATE` before checking capacity, two students renewing at the same second could both claim the final remaining seat, causing vehicle overload.
- **State Taxonomy & Invariants Enforced**:
  - *Transactional State* (ACID check & update on `buses` and `student_profiles`).
  - *Non-Overbooking Invariant*.
- **Production Code Implementation**:
  ```sql
  -- File: supabase/COMPLETE_SCHEMA.sql (RPC approve_renewal_with_seat)
  SELECT capacity, morning_load, evening_load INTO v_bus
  FROM buses WHERE id = p_bus_id FOR UPDATE;

  IF (p_shift = 'Morning' AND v_bus.morning_load >= v_bus.capacity) OR
     (p_shift = 'Evening' AND v_bus.evening_load >= v_bus.capacity) THEN
    RETURN jsonb_build_object('success', false, 'error', 'BUS_CAPACITY_FULL');
  END IF;

  -- Atomic seat allocation and status reset
  UPDATE buses SET ... WHERE id = p_bus_id;
  UPDATE student_profiles SET status = 'active', valid_until = p_new_valid_until WHERE uid = p_student_uid;
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Zero Distributed 2PC*: By collocating bus counters and student profile updates in a single PostgreSQL database with row-level locks, distributed two-phase commit overhead is completely avoided.

