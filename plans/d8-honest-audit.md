# D8 Honest Audit — Two Unsolvable Constraints

## The Fundamental Architecture

```
PostgreSQL (Supabase)
├── applications (D4 Application domain)
├── student_profiles (D3 Student domain)
├── payments (D5 Payment domain)
└── ...

Firestore
├── buses (capacity counters: morningCount, eveningCount, currentMembers)
└── ...

Cross-system coordination: NO TRANSACTION SPANS BOTH.
```

Every renewal flow must cross from PostgreSQL (Application + Student) to Firestore (Seat capacity). This is the root of both unsolvable problems.

---

## Problem 1: Seat Reservation Leak

### The claim that was wrong

> "Seat-first ordering eliminates compensation entirely."

This is incorrect. Here is why:

### The actual flow

```
1. Seat.assignSeat(busId, studentUid, shift)
   → Firestore transaction commits (morningCount + 1, currentMembers + 1)
   → COMMITTED. Permanent until explicitly decremented.

2. Student.applyRenewal(studentUid, {...})
   → PG UPDATE on student_profiles
   → Could FAIL (student not found, constraint violation, network error, timeout)

3. If step 2 fails:
   → The Firestore increment from step 1 is ALREADY COMMITTED
   → The Application lease expires (only releases the application lock)
   → Nothing decrements morningCount/eveningCount/currentMembers
   → BUS CAPACITY IS LEAKED
```

### Why lease expiry does NOT fix this

The lease lives in the `applications` PostgreSQL table:

```sql
processing_lock, processing_started_at, processing_lease_expires_at
```

When the lease expires, the cron reclaims the application lock. This makes the application RETRYABLE. It does NOT touch Firestore. It does NOT call `Seat.releaseSeat()`.

### The compensation question

The user correctly identified that compensation is undesirable:

> "Compensation logic is notoriously difficult to keep correct over time because you have to restore every field exactly as it was."

But given the cross-system architecture (PG + Firestore), compensation is the ONLY mechanism to undo a committed Firestore write from within a PG flow.

### The honest answer

**There are exactly 3 options:**

#### Option A: Explicit compensation in catch block (what the user wants to avoid)

```typescript
try {
  await Seat.assignSeat(busId, studentUid, shift);  // Firestore commit
  await Student.applyRenewal(studentUid, {...});     // PG commit
} catch (error) {
  if (seatWasReserved) {
    await Seat.releaseSeat(busId, studentUid, shift); // Undo Firestore
  }
  throw error;
}
```

- **Pro:** Seat capacity is correctly restored
- **Con:** Compensation logic. Must track what was reserved. Must handle edge cases (what if releaseSeat also fails?).

#### Option B: Cleanup job for orphaned seats

Add `seat_reserved_at` timestamp to Application. A periodic cleanup job scans for applications where `seat_reserved_at IS NOT NULL AND state != 'approved'` and the lease has expired. For each, call `Seat.releaseSeat()`.

- **Pro:** No compensation in the main flow
- **Con:** Delayed cleanup (seat leaked until job runs). Job must correctly identify orphaned seats. Job must not release seats for applications currently being processed.

#### Option C: Move seat counters to PostgreSQL

Create `bus_capacity_counters` table in PG. Then Student + Seat can be in the same database. Use a single PG transaction.

- **Pro:** No cross-system coordination needed. True atomicity.
- **Con:** Out of scope for D8. Requires D6 Seat migration.

### My recommendation

**Use Option A (explicit compensation) for now.** It's the simplest correct solution. Document it as technical debt to be resolved when Seat counters move to PostgreSQL.

The compensation is simpler than the user fears:

```typescript
let seatReserved = false;
try {
  await Seat.assignSeat(busId, studentUid, shift);
  seatReserved = true;
  await Student.applyRenewal(studentUid, {...});
  // ... payment, audit, finalize
} catch (error) {
  if (seatReserved) {
    // Single decrement — simpler than reverting 10+ student fields
    await Seat.releaseSeat(busId, studentUid, shift).catch(() => {
      console.error('CRITICAL: Failed to release seat after student update failure. Manual intervention required.');
    });
  }
  throw error;
}
```

**Why this is simpler than student compensation:**
- Seat release is a SINGLE decrement operation (one Firestore field change)
- Student revert would require restoring 10+ fields (validUntil, durationYears, sessionEndYear, softBlock, hardBlock, status, lastRenewalDate, seatReleasedAt, paymentAmount, updatedAt)
- If `Seat.releaseSeat()` also fails, we log a CRITICAL alert. Manual intervention is rare and well-defined.

---

## Problem 2: Student Idempotency

### The claim that was wrong

> "max() logic prevents double extension."

This is only true for `validUntil` and `sessionEndYear`. It is NOT true for `durationYears`.

### The math

```
Current student: durationYears = 2
Renewal: +1 year

First execution: 2 + 1 = 3 ✓
Retry:           3 + 1 = 4 ✗ (double-counted)
```

### Why `lastApplicationId` was rejected

The user correctly identified that `lastApplicationId` couples Student → Application. If validity is extended by admin adjustment, scholarship, or migration, you'd need to fake an application ID.

### The honest answer

There are exactly 3 options:

#### Option A: Restore `lastApplicationId` with minimal coupling

Add `last_renewal_application_id TEXT` to student_profiles. Student uses it ONLY for idempotency:

```typescript
if (current.lastRenewalApplicationId === renewalDetails.applicationId) {
  return current; // already applied, no-op
}
```

- **Pro:** Correct idempotency. Simple.
- **Con:** Student knows about Application. If a non-Application workflow extends validity, it must set this field too.

#### Option B: Track idempotency at the Application layer

Add `student_update_applied BOOLEAN DEFAULT FALSE` to applications table. Set it to TRUE after `Student.applyRenewal()` succeeds. On retry, check this flag and skip the student update.

```typescript
// In Application.approve():
if (!app.student_update_applied) {
  await Student.applyRenewal(studentUid, {...});
  await db.rpc('mark_student_update_applied', { p_application_id: applicationId });
}
```

- **Pro:** Student domain has zero idempotency logic. All coupling stays in Application domain.
- **Con:** Adds a field to applications table. The `mark_student_update_applied` RPC must be in the same PG transaction as the student update for atomicity (or be idempotent itself).

#### Option C: Make `durationYears` settable (not additive)

Change the contract: instead of `durationYears = current + renewal`, use `durationYears = max(current, renewalYears)`. The renewal application specifies the TARGET duration, not the increment.

```typescript
// Student.applyRenewal():
const newDuration = Math.max(currentDurationYears, renewalDetails.durationYears);
```

- **Pro:** `max()` makes it idempotent. No coupling.
- **Con:** Breaks multi-year renewals. A student with 2 years renewing for 1 year would stay at 2 (max(2,1) = 2). This is only correct if renewals ALWAYS increase duration.

### My recommendation

**Use Option B (Application-layer tracking).** It's the cleanest separation:

- Student has zero idempotency logic
- Application tracks whether the student update was applied
- If a non-Application workflow extends validity, it doesn't need to know about this field
- The flag is set in the same PG transaction as the student update (atomic)

**The RPC:**

```sql
CREATE OR REPLACE FUNCTION mark_student_update_applied(
  p_application_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE applications
  SET student_update_applied = TRUE,
      updated_at = NOW()
  WHERE application_id = p_application_id
    AND state = 'processing';

  RETURN FOUND;
END;
$$;
```

**The flow:**

```typescript
// In Application.approve() for renewal:
if (!app.student_update_applied) {
  await Student.applyRenewal(studentUid, {...});
  await db.rpc('mark_student_update_applied', { p_application_id: applicationId });
} else {
  // Student already updated (retry). Skip to seat + payment.
}
```

---

## Revised Flow (Both Problems Addressed)

```
Application.approve(renewalApplication)
  ↓
  1. approve_application() RPC → validate + lock + payload
  ↓
  2. Switch: applicationType === 'renewal'
  ↓
  3. Seat.getCapacity(busId, shift)              — pre-flight (read-only)
  ↓
  4. Seat.assignSeat(busId, studentUid, shift)   — reserve FIRST
  ↓
  5. Student.applyRenewal(studentUid, {...})     — update SECOND
     IF step 5 fails:
       → Seat.releaseSeat(busId, studentUid, shift)  — EXPLICIT COMPENSATION
       → throw error
  ↓
  6. mark_student_update_applied()               — mark idempotency flag (PG, same txn as student)
  ↓
  7. Payment (online: no-op | offline: create)
  ↓
  8. Post-commit: Audit + Notification + Email + Cloudinary
  ↓
  9. finalize_application_state()                — finalize LAST
```

**If step 4 fails:** No compensation needed. Student not touched. Retry from start.
**If step 5 fails:** Explicit compensation: `Seat.releaseSeat()`. Then retry from start.
**If step 6 fails:** Same as step 5 (in same PG transaction or close to it).
**If step 7 fails:** Retry (idempotent).
**If step 9 fails:** Retry (idempotent).

---

## Remaining Concerns (Also Addressed)

### 3. "Already approved" race condition

The RPC checks `IF state = 'approved'` then `UPDATE WHERE state = 'processing'`. Can two retries observe "not approved" before either UPDATE?

**Answer:** No, because of the lease. The `approve_application()` RPC acquires the lease with `WHERE processing_lock IS NULL OR processing_lease_expires_at < NOW()`. Only one caller can hold the lease at a time. The second caller gets 409 before it can read the state.

**But:** If the lease has expired and two callers race to re-acquire, the PostgreSQL `UPDATE ... WHERE processing_lock IS NULL` is atomic. Only one wins. The other gets 0 rows and returns 409.

**Verdict:** The lease prevents the race. Document this explicitly.

### 4. Fire-and-forget → retry queue

The current plan says Audit/Notification/Email are "fire-and-forget." The user correctly notes this is insufficient for production.

**Revised handling:**

| Side Effect | Critical? | Failure Handling |
|------------|-----------|-----------------|
| Audit | No | Log failure. Include in retry queue (exponential backoff, 3 attempts). Alert after 3 failures. |
| Notification | No | Log failure. Include in retry queue. Alert after 3 failures. |
| Email | No | Log failure. Include in retry queue. Alert after 3 failures. |
| Cloudinary | No | Log failure. Include in retry queue. Orphaned asset is harmless but should be cleaned up. |

**Implementation:** Create a `post_commit_tasks` queue table or use the existing notification system. Each failed task is retried with exponential backoff. After 3 failures, an admin alert is sent.

### 5. `paymentAmount` ownership

The user correctly identified that `paymentAmount` is questionable as a Student-owned field.

**Revised ownership:**

| Field | Owner | Notes |
|-------|-------|-------|
| validUntil | Student | Business entitlement |
| durationYears | Student | Business entitlement |
| sessionEndYear | Student | Business entitlement |
| softBlock | Student | Business entitlement |
| hardBlock | Student | Business entitlement |
| status | Student | Business entitlement |
| lastRenewalDate | Student | Business entitlement |
| seatReleasedAt | Student | Business entitlement |
| ~~paymentAmount~~ | ~~Student~~ | REMOVE — redundant with payment record |
| updatedAt | Student | Metadata |

**Action:** Remove `paymentAmount` from `Student.applyRenewal()`. The payment amount is recorded in the payment record, not on the student. If a display is needed, read from the payment record.

### 6. Migration verification

The plan explains migration but never validates it.

**Added step (after Step 11, before Step 12):**

```
11a. Verify migration correctness:
  - Count: Firestore pending count == PG pending count
  - Count: Firestore approved count == PG approved count
  - Sample: hash 10 random records, compare field-by-field
  - Duration: sum of all durationYears matches
  - If ANY mismatch: abort, do not freeze
```

**Firestore is only frozen AFTER verification passes.**

---

## Revised Side-Effect Criticality Matrix

| Side Effect | Critical? | Retry? | Blocks? | Failure Handling |
|------------|-----------|--------|---------|-----------------|
| Seat.assignSeat() | Yes | Yes | Yes | If fails: no compensation needed (student not touched). Retry. |
| Student.applyRenewal() | Yes | No | Yes | If fails: EXPLICIT COMPENSATION (Seat.releaseSeat). Retry. |
| mark_student_update_applied() | Yes | Yes | Yes | If fails: same txn as student (or near it). Retry. |
| Payment (offline) | Yes | Yes | Yes | If fails: retry. Idempotent. |
| Payment (online) | N/A | N/A | No | No-op. |
| Audit log | No | Yes | No | Retry queue (3 attempts, then alert). |
| Notification | No | Yes | No | Retry queue (3 attempts, then alert). |
| Email | No | Yes | No | Retry queue (3 attempts, then alert). |
| Cloudinary | No | Yes | No | Retry queue (3 attempts, then alert). |
| finalize_application_state() | Yes | Yes | Yes | If fails: retry. Idempotent. |

---

## Revised Workflow Parity Matrix

| Step | Owner | Atomic? | Idempotent? | Retry-safe? |
|------|-------|---------|-------------|-------------|
| Read application | Application (RPC) | ✓ | ✓ | ✓ |
| Validate + acquire lease | Application (RPC) | ✓ | ✓ | ✓ |
| Pre-check bus capacity | Seat.getCapacity() | ✓ | ✓ | ✓ |
| Reserve seat | Seat.assignSeat() (Firestore) | ✓ | ✓ | ✓ |
| Read student | Student.getByUid() | ✓ | ✓ | ✓ |
| Calculate validUntil | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Calculate durationYears | Student.applyRenewal() | ✓ | ✗ (additive) | ✓ (via mark_student_update_applied) |
| Calculate blockDates | Student.applyRenewal() | ✓ | ✓ | ✓ |
| Persist student | Student.applyRenewal() (PG) | ✓ | ✓ | ✓ |
| Mark idempotency | mark_student_update_applied() (PG) | ✓ | ✓ | ✓ |
| Create offline payment | Payment (idempotent) | ✓ | ✓ | ✓ |
| Audit log | Audit (retry queue) | ✗ | ✓ | ✓ |
| Notification | Notification (retry queue) | ✗ | ✓ | ✓ |
| Email | Notification (retry queue) | ✗ | ✓ | ✓ |
| Cloudinary cleanup | Infrastructure (retry queue) | ✗ | ✓ | ✓ |
| Finalize state | finalize_application_state() | ✓ | ✓ | ✓ |

---

## Revised Cross-Domain Ownership Matrix

| Field | Owner | Updated By |
|-------|-------|-----------|
| validUntil | Student | Student.applyRenewal() |
| durationYears | Student | Student.applyRenewal() |
| sessionEndYear | Student | Student.applyRenewal() |
| softBlock | Student | Student.applyRenewal() |
| hardBlock | Student | Student.applyRenewal() |
| status (student) | Student | Student.applyRenewal() |
| lastRenewalDate | Student | Student.applyRenewal() |
| seatReleasedAt | Student | Student.applyRenewal() |
| updatedAt (student) | Student | Student.applyRenewal() |
| application.state | Application | finalize_application_state() |
| application.processing_lock | Application | finalize_application_state() |
| application.state_history | Application | finalize_application_state() |
| application.approved_at | Application | finalize_application_state() |
| application.approved_by | Application | finalize_application_state() |
| application.student_update_applied | Application | mark_student_update_applied() |
| payment.status | Payment | createOfflinePaymentAtApproval() |
| bus.morningCount | Seat | Seat.assignSeat() / Seat.releaseSeat() |
| bus.eveningCount | Seat | Seat.assignSeat() / Seat.releaseSeat() |
| bus.currentMembers | Seat | Seat.assignSeat() / Seat.releaseSeat() |

**`paymentAmount` removed from Student — redundant with payment record.**

---

## Revised Files

| File | Change |
|------|--------|
| `supabase/migrations/20260709_d8_renewal_to_application.sql` | Add `student_update_applied BOOLEAN` column + `mark_student_update_applied()` RPC + `finalize_application_state()` RPC + index |
| `src/lib/business/block-policy.ts` | NEW: computeBlockDatesFromValidUntil |
| `src/domains/student/services/student.service.ts` | Add applyRenewal() — no applicationId, no lastApplicationId |
| `src/domains/student/index.ts` | Export applyRenewal |
| `src/domains/application/services/application.service.ts` | Refactor approve() with Seat-first + explicit compensation + mark_student_update_applied |
| `src/app/api/student/renew-service-v2/route.ts` | Replace Firestore create with Application.submitFinal() |
| `src/app/api/renewal-requests/approve-v2/route.ts` | Replace Firestore transaction with Application.approve() |
| `src/app/api/renewal-requests/reject/route.ts` | Replace Firestore transaction with Application.rejectApplication() |
| `src/app/api/renew-services/route.ts` | Replace Firestore query with Application domain API |
| `src/app/api/payment/transactions/route.ts` | Replace Firestore query with Application domain API |
| `src/app/api/payment/recover/route.ts` | Replace Firestore query with Application domain API |
| `src/app/api/admin/dashboard-counts/route.ts` | Replace Firestore count with Application domain API |
| `src/domains/analytics/repositories/analytics.repository.ts` | Replace Firestore count with Application domain query |
| `src/lib/services/integrity-detector.ts` | Rewrite for Application domain |
| `src/lib/payment/payment.service.ts` | Replace Firestore create with Application.submitFinal() |
| `src/app/admin/renewal-service/page.tsx` | Remove client SDK, route through API |
| `src/app/admin/applications/page.tsx` | Remove client SDK, route through API |
| `src/app/moderator/applications/page.tsx` | Remove client SDK, route through API |
| `firestore.rules` | Freeze renewal_requests collection |
| `firestore.indexes.json` | Remove renewal_requests index |
| `src/config/firestore-collections.ts` | Remove RENEWAL_REQUESTS_COLLECTION |
| `scripts/migrate-renewal-requests.ts` | NEW: data migration script |

## Final Assessment

This design is honest about two fundamental constraints:

1. **Cross-system coordination (PG + Firestore) requires explicit compensation.** Seat-first ordering doesn't eliminate it. The compensation is simple (single decrement) and well-defined.

2. **Additive fields require idempotency tracking at the orchestration layer.** `durationYears` is additive by business requirement. `mark_student_update_applied()` on the Application table handles this without coupling Student to Application.

Both constraints will be resolved when Seat counters move to PostgreSQL (future D9/D10). For D8, these are the correct transitional solutions.
