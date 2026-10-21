# Payment & Academic Lifecycle Crons: Expiry Warnings, Soft-Block & Retention (Forensic Truth)

**Module:** Automated Daily Cron Execution, Expiry Window Warnings (7d/3d), Soft-Block Seat Release & Cascade Deletion  
**File Authority:** `src/app/api/cron/cleanup-expired-students/route.ts`, `src/app/api/cron/payment-expiry-check/route.ts`  
**Database RPCs:** `soft_block_student_with_seat_release`, `delete_student_cascade_v1`  

---

# PART 9: Automated Academic Lifecycle Crons (Session Activation, Expiry Warnings, Soft-Block Seat Release & Hard Delete)

### 9.1 Sub-Domain Architecture & Exact Execution Pipeline

The automated academic lifecycle background workers manage the multi-year progression of transport commuters across 4 distinct chronological phases:
1. **Phase 1: Expiry Warning Reminders (`/api/cron/expiry-check`)**:
   - Triggers at 90 days, 60 days, and 15 days prior to session expiry.
   - Atomic CAS counter (`increment_expiry_reminder_count`) prevents duplicate spam.
2. **Phase 2: Soft-Block & Seat Relinquishment (`/api/cron/cleanup-expired-students` Step 1)**:
   - When `today >= softBlock`, calls atomic RPC `soft_block_student_with_seat_release`.
   - Transitions student to `status = 'soft_blocked'`, sets `seat_released_at = NOW()`, and atomically decrements bus loads.
3. **Phase 3: Hard Account Deletion (`/api/cron/cleanup-expired-students` Step 2)**:
   - When `today >= hardDelete`, evaluates fail-closed safety rails (skips accounts active in the last 30 days or with future `validUntil`).
   - Invokes `deleteUserAndData(uid, 'student')` calling `delete_student_cascade_v1`, purging DB records, Cloudinary photos, and Firebase Auth.
4. **Phase 4: New Session Activation (`/api/cron/session-activation`)**:
   - Fires upon arrival of the new academic session anchor date.
   - Requires `soft_block_completed_${year}` marker from Phase 2.
   - Activates `verified_upcoming` applications: reserves bus capacity atomically via `activateStudentWithCapacity`, transitions state to active, or routes to `pending_seat_allocation` if the bus is full.
5. **Post-Batch Healing Tail (`adminReconcileBusLoads`)**:
   - Recounts active seat-owning commuters per bus and repairs any counter drift.

```
                                   DAILY CRON TIMELINE & EXECUTION
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 │ (15-90 Days Before Expiry)     │ (At Soft-Block Date)           │ (At Rollover Date)
                 ▼                                ▼                                ▼
       GET /api/cron/expiry-check       GET /api/cron/cleanup-expired-students   GET /api/cron/session-activation
                 │                                │                                │
       deriveAcademicLifecycle()                  │                                Check marker:
       - 90d (R1), 60d (R2), 15d (Final)          │                                soft_block_completed_{year}
                 │                                │                                │
       Query students expiring today              │                                Fetch all 'verified_upcoming'
                 │                                │                                applications for current session
       RPC increment_expiry_reminder_count        │                                │
       (Atomic CAS: returns TRUE once/day)        │                                Attempt activation with bus:
                 │                                │                                activateStudentWithCapacity()
       Dispatch push notification & email         │                                │
                                                  │                        Capacity available?
                                                  │                         ├── YES ──► Student active, pass issued
                                                  │                         └── NO  ──► Try alternative buses
                                                  │                                      └── None have room?
                                                  │                                          └── state = 'pending_seat_allocation'
                                                  │
                                                  ├────────────────────────────────┬────────────────────────────────┐
                                                  │                                │                                │
                                                  ▼                                ▼                                ▼
                                       [Step 1: Soft Block]              [Step 2: Hard Delete]             [Step 3: Reconcile]
                                       today >= softBlock                today >= hardDelete               adminReconcileBusLoads()
                                                  │                                │                                │
                                       RPC soft_block_student_with_seat_release Fail-closed check:         Recount active commuters
                                       - status = 'soft_blocked'         - Not active in 30 days           per bus (morning/evening)
                                       - seat_released_at = NOW()        - No future validUntil            and overwrite buses counters.
                                       - buses load decremented                   │                                 │
                                                  │                      deleteUserAndData()               Upsert marker:
                                                  ▼                      - RPC delete_student_cascade_v1   soft_block_completed_{year}
                                       Emit audit_events                 - Purge Cloudinary images
                                                                         - Purge Firebase Auth
```

---

### 9.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/cron/session-activation/route.ts` | `GET` | Scheduled cron (Vercel Cron) | `verifyCronAuth`, `activateUpcomingSessionApplications`, `createAuditEvent` | Emits `public.audit_events` |
| `src/lib/services/session-activation.service.ts` | `activateUpcomingSessionApplications`, `getCurrentSessionStartYear` | `/api/cron/session-activation`, `/api/admin/run-session-activation` | `findMarker`, `upsertMarker`, `getAllByState`, `activateStudentWithCapacity`, `findDeterministicAlternativeBuses`, `createAuditEvent` | Mutates `public.applications` (removes or sets `pending_seat_allocation`), `public.student_profiles`, `public.buses`, `public.audit_events` |
| `src/app/api/cron/expiry-check/route.ts` | `GET`, `POST` | Scheduled cron, Admin manual trigger | `verifyCronAuth`, `checkAndNotifyExpiringStudents`, `sendMidJuneReminder` | None directly (delegates to helper) |
| `src/lib/expiry-check.ts` | `checkAndNotifyExpiringStudents`, `sendMidJuneReminder` | `/api/cron/expiry-check` | `getDeadlineConfig`, `deriveAcademicLifecycle`, Supabase Client, RPC `increment_expiry_reminder_count`, `pgInsertNotification` | Mutates `public.student_profiles.expiry_reminder_count` via RPC, inserts into `public.notifications` |
| `src/app/api/cron/cleanup-expired-students/route.ts` | `GET` | Scheduled cron | `verifyCronAuth`, `getDeadlineConfig`, `getStudentsByStatusesPaged`, `shouldBlockAccessFromStoredDates`, `shouldHardDeleteFromStoredDates`, RPC `soft_block_student_with_seat_release`, `deleteUserAndData`, `adminReconcileBusLoads`, `upsertMarker` | Mutates `public.student_profiles`, `public.buses`, `public.system_settings` (markers), `public.audit_events` |
| `src/lib/cleanup-helpers.ts` | `deleteUserAndData`, `deleteCloudinaryImage` | `/api/cron/cleanup-expired-students`, admin user delete routes | RPC `delete_student_cascade_v1`, `deleteAsset` (Cloudinary), `deleteUserTokens` (FCM), `adminAuth.deleteUser` (Firebase), `invalidateCachedRole` | Deletes row in `public.student_profiles`, purges external Cloudinary / Firebase resources |
| `src/lib/services/admin-reconcile-bus-loads.ts` | `adminReconcileBusLoads` | `/api/cron/cleanup-expired-students` (tail), admin bus workbench | `getAllBuses`, `getSeatOccupyingStudents`, `updateBus` | Overwrites `public.buses.morning_load`, `evening_load`, `current_members` |

---

### 9.3 Method-by-Method Low-Level Walkthrough

#### 1. Expiry Check & Atomic CAS Reminder Slot: `checkAndNotifyExpiringStudents` (`src/lib/expiry-check.ts`)
- **Control Flow:**
  1. Computes lifecycle trigger points via `deriveAcademicLifecycle(startMonth, startDay, currentYear)`:
     - `reminder1`: 90 days before expiry.
     - `reminder2`: 60 days before expiry.
     - `finalReminder`: 15 days before expiry.
  2. If today is not one of these 3 milestone dates (and not forced), exits with `skipped: true`.
  3. Queries `public.student_profiles` for active students expiring on the target date.
  4. For each student:
     - Checks reminder count: `runR1 && count < 1`, `runR2 && count < 2`, `runFinal && count < 3`.
     - **Atomic CAS Slot Claim:** Invokes PostgreSQL RPC `increment_expiry_reminder_count(p_uid)`:
       - Locks the student row (`FOR UPDATE`).
       - Validates `last_expiry_reminder_at < CURRENT_DATE`.
       - Increments `expiry_reminder_count = expiry_reminder_count + 1` and sets `last_expiry_reminder_at = NOW()`.
       - Returns `TRUE` only on the first execution. If false, skips sending to prevent duplicate messages.
     - Inserts in-app notification via `pgInsertNotification`.

---

#### 2. Automated Cleanup: Soft-Block, Hard Delete & Reconcile (`src/app/api/cron/cleanup-expired-students/route.ts`)
- **Key-Set Pagination & Time Budget:**
  - Budget: 240,000 ms (`MAX_STUDENTS_TIME_MS`) out of 300s total function duration.
  - Queries `getStudentsByStatusesPaged(['active', 'soft_blocked', 'pending_deletion'], { limit: 100, lastUid })`.
- **Hard Delete Flow:**
  - Evaluates `shouldHardDeleteFromStoredDates(studentCheckData)`.
  - **Fail-Closed Safety Rails:**
    - Checks `student.sessionEndYear`. Missing session year halts deletion.
    - Checks `validUntil`. Missing or future timestamp halts deletion.
    - Checks `lastActiveAt` / `updatedAt`. If student was active within the last 30 days, aborts deletion.
    - Re-reads student from database (`CRON-02`). If student renewed or reactivated, aborts deletion.
  - Invokes `deleteUserAndData(uid, 'student')`:
    - Calls PL/pgSQL RPC `delete_student_cascade_v1(p_student_uid)`.
    - Deletes Cloudinary profile image via `deleteAsset(publicId)`.
    - Deletes FCM device tokens via `deleteUserTokens(uid)`.
    - Deletes user from Firebase Auth via `adminAuth.deleteUser(uid)`.
    - Emits high-severity audit event `student_hard_deleted`.
- **Soft Block Flow:**
  - Evaluates `shouldBlockAccessFromStoredDates(studentCheckData)` where `status === 'active'`.
  - Re-reads fresh student record from PostgreSQL.
  - Calls atomic PL/pgSQL RPC `soft_block_student_with_seat_release`:
    - Locks student row (`FOR UPDATE`).
    - Sets `status = 'soft_blocked'`, `seat_released_at = NOW()`, `soft_blocked_at = NOW()`.
    - Locks bus row (`FOR UPDATE`) and decrements `morning_load` / `evening_load`.
  - Emits audit event `student_soft_blocked_seat_released`.
- **Post-Batch Bus Load Reconciliation (`adminReconcileBusLoads`):**
  - If any students were soft-blocked or deleted, executes `adminReconcileBusLoads({ dryRun: false })`.
  - Predicate `occupiesSeat`: Any student with `seat_released_at != null` is excluded from seat counts.
  - Recounts active commuters per vehicle and overwrites `morning_load`, `evening_load`, and `current_members` in `public.buses`.
- **Soft Block Completion Marker:**
  - Upserts marker `soft_block_completed_${currentSessionStartYear}` in `public.system_settings`.
  - Required prerequisite before the `session-activation` cron is permitted to execute.

---

#### 3. New Academic Year Activation: `activateUpcomingSessionApplications` (`src/lib/services/session-activation.service.ts`)
- **Gate Checks:**
  1. Compares `today >= normalizedActivationDate`. If before activation date, halts execution.
  2. Verifies presence of marker `soft_block_completed_${currentSessionStartYear}`. If missing, halts activation.
  3. Verifies marker `activation_${currentSessionStartYear}` does not exist yet.
- **Processing `verified_upcoming` Applications:**
  - Fetches all applications in `state = 'verified_upcoming'`.
  - Claims processing lease on application row via `applicationRepo.claimForActivation(appId, lockId)`.
  - Attempts activation on assigned bus via `attemptActivationWithBus`:
    - Calls atomic RPC `activateStudentWithCapacity`.
    - Locks bus row `FOR UPDATE`.
    - If `load < capacity`: increments bus load, creates/updates `student_profiles`, deletes application row from `public.applications`.
  - **Capacity Overflow Handling (`CapacityFullError`):**
    - Searches for deterministic compatible alternative buses serving the commuter's stop point (`findDeterministicAlternativeBuses`).
    - If alternative bus has room: activates student on alternative bus.
    - If NO bus has capacity: Transitions application to `state = 'pending_seat_allocation'`, emits `application_pending_seat_allocation` audit event, and dispatches notification to commuter and staff.

---

### 9.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Expiry Check Cron (`GET /api/cron/expiry-check`)** | **2 Queries / RPCs per expiring student:**<br>1. Select `student_profiles` expiring today<br>2. RPC `increment_expiry_reminder_count` (Lock + CAS update)<br>3. Insert `public.notifications` | **0** | **1 Push Notification Call** (Firebase Cloud Messaging) | **3 to 4 Ops per student** |
| **(b) Daily Cleanup: Soft-Block Single Expired Student** | **3 Queries / RPCs per student:**<br>1. Select `student_profiles` (Paged)<br>2. Select fresh `student_profiles` by UID<br>3. RPC `soft_block_student_with_seat_release` (Atomic bus load decrement + status update)<br>4. Insert `public.audit_events` | **1 Redis Invalidation:**<br>1. `student_assign_invalidate` | **0 External Calls** | **4 to 5 Ops per student** |
| **(c) Daily Cleanup: Hard-Delete Expired Student** | **3 Queries / RPCs per student:**<br>1. Select fresh `student_profiles` by UID<br>2. RPC `delete_student_cascade_v1` (Deletes profile + related records)<br>3. Insert `public.audit_events` | **1 Redis Invalidation:**<br>1. `role_invalidate` | **2 External Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Firebase Auth `deleteUser` | **6 Ops per student** |
| **(d) Session Activation Cron: Successful Activation on Assigned Bus** | **4 Queries / RPCs per application:**<br>1. Select marker `soft_block_completed` and `activation` from `system_settings`<br>2. Update `applications` (claim activation lease)<br>3. RPC `activateStudentWithCapacity` (Atomic bus capacity increment + student creation)<br>4. Delete `applications` row by ID<br>5. Insert `public.audit_events` | **1 Redis Invalidation:**<br>1. `student_assign_invalidate` | **1 External Email Call** (Activation notice) | **6 to 7 Ops per app** |
| **(e) Session Activation Cron: Capacity Full $
ightarrow$ `pending_seat_allocation`** | **4 Queries / RPCs per application:**<br>1. Claim activation lease<br>2. RPC `activateStudentWithCapacity` (Aborts: `CapacityFullError`)<br>3. Update `applications` (state: `pending_seat_allocation`)<br>4. Release activation lease<br>5. Insert `public.audit_events` | **0** | **1 Notification Call** (FCM / in-app alert) | **5 Ops per app** |

---

### 9.5 Verbatim Source Code from Live Codebase

#### 1. Daily Session Activation Route: `src/app/api/cron/session-activation/route.ts`
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

#### 2. Session Activation Service & Capacity Overflow Handling: `src/lib/services/session-activation.service.ts`
```typescript
/**
 * Session Activation Service
 *
 * Canonical implementation that activates `verified_upcoming` applications
 * once the new academic session begins. Both the daily cron and the admin
 * manual-trigger endpoint MUST call this — there is no second activation
 * implementation anywhere in the codebase.
 *
 * INVARIANTS
 *
 *   1. The "current session start year" is derived exclusively from the
 *      academic-calendar engine (deadline-config anchor). No module
 *      may compute it independently.
 *
 *   2. Only applications matching
 *        state = 'verified_upcoming'
 *        targetSession.startYear == currentSessionStartYear
 *      are touched. Anything else is left alone.
 *
 *   3. Activation reuses the same student-creation, seat-allocation,
 *      capacity-decrement, validity-assignment, and bus-pass logic that
 *      a same-session admin approval would run. No duplicated business
 *      logic. Capacity is enforced atomically inside a Firestore
 *      transaction — the last seat is never over-allocated.
 *
 *   4. When capacity is unavailable, the application transitions to
 *      'pending_seat_allocation' (the financial payment remains valid;
 *      the student is notified once; admins are notified once). The
 *      application stays in this state until manually resolved.
 *
 *   5. Idempotent. Same application is never activated twice. Concurrent
 *      runs (daily cron + admin trigger firing simultaneously) cannot
 *      double-activate — the activation transaction re-reads state and
 *      requires `verified_upcoming`.
 *
 *   6. Failure-isolated. One application's failure never stops the rest.
 */

import { findMarker,upsertMarker } from '@/domains/admin';
import { getAllByState } from '@/domains/application';
import * as applicationRepo from '@/domains/application/repositories/application.repository';
import { createAuditEvent,SYSTEM_ACTOR } from '@/domains/audit';
import * as fleetService from '@/domains/fleet/services/fleet.service';
import { activateStudentWithCapacity,createStudent,createUser,getUsersByRole } from '@/domains/identity';
import * as Notification from '@/domains/notification';
import * as routeService from '@/domains/route';
import { findAlternatives } from '@/domains/seat/repositories/seat.repository';
import { sendBusFullAlert } from '@/lib/busCapacityService';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { CapacityFullError } from '@/lib/errors/sentinel-errors';
import type { Bus } from '@/lib/types';
import { Application } from '@/lib/types/application';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { normalizeShift } from '@/lib/utils/shift-utils';

class StateChangedError extends Error {}

export interface SessionActivationSummary {
  startedAt: string;
  completedAt: string;
  currentSessionStartYear: number;
  activationReached: boolean;
  scanned: number;
  activated: number;
  pendingSeatAllocation: number;
  skipped: number;
  failed: number;
  errors: Array<{ applicationId: string; error: string }>;
  trigger: 'cron' | 'admin';
}

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

    // 3. Check Activation Marker (if marker already exists, exit immediately)
    const activationMarkerData = await findMarker(`activation_${currentSessionStartYear}`);
    if (activationMarkerData) {
      console.log(`ℹ️ [session-activation] Activation marker 'activation_${currentSessionStartYear}' already exists. Skipping automated cron activation.`);
      summary.activationReached = false;
      summary.completedAt = new Date().toISOString();
      return summary;
    }
  }

  summary.activationReached = true;

  // 4. Fetch all verified_upcoming applications
  const upcomingApps = await getAllByState('verified_upcoming');

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
  // If failures or pending seat allocations occurred, eligible applications definitely remain
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

  // Resolve the bus/route/stop/shift from the original application.
  const appAny = app as any;
  const requestedRouteId = appAny.routeId || appAny.route_id || formData.routeId || formData.route_id || '';
  const requestedBusId = appAny.busId || appAny.bus_id || formData.busId || formData.bus_id || (requestedRouteId ? String(requestedRouteId).replace('route_', 'bus_') : '');
  const final_stop_name = appAny.stop_name || formData.stop_name || formData.pickupPoint || '';
  const shift = normalizeShift(appAny.shift || formData.shift);

  if (!requestedBusId || !requestedRouteId || !final_stop_name || !shift) {
    return { failed: 'Application is missing route, bus, stop name, or shift assignment' };
  }

  // Derive session/validity from the FROZEN targetSession or session fields on the application.
  const targetSession = appAny.targetSession || {};
  const startYear = Number(targetSession.startYear || formData.sessionInfo?.sessionStartYear || appAny.sessionStartYear || appAny.session_start_year);
  const endYear = Number(targetSession.endYear || formData.sessionInfo?.sessionEndYear || appAny.sessionEndYear || appAny.session_end_year);

  if (isNaN(startYear) || isNaN(endYear) || startYear <= 0 || endYear <= startYear) {
    return { failed: 'Application is missing valid session start or end year data' };
  }

  const durationYears = endYear - startYear;

  const anchorMonth = config.academicYear.anchorMonth;
  const anchorDay = config.academicYear.anchorDay;
  // Validity ends at the next anchor (session-end anchor).
  const validUntilDate = new Date(Date.UTC(endYear, anchorMonth, anchorDay, 23, 59, 59, 999));
  const validUntil = validUntilDate.toISOString();
  const blockDates = computeBlockDatesFromValidUntil(validUntil, config);

  const nowIso = new Date().toISOString();

  // Atomically claim application lease to prevent concurrent activation races (e.g. cron vs admin)
  const lockId = `activation_${trigger}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const claimedApp = await applicationRepo.claimForActivation(appId, lockId).catch((err) => {
    console.warn(`[session-activation] Failed to claim lease for application ${appId}:`, err?.message || err);
    return null;
  });

  if (!claimedApp) {
    // Another process has already claimed or activated this application
    return 'skipped';
  }

  // Reusable activation helper for a target bus.

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
    });

    if (!activationResult.success) {
      if (activationResult.error && /full capacity/i.test(activationResult.error)) {
        throw new CapacityFullError(activationResult.error);
      }
      throw new Error(activationResult.error || `Failed to activate student on bus ${targetBusId}`);
    }

    // 3. Delete application from PG (activation = consume the application).
    await applicationRepo.remove(appId);

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

  // Case A: Try requested bus first
  try {
    const { postCommitFullAlert } = await attemptActivationWithBus(requestedBusId, requestedRouteId, false);

    if (postCommitFullAlert) {
      await sendBusFullAlert(requestedBusId, postCommitFullAlert.busNumber, postCommitFullAlert.routeId).catch(() => {});
    }
    await notifyStudentActivated(app, formData, validUntil, startYear, endYear).catch((e) =>
      console.error('[session-activation] activated notify failed:', e?.message || e)
    );
    return 'activated';
  } catch (err: any) {
    if (err instanceof StateChangedError) {
      await applicationRepo.releaseActivationClaim(appId, lockId).catch(() => {});
      return 'skipped';
    }

    if (err instanceof CapacityFullError) {
      // Case B: Search for compatible alternative buses serving the same stop with deterministically sorted priority
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

        // Update application state in PG
        await applicationRepo.update(appId, {
          state: 'pending_seat_allocation',
          updatedAt: nowIso
        });

        // Release processing lock so manual review or subsequent runs can inspect/re-evaluate
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

        // Only send notification when transitioning to pending_seat_allocation for the FIRST time!
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


async function notifyStudentActivated(
  app: Application,
```

#### 3. Expiry Warning Cron Route: `src/app/api/cron/expiry-check/route.ts`
```typescript
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { checkAndNotifyExpiringStudents, sendMidJuneReminder } from '@/lib/expiry-check';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron endpoint for expiry checks
 * 
 * This should be called by a cron service (e.g., Vercel Cron, Cloud Scheduler)
 * Schedule:
 * - June 1st: Main expiry check
 * - June 15th: Mid-month reminder
 * 
 * Security: Add authorization header check in production
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check query params for which check to run
    const searchParams = request.nextUrl.searchParams;
    const checkType = searchParams.get('type') || 'main';

    let result;

    if (checkType === 'mid-june') {
      console.log('🔄 Running mid-June reminder check...');
      result = await sendMidJuneReminder();
    } else {
      console.log('🔄 Running main expiry check...');
      result = await checkAndNotifyExpiringStudents();
    }

    return NextResponse.json({
      success: true,
      message: 'Expiry check completed',
      result
    });
  } catch (error: any) {
    console.error('❌ Cron job error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Expiry check failed'
      },
      { status: 500 }
    );
  }
}

/**
 * Manual trigger endpoint (for testing)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { adminAuth } = await import('@/lib/firebase-admin');
    const decodedToken = await adminAuth.verifyIdToken(token);

    const { resolveUserRole } = await import('@/lib/security/role-cache');
    const userRole = await resolveUserRole(decodedToken.uid);

    if (userRole.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('🔄 Manual expiry check triggered by admin:', decodedToken.uid);

    const result = await checkAndNotifyExpiringStudents();

    return NextResponse.json({
      success: true,
      message: 'Manual expiry check completed',
      result
    });
  } catch (error: any) {
    console.error('❌ Manual trigger error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Manual trigger failed'
      },
      { status: 500 }
    );
  }
}


```

#### 4. Expiry Milestone Engine & Atomic Reminder CAS: `src/lib/expiry-check.ts` (Lines 1–185)
```typescript
import { getUsersByRole } from '@/domains/identity';

import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { deriveAcademicLifecycle } from './utils/deadline-computation';

interface ExpiryCheckResult {
  totalChecked: number;
  remindersSent: number;
  errors: string[];
  skipped?: boolean;
}

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

    const isR1 = currentMonth === lifecycle.reminder1.getUTCMonth() && currentDay === lifecycle.reminder1.getUTCDate();
    const isR2 = currentMonth === lifecycle.reminder2.getUTCMonth() && currentDay === lifecycle.reminder2.getUTCDate();
    const isFinal = currentMonth === lifecycle.finalReminder.getUTCMonth() && currentDay === lifecycle.finalReminder.getUTCDate();

    let runR1 = force || isR1;
    let runR2 = force || isR2;
    let runFinal = force || isFinal;

    if (!force && !isR1 && !isR2 && !isFinal) {
      console.log(`⏭️ Expiry check skipped. Today: ${now.toDateString()}`);
      result.skipped = true;
      return result;
    }

    // Compute UTC-aligned boundaries for the target expiration day to avoid local timezone drift
    const expYear = lifecycle.expiry.getUTCFullYear();
    const expMonth = lifecycle.expiry.getUTCMonth();
    const expDate = lifecycle.expiry.getUTCDate();
    const deadlineFirst = new Date(Date.UTC(expYear, expMonth, expDate, 0, 0, 0, 0));
    const deadlineNext = new Date(Date.UTC(expYear, expMonth, expDate + 1, 0, 0, 0, 0));

    console.log(`🔍 Checking for students expiring on: ${deadlineFirst.toDateString()}`);

    // Query active students expiring in target date range from PostgreSQL
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
    console.log(`📊 Found ${result.totalChecked} students expiring on ${deadlineFirst.toDateString()}`);

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

        const nowIso = new Date().toISOString();

        // Atomically claim the "send reminder today" slot via a Postgres function
        // that uses FOR UPDATE + UPDATE in one transaction. Returns TRUE only on
        // the first call for this student on the current UTC calendar day.
        // This prevents two concurrent cron executions from both sending a reminder.
        const { data: claimed, error: claimErr } = await supabase
          .rpc('increment_expiry_reminder_count', { p_uid: studentUid });

        if (claimErr) {
          result.errors.push(`Failed to claim reminder slot for ${studentUid}: ${claimErr.message}`);
          continue;
        }

        // Another concurrent execution already sent the reminder today.
        if (!claimed) {
          continue;
        }

        // 1. Write notification to PostgreSQL (after atomic claim succeeds)

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

        // The atomic RPC (increment_expiry_reminder_count) already stamped
        // last_expiry_reminder_sent_at and incremented expiry_reminder_count
        // when it returned TRUE, so no second write is needed here.

        result.remindersSent++;
        console.log(`[expiry-check] Sent reminder to ${studentUid.substring(0, 8)}...`);

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

/**
 * Send a second reminder mid-month (e.g., 15th)
 */
export async function sendMidJuneReminder(force: boolean = false): Promise<ExpiryCheckResult> {
  // Delegate to main check, which now dynamically checks April 1st, May 1st, and June 15th
  return checkAndNotifyExpiringStudents(force);
}

async function sendAdminSummary(result: ExpiryCheckResult, title: string, expiryDate: Date) {
  const admins = await getUsersByRole('admin');
  const adminIds = admins.map(a => a.uid).filter(Boolean);
```

#### 5. Automated Soft-Block & Hard-Delete Cron: `src/app/api/cron/cleanup-expired-students/route.ts`
```typescript
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { upsertMarker } from '@/domains/admin';
import { createAuditEvent, SYSTEM_ACTOR, type AuditEventInsert } from '@/domains/audit';
import { getStudentById, getStudentsByStatusesPaged, updateStudent } from '@/domains/identity';
import * as Notification from '@/domains/notification';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { isSeatReleaseAtSoftBlockEnabled, wasSeatReleased } from '@/lib/config/capacity-flags';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { adminReconcileBusLoads } from '@/lib/services/admin-reconcile-bus-loads';
import { getCurrentSessionStartYear } from '@/lib/services/session-activation.service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { shouldBlockAccessFromStoredDates, shouldHardDeleteFromStoredDates } from '@/lib/utils/renewal-utils';
import { v2 as cloudinary } from 'cloudinary';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

// Configure Cloudinary
if (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
        cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
}

/**
 * AUTOMATED CRON JOB for Soft Block & Hard Delete
 * 
 * Scheduled to run daily (or as configured).
 * Uses PRE-STORED softBlock and hardBlock dates from student documents.
 * Migrates legacy students without these fields by computing from validUntil.
 * 
 * - Soft Blocks students who have passed the soft block date.
 * - Hard Deletes students who have passed the hard delete date.
 * - Keyset paginated with a 240s time budget to safely handle populations up to 10,000+ (CRON-04).
 */
export async function GET(request: NextRequest) {
    try {
        if (!verifyCronAuth(request)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const cronStartTime = Date.now();
        // Time budget: 240 seconds (leaving 60s of maxDuration=300 for upcoming apps pass, reconciliation, audit log)
        const MAX_STUDENTS_TIME_MS = 240_000;
        const PAGE_SIZE = 100;

        // Load deadline config dynamically from Firestore
        const config = await getDeadlineConfig() as any;

        console.log(`🔄 Running Automated Cleanup Cron Job`);
        // Handle config.softBlock potentially being undefined or different structure if casting failed
        const softBlockStr = config.softBlock ? `${config.softBlock.month + 1}/${config.softBlock.day}` : 'Unknown';
        const hardDeleteStr = config.hardDelete ? `${config.hardDelete.month + 1}/${config.hardDelete.day}` : 'Unknown';

        console.log(`   Config: SoftBlock=${softBlockStr}, HardDelete=${hardDeleteStr}`);
        console.log(`   Using PRE-STORED softBlock/hardBlock dates from student documents`);

        // 2. Query target students from PostgreSQL (canonical source) via Domain using Keyset Pagination (CRON-04)
        const results = {
            totalChecked: 0,
            softBlocked: 0,
            hardDeleted: 0,
            blockDatesAdded: 0,
            pagesProcessed: 0,
            truncated: false,
            lastProcessedUid: null as string | null,
            errors: [] as string[]
        };

        let lastUid: string | undefined = undefined;
        let hasMore = true;

        while (hasMore) {
            // Guard against approaching function timeout
            if (Date.now() - cronStartTime > MAX_STUDENTS_TIME_MS) {
                console.warn(`⏳ Time budget reached (${Date.now() - cronStartTime}ms). Halting student pagination loop.`);
                results.truncated = true;
                break;
            }

            const page = await getStudentsByStatusesPaged(
                ['active', 'soft_blocked', 'pending_deletion'],
                { limit: PAGE_SIZE, lastUid }
            );

            if (!page.students || page.students.length === 0) {
                break;
            }

            results.pagesProcessed++;

            for (const studentData of page.students) {
                results.totalChecked++;
                const uid = studentData.uid;
                results.lastProcessedUid = uid;

                if (Date.now() - cronStartTime > MAX_STUDENTS_TIME_MS) {
                    console.warn(`⏳ Time budget reached during student processing. Halting student loop.`);
                    results.truncated = true;
                    break;
                }

            try {
                // Parse validUntil
                let validUntilStr: string | null = null;
                if (studentData.validUntil) {
                    if (typeof studentData.validUntil === 'string') {
                        validUntilStr = studentData.validUntil;
                    } else if (studentData.validUntil.toDate) {
                        validUntilStr = studentData.validUntil.toDate().toISOString();
                    }
                }

                // Parse lastRenewalDate
                let lastRenewalDateStr: string | null = null;
                if (studentData.lastRenewalDate) {
                    if (typeof studentData.lastRenewalDate === 'string') {
                        lastRenewalDateStr = studentData.lastRenewalDate;
                    } else if (studentData.lastRenewalDate.toDate) {
                        lastRenewalDateStr = studentData.lastRenewalDate.toDate().toISOString();
                    }
                }

                // MIGRATION: If student has no softBlock/hardBlock fields, compute from validUntil
                let softBlockStr = studentData.softBlock;
                let hardBlockStr = studentData.hardBlock;

                if ((!softBlockStr || !hardBlockStr) && validUntilStr) {
                    // Compute from validUntil date (the single source of truth) with dynamic configuration
                    const blockDates = computeBlockDatesFromValidUntil(validUntilStr, config);

                    // Update student document with computed block dates in PostgreSQL
                    await updateStudent(uid, {
                        softBlock: blockDates.softBlock,
                        hardBlock: blockDates.hardBlock,
                        blockDatesComputedAt: new Date().toISOString()
                    });

                    softBlockStr = blockDates.softBlock;
                    hardBlockStr = blockDates.hardBlock;
                    results.blockDatesAdded++;
                    console.log(`📅 Added block dates for ${uid.substring(0,8)}...: softBlock=${softBlockStr.split('T')[0]}, hardBlock=${hardBlockStr.split('T')[0]}`);
                }

                // Prepare student data object for optimized checks
                const studentCheckData = {
                    softBlock: softBlockStr,
                    hardBlock: hardBlockStr,
                    validUntil: validUntilStr,
                    lastRenewalDate: lastRenewalDateStr,
                    status: studentData.status,
                    sessionEndYear: studentData.sessionEndYear
                };

                // SAFETY CHECK: Skip students without sessionEndYear (likely new/incomplete)
                if (!studentData.sessionEndYear) {
                    console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} has no sessionEndYear. Likely new student - skipping deletion.`);
                    continue;
                }
                
                // Check using optimized stored-date functions with dynamic config override
                const needsSoftBlock = shouldBlockAccessFromStoredDates(studentCheckData, null, config);
                const needsHardDelete = shouldHardDeleteFromStoredDates(studentCheckData, null, config);
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

                    // SAFETY CHECK: Log before deletion
                    console.log(`🗑️ HARD DELETE triggered for ${uid.substring(0,8)}...`);
                    console.log(`   hardBlock date: ${hardBlockStr}`);
                    console.log(`   validUntil: ${freshValidUntil}`);
                    console.log(`   status: ${freshStudent.status}`);
                    
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
                    const lastActiveAt = studentData.lastActiveAt || studentData.lastLoginAt || studentData.updatedAt;
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

                    // Emit audit event only after successful completion of the entire deletion workflow
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
                    results.hardDeleted++;
                    continue; // Skip soft block check since user is gone
                }

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
                            results.softBlocked++;
                            console.log(`   ✅ Soft-blocked ${uid}${releaseSeat ? ' (seat released)' : ''}`);
                        }
                    } catch (sbErr) {
                        console.warn(`   ⚠️ Soft-block failed for ${uid} — will retry next run:`, sbErr);
                        results.errors.push(`Soft-block failed for ${uid}`);
                    }
                }

                } catch (err: any) {
                    console.error(`❌ Error processing student ${uid}:`, err);
                    results.errors.push(`Error processing student ${uid}`);
                }
            }

            if (results.truncated) {
                break;
            }

            lastUid = page.nextLastUid;
            hasMore = page.hasMore && Boolean(lastUid);
        }

        // ── UPCOMING (future-session) APPLICATIONS PASS ──────────────────────
        //   Independent of the June renewal calendar. For applications with
        //   applicationType === 'future' still sitting in state 'submitted':
        //     (1) when eligibleApproval has arrived, send a ONE-TIME "eligible now"
        //         reminder to the applicant (idempotent via eligibleReminderSentAt).
        //     (2) expire (state: 'expired') applications left unapproved for longer
        //         than the grace window past their eligibility date, so stale
        //         upcoming applications do not linger forever.
        //   These applications are NOT students and never touch bus capacity, so
        //   this pass only reads/writes the `applications` table in PG.
        const upcomingResults = { reminded: 0, expired: 0, errors: [] as string[] };
        // Grace window after eligibility before an unapproved upcoming application
        // is auto-expired. No dedicated config field exists; this constant is the
        } catch (upcomingErr: any) {
            console.error('⚠️ Upcoming applications pass failed:', upcomingErr);
            upcomingResults.errors.push(upcomingErr?.message || 'upcoming pass failed');
        }

        // POST-BATCH RECONCILIATION (self-healing tail).
        //   Recounts active seat-owners and repairs any bus left over-counted by a
        //   failed soft-block decrement (or under-counted by any other drift).
        //   Gated on the flag: the active-only recount is authoritative ONLY under
        //   the new seat-release semantics. In legacy (flag-off) mode, soft-blocked
        //   students still own seats, so an active-only recount would wrongly drop
        //   them — therefore we skip the auto-correction entirely when the flag is off.
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

        // Tier B — operational visibility. Surface the run summary (and any healed
        //   drift) into the audit stream so admins can SEE what the cron did without
        //   reading server logs. Best-effort with audit_failure capture on write loss.
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
        // Guard (Finding F-07): Do NOT write the completion marker if cleanup encountered unhandled errors.
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

        console.log(`✅ Cron Job Completed:`, results);
        return NextResponse.json({ success: true, results, upcomingApplications: upcomingResults, reconciliation });

    } catch (error: any) {
        console.error('❌ Cron Job Fatal Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

```

#### 6. Consolidated Cascade Deletion Engine: `src/lib/cleanup-helpers.ts` (Lines 50–155)
```typescript
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

    // Invalidate role cache immediately
    invalidateCachedRole(userId);
    if (firebaseAuthUid && firebaseAuthUid !== userId) {
      invalidateCachedRole(firebaseAuthUid);
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

    // 4. FCM & Request Cleanup (External)
    if (userType === 'student') {
      // Delete FCM tokens from Firestore subcollection
```

#### 7. Authoritative Bus Load Reconciler: `src/lib/services/admin-reconcile-bus-loads.ts` (Lines 1–115)
```typescript
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL BUS-LOAD RECONCILIATION (PostgreSQL-backed, server-safe)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The single authoritative reconciliation for bus capacity counters. Recounts the
 * actual seat-owning students per bus and rewrites ALL FOUR counters consistently in PG:
 *   currentMembers, morningLoad, eveningLoad.
 *
 * SEAT-OWNERSHIP DEFINITION (marker-aware, mode-independent):
 *   A student occupies a seat iff their seat has NOT been released:
 *     - status 'active'                                   → always occupies
 *     - status 'soft_blocked'/'pending_deletion' WITHOUT
 *       a `seatReleasedAt` marker (legacy / flag-off)     → still occupies
 *     - anything with a `seatReleasedAt` marker           → released, does NOT occupy
 *   This matches the live counters in BOTH flag modes because the marker is the
 *   single source of "seat was released" (see capacity-flags.ts).
 */

import { getAllBuses,updateBus } from '@/domains/fleet';
import { getSeatOccupyingStudents,getUsersByRole } from '@/domains/identity';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getShiftDeltas } from '@/lib/utils/shift-utils';

export interface BusCounterSnapshot {
  currentMembers: number;
  morningCount: number;
  eveningCount: number;
}

export interface BusReconcileReport {
  busId: string;
  busNumber: string;
  before: BusCounterSnapshot;
  after: BusCounterSnapshot;
  /** |before.currentMembers − after.currentMembers| */
  delta: number;
  hadDiscrepancy: boolean;
  corrected: boolean;
  /** Occupying students whose shift matches neither bucket (data-quality signal). */
  invalidShiftStudents: number;
  error?: string;
}

export interface ReconcileOptions {
  /** Limit to specific bus doc ids. Omit/empty ⇒ all buses. */
  busIds?: string[];
  /** Report only, write nothing. */
  dryRun?: boolean;
  /** Emit an admin notification when any bus delta ≥ largeDeltaThreshold. */
  alertOnLargeDelta?: boolean;
  /** Threshold for a "large" (systemic) delta. Default 5. */
  largeDeltaThreshold?: number;
}

export interface ReconcileSummary {
  totalBuses: number;
  busesWithDiscrepancies: number;
  busesCorrected: number;
  totalSeatsCounted: number;
  invalidShiftStudents: number;
  largeDeltaBuses: string[];
  reports: BusReconcileReport[];
  dryRun: boolean;
  executionTimeMs: number;
}

/** Marker-aware seat-ownership predicate. Mirrors the live counter semantics. */
function occupiesSeat(s: Record<string, any>): boolean {
  if (s.seatReleasedAt) return false; // seat released — never occupies
  const status = s.status;
  if (status === 'active') return true;
  if (status === 'soft_blocked' || status === 'pending_deletion') return true; // legacy, not yet released
  return false;
}

/**
 * Shift contribution — uses canonical getShiftDeltas from shift-utils.
 * Normalizes EXACTLY like `buildCapacityDelta`: uses canonical normalization.
 */
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
    const busId = s.busId || s.currentBusId || s.busId;
    if (!busId || !targetBusIds.has(busId)) continue; // orphan / other bus — not in scope of this run
    const c = counts.get(busId)!;
    c.currentMembers += 1; // every occupying student counts toward the canonical total
    const contrib = shiftContribution(s.shift);
    if (contrib.morning) c.morningCount += 1;
    if (contrib.evening) c.eveningCount += 1;
```

---

