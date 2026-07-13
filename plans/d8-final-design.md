# D8 Final Design — Production-Ready

## Three Remaining Refinements

### 1. Replace `student_update_applied` with `processing_checkpoint`

**Problem:** A single boolean creates hidden workflow state. One boolean becomes three booleans six months later.

**Solution:** `processing_checkpoint TEXT` enum on the `applications` table.

```sql
ALTER TABLE applications ADD COLUMN processing_checkpoint TEXT DEFAULT 'none'
  CHECK (processing_checkpoint IN ('none','seat_reserved','student_updated','payment_created','finalized'));
```

**Values:**

| Checkpoint | Meaning | Resume behavior on retry |
|-----------|---------|------------------------|
| `none` | No steps completed | Start from beginning |
| `seat_reserved` | Seat reserved in Firestore, student not yet updated | Skip seat, resume at student |
| `student_updated` | Student updated in PG, payment not yet created | Skip seat + student, resume at payment |
| `payment_created` | Payment created (or online no-op), post-commit tasks pending | Skip seat + student + payment, resume at post-commit |
| `finalized` | Application state set to 'approved', lock cleared | Already complete, no-op |

**Why this is better than booleans:**
- Single field, single source of truth
- Resume from exact failure point
- Debugging: `SELECT processing_checkpoint FROM applications WHERE application_id = '...'` tells you exactly where the flow stopped
- Metrics: `SELECT processing_checkpoint, COUNT(*) FROM applications WHERE state = 'processing' GROUP BY 1` shows stuck flows
- Extensible: add new checkpoints without adding new columns

**No RPC needed.** Application owns the row. Update directly in repository:

```typescript
// In Application repository:
export async function updateCheckpoint(applicationId: string, checkpoint: string): Promise<void> {
  const db = getSupabaseServer();
  await db.from('applications')
    .update({ processing_checkpoint: checkpoint, updated_at: new Date().toISOString() })
    .eq('application_id', applicationId);
}
```

### 2. Step-Aware Compensation

**Problem:** `if (seatReserved)` is not enough once more steps are added. Payment could fail after student succeeds, triggering unnecessary seat release.

**Solution:** Switch on `processing_checkpoint` to determine exact compensation.

```typescript
// In Application.approve() catch block:
const app = await repository.findById(applicationId);
const checkpoint = app.processing_checkpoint || 'none';

switch (checkpoint) {
  case 'seat_reserved':
    // Seat reserved, student NOT updated → release seat
    await Seat.releaseSeat(busId, studentUid, shift);
    break;
  case 'student_updated':
    // Student updated, payment NOT created → release seat + revert student
    await Seat.releaseSeat(busId, studentUid, shift);
    await Student.revertRenewal(studentUid, previousState); // restore previous validUntil, duration, etc.
    break;
  case 'payment_created':
    // Payment created, not yet finalized → release seat + revert student + reject payment
    await Seat.releaseSeat(busId, studentUid, shift);
    await Student.revertRenewal(studentUid, previousState);
    await Payment.rejectPayment(paymentId);
    break;
  case 'finalized':
    // Already complete — shouldn't reach here, but handle gracefully
    break;
  case 'none':
  default:
    // No steps completed → no compensation needed
    break;
}
```

**Key invariant:** `Seat.releaseSeat()` must use IDENTICAL parameters to `Seat.assignSeat()`:
- Same `busId`
- Same `studentUid`
- Same `shift`

Otherwise people will eventually decrement the wrong shift.

### 3. Retry Queue Infrastructure

**Problem:** "Retry queue" is vague. Someone implementing this will invent their own.

**Solution:** PostgreSQL `post_commit_tasks` table in Supabase. No new infrastructure (no Redis, no BullMQ).

```sql
CREATE TABLE IF NOT EXISTS post_commit_tasks (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_type       TEXT NOT NULL,           -- 'audit_log' | 'notification' | 'email' | 'cloudinary_cleanup'
  payload         JSONB NOT NULL,          -- task-specific data
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_post_commit_tasks_status ON post_commit_tasks (status, next_retry_at);
```

**Owner:** Infrastructure layer (`src/infrastructure/post-commit-queue.ts`).

**API:**

```typescript
// Enqueue a post-commit task
export async function enqueuePostCommitTask(taskType: string, payload: Record<string, unknown>): Promise<void>

// Process pending tasks (called by cron every 30 seconds)
export async function processPostCommitTasks(): Promise<{ processed: number; failed: number }>
```

**Processing logic:**
1. Query: `SELECT * FROM post_commit_tasks WHERE status = 'pending' AND next_retry_at <= NOW() LIMIT 10`
2. For each: set status = 'running', increment attempts
3. Execute task
4. On success: set status = 'completed'
5. On failure: set status = 'failed', set `next_retry_at = NOW() + (2^attempts * 30 seconds)` (exponential backoff), set `last_error`
6. If `attempts >= max_attempts`: set status = 'failed', send admin alert

**Cron:** Supabase Edge Function or pg_cron, runs every 30 seconds.

**This replaces all `Promise.allSettled()` post-commit patterns.**

---

## Revised Application.approve() Flow

```typescript
// In Application.approve() for renewal:
const app = await repository.findById(applicationId);
const checkpoint = app.processing_checkpoint || 'none';

try {
  // ── Resume from checkpoint ──

  if (checkpoint === 'none') {
    // Step 1: Pre-flight capacity check
    const bus = await Seat.getCapacity(busId, shift);
    if (bus.shiftLoad >= bus.capacity) return 409;

    // Step 2: Reserve seat
    await Seat.assignSeat(busId, studentUid, shift);
    await repository.updateCheckpoint(applicationId, 'seat_reserved');
  }

  if (checkpoint === 'none' || checkpoint === 'seat_reserved') {
    // Step 3: Student update
    await Student.applyRenewal(studentUid, { durationYears, totalFee, seatWasReleased, deadlineConfig });
    await repository.updateCheckpoint(applicationId, 'student_updated');
  }

  if (checkpoint === 'none' || checkpoint === 'seat_reserved' || checkpoint === 'student_updated') {
    // Step 4: Payment
    if (paymentMode === 'offline') {
      await createOfflinePaymentAtApproval({ ... purpose: 'renewal' });
    }
    await repository.updateCheckpoint(applicationId, 'payment_created');
  }

  // Step 5: Post-commit tasks (enqueue, don't execute inline)
  if (checkpoint !== 'finalized') {
    await enqueuePostCommitTask('audit_log', { ... });
    await enqueuePostCommitTask('notification', { ... });
    await enqueuePostCommitTask('email', { ... });
    await enqueuePostCommitTask('cloudinary_cleanup', { ... });
    await repository.updateCheckpoint(applicationId, 'finalized');
  }

  // Step 6: Finalize (state = 'approved', clear lock)
  await db.rpc('finalize_application_state', { p_application_id: applicationId, p_approver_uid: approverUid });

} catch (error) {
  // ── Step-aware compensation ──
  const currentApp = await repository.findById(applicationId);
  const failedCheckpoint = currentApp.processing_checkpoint || 'none';

  switch (failedCheckpoint) {
    case 'seat_reserved':
      await Seat.releaseSeat(busId, studentUid, shift);
      break;
    case 'student_updated':
      await Seat.releaseSeat(busId, studentUid, shift);
      await Student.revertRenewal(studentUid, previousStudentState);
      break;
    case 'payment_created':
      await Seat.releaseSeat(busId, studentUid, shift);
      await Student.revertRenewal(studentUid, previousStudentState);
      await Payment.rejectPayment(paymentId);
      break;
  }

  // Release application lock
  await db.rpc('release_application_lock', { p_application_id: applicationId });
  throw error;
}
```

---

## Student.applyRenewal() — Revised

No idempotency logic. Pure business capability.

```typescript
/**
 * Apply renewal to a student. Student owns ALL student mutations.
 * No idempotency logic — handled by Application layer via processing_checkpoint.
 */
export async function applyRenewal(
  studentUid: string,
  renewalDetails: {
    durationYears: number;
    totalFee: number;
    seatWasReleased: boolean;
    deadlineConfig: DeadlineConfig;
  }
): Promise<{ student: Student; previousState: PreviousStudentState }>
```

**Returns `previousState`** for compensation:

```typescript
interface PreviousStudentState {
  validUntil: string | null;
  durationYears: number;
  sessionEndYear: number;
  softBlock: string | null;
  hardBlock: string | null;
  status: string;
  seatReleasedAt: string | null;
}
```

**Student.revertRenewal()** restores these exact fields:

```typescript
export async function revertRenewal(
  studentUid: string,
  previousState: PreviousStudentState
): Promise<void>
```

**Compensation is now explicit and complete:** every field restored is listed in the interface. No hidden state.

---

## Revised Side-Effect Criticality Matrix

| Side Effect | Critical? | Retry? | Blocks? | Failure Handling |
|------------|-----------|--------|---------|-----------------|
| Seat.assignSeat() | Yes | Yes | Yes | If fails: no compensation (student not touched). Retry. |
| Student.applyRenewal() | Yes | No | Yes | If fails: Seat.releaseSeat + Student.revertRenewal (via checkpoint). |
| Payment (offline) | Yes | Yes | Yes | If fails: Seat.releaseSeat + Student.revertRenewal. Retry. |
| Payment (online) | N/A | N/A | No | No-op. |
| Post-commit tasks | No | Yes | No | PostgreSQL queue (3 attempts, exponential backoff, admin alert). |
| finalize_application_state() | Yes | Yes | Yes | If fails: retry. Idempotent. |

---

## Revised Workflow Parity Matrix

| Step | Owner | Atomic? | Idempotent? | Retry-safe? | Checkpoint |
|------|-------|---------|-------------|-------------|-----------|
| Read application | Application (repository) | ✓ | ✓ | ✓ | — |
| Validate + acquire lease | Application (RPC) | ✓ | ✓ | ✓ | — |
| Pre-check bus capacity | Seat.getCapacity() | ✓ | ✓ | ✓ | — |
| Reserve seat | Seat.assignSeat() (Firestore) | ✓ | ✓ | ✓ | seat_reserved |
| Read student | Student.getByUid() | ✓ | ✓ | ✓ | — |
| Calculate validUntil | Student.applyRenewal() | ✓ | ✓ | ✓ | — |
| Calculate durationYears | Student.applyRenewal() | ✓ | ✓ | ✓ | — |
| Calculate blockDates | Student.applyRenewal() | ✓ | ✓ | ✓ | — |
| Persist student | Student.applyRenewal() (PG) | ✓ | ✓ | ✓ | student_updated |
| Create offline payment | Payment (idempotent) | ✓ | ✓ | ✓ | payment_created |
| Enqueue audit | Post-commit queue (PG) | ✓ | ✓ | ✓ | — |
| Enqueue notification | Post-commit queue (PG) | ✓ | ✓ | ✓ | — |
| Enqueue email | Post-commit queue (PG) | ✓ | ✓ | ✓ | — |
| Enqueue Cloudinary | Post-commit queue (PG) | ✓ | ✓ | ✓ | — |
| Mark finalized | Application (repository) | ✓ | ✓ | ✓ | finalized |
| Finalize state | finalize_application_state() RPC | ✓ | ✓ | ✓ | — |

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
| application.state | Application | finalize_application_state() RPC |
| application.processing_lock | Application | finalize_application_state() RPC |
| application.processing_checkpoint | Application | Application repository (updateCheckpoint) |
| application.state_history | Application | finalize_application_state() RPC |
| application.approved_at | Application | finalize_application_state() RPC |
| application.approved_by | Application | finalize_application_state() RPC |
| payment.status | Payment | createOfflinePaymentAtApproval() |
| bus.morningCount | Seat | Seat.assignSeat() / Seat.releaseSeat() |
| bus.eveningCount | Seat | Seat.assignSeat() / Seat.releaseSeat() |
| bus.currentMembers | Seat | Seat.assignSeat() / Seat.releaseSeat() |

---

## Revised Failure Matrix

| Checkpoint at failure | Steps completed | Compensation |
|----------------------|----------------|-------------|
| `none` | Nothing | No compensation. Release lock. Retry. |
| `seat_reserved` | Seat reserved | Seat.releaseSeat(). Release lock. Retry. |
| `student_updated` | Seat + Student | Seat.releaseSeat() + Student.revertRenewal(). Release lock. Retry. |
| `payment_created` | Seat + Student + Payment | Seat.releaseSeat() + Student.revertRenewal() + Payment.rejectPayment(). Release lock. Retry. |
| `finalized` | Everything complete | No compensation. Finalize is idempotent. |

---

## Revised Files

| File | Purpose |
|------|---------|
| `src/lib/business/block-policy.ts` | NEW: computeBlockDatesFromValidUntil |
| `src/infrastructure/post-commit-queue.ts` | NEW: PostgreSQL-based retry queue (enqueue, process) |
| `supabase/migrations/20260709_d8_renewal_to_application.sql` | processing_checkpoint column + post_commit_tasks table + finalize_application_state() RPC |
| `scripts/migrate-renewal-requests.ts` | NEW: data migration script |
| `src/domains/student/services/student.service.ts` | Add applyRenewal() + revertRenewal() |
| `src/domains/student/index.ts` | Export applyRenewal, revertRenewal |
| `src/domains/application/services/application.service.ts` | Refactor approve() with checkpoint + step-aware compensation |
| `src/domains/application/repositories/application.repository.ts` | Add updateCheckpoint() method |
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

---

## Verification

1. TypeScript: `npx tsc --noEmit`
2. ESLint: `npx next lint`
3. SQL: verify all RPCs + post_commit_tasks table via Supabase SQL editor
4. Functional: create renewal request, approve it, verify student updated, application preserved, checkpoint = 'finalized'
5. Functional: create fresh application, approve it, verify student activated, application deleted
6. Functional: create renewal request, reject it, verify application state = 'rejected'
7. **Crash recovery:** approve renewal, crash after Seat.assignSeat → restart → verify seat released, application retryable
8. **Crash recovery:** approve renewal, crash after Student.applyRenewal → restart → verify checkpoint = 'student_updated', compensation correct
9. **Crash recovery:** approve renewal, crash after Payment → restart → verify checkpoint = 'payment_created', all compensated
10. **Idempotency:** approve same renewal twice → second should resume from checkpoint, not re-execute completed steps
11. **Concurrency:** two moderators approve same renewal → second gets 409
12. **Post-commit queue:** verify failed audit/notification/email is retried (check post_commit_tasks table)
13. **Migration verification:** Firestore count == PG count, sampled records match
14. Verify `renewal_requests` Firestore rules deny all access after freeze
