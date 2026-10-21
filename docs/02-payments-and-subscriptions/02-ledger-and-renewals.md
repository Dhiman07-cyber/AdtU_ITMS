# Payment Ledger Immutability, Seat Quota Renewals & Entitlement Enforcement (Forensic Truth)

**Module:** Double-Entry Ledger Invariants, Atomic Seat Renewal (`approve_renewal_with_seat`), Gate Checks & Refunds  
**File Authority:** `src/domains/student/services/student-renewal.service.ts`, `src/lib/services/entitlement-service.ts`, `supabase/COMPLETE_SCHEMA.sql`  
**Database Triggers & RPCs:** `protect_completed_payments`, `approve_renewal_with_seat`, `has_valid_transport_pass`  

---

# PART 6: Atomic Seat Quota Allocation, Renewal Approval & Pass Validity Extension (`INV-CAP-001`)

### 6.1 Sub-Domain Architecture & Exact Execution Pipeline

The Transit Capacity Allocation and Pass Validity engine operates under the absolute invariant **`INV-CAP-001` (Zero Overbooking Guarantee)**:
A bus's morning or evening load (`morning_load` / `evening_load`) must NEVER exceed its physical passenger capacity (`capacity`).

To preserve this invariant across asynchronous online payment completions, manual moderator offline approvals, and renewal reactivations, the system splits seat allocation and validity extension into strict architectural pathways:

```
                                  TRANSMISSION / APPROVAL EVENT
                                                │
                ┌───────────────────────────────┴───────────────────────────────┐
                │                                                               │
     [CURRENT-SESSION APPLICATION]                                  [FUTURE-SESSION APPLICATION]
     (targetSession.startYear <= current)                           (targetSession.startYear > current)
                │                                                               │
     Is Renewal or Fresh?                                          isUpcomingApplication() === true
      ├── Fresh Application:                                                    │
      │    RPC identity_activate_student_with_capacity             Intercepted in Application.approve():
      │    (SELECT * FROM buses FOR UPDATE;                         Does NOT allocate seat.
      │     load < capacity -> increment load + insert profile)     Does NOT extend validity.
      │                                                            Transitions state to 'verified_upcoming'.
      └── Renewal Application:                                                  │
           Did commuter have seat released at soft-block?                       ▼
           (student.seat_released_at != null)                      Staged until Academic Year Rollover
            │                                                      (Activated via Session Activation Cron)
            ├── NO (Commuter retained seat):
            │    Application.approve() computes new validity
            │    RPC finalize_application_approval updates profile
            │    Bus load unchanged (already counted in load)
            │
            └── YES (Seat was previously released):
                 CRITICAL SEAT RECLAIM PATH:
                 RPC approve_renewal_with_seat(p_bus_id, p_shift, ...)
                 │
                 ├── 1. Lock student_profiles row FOR UPDATE
                 ├── 2. Lock buses row FOR UPDATE
                 ├── 3. Evaluate: bus.[shift]_load >= bus.capacity?
                 │       ├── YES: ABORT TRANSACTION!
                 │       │        Returns error: 'CAPACITY_FULL'
                 │       │        Application stays in 'submitted'
                 │       │        Rollback all locks
                 │       │        Commuter is NOT reactivated
                 │       │        Admin must reassign bus or add capacity
                 │       │
                 │       └── NO:  UPDATE buses SET [shift]_load = load + 1
                 │                UPDATE student_profiles SET
                 │                  status = 'active',
                 │                  seat_released_at = NULL,
                 │                  valid_until = p_valid_until,
                 │                  soft_block = p_soft_block,
                 │                  hard_block = p_hard_block
                 │                UPDATE applications SET state = 'approved'
                 │                COMMIT TRANSACTION
                 │
                 ▼
         postCommitApprovalSideEffects()
         - createOfflinePaymentAtApproval()
         - Log audit_events ('application_approved')
         - Dispatch approval email & clean up Cloudinary assets
```

---

### 6.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/domains/student/services/student.service.ts` | `applyPaymentValidity`, `SeatReclaimRequiredError`, `update`, `getProfile` | `payment.service.ts` (`applyPaymentValidityToStudent`), renewal approval | `studentRepository.update`, `computeBlockDatesFromValidUntil`, `invalidateStudentAssignment` | Mutates `public.student_profiles`; Invalidates student assignment memory/Redis cache |
| `src/lib/utils/application-eligibility.ts` | `isUpcomingApplication`, `computeFutureEligibleApproval`, `resolveApplicationType`, `isApprovalEligible`, `deriveCreationCategorisation` | `application.service.ts`, `renew-service-v2`, UI components | `computeBlockDatesFromValidUntil` | Pure date & lifecycle computation; No database mutation |
| `src/domains/application/services/application.service.ts` | `approve`, `verifyUpcoming`, `postCommitApprovalSideEffects` | API routes (`/api/applications/approve`, `/api/renewal-requests/approve-v2`) | RPCs (`approve_application`, `approve_renewal_with_seat`, `identity_activate_student_with_capacity`, `finalize_application_approval`, `release_application_lock`) | Mutates `public.applications`, `public.buses`, `public.student_profiles`, `public.payments`, `public.audit_events` |
| `supabase/COMPLETE_SCHEMA.sql` | `approve_renewal_with_seat`, `bus_increment_capacity`, `bus_decrement_capacity` | Application domain service, Seat domain | PostgreSQL internal triggers & tables | Row locks (`FOR UPDATE`) and mutates `public.buses`, `public.student_profiles`, `public.applications` |

---

### 6.3 Method-by-Method Low-Level Walkthrough

#### 1. Pass Validity Extension Gate: `applyPaymentValidity` (`src/domains/student/services/student.service.ts`)
- **Signature:** `applyPaymentValidity(studentUid: string, payment: { valid_until?: string | null; session_start_year?: number | null; session_end_year?: number | null }): Promise<boolean>`
- **Control Flow & Invariant Enforcement:**
  1. Resolves student profile by UID via `getByUid(studentUid)`. If missing, returns `false`.
  2. **Seat-Released Safety Guard (LC-01 Guard):**
     ```typescript
     if ((student as any).seatReleasedAt) {
       console.error(`[applyPaymentValidity] Refused to reactivate ${studentUid}: seat was released...`);
       throw new SeatReclaimRequiredError(studentUid, String((student as any).seatReleasedAt));
     }
     ```
     *Rationale:* If a soft-blocked student whose seat was relinquished were blindly reactivated here via status update, they would gain transit entitlement while the physical bus load remained decremented—destroying `INV-CAP-001`. They MUST re-acquire seat capacity via `approve_renewal_with_seat`.
  3. **Monotonic Validity Invariant (Older Payment Cannot Overwrite Newer Validity):**
     ```typescript
     const finalValidUntil = (existingValidUntil && newValidUntil && existingValidUntil > newValidUntil)
       ? existingValidUntil
       : newValidUntil;
     const finalSessionEndYear = ((student as any).sessionEndYear && payment.session_end_year && (student as any).sessionEndYear > payment.session_end_year)
       ? (student as any).sessionEndYear
       : payment.session_end_year;
     ```
  4. Computes `softBlock` and `hardBlock` dates using `computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig)`.
  5. Updates `public.student_profiles` with `status = 'active'`, `validUntil`, `softBlock`, `hardBlock`, and session boundaries.
  6. Evicts student assignment caches via `invalidateStudentAssignment(studentUid)`.

---

#### 2. Atomic Renewal Seat Reclaim: `approve_renewal_with_seat` (PostgreSQL PL/pgSQL RPC)
- **Signature:** `public.approve_renewal_with_seat(p_application_id, p_approver_uid, p_student_uid, p_bus_id, p_shift, p_valid_until, p_session_end_year, p_session_duration, p_soft_block, p_hard_block) RETURNS JSONB`
- **Execution Flow:**
  1. Validates shift: `v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')))`. Must be `'morning'`, `'evening'`, or `'both'`.
  2. **Atomic Student Row Lock:** `SELECT ... FROM student_profiles WHERE uid = p_student_uid FOR UPDATE;`. Returns error if student not found.
  3. **Atomic Bus Row Lock:** `SELECT id, capacity, morning_load, evening_load FROM buses WHERE id = p_bus_id FOR UPDATE;`. Returns error if bus not found.
  4. **Strict Capacity Validation Gate:**
     - For morning shift: If `v_bus.morning_load >= v_bus.capacity`, halts execution and returns `jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift)`.
     - For evening shift: If `v_bus.evening_load >= v_bus.capacity`, returns `'CAPACITY_FULL'`.
     - For both shifts: If either load exceeds capacity, returns `'CAPACITY_FULL'`.
  5. **Load Increment:** Updates `buses` with `morning_load = v_new_morning`, `evening_load = v_new_evening`, `current_members = v_new_morning + v_new_evening`, `updated_at = NOW()`.
  6. **Student Reactivation:** Updates `student_profiles`:
     - Sets `status = 'active'`.
     - Sets `seat_released_at = NULL` (clears seat release marker).
     - Sets `valid_until = p_valid_until`, `soft_block = p_soft_block`, `hard_block = p_hard_block`.
     - Sets `last_processed_application_id = p_application_id`.
  7. **Application Finalization:** Updates `applications` to `state = 'approved'`, `approved_by = p_approver_uid`, `approved_at = NOW()`.
  8. Commits transaction and returns `jsonb_build_object('success', true, 'student_uid', p_student_uid, 'bus_id', p_bus_id)`.

---

#### 3. Capacity Exhaustion Edge Case Trace: What happens if Capacity is 100%?
- **Scenario:** A student whose seat was released during soft-block submits a renewal (online or offline), but their bus's shift load is already equal to its capacity (`morning_load >= capacity`).
- **Code Path Trace:**
  1. For online payment capture (`processCapturedPayment`):
     - An online payment record is created with `status = 'Completed'`.
     - A renewal application (`applicationId: 'online_' + paymentId`) is created in `public.applications` with `state = 'submitted'`.
     - Direct entitlement is NOT granted (`metadata.entitlement_status = 'pending_application'`).
  2. When the moderator reviews the renewal and clicks Approve (`POST /api/renewal-requests/approve-v2` or `/api/applications/approve`):
     - `Application.approve()` detects `seatWasReleased === true` and `renewalBusId`.
     - Invokes RPC `approve_renewal_with_seat`.
     - In PostgreSQL, the RPC locks the bus row with `FOR UPDATE` and evaluates `v_bus.morning_load >= v_bus.capacity`.
     - The check evaluates to `true`. The RPC aborts the update and returns `{ success: false, error: 'CAPACITY_FULL' }`.
     - In TypeScript, `Application.approve()` throws an Error (`'CAPACITY_FULL'`), catches it, calls `release_application_lock`, and returns `{ success: false, error: 'CAPACITY_FULL', status: 500 }`.
     - The API endpoint returns HTTP 500 to the moderator with error `CAPACITY_FULL`.
  3. **Outcome:**
     - The bus capacity is NOT incremented.
     - The student is NOT reactivated; their profile retains `seat_released_at` and `status = 'soft_blocked'`.
     - The application remains in `state = 'submitted'` (unlocked).
     - The approving administrator can now select an alternate vehicle with available capacity using the `overrideBusId` parameter in the approval workbench, or expand the fleet quota.

---

#### 4. Future Academic Year Staging: `verified_upcoming` (`src/lib/utils/application-eligibility.ts`)
- **Detection:** An application is identified as upcoming if:
  ```typescript
  targetSession.startYear > currentSessionStartYear
  ```
- **Staging Intercept in `Application.approve`:**
  ```typescript
  if (isUpcomingApplication(app) && app.state === 'submitted') {
    try {
      await db.rpc('release_application_lock', { p_application_id: applicationId });
    } catch {}
    const verifyResult = await verifyUpcoming(applicationId, approverData, notes);
    return { success: true, studentUid: app.applicant_uid };
  }
  ```
- **Execution of `verifyUpcoming`:**
  1. Updates `public.applications`:
     - Sets `state = 'verified_upcoming'`.
     - Sets `verified_upcoming_at = NOW()`.
     - Sets `verified_upcoming_by = verifierData.name`.
  2. Emits audit event `application_verified_upcoming` to `public.audit_events`.
  3. **ZERO Capacity Impact:** Does NOT call `bus_increment_capacity` or `identity_activate_student_with_capacity`. Does NOT mutate `public.student_profiles`. Current-year seats remain fully available for current-year commuters.
  4. Activates automatically when the academic rollover date arrives via `/api/cron/session-activation` (Part 9).

---

### 6.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Normal Renewal Approval (Seat Retained, No Reclaim Needed)** | **4 Queries / RPCs:**<br>1. RPC `approve_application` (Lock application row)<br>2. Select `student_profiles` by UID<br>3. RPC `finalize_application_approval` (Atomic student update + app finalization)<br>4. Insert `public.audit_events` | **1 Redis Invalidation:**<br>1. `invalidateStudentAssignment` (Del key `student:assign:<uid>` + PubSub) | **2 External Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Approval Email API | **7 I/O Ops** |
| **(b) Critical Seat Reclaim Approval (`seat_released_at != null`)** | **4 Queries / RPCs:**<br>1. RPC `approve_application` (Lock application row)<br>2. Select `student_profiles` by UID<br>3. RPC `approve_renewal_with_seat` (Atomic bus lock + student lock + load check + capacity increment + student update + app finalization)<br>4. Insert `public.audit_events` | **1 Redis Invalidation:**<br>1. `invalidateStudentAssignment` | **2 External Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Approval Email API | **7 I/O Ops** |
| **(c) Seat Reclaim Blocked by Full Capacity (`CAPACITY_FULL`)** | **3 Queries / RPCs:**<br>1. RPC `approve_application` (Lock application row)<br>2. Select `student_profiles` by UID<br>3. RPC `approve_renewal_with_seat` (Aborts at step 4: returns `CAPACITY_FULL`)<br>4. RPC `release_application_lock` | **0** | **0 External Calls** (Fails before side effects) | **4 I/O Ops** |
| **(d) Upcoming Application Approval (`verified_upcoming` Staging)** | **3 Queries / RPCs:**<br>1. RPC `approve_application` (Lock)<br>2. RPC `release_application_lock`<br>3. Update `public.applications` (state: `verified_upcoming`)<br>4. Insert `public.audit_events` | **0** | **0 External Calls** | **4 I/O Ops** |

---

### 6.5 Verbatim Source Code from Live Codebase

#### 1. Pass Validity Extension & Monotonic Validity Enforcement: `src/domains/student/services/student.service.ts` (Lines 46–155)
```typescript
  constructor(studentUid: string, seatReleasedAt: string) {
    super(
      `Student ${studentUid} seat was released at soft-block (seatReleasedAt=${seatReleasedAt}). ` +
      `Reactivation requires renewal approval with seat allocation (approve_renewal_with_seat).`
    );
    this.name = 'SeatReclaimRequiredError';
    this.studentUid = studentUid;
    this.seatReleasedAt = seatReleasedAt;
  }
}

/**
 * Apply payment validity to a student profile.
 * Encapsulates the business rule: older payment cannot overwrite newer validity.
 * This is a domain capability — Payment calls this, not update() directly.
 */
export async function applyPaymentValidity(
  studentUid: string,
  payment: {
    valid_until?: string | null;
    session_start_year?: number | null;
    session_end_year?: number | null;
  }
): Promise<boolean> {
  const student = await getByUid(studentUid);
  if (!student) return false;

  // LC-01 GUARD: If the student's seat was released during a soft-block
  // (SEAT_RELEASE_AT_SOFT_BLOCK=true path), reactivating via a simple status
  // update would make the student active and entitled while the bus load counter
  // remains decremented.  The reconciler (occupiesSeat, admin-reconcile-bus-loads.ts:69)
  // also excludes seat-released students, so the under-count would be cemented
  // by the next integrity sweep → over-allocation.
  //
  // The correct reactivation for a seat-released student is through the renewal
  // approval flow (approve_renewal_with_seat RPC), which atomically reclaims
  // capacity and clears the seatReleasedAt marker in one DB transaction.
  if ((student as any).seatReleasedAt) {
    console.error(
      `[applyPaymentValidity] Refused to reactivate ${studentUid}: seat was released ` +
      `(seatReleasedAt=${(student as any).seatReleasedAt}).  ` +
      `Use the renewal approval path (approve_renewal_with_seat) to atomically ` +
      `reclaim the bus seat and restore the student to active.`
    );
    throw new SeatReclaimRequiredError(studentUid, String((student as any).seatReleasedAt));
  }

  const newValidUntil = payment.valid_until ? new Date(payment.valid_until) : null;
  const existingValidUntil = (student as any).validUntil
    ? new Date((student as any).validUntil)
    : null;

  // Invariant: older payment cannot overwrite newer validity
  const finalValidUntil = (existingValidUntil && newValidUntil && existingValidUntil > newValidUntil)
    ? existingValidUntil
    : newValidUntil;
  const finalSessionEndYear = ((student as any).sessionEndYear && payment.session_end_year && (student as any).sessionEndYear > payment.session_end_year)
    ? (student as any).sessionEndYear
    : payment.session_end_year;

  let softBlock: string | undefined;
  let hardBlock: string | undefined;

  if (finalValidUntil) {
    try {
      const deadlineConfig = await getDeadlineConfig();
      const blockDates = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);
      softBlock = (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as any)?.toISOString());
      hardBlock = (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as any)?.toISOString());
    } catch (e) {
      console.error('Failed to compute block dates in applyPaymentValidity:', e);
    }
  }

  await update(studentUid, {
    validUntil: finalValidUntil?.toISOString() || undefined,
    softBlock,
    hardBlock,
    sessionStartYear: payment.session_start_year || (student as any).sessionStartYear,
    sessionEndYear: finalSessionEndYear,
    status: 'active',
  } as any);
  return true;
}


import { invalidateStudentAssignment } from './student-assignment-cache';

export async function update(id: string, data: Partial<Student>): Promise<void> {
  await studentRepository.update(id, data);
  invalidateStudentAssignment(id).catch(() => {});
}

export async function remove(id: string): Promise<void> {
  await studentRepository.remove(id);
  invalidateStudentAssignment(id).catch(() => {});
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  return studentRepository.unassignRoute(routeId);
}


export async function getPaymentHistory(uid: string, enrollmentId?: string) {
  return paymentsSupabaseService.getPaymentsByStudentUid(uid);
}

export async function getProfile(uid: string): Promise<Student | null> {
  return getByUid(uid);
}
```

#### 2. Academic Session Categorisation & Upcoming Eligibility Logic: `src/lib/utils/application-eligibility.ts` (Lines 1–225)
```typescript
import { Application, ApplicationFormData, ApplicationType, TargetSession } from '@/lib/types/application';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { getCachedActiveConfig } from '@/domains/calendar';

export type ApplicationCandidate = (Partial<Omit<Application, 'formData'>> & {
  formData?: Partial<ApplicationFormData> | Record<string, any>;
}) & Record<string, any>;

/**
 * Phase 2 — Future-session eligibility.
 *
 * LOCKED RULE: eligibleApproval = softBlock(targetSession.startYear) + 1 day.
 *
 * A future-session application waits for the seats currently owned by the
 * OUTGOING session. Those seats are released (Phase 1) when that session's
 * students are soft-blocked. The soft-block date for a session ending in June of
 * year S is computed by `computeBlockDatesFromValidUntil` as the soft-block
 * month/day of year S. Therefore a future application whose service begins in
 * year S becomes approvable the day AFTER that soft block.
 *
 * The resolved date is FROZEN into the application document at creation time so
 * eligibility is deterministic and immune to later deadline-config edits.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the eligibleApproval ISO timestamp for a future-session application.
 *
 * @param targetStartYear the year service begins (targetSession.startYear)
 * @param config the deadline configuration in effect at creation time
 */
export function computeFutureEligibleApproval(
  targetStartYear: number,
  config: DeadlineConfig
): string {
  if (!config) throw new Error('Config required for computeFutureEligibleApproval');

  // Reuse the EXACT Phase 1 soft-block computation. The soft block of the
  // outgoing session occurs in the validUntil year; for a future application the
  // relevant year is the target start year (the outgoing students' validUntil
  // falls in June of that year). A proxy validUntil in that year yields the
  // identical soft-block date used by the seat-release path.
  const anchorMonth = config.academicYear.anchorMonth;
  const anchorDay = config.academicYear.anchorDay;
  const proxyValidUntil = new Date(
    Date.UTC(targetStartYear, anchorMonth, anchorDay, 23, 59, 59, 999)
  ).toISOString();

  const { softBlock } = computeBlockDatesFromValidUntil(proxyValidUntil, config);

  // +1 day: the application is approvable the day after seats are released.
  const eligible = new Date(new Date(softBlock).getTime() + ONE_DAY_MS);
  return eligible.toISOString();
}

export function extractApplicationStartYear(app: ApplicationCandidate): number {
  if (!app) return 0;
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const sessionInfo = formData.sessionInfo || formData.session_info || {};
  return Number(
    app.sessionStartYear ||
    app.session_start_year ||
    app.targetSession?.startYear ||
    app.target_session?.start_year ||
    formData.sessionStartYear ||
    formData.startYear ||
    formData.session_start_year ||
    formData.start_year ||
    sessionInfo.sessionStartYear ||
    sessionInfo.startYear ||
    sessionInfo.session_start_year ||
    sessionInfo.start_year ||
    0
  );
}

export function calculateAcademicSessionStartYear(
  now: Date = new Date(),
  config?: DeadlineConfig | { academicSessionStart?: { month?: number; day?: number } }
): number {
  const cached = !config ? getCachedActiveConfig() : null;
  const effectiveConfig = config || cached;
  const startMonth = effectiveConfig?.academicSessionStart?.month ?? 6; // Configured month or July (0-indexed default)
  const startDay = effectiveConfig?.academicSessionStart?.day ?? 1;
  const thisYear = now.getUTCFullYear();
  const sessionStartThisYear = new Date(Date.UTC(thisYear, startMonth, startDay, 0, 0, 0, 0));
  return now.getTime() >= sessionStartThisYear.getTime() ? thisYear : thisYear - 1;
}

/**
 * Resolve an application's type, defaulting legacy/absent values to 'fresh'.
 * Legacy applications created before Phase 2 carry no discriminator and are, by
 * definition, current-session fresh applications.
 */
export function resolveApplicationType(
  app: ApplicationCandidate,
  now: Date = new Date(),
  config?: DeadlineConfig
): ApplicationType {
  if (!app) return 'fresh';
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const explicitType = app.applicationType || app.application_type || formData.applicationType || formData.application_type;

  const startYear = extractApplicationStartYear(app);
  const currentSessionStartYear = calculateAcademicSessionStartYear(now, config);

  const eligibleApprovalTime = app.eligibleApproval ? new Date(app.eligibleApproval).getTime() : 0;
  const isEligibleApprovalInFuture = eligibleApprovalTime > 0 && eligibleApprovalTime > now.getTime();

  // If the application state is submitted, draft, or unapproved, and its target session has arrived
  // (startYear <= currentSessionStartYear) and eligibleApproval has arrived, it must resolve to fresh
  // so it is no longer trapped in 'future' mode.
  const isUnactivatedState = !app.state || app.state === 'submitted' || app.state === 'draft';
  if (isUnactivatedState && startYear > 0 && startYear <= currentSessionStartYear && !isEligibleApprovalInFuture) {
    if (explicitType === 'renewal' || explicitType === 'renewal_after_soft_block') {
      return explicitType as ApplicationType;
    }
    return 'fresh';
  }

  if (explicitType === 'future' || explicitType === 'renewal' || explicitType === 'renewal_after_soft_block' || explicitType === 'fresh') {
    return explicitType as ApplicationType;
  }

  if (startYear > currentSessionStartYear || isEligibleApprovalInFuture) {
    return 'future';
  }

  return 'fresh';
}

/**
 * Whether an application is approvable RIGHT NOW with respect to the locked
 * eligibility rule. This is purely the date/eligibility gate — it does NOT make
 * any statement about capacity, which remains enforced atomically at approval.
 *
 * Legacy/absent eligibleApproval ⇒ immediately eligible (fresh/renewal).
 *
 * @param app the application document
 * @param now optional clock injection for testing
 */
export function isApprovalEligible(
  app: Pick<Application, 'eligibleApproval'>,
  now: Date = new Date()
): boolean {
  if (!app.eligibleApproval) return true;
  return new Date(app.eligibleApproval).getTime() <= now.getTime();
}

/**
 * DERIVED upcoming-lifecycle status (Phase 2).
 *
 * Future-session ("upcoming") applications are NOT modelled with extra stored
 * Firestore states. They live in `state: 'submitted'` like any other application;
 * the ONLY thing holding them back is the frozen `eligibleApproval` date gate
 * (enforced server-side in both approval routes via `isApprovalEligible`).
 *
 * This function projects that single frozen date into the two human-facing
 * lifecycle labels the UI shows, so there is exactly one source of truth (the
 * date) and no mutable state to migrate or keep in sync:
 *
 *   - 'waiting_for_eligibility'  : now <  eligibleApproval  (seats not yet freed)
 *   - 'eligible_for_approval'    : now >= eligibleApproval  (approvable now)
 *
 * It is intentionally a pure projection of `isApprovalEligible` so the label can
 * never disagree with the server-side approval gate.
 */
export type UpcomingStatus = 'waiting_for_eligibility' | 'eligible_for_approval';

export function getUpcomingStatus(
  app: Pick<Application, 'eligibleApproval'>,
  now: Date = new Date()
): UpcomingStatus {
  return isApprovalEligible(app, now) ? 'eligible_for_approval' : 'waiting_for_eligibility';
}

/**
 * Whether an application is a future-session ("upcoming") application.
 * Centralised so UI and server agree on the single discriminator.
 */
export function isUpcomingApplication(
  app: ApplicationCandidate,
  now: Date = new Date(),
  config?: DeadlineConfig
): boolean {
  if (!app) return false;

  // SEAM FIX 1: Renewals are for existing students extending service.
  // They must NEVER be hijacked into verified_upcoming!
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const explicitType = app.applicationType || app.application_type || formData.applicationType || formData.application_type;
  if (explicitType === 'renewal' || explicitType === 'renewal_after_soft_block') {
    return false;
  }
  const resolvedType = resolveApplicationType(app, now, config);
  if (resolvedType === 'renewal' || resolvedType === 'renewal_after_soft_block') {
    return false;
  }

  if (app.state === 'verified_upcoming' || app.state === 'pending_seat_allocation') {
    return true;
  }

  const startYear = extractApplicationStartYear(app);
  const currentSessionStartYear = calculateAcademicSessionStartYear(now, config);
  const eligibleApprovalTime = app.eligibleApproval ? new Date(app.eligibleApproval).getTime() : 0;
  const isEligibleApprovalInFuture = eligibleApprovalTime > 0 && eligibleApprovalTime > now.getTime();

  // Once the target session start date/year has arrived (startYear <= currentSessionStartYear and eligibleApproval <= now),
  // an application in state 'submitted' or 'draft' is no longer upcoming. Application.approve must activate immediately!
  if (startYear > 0 && startYear <= currentSessionStartYear && !isEligibleApprovalInFuture) {
    return false;
  }

  if (resolveApplicationType(app, now, config) === 'future') {
    return true;
  }

  if (startYear > currentSessionStartYear || isEligibleApprovalInFuture) {
    return true;
  }

  return false;
}

/**
 * Build the eligibleApproval timestamp for ANY application type at creation.
 * 'fresh'/'renewal' are immediately eligible (creation time); 'future' uses the
 * locked soft-block(+1 day) rule.
 */
export function resolveEligibleApprovalAtCreation(
  type: ApplicationType,
  targetSession: TargetSession,
  config: DeadlineConfig,
  nowIso: string
): string {
  if (type === 'future') {
    return computeFutureEligibleApproval(targetSession.startYear, config);
  }
  return nowIso;
}

/**
 * Derive the Phase 2 categorisation fields for a NEW (fresh/future) application
 * from its chosen session, at creation/submission time.
 *
 * An application is 'future' when its service-start year is greater than the
 * current academic-session start year. The current session start year is the
 * calendar year of "now" when on/after the academic anchor (July), otherwise the
 * previous calendar year — derived purely from the deadline-config anchor, so no
 * separate global session pointer is needed.
 *
 * Renewal applications are categorised by the renewal flow itself, not here.
 *
 * @returns the three fields to merge into the application document.
 */
export function deriveCreationCategorisation(
  sessionStartYear: number,
  sessionEndYear: number,
  config: DeadlineConfig,
  nowIso: string
): { applicationType: ApplicationType; targetSession: TargetSession; eligibleApproval: string } {
  const now = new Date(nowIso);
  const currentSessionStartYear = calculateAcademicSessionStartYear(now, config);

  const targetSession: TargetSession = { startYear: sessionStartYear, endYear: sessionEndYear };
  const applicationType: ApplicationType =
    sessionStartYear > currentSessionStartYear ? 'future' : 'fresh';
  const eligibleApproval = resolveEligibleApprovalAtCreation(
    applicationType,
    targetSession,
    config,
    nowIso
  );

  return { applicationType, targetSession, eligibleApproval };
}
```

#### 3. Upcoming Application Verification & Intercept: `src/domains/application/services/application.service.ts`
```typescript
// Lines 264-320: verifyUpcoming implementation
 */
export async function verifyUpcoming(
  applicationId: string,
  verifierData: { uid: string; name: string; role: string },
  notes?: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const app = await repository.findByApplicationId(applicationId);
  if (!app) {
    return { success: false, error: 'Application not found', status: 404 };
  }

  if (app.state !== 'submitted' && app.state !== 'draft') {
    return { success: false, error: `Application in state '${app.state}' cannot be verified`, status: 400 };
  }

  const now = new Date().toISOString();

  await repository.update(applicationId, {
    state: 'verified_upcoming',
    verifiedUpcomingAt: now,
    verifiedUpcomingBy: verifierData.name,
    verifiedUpcomingById: verifierData.uid,
    updatedAt: now,
    stateHistory: [
      ...(app.stateHistory || []),
      { state: 'verified_upcoming', timestamp: now, actor: verifierData.uid }
    ]
  });

  void createAuditEvent({
    action: 'application_verified_upcoming',
    actor_id: verifierData.uid,
    actor_name: verifierData.name,
    actor_role: verifierData.role,
    target_id: applicationId,
    target_type: 'application',
    target_name: app.formData?.fullName || app.applicantEmail || '',
    category: 'applications',
    summary: `Verified upcoming session application for ${app.formData?.fullName || app.applicantEmail || ''}`,
    severity: 'medium',
    metadata: {
      applicationId,
      sessionStartYear: (app as any).sessionStartYear || app.targetSession?.startYear,
      notes,
    }
  });

  return { success: true };
}

/**
 * Approve an application. Orchestrates:
 * 1. Application RPC (validate + lock + return payload)
 * 2. Student activation (identity for fresh, update for renewal)
 * 3. Seat reclamation (renewal_after_soft_block only)
 * 4. Payment (idempotent)
 * 5. Audit (idempotent)

// Lines 346-435: Upcoming intercept and atomic renewal capacity assignment
  const app = rpcResult.application;

  // Intercept upcoming applications: verifying an upcoming application MUST NOT create a student
  // profile or consume bus capacity. It transitions state to 'verified_upcoming' only.
  if (isUpcomingApplication(app) && app.state === 'submitted') {
    try {
      await db.rpc('release_application_lock', { p_application_id: applicationId });
    } catch {}
    const verifyResult = await verifyUpcoming(applicationId, approverData, notes);
    if (!verifyResult.success) {
      return verifyResult;
    }
    return {
      success: true,
      studentUid: app.applicant_uid,
    };
  }

  const isRenewal = app.application_type === 'renewal' || app.application_type === 'renewal_after_soft_block';
  let seatCompensation: { busId: string; studentId: string; shift: string } | null = null;

  try {
    let studentData: Record<string, any> | null = null;
    let studentDataForRpc: Record<string, any> | null = null;
    let renewalAlreadyFinalized = false;

    if (isRenewal) {
      // ── RENEWAL PATH ──────────────────────────────────────────────
      // Use new atomic RPC: approve_renewal_with_seat handles capacity check +
      // seat increment + student update + application finalization in one TX.
      // Fixes race condition where concurrent renewals could over-allocate.
      const student = await Student.getByUid(app.applicant_uid);
      if (!student) throw new Error('Student not found for renewal');

      const fd = app.form_data || {};
      const durationYears = Number(fd.durationYears || fd.targetSession?.durationYears || 1);
      const now = new Date();
      const deadlineConfig = await getDeadlineConfig();

      // Compute renewal validity (max-of-old-and-new invariant)
      const existingValidUntil = (student as any).validUntil
        ? new Date((student as any).validUntil)
        : null;
      let baseYear = now.getUTCFullYear();
      if (existingValidUntil && existingValidUntil > now) {
        baseYear = (student as any).sessionEndYear || existingValidUntil.getUTCFullYear();
      }
      const newValidUntil = calculateValidUntilDate(baseYear, durationYears, deadlineConfig);
      const finalValidUntil = (existingValidUntil && existingValidUntil > newValidUntil)
        ? existingValidUntil
        : newValidUntil;
      const newSessionEndYear = baseYear + durationYears;
const finalSessionEndYear = ((student as any).sessionEndYear && (student as any).sessionEndYear > newSessionEndYear)
        ? (student as any).sessionEndYear
        : newSessionEndYear;
      const originalStartYear = (student as any).sessionStartYear || baseYear;
      const totalDuration = Math.max(finalSessionEndYear - originalStartYear, (student as any).durationYears || 0);
      const blockDates: { softBlock: string; hardBlock: string } = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);

      const seatWasReleased = !!(student as any).seatReleasedAt;
      const renewalBusId = overrides?.busId || (student as any).busId || (student as any).currentBusId || null;
      const studentShift = normalizeShift((student as any).shift || app.shift);
      if (!studentShift) {
        throw new Error('Student record is missing a valid shift assignment.');
      }

      let studentDataForRenewalRpc: Record<string, any> | null = null;

      // FIX (APP-04): If student's seat was released during soft-block, ANY renewal
      // must atomically reclaim capacity on the bus and clear seat_released_at.
      if (isRenewal && seatWasReleased && renewalBusId) {
        // Atomic RPC: capacity check + increment + student update + app finalize
        const { data: rpcResult, error: rpcError } = await db.rpc('approve_renewal_with_seat', {
          p_application_id: applicationId,
          p_approver_uid: approverData.uid,
          p_student_uid: app.applicant_uid,
          p_bus_id: renewalBusId,
          p_shift: studentShift,
          p_valid_until: finalValidUntil.toISOString(),
          p_session_end_year: finalSessionEndYear,
          p_session_duration: String(totalDuration),
          p_soft_block: (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as Date)?.toISOString()) || null,
          p_hard_block: (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as Date)?.toISOString()) || null,
        });

        if (rpcError || !rpcResult?.success) {
          throw new Error(rpcResult?.error || rpcError?.message || 'Renewal with seat assignment failed');
        }
        // RPC succeeded — student updated, capacity incremented, application finalized
        // No need to call finalize_application_approval separately
```

#### 4. Atomic Renewal Seat Assignment & Capacity Check RPC: `supabase/COMPLETE_SCHEMA.sql`
```sql
-- Lines 2165-2265: approve_renewal_with_seat PL/pgSQL RPC
--       p_valid_until, p_session_end_year, p_session_duration, p_soft_block, p_hard_block
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_application_id  TEXT,
    p_approver_uid    TEXT,
    p_student_uid     TEXT,
    p_bus_id          TEXT,
    p_shift           TEXT,
    p_valid_until     TIMESTAMPTZ,
    p_session_end_year INTEGER,
    p_session_duration TEXT,
    p_soft_block      TIMESTAMPTZ DEFAULT NULL,
    p_hard_block      TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized_shift TEXT;
    v_bus              RECORD;
    v_student          RECORD;
    v_new_morning      INTEGER;
    v_new_evening      INTEGER;
    v_student_updated  INTEGER;
    v_app_updated      INTEGER;
BEGIN
    -- 1. Validate shift
    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid shift: ' || COALESCE(p_shift, 'NULL'));
    END IF;

    -- 2. Lock student profile row to preserve exact original state for rollback compensation
    SELECT uid, status, valid_until, session_end_year, session_duration, soft_block, hard_block, seat_released_at, last_processed_application_id
    INTO v_student
    FROM student_profiles
    WHERE uid = p_student_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found: ' || p_student_uid);
    END IF;

    -- 3. Lock bus row and check capacity atomically
    SELECT id, capacity, morning_load, evening_load
    INTO v_bus
    FROM buses
    WHERE id = p_bus_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus ' || p_bus_id || ' not found');
    END IF;

    -- 4. Verify capacity has room
    IF v_normalized_shift = 'morning' THEN
        IF v_bus.morning_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load + 1;
        v_new_evening := v_bus.evening_load;
    ELSIF v_normalized_shift = 'evening' THEN
        IF v_bus.evening_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load;
        v_new_evening := v_bus.evening_load + 1;
    ELSE -- 'both'
        IF v_bus.morning_load >= v_bus.capacity OR v_bus.evening_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load + 1;
        v_new_evening := v_bus.evening_load + 1;
    END IF;

    -- 5. Increment bus capacity
    UPDATE buses
    SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = p_bus_id;

    -- 6. Update student profile (re-activate, extend validity)
    UPDATE student_profiles SET
        status           = 'active',
        valid_until      = p_valid_until,
        session_end_year = p_session_end_year,
        session_duration = p_session_duration,
        soft_block       = p_soft_block,
        hard_block       = p_hard_block,
        seat_released_at = NULL,
        last_processed_application_id = p_application_id,
        updated_at       = NOW()
    WHERE uid = p_student_uid;
    GET DIAGNOSTICS v_student_updated = ROW_COUNT;

    IF v_student_updated <> 1 THEN
        -- Compensate bus capacity
        UPDATE buses
        SET morning_load = v_bus.morning_load, evening_load = v_bus.evening_load, current_members = v_bus.morning_load + v_bus.evening_load, updated_at = NOW()
        WHERE id = p_bus_id;
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found or not updated: ' || p_student_uid);
    END IF;

    -- 7. Finalize application → approved (preserve for audit trail)
    UPDATE applications SET

-- Lines 1789-1845: bus_increment_capacity PL/pgSQL RPC
CREATE OR REPLACE FUNCTION cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 600)
RETURNS TABLE(
  cleaned_trip_id UUID,
  cleaned_bus_id TEXT,
  cleaned_driver_id TEXT
) AS $$
DECLARE
  v_trip RECORD;
BEGIN
  FOR v_trip IN
    SELECT at.trip_id, at.bus_id, at.driver_id, at.route_id, at.shift, at.start_time
    FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL
  LOOP
    INSERT INTO public.driver_trip_history (
      trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
    ) VALUES (
      v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
      'completed', 'completed_stale', v_trip.start_time, NOW(),
      GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_trip.start_time))::INTEGER)
    )
    ON CONFLICT (trip_id) DO NOTHING;

    DELETE FROM public.active_trips
    WHERE active_trips.trip_id = v_trip.trip_id;
    
    RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================

-- ── 7.5 Operational Trip & Session Lifecycle Functions ─────────────────────────

-- end_trip_atomically: deletes active_trips lock and records history in a single atomic transaction
-- with short-trip discard guard (p_min_duration_seconds).
DROP FUNCTION IF EXISTS public.end_trip_atomically(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
  p_trip_id TEXT,
  p_bus_id  TEXT,
  p_driver_id TEXT,
  p_min_duration_seconds INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_dur_sec INTEGER;
  v_status  TEXT := 'completed';
  v_reason  TEXT := 'completed';
BEGIN
  SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
    INTO v_trip
    FROM active_trips
   WHERE trip_id    = p_trip_id::uuid
```

---



---

# PART 8: Transport Entitlement Enforcement Gate & Cross-Process Cache Invalidation

### 8.1 Sub-Domain Architecture & Exact Execution Pipeline

The Transport Entitlement Enforcement Gate serves as the canonical, authoritative security perimeter controlling commuter access across the platform:
- Protected Student API Routes (`/api/student/trip-status`, `/api/student/waiting-flag`, `/api/bus-pass/*`)
- Real-Time WebSocket Telematics Cluster (`ws1` node cluster `presence` handshake)

To eliminate severe database read amplification (thousands of commuters querying their entitlement and bus assignment every few seconds during morning/evening commute windows), the platform implements an **L1 Memory + L2 Redis Hierarchical Cache** with **Immediate Distributed Pub/Sub Cache Invalidation**.

```
                          STUDENT REQUEST / WEBSOCKET HANDSHAKE
                                            │
                                            ▼
                           requireTransportEntitlement(uid)
                                            │
                                            ▼
                           getCachedStudentAssignment(uid)
                                            │
                  ┌─────────────────────────┴─────────────────────────┐
                  │                                                   │
         [1. L1 Memory Cache]                                [2. Singleflight Deduplication]
       assignmentL1Cache.get(uid)                           inFlightFetches.get(uid)
       (2,500 entries, 5-min TTL)                           (Deduplicates simultaneous storms)
                  │                                                   │
             Cache Miss?                                         Cache Miss?
                  │                                                   │
                  └─────────────────────────┬─────────────────────────┘
                                            │
                                            ▼
                                   [3. L2 Redis Cache]
                               GET student:assign:<uid> (300s TTL)
                                            │
                                       Cache Miss?
                                            │
                                            ▼
                                [4. Authoritative Database]
                         SELECT ... FROM student_profiles WHERE uid = ?
                                            │
                         Populate L1 Memory + SET student:assign:<uid>
                                            │
                                            ▼
                             getTransportEntitlement(student)
                                            │
       ┌────────────────────────────────────┴────────────────────────────────────┐
       │                                                                         │
 [NON-ENTITLED]                                                              [ENTITLED]
 - status !== 'active' ('soft_blocked', 'inactive')                      - status === 'active'
 - now >= softBlock ('past_soft_block')                                  - now < softBlock
 - now >= validUntil ('expired')                                         - Incomplete legacy with active status
 - status === 'verified_upcoming'                                                  │
 - status === 'pending_seat_allocation'                                            ▼
 - status === 'submitted'                                                 Return { ok: true, student }
       │
       ▼
 Return HTTP 403 Forbidden { error, entitled: false, reason }
 (Or close WebSocket frame with 4403 policy violation)
```

---

### 8.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/lib/entitlement/transport-entitlement.ts` | `getTransportEntitlement`, `hasTransportEntitlement`, `toDate`, `ENTITLEMENT_MESSAGES` | `require-transport-entitlement.ts`, `verify-secure-qr`, `verify-student`, UI pass pages | Pure isomorphic date & state evaluation | None (Zero I/O, zero network) |
| `src/lib/entitlement/require-transport-entitlement.ts` | `requireTransportEntitlement` | Protected student API routes (`/api/student/trip-status`, `/api/student/waiting-flag`) | `getCachedStudentAssignment`, `getTransportEntitlement`, `getByUid` | Reads L1 memory cache, L2 Redis, or `public.student_profiles` |
| `src/domains/student/services/student-assignment-cache.ts` | `getCachedStudentAssignment`, `invalidateStudentAssignment`, `clearStudentAssignmentMemoryCache` | `requireTransportEntitlement`, `student.service.ts` (`update`, `remove`), `fleet.repository.pg.ts` | `executeGpsRedisCommand`, `getSupabaseServer`, `publishRoleInvalidation` | Mutates in-memory `assignmentL1Cache`; Mutates Redis key `student:assign:<uid>`; Publishes to Redis channel `student_assign_invalidate` |
| `server/redis-broadcast.ts` | `handleStudentAssignInvalidation`, `setupRedisSecurityListeners` | Node.js WebSocket cluster (`server/index.ts`) | `redisPubSub.subscribe`, `socket-router.clearStudentPresenceCache` | Evicts WebSocket in-memory connection presence caches across all cluster nodes |

---

### 8.3 Method-by-Method Low-Level Walkthrough

#### 1. Pure Canonical Entitlement Engine: `getTransportEntitlement` (`src/lib/entitlement/transport-entitlement.ts`)
- **Signature:** `getTransportEntitlement(student: EntitlementStudentLike | null | undefined, now: Date = new Date()): EntitlementResult`
- **Input Object Structure:**
  - `status`: string (`'active'`, `'soft_blocked'`, `'hard_blocked'`, `'pending_deletion'`, `'inactive'`, `'submitted'`, `'verified_upcoming'`, `'pending_seat_allocation'`)
  - `softBlock`: string | Date | Firestore Timestamp (Authoritative Phase 1 seat-release boundary)
  - `validUntil`: string | Date | Firestore Timestamp (Service validity end)
- **Control Flow & Rule Hierarchy:**
  1. **Account Check:** If `!student`, returns `{ entitled: false, reason: 'no_account' }`.
  2. **Interim State Gates:**
     - If `status === 'verified_upcoming'`: Returns `{ entitled: false, reason: 'verified_upcoming' }` (future session commuter awaiting session start date).
     - If `status === 'pending_seat_allocation'`: Returns `{ entitled: false, reason: 'pending_seat_allocation' }` (paid but awaiting bus capacity opening).
     - If `status === 'submitted'`: Returns `{ entitled: false, reason: 'application_submitted' }` (under admin review).
  3. **Lifecycle State Gate:**
     - Evaluates `effectiveStatus`. If `effectiveStatus !== 'active'`, returns `{ entitled: false, reason: 'inactive_status' }`.
  4. **Phase 1 Authoritative Boundary (`softBlock`):**
     - Coerces `student.softBlock` to `Date`.
     - If `softBlock > now`: Returns `{ entitled: true, reason: 'entitled' }`.
     - If `softBlock <= now`: Returns `{ entitled: false, reason: 'past_soft_block' }` (seat has been released, transport access denied).
  5. **Legacy Fallback (`validUntil` without `softBlock`):**
     - If `validUntil > now`: Returns `{ entitled: true, reason: 'entitled' }`.
     - If `validUntil <= now`: Returns `{ entitled: false, reason: 'expired' }`.
  6. **Legacy Safety Net:** Active student with zero date fields yields `{ entitled: true, reason: 'entitled_legacy_incomplete' }` (fail-open for legacy accounts until backfilled).

---

#### 2. Hierarchical Cache: `getCachedStudentAssignment` (`src/domains/student/services/student-assignment-cache.ts`)
- **Hierarchy:** L1 In-Memory LRU (2,500 items, 300s TTL) $
ightarrow$ L2 Redis (`student:assign:<uid>`, 300s TTL) $
ightarrow$ PostgreSQL (`student_profiles`).
- **Singleflight Deduplication:**
  - Uses `inFlightFetches = new Map<string, Promise<CachedStudentAssignment | null>>()`.
  - If 50 concurrent requests arrive for the same `uid` on a cache miss, only 1 database query is executed; all 50 callers await the identical promise.
- **Cache Payload:**
  ```typescript
  { uid, fullName, busId, routeId, shift, stopName, status, softBlock, validUntil, hardBlock, cachedAtMs }
  ```
- **Database Query:**
  ```sql
  SELECT uid, full_name, bus_id, route_id, shift, stop_name, status, soft_block, valid_until, hard_block
  FROM student_profiles
  WHERE uid = $1 OR enrollment_id = $1
  LIMIT 1;
  ```

---

#### 3. Cross-Process Distributed Cache Invalidation Trace
- **When a student's status changes:**
  - Transition from `soft_blocked` to `active` upon renewal approval.
  - Transition from `active` to `soft_blocked` upon daily cron execution.
  - Reassignment to a different vehicle or route.
- **The Execution Trace:**
  1. `student.service.ts:update(uid, data)` (or fleet reassignment) invokes `invalidateStudentAssignment(uid)`.
  2. Local Invalidation:
     - `assignmentL1Cache.delete(uid)` deletes the local memory entry.
     - `inFlightFetches.delete(uid)` cancels in-flight fetch promises.
  3. L2 Redis Key Eviction:
     - Executes `DEL student:assign:<uid>`.
  4. Distributed Pub/Sub Notification:
     - Executes `PUBLISH student_assign_invalidate <uid>`.
  5. WebSocket Cluster Node Ingestion (`server/redis-broadcast.ts`):
     - Background listener `handleStudentAssignInvalidation` catches the message.
     - Calls `socket-router.clearStudentPresenceCache(uid)`.
     - WebSocket router immediately evicts in-memory presence and entitlement state.
     - Next WebSocket ping/frame or HTTP API call triggers an immediate re-fetch from PostgreSQL, ensuring zero 5-minute stale entitlement windows!

---

### 8.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) L1 Memory Cache Hit (`requireTransportEntitlement`)** | **0 DB Queries** | **0 Redis Commands** | **0** | **0 I/O Ops** (Zero latency in-memory hit) |
| **(b) L2 Redis Cache Hit (L1 Miss / Node Restart)** | **0 DB Queries** | **1 Redis Command:**<br>1. `GET student:assign:<uid>` | **0** | **1 I/O Op** (~1ms latency) |
| **(c) Cold Cache Miss (L1 Miss + L2 Miss)** | **1 DB Query:**<br>1. Select `student_profiles` by UID/enrollment ID | **2 Redis Commands:**<br>1. `GET student:assign:<uid>` (miss)<br>2. `SET student:assign:<uid> EX 300` (fire-and-forget populate) | **0** | **3 I/O Ops** |
| **(d) Student Reassignment / Renewal Approval Invalidation** | **0 DB Queries** (Invalidation itself) | **3 Redis Commands:**<br>1. `DEL student:assign:<uid>`<br>2. `PUBLISH student_assign_invalidate <uid>`<br>3. `PUBLISH role_invalidate <uid>` | **0** | **3 I/O Ops** |

---

### 8.5 Verbatim Source Code from Live Codebase

#### 1. Canonical Entitlement Engine: `src/lib/entitlement/transport-entitlement.ts`
```typescript
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3 — CANONICAL TRANSPORT ENTITLEMENT (single source of truth)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module answers exactly ONE question for the whole system:
 *
 *     "Does this user currently OWN transport access right now?"
 *
 * Every transport-related decision — dashboard widgets, navigation, protected
 * routes, realtime subscriptions, provider init, QR generation, QR verification,
 * tracking, trip/route access, and the server APIs behind them — MUST derive its
 * answer from `getTransportEntitlement` / `hasTransportEntitlement` here. No screen
 * or API may invent its own rule (no `status`-alone, no `validUntil`-alone checks).
 *
 * BUSINESS RULE (locked):
 *   entitled = (status === 'active') AND (now < soft-block boundary)
 *
 *   - The soft-block boundary is the SAME lifecycle boundary that releases the
 *     student's seat capacity in Phase 1 (`student.softBlock`, an ISO timestamp).
 *     Entitlement therefore tracks seat ownership exactly: once the seat is
 *     released at soft block, transport entitlement is gone.
 *   - `seatReleasedAt` is a Phase-1 CAPACITY marker, NOT a business-state
 *     determinant. It is intentionally NOT consulted here: a stale marker must
 *     never deny an otherwise-legitimately-active student. Capacity correctness
 *     for stale markers is handled by Phase-1 reconciliation, not by denying
 *     access.
 *
 * ISOMORPHIC + CONFIG-FREE:
 *   Pure function over the student document's own fields. No Firestore, no
 *   deadline-config, no network. Identical result on client and server. Admin
 *   date-simulation remains a cron/back-office concern and does not affect a live
 *   student's entitlement (always evaluated against the real clock).
 *
 * LEGACY-DATA SAFETY (see fallback below): an active student is denied ONLY when a
 * positive date signal proves they are past their boundary. Missing `softBlock`
 * alone never denies access.
 */

export type EntitlementReason =
  | 'entitled'                    // active and within the soft-block boundary
  | 'entitled_legacy_incomplete'  // active but no date fields at all → granted, flag for backfill
  | 'no_account'                  // no student record
  | 'inactive_status'             // status !== 'active' (soft_blocked / hard_blocked / pending_deletion / suspended / inactive)
  | 'past_soft_block'             // status active but past the stored soft-block boundary
  | 'expired'                     // legacy record with no softBlock, past validUntil
  | 'verified_upcoming'           // Future-session application verified/approved by admin, awaiting session start
  | 'pending_seat_allocation'     // Application verified & paid, in seat queue
  | 'application_submitted';      // Application submitted, under admin review

export interface EntitlementResult {
  entitled: boolean;
  reason: EntitlementReason;
}

/** Minimal structural shape this module needs. Accepts `User` and `Student`. */
export interface EntitlementStudentLike {
  status?: string | null;
  /** Phase-1 stored soft-block boundary (ISO string | Firestore Timestamp | Date). */
  softBlock?: unknown;
  /** Service validity end (ISO string | Firestore Timestamp | Date). */
  validUntil?: unknown;
  [key: string]: unknown;
}

/**
 * Coerce the many shapes a date field can take (Firestore Timestamp with
 * `toDate()`, `{ seconds }`, ISO string, Date, ms number) into a `Date`.
 * Returns null for absent/invalid values.
 */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  // Firestore Timestamp instance
  if (typeof value === 'object' && value !== null) {
    const anyVal = value as { toDate?: () => Date; seconds?: number };
    if (typeof anyVal.toDate === 'function') {
      const d = anyVal.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof anyVal.seconds === 'number') {
      const d = new Date(anyVal.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * THE canonical entitlement determination. See module header for the rule.
 *
 * @param student the student document (or `User` with student fields), or null
 * @param now     injectable clock (defaults to real time)
 */
export function getTransportEntitlement(
  student: EntitlementStudentLike | null | undefined,
  now: Date = new Date()
): EntitlementResult {
  if (!student) return { entitled: false, reason: 'no_account' };

  const st = student.status || (student as any).state || (student as any).applicationState;

  if (st === 'verified_upcoming') {
    return { entitled: false, reason: 'verified_upcoming' };
  }
  if (st === 'pending_seat_allocation') {
    return { entitled: false, reason: 'pending_seat_allocation' };
  }
  if (st === 'submitted') {
    return { entitled: false, reason: 'application_submitted' };
  }

  // (1) Lifecycle state. Only an 'active' student can hold transport entitlement.
  // soft_blocked / hard_blocked / pending_deletion / suspended / inactive → denied.
  const effectiveStatus = st || (student.validUntil || student.softBlock || student.busId || student.role === 'student' ? 'active' : null);

  if (effectiveStatus !== 'active') {
    return { entitled: false, reason: 'inactive_status' };
  }

  // (2) Production path — authoritative Phase-1 soft-block boundary.
  const softBlock = toDate(student.softBlock);
  if (softBlock) {
    return softBlock > now
      ? { entitled: true, reason: 'entitled' }
      : { entitled: false, reason: 'past_soft_block' };
  }

  // (3) Legacy fallback — softBlock not populated (pre-Phase-1 records). Approximate
  // the boundary to validUntil. softBlock is always >= validUntil (it falls after
  // session end), so using validUntil here is strict/safe and never over-grants.
  const validUntil = toDate(student.validUntil);
  if (validUntil) {
    return validUntil > now
      ? { entitled: true, reason: 'entitled' }
      : { entitled: false, reason: 'expired' };
  }

  // (4) Active student with NO date fields at all = incomplete legacy data. Per the
  // locked rule, missing data MUST NOT strip access from an active student. Grant,
  // and surface a distinct reason so the cron/back-office can backfill softBlock.
  return { entitled: true, reason: 'entitled_legacy_incomplete' };
}

/** Boolean convenience wrapper around {@link getTransportEntitlement}. */
export function hasTransportEntitlement(
  student: EntitlementStudentLike | null | undefined,
  now: Date = new Date()
): boolean {
  return getTransportEntitlement(student, now).entitled;
}

/** Human-facing copy for each non-entitled reason. Reused by the lifecycle UI. */
export const ENTITLEMENT_MESSAGES: Record<EntitlementReason, { title: string; detail: string }> = {
  entitled: {
    title: 'Transport active',
    detail: 'Your bus transport access is active.',
  },
  entitled_legacy_incomplete: {
    title: 'Transport active',
    detail: 'Your bus transport access is active.',
  },
  no_account: {
    title: 'No transport account',
    detail: 'We could not find an active transport profile for your account.',
  },
  inactive_status: {
    title: 'Transport access paused',
    detail:
      'Your bus service is not active. Renew your service to restore transport access. Your account, profile, and payment history are unchanged.',
  },
  past_soft_block: {
    title: 'Renewal required',
    detail:
      'Your bus service period has ended and your seat has been released. Renew and get approved to restore transport access.',
  },
  expired: {
    title: 'Service expired',
    detail:
      'Your bus service validity has expired. Renew your service to restore transport access.',
  },
  verified_upcoming: {
    title: 'Application Verified (Awaiting Session Start)',
    detail:
      'Your application for the upcoming academic session has been verified and approved by administrators! Your bus pass and live tracking will automatically activate when the new academic session begins.',
  },
  pending_seat_allocation: {
    title: 'In Seat Allocation Queue',
    detail:
      'Your application and payment are verified! You are currently in the seat allocation queue. Your pass will activate as soon as a seat opens up.',
  },
  application_submitted: {
    title: 'Application Under Review',
    detail:
      'Your application has been submitted and is currently being reviewed by administrators. This usually takes 1-2 business days.',
  },
};

```

#### 2. Server-Side Entitlement Guard: `src/lib/entitlement/require-transport-entitlement.ts`
```typescript
import { getByUid } from '@/domains/student';
import { getCachedStudentAssignment } from '@/domains/student/services/student-assignment-cache';
import { NextResponse } from 'next/server';
import { EntitlementResult, getTransportEntitlement } from './transport-entitlement';

/**
 * Server-side guard for student transport API routes (Phase 3).
 *
 * Loads the student document from PostgreSQL and applies the CANONICAL
 * entitlement rule. Use this at the top of any API that delivers transport
 * data or actions (tracking, trip status, waiting flags,
 * driver notifications). Returns the student data on success, or a
 * ready-to-return 403 NextResponse when the caller does not currently
 * own transport access.
 *
 * Migration status: COMPLETED — reads from PostgreSQL (student_profiles).
 * Uses L1 memory + L2 Redis caching via getCachedStudentAssignment to
 * eliminate redundant student_profiles queries.
 *
 * Usage:
 *   const gate = await requireTransportEntitlement(auth.uid);
 *   if (!gate.ok) return gate.response;
 *   // ...gate.student is entitled
 */
export async function requireTransportEntitlement(
  uid: string
): Promise<
  | { ok: true; student: Record<string, any>; entitlement: EntitlementResult }
  | { ok: false; response: NextResponse }
> {
  let student: Record<string, any> | null = null;
  try {
    const cached = await getCachedStudentAssignment(uid);
    if (cached) {
      student = {
        uid: cached.uid,
        id: cached.uid,
        fullName: cached.fullName,
        busId: cached.busId,
        routeId: cached.routeId,
        shift: cached.shift,
        stopName: cached.stopName,
        status: cached.status,
        softBlock: cached.softBlock,
        validUntil: cached.validUntil,
        hardBlock: cached.hardBlock,
      };
    } else {
      student = await getByUid(uid) as Record<string, any> | null;
    }
  } catch {
    student = null;
  }

  const entitlement = getTransportEntitlement(student);
  if (!entitlement.entitled) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Transport access is not active for this account.',
          entitled: false,
          reason: entitlement.reason,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, student: student as Record<string, any>, entitlement };
}

```

#### 3. L1/L2 Hierarchical Assignment Cache & Invalidation: `src/domains/student/services/student-assignment-cache.ts`
```typescript
/**
 * Student Assignment Metadata Cache (L1 Memory + L2 Redis)
 *
 * Caches student assignment & entitlement attributes:
 * { uid, fullName, busId, routeId, shift, stopName, status, softBlock, validUntil, hardBlock }
 *
 * Eliminates repetitive database queries to `student_profiles` across:
 * 1. WebSocket `presence` handshakes in `server/socket-router.ts`
 * 2. `/api/student/trip-status` entitlement and bus matching
 * 3. `/api/student/waiting-flag` corridor & entitlement checks
 *
 * Guarantees:
 * - Singleflight deduplication on cache misses (prevents concurrent query storms for same user).
 * - Bounded L1 in-memory LRU cache (2,500 entries, 5-minute TTL).
 * - L2 Redis key `student:assign:<uid>` with 300s TTL.
 * - Deterministic invalidation on student updates, reassignments, and approvals.
 */

import { getSupabaseServer } from '@/lib/supabase-server';
import { executeGpsRedisCommand } from '@/domains/gps/services/gps-redis-guard';
import { publishRoleInvalidation } from '@/lib/security/role-cache-redis';

export interface CachedStudentAssignment {
  uid: string;
  fullName: string;
  busId: string | null;
  routeId: string | null;
  shift: string | null;
  stopName: string | null;
  status: string;
  softBlock: string | null;
  validUntil: string | null;
  hardBlock: string | null;
  cachedAtMs: number;
}

const L1_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_L1_ENTRIES = 2500;
const REDIS_KEY_PREFIX = 'student:assign:';
const REDIS_TTL_SECONDS = 300; // 5 minutes

const assignmentL1Cache = new Map<string, { data: CachedStudentAssignment; expiresAtMs: number }>();
const inFlightFetches = new Map<string, Promise<CachedStudentAssignment | null>>();

function cleanUid(rawUid: string): string {
  if (!rawUid) return '';
  return decodeURIComponent(rawUid).trim();
}

/**
 * Fetch cached student assignment profile, checking L1 Memory -> L2 Redis -> PostgreSQL.
 */
export async function getCachedStudentAssignment(rawUid: string): Promise<CachedStudentAssignment | null> {
  const uid = cleanUid(rawUid);
  if (!uid) return null;

  const now = Date.now();

  // 1. Check L1 Memory Cache
  const l1Entry = assignmentL1Cache.get(uid);
  if (l1Entry && now < l1Entry.expiresAtMs) {
    return l1Entry.data;
  }

  // 2. Singleflight: Deduplicate concurrent fetches for the same student
  const inFlight = inFlightFetches.get(uid);
  if (inFlight) {
    return inFlight;
  }

  const fetchPromise = (async (): Promise<CachedStudentAssignment | null> => {
    try {
      // 3. Check L2 Redis Cache
      try {
        const rawRedis = await executeGpsRedisCommand(['GET', `${REDIS_KEY_PREFIX}${uid}`]);
        if (rawRedis) {
          const parsed = JSON.parse(rawRedis) as CachedStudentAssignment;
          if (parsed && parsed.uid) {
            assignmentL1Cache.set(uid, {
              data: parsed,
              expiresAtMs: Date.now() + L1_TTL_MS,
            });
            return parsed;
          }
        }
      } catch {
        // Fall through to database read on Redis failure
      }

      // 4. Authoritative Read from PostgreSQL student_profiles
      const supabase = getSupabaseServer();
      const { data, error } = await supabase
        .from('student_profiles')
        .select('uid, full_name, bus_id, route_id, shift, stop_name, status, soft_block, valid_until, hard_block')
        .or(`uid.eq.${uid},enrollment_id.eq.${uid}`)
        .maybeSingle();

      if (error) {
        console.error('[student-assignment-cache] PostgreSQL read error:', error.message);
        return null;
      }

      if (!data) {
        return null;
      }

      const assignment: CachedStudentAssignment = {
        uid: data.uid || uid,
        fullName: data.full_name || 'Student',
        busId: data.bus_id || null,
        routeId: data.route_id || null,
        shift: data.shift || null,
        stopName: data.stop_name || null,
        status: data.status || 'active',
        softBlock: data.soft_block || null,
        validUntil: data.valid_until || null,
        hardBlock: data.hard_block || null,
        cachedAtMs: Date.now(),
      };

      // Populate L1 Memory Cache
      assignmentL1Cache.set(uid, {
        data: assignment,
        expiresAtMs: Date.now() + L1_TTL_MS,
      });

      // Bound L1 size
      if (assignmentL1Cache.size > MAX_L1_ENTRIES) {
        const oldestKey = assignmentL1Cache.keys().next().value;
        if (oldestKey) assignmentL1Cache.delete(oldestKey);
      }

      // Populate L2 Redis Cache (fire-and-forget)
      executeGpsRedisCommand([
        'SET',
        `${REDIS_KEY_PREFIX}${uid}`,
        JSON.stringify(assignment),
        'EX',
        String(REDIS_TTL_SECONDS),
      ]).catch(() => {});

      return assignment;
    } finally {
      inFlightFetches.delete(uid);
    }
  })();

  inFlightFetches.set(uid, fetchPromise);
  return fetchPromise;
}

/**
 * Invalidate cached student assignment metadata across L1 memory and Redis.
 * Must be called whenever an admin/moderator reassigns, approves, or soft-blocks a student.
 */
export async function invalidateStudentAssignment(rawUid: string): Promise<void> {
  const uid = cleanUid(rawUid);
  if (!uid) return;

  assignmentL1Cache.delete(uid);
  inFlightFetches.delete(uid);

  try {
    await executeGpsRedisCommand(['DEL', `${REDIS_KEY_PREFIX}${uid}`]);
    await executeGpsRedisCommand(['PUBLISH', 'student_assign_invalidate', uid]);
  } catch {
    // Best-effort Redis invalidation
  }

  try {
    publishRoleInvalidation(uid);
  } catch {
    // Best-effort role cache publish
  }
}

/**
 * Clear all local L1 assignment cache entries (testing / maintenance).
 */
export function clearStudentAssignmentMemoryCache(): void {
  assignmentL1Cache.clear();
  inFlightFetches.clear();
  try {
    executeGpsRedisCommand(['PUBLISH', 'student_assign_invalidate', '*']).catch(() => {});
  } catch {
    // ignore
  }
}

```

#### 4. Real-Time WebSocket Redis Invalidation Listener: `server/redis-broadcast.ts` (Lines 121–160)
```typescript

  const handleStudentAssignInvalidation = (rawUid: string) => {
    const uid = rawUid ? rawUid.trim() : undefined;
    import('./socket-router')
      .then((m) => m.clearStudentPresenceCache(uid === '*' ? undefined : uid))
      .catch(() => {});
    logger.info('ws_student_presence_cache_invalidated', { uid: uid || 'all' });
  };

  await redisPubSub.subscribe(ROLE_INVALIDATE_CHANNEL, handleRoleInvalidation);
  await redisPubSub.subscribe(ROLE_INVALIDATE_CHANNEL_ALT, handleRoleInvalidation);
  await redisPubSub.subscribe('student_assign_invalidate', handleStudentAssignInvalidation);

  logger.info('redis_security_listeners_initialized', {
    nodeId: MY_NODE_ID,
    roleInvalidateChannel: ROLE_INVALIDATE_CHANNEL,
    roleInvalidateChannelAlt: ROLE_INVALIDATE_CHANNEL_ALT,
    studentAssignInvalidateChannel: 'student_assign_invalidate',
    broadcastRelay: 'bypassed_single_node',
  });
}

```

---



---

# PART 10: Financial Ledger Immutability, Refunds, Admin Renewal/Payment Workbenches & Accounting Exports

### 10.1 Sub-Domain Architecture & Exact Execution Pipeline

The Financial Ledger, Refund, and Accounting Export architecture provides mathematical auditability and append-only immutability across university financial records.

The pipeline is anchored by:
1. **PostgreSQL Trigger Immutability Gate (`protect_completed_payments`)**: Enforces hard database-level rules forbidding row deletion, field tampering, and illegal status transitions.
2. **Two-Phase Refund Engine (`process_payment_refund_atomic` / `confirmManualRefundRecord`)**: Atomically verifies external refund identifiers, validates cumulative refund amounts against captured revenue, and transitions status to `Refunded` only when the cumulative refund reaches 100%.
3. **High-Performance Batched Accounting Exports (`/api/payment/export` & `/api/payment/transactions`)**: Utilizes keyset-ranged queries, single-query array profile enrichment (`.in('uid', ...)`), and parallel approver prefetching (`getUsersByIds` / `getUsersByEmails`) to prevent N+1 query bottlenecks.

```
                                  FINANCIAL LEDGER MUTATION ATTEMPT
                                                  │
                                                  ▼
                                     UPDATE / DELETE public.payments
                                                  │
                                                  ▼
                                TRIGGER protect_completed_payments()
                                                  │
             ┌────────────────────────────────────┼────────────────────────────────────┐
             │                                    │                                    │
    [OPERATION: DELETE]                  [OPERATION: UPDATE]                  [OPERATION: UPDATE]
   Is status Completed,                 Did amount, currency,                Status transition attempt
   Duplicate_Pending_Refund,            method, student_uid,                 from 'Completed':
   Captured_Pending_Review,             student_id, or session               │
   Refunded, or Rejected?               years change?                        ├── Attempting 'Refunded'?
    ├── YES ──► EXCEPTION:               ├── YES ──► EXCEPTION:              │    ├── approved_by present?
    │           Cannot delete                       Cannot mutate financial  │    ├── approved_at present?
    │           finalized record                    or identity fields       │    ├── refund_id in metadata?
    └── NO  ──► ALLOW DELETE             └── NO  ──► ALLOW FIELD             │    └── refunded_amount >= amount?
                                                     MODIFICATION            │         ├── ALL YES ──► ALLOW STATUS 'Refunded'
                                                                             │         └── ANY NO  ──► EXCEPTION: Incomplete evidence
                                                                             │
                                                                             └── Attempting ANY OTHER status?
                                                                                  └── EXCEPTION: Permitted transition is ONLY Refunded
```

---

### 10.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `supabase/COMPLETE_SCHEMA.sql` | `protect_completed_payments`, `process_payment_refund_atomic` | PostgreSQL database engine upon `UPDATE` / `DELETE` on `public.payments` | Internal PL/pgSQL error dispatcher | Guards and mutates `public.payments` |
| `src/lib/services/payments-supabase.ts` | `confirmManualRefundRecord`, `denyRefundRecord`, `getPaymentsForExport`, `getPaginatedPayments`, `enrichPaymentsWithStudentProfiles` | Payment API routes, webhook refund events, admin workbenches | Supabase Client (`from('payments')`), RPC `process_payment_refund_atomic`, `decryptData` | Mutates `public.payments` (status: Refunded, metadata: refund_history) |
| `src/app/api/payment/export/route.ts` | `GET` | Admin Finance / Audit Workbench | `withSecurity`, `getDeadlineConfig`, `paymentsSupabaseService.getPaymentsForExport`, `decryptData` | Reads `public.payments`, `public.student_profiles` |
| `src/app/api/payment/transactions/route.ts` | `GET` | Student Dashboard, Admin / Moderator Payment Workbench | `withSecurity`, `getAllPayments`, `getPaymentsByStudent`, `prefetchApprovers`, `getUsersByIds`, `getUsersByEmails` | Reads `public.payments`, `public.identity`, `public.applications` |
| `src/app/admin/renewal-service/page.tsx` | Default React Page (`AdminRenewalServicePage`) | University Transport Administrator | `/api/applications/all`, `/api/renewal-requests/approve-v2`, `/api/renewal-requests/reject` | Workbench UI for managing applications |

---

### 10.3 Method-by-Method Low-Level Walkthrough

#### 1. Database-Enforced Immutability: `protect_completed_payments` (PL/pgSQL Trigger)
- **Delete Protection:**
  - Evaluates `TG_OP = 'DELETE'`.
  - If `OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected')`, halts execution immediately:
    ```sql
    RAISE EXCEPTION 'Cannot delete finalized or audit payment record %', OLD.payment_id;
    ```
- **Field Mutation Protection:**
  - Evaluates `TG_OP = 'UPDATE'`.
  - For `Completed`, `Duplicate_Pending_Refund`, `Refunded`, `Refund_Denied`, `Rejected`:
    - Checks `NEW.amount IS DISTINCT FROM OLD.amount`
    - Checks `NEW.currency IS DISTINCT FROM OLD.currency`
    - Checks `NEW.method IS DISTINCT FROM OLD.method`
    - Checks `NEW.student_uid IS DISTINCT FROM OLD.student_uid`
    - Checks `NEW.student_id IS DISTINCT FROM OLD.student_id`
    - Checks `NEW.payment_id IS DISTINCT FROM OLD.payment_id`
    - Checks `NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id`
    - Checks `NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id`
    - Checks `NEW.session_start_year IS DISTINCT FROM OLD.session_start_year`
    - Checks `NEW.session_end_year IS DISTINCT FROM OLD.session_end_year`
    - If ANY of these fields are modified, halts execution:
      ```sql
      RAISE EXCEPTION 'Cannot mutate financial or identity fields of finalized/audit payment record % (current status: %)', OLD.payment_id, OLD.status;
      ```
- **Status Transition Constraints:**
  - **From `Completed`:**
    - May ONLY transition to `Refunded`. Any other transition (e.g. to `Pending`, `Rejected`, `Cancelled`) raises an exception.
    - Transition to `Refunded` is permitted ONLY when:
      1. `NEW.approved_by IS NOT NULL` (audit actor recorded)
      2. `NEW.approved_at IS NOT NULL` (timestamp recorded)
      3. `NEW.metadata` contains valid `refund_id`, `external_refund_ref`, or `razorpay_refund_id`
      4. `NEW.metadata->>'refunded_amount' >= (OLD.amount - 0.01)` (cumulative refunds match captured total)
  - **From `Duplicate_Pending_Refund`:**
    - May ONLY transition to `Refunded` (refund issued) or `Refund_Denied` (financial retention).
  - **From `Captured_Pending_Review`:**
    - May ONLY transition to `Completed` (reconciled with valid session bounds and audit evidence), `Duplicate_Pending_Refund`, `Refunded`, or `Refund_Denied`.

---

#### 2. Atomic Refund Procedure: `confirmManualRefundRecord` & `process_payment_refund_atomic`
- **Control Flow:**
  1. Validates external refund reference (`refundReference`), authorized administrator (`authorizedBy`), and refund amount (`refundedAmount > 0`).
  2. Invokes PostgreSQL RPC `process_payment_refund_atomic`:
     - Locks payment row with `SELECT * FROM payments WHERE payment_id = p_payment_id FOR UPDATE`.
     - Validates that current status is `Completed`, `Duplicate_Pending_Refund`, or `Captured_Pending_Review`.
     - Computes `v_new_cumulative_paise = v_current_refunded_paise + p_amount_paise`.
     - Fails closed if `v_new_cumulative_paise > v_original_amount_paise` (`REFUND_EXCEEDS_PAYMENT`).
     - Appends refund record to `refund_history` JSONB array.
     - Status Update:
       - Full refund (`v_new_cumulative_paise = v_original_amount_paise`): Sets `status = 'Refunded'`, `approved_by = p_authorized_by`, `approved_at = NOW()`.
       - Partial refund: Retains existing status, updates `metadata.refund_history` and `metadata.refunded_amount`.
  3. **Entitlement & Seat Revocation Invariant:**
     - The refund engine acts strictly upon the financial ledger (`public.payments`).
     - For duplicate payments (`Duplicate_Pending_Refund`), the student never held bus capacity or pass validity; refunding leaves fleet counters unchanged.
     - For `Completed` payments where a student holds an active pass, refunding does NOT automatically delete student records or decrement capacity. The administrator must separately update or soft-block the student via the Admin Student Workbench to release the bus seat.

---

#### 3. High-Performance Accounting Exports: `GET /api/payment/export` & Anti-N+1 Lookups
- **Academic Session Window Computation:**
  - Reads `startYear` and `endYear` parameters.
  - Resolves dynamic academic anchor dates from `system_settings` (`getDeadlineConfig`).
  - Sets `startDate = Date.UTC(endYear - 1, anchorMonth, anchorDay + 1, 0, 0, 0)`.
  - Sets `endDate = Date.UTC(endYear, anchorMonth, anchorDay, 23, 59, 59, 999)`.
- **Single-Query Array Profile Enrichment (`enrichPaymentsWithStudentProfiles`):**
  - Fetches payments matching the date window ordered by `transaction_date ASC`.
  - Collects all `student_uid` values missing plain-text names or enrollment IDs into a `Set<string>`.
  - If `uidsNeedingEnrichment.size > 0`, performs a single batched SQL query:
    ```typescript
    const { data: profiles } = await this.supabase
        .from('student_profiles')
        .select('uid, full_name, enrollment_id, valid_until')
        .in('uid', Array.from(uidsNeedingEnrichment));
    ```
  - Merges profile data into payment records without N separate database round-trips.
- **Parallel Approver Prefetching (`prefetchApprovers` in `transactions/route.ts`):**
  - Gathers all unique approver user IDs and email addresses across paginated payments.
  - Dispatches parallel batch queries:
    ```typescript
    const [usersById, usersByEmail] = await Promise.all([
        userIdsToFetch.size > 0 ? getUsersByIds(Array.from(userIdsToFetch)) : Promise.resolve([]),
        emailsToFetch.size > 0 ? getUsersByEmails(Array.from(emailsToFetch)) : Promise.resolve([]),
    ]);
    ```
  - Caches approver names in a request-scoped `Map<string, string>`, resolving all approvers in 1 round-trip.

---

### 10.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Admin Payment Export (`/api/payment/export`)** | **2 DB Queries:**<br>1. Select `system_settings` (deadline config)<br>2. Select `payments` in date range + 1 batched `.in('uid', ...)` profile query | **0** | **0** | **2 I/O Ops** (Zero N+1 queries) |
| **(b) Full Refund Execution (`confirmManualRefundRecord`)** | **2 DB Queries / RPCs:**<br>1. RPC `process_payment_refund_atomic` (Lock row `FOR UPDATE` + update status to `Refunded`)<br>2. Insert `public.audit_events` (`action: 'payment_refunded'`) | **0** | **0** (Manual or Webhook refund ledger commit) | **2 I/O Ops** |
| **(c) Partial Refund Execution (`confirmManualRefundRecord`)** | **2 DB Queries / RPCs:**<br>1. RPC `process_payment_refund_atomic` (Lock row + update `refund_history` while preserving `Completed`)<br>2. Insert `public.audit_events` (`action: 'payment_partially_refunded'`) | **0** | **0** | **2 I/O Ops** |
| **(d) Illegal Mutation Attempt on Completed Payment** | **1 DB Query:**<br>1. `UPDATE payments SET amount = ...` halts inside trigger `protect_completed_payments` with SQL Exception | **0** | **0** | **1 I/O Op** (Aborted transaction) |

---

### 10.5 Verbatim Source Code from Live Codebase

#### 1. Immutability & Status Transition Trigger: `supabase/COMPLETE_SCHEMA.sql` (Lines 3310–3450)
```sql

CREATE OR REPLACE FUNCTION public.protect_completed_payments()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. DELETE PROTECTION: Forbid deleting any finalized, duplicate, unresolved, refunded, refund-denied, or rejected payment record
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected') THEN
            RAISE EXCEPTION 'Cannot delete finalized or audit payment record %', OLD.payment_id;
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 2. IMMUTABILITY OF IDENTITY & FINANCIAL FIELDS FOR FINALIZED / AUDIT RECORDS
        -- Uses NULL-safe IS DISTINCT FROM comparison for all fields including nullable provider identifiers
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied', 'Rejected') AND (
            NEW.amount IS DISTINCT FROM OLD.amount OR
            NEW.currency IS DISTINCT FROM OLD.currency OR
            NEW.method IS DISTINCT FROM OLD.method OR
            NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
            NEW.student_id IS DISTINCT FROM OLD.student_id OR
            NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
            NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
            NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id OR
            NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
            NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
        ) THEN
            RAISE EXCEPTION 'Cannot mutate financial or identity fields of finalized/audit payment record % (current status: %)', OLD.payment_id, OLD.status;
        ELSIF OLD.status = 'Captured_Pending_Review' THEN
            -- Financial, method, and transaction identifiers are strictly immutable on Captured_Pending_Review
            IF (
                NEW.amount IS DISTINCT FROM OLD.amount OR
                NEW.currency IS DISTINCT FROM OLD.currency OR
                NEW.method IS DISTINCT FROM OLD.method OR
                NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
                NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
                NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
                NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id
            ) THEN
                RAISE EXCEPTION 'Cannot mutate financial or provider identity fields of Captured_Pending_Review payment record %', OLD.payment_id;
            END IF;

            -- If remaining in Captured_Pending_Review, session years cannot be mutated without a formal status transition
            IF NEW.status = 'Captured_Pending_Review' AND (
                NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
                NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
            ) THEN
                RAISE EXCEPTION 'Cannot alter session fields of Captured_Pending_Review record % without reconciling to Completed', OLD.payment_id;
            END IF;
        END IF;

        -- 3. LIFECYCLE TRANSITION CONSTRAINTS
        -- A. Completed transition constraints:
        -- Completed may ONLY transition to 'Refunded' when a verified full refund is recorded with complete audit evidence.
        -- Any other status change is strictly forbidden.
        IF OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Refunded' THEN
                -- Explicit safe refund transition requirements:
                -- 1. Authorized actor recorded
                IF NEW.approved_by IS NULL THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without authorized actor (approved_by)', OLD.payment_id;
                END IF;
                -- 2. Timestamp recorded
                IF NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without refund timestamp (approved_at)', OLD.payment_id;
                END IF;
                -- 3. External refund reference in metadata
                IF NEW.metadata IS NULL OR (
                    (NEW.metadata->>'refund_id' IS NULL OR TRIM(NEW.metadata->>'refund_id') = '') AND
                    (NEW.metadata->>'external_refund_ref' IS NULL OR TRIM(NEW.metadata->>'external_refund_ref') = '') AND
                    (NEW.metadata->>'razorpay_refund_id' IS NULL OR TRIM(NEW.metadata->>'razorpay_refund_id') = '')
                ) THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without external refund reference in metadata', OLD.payment_id;
                END IF;
                -- 4. Cumulative refunded amount must equal or exceed original captured amount
                IF NEW.metadata IS NULL OR NEW.metadata->>'refunded_amount' IS NULL OR
                   (NEW.metadata->>'refunded_amount')::NUMERIC < (OLD.amount - 0.01) THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded: cumulative refunded amount (%) must equal or exceed original captured amount (%)',
                        OLD.payment_id, COALESCE(NEW.metadata->>'refunded_amount', '0'), OLD.amount;
                END IF;
            ELSE
                RAISE EXCEPTION 'Cannot mutate status of Completed payment record %: permitted transition is only to Refunded upon verified full refund (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- B. Duplicate_Pending_Refund may only transition to 'Refunded' or 'Refund_Denied' (manual audit outcomes)
        IF OLD.status = 'Duplicate_Pending_Refund' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status NOT IN ('Refunded', 'Refund_Denied') THEN
                RAISE EXCEPTION 'Invalid status transition for Duplicate_Pending_Refund record %: permitted transitions are only Refunded or Refund_Denied (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- C. Captured_Pending_Review reconciliation transition:
        -- Permitted transitions are only: Completed, Duplicate_Pending_Refund, Refunded, or Refund_Denied
        IF OLD.status = 'Captured_Pending_Review' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Completed' THEN
                -- Explicit safe reconciliation operation requirements:
                -- 1. Valid session bounds: start < end
                IF NEW.session_start_year IS NULL OR NEW.session_end_year IS NULL OR NEW.session_start_year >= NEW.session_end_year THEN
                    RAISE EXCEPTION 'Cannot resolve Captured_Pending_Review % to Completed without valid session boundaries (start < end)', OLD.payment_id;
                END IF;
                -- 2. Authorized actor recorded
                IF NEW.approved_by IS NULL THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without authorized actor (approved_by)', OLD.payment_id;
                END IF;
                -- 3. Timestamp recorded
                IF NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without reconciliation timestamp (approved_at)', OLD.payment_id;
                END IF;
                -- 4. Audit evidence documented in metadata
                IF NEW.metadata IS NULL OR NEW.metadata->>'reconciliation_evidence' IS NULL OR TRIM(NEW.metadata->>'reconciliation_evidence') = '' THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without documented reconciliation_evidence in metadata', OLD.payment_id;
                END IF;
            ELSIF NEW.status NOT IN ('Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied') THEN
                RAISE EXCEPTION 'Invalid status transition for Captured_Pending_Review record %: permitted transitions are Completed (with valid session and audit evidence), Duplicate_Pending_Refund, Refunded, or Refund_Denied (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- D. External refund verification requirement: transition to Refunded requires external refund reference and authorized actor
        IF NEW.status = 'Refunded' AND OLD.status <> 'Refunded' THEN
            IF NEW.approved_by IS NULL THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refunded without authorized actor (approved_by)', OLD.payment_id;
            END IF;
            IF NEW.metadata IS NULL OR (
                (NEW.metadata->>'refund_id' IS NULL OR TRIM(NEW.metadata->>'refund_id') = '') AND
                (NEW.metadata->>'external_refund_ref' IS NULL OR TRIM(NEW.metadata->>'external_refund_ref') = '') AND
                (NEW.metadata->>'razorpay_refund_id' IS NULL OR TRIM(NEW.metadata->>'razorpay_refund_id') = '')
            ) THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refunded without external refund reference in metadata (refund_id, external_refund_ref, or razorpay_refund_id)', OLD.payment_id;
            END IF;
        END IF;

        -- E. Refund denial audit requirement: transition to Refund_Denied requires denial reason and authorized actor
        IF NEW.status = 'Refund_Denied' AND OLD.status <> 'Refund_Denied' THEN
            IF NEW.approved_by IS NULL THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refund_Denied without authorized actor (approved_by)', OLD.payment_id;
            END IF;
            IF NEW.metadata IS NULL OR (NEW.metadata->>'denial_reason' IS NULL OR TRIM(NEW.metadata->>'denial_reason') = '') THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refund_Denied without documented denial_reason in metadata', OLD.payment_id;
            END IF;
        END IF;

        -- F. Refunded, Refund_Denied and Rejected are terminal: once marked, status cannot change
```

#### 2. Atomic Refund Execution & Denial: `src/lib/services/payments-supabase.ts` (Lines 980–1145)
```typescript
     */
    async confirmManualRefundRecord(input: ConfirmRefundInput): Promise<{
        success: boolean;
        error?: string;
        isPartial?: boolean;
        cumulativeRefunded?: number;
    }> {
        if (!this.isReady()) return { success: false, error: 'Database service not initialized' };

        const { paymentId, refundReference, refundedAmount, authorizedBy, reason } = input;

        if (!refundReference || !refundReference.trim()) {
            return { success: false, error: 'External refund reference is mandatory for marking a payment as Refunded.' };
        }
        if (!authorizedBy || !authorizedBy.userId) {
            return { success: false, error: 'Authorized finance officer identifier is required.' };
        }
        if (!refundedAmount || refundedAmount <= 0) {
            return { success: false, error: 'Refunded amount must be greater than zero.' };
        }

        try {
            const trimmedRef = refundReference.trim();
            const now = new Date().toISOString();
            const refundAmountPaise = Math.round(refundedAmount * 100);

            // Construct auditable actor object
            const approverData = {
                type: authorizedBy.type || (authorizedBy.userId.startsWith('system:') ? 'system' : 'admin'),
                userId: authorizedBy.userId,
                name: authorizedBy.name || (authorizedBy.userId.startsWith('system:') ? 'System Actor' : 'Finance Administrator'),
                role: authorizedBy.role || (authorizedBy.userId.startsWith('system:') ? 'system' : 'admin'),
                ...(authorizedBy.empId ? { empId: authorizedBy.empId } : {}),
            };

            // Atomic PostgreSQL procedure with row-level locking (SELECT ... FOR UPDATE)
            // FAIL CLOSED: Never fall through to non-atomic client-side accounting in production.
            if (typeof this.supabase?.rpc !== 'function') {
                console.error('[PaymentsSupabaseService] process_payment_refund_atomic RPC unavailable: this.supabase.rpc is not a function');
                return {
                    success: false,
                    error: 'Atomic refund procedure unavailable: database RPC interface not configured.',
                };
            }

            const { data: rpcData, error: rpcError } = await this.supabase
                .rpc('process_payment_refund_atomic', {
                    p_payment_id: paymentId,
                    p_refund_id: trimmedRef,
                    p_amount_paise: refundAmountPaise,
                    p_authorized_by: approverData,
                    p_reason: reason || 'Approved refund',
                });

            // Fail closed on any PostgREST / Supabase RPC error (42883, PGRST202, permission denied, connection error, etc.)
            if (rpcError) {
                console.error('[PaymentsSupabaseService] process_payment_refund_atomic RPC error:', rpcError);
                return {
                    success: false,
                    error: rpcError.message || `Atomic refund RPC execution failed (${rpcError.code || 'UNKNOWN'})`,
                };
            }

            if (!rpcData || typeof rpcData !== 'object') {
                console.error('[PaymentsSupabaseService] process_payment_refund_atomic unexpected response:', rpcData);
                return {
                    success: false,
                    error: 'Unexpected or empty response from atomic refund procedure',
                };
            }

            const res = rpcData as any;
            if (res.success) {
                return {
                    success: true,
                    isPartial: Boolean(res.is_partial),
                    cumulativeRefunded: Number(res.cumulative_refunded) || (Number(res.cumulative_refunded_paise) / 100),
                };
            } else {
                return {
                    success: false,
                    error: res.error || 'Failed to process refund via atomic procedure',
                };
            }
        } catch (err: any) {
            console.error('[PaymentsSupabaseService] process_payment_refund_atomic exception:', err);
            return {
                success: false,
                error: err?.message || 'Exception during atomic refund procedure execution',
            };
        }
    }

    /**
     * Atomically deny a refund for a captured transaction (financial retention).
     * Allowed only from 'Duplicate_Pending_Refund' or 'Captured_Pending_Review'.
     * Preserves the captured funds in university accounts without granting transit pass.
     * Invariant: Sets top-level approved_by and approved_at to satisfy protect_completed_payments().
     */
    async denyRefundRecord(input: DenyRefundInput): Promise<{ success: boolean; error?: string }> {
        if (!this.isReady()) return { success: false, error: 'Database service not initialized' };

        const { paymentId, deniedBy, denialReason } = input;

        if (!deniedBy || !deniedBy.userId) {
            return { success: false, error: 'Reviewer identifier is required to deny a refund.' };
        }
        if (!denialReason || !denialReason.trim()) {
            return { success: false, error: 'Explicit denial reason is required.' };
        }

        try {
            const { data: currentRaw, error: fetchErr } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('payment_id', paymentId)
                .maybeSingle();

            if (fetchErr || !currentRaw) {
                return { success: false, error: `Payment record ${paymentId} not found` };
            }

            const current = currentRaw as PaymentRecord;
            if (current.status !== 'Duplicate_Pending_Refund' && current.status !== 'Captured_Pending_Review') {
                return {
                    success: false,
                    error: `Payment ${paymentId} has status '${current.status}'. Denying refund is only permitted from review states.`
                };
            }

            const now = new Date().toISOString();
            const denierData = {
                type: deniedBy.type || 'admin',
                userId: deniedBy.userId,
                name: deniedBy.name,
                role: deniedBy.role,
                ...(deniedBy.empId ? { empId: deniedBy.empId } : {}),
            };

            const updatedMetadata = {
                ...(current.metadata || {}),
                prior_status: current.status,
                denied_by: denierData,
                denied_at: now,
                denial_reason: denialReason.trim(),
                requires_refund_review: false,
                requires_manual_review: false,
            };

            const { data, error } = await this.supabase
                .from('payments')
                .update({
                    status: 'Refund_Denied',
                    approved_by: denierData,
                    approved_at: now,
                    metadata: updatedMetadata,
                })
                .eq('payment_id', paymentId)
                .in('status', ['Duplicate_Pending_Refund', 'Captured_Pending_Review'])
                .select('payment_id');

            if (error) {
                console.error('[PaymentsSupabaseService] Deny refund update error:', error);
                return { success: false, error: error.message };
            }
```

#### 3. Batched Profile Enrichment & Keyset Export Queries: `src/lib/services/payments-supabase.ts`
```typescript
// Lines 1276-1345: enrichPaymentsWithStudentProfiles (Anti-N+1 batch query)

    private async enrichPaymentsWithStudentProfiles(records: PaymentRecord[]): Promise<PaymentRecord[]> {
        if (!records || records.length === 0) return [];

        const decryptedRecords = records.map(r => this.decryptRecord(r));
        const uidsNeedingEnrichment = new Set<string>();

        for (const decrypted of decryptedRecords) {
            const hasValidName = decrypted.student_name && !decrypted.student_name.startsWith('enc:v1:');
            const hasValidId = decrypted.student_id && !decrypted.student_id.startsWith('enc:v1:');
            const hasValidUntil = Boolean(decrypted.valid_until);

            if ((!hasValidName || !hasValidId || !hasValidUntil) && decrypted.student_uid) {
                uidsNeedingEnrichment.add(decrypted.student_uid);
            }
        }

        // Fast path: all records already have complete decrypted data
        if (uidsNeedingEnrichment.size === 0) {
            return decryptedRecords.map(decrypted => {
                if (decrypted.session_end_year) {
                    const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
                    if (!decrypted.valid_until || payValidYear < decrypted.session_end_year) {
                        decrypted.valid_until = new Date(Date.UTC(decrypted.session_end_year, 5, 30, 23, 59, 59, 999)).toISOString();
                    }
                }
                return decrypted;
            });
        }

        // Batch query all missing profile UIDs in a single SQL query
        const profileMap = new Map<string, { full_name?: string; enrollment_id?: string; valid_until?: string }>();
        try {
            const { data: profiles } = await this.supabase
                .from('student_profiles')
                .select('uid, full_name, enrollment_id, valid_until')
                .in('uid', Array.from(uidsNeedingEnrichment));

            if (profiles) {
                for (const prof of profiles) {
                    profileMap.set(prof.uid, prof);
                }
            }
        } catch {
            // Ignore batch query error
        }

        return decryptedRecords.map(decrypted => {
            const profile = decrypted.student_uid ? profileMap.get(decrypted.student_uid) : undefined;
            const hasValidName = decrypted.student_name && !decrypted.student_name.startsWith('enc:v1:');
            const hasValidId = decrypted.student_id && !decrypted.student_id.startsWith('enc:v1:');

            if (profile) {
                if (!hasValidName && profile.full_name) {
                    decrypted.student_name = profile.full_name;
                }
                if (!hasValidId && profile.enrollment_id) {
                    decrypted.student_id = profile.enrollment_id;
                }
                if (profile.valid_until) {
                    const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
                    const targetEndYear = decrypted.session_end_year || 0;
                    if (!decrypted.valid_until || (targetEndYear > 0 && payValidYear < targetEndYear)) {
                        decrypted.valid_until = profile.valid_until;
                    }
                }
            }

            if (decrypted.session_end_year) {

// Lines 1460-1500: getPaymentsForExport implementation
    async getPaymentsForExport(
        startDate: Date,
        endDate: Date
    ): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .gte('transaction_date', startDate.toISOString())
                .lte('transaction_date', endDate.toISOString())
                .order('transaction_date', { ascending: true });

            if (error) return [];
            return this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch {
            return [];
        }
    }

    /**
     * Get recent transactions
     */
    async getRecentTransactions(limit: number = 5): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) return [];
            return this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch {
            return [];
        }
    }
```

#### 4. Financial Export Endpoint: `src/app/api/payment/export/route.ts`
```typescript
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { withSecurity } from '@/lib/security/api-security';
import { decryptData } from '@/lib/security/encryption.service';
import { RateLimits } from '@/lib/security/rate-limiter';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
  async (request, { auth }) => {
    try {
      const { searchParams } = new URL(request.url);
      const startYearStr = searchParams.get('startYear');
      const endYearStr = searchParams.get('endYear');

      if (!startYearStr || !endYearStr) {
        return NextResponse.json({ error: 'Missing startYear or endYear parameters' }, { status: 400 });
      }

      const startYear = parseInt(startYearStr, 10);
      const endYear = parseInt(endYearStr, 10);

      if (Number.isNaN(startYear) || Number.isNaN(endYear) || startYear < 2000 || endYear <= startYear || endYear > 2100) {
        return NextResponse.json({ error: 'Invalid startYear or endYear parameters' }, { status: 400 });
      }

      // Fetch dynamic deadline config
      const config = await getDeadlineConfig();
      const anchorMonth = config.academicYear.anchorMonth;
      const anchorDay = config.academicYear.anchorDay;

      // The academic cycle ending in endYear starts the day after the anchor in (endYear - 1)
      const startDate = new Date(Date.UTC(endYear - 1, anchorMonth, anchorDay, 0, 0, 0));
      startDate.setUTCDate(startDate.getUTCDate() + 1);

      // The academic cycle ends on the anchor date of endYear
      const endDate = new Date(Date.UTC(endYear, anchorMonth, anchorDay, 23, 59, 59, 999));

      const payments = await paymentsSupabaseService.getPaymentsForExport(startDate, endDate);

      if (!payments || payments.length === 0) {
        return NextResponse.json({ success: true, payments: [] });
      }

      const exportedPayments = payments.map((payment) => {
        // approved_by parsing & decryption
        const approvedByObj = payment.approved_by;
        let approvedByName = '';
        let approvedByRole = '';
        let approvedByEmpId = '';

        if (approvedByObj && typeof approvedByObj === 'object') {
          const approvedBy = approvedByObj as any;
          approvedByName = approvedBy.name || '';
          approvedByRole = approvedBy.role || approvedBy.type || '';
          
          const empIdRaw = approvedBy.empId || '';
          approvedByEmpId = empIdRaw ? (decryptData(empIdRaw) || empIdRaw) : '';
        }

        // Decrypt legacy or double-check encryption
        const studentId = payment.student_id ? (decryptData(payment.student_id) || payment.student_id) : '';
        const studentName = payment.student_name ? (decryptData(payment.student_name) || payment.student_name) : '';
        const offlineTransactionId = payment.offline_transaction_id ? (decryptData(payment.offline_transaction_id) || payment.offline_transaction_id) : '';

        return {
          paymentId: payment.payment_id,
          studentId,
          studentName,
          amount: payment.amount,
          transactionDate: payment.transaction_date,
          method: payment.method,
          status: payment.status,
          session: `${payment.session_start_year || startYear}-${payment.session_end_year || endYear}`,
          validUntil: payment.valid_until,
          offlineTransactionId,
          razorpayPaymentId: payment.razorpay_payment_id || '',
          razorpayOrderId: payment.razorpay_order_id || '',
          approvedByName,
          approvedByRole,
          approvedByEmpId,
          approvedAt: payment.approved_at || ''
        };
      });

      return NextResponse.json({
        success: true,
        payments: exportedPayments
      });

    } catch (error: any) {
      console.error('Error exporting payments:', error);
      return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.READ,
  }
);

```

#### 5. Batched Approver Prefetching: `src/app/api/payment/transactions/route.ts` (Lines 1–130)
```typescript
import { getByApplicantUid } from '@/domains/application';
import { getUserByEmail, getUserById, getUsersByEmails, getUsersByIds } from '@/domains/identity';
import { getByUid as getStudentByUid } from '@/domains/student';
import { getAllPayments, getPaymentsByStudent } from '@/lib/payment/payment.service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
  async (request, { auth }) => {
    try {
      const userId = auth.uid;
      const userRole = auth.role;

      const { searchParams } = new URL(request.url);
      const studentId = searchParams.get('studentId');
      const studentUid = searchParams.get('studentUid');
      const year = searchParams.get('year');
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '50');
      const paymentMethod = (searchParams.get('paymentMethod') || searchParams.get('method')) as 'Online' | 'Offline' | null;
      const statusParam = searchParams.get('status');
      const VALID_STATUS_MAP: Record<string, string> = {
        completed: 'Completed',
        pending: 'Pending',
        rejected: 'Rejected',
        duplicate_pending_refund: 'Duplicate_Pending_Refund',
        captured_pending_review: 'Captured_Pending_Review',
        refunded: 'Refunded',
        refund_denied: 'Refund_Denied',
      };

      let statusFilter: string | undefined = undefined;
      if (statusParam && statusParam !== 'all') {
        const canonical = VALID_STATUS_MAP[statusParam.toLowerCase()];
        if (!canonical) {
          return NextResponse.json(
            { error: `Invalid status parameter '${statusParam}'. Allowed: all, Completed, Pending, Rejected, Duplicate_Pending_Refund, Captured_Pending_Review, Refunded, Refund_Denied` },
            { status: 400 }
          );
        }
        statusFilter = canonical;
      }

      // Helper to map Firestore documents to frontend-expected format
      const userCache = new Map<string, string>(); // Request-scope cache for user lookups

      const prefetchApprovers = async (paymentsList: any[]) => {
        const userIdsToFetch = new Set<string>();
        const emailsToFetch = new Set<string>();

        for (const p of paymentsList) {
          const approver = p?.approvedBy || p?.approved_by;
          if (approver) {
            if (typeof approver === 'object') {
              if (['Manual', 'admin', 'moderator'].includes(approver.type)) {
                if (approver.userId && !userCache.has(approver.userId)) {
                  userIdsToFetch.add(approver.userId);
                } else if (approver.name && approver.name.includes('@') && !userCache.has(approver.name)) {
                  emailsToFetch.add(approver.name);
                }
              }
            } else {
              const strValue = String(approver);
              const emailMatch = strValue.match(/^(.+?) \((.+?)\)$/);
              if (emailMatch && emailMatch[1].includes('@') && !userCache.has(emailMatch[1])) {
                emailsToFetch.add(emailMatch[1]);
              }
            }
          }
        }

        if (userIdsToFetch.size === 0 && emailsToFetch.size === 0) return;

        try {
          const [usersById, usersByEmail] = await Promise.all([
            userIdsToFetch.size > 0 ? getUsersByIds(Array.from(userIdsToFetch)) : Promise.resolve([]),
            emailsToFetch.size > 0 ? getUsersByEmails(Array.from(emailsToFetch)) : Promise.resolve([]),
          ]);

          for (const user of usersById) {
            if (user?.uid) {
              userCache.set(user.uid, (user as any).fullName || (user as any).name || user.uid);
            }
          }
          for (const user of usersByEmail) {
            if (user?.email) {
              userCache.set(user.email, (user as any).fullName || (user as any).name || user.email);
            }
          }
        } catch (e) {
          console.warn('Failed to pre-fetch approvers in batch', e);
        }
      };

      const mapToFrontend = async (p: any) => {
        if (!p) return null;

        // Helper to resolve name from user ID or email
        const resolveName = async (uid: string | undefined, emailOrName: string) => {
          if (!emailOrName || !emailOrName.includes('@')) return emailOrName;

          const cacheKey = uid || emailOrName;
          if (userCache.has(cacheKey)) return userCache.get(cacheKey)!;

          try {
            let resolvedUser = null;
            if (uid) {
              resolvedUser = await getUserById(uid);
            }

            if (!resolvedUser && emailOrName.includes('@')) {
              resolvedUser = await getUserByEmail(emailOrName);
            }

            if (resolvedUser) {
              const resolvedName = (resolvedUser as any).fullName || (resolvedUser as any).name || emailOrName;
              userCache.set(cacheKey, resolvedName);
              return resolvedName;
            }
          } catch (e) {
            console.warn('Failed to resolve user name for payment', e);
          }
          return emailOrName;
        };

        // Map approvedBy object to string if it exists
        let approvedByStr = undefined;
        const approver = p?.approvedBy || p?.approved_by;
        if (approver) {
```

---

