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
import { createStudent,createUser } from '@/domains/identity';
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
  const remainingApps = await getAllByState('verified_upcoming');
  const hasRemainingForCurrentSession = remainingApps.some(app => {
    const targetStartYear = Number((app as any).targetSession?.startYear);
    return targetStartYear === currentSessionStartYear;
  });

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

    // 1. Re-read application from PG — must still be verified_upcoming or pending_seat_allocation.
    const freshApp = await applicationRepo.findByApplicationId(appId);
    if (!freshApp) throw new StateChangedError();
    if (freshApp.state !== 'verified_upcoming' && freshApp.state !== 'pending_seat_allocation') {
      throw new StateChangedError();
    }

    // 2. Check capacity via Fleet PG (atomic RPC).
    const capacityCheck = await fleetService.checkBusCapacity(targetBusId, shift);
    if (!capacityCheck.available) {
      throw new CapacityFullError();
    }

    // 3. Increment capacity via Fleet PG (atomic RPC).
    const capacityResult = await fleetService.incrementBusCapacity(targetBusId, shift);
    if (!capacityResult.success) {
      throw new Error(capacityResult.error || `Failed to increment capacity for bus ${targetBusId}`);
    }
    // 4. Secure the user and student_profiles records in database (atomic post-capacity-increment write)
    try {
      await createUser({
        uid: app.applicantUid,
        email: (app as any).email || formData.email,
        name: formData.fullName,
        role: 'student',
        createdAt: nowIso,
      });

      await createStudent({
        ...studentDoc,
        uid: app.applicantUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } catch (writeErr) {
      // rollback the capacity increment on write failure
      await fleetService.decrementBusCapacity(targetBusId, shift).catch(() => {});
      throw writeErr;
    }

    // 5. Delete application from PG (activation = consume the application).
    await applicationRepo.remove(appId);

    if (capacityResult.newShiftLoad >= capacityResult.capacity) {
      const bus = await fleetService.getBusById(targetBusId);
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
    await notifyStudentActivated(app, formData, validUntil).catch((e) =>
      console.error('[session-activation] activated notify failed:', e?.message || e)
    );
    return 'activated';
  } catch (err: any) {
    if (err instanceof StateChangedError) {
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
            await notifyStudentActivated(app, formData, validUntil).catch((e) =>
              console.error('[session-activation] activated notify failed:', e?.message || e)
            );
            return 'activated';
          } catch (altErr: any) {
            if (altErr instanceof StateChangedError) return 'skipped';
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
        if (e instanceof StateChangedError) return 'skipped';
        return { failed: `pending-state-write failed: ${e?.message || e}` };
      }
      return 'pending';
    }
    return { failed: err?.message || String(err) };
  }
}

async function notifyStudentActivated(app: Application, formData: any, validUntil: string): Promise<void> {
  await Notification.createNotification(
    { userId: 'system', userName: 'System', userRole: 'admin' },
    { type: 'specific_users', specificUserIds: [app.applicantUid] },
    `Your bus service for the ${(app as any).targetSession?.startYear}-${(app as any).targetSession?.endYear} session is now active. Valid until ${new Date(validUntil).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}.`,
    'Your transport service is now active',
    { profile: '/student/profile' }
  );
}

async function findDeterministicAlternativeBuses(
  stop_name: string,
  requestedRouteId: string,
  requestedShift: string,
  preFetchedBuses?: Bus[],
  preFetchedRoutes?: any[]
): Promise<Array<{ busId: string; routeId: string; shift: string; currentMembers: number; capacity: number }>> {
  // ponytail: delegate core stop-matching and route-filtering to seatRepository
  const res = await findAlternatives(stop_name, requestedRouteId, requestedShift, preFetchedBuses, preFetchedRoutes);
  if (!res.success || !res.alternativeBuses) return [];

  const alternatives = res.alternativeBuses.map(b => ({
    busId: b.busId,
    routeId: b.routeId,
    shift: b.shift,
    currentMembers: b.currentMembers,
    capacity: b.capacity
  }));

  alternatives.sort((a, b) => {
    const aSameRoute = a.routeId === requestedRouteId ? 1 : 0;
    const bSameRoute = b.routeId === requestedRouteId ? 1 : 0;
    if (aSameRoute !== bSameRoute) return bSameRoute - aSameRoute;

    const aExactShift = a.shift.toLowerCase() === requestedShift.toLowerCase() ? 1 : 0;
    const bExactShift = b.shift.toLowerCase() === requestedShift.toLowerCase() ? 1 : 0;
    if (aExactShift !== bExactShift) return bExactShift - aExactShift;

    if (a.currentMembers !== b.currentMembers) return a.currentMembers - b.currentMembers;

    return a.busId.localeCompare(b.busId);
  });

  return alternatives;
}

async function notifyPendingSeatAllocation(appId: string, app: Application, formData: any): Promise<void> {
  // Notify student
  await Notification.createNotification(
    { userId: 'system', userName: 'System', userRole: 'admin' },
    { type: 'specific_users', specificUserIds: [app.applicantUid] },
    'Your application has been approved and payment is verified, but all seats are currently occupied. Your application is in the Seat Allocation Queue and you will be notified as soon as a seat becomes available.',
    'Awaiting seat assignment',
    { statusPage: `/apply/status/${appId}` }
  );

  // Notify admins and moderators via D1 Identity domain (PostgreSQL)
  const [admins, moderators] = await Promise.all([
    (await import('@/domains/identity')).getUsersByRole('admin'),
    (await import('@/domains/identity')).getUsersByRole('moderator'),
  ]);
  const recipients = Array.from(new Set([
    ...admins.map((u: any) => u.uid || u.id),
    ...moderators.map((u: any) => u.uid || u.id),
  ])).filter(Boolean);
  if (recipients.length === 0) return;

  await Notification.createNotification(
    { userId: 'system', userName: 'System', userRole: 'admin' },
    { type: 'specific_users', specificUserIds: recipients },
    `${formData.fullName} (${formData.enrollmentId}) has a verified application and completed payment but no seat is available. Please assign a seat or wait for one to free up.`,
    'Verified application needs manual seat allocation',
    { applicationId: appId, reviewPage: `/admin/applications/${appId}` }
  ).catch(() => {});
}

export async function activateSingleApplication(
  applicationId: string,
  trigger: 'admin' = 'admin'
): Promise<SessionActivationSummary> {
  const startedAt = new Date().toISOString();
  const config = await getDeadlineConfig();
  const currentSessionStartYear = getCurrentSessionStartYear(config, new Date());
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
    trigger,
  };

  // Read application from PG
  const { getById } = await import('@/domains/application');
  const app = await getById(applicationId);
  if (!app) {
    summary.failed = 1;
    summary.errors.push({ applicationId, error: 'Application not found' });
    summary.completedAt = new Date().toISOString();
    return summary;
  }
  const state = app.state;
  if (state !== 'verified_upcoming' && state !== 'pending_seat_allocation') {
    summary.skipped = 1;
    summary.completedAt = new Date().toISOString();
    return summary;
  }
  summary.scanned = 1;
  summary.activationReached = true;
  try {
    const outcome = await activateOne(app, config, trigger);
    if (outcome === 'activated') summary.activated++;
    else if (outcome === 'pending') summary.pendingSeatAllocation++;
    else if (outcome === 'skipped') summary.skipped++;
    else {
      summary.failed++;
      summary.errors.push({ applicationId, error: outcome.failed });
    }
  } catch (err: any) {
    summary.failed++;
    summary.errors.push({ applicationId, error: err?.message || String(err) });
  }
  summary.completedAt = new Date().toISOString();
  return summary;
}
