# D8 Production Audit — 10 Required Concerns

## 1. Student.applyRenewal() — Explicit Contract

**File:** `src/domains/student/services/student.service.ts`

```typescript
/**
 * Apply renewal to a student. OWNERS: all student mutations below.
 * Application domain orchestrates but NEVER calculates these values.
 *
 * @param studentUid - student UID (primary key)
 * @param renewalDetails - from Application payload (validated, not computed)
 * @returns updated student (or null if student not found)
 *
 * IDEMPOTENT: calling twice with the same renewalDetails is safe.
 *   - validUntil = max(existing, calculated) — no double-extend
 *   - sessionEndYear = max(existing, calculated) — no double-extend
 *   - durationYears = existing + renewalYears — no double-add
 *   - blockDates recomputed from final validUntil — deterministic
 *   - status set to 'active' — idempotent
 *   - seatReleasedAt cleared if seatWasReleased — idempotent (null → null)
 */
export async function applyRenewal(
  studentUid: string,
  renewalDetails: {
    durationYears: number;        // from form_data.sessionInfo.durationYears
    totalFee: number;             // from form_data.sessionInfo.totalFee
    seatWasReleased: boolean;     // from wasSeatReleased(studentData)
    deadlineConfig: DeadlineConfig;
  }
): Promise<Student | null>
```

**What Student.applyRenewal() owns (ALL of these, nothing less):**

1. Validate student exists (read current student)
2. Calculate new validUntil: `max(currentValidUntil, calculateValidUntilDate(baseYear, durationYears, config))`
3. Calculate new sessionEndYear: `max(currentSessionEndYear, baseYear + durationYears)`
4. Calculate new durationYears: `currentDuration + renewalDetails.durationYears`
5. Calculate block dates: `computeBlockDatesFromValidUntil(newValidUntil, config)`
6. Determine status: always `'active'` for renewal
7. Clear seatReleasedAt if seatWasReleased
8. Set lastRenewalDate = NOW()
9. Set updatedAt = NOW()
10. Persist atomically (single PG UPDATE)
11. Return updated student

**What Student does NOT own:**
- Bus capacity (Seat domain)
- Payment (Payment domain)
- Application state (Application domain)
- Audit log (Audit domain)
- Notifications (Notification domain)

---

## 2. Bus Capacity Orchestration — Seat Domain owns Bus state

**Existing Seat domain API (already implemented):**

```typescript
// src/domains/seat/index.ts
export { getCapacity, assignSeat, releaseSeat } from './services/seat-assignment.service';
```

```typescript
// src/domains/seat/services/seat-assignment.service.ts
export async function getCapacity(busId: string, shift?: string)
export async function assignSeat(busId: string, studentUid: string, shift?: string): Promise<void>
export async function releaseSeat(busId: string, studentUid: string, shift?: string): Promise<void>
```

**Correct orchestration flow:**

```
Application.approve(renewalApplication)
  ↓
  approve_application() RPC → validate + lock + payload
  ↓
  Switch on applicationType:
  ─── 'renewal' / 'renewal_after_soft_block' ───
  │
  │  // 1. Bus: check capacity (pre-flight, not transactional)
  │  const bus = await Seat.getCapacity(busId, shift)
  │  if (bus.shiftLoad >= bus.capacity) → 409
  │
  │  // 2. Student: apply renewal (PG transaction, idempotent)
  │  const updatedStudent = await Student.applyRenewal(studentUid, { ... })
  │
  │  // 3. Bus: reserve seat (Firestore transaction, idempotent)
  │  //    ONLY if seatWasReleased (student had seat decremented at soft block)
  │  if (seatWasReleased) {
  │    await Seat.assignSeat(busId, studentUid, shift)
  │  }
  │
  │  // 4. Payment: ensure payment exists (idempotent)
  │  if (paymentMode === 'online') {
  │    // payment already recorded by webhook — no-op
  │  } else {
  │    await Payment.createOfflinePaymentAtApproval({ ... purpose: 'renewal' })
  │  }
  │
  │  // 5. Audit, Notification, Email, Cloudinary (non-critical, post-commit)
  │  await Promise.allSettled([audit, notification, email, cloudinary])
  │
  │  // 6. Finalize: set state = 'approved', clear lock
  │  await Application.finalizeApplicationState(applicationId, approverUid)
  │
  ─── 'fresh' / 'future' ───
  │
  │  // Identity: activate student (unchanged)
  │  await Identity.activateStudent(...)
  │  // Payment: create record (unchanged)
  │  // Audit, Notification, Email (unchanged)
  │  // Finalize: delete row (unchanged)
  │  await Application.finalizeApplicationApproval(applicationId, approverUid)
```

**Key principle:** Application orchestrates. Seat owns bus state. Student owns student state. Payment owns payment state.

---

## 3. Failure/Rollback Matrix — Bus + Student Consistency

**Scenario 1: Seat.assignSeat() fails AFTER Student.applyRenewal() succeeds**

```
Student.applyRenewal()  →  PG UPDATE succeeds  (student is now 'active', validUntil extended)
Seat.assignSeat()       →  Firestore transaction fails (bus not found / capacity race)
```

**Resolution:** Compensation — call `Student补偿(studentUid)` to revert:
- Set student back to `status = 'pending_renewal'` (or previous status)
- Restore previous validUntil, sessionEndYear, durationYears
- Restore previous softBlock/hardBlock

**BUT:** This is complex. Better approach: **check capacity BEFORE student update** (pre-flight). The current approve-v2 already does this. The flow is:

```
1. Pre-flight: Seat.getCapacity() — reject if full (before any mutation)
2. Student.applyRenewal() — PG transaction
3. Seat.assignSeat() — Firestore transaction (post-student, compensation on failure)
```

If step 3 fails, compensation reverts step 2. The lease ensures only one attempt.

**Scenario 2: Student.applyRenewal() fails AFTER Seat.assignSeat() succeeds**

```
Seat.assignSeat()      →  Firestore transaction succeeds (bus capacity incremented)
Student.applyRenewal() →  PG UPDATE fails (student not found / constraint violation)
```

**Resolution:** This should NOT happen because seat is assigned AFTER student update. The order is:
1. Student first (PG)
2. Bus second (Firestore)

If bus succeeds but student fails, we need compensation — call `Seat.releaseSeat()`. But since student is authoritative and bus is derived, we prefer the student-first order.

**Scenario 3: Payment fails AFTER Student + Seat both succeed**

```
Student.applyRenewal()  →  succeeds
Seat.assignSeat()       →  succeeds
Payment.createOffline() →  fails
```

**Resolution:** Payment is non-critical for the approval itself. The student is already renewed. Payment can be retried later. The application stays in `state = 'processing'` until payment + finalization complete. The lease expires after 5 minutes, and the cron reclaims the lock. The approval can be retried.

**Scenario 4: Network timeout between Student and Seat**

```
Student.applyRenewal()  →  PG UPDATE succeeds
[NETWORK TIMEOUT]
Seat.assignSeat()       →  never called
```

**Resolution:** The lease on the application is held. When the lease expires (5 minutes), the cron reclaims it. The application can be retried. On retry, `Student.applyRenewal()` is idempotent (same inputs → same outputs), so the student state is stable. Then `Seat.assignSeat()` is called.

**Compensation table:**

| Failure point | Compensation | Idempotent retry? |
|--------------|-------------|-------------------|
| Student fails, Bus not called | No compensation needed | Yes, retry |
| Bus fails after Student | `Student补偿()` revert student | Yes, retry |
| Payment fails after Student+Bus | No compensation needed | Yes, retry |
| Finalize fails after all | Lease expires, retry from start | Yes, retry |
| Network timeout mid-flow | Lease expires, retry from start | Yes, retry |

---

## 4. Payment Orchestration — Explicit Online/Offline Flow

```typescript
// In Application.approve() for renewal:
if (applicationType === 'renewal' || applicationType === 'renewal_after_soft_block') {
  // ... student + bus updates ...

  // Payment
  const paymentMode = payload.form_data?.paymentInfo?.paymentMode;
  if (paymentMode === 'online') {
    // ONLINE: payment already recorded by Razorpay webhook / verify-payment
    // No action needed. The payment row exists with status='Completed'.
    // IDEMPOTENT: calling this for online renewal is a no-op.
  } else {
    // OFFLINE: create payment record AT APPROVAL TIME
    // IDEMPOTENT: createOfflinePaymentAtApproval checks for existing record
    await createOfflinePaymentAtApproval({
      studentId: enrollmentId,
      studentUid: studentId,
      studentName,
      amount: totalFee,
      durationYears,
      sessionStartYear,
      sessionEndYear,
      validUntil,
      transactionId,
      paidAt,
      receipt,
      approverUserId,
      approverName,
      approverEmpId,
      approverRole,
      purpose: 'renewal',
    });
  }
}
```

**Contract:**
- Online: ensure payment exists (no-op if already recorded)
- Offline: create payment record (idempotent — checks for existing)
- Never duplicate
- Always idempotent

---

## 5. Student.applyRenewal() Idempotency — Detailed Analysis

**Current approve-v2 code (Firestore):**
```typescript
const txValidUntil = calculateValidUntilDate(freshBaseYear, durationYears, deadlineConfig);
const finalTxValidUntil = (freshValidUntil && freshValidUntil > txValidUntil) ? freshValidUntil : txValidUntil;
const txSessionEndYear = freshBaseYear + durationYears;
const finalTxSessionEndYear = (freshStudentData.sessionEndYear && freshStudentData.sessionEndYear > txSessionEndYear) ? freshStudentData.sessionEndYear : txSessionEndYear;
const totalDuration = (freshStudentData.durationYears || 0) + durationYears;
```

**Problem:** If called twice with `durationYears = 2`:
- First call: `totalDuration = 0 + 2 = 2`
- Second call: `totalDuration = 2 + 2 = 4` ← WRONG

**Fix:** `applyRenewal()` must track what was ALREADY applied. Options:

**Option A (recommended):** Read current student, compute delta from CURRENT state:
```typescript
// In Student.applyRenewal():
const current = await getStudent(studentUid);
const newValidUntil = max(current.validUntil, calculateValidUntilDate(baseYear, durationYears, config));
const newDuration = (current.durationYears || 0) + durationYears;
// ... if called twice, the second call sees the updated values and produces same result
```

Wait — this is still additive. Second call: `newDuration = 2 + 2 = 4`.

**Option B:** Make renewal idempotent by tracking the application:
```typescript
// In Student.applyRenewal():
const current = await getStudent(studentUid);
// If student already renewed for this application, return current student
if (current.lastApplicationId === applicationId) {
  return current; // already applied, no-op
}
// ... apply renewal ...
await updateStudent(studentUid, { ..., lastApplicationId: applicationId });
```

**This is the correct approach.** The Application ID is the idempotency key.

**Revised contract:**
```typescript
export async function applyRenewal(
  studentUid: string,
  renewalDetails: {
    applicationId: string;         // IDEMPOTENCY KEY
    durationYears: number;
    totalFee: number;
    seatWasReleased: boolean;
    deadlineConfig: DeadlineConfig;
  }
): Promise<Student | null>
```

If `student.lastApplicationId === renewalDetails.applicationId`, return current student (no-op).
Otherwise, apply renewal and set `lastApplicationId = renewalDetails.applicationId`.

---

## 6. Concurrency Audit — Double-Approve

**Scenario:** Two moderators approve the same renewal simultaneously.

**Lease mechanism:**
1. Moderator A calls `approve_application(appId, moderatorA_uid)` → RPC acquires lease (processing_lock = moderatorA, expires in 5 min)
2. Moderator B calls `approve_application(appId, moderatorB_uid)` → RPC returns `success: false` (lock held by moderatorA, not expired)

**Result:** Only one approval proceeds. The other gets 409.

**Post-lease:**
- `Student.applyRenewal()` — idempotent via `lastApplicationId` check
- `Seat.assignSeat()` — Firestore transaction is atomic (capacity check + increment)
- `Payment.createOfflinePaymentAtApproval()` — idempotent (checks for existing record)

**Verdict:** Concurrency is handled by lease + idempotency. No double-apply possible.

---

## 7. Rejection Parity Audit

### Existing approve-v2 flow (approval):

| Side effect | Owner | Atomic? | Idempotent? |
|------------|-------|---------|-------------|
| Read renewal request | Application | ✓ | ✓ |
| Capacity check | Bus/Seat | ✓ | ✓ |
| Student update (10 fields) | Student | ✓ | ⚠️ Additive (not idempotent without lastApplicationId) |
| Bus capacity increment | Seat | ✓ | ✓ |
| Application status update | Application | ✓ | ✓ |
| Payment (offline create) | Payment | ✓ | ✓ |
| Audit log | Audit | ✓ | ✓ |
| Notification (Firestore) | Notification | ✗ (post-commit) | ✓ |
| Email (background) | Notification | ✗ (post-commit) | ✓ |
| Cloudinary cleanup | Infrastructure | ✗ (post-commit) | ✓ |

### Existing reject flow (rejection):

| Side effect | Owner | Atomic? | Idempotent? |
|------------|-------|---------|-------------|
| Read renewal request | Application | ✓ | ✓ |
| Delete renewal request | Application | ✓ | ✓ |
| Audit log (in-transaction) | Audit | ✓ | ✓ |
| Payment status update (post-commit) | Payment | ✗ | ✓ |
| Email (post-commit) | Notification | ✗ | ✓ |
| Cloudinary cleanup (post-commit) | Infrastructure | ✗ | ✓ |

### New rejection flow (Application.rejectApplication):

| Side effect | Owner | Atomic? | Idempotent? |
|------------|-------|---------|-------------|
| Validate + acquire lease | Application (RPC) | ✓ | ✓ |
| Set state = 'rejected' | Application (RPC) | ✓ | ✓ |
| Clear lock | Application (RPC) | ✓ | ✓ |
| Payment status update (post-commit) | Payment | ✗ | ✓ |
| Audit log (post-commit) | Audit | ✗ | ✓ |
| Email (post-commit) | Notification | ✗ | ✓ |
| Cloudinary cleanup (post-commit) | Infrastructure | ✗ | ✓ |

**Key differences from existing rejection:**
1. Application is NOT deleted — stays as `state = 'rejected'` for audit trail
2. No student mutation on rejection (student stays as-is)
3. No bus capacity change on rejection
4. Payment status update is non-critical (post-commit)

**Parity achieved?** Yes — all rejection side effects are accounted for. The application record is preserved (not deleted) in the new flow, which is an improvement for audit trail.

---

## 8. finalize_application_state() — Exact Contract

**File:** `supabase/migrations/20260709_d8_renewal_to_application.sql`

```sql
CREATE OR REPLACE FUNCTION finalize_application_state(
  p_application_id TEXT,
  p_approver_uid TEXT
)
RETURNS JSONB
LANGUAGE plplsql
AS $$
DECLARE
  v_updated INTEGER;
  v_exists BOOLEAN;
BEGIN
  -- 1. Verify lease + transition state + clear lock (ATOMIC)
  UPDATE applications
  SET state = 'approved',
      processing_lock = NULL,
      processing_started_at = NULL,
      processing_lease_expires_at = NULL,
      processing_result = 'approved',
      processing_completed_at = NOW(),
      approved_at = NOW(),
      approved_by = p_approver_uid,
      updated_at = NOW(),
      state_history = COALESCE(state_history, '[]'::jsonb) ||
        jsonb_build_object('state', 'approved', 'timestamp', NOW()::text, 'actor', p_approver_uid)
  WHERE application_id = p_application_id
    AND processing_lock = p_approver_uid
    AND processing_lease_expires_at > NOW()
    AND state = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 2. Success
  IF v_updated = 1 THEN
    RETURN jsonb_build_object(
      'success', true,
      'finalized', true,
      'already_finalized', false,
      'application_id', p_application_id
    );
  END IF;

  -- 3. Determine why 0 rows updated
  SELECT EXISTS(
    SELECT 1 FROM applications WHERE application_id = p_application_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    -- Row doesn't exist — shouldn't happen for renewal (we preserve), but handle gracefully
    RETURN jsonb_build_object(
      'success', true,
      'finalized', false,
      'already_finalized', true,
      'application_id', p_application_id
    );
  END IF;

  -- 4. Row exists — check if already approved (idempotent)
  IF EXISTS(SELECT 1 FROM applications WHERE application_id = p_application_id AND state = 'approved') THEN
    RETURN jsonb_build_object(
      'success', true,
      'finalized', false,
      'already_finalized', true,
      'application_id', p_application_id
    );
  END IF;

  -- 5. Lease check failed
  RETURN jsonb_build_object(
    'success', false,
    'status', 409,
    'error', 'Invalid or expired processing lease'
  );
END;
$$;
```

**Contract:**
1. Verify lease (processing_lock = p_approver_uid AND not expired)
2. Verify current state = 'processing' (set by approve_application)
3. Transition state to 'approved'
4. Clear lock (processing_lock, processing_started_at, processing_lease_expires_at)
5. Set processing_result = 'approved', processing_completed_at = NOW()
6. Append state_history entry
7. Update updated_at
8. Return idempotent result (already_finalized if state already 'approved')

---

## 9. Should approve_application() validate application_type?

**Current approve_application() RPC:**
- Validates state = 'submitted'
- Acquires lease
- Returns payload

**It does NOT validate application_type.** The TypeScript service layer reads `application_type` from the payload and branches.

**Recommendation:** Keep it generic. The RPC's job is:
1. Validate state
2. Acquire lease
3. Return payload

Application-type-specific logic (capacity check, student update, identity activation) stays in TypeScript. This follows the D4 design rule: "Each RPC writes only to its own domain's tables. Cross-domain writes happen via separate RPCs called by the TypeScript service layer."

**The approve() method in ApplicationService does:**
```typescript
// 1. RPC: validate + lock + payload (generic)
const result = await approveApplication(applicationId, approverUid);

// 2. Branch on applicationType (TypeScript)
switch (payload.application_type) {
  case 'fresh':
  case 'future':
    // Identity + finalize_application_approval (delete)
    break;
  case 'renewal':
  case 'renewal_after_soft_block':
    // Seat + Student + Payment + finalize_application_state (preserve)
    break;
}
```

---

## 10. Workflow Parity Matrix — Every Side Effect Mapped

### Approval Flow

| Existing approve-v2 step | New owner | Atomic? | Idempotent? | Retry-safe? |
|--------------------------|-----------|---------|-------------|-------------|
| Read renewal request | Application (RPC payload) | ✓ | ✓ | ✓ |
| Validate status = 'pending' | Application (RPC: state = 'submitted') | ✓ | ✓ | ✓ |
| Acquire processing lock | Application (RPC: lease) | ✓ | ✓ | ✓ |
| Pre-check bus capacity | Seat.getCapacity() | ✓ | ✓ | ✓ |
| Read student | Student.getByUid() | ✓ | ✓ | ✓ |
| Calculate validUntil | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Calculate sessionEndYear | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Calculate durationYears | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Calculate blockDates | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Determine status | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Clear seatReleasedAt | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Persist student update | Student.applyRenewal() (PG) | ✓ | ✓ (lastApplicationId) | ✓ |
| Atomic bus capacity increment | Seat.assignSeat() (Firestore txn) | ✓ | ✓ | ✓ |
| Create offline payment | Payment.createOfflinePaymentAtApproval() | ✓ | ✓ | ✓ |
| Audit log | Audit (post-commit) | ✗ | ✓ | ✓ |
| Notification (Firestore) | Notification (post-commit) | ✗ | ✓ | ✓ |
| Email (background) | Notification (post-commit) | ✗ | ✓ | ✓ |
| Cloudinary cleanup | Infrastructure (post-commit) | ✗ | ✓ | ✓ |
| Update application status | finalize_application_state() RPC | ✓ | ✓ | ✓ |
| Clear processing lock | finalize_application_state() RPC | ✓ | ✓ | ✓ |
| Append state_history | finalize_application_state() RPC | ✓ | ✓ | ✓ |

### Rejection Flow

| Existing reject step | New owner | Atomic? | Idempotent? | Retry-safe? |
|---------------------|-----------|---------|-------------|-------------|
| Read renewal request | Application (RPC payload) | ✓ | ✓ | ✓ |
| Validate status = 'pending' | Application (RPC: state = 'submitted') | ✓ | ✓ | ✓ |
| Acquire processing lock | Application (RPC: lease) | ✓ | ✓ | ✓ |
| Delete renewal request | Application (set state = 'rejected') | ✓ | ✓ | ✓ |
| Audit log (in-transaction) | Audit (post-commit) | ✗ | ✓ | ✓ |
| Payment status update | Payment (post-commit) | ✗ | ✓ | ✓ |
| Email (post-commit) | Notification (post-commit) | ✗ | ✓ | ✓ |
| Cloudinary cleanup | Infrastructure (post-commit) | ✗ | ✓ | ✓ |
| Clear processing lock | finalize_application_rejection() RPC | ✓ | ✓ | ✓ |

### Submission Flow

| Existing submission step | New owner | Atomic? | Idempotent? | Retry-safe?? |
|--------------------------|-----------|---------|-------------|-------------|
| Read student | Student.getByUid() | ✓ | ✓ | ✓ |
| Validate student exists | Application.submitFinal() | ✓ | ✓ | ✓ |
| Create renewal request | Application.submitFinal() (PG INSERT) | ✓ | ✓ (dedupe key) | ✓ |
| Dedupe check (daily bucket) | Application.submitFinal() (unique constraint) | ✓ | ✓ | ✓ |
| Create Razorpay order (online) | Payment (unchanged) | ✓ | ✓ | ✓ |
| Send staff notification | Notification (post-commit) | ✗ | ✓ | ✓ |

---

## Atomicity/Compensation Matrix — Every Cross-Domain Operation

| Operation A | Operation B | Failure scenario | Compensation |
|------------|------------|------------------|-------------|
| Student.applyRenewal() | Seat.assignSeat() | B fails after A succeeds | Revert student (set previous validUntil, duration, status) |
| Student.applyRenewal() | Payment.createOffline() | B fails after A succeeds | No compensation needed — payment retriable |
| Seat.assignSeat() | Student.applyRenewal() | B fails after A succeeds | Shouldn't happen (student-first order) |
| approve_application() | Student.applyRenewal() | B fails after A succeeds | Release lock via release_application_lock() |
| All succeed | finalize_application_state() | Fails after all succeed | Lease expires, retry from start (idempotent) |
| Online: no-op payment | finalize_application_state() | Fails | Lease expires, retry (idempotent) |

**Key invariant:** Student is always updated FIRST. Bus capacity is updated SECOND. Payment is updated THIRD. Finalize is LAST.

**If any step fails after Student is updated:**
- The application lease holds (no other approval can proceed)
- The lease expires after 5 minutes
- The cron reclaims the lock
- On retry, `Student.applyRenewal()` is idempotent (lastApplicationId check)
- On retry, `Seat.assignSeat()` is idempotent (Firestore transaction handles)

---

## Revised Plan Changes

Based on this audit:

1. **block-policy.ts** moves to `src/lib/business/block-policy.ts` (not Student policies) — used by Student, cleanup jobs, analytics
2. **Student.applyRenewal()** gains `applicationId` parameter as idempotency key
3. **Bus orchestration** uses existing `Seat.assignSeat()` and `Seat.getCapacity()` — NOT raw busCapacityService
4. **Payment flow** is explicit: online = no-op, offline = create (idempotent)
5. **finalize_application_state()** contract is fully specified with state_history, lease verification, and idempotent return
6. **approve_application()** remains generic — no application_type validation in RPC
7. **Rejection parity** is fully audited — all side effects mapped
8. **Failure matrix** is documented with compensation strategy
9. **Concurrency** is handled by lease + idempotency (lastApplicationId)
