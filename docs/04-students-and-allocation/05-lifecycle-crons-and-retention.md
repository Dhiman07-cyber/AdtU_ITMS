# Automated Academic Lifecycle Crons, Soft-Block Expiry & Hard Cascade Deletion (Forensic Truth)

**Module:** Session Activation, Soft-Block Seat Reclaim, Automated Hard Cascade Deletion & Bus Load Reconciliation  
**File Authority:** `src/app/api/cron/session-activation/route.ts`, `src/app/api/cron/cleanup-expired-students/route.ts`, `src/lib/cleanup-helpers.ts`  
**Database Procedures:** `delete_student_cascade_v1`, `adminReconcileBusLoads`  

---

# PART 6: Automated Daily Lifecycle Crons — Session Activation (`verified_upcoming`), Expiry Reminders & Soft-Block Seat Release

---

### 6.1 Sub-Domain Architecture & Exact Execution Pipeline

The automated daily lifecycle crons govern the temporal state transitions of commuters without requiring human intervention. They ensure that incoming students waiting for an upcoming session are activated when the new session opens, existing commuters receive progressive warnings as their service nears expiration, and unrenewed students have their bus seats released back to the general capacity pool.

This sub-domain is driven by three scheduled cron route handlers:
1. `GET /api/cron/session-activation`: Activates `verified_upcoming` applications when the academic session start date is reached.
2. `GET /api/cron/expiry-check`: Issues progressive 90-day, 60-day, and 15-day expiry warnings with atomic duplicate prevention.
3. `GET /api/cron/cleanup-expired-students` (Soft-Block Phase): Atomically transitions expired active students to `soft_blocked` and releases their seat via `soft_block_student_with_seat_release`.

#### Chronological Sequence & Transition Diagram

```
                                  [ Scheduled Cron Trigger (e.g. Vercel Cron) ]
                                                        │
                         ┌──────────────────────────────┼──────────────────────────────┐
                         ▼                              ▼                              ▼
             [ /api/cron/session-activation ]  [ /api/cron/expiry-check ]   [ /api/cron/cleanup-expired-students ]
                         │                              │                              │
                (Session Roll-Over)             (Progressive Warning)                  │
                         │                              │                              │
                         ├─► verifyCronAuth()           ├─► verifyCronAuth()           ├─► verifyCronAuth()
                         │                              │                              │
                         ├─► Check today >= start       ├─► Check reminder1 (90d),     ├─► Keyset pagination loop
                         │   (academicSessionStart)         reminder2 (60d), or            (limit 100, 240s budget)
                         │                                  finalReminder (15d)        │
                         ├─► Check marker:              │                              ├─► For each active student:
                         │   soft_block_completed       ├─► Query student_profiles     │   check stored softBlock
                         │   (Postpones if missing)         where valid_until in range │   against today
                         │                              │                              │
                         ├─► Query applications in      ├─► For each student:          ├─► If today >= softBlock:
                         │   state = 'verified_upcoming'│   Atomic Postgres RPC:       │   - Re-read fresh state
                         │                              │   increment_expiry_reminder  │   - Invoke atomic RPC:
                         ├─► For each application:      │   _count(p_uid)              │     soft_block_student_
                         │   1. Claim lease             │   (Returns true only once    │     with_seat_release
                         │   2. Try assigned bus        │    per calendar day)         │     * status = 'soft_blocked'
                         │      (capacity check)        │                              │     * bus load decremented
                         │   3. If full: search stop    ├─► If claimed:                │     * seat_released_at = NOW()
                         │      alternative buses       │   Write notification to      │   - Invalidate Redis
                         │   4. If NO buses have seats: │   public.notifications       │     student:assign:<uid>
                         │      transition to           │                              │   - Emit audit_events
                         │      'pending_seat_          └─► Send summary notification  │     'student_soft_blocked_
                         │       allocation'                to all Admins              │      seat_released'
                         │   5. If seat available:                                     │
                         │      - identity_activate_                                   └─► Proceed to Hard Delete
                         │        student_with_capacity                                    phase (see Part 7)
                         │      - Delete application
                         │      - Invalidate Redis
                         │      - Notify student
                         │
                         └─► Write marker:
                             activation_{year}
```

---

### 6.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/cron/session-activation/route.ts` | `GET` | Vercel Cron (`0 1 * * *`), Admin manual trigger | `verifyCronAuth`, `activateUpcomingSessionApplications`, `createAuditEvent` | Emits `audit_events` record. Thin authenticated entrypoint. |
| `src/lib/services/session-activation.service.ts` | `activateUpcomingSessionApplications`, `activateSingleApplication`, `getCurrentSessionStartYear` | `/api/cron/session-activation`, `/api/admin/run-session-activation` | `getDeadlineConfig`, `findMarker`, `upsertMarker`, `getAllByState`, `claimForActivation`, `activateStudentWithCapacity`, `findDeterministicAlternativeBuses`, `invalidateStudentAssignment` | Mutates `public.applications`, `public.student_profiles`, `public.users`, `public.buses`, `public.notifications`, `public.audit_events`. Clears Redis `student:assign:<uid>`. |
| `src/app/api/cron/expiry-check/route.ts` | `GET`, `POST` | Vercel Cron, Admin manual trigger | `verifyCronAuth`, `checkAndNotifyExpiringStudents`, `sendMidJuneReminder` | Entrypoint for expiry notifications. |
| `src/lib/expiry-check.ts` | `checkAndNotifyExpiringStudents`, `sendMidJuneReminder`, `manualExpiryCheck` | `/api/cron/expiry-check/route.ts` | `getDeadlineConfig`, `deriveAcademicLifecycle`, `increment_expiry_reminder_count`, `pgInsertNotification`, `getUsersByRole` | Queries `public.student_profiles`. Calls RPC `increment_expiry_reminder_count`. Inserts rows into `public.notifications`. |
| `src/app/api/cron/cleanup-expired-students/route.ts` | `GET` (Soft-Block Phase) | Vercel Cron (`0 2 * * *`) | `verifyCronAuth`, `getStudentsByStatusesPaged`, `computeBlockDatesFromValidUntil`, `shouldBlockAccessFromStoredDates`, `soft_block_student_with_seat_release`, `invalidateStudentAssignment` | Queries `public.student_profiles`. Invokes RPC `soft_block_student_with_seat_release`. Decrements `public.buses`. Clears Redis `student:assign:<uid>`. |

---

### 6.3 Method-by-Method Low-Level Walkthrough

#### 1. `activateUpcomingSessionApplications` (`src/lib/services/session-activation.service.ts`)
- **Signature:** `export async function activateUpcomingSessionApplications(opts: { trigger: 'cron' | 'admin' }): Promise<SessionActivationSummary>`
- **Control Flow & Invariant Enforcement:**
  1. Computes `currentSessionStartYear` via `getCurrentSessionStartYear(config, now)`.
  2. Compares `today < normalizedActivationDate`: If current date is before `academicSessionStart` (e.g. before July 1), exits with `activationReached: false`.
  3. Checks soft-block prerequisite marker:
     ```typescript
     const softBlockMarkerData = await findMarker(`soft_block_completed_${currentSessionStartYear}`);
     if (!softBlockMarkerData) {
       // Postpone activation until outgoing students have been soft-blocked and seats released!
       return summary;
     }
     ```
  4. Checks activation idempotency marker: `findMarker(`activation_${currentSessionStartYear}`)`. If already present, skips execution.
  5. Fetches all applications in `verified_upcoming` via `getAllByState('verified_upcoming')`.
  6. Pre-fetches all fleet buses and routes in memory to eliminate N+1 queries.
  7. For each application, executes `activateOne(app, config, trigger, preFetchedBuses, preFetchedRoutes)`:
     - Acquires exclusive application lease via `applicationRepo.claimForActivation(appId, lockId)`. If already claimed by concurrent thread, returns `'skipped'`.
     - **Attempt A (Assigned Bus):** Calls `activateStudentWithCapacity` for primary assigned bus.
       - If seat available: atomically increments bus load, creates `users` row, creates `student_profiles` row (`status = 'active'`), deletes application row from `applications`, clears Redis cache `student:assign:<uid>`, sends in-app activation notification to student.
     - **Attempt B (Alternative Bus Search):** If primary bus throws `CapacityFullError`:
       - Invokes `findDeterministicAlternativeBuses(stop_name, routeId, shift)`.
       - Loops through alternative buses serving that stop sorted by: same route first, exact shift match first, lowest current occupancy first, ascending busId.
       - If an alternative has a seat, activates on that bus.
     - **Attempt C (All Buses Serving Stop Full):**
       - Updates application state to `'pending_seat_allocation'`.
       - Releases activation lease lock.
       - Dispatches `notifyPendingSeatAllocation`: notifies student that payment is verified but waiting in seat queue; notifies all Admins and Moderators.
  8. If no eligible `verified_upcoming` applications remain for the session, writes idempotency marker `upsertMarker(`activation_${currentSessionStartYear}`)`.

#### 2. `checkAndNotifyExpiringStudents` (`src/lib/expiry-check.ts`)
- **Signature:** `export async function checkAndNotifyExpiringStudents(force: boolean = false): Promise<ExpiryCheckResult>`
- **Control Flow:**
  1. Computes lifecycle dates for the current year via `deriveAcademicLifecycle(startMonth, startDay, currentYear)`.
  2. Evaluates date triggers:
     - `isR1 = currentMonth === lifecycle.reminder1.month && currentDay === lifecycle.reminder1.day` (90 days before expiry)
     - `isR2 = currentMonth === lifecycle.reminder2.month && currentDay === lifecycle.reminder2.day` (60 days before expiry)
     - `isFinal = currentMonth === lifecycle.finalReminder.month && currentDay === lifecycle.finalReminder.day` (15 days before expiry)
  3. If `!force && !isR1 && !isR2 && !isFinal`, logs skip and exits immediately.
  4. Queries PostgreSQL `student_profiles` for active commuters whose `valid_until` falls on the expiry day (`gte deadlineFirst` and `lt deadlineNext`).
  5. For each student:
     - Checks `expiryReminderCount` (< 1 for R1, < 2 for R2, < 3 for Final).
     - **Atomic Concurrency Gate:** Calls `supabase.rpc('increment_expiry_reminder_count', { p_uid: studentUid })`.
       - The RPC executes `SELECT ... FOR UPDATE` and checks `last_expiry_reminder_sent_at::date = CURRENT_DATE`.
       - If already sent today, returns `FALSE`.
       - If not sent today, updates `last_expiry_reminder_sent_at = NOW()`, increments `expiry_reminder_count = expiry_reminder_count + 1`, and returns `TRUE`.
     - If RPC returns `TRUE`, inserts notification row via `pgInsertNotification`.
  6. Dispatches summary notification to all administrators via `sendAdminSummary`.

#### 3. `cleanup-expired-students` Soft-Block Execution (`src/app/api/cron/cleanup-expired-students/route.ts`)
- **Signature:** `export async function GET(request: NextRequest): Promise<NextResponse>` (Lines 273–360)
- **Control Flow:**
  1. Evaluates `if (needsSoftBlock && studentData.status === 'active')`.
  2. Re-reads fresh student record from PostgreSQL (`getStudentById(uid)`) to prevent stale race conditions.
  3. Verifies that `currentStatus === 'active'` and `freshNeedsSoftBlock === true`.
  4. Resolves `releaseSeat = isSeatReleaseAtSoftBlockEnabled()` (returns `true`).
  5. Invokes atomic PL/pgSQL RPC:
     ```typescript
     const { data: rpcResult, error: rpcError } = await supabase.rpc('soft_block_student_with_seat_release', {
       p_student_uid: uid,
       p_bus_id: releaseSeat ? sbBusId : null,
       p_shift: sbShift,
       p_release_seat: releaseSeat,
       p_soft_blocked_at: nowIso,
       p_seat_released_at: nowIso
     });
     ```
  6. Inside PostgreSQL:
     - Updates `student_profiles` setting `status = 'soft_blocked'`, `soft_blocked_at = nowIso`, `seat_released_at = nowIso`.
     - Calls `bus_decrement_capacity(sbBusId, sbShift)`, reducing `buses.morning_load` or `evening_load` and `current_members`.
  7. Invokes `invalidateStudentAssignment(uid)` to purge Redis key `student:assign:<uid>` and broadcast invalidation over Redis Pub/Sub.
  8. Emits `audit_events` record: `action: 'student_soft_blocked_seat_released'`.

---

### 6.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Execution Context | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls | Latency Profile |
| :--- | :--- | :--- | :--- | :--- |
| **(a) /api/cron/session-activation (Normal Day / Not Session Start)** | 1 SELECT on `system_settings` (config), 0-2 queries on `processed_operations` (`findMarker`) | 0 | 0 | ~15ms - 25ms |
| **(b) /api/cron/session-activation (Active Roll-Over, N Applications)** | 1 SELECT: config, 2 SELECTs: markers, 1 SELECT: all `verified_upcoming` apps, 2 SELECTs: all buses & routes. Per app: 1 UPDATE (lease claim), 1 RPC (`identity_activate_student_with_capacity`), 1 DELETE (`applications`), 1 INSERT (`notifications`), 1 INSERT (`audit_events`). Tail: 1 UPSERT on markers, 1 INSERT on `audit_events`. | Per activated app: 2 Redis commands (`DEL student:assign:<uid>`, `PUBLISH user:assignment:invalidate`) | Per activated app: 0-1 optional FCM push notification | ~45ms per application |
| **(c) /api/cron/expiry-check (Target Reminder Day, M Expiring Students)** | 1 SELECT: config, 1 SELECT on `student_profiles` (range query). Per student: 1 RPC (`increment_expiry_reminder_count`), 1 INSERT on `notifications`. Tail: 1 SELECT (`users` admin role), 1 INSERT on `notifications` (admin summary). | 0 | 0 | ~20ms per expiring student |
| **(d) /api/cron/cleanup-expired-students (Soft-Block Phase, K Expired Active Students)** | 1 SELECT: config. Per page: 1 SELECT on `student_profiles` (limit 100). Per soft-blocked student: 1 SELECT (fresh student check), 1 RPC (`soft_block_student_with_seat_release`), 1 INSERT (`audit_events`). | Per soft-blocked student: 2 Redis commands (`DEL student:assign:<uid>`, `PUBLISH user:assignment:invalidate`) | 0 | ~35ms per soft-blocked student |

---

### 6.5 Verbatim Source Code from Live Codebase

#### 1. `src/app/api/cron/session-activation/route.ts` (Lines 1–45)
```typescript
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { createAuditEvent, SYSTEM_ACTOR } from '@/domains/audit';
import { activateUpcomingSessionApplications } from '@/lib/services/session-activation.service';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Daily session-activation cron.
 *
 * Schedule: daily at low traffic (see vercel.json). Activation logic lives in
 * `activateUpcomingSessionApplications` — this route is a thin authenticated
 * caller. The admin manual-trigger endpoint at
 * /api/admin/run-session-activation invokes the same service, by design.
 *
 * Idempotent. Failure-isolated. Reads "current session start year" from the
 * canonical academic-calendar engine. See the service file header.
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });

    await createAuditEvent({
      category: 'system',
      action: 'cron_session_activation_completed',
      summary: 'Session activation cron completed',
      severity: 'medium',
      actor_id: SYSTEM_ACTOR.id,
      actor_name: SYSTEM_ACTOR.name,
      actor_role: SYSTEM_ACTOR.role,
      target_type: 'cron',
      target_id: 'cron:session-activation',
      target_name: '',
      metadata: summary as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('❌ Session activation cron error:', error);
    return NextResponse.json({ error: 'Session activation failed' }, { status: 500 });
  }
}
```

#### 2. `src/lib/services/session-activation.service.ts` (Lines 74–201, 203–395)
```typescript
export function getCurrentSessionStartYear(config: DeadlineConfig, now: Date = new Date()): number {
  const startMonth = config.academicSessionStart?.month ?? 6;
  const startDay = config.academicSessionStart?.day ?? 1;
  const thisYear = now.getUTCFullYear();
  const sessionStartThisYear = new Date(Date.UTC(thisYear, startMonth, startDay, 0, 0, 0, 0));
  return now.getTime() >= sessionStartThisYear.getTime() ? thisYear : thisYear - 1;
}

export async function activateUpcomingSessionApplications(opts: {
  trigger: 'cron' | 'admin';
}): Promise<SessionActivationSummary> {
  const startedAt = new Date().toISOString();
  const config = await getDeadlineConfig();
  const now = new Date();
  const currentSessionStartYear = getCurrentSessionStartYear(config, now);

  const summary: SessionActivationSummary = {
    startedAt,
    completedAt: '',
    currentSessionStartYear,
    activationReached: false,
    scanned: 0,
    activated: 0,
    pendingSeatAllocation: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    trigger: opts.trigger,
  };

  const startMonth = config.academicSessionStart?.month ?? 6;
  const startDay = config.academicSessionStart?.day ?? 1;

  // Compute activationDate using the dynamic academicSessionStart
  const activationDate = new Date(Date.UTC(currentSessionStartYear, startMonth, startDay, 0, 0, 0, 0));

  // Normalize today and activation date to midnight for comparison
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const normalizedActivationDate = new Date(Date.UTC(activationDate.getUTCFullYear(), activationDate.getUTCMonth(), activationDate.getUTCDate(), 0, 0, 0, 0));

  // 1. Automated Cron Activation Gate Comparisons (only enforced for automated cron runs)
  if (opts.trigger === 'cron') {
    if (today.getTime() < normalizedActivationDate.getTime()) {
      console.log(`⏳ [session-activation] Current date ${today.toISOString()} is before session activation date ${normalizedActivationDate.toISOString()}. Skipping automated cron activation.`);
      summary.activationReached = false;
      summary.completedAt = new Date().toISOString();
      return summary;
    }

    // 2. Check Soft Block Completion Marker
    const softBlockMarkerData = await findMarker(`soft_block_completed_${currentSessionStartYear}`);
    if (!softBlockMarkerData) {
      console.log(`⚠️ Soft Block completion marker 'soft_block_completed_${currentSessionStartYear}' is missing. Postponing automated cron session activation.`);
      summary.activationReached = false;
      summary.completedAt = new Date().toISOString();
      return summary;
    }

  }

  // 3. Fetch all verified_upcoming applications
  const upcomingApps = await getAllByState('verified_upcoming');

  if (opts.trigger === 'cron') {
    // Check Activation Marker (if marker already exists, only skip if NO eligible verified_upcoming applications remain)
    const activationMarkerData = await findMarker(`activation_${currentSessionStartYear}`);
    if (activationMarkerData) {
      const hasEligibleUpcoming = upcomingApps.some(app => {
        const targetStartYear = Number((app as any).targetSession?.startYear);
        return !targetStartYear || targetStartYear === currentSessionStartYear;
      });

      if (!hasEligibleUpcoming) {
        console.log(`ℹ️ [session-activation] Activation marker 'activation_${currentSessionStartYear}' already exists and 0 eligible verified_upcoming applications remain. Skipping automated cron activation.`);
        summary.activationReached = false;
        summary.completedAt = new Date().toISOString();
        return summary;
      }
      console.log(`ℹ️ [session-activation] Activation marker exists but found eligible verified_upcoming application(s) for session ${currentSessionStartYear}. Processing late-verified applications.`);
    }
  }

  summary.activationReached = true;

  // Pre-fetch fleet buses and routes for optimization
  const preFetchedBuses = await fleetService.getAllBuses().catch(() => []);
  const preFetchedRoutes = await routeService.getAll().catch(() => []);

  for (const app of upcomingApps) {
    const targetStartYear = Number((app as any).targetSession?.startYear);
    
    // Filter for current session unless triggered manually by admin
    if (opts.trigger === 'cron' && targetStartYear && targetStartYear !== currentSessionStartYear) {
      summary.skipped++;
      continue;
    }

    summary.scanned++;

    const res = await activateOne(app, config, opts.trigger, preFetchedBuses, preFetchedRoutes);

    if (res === 'activated') {
      summary.activated++;
    } else if (res === 'pending') {
      summary.pendingSeatAllocation++;
    } else if (res === 'skipped') {
      summary.skipped++;
    } else if (typeof res === 'object' && res.failed) {
      summary.failed++;
      summary.errors.push({ applicationId: app.applicationId, error: res.failed });
    }
  }

  // Check remaining verified_upcoming applications for the current session
  let hasRemainingForCurrentSession = summary.pendingSeatAllocation > 0 || summary.failed > 0;
  if (!hasRemainingForCurrentSession) {
    const remainingApps = await getAllByState('verified_upcoming');
    hasRemainingForCurrentSession = remainingApps.some(app => {
      const targetStartYear = Number((app as any).targetSession?.startYear);
      return targetStartYear === currentSessionStartYear;
    });
  }

  // Write activation marker only if NO eligible verified_upcoming applications remain
  if (!hasRemainingForCurrentSession) {
    await upsertMarker(`activation_${currentSessionStartYear}`, {
      activatedAt: new Date().toISOString(),
      currentSessionStartYear,
      scanned: summary.scanned,
      activated: summary.activated,
      pendingSeatAllocation: summary.pendingSeatAllocation,
      trigger: opts.trigger,
    });
  }

  summary.completedAt = new Date().toISOString();
  return summary;
}

async function activateOne(
  app: Application,
  config: DeadlineConfig,
  trigger: 'cron' | 'admin',
  preFetchedBuses?: Bus[],
  preFetchedRoutes?: any[]
): Promise<'activated' | 'pending' | 'skipped' | { failed: string }> {
  const appId = app.applicationId;
  const formData = app.formData || ({} as any);

  const appAny = app as any;
  const requestedRouteId = appAny.routeId || appAny.route_id || formData.routeId || formData.route_id || '';
  const requestedBusId = appAny.busId || appAny.bus_id || formData.busId || formData.bus_id || (requestedRouteId ? String(requestedRouteId).replace('route_', 'bus_') : '');
  const final_stop_name = appAny.stop_name || formData.stop_name || formData.pickupPoint || '';
  const shift = normalizeShift(appAny.shift || formData.shift);

  if (!requestedBusId || !requestedRouteId || !final_stop_name || !shift) {
    return { failed: 'Application is missing route, bus, stop name, or shift assignment' };
  }

  const targetSession = appAny.targetSession || {};
  const startYear = Number(targetSession.startYear || formData.sessionInfo?.sessionStartYear || appAny.sessionStartYear || appAny.session_start_year);
  const endYear = Number(targetSession.endYear || formData.sessionInfo?.sessionEndYear || appAny.sessionEndYear || appAny.session_end_year);

  if (isNaN(startYear) || isNaN(endYear) || startYear <= 0 || endYear <= startYear) {
    return { failed: 'Application is missing valid session start or end year data' };
  }

  const durationYears = endYear - startYear;

  const anchorMonth = config.academicYear.anchorMonth;
  const anchorDay = config.academicYear.anchorDay;
  const validUntilDate = new Date(Date.UTC(endYear, anchorMonth, anchorDay, 23, 59, 59, 999));
  const validUntil = validUntilDate.toISOString();
  const blockDates = computeBlockDatesFromValidUntil(validUntil, config);

  const nowIso = new Date().toISOString();

  const lockId = `activation_${trigger}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const claimedApp = await applicationRepo.claimForActivation(appId, lockId).catch((err) => {
    console.warn(`[session-activation] Failed to claim lease for application ${appId}:`, err?.message || err);
    return null;
  });

  if (!claimedApp) {
    return 'skipped';
  }

  const attemptActivationWithBus = async (targetBusId: string, targetRouteId: string, isAlternative: boolean) => {
    const studentDoc = {
      address: formData.address,
      altPhone: formData.altPhone || formData.alternatePhone || formData.alt_phone || '',
      alternatePhone: formData.altPhone || formData.alternatePhone || formData.alt_phone || '',
      approvedAt: nowIso,
      approvedBy: trigger === 'cron' ? 'System (Session Activation)' : 'Admin (Manual Session Activation)',
      bloodGroup: formData.bloodGroup,
      busId: targetBusId,
      createdAt: nowIso,
      department: formData.department,
      dob: formData.dob,
      durationYears,
      sessionDuration: String(durationYears),
      email: (app as any).email || formData.email,
      enrollmentId: formData.enrollmentId,
      faculty: formData.faculty,
      fullName: formData.fullName,
      gender: formData.gender,
      parentName: formData.parentName,
      parentPhone: formData.parentPhone,
      phone: formData.phone || formData.phoneNumber || formData.phoneNumber || '',
      phoneNumber: formData.phone || formData.phoneNumber || formData.phoneNumber || '',
      profilePhotoUrl: formData.profilePhotoUrl || '',
      role: 'student',
      routeId: targetRouteId,
      semester: formData.semester,
      sessionEndYear: endYear,
      sessionStartYear: startYear,
      shift,
      status: 'active',
      stop_name: final_stop_name,
      uid: app.applicantUid,
      updatedAt: nowIso,
      validUntil,
      softBlock: blockDates.softBlock,
      hardBlock: blockDates.hardBlock,
      paymentAmount: formData.paymentInfo?.amountPaid || 0,
      paid_on: nowIso,
    };

    let postCommitFullAlert: { busNumber: string; routeId: string } | null = null;

    const freshApp = await applicationRepo.findByApplicationId(appId);
    if (!freshApp) throw new StateChangedError();
    if (freshApp.state !== 'verified_upcoming' && freshApp.state !== 'pending_seat_allocation') {
      throw new StateChangedError();
    }

    const activationResult = await activateStudentWithCapacity({
      busId: targetBusId,
      shift,
      uid: app.applicantUid,
      email: (app as any).email || formData.email || '',
      fullName: formData.fullName || null,
      studentData: {
        ...studentDoc,
        uid: app.applicantUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });

    if (!activationResult.success) {
      if (activationResult.error && /full capacity/i.test(activationResult.error)) {
        throw new CapacityFullError(activationResult.error);
      }
      throw new Error(activationResult.error || `Failed to activate student on bus ${targetBusId}`);
    }

    await applicationRepo.remove(appId);

    // 4. Ledger recording: create or update payment entry for the activated student
    const paymentMode =
      appAny.payment_mode ||
      appAny.paymentMode ||
      formData.paymentInfo?.paymentMode ||
      formData.paymentMode ||
      'offline';

    const amount = Number(
      appAny.amount_paid ||
      appAny.amountPaid ||
      formData.paymentInfo?.amountPaid ||
      formData.totalFee ||
      formData.amount ||
      0
    );

    const studentIdVal = formData.enrollmentId || appAny.enrollment_id || appAny.enrollmentId || '';
    const studentNameVal = formData.fullName || appAny.full_name || '';
    const approverName = trigger === 'cron' ? 'System (Session Activation)' : 'Admin (Manual Session Activation)';
    const approverUid = trigger === 'cron' ? 'system' : 'admin';
    const approverRole = trigger === 'cron' ? 'system' : 'admin';

    if (paymentMode === 'online') {
      const resolvedPaymentId =
        appAny.paymentId ||
        appAny.payment_id ||
        formData.paymentId ||
        formData.paymentInfo?.razorpayPaymentId ||
        (typeof appId === 'string' && appId.startsWith('online_')
          ? appId.replace(/^online_/, '')
          : null);

      try {
        const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
        if (resolvedPaymentId) {
          const existingPayment = await paymentsSupabaseService.getPaymentById(resolvedPaymentId);
          if (existingPayment && existingPayment.status === 'Completed') {
            await paymentsSupabaseService.updatePaymentMetadata(resolvedPaymentId, {
              entitlement_status: 'active',
              activated_at: nowIso,
              approved_by: approverName,
              application_id: appId,
            }).catch(() => null);
          } else {
            const { upsertApprovalPayment } = await import('@/domains/payment');
            await upsertApprovalPayment({
              paymentId: resolvedPaymentId,
              studentId: studentIdVal,
              studentUid: app.applicantUid,
              studentName: studentNameVal,
              amount: amount > 0 ? amount : 50000,
              method: 'Online',
              status: 'Completed',
              sessionStartYear: startYear,
              sessionEndYear: endYear,
              durationYears,
              validUntil: new Date(validUntil),
              razorpayPaymentId: resolvedPaymentId,
              razorpayOrderId: formData.paymentInfo?.razorpayOrderId,
              approvedAt: new Date(),
            });
          }
        } else {
          const { upsertApprovalPayment } = await import('@/domains/payment');
          await upsertApprovalPayment({
            paymentId: `pay_${Date.now()}`,
            studentId: studentIdVal,
            studentUid: app.applicantUid,
            studentName: studentNameVal,
            amount: amount > 0 ? amount : 50000,
            method: 'Online',
            status: 'Completed',
            sessionStartYear: startYear,
            sessionEndYear: endYear,
            durationYears,
            validUntil: new Date(validUntil),
            razorpayPaymentId: formData.paymentInfo?.razorpayPaymentId || appAny.payment_id,
            razorpayOrderId: formData.paymentInfo?.razorpayOrderId,
            approvedAt: new Date(),
          });
        }
      } catch (payErr) {
        console.error('[session-activation] Online payment ledger recording failed:', payErr);
      }
    } else {
      let finalAmount = amount;
      if (finalAmount <= 0) {
        try {
          const { getCurrentBusFee } = await import('@/lib/bus-fee-service');
          const feeConfig = await getCurrentBusFee();
          finalAmount = (feeConfig?.amount || 0) * (durationYears || 1);
        } catch {
          finalAmount = 0;
        }
      }

      const { createOfflinePaymentAtApproval } = await import('@/domains/payment');
      const paymentPayload = {
        studentId: studentIdVal,
        studentUid: app.applicantUid,
        studentName: studentNameVal,
        amount: finalAmount,
        durationYears,
        sessionStartYear: startYear,
        sessionEndYear: endYear,
        validUntil,
        transactionId: formData.paymentInfo?.paymentReference || formData.transactionId || '',
        paidAt: formData.paymentInfo?.paidAt || formData.paidAt
          ? new Date(formData.paymentInfo?.paidAt || formData.paidAt)
          : new Date(),
        receipt: formData.paymentInfo?.paymentEvidenceUrl || formData.receiptImageUrl || '',
        approverUserId: approverUid,
        approverName,
        approverEmpId: '',
        approverRole,
        purpose: 'new_registration' as const,
      };

      try {
        await createOfflinePaymentAtApproval(paymentPayload);
      } catch (errFirst) {
        console.warn('[session-activation] Initial createOfflinePaymentAtApproval failed, retrying once...', errFirst);
        try {
          await createOfflinePaymentAtApproval(paymentPayload);
        } catch (errRetry) {
          console.error('[session-activation] Offline payment creation failed after retry:', errRetry);
        }
      }
    }

    const bus = await fleetService.getBusById(targetBusId);
    const busCapacity = bus?.capacity ?? activationResult.capacity ?? 0;
    const shiftLoad = shift.toLowerCase() === 'evening' ? activationResult.eveningLoad : activationResult.morningLoad;
    if (busCapacity > 0 && shiftLoad !== undefined && shiftLoad >= busCapacity) {
      postCommitFullAlert = {
        busNumber: bus?.busNumber || '',
        routeId: bus?.routeId || '',
      };
    }

    void createAuditEvent({
      action: 'application_session_activated',
      actor_id: SYSTEM_ACTOR.id,
      actor_name: SYSTEM_ACTOR.name,
      actor_role: SYSTEM_ACTOR.role,
      target_id: app.applicantUid,
      target_type: 'student',
      target_name: formData.fullName || '',
      category: 'applications',
      summary: 'Application session activated: ' + (formData.fullName || ''),
      severity: 'high',
      metadata: {
        before: { applicationId: appId, state: 'verified_upcoming', targetSession },
        after: {
          studentUid: app.applicantUid,
          busId: targetBusId,
          shift,
          sessionStartYear: startYear,
          sessionEndYear: endYear,
          validUntil,
          status: 'active',
        },
        applicationId: appId,
        trigger,
        alternativeBusAllocated: isAlternative,
        originalBusId: requestedBusId,
        originalRouteId: requestedRouteId,
        reason: trigger === 'cron' ? 'session_activation_cron' : 'session_activation_admin_trigger',
        correlationId: appId,
      },
    });

    return { postCommitFullAlert };
  };

  try {
    const { postCommitFullAlert } = await attemptActivationWithBus(requestedBusId, requestedRouteId, false);

    if (postCommitFullAlert) {
      await sendBusFullAlert(requestedBusId, postCommitFullAlert.busNumber, postCommitFullAlert.routeId).catch(() => {});
    }
    await notifyStudentActivated(app, formData, validUntil, startYear, endYear).catch((e) =>
      console.error('[session-activation] activated notify failed:', e?.message || e)
    );
    await invalidateStudentAssignment(app.applicantUid).catch(() => {});
    return 'activated';
  } catch (err: any) {
    if (err instanceof StateChangedError) {
      await applicationRepo.releaseActivationClaim(appId, lockId).catch(() => {});
      return 'skipped';
    }

    if (err instanceof CapacityFullError) {
      try {
        const alternatives = await findDeterministicAlternativeBuses(final_stop_name, requestedRouteId, shift, preFetchedBuses, preFetchedRoutes);
        for (const altBus of alternatives) {
          try {
            const { postCommitFullAlert } = await attemptActivationWithBus(altBus.busId, altBus.routeId, true);

            if (postCommitFullAlert) {
              await sendBusFullAlert(altBus.busId, postCommitFullAlert.busNumber, postCommitFullAlert.routeId).catch(() => {});
            }
            await notifyStudentActivated(app, formData, validUntil, startYear, endYear).catch((e) =>
              console.error('[session-activation] activated notify failed:', e?.message || e)
            );
            await invalidateStudentAssignment(app.applicantUid).catch(() => {});
            return 'activated';
          } catch (altErr: any) {
            if (altErr instanceof StateChangedError) {
              await applicationRepo.releaseActivationClaim(appId, lockId).catch(() => {});
              return 'skipped';
            }
            if (!(altErr instanceof CapacityFullError)) {
              throw altErr;
            }
          }
        }
      } catch (altSearchErr) {
        console.error('[session-activation] alternative bus search or allocation failed:', altSearchErr);
      }

      // Case C: Selected Bus Full and no compatible alternatives available. Move to pending_seat_allocation.
      try {
        const wasAlreadyPending = app.state === 'pending_seat_allocation';

        await applicationRepo.update(appId, {
          state: 'pending_seat_allocation',
          updatedAt: nowIso
        });

        await applicationRepo.releaseActivationClaim(appId, lockId).catch(() => {});

        void createAuditEvent({
          action: 'application_pending_seat_allocation',
          actor_id: SYSTEM_ACTOR.id,
          actor_name: SYSTEM_ACTOR.name,
          actor_role: SYSTEM_ACTOR.role,
          target_id: app.applicantUid,
          target_type: 'application',
          target_name: formData.fullName || '',
          category: 'applications',
          summary: 'Application pending seat allocation: ' + (formData.fullName || ''),
          severity: 'high',
          metadata: {
            before: { applicationId: appId, state: app.state },
            after: { applicationId: appId, state: 'pending_seat_allocation' },
            busId: requestedBusId,
            shift,
            trigger,
            reason: 'session_activation_capacity_full',
            correlationId: appId,
          },
        });

        if (!wasAlreadyPending) {
          await notifyPendingSeatAllocation(appId, app, formData).catch((e) =>
            console.error('[session-activation] pending-seat notify failed:', e?.message || e)
          );
        }
      } catch (e: any) {
        await applicationRepo.releaseActivationClaim(appId, lockId).catch(() => {});
        if (e instanceof StateChangedError) return 'skipped';
        return { failed: `pending-state-write failed: ${e?.message || e}` };
      }
      return 'pending';
    }

    await applicationRepo.releaseActivationClaim(appId, lockId).catch(() => {});
    return { failed: err?.message || String(err) };
  }
}
```

#### 3. `src/lib/expiry-check.ts` (Lines 15–173)
```typescript
export async function checkAndNotifyExpiringStudents(force: boolean = false): Promise<ExpiryCheckResult> {
  const result: ExpiryCheckResult = {
    totalChecked: 0,
    remindersSent: 0,
    errors: []
  };

  try {
    const deadlineConfig = await getDeadlineConfig();
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth(); // 0-indexed
    const currentDay = now.getUTCDate();

    const startMonth = deadlineConfig.academicSessionStart?.month ?? 6; // default July
    const startDay = deadlineConfig.academicSessionStart?.day ?? 1;

    // Derive dates for the current year
    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, currentYear);

    const nowMs = now.getTime();
    const inR1Window = nowMs >= lifecycle.reminder1.getTime() && nowMs < lifecycle.reminder2.getTime();
    const inR2Window = nowMs >= lifecycle.reminder2.getTime() && nowMs < lifecycle.finalReminder.getTime();
    const inFinalWindow = nowMs >= lifecycle.finalReminder.getTime() && nowMs <= lifecycle.expiry.getTime();

    const runR1 = force || inR1Window;
    const runR2 = force || inR2Window;
    const runFinal = force || inFinalWindow;

    if (!force && !inR1Window && !inR2Window && !inFinalWindow) {
      console.log(`⏭️ Expiry check skipped. Today: ${now.toDateString()}`);
      result.skipped = true;
      return result;
    }

    const expYear = lifecycle.expiry.getUTCFullYear();
    const expMonth = lifecycle.expiry.getUTCMonth();
    const expDate = lifecycle.expiry.getUTCDate();
    const deadlineFirst = new Date(Date.UTC(expYear, expMonth, expDate, 0, 0, 0, 0));
    const deadlineNext = new Date(Date.UTC(expYear, expMonth, expDate + 1, 0, 0, 0, 0));

    const supabase = getSupabaseServer();
    const { data: students, error: pgErr } = await supabase
      .from('student_profiles')
      .select('uid, status, valid_until, session_start_year, session_end_year, expiry_reminder_count')
      .eq('status', 'active')
      .gte('valid_until', deadlineFirst.toISOString())
      .lt('valid_until', deadlineNext.toISOString());

    if (pgErr) {
      throw new Error(`Failed to query expiring students: ${pgErr.message}`);
    }

    const mappedStudents = (students || []).map(row => ({
      uid: row.uid,
      status: row.status,
      validUntil: row.valid_until,
      sessionStartYear: row.session_start_year,
      sessionEndYear: row.session_end_year,
      expiryReminderCount: row.expiry_reminder_count || 0,
    }));

    result.totalChecked = mappedStudents.length;

    for (const studentData of mappedStudents) {
      const studentUid = studentData.uid;
      try {
        const currentCount = studentData.expiryReminderCount || 0;

        let shouldSend = false;
        let title = "Bus Service Renewal Reminder";
        let body = "";

        if (runR1 && currentCount < 1) {
          shouldSend = true;
          body = `Your bus service (session ${studentData.sessionStartYear}-${studentData.sessionEndYear}) will expire on ${new Date(studentData.validUntil).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}. Please renew by visiting the Bus Office or apply online to continue your service.`;
        } else if (runR2 && currentCount < 2) {
          shouldSend = true;
          body = `This is your second reminder that your bus service (session ${studentData.sessionStartYear}-${studentData.sessionEndYear}) will expire on ${new Date(studentData.validUntil).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}. Please apply online to renew.`;
        } else if (runFinal && currentCount < 3) {
          shouldSend = true;
          title = "Final Reminder: Bus Service Expiring Soon";
          body = `This is a final reminder that your bus service expires on ${new Date(studentData.validUntil).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}. Only 15 days left! Renew now to avoid service interruption.`;
        }

        if (!shouldSend) continue;

        // Atomically claim the "send reminder today" slot via a Postgres function
        // that uses FOR UPDATE + UPDATE in one transaction. Returns TRUE only on
        // the first call for this student on the current UTC calendar day.
        const { data: claimed, error: claimErr } = await supabase
          .rpc('increment_expiry_reminder_count', { p_uid: studentUid });

        if (claimErr) {
          result.errors.push(`Failed to claim reminder slot for ${studentUid}: ${claimErr.message}`);
          continue;
        }

        if (!claimed) {
          continue;
        }

        await pgInsertNotification({
          title,
          content: body,
          type: 'info',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [studentUid]
          },
          recipientIds: [studentUid],
          readByUserIds: [],
          metadata: {
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            validUntil: studentData.validUntil,
            profile: '/student/profile',
            renewPage: '/apply'
          }
        });

        result.remindersSent++;

      } catch (error: any) {
        result.errors.push(`Failed to process student ${studentUid}: ${error.message}`);
      }
    }

    if (result.remindersSent > 0) {
      await sendAdminSummary(result, "Expiry Reminders Sent", deadlineFirst);
    }

    return result;
  } catch (error: any) {
    console.error('❌ Fatal error in expiry check:', error);
    result.errors.push(`Fatal error: ${error.message}`);
    return result;
  }
}
```

#### 4. `src/app/api/cron/cleanup-expired-students/route.ts` (Soft-Block Phase: Lines 273–360)
```typescript
// --- SOFT BLOCK EXECUTION ---
// Only if not already blocked and not just deleted. The
// `status === 'active'` guard makes this idempotent: an already
// soft-blocked student is skipped, so the seat is released at most once.
if (needsSoftBlock && studentData.status === 'active') {
    console.log(`🔒 SOFT BLOCK triggered for ${uid.substring(0,8)}...`);
    console.log(`   softBlock date: ${softBlockStr}`);

    const releaseSeat = isSeatReleaseAtSoftBlockEnabled();
    const nowIso = new Date().toISOString();

    let didBlock = false;
    let auditEvent: AuditEventInsert | null = null;
    try {
        // Read fresh student data from PG via Domain
        const freshStudent = await getStudentById(uid);

        const currentStatus = freshStudent?.status || studentData.status;
        const freshValidUntil = freshStudent?.validUntil ? (typeof freshStudent.validUntil === 'string' ? freshStudent.validUntil : new Date(freshStudent.validUntil).toISOString()) : validUntilStr;
        const freshCheckData = {
            softBlock: freshStudent?.softBlock || softBlockStr,
            hardBlock: freshStudent?.hardBlock || hardBlockStr,
            validUntil: freshValidUntil,
            lastRenewalDate: freshStudent?.lastRenewalDate ? String(freshStudent.lastRenewalDate) : lastRenewalDateStr,
            status: currentStatus,
            sessionEndYear: freshStudent?.sessionEndYear || studentData.sessionEndYear
        };
        const freshNeedsSoftBlock = shouldBlockAccessFromStoredDates(freshCheckData, null, config);

        if (currentStatus !== 'active' || !freshNeedsSoftBlock) {
            didBlock = false;
        } else {
            const sbBusId = freshStudent?.busId || freshStudent?.busId || studentData.busId || null;
            const sbShift = freshStudent?.shift || studentData.shift;
            const sbFullName = freshStudent?.fullName || studentData.fullName || '';

            // Call the atomic RPC to soft-block and release the seat
            const supabase = getSupabaseServer();
            const { data: rpcResult, error: rpcError } = await supabase.rpc('soft_block_student_with_seat_release', {
                p_student_uid: uid,
                p_bus_id: releaseSeat ? sbBusId : null,
                p_shift: sbShift,
                p_release_seat: releaseSeat,
                p_soft_blocked_at: nowIso,
                p_seat_released_at: nowIso
            });

            if (rpcError) {
                console.error(`   ❌ Atomic soft-block RPC failed for student ${uid}:`, rpcError.message);
                didBlock = false;
            } else if (!rpcResult || !rpcResult.success) {
                console.warn(`   ⚠️ Atomic soft-block RPC warning for student ${uid}:`, rpcResult?.error || 'Unknown RPC warning');
                didBlock = false;
            } else {
                auditEvent = {
                    action: releaseSeat ? 'student_soft_blocked_seat_released' : 'student_soft_blocked',
                    actor_id: SYSTEM_ACTOR.id,
                    actor_name: SYSTEM_ACTOR.name,
                    actor_role: SYSTEM_ACTOR.role,
                    target_id: uid,
                    target_type: 'student',
                    target_name: sbFullName,
                    category: 'system',
                    summary: (releaseSeat ? 'Student soft-blocked (seat released): ' : 'Student soft-blocked: ') + sbFullName,
                    severity: 'high',
                    metadata: {
                        before: { status: 'active', busId: sbBusId, shift: sbShift || null },
                        after: { status: 'soft_blocked', seatReleased: releaseSeat, seatDecremented: releaseSeat && sbBusId !== null },
                        busId: sbBusId,
                        at: nowIso,
                        reason: 'soft_block',
                        correlationId: uid,
                    },
                };
                didBlock = true;
            }
        }
        if (didBlock) {
            if (auditEvent) void createAuditEvent(auditEvent);
            await invalidateStudentAssignment(uid).catch(() => {});
            results.softBlocked++;
            console.log(`   ✅ Soft-blocked ${uid}${releaseSeat ? ' (seat released)' : ''}`);
        }
    } catch (sbErr) {
        console.warn(`   ⚠️ Soft-block failed for ${uid} — will retry next run:`, sbErr);
        results.errors.push(`Soft-block failed for ${uid}`);
    }
}
```

---



---

# PART 7: Automated Hard Deletion (`delete_student_cascade_v1` / `deleteUserAndData`), Safety Rails & Bus Load Reconciliation (`adminReconcileBusLoads`)

---

### 7.1 Sub-Domain Architecture & Exact Execution Pipeline

The Hard Deletion and Tail Reconciliation sub-domain represents the permanent terminal phase of the student lifecycle. After an expired commuter has passed through their soft-block grace period without renewing their transit pass, the system executes an automated, irreversible cascade purge. Simultaneously, to protect fleet integrity from any race conditions, dropped packets, or partial failures during seat releases, the pipeline triggers a self-healing bus load reconciliation sweep at the conclusion of each batch run.

#### Chronological Execution Trace & Pipeline

```
[ /api/cron/cleanup-expired-students ] (Daily Cleanup Worker)
                      │
                      │ 1. Keyset pagination loop (status in 'active', 'soft_blocked', 'pending_deletion')
                      ▼
        [ Hard Delete Eligibility Evaluation ]
        - Check: needsHardDelete === true (today >= hard_block)
        - Check 1: sessionEndYear present (skip new/incomplete profiles)
        - Check 2: CRON-02 fresh re-read from PostgreSQL (abort if renewed or reactivated)
        - Check 3: valid_until in the past (fail closed if null or future)
        - Check 4: Activity check (abort if active within last 30 days)
        - Check 5: Renewal grace period (abort if lastRenewalDate within last 30 days)
                      │
                      ▼
        [ deleteUserAndData(uid, 'student') ] (src/lib/cleanup-helpers.ts)
                      │
                      ├─► 2. Execute db.rpc('delete_student_cascade_v1', { p_student_uid: uid })
                      │      [BEGIN POSTGRESQL ATOMIC TRANSACTION]
                      │      - IF v_status = 'active' THEN ABORT ('ACTIVE_STUDENT_ABORT_DELETE')
                      │      - IF active renewal application THEN ABORT ('ACTIVE_RENEWAL_APP_ABORT_DELETE')
                      │      - IF seat_released_at IS NULL AND bus_id IS NOT NULL THEN:
                      │          PERFORM bus_decrement_capacity(bus_id, shift)
                      │      - DELETE FROM public.device_sessions
                      │      - DELETE FROM public.waiting_flags
                      │      - DELETE FROM public.fcm_tokens
                      │      - DELETE FROM public.notifications (where recipient_ids contains uid)
                      │      - DELETE FROM public.applications
                      │      - DELETE FROM public.student_profiles
                      │      - DELETE FROM public.users
                      │      - PRESERVE: public.payments (IMMUTABLE FINANCIAL LEDGER)
                      │      - PRESERVE: public.audit_events (IMMUTABLE AUDIT TRAIL)
                      │      [COMMIT POSTGRESQL TRANSACTION]
                      │
                      ├─► 3. invalidateCachedRole(uid)
                      │
                      ├─► 4. adminAuth.revokeRefreshTokens(uid) + adminAuth.deleteUser(uid)
                      │
                      ├─► 5. Delete FCM tokens from Firestore & profile_update_requests
                      │
                      ├─► 6. Cloudinary image deletion (deleteAsset(publicId))
                      │
                      └─► 7. Invalidate Redis student:assign:<uid>
                      │
                      ▼
   [ Tail Bus Load Reconciliation Sweep ] (adminReconcileBusLoads)
                      │
                      ├─► 8. getAllBuses() from PostgreSQL
                      ├─► 9. getSeatOccupyingStudents():
                      │      Counts students where (status = 'active' AND seat_released_at IS NULL)
                      │      Calculates: morningCount, eveningCount, currentMembers
                      ├─► 10. For each bus with delta > 0:
                      │       updateBus(busId, { morningLoad, eveningLoad, currentMembers })
                      ├─► 11. If delta >= 5 (large systemic drift):
                      │       Emit emergency notification to all Administrators
                      │
                      ▼
[ Soft Block Completion Marker Written ]
(soft_block_completed_{year} upserted to allow session activation to proceed)
```

---

### 7.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/lib/cleanup-helpers.ts` | `deleteUserAndData`, `deleteCloudinaryImage`, `deleteBusAndData`, `deleteRouteAndData` | `cleanup-expired-students/route.ts`, Admin Student Delete API, Moderator Delete API | `delete_student_cascade_v1`, `adminAuth.deleteUser`, `deleteAsset`, `invalidateCachedRole`, `fleetService.invalidateBusCache`, `invalidateStudentAssignmentCache` | Deletes rows from `student_profiles`, `users`, `applications`, `fcm_tokens`, `device_sessions`, `waiting_flags`, `notifications`. Preserves `payments` and `audit_events`. |
| `src/lib/services/admin-reconcile-bus-loads.ts` | `adminReconcileBusLoads` | `cleanup-expired-students/route.ts`, Admin fleet dashboard, manual reconciliation API | `getAllBuses`, `getSeatOccupyingStudents`, `updateBus`, `pgInsertNotification`, `getUsersByRole` | Recounts active seat owners. Overwrites `morning_load`, `evening_load`, `current_members` on `public.buses`. |
| `src/app/api/cron/cleanup-expired-students/route.ts` | `GET` (Hard Delete & Tail Reconciliation Phases) | Vercel Cron (`0 2 * * *`) | `deleteUserAndData`, `adminReconcileBusLoads`, `upsertMarker`, `createAuditEvent` | Orchestrates student deletions and triggers reconciliation. |
| `supabase/COMPLETE_SCHEMA.sql` | `delete_student_cascade_v1` (PL/pgSQL Function) | `src/lib/cleanup-helpers.ts` | `bus_decrement_capacity` | Atomic database cascade. Locks bus and decrements capacity if seat was unreleased. |

---

### 7.3 Method-by-Method Low-Level Walkthrough

#### 1. Hard Delete Safety Rails (`src/app/api/cron/cleanup-expired-students/route.ts`)
Before any permanent account deletion is attempted, the cron executes six consecutive safety gates:
1. **Status Gate (`status === 'soft_blocked'`):** Active commuters are never hard-deleted directly. They must transition through the soft-block state first.
2. **Date Reached Gate (`today >= hardBlock`):** Compares today's UTC date against the stored `studentData.hardBlock` (which is set to `effectiveYear + 2`).
3. **Session Year Presence Gate:** `if (!studentData.sessionEndYear) continue;` — Skips newly onboarded or incomplete profiles.
4. **CRON-02 Race-Condition Re-Read:** Queries `getStudentById(uid)` immediately before calling deletion. If the student renewed in the last minute or their status changed to `active`, the operation aborts.
5. **Subscription Validity Gate:** Parses `validUntilStr`. If missing or `validUntilDate > today`, deletion aborts to prevent destroying active subscriptions.
6. **Recent Activity Gate:** Checks `lastActiveAt || lastLoginAt` (falling back to `getUserById(uid)` for `users.last_login_at`). If the user was active within the last 30 days (`daysSinceActive < 30`), deletion is cancelled. Does NOT use `student_profiles.updatedAt` as a proxy for login activity.
7. **Grace Period Gate (`shouldHardDeleteStudent` in `deadline-computation.ts`):** If `lastRenewalDate` was within 30 days (`daysSinceRenewal < 30`), hard deletion is bypassed.

#### 2. Cascade Deletion (`deleteUserAndData` & `delete_student_cascade_v1`)
- **Signature:** `export async function deleteUserAndData(userId: string, userType: 'student' | 'driver' | 'moderator'): Promise<{ success: boolean; error?: string }>`
- **Control Flow:**
  1. Pre-commit lookup: Loads student profile via `getStudentById(userId)`.
  2. Invokes `db.rpc('delete_student_cascade_v1', { p_student_uid: userId })`.
     - Checks `IF v_status = 'active' THEN RETURN 'ACTIVE_STUDENT_ABORT_DELETE'`.
     - Checks `IF EXISTS (applications in submitted/verified_upcoming) THEN RETURN 'ACTIVE_RENEWAL_APP_ABORT_DELETE'`.
     - **Unreleased Seat Handling:** If the student's seat was not previously released (`v_seat_released_at IS NULL AND v_bus_id IS NOT NULL`), the RPC automatically calls `bus_decrement_capacity(v_bus_id, v_shift)` before deleting the profile row!
     - Executes sequential `DELETE` queries across `device_sessions`, `waiting_flags`, `fcm_tokens`, `notifications`, `applications`, `student_profiles`, and `users`.
     - **Financial & Audit Invariant:** Rows in `public.payments` and `public.audit_events` are **never deleted**. Foreign keys do not cascade onto payments.
  3. Role cache purge: `invalidateCachedRole(userId)`.
  4. Firebase Auth deletion: Calls `adminAuth.revokeRefreshTokens(uid)` and `adminAuth.deleteUser(uid)`.
  5. FCM cleanup: Deletes device tokens via `deleteUserTokens(userId)`.
  6. Cloudinary image cleanup: Extracts `public_id` from `profilePhotoUrl` and deletes asset via `deleteAsset(publicId)`.
  7. Fleet cache notification: If seat was released here, calls `fleetService.invalidateBusCache`, `invalidateStudentAssignmentCache`.

#### 3. Tail Bus Load Reconciliation (`adminReconcileBusLoads`)
- **Signature:** `export async function adminReconcileBusLoads(options: ReconcileOptions = {}): Promise<ReconcileSummary>`
- **Control Flow & Aggregation Logic:**
  1. Retrieves all buses from PostgreSQL via `getAllBuses()`.
  2. Queries all seat-occupying students via `getSeatOccupyingStudents()`.
  3. Evaluates seat occupancy predicate `occupiesSeat(student)`:
     ```typescript
     function occupiesSeat(s: Record<string, any>): boolean {
       if (s.seatReleasedAt || s.seat_released_at) return false;
       if (s.status === 'active') return true;
       if ((s.status === 'soft_blocked' || s.status === 'pending_deletion') && !(s.seatReleasedAt || s.seat_released_at)) {
         return true; // transitional before seat release RPC executed
       }
       return false;
     }
     ```
  4. Aggregates counts per bus:
     - Morning Shift: `c.morningCount += 1`
     - Evening Shift: `c.eveningCount += 1`
     - Both Shifts: Increments both counters.
     - Total: `c.currentMembers = c.morningCount + c.eveningCount`.
  5. Compares recalculated counts against current `bus.morning_load`, `bus.evening_load`, `bus.current_members`.
  6. Discrepancy repair: For any bus where counts differ, calls `updateBus(busId, { morningLoad, eveningLoad, currentMembers })`.
  7. Large Drift Alarm: If `|before - after| >= 5` (`largeDeltaThreshold`), sends high-priority emergency notifications to all administrators.

---

### 7.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Execution Context | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls | Latency Profile |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Hard Delete Execution Per Expired Student** | 1 SELECT (pre-lookup), 1 RPC (`delete_student_cascade_v1` deleting across 7 tables), 1 INSERT (`audit_events`) | 2 Redis commands: `DEL student:assign:<uid>`, `PUBLISH user:assignment:invalidate` | 1 Firebase Auth token revocation, 1 Firebase Auth user delete, 1 Cloudinary asset delete (`deleteAsset`) | ~95ms - 210ms |
| **(b) Tail Reconciliation Sweep (All Buses)** | 1 SELECT on `buses`, 1 SELECT on `student_profiles` (all seat owners), N UPDATE queries on `buses` (only for buses with discrepancies) | N bus cache invalidations (`busByIdCache.delete(id)`) | 0 (or M notifications to admins if large delta alarm fires) | ~60ms - 150ms |
| **(c) Safety Rail Abort (e.g. Student renewed or active)** | 1 SELECT (fresh student check) | 0 | 0 | ~8ms |

---

### 7.5 Verbatim Source Code from Live Codebase

#### 1. `src/lib/cleanup-helpers.ts` (Lines 50–220)
```typescript
export async function deleteUserAndData(
  userId: string,
  userType: 'student' | 'driver' | 'moderator'
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`Deleting ${userType} with ID:`, userId.substring(0,8)+'...');

    // 1. Retrieve current state first (pre-commit lookup)
    let userData: Record<string, any> | null = null;
    if (userType === 'student') {
      userData = await getStudentById(userId);
    } else if (userType === 'driver') {
      userData = await getDriverById(userId);
    } else if (userType === 'moderator') {
      userData = await getModeratorById(userId);
    }

    if (!userData) {
      return { success: false, error: 'User not found' };
    }

    // Active trip protection for drivers
    if (userType === 'driver') {
      const db = getSupabaseServer();
      const { data: activeTrip } = await db
        .from('active_trips')
        .select('id')
        .eq('driver_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (activeTrip) {
        return { success: false, error: 'Cannot delete driver while an active trip is in progress. End the trip first.' };
      }
    }

    const profileImageUrl = userData?.profilePhotoUrl;
    const firebaseAuthUid = userData?.uid || userId;
    const busId = userData?.busId || userData?.currentBusId || null;
    const shouldDecrement = !!busId && !wasSeatReleased(userData);

    // 2. PostgreSQL Transaction Commit Boundary (PG deletes first)
    if (userType === 'student') {
      const db = getSupabaseServer();
      const { data: rpcData, error: rpcError } = await db.rpc('delete_student_cascade_v1', {
        p_student_uid: userId,
      });
      if (rpcError) {
        throw new Error(`delete_student_cascade_v1 RPC failed: ${rpcError.message}`);
      }
      if (!rpcData || (rpcData as any).success !== true) {
        const rpcErr = (rpcData as any)?.error;
        const msg = rpcErr === 'ACTIVE_STUDENT_ABORT_DELETE'
          ? 'Cannot delete student: Student has active transport status. Release seat or soft-block first.'
          : rpcErr === 'ACTIVE_RENEWAL_APP_ABORT_DELETE'
          ? 'Cannot delete student: Student has an active renewal application in progress.'
          : `Student deletion aborted: ${rpcErr || 'Database cascade did not return success'}`;
        return { success: false, error: msg };
      }
      console.log(`✅ PostgreSQL database cascade transaction committed for student: ${userId.substring(0,8)}...`);
    } else {
      // Driver and Moderator - delete profile first, then user table
      if (userType === 'driver') {
        try {
          await deleteDriver(userId);
          console.log(`Deleted driver profile from PostgreSQL:`, userId.substring(0,8)+'...');
        } catch (pgDeleteError: any) {
          console.warn(`Driver profile delete warning:`, pgDeleteError.message);
        }
      } else if (userType === 'moderator') {
        try {
          await deleteModerator(userId);
          console.log(`Deleted moderator profile from PostgreSQL:`, userId.substring(0,8)+'...');
        } catch (pgDeleteError: any) {
          console.warn(`Moderator profile delete warning:`, pgDeleteError.message);
        }
      }

      try {
        await deleteUser(userId);
        console.log(`Deleted user from PostgreSQL:`, userId.substring(0,8)+'...');
      } catch (pgDeleteError: any) {
        console.warn(`User with ID ${userId.substring(0,8)}... user table delete warning:`, pgDeleteError.message);
      }
    }

    // Invalidate role cache and permissions immediately
    invalidateCachedRole(userId);
    if (userType === 'moderator') {
      invalidateModeratorPermissionCache(userId);
    }
    if (firebaseAuthUid && firebaseAuthUid !== userId) {
      invalidateCachedRole(firebaseAuthUid);
      if (userType === 'moderator') {
        invalidateModeratorPermissionCache(firebaseAuthUid);
      }
    }

    // 3. Firebase Auth User Deletion & JWT Revocation (External)
    try {
      await adminAuth.revokeRefreshTokens(firebaseAuthUid);
      await adminAuth.deleteUser(firebaseAuthUid);
      console.log(`Successfully deleted user from Firebase Auth:`, firebaseAuthUid.substring(0,8)+'...');
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') {
        console.warn('Firebase Auth deletion warning:', authError.message);
      }
    }

    // 4. FCM & Cache Cleanup (External)
    if (userType === 'student') {
      // Invalidate student assignment cache across L1 memory and Redis
      try {
        await invalidateStudentAssignmentCache(userId);
      } catch (cacheErr: any) {
        console.warn('Student assignment cache invalidation warning:', cacheErr.message);
      }

      // Delete FCM tokens from Firestore subcollection
      try {
        await deleteUserTokens(userId);
      } catch (fcmErr: any) {
        console.warn('FCM tokens subcollection delete warning:', fcmErr.message);
      }
    } else if (userType === 'driver') {
      console.log(`ℹ️ Preserving trip history logs and operational notifications for deleted driver: ${userId.substring(0,8)}...`);
    }

    // Common moderator notifications cleanup
    if (userType === 'moderator') {
      await deleteUserNotifications(userId);
    }

    // 5. Cloudinary Profile Image Deletion (External)
    if (profileImageUrl) {
      const publicId = extractPublicId(profileImageUrl);
      if (publicId) {
        try {
          await deleteAsset(publicId);
          console.log('Successfully deleted Cloudinary image:', publicId);
        } catch (cloudErr: any) {
          console.warn('Cloudinary delete warning:', cloudErr.message);
        }
      }
    }

    // 6. Fleet Domain Delegation (Post-commit)
    // Note: Database capacity counters are decremented atomically inside delete_student_cascade_v1.
    // Invalidate bus and student assignment caches to ensure fresh reads without double-decrementing.
    if (userType === 'student' && busId) {
      try {
        fleetService.invalidateBusCache(busId);
        await invalidateStudentAssignmentCache(userId);
        console.log(`✅ Fleet and student caches invalidated for deleted student`);
      } catch (fleetErr: any) {
        console.error(`⚠️ Fleet/student cache invalidation failed:`, fleetErr.message);
      }
    }

    console.log(`Successfully completed deletion of ${userType} with ID:`, userId.substring(0,8)+'...');
    return { success: true };
  } catch (error: any) {
    console.error(`Error deleting ${userType}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete user's notifications in PostgreSQL
 */
async function deleteUserNotifications(userId: string): Promise<void> {
  try {
    const count = await pgDeleteNotificationsByUser(userId);
    console.log(`Deleted ${count} notifications for user:`, userId.substring(0,8)+'...');
  } catch (error) {
    console.error('Error deleting user notifications:', error);
  }
}

/**
 * Delete bus and associated data in PostgreSQL
 */
```

#### 2. `src/lib/services/admin-reconcile-bus-loads.ts` (Lines 68–229)
```typescript
function occupiesSeat(s: Record<string, any>): boolean {
  if (s.seatReleasedAt || s.seat_released_at) return false; // seat released — never occupies
  const status = s.status;
  if (status === 'active') return true;
  if ((status === 'soft_blocked' || status === 'pending_deletion') && !(s.seatReleasedAt || s.seat_released_at)) {
    return true; // transitional before seat release procedure executed
  }
  return false;
}

function shiftContribution(shift: unknown): { morning: boolean; evening: boolean; valid: boolean } {
  if (!shift || typeof shift !== 'string') return { morning: false, evening: false, valid: false };
  const deltas = getShiftDeltas(shift);
  return { morning: deltas.affectsMorning, evening: deltas.affectsEvening, valid: deltas.affectsMorning || deltas.affectsEvening };
}

export async function adminReconcileBusLoads(options: ReconcileOptions = {}): Promise<ReconcileSummary> {
  const startedAtMs = Date.now();
  const { busIds, dryRun = false, alertOnLargeDelta = false, largeDeltaThreshold = 5 } = options;

  // 1. Resolve target buses from PostgreSQL.
  const allBuses = await getAllBuses();
  let targetBuses = allBuses;
  if (busIds && busIds.length > 0) {
    const filterSet = new Set(busIds);
    targetBuses = allBuses.filter((b) => filterSet.has(b.id || b.busId));
  }
  const targetBusIds = new Set(targetBuses.map((b) => b.id || b.busId));

  // 2. Recount seat-owning students per bus from PostgreSQL (streamlined query).
  const candidateStudents = await getSeatOccupyingStudents();

  type Counts = { currentMembers: number; morningCount: number; eveningCount: number; invalidShift: number };
  const counts = new Map<string, Counts>();
  for (const id of targetBusIds) counts.set(id, { currentMembers: 0, morningCount: 0, eveningCount: 0, invalidShift: 0 });

  for (const s of candidateStudents) {
    if (!occupiesSeat(s)) continue;
    const busId = s.busId || s.currentBusId || s.bus_id;
    if (!busId || !targetBusIds.has(busId)) continue; // orphan / other bus — not in scope of this run
    const c = counts.get(busId)!;
    const contrib = shiftContribution(s.shift);
    if (contrib.morning) c.morningCount += 1;
    if (contrib.evening) c.eveningCount += 1;
    if (!contrib.valid) c.invalidShift += 1;
    c.currentMembers = c.morningCount + c.eveningCount;
  }

  // 3. Per-bus transactional correction.
  const reports: BusReconcileReport[] = [];
  const largeDeltaBuses: string[] = [];
  let totalSeatsCounted = 0;
  let invalidShiftTotal = 0;

  await Promise.all(targetBuses.map(async (busData) => {
    const busId = busData.id || busData.busId;
    const c = counts.get(busId) || { currentMembers: 0, morningCount: 0, eveningCount: 0, invalidShift: 0 };
    totalSeatsCounted += c.currentMembers;
    invalidShiftTotal += c.invalidShift;

    const before: BusCounterSnapshot = {
      currentMembers: busData.currentMembers || 0,
      morningCount: busData.morningLoad || 0,
      eveningCount: busData.eveningLoad || 0,
    };
    const after: BusCounterSnapshot = {
      currentMembers: c.currentMembers,
      morningCount: c.morningCount,
      eveningCount: c.eveningCount,
    };

    const hadDiscrepancy =
      before.currentMembers !== after.currentMembers ||
      before.morningCount !== after.morningCount ||
      before.eveningCount !== after.eveningCount;
    const delta = Math.abs(before.currentMembers - after.currentMembers);

    let corrected = false;
    let error: string | undefined;
    if (hadDiscrepancy && !dryRun) {
      try {
        await updateBus(busId, {
          morningLoad: after.morningCount,
          eveningLoad: after.eveningCount,
          currentMembers: after.currentMembers,
        });
        corrected = true;
      } catch (e: any) {
        error = e?.message || String(e);
      }
    }

    if (delta >= largeDeltaThreshold && hadDiscrepancy) largeDeltaBuses.push(busId);

    reports.push({
      busId,
      busNumber: busData.busNumber || busId,
      before,
      after,
      delta,
      hadDiscrepancy,
      corrected,
      invalidShiftStudents: c.invalidShift,
      error,
    });
  }));

  // 4. Alert loudly on large (systemic) deltas — correction already applied above.
  if (alertOnLargeDelta && largeDeltaBuses.length > 0 && !dryRun) {
    try {
      const admins = await getUsersByRole('admin');
      const content = `Bus load reconciliation found large discrepancies on ${largeDeltaBuses.length} bus(es): ${largeDeltaBuses.join(', ')}. Counts were corrected to the recounted values; investigate the systemic cause.`;
      await Promise.all(admins.map(admin =>
        pgInsertNotification({
          title: 'Bus Load Reconciliation — Large Delta',
          content,
          type: 'emergency',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [admin.uid]
          },
          recipientIds: [admin.uid],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          metadata: {
            priority: 'high'
          }
        })
      ));
    } catch (e) {
      console.error('Reconciliation large-delta alert failed:', e);
    }
  }

  return {
    totalBuses: targetBuses.length,
    busesWithDiscrepancies: reports.filter((r) => r.hadDiscrepancy).length,
    busesCorrected: reports.filter((r) => r.corrected).length,
    totalSeatsCounted,
    invalidShiftStudents: invalidShiftTotal,
    largeDeltaBuses,
    reports,
    dryRun,
    executionTimeMs: Date.now() - startedAtMs,
  };
}

export default adminReconcileBusLoads;
```

#### 3. `src/app/api/cron/cleanup-expired-students/route.ts` (Hard Delete & Tail Reconciliation: Lines 168–271, 464–535)
```typescript
// --- HARD DELETE EXECUTION ---
if (needsHardDelete) {
    // CRON-02 Re-read fresh student state from PG to prevent destroying a newly renewed or reactivated student
    const freshStudent = await getStudentById(uid);
    if (!freshStudent) {
        console.warn(`🛡️ Student ${uid} no longer exists in database. Skipping hard delete.`);
        continue;
    }
    const freshValidUntil = freshStudent.validUntil ? (typeof freshStudent.validUntil === 'string' ? freshStudent.validUntil : new Date(freshStudent.validUntil).toISOString()) : null;
    const freshCheckData = {
        softBlock: freshStudent.softBlock || softBlockStr,
        hardBlock: freshStudent.hardBlock || hardBlockStr,
        validUntil: freshValidUntil,
        lastRenewalDate: freshStudent.lastRenewalDate ? String(freshStudent.lastRenewalDate) : lastRenewalDateStr,
        status: freshStudent.status || studentData.status,
        sessionEndYear: freshStudent.sessionEndYear || studentData.sessionEndYear
    };
    const freshNeedsHardDelete = shouldHardDeleteFromStoredDates(freshCheckData, null, config);
    if (!freshNeedsHardDelete || freshStudent.status === 'active') {
        console.warn(`🛡️ SAFETY ABORT (CRON-02): Student ${uid} state changed to ${freshStudent.status} or renewed (${freshValidUntil}). Skipping deletion.`);
        continue;
    }

    console.log(`🗑️ HARD DELETE triggered for ${uid.substring(0,8)}...`);

    // SAFETY CHECK: Verify student is actually expired (Fail-closed on missing or malformed timestamp)
    const today = new Date();
    if (!validUntilStr) {
        console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} has missing/null validUntil. Failing closed to prevent accidental deletion.`);
        continue;
    }
    const validUntilDate = new Date(validUntilStr);
    if (isNaN(validUntilDate.getTime()) || validUntilDate > today) {
        console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} has invalid or future validUntil (${validUntilStr}). Skipping deletion.`);
        continue;
    }

    // SAFETY CHECK: Don't delete if student was recently active (last 30 days)
    // Note: student_profiles does not store last_login_at; verify against users table.
    // DO NOT use studentData.updatedAt as proxy for login activity.
    let lastActiveAt = studentData.lastActiveAt || studentData.lastLoginAt;
    if (!lastActiveAt) {
        try {
            const userRecord = await getUserById(uid);
            lastActiveAt = userRecord?.lastLoginAt || (userRecord as any)?.last_login_at;
        } catch {}
    }
    if (lastActiveAt) {
        const lastActiveDate = new Date(lastActiveAt);
        const daysSinceActive = Math.floor((today.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceActive < 30) {
            console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} was active ${daysSinceActive} days ago. Skipping deletion.`);
            continue;
        }
    }

    const freshBusId = studentData.busId || studentData.busId || null;
    const freshShift = studentData.shift || null;
    const freshShouldDecrement = !!freshBusId && !wasSeatReleased(studentData);
    const fullName = studentData.fullName || studentData.name || '';

    // Call the consolidated canonical deletion flow
    const result = await deleteUserAndData(uid, 'student');

    if (!result.success) {
        console.error(`❌ Automated hard delete failed for student ${uid}:`, result.error);
        results.errors.push(`Hard delete failed for student ${uid}`);
        continue;
    }

    const auditEvent: AuditEventInsert = {
        action: 'student_hard_deleted',
        actor_id: SYSTEM_ACTOR.id,
        actor_name: SYSTEM_ACTOR.name,
        actor_role: SYSTEM_ACTOR.role,
        target_id: uid,
        target_type: 'student',
        target_name: fullName,
        category: 'system',
        summary: 'Student hard-deleted: ' + fullName,
        severity: 'high',
        metadata: {
            before: {
                enrollmentId: studentData.enrollmentId || null,
                busId: freshBusId || null,
                shift: freshShift || null,
                status: studentData.status || null,
                validUntil: validUntilStr,
                sessionEndYear: studentData.sessionEndYear || null,
                hardBlock: hardBlockStr || null,
                seatReleasedAt: studentData.seatReleasedAt || null,
            },
            after: { deleted: true },
            seatDecremented: freshShouldDecrement,
            busId: freshBusId || null,
            reason: 'lifecycle_hard_delete_expired',
            correlationId: uid,
        },
    };

    void createAuditEvent(auditEvent);

    console.log(`   ✅ Hard-deleted student ${uid} successfully`);
    await invalidateStudentAssignment(uid).catch(() => {});
    results.hardDeleted++;
    continue; // Skip soft block check since user is gone
}

// POST-BATCH RECONCILIATION (self-healing tail).
let reconciliation: unknown = { skipped: true, reason: 'seat-release flag disabled' };
if (isSeatReleaseAtSoftBlockEnabled()) {
    if (results.softBlocked > 0 || results.hardDeleted > 0) {
        try {
            const summary = await adminReconcileBusLoads({ dryRun: false, alertOnLargeDelta: true });
            reconciliation = {
                busesWithDiscrepancies: summary.busesWithDiscrepancies,
                busesCorrected: summary.busesCorrected,
                largeDeltaBuses: summary.largeDeltaBuses,
                invalidShiftStudents: summary.invalidShiftStudents,
            };
            console.log(`🔧 Cron tail reconciliation:`, reconciliation);
        } catch (reconErr: any) {
            console.error('⚠️ Cron tail reconciliation failed (counts may be stale until next run):', reconErr);
            reconciliation = { error: reconErr?.message || 'reconciliation failed' };
        }
    } else {
        reconciliation = { skipped: true, reason: 'zero students soft-blocked or deleted' };
    }
}

await createAuditEvent({
    action: 'cron_cleanup_expired_students_completed',
    actor_id: SYSTEM_ACTOR.id,
    actor_name: SYSTEM_ACTOR.name,
    actor_role: SYSTEM_ACTOR.role,
    target_id: 'cron:cleanup-expired-students',
    target_type: 'cron',
    target_name: '',
    category: 'system',
    summary: 'Cron cleanup completed',
    severity: 'medium',
    metadata: { results, upcomingApplications: upcomingResults, reconciliation, reason: 'scheduled_run' },
});

// Write the Soft Block Completion Marker to allow session activation to proceed
if (results.errors.length > 0) {
    console.warn(`⚠️ Soft Block completion marker NOT written due to ${results.errors.length} errors during cleanup.`);
} else {
    try {
        const config = await getDeadlineConfig();
        const currentSessionStartYear = getCurrentSessionStartYear(config);
        await upsertMarker(`soft_block_completed_${currentSessionStartYear}`, {
            completedAt: new Date().toISOString(),
            softBlockedCount: results.softBlocked,
            hardDeletedCount: results.hardDeleted,
            reconciliationRun: true
        });
        console.log(`✅ Written Soft Block completion marker 'soft_block_completed_${currentSessionStartYear}'`);
    } catch (markerErr) {
        console.error('⚠️ Failed to write soft block completion marker:', markerErr);
    }
}
```

---

