# D8 Final Design v2 — Idempotent Operations + Orchestrator

## Core Architecture Shift

**Previous (wrong):** Checkpoint-based resume with step-aware compensation.

**New (correct):** Each domain operation is idempotent. A dedicated orchestrator coordinates the flow. Retries restart from the beginning. Already-completed work becomes a no-op.

```
RenewalApprovalOrchestrator
        │
        ├── Application (lease, state machine)
        ├── Seat (idempotent assign/release)
        ├── Student (idempotent applyRenewal)
        ├── Payment (idempotent create)
        ├── Notification (via retry queue)
        ├── Audit (via retry queue)
        └── Email (via retry queue)
```

---

## Problem 1: Remove processing_checkpoint

**Why it's wrong:** It turns the Application table into a workflow engine. Business state (pending/approved/rejected) and execution state (seat_reserved/student_updated/payment_created) are different concerns.

**Solution:** Remove `processing_checkpoint` entirely. The Application table keeps only business state + lease lock. No execution markers.

**If a step fails:** Release the seat (if reserved), release the lock, throw. The lease expires, the cron reclaims the lock, and the entire approval can be retried from the beginning. Since every operation is idempotent, retrying is safe.

---

## Problem 2: Make Student.applyRenewal() idempotent

**The additive problem:** `durationYears = current + renewal` is additive. Retries double-increment.

**The idempotency key:** Add `last_renewal_application_id TEXT` to `student_profiles`. This is NOT business logic — it's a mechanical idempotency guard.

```typescript
export async function applyRenewal(
  studentUid: string,
  renewalDetails: {
    applicationId: string;         // idempotency key
    durationYears: number;
    totalFee: number;
    seatWasReleased: boolean;
    deadlineConfig: DeadlineConfig;
  }
): Promise<Student | null> {
  const student = await getByUid(studentUid);
  if (!student) return null;

  // IDEMPOTENCY: if this exact renewal was already applied, return current student
  if ((student as any).lastRenewalApplicationId === renewalDetails.applicationId) {
    return student; // no-op
  }

  // Calculate new values (max logic for validUntil/sessionEndYear)
  const baseYear = ...;
  const newValidUntil = max(currentValidUntil, calculateValidUntilDate(baseYear, renewalDetails.durationYears, config));
  const newSessionEndYear = max(currentSessionEndYear, baseYear + renewalDetails.durationYears);
  const newDuration = (currentDurationYears || 0) + renewalDetails.durationYears;
  const blockDates = computeBlockDatesFromValidUntil(newValidUntil, config);

  // Persist
  await update(studentUid, {
    validUntil: newValidUntil,
    sessionEndYear: newSessionEndYear,
    durationYears: newDuration,
    softBlock: blockDates.softBlock,
    hardBlock: blockDates.hardBlock,
    status: 'active',
    lastRenewalDate: new Date().toISOString(),
    lastRenewalApplicationId: renewalDetails.applicationId, // idempotency key
    seatReleasedAt: renewalDetails.seatWasReleased ? null : (student as any).seatReleasedAt,
    updatedAt: new Date().toISOString(),
  });

  return getByUid(studentUid);
}
```

**Why `last_renewal_application_id` is acceptable coupling:**
- It's a single TEXT field, not a foreign key
- Student doesn't import Application types or call Application functions
- It's used ONLY for idempotency, not business logic
- If a non-Application workflow extends validity, it sets this field to the workflow ID
- The field is nullable — clearing it is trivial

**Why this is better than `revertRenewal()`:**
- No revert logic to maintain
- No field-by-field restoration
- Every new student field automatically works with idempotency (max logic or skip-if-applied)
- No maintenance burden when new fields are added

---

## Problem 3: Remove Payment.rejectPayment()

**Why it's dangerous:** Payment may have already synced to gateway, generated receipt, updated ledger. "Rejecting" is underspecified.

**Solution:** Payment operations are naturally idempotent via `ON CONFLICT DO NOTHING`. If the payment already exists, the create is a no-op. If the flow fails after payment, the payment stays as-is (it's already recorded). No rejection needed.

```typescript
// Payment.createOfflinePaymentAtApproval() already uses:
INSERT INTO payments (...) VALUES (...)
ON CONFLICT (application_id) DO NOTHING
```

If the flow crashes after payment is created but before finalize, the payment exists. On retry, the payment create is a no-op. The flow continues to finalize.

---

## Problem 4: Seat compensation (simplified)

**The only compensation needed:** If `Student.applyRenewal()` fails after `Seat.assignSeat()` succeeds, release the seat.

```typescript
// In orchestrator:
let seatReserved = false;
try {
  await Seat.assignSeat(busId, studentUid, shift);
  seatReserved = true;
  await Student.applyRenewal(studentUid, { ... });
  await Payment.createOfflinePaymentAtApproval({ ... });
  await enqueuePostCommitTasks(...);
  await finalizeApplicationState(applicationId, approverUid);
} catch (error) {
  if (seatReserved) {
    await Seat.releaseSeat(busId, studentUid, shift); // same params as assignSeat
  }
  await releaseApplicationLock(applicationId);
  throw error;
}
```

**Why this is acceptable:**
- Seat release is a SINGLE decrement (one Firestore field change)
- It's simpler than reverting 10+ student fields
- It's well-defined: same busId, same studentUid, same shift
- If `Seat.releaseSeat()` also fails: CRITICAL log, manual intervention (rare)

---

## Problem 5: Keep post_commit_tasks queue

**This is good.** PostgreSQL-based, no new infrastructure, exponential backoff, admin alert after 3 failures.

```sql
CREATE TABLE IF NOT EXISTS post_commit_tasks (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_type       TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## The Orchestrator

**File:** `src/domains/application/services/renewal-approval-orchestrator.ts`

```typescript
/**
 * RenewalApprovalOrchestrator — coordinates cross-domain renewal approval.
 *
 * This is NOT a domain service. It's an orchestration layer that coordinates
 * Application, Student, Seat, Payment, Audit, Notification, and Email domains.
 *
 * Each domain operation is idempotent. The orchestrator can retry from the
 * beginning without side effects.
 */
import * as Seat from '@/domains/seat';
import * as Student from '@/domains/student';
import * as Application from '@/domains/application';
import { createOfflinePaymentAtApproval } from '@/lib/payment/payment.service';
import { enqueuePostCommitTask } from '@/infrastructure/post-commit-queue';

export async function approveRenewal(
  applicationId: string,
  approverUid: string,
  approverData: { uid: string; name: string; role: string; empId?: string },
  deadlineConfig: DeadlineConfig
): Promise<{ success: boolean; error?: string; status?: number }> {
  const db = getSupabaseServer();

  // 1. Acquire lease (idempotent — returns payload or 409)
  const { data: rpcResult } = await db.rpc('approve_application', {
    p_application_id: applicationId,
    p_approver_uid: approverUid,
  });
  if (!rpcResult?.success) return { success: false, error: rpcResult?.error, status: rpcResult?.status };

  const app = rpcResult.application;
  const studentUid = app.applicant_uid;
  const busId = app.form_data?.busId || app.form_data?.assignedBusId;
  const shift = app.form_data?.shift;
  const seatWasReleased = app.form_data?.seatWasReleased || false;
  const paymentMode = app.form_data?.paymentInfo?.paymentMode;
  const durationYears = app.form_data?.sessionInfo?.durationYears;
  const totalFee = app.form_data?.sessionInfo?.totalFee;

  // 2. Seat-first, with compensation
  let seatReserved = false;
  try {
    // 2a. Pre-flight capacity check
    if (busId && seatWasReleased) {
      const bus = await Seat.getCapacity(busId, shift);
      if (bus && bus.shiftLoad >= bus.capacity) {
        return { success: false, error: 'Bus is full', status: 409 };
      }
    }

    // 2b. Reserve seat (idempotent — if already assigned, returns success)
    if (busId && seatWasReleased) {
      await Seat.assignSeat(busId, studentUid, shift);
      seatReserved = true;
    }

    // 2c. Student renewal (idempotent — uses applicationId as key)
    await Student.applyRenewal(studentUid, {
      applicationId,
      durationYears,
      totalFee,
      seatWasReleased,
      deadlineConfig,
    });

    // 2d. Payment (idempotent — ON CONFLICT DO NOTHING)
    if (paymentMode === 'offline') {
      await createOfflinePaymentAtApproval({
        studentId: app.form_data?.enrollmentId || '',
        studentUid,
        studentName: app.full_name || 'Student',
        amount: totalFee,
        durationYears,
        sessionStartYear: app.form_data?.sessionInfo?.sessionStartYear,
        sessionEndYear: app.form_data?.sessionInfo?.sessionEndYear,
        validUntil: app.form_data?.sessionInfo?.validUntil,
        transactionId: app.form_data?.paymentInfo?.paymentReference,
        paidAt: app.form_data?.paymentInfo?.paidAt ? new Date(app.form_data.paymentInfo.paidAt) : new Date(),
        receipt: app.form_data?.paymentInfo?.paymentEvidenceUrl || '',
        approverUserId: approverUid,
        approverName: approverData.name,
        approverEmpId: approverData.empId || '',
        approverRole: approverData.role,
        purpose: 'renewal',
      });
    }

    // 2e. Post-commit tasks (enqueue, don't execute inline)
    await enqueuePostCommitTask('audit_log', {
      category: 'renewals',
      action: 'renewal_request_approved',
      summary: `Renewal approved: ${app.full_name || ''}`,
      performedBy: approverUid,
      performedByName: approverData.name,
      performedByRole: approverData.role,
      targetType: 'student',
      targetId: studentUid,
      targetName: app.full_name || '',
    });

    await enqueuePostCommitTask('notification', {
      title: '✅ Renewal Request Approved',
      content: `Your renewal for ${durationYears} year(s) has been approved.`,
      recipientIds: [studentUid],
    });

    await enqueuePostCommitTask('email', {
      template: 'application_approved',
      studentName: app.full_name || 'Student',
      studentEmail: app.email || app.applicant_email,
      routeName: 'Service Renewal',
      validUntil: app.form_data?.sessionInfo?.validUntil,
    });

    if (app.form_data?.paymentInfo?.paymentEvidenceUrl) {
      await enqueuePostCommitTask('cloudinary_cleanup', {
        imageUrl: app.form_data.paymentInfo.paymentEvidenceUrl,
      });
    }

    // 2f. Finalize (preserves row for renewal)
    await db.rpc('finalize_application_state', {
      p_application_id: applicationId,
      p_approver_uid: approverUid,
    });

    return { success: true };

  } catch (error: any) {
    // Compensation: release seat if reserved
    if (seatReserved) {
      await Seat.releaseSeat(busId, studentUid, shift).catch(() => {
        console.error('CRITICAL: Failed to release seat. Manual intervention required.', {
          busId, studentUid, shift, applicationId,
        });
      });
    }

    // Release application lock
    await db.rpc('release_application_lock', { p_application_id: applicationId });
    return { success: false, error: error.message, status: 500 };
  }
}
```

---

## Revised Side-Effect Matrix

| Side Effect | Idempotent? | Compensation | Notes |
|------------|-------------|-------------|-------|
| Seat.assignSeat() | ✓ (same student+bus+shift) | Release in catch | Single decrement |
| Student.applyRenewal() | ✓ (lastRenewalApplicationId) | N/A — if fails, seat released | No revert needed |
| Payment.create() | ✓ (ON CONFLICT DO NOTHING) | N/A — payment stays | Already recorded |
| Audit log | ✓ (dedupe on applicationId + action) | N/A | Via retry queue |
| Notification | ✓ (dedupe on recipientIds + content) | N/A | Via retry queue |
| Email | ✓ (dedupe on studentEmail + template) | N/A | Via retry queue |
| Cloudinary | ✓ (idempotent delete) | N/A | Via retry queue |
| finalize_application_state() | ✓ (state check) | N/A | RPC handles |

**Every operation is idempotent. Retries are safe. No checkpoints needed.**

---

## Revised Failure Matrix

| Failure point | What happened | Compensation | Retry behavior |
|--------------|--------------|-------------|---------------|
| Seat fails | Nothing reserved | None | Retry from start |
| Student fails after Seat | Seat reserved, student not updated | Seat.releaseSeat() | Retry: Seat.assignSeat() is idempotent, Student.applyRenewal() retries |
| Payment fails after Student | Student updated, payment not created | None needed | Retry: Student is idempotent (skip), Payment retries |
| Finalize fails after Payment | Everything done, state not set | None needed | Retry: all prior steps are idempotent |
| Post-commit fails | Tasks not enqueued | None needed | Retry: finalize is idempotent, tasks can be re-enqueued |

---

## Revised Files

| File | Purpose |
|------|---------|
| `src/lib/business/block-policy.ts` | NEW: computeBlockDatesFromValidUntil |
| `src/infrastructure/post-commit-queue.ts` | NEW: PostgreSQL retry queue |
| `supabase/migrations/20260709_d8_renewal_to_application.sql` | last_renewal_application_id column + post_commit_tasks table + finalize_application_state() RPC |
| `scripts/migrate-renewal-requests.ts` | NEW: data migration |
| `src/domains/student/services/student.service.ts` | Add applyRenewal() with lastRenewalApplicationId idempotency |
| `src/domains/student/index.ts` | Export applyRenewal |
| `src/domains/application/services/renewal-approval-orchestrator.ts` | NEW: dedicated orchestrator |
| `src/app/api/student/renew-service-v2/route.ts` | Replace Firestore with Application.submitFinal() |
| `src/app/api/renewal-requests/approve-v2/route.ts` | Replace Firestore with orchestrator.approveRenewal() |
| `src/app/api/renewal-requests/reject/route.ts` | Replace Firestore with Application.rejectApplication() |
| `src/app/api/renew-services/route.ts` | Replace Firestore query |
| `src/app/api/payment/transactions/route.ts` | Replace Firestore query |
| `src/app/api/payment/recover/route.ts` | Replace Firestore query |
| `src/app/api/admin/dashboard-counts/route.ts` | Replace Firestore count |
| `src/domains/analytics/repositories/analytics.repository.ts` | Replace Firestore query |
| `src/lib/services/integrity-detector.ts` | Rewrite for Application domain |
| `src/lib/payment/payment.service.ts` | Replace Firestore create |
| `src/app/admin/renewal-service/page.tsx` | Remove client SDK |
| `src/app/admin/applications/page.tsx` | Remove client SDK |
| `src/app/moderator/applications/page.tsx` | Remove client SDK |
| `firestore.rules` | Freeze renewal_requests |
| `firestore.indexes.json` | Remove renewal_requests |
| `src/config/firestore-collections.ts` | Remove RENEWAL_REQUESTS_COLLECTION |

---

## What Was Removed

| Removed | Why |
|---------|-----|
| `processing_checkpoint` | Turns Application into workflow engine. Business state ≠ execution state. |
| `Student.revertRenewal()` | Maintenance burden. Every new field needs revert logic. Idempotency via `lastRenewalApplicationId` is simpler. |
| `Payment.rejectPayment()` | Dangerous. Payment may have synced to gateway. Idempotent create (ON CONFLICT) is sufficient. |
| `mark_student_update_applied()` RPC | Unnecessary. Checkpoint logic removed entirely. |
| Step-aware compensation switch | Replaced by simple `if (seatReserved) Seat.releaseSeat()` |

---

## What Was Kept

| Kept | Why |
|------|-----|
| `post_commit_tasks` queue | Solid. PostgreSQL-based, no new infrastructure. |
| Seat-first ordering | Reserve scarce resource first, then update dependent entity. |
| Explicit Seat.releaseSeat() in catch | Simple, well-defined compensation (single decrement). |
| `last_renewal_application_id` on Student | Minimal coupling for idempotency. Better than revertRenewal(). |
| `finalize_application_state()` RPC | Preserves row for renewal. |
| Lease-based locking | Prevents concurrent processing. |

---

## Verification

1. TypeScript + ESLint
2. SQL: verify all RPCs + post_commit_tasks table
3. Functional: renewal approve/reject/submit
4. **Idempotency:** retry same renewal → Student.applyRenewal() returns current student (skip), Payment is no-op (ON CONFLICT)
5. **Crash recovery:** crash after Seat.assignSeat → restart → seat released in catch → retry succeeds
6. **Concurrency:** double-approve → second gets 409
7. **Post-commit queue:** verify retry + alert on failure
8. **Migration:** count match + sample hash before freeze
