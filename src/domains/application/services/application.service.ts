/**
 * D4/D8 ApplicationService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: application workflow orchestration, CRUD, approval,
 * rejection, submission, review.
 *
 * This service is an ORCHESTRATOR. It coordinates cross-domain operations
 * via public domain APIs (Identity, Payment, Audit, Notification) but never
 * writes to their tables directly.
 *
 * Cross-domain writes happen via PostgreSQL RPCs (called from TypeScript):
 *   - approve_application()     → Application table only
 *   - identity_activate_student() → Identity tables only (fresh applications)
 *   - finalize_application_approval() → Application table only
 *
 * All side effects are idempotent. Retrying a completed operation
 * never produces duplicate state.
 *
 * D8 RENEWAL PATH — renewal applications follow a different approval flow:
 *   - Fresh: identity_activate_student → finalize (delete)
 *   - Renewal: Student.update() → Seat.assignSeat() if seat released → finalize (preserve as approved)
 *   - Renewal applications are PRESERVED in approved state (audit trail).
 */
import { createAuditEvent } from '@/domains/audit';
import { deleteUnauthUser } from '@/domains/identity';
import * as Notification from '@/domains/notification';
import * as Seat from '@/domains/seat';
import * as Student from '@/domains/student';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import type { Application,ApplicationState,ApplicationType } from '@/lib/types/application';
import { isUpcomingApplication } from '@/lib/utils/application-eligibility';
import { calculateValidUntilDate } from '@/lib/utils/date-utils';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { normalizeShift } from '@/lib/utils/shift-utils';
import * as repository from '../repositories/application.repository';

// ─── CRUD Methods ────────────────────────────────────────────────────────────

export async function getAll(): Promise<Application[]> {
  return repository.findAll();
}

export async function getAllPaginated(limit: number, offset: number): Promise<Application[]> {
  return repository.findAllPaginated(limit, offset);
}

export async function getById(id: string): Promise<Application | null> {
  return repository.findByApplicationId(id);
}

export async function getByApplicantUid(uid: string): Promise<Application | null> {
  return repository.findByApplicantUid(uid);
}

export async function getAllByState(state: ApplicationState): Promise<Application[]> {
  return repository.findAllByState(state);
}

export async function getAllByStateAndType(
  state: ApplicationState,
  applicationType: ApplicationType
): Promise<Application[]> {
  return repository.findAllByStateAndType(state, applicationType);
}

export async function count(): Promise<number> {
  return repository.count();
}

// ─── Workflow Methods ────────────────────────────────────────────────────────

/**
 * Save or update a draft application.
 * Creates new draft if applicationId not provided.
 * Updates existing draft if in editable state.
 */
export async function saveDraft(
  uid: string,
  applicationId: string | undefined,
  formData: Record<string, any>
): Promise<{ success: boolean; applicationId?: string; error?: string }> {
  const now = new Date().toISOString();

  if (applicationId) {
    // Update existing draft
    const existing = await repository.findByApplicationId(applicationId);
    if (!existing) {
      return { success: false, error: 'Application not found' };
    }
    if (existing.applicantUid !== uid) {
      return { success: false, error: 'Unauthorized' };
    }

    const immutableStates: ApplicationState[] = [
      'verified', 'submitted', 'verified_upcoming',
      'pending_seat_allocation', 'approved', 'rejected',
    ];
    if (immutableStates.includes(existing.state)) {
      return { success: false, error: 'Cannot edit application in current state' };
    }

    await repository.update(applicationId, {
      formData: formData as any,
      state: 'draft',
      updatedAt: now,
    });

    return { success: true, applicationId };
  }

  // Create new draft
  const newId = `app_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  await repository.insert({
    applicationId: newId,
    applicantUid: uid,
    formData: formData as any,
    state: 'draft',
    stateHistory: [{ state: 'draft', timestamp: now, actor: uid }],
    verificationAttempts: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: uid,
  } as Partial<Application>);

  return { success: true, applicationId: newId };
}

/**
 * Submit a verified application via RPC (atomic verified → submitted).
 */
export async function submit(
  applicationId: string,
  uid: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const db = getSupabaseServer();

  const { data: result, error } = await db.rpc('transition_application_state', {
    p_application_id: applicationId,
    p_new_state: 'submitted',
    p_actor_uid: uid,
  });

  if (error) {
    return { success: false, error: error.message, status: 500 };
  }

  return { success: result?.success, error: result?.error, status: result?.status };
}

/**
 * Submit a new application directly (bypass verification).
 * Creates application in submitted state.
 */
export async function submitFinal(
  uid: string,
  email: string,
  formData: Record<string, any>,
  body: Record<string, any>
): Promise<{ success: boolean; applicationId?: string; error?: string }> {
  const now = new Date().toISOString();
  const isRenewal = body.applicationType === 'renewal' || body.applicationType === 'renewal_after_soft_block';

  // Check for existing live application — skip for renewals (they may coexist)
  if (!isRenewal) {
    const existing = await repository.findByApplicantUid(uid);
    const LIVE_STATES: ApplicationState[] = [
      'submitted', 'approved', 'verified', 'awaiting_verification',
      'verified_upcoming', 'pending_seat_allocation',
    ];
    if (existing && LIVE_STATES.includes(existing.state)) {
      return { success: false, error: 'An application is already in progress' };
    }
  }

  const currentYear = new Date().getFullYear();
  const startYear = Number(
    formData.sessionStartYear || formData.startYear || formData.session_start_year || formData.start_year ||
    body.sessionStartYear || body.startYear || 0
  );

  let appType: ApplicationType = (body.applicationType || body.application_type) as ApplicationType;
  if (!appType) {
    if (startYear > currentYear) {
      appType = 'future';
    } else {
      appType = 'fresh';
    }
  }

  const busId = formData.busId || formData.bus_id || formData.selectedBus || body.busId || body.bus_id;
  const routeId = formData.routeId || formData.route_id || formData.selectedRoute || body.routeId || body.route_id;
  const stop_name = formData.stop_name || formData.selected_stop_name || formData.selectedStop || body.stop_name;
  const rawShift = formData.shift || formData.selectedShift || body.shift;
  const shift = normalizeShift(rawShift);

  if (!shift) {
    throw new Error('Shift selection (Morning or Evening) is required for application submission.');
  }

  const applicationData: any = {
    applicationId: body.applicationId || uid,
    applicantUid: uid,
    email,
    state: 'submitted',
    formData: { ...formData } as any,
    busId,
    routeId,
    stop_name,
    shift,
    sessionStartYear: startYear,
    sessionEndYear: startYear ? startYear + 1 : undefined,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    verifiedBy: formData.paymentInfo?.paymentMode === 'online'
      ? 'system_online_payment'
      : 'system_offline_submission_bypass',
    verifiedAt: now,
    needsCapacityReview: body.needsCapacityReview || false,
    applicationType: appType,
    targetSession: body.targetSession || (startYear ? { startYear, endYear: startYear + 1 } : undefined),
    eligibleApproval: body.eligibleApproval,
  } as Partial<Application>;

  await repository.upsert(applicationData);

  return { success: true, applicationId: applicationData.applicationId };
}

/**
 * Verify an upcoming (future-session) application.
 *
 * Future-session applications follow the gating lifecycle (PHASE 2 & Session Activation Engine):
 * 1. Application is submitted for a future academic session.
 * 2. Admin/Moderator reviews documents/payment evidence and clicks "Verify".
 * 3. Application state transitions to 'verified_upcoming'.
 * 4. NO student profile is created in /students.
 * 5. NO bus capacity is incremented / seat allocated.
 * 6. NO active transport access is granted.
 * 7. When the academic session starts (or session activation engine runs),
 *    the application is activated and assigned a seat.
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
 * 6. Notification (idempotent)
 * 7. Finalize RPC (delete for fresh, preserve for renewal)
 */
export async function approve(
  applicationId: string,
  approverData: { uid: string; name: string; role: string },
  notes?: string,
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<{ success: boolean; studentUid?: string; error?: string; status?: number }> {
  const db = getSupabaseServer();

  // ── Step 1: Application RPC — validate + lock + return payload ────
  const { data: rpcResult, error: rpcError } = await db.rpc('approve_application', {
    p_application_id: applicationId,
    p_approver_uid: approverData.uid,
  });

  if (rpcError || !rpcResult?.success) {
    return {
      success: false,
      error: rpcResult?.error || rpcError?.message,
      status: rpcResult?.status || 500,
    };
  }

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

      if (app.application_type === 'renewal_after_soft_block' && seatWasReleased && renewalBusId) {
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
        studentDataForRpc = null; // Mark as already finalized
        renewalAlreadyFinalized = true; // Track that finalize_application_approval should be skipped
      } else {
        // Standard renewal (no seat reclamation): just finalize application
        studentDataForRpc = {
          valid_until: finalValidUntil.toISOString(),
          status: 'active',
          session_end_year: finalSessionEndYear,
          session_duration: String(totalDuration),
          soft_block: (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as Date)?.toISOString()) || null,
          hard_block: (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as Date)?.toISOString()) || null,
        };
      }

      studentData = {
        validUntil: finalValidUntil.toISOString(),
        sessionStartYear: (student as any).sessionStartYear || baseYear,
        sessionEndYear: finalSessionEndYear,
        durationYears: totalDuration,
      };
    } else {
      // ── FRESH APPLICATION PATH ────────────────────────────────────
      studentData = await buildStudentData(app, approverData, overrides);

      const targetBusId = overrides?.busId || studentData.busId || app.bus_id;
      const studentShift = normalizeShift(studentData.shift || app.shift);
      if (!studentShift) {
        throw new Error('Application is missing a valid shift assignment.');
      }

      if (targetBusId) {
        const { data: capResult, error: capError } = await db.rpc('bus_increment_capacity', {
          p_bus_id: targetBusId,
          p_shift: studentShift,
        });

        if (capError) {
          console.error('Failed to increment bus capacity for fresh application:', capError);
          throw new Error(`Bus capacity check failed: ${capError.message || capError.code}`);
        }

        if (capResult && capResult.error) {
          console.error('Bus capacity check returned error:', capResult.error);
          throw new Error(capResult.error);
        }
      }

      const { data: identityResult, error: identityError } = await db.rpc('identity_activate_student', {
        p_uid: app.applicant_uid,
        p_email: app.email || app.applicant_email,
        p_full_name: app.form_data?.fullName || null,
        p_student_data: studentData,
      });

      if (identityError) {
        if (targetBusId) {
          try {
            await db.rpc('bus_decrement_capacity', {
              p_bus_id: targetBusId,
              p_shift: studentShift,
            });
          } catch (err) {
            console.error('Failed to compensate bus capacity increment:', err);
          }
        }
        console.error('identity_activate_student RPC error:', identityError);
        throw new Error(`Identity activation failed: ${identityError.message || identityError.code}`);
      }

      if (!identityResult?.success) {
        if (targetBusId) {
          try {
            await db.rpc('bus_decrement_capacity', {
              p_bus_id: targetBusId,
              p_shift: studentShift,
            });
          } catch (err) {
            console.error('Failed to compensate bus capacity increment:', err);
          }
        }
        throw new Error('Identity activation failed');
      }

      // Identity now owns this user — the transient unauth_users row is
      // superseded. Best-effort delete (45-day TTL cron is the fallback).
      await deleteUnauthUser(app.applicant_uid).catch(() => {});
    }

    // ── Step 2: Finalize application — atomic commit ────────────────
    // C3: For renewals, student update + idempotency marker + application
    // finalization happen in a single RPC (single DB transaction).
    // For fresh: deletes application. Identity already activated above.
    // Skip if renewal was already finalized by approve_renewal_with_seat RPC
    if (!renewalAlreadyFinalized) {
      const { data: finalizeResult, error: finalizeError } = await db.rpc('finalize_application_approval', {
        p_application_id: applicationId,
        p_approver_uid: approverData.uid,
        ...(studentDataForRpc ? { p_student_data: studentDataForRpc } : {}),
      });

      if (finalizeError) {
        console.error('finalize_application_approval RPC error:', finalizeError);
        throw new Error(`Application finalization failed: ${finalizeError.message || finalizeError.code}`);
      }

      if (!finalizeResult?.success) {
        throw new Error('Application finalization failed');
      }
    }

    // ── Step 3: Side effects — AFTER finalize (non-critical) ───────
    // H4: Payment, audit, notification run last. Each is idempotent.
    if (studentData) {
      await postCommitApprovalSideEffects(app, studentData, approverData, isRenewal ? 'renewal' : 'new');
    }

    return { success: true, studentUid: app.applicant_uid };

  } catch (error: any) {
    // C4: Compensating rollback — release seat if it was assigned before the failure
    const seatComp = (app as any).__seatCompensation;
    if (seatComp) {
      await Seat.releaseSeat(seatComp.busId, seatComp.studentId, seatComp.shift)
        .catch(releaseErr => {
          console.error(`CRITICAL: Seat compensation failed for ${seatComp.busId}/${seatComp.studentId}:`, releaseErr);
        });
    }
    // Release lock — application still exists
    await db.rpc('release_application_lock', { p_application_id: applicationId });
    return { success: false, error: error.message, status: 500 };
  }
}

/**
 * D8: Approve a renewal application.
 * Computes renewal values and handles seat reclamation.
 * Does NOT write to student_profiles directly — returns pre-computed data
 * for the caller to pass to finalize_application_approval RPC, which commits
 * student update + idempotency marker + application finalization atomically.
 */
async function approveRenewal(
  app: any,
  approverData: { uid: string; name: string; role: string },
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<{ studentDataForRpc: Record<string, any>; studentData: Record<string, any> }> {
  const fd = app.form_data || {};
  const studentId = fd.studentId || app.applicant_uid;
  const durationYears = Number(fd.durationYears || fd.targetSession?.durationYears || 1);
  const totalFee = Number(fd.totalFee || fd.paymentInfo?.amountPaid || 0);

  // ── Read current student profile ──────────────────────────────────
  const student = await Student.getByUid(studentId);
  if (!student) throw new Error('Student not found for renewal');

  const now = new Date();
  const deadlineConfig = await getDeadlineConfig();

  // ── Compute renewal validity (max-of-old-and-new invariant) ──────
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

  // Idempotent duration — derived from final session dates, never incremented.
  const originalStartYear = (student as any).sessionStartYear || baseYear;
  const totalDuration = Math.max(
    finalSessionEndYear - originalStartYear,
    (student as any).durationYears || 0
  );
  const blockDates = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);

  const seatWasReleased = !!(student as any).seatReleasedAt;
  const renewalBusId = overrides?.busId || (student as any).busId || (student as any).currentBusId || (student as any).busId || null;

  // ── Seat reclamation (renewal_after_soft_block) ───────────────────
  // H3: Validate capacity BEFORE assignment. C4: Compensate on failure.
  let seatAssigned = false;
  if (app.application_type === 'renewal_after_soft_block' && seatWasReleased && renewalBusId) {
    const capacity = await Seat.getCapacity(renewalBusId, (student as any).shift);
    if (!capacity.available) {
      throw new Error(`Bus ${renewalBusId} is at full capacity for shift ${(student as any).shift}. Cannot reassign seat.`);
    }
    await Seat.assignSeat(renewalBusId, studentId, (student as any).shift);
    seatAssigned = true;
  }

  // C3: If seat was assigned but finalize later fails, compensate.
  // The caller's catch block handles lock release; we handle seat release here
  // by attaching a compensator that fires if the RPC call fails.
  if (seatAssigned && renewalBusId) {
    const shift = (student as any).shift;
    // Attach compensation info for the caller to use on failure
    (app as any).__seatCompensation = { busId: renewalBusId, studentId, shift };
  }

  // ── Return pre-computed data ──────────────────────────────────────
  // C3: Student update happens inside finalize_application_approval RPC,
  // atomically with application state change and idempotency marker.
  return {
    // For the finalize RPC (snake_case — matches DB columns)
    studentDataForRpc: {
      valid_until: finalValidUntil.toISOString(),
      status: 'active',
      session_end_year: finalSessionEndYear,
      session_duration: String(totalDuration),
      soft_block: blockDates.softBlock || null,
      hard_block: blockDates.hardBlock || null,
    },
    // For side effects (camelCase — matches domain model)
    studentData: {
      validUntil: finalValidUntil.toISOString(),
      sessionStartYear: (student as any).sessionStartYear || baseYear,
      sessionEndYear: finalSessionEndYear,
      durationYears: totalDuration,
    },
  };
}

/**
 * Approve an unauthenticated student's application.
 * Same orchestration as approve but with different data source.
 */
export async function approveUnauth(
  studentUid: string,
  moderatorData: { uid: string; name: string; role: string },
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<{ success: boolean; studentUid?: string; error?: string; status?: number }> {
  // Delegate to approve — the Application RPC handles the same validation
  return approve(studentUid, moderatorData, undefined, overrides);
}

/**
 * Reject an application. Orchestrates:
 * 1. Application RPC (validate + lock + return payload)
 * 2. Payment cleanup (idempotent)
 * 3. Audit (idempotent)
 * 4. Notification (idempotent)
 * 5. Finalize RPC (delete application)
 */
export async function reject(
  applicationId: string,
  rejectorData: { uid: string; name: string; role: string },
  reason: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const db = getSupabaseServer();

  // Step 1: Validate + lock + return payload
  const { data: rpcResult } = await db.rpc('reject_application', {
    p_application_id: applicationId,
    p_rejector_uid: rejectorData.uid,
  });

  if (!rpcResult?.success) {
    return { success: false, error: rpcResult?.error, status: rpcResult?.status };
  }

  const app = rpcResult.application;

  try {
    // Step 2a: Payment cleanup
    // H2: Payment operations go through Payment domain public API.
    if (app.payment_id) {
      try {
        const { rejectApplicationPayment } = await import('@/domains/payment');
        await rejectApplicationPayment(app.payment_id, {
          userId: rejectorData.uid,
          name: rejectorData.name,
          empId: '',
          role: rejectorData.role,
        });
      } catch (paymentError) {
        console.error('Failed to reject pending payment record:', paymentError);
      }
    }

    // Step 2b: Audit
    await createAuditEvent({
      category: 'applications',
      action: 'application_rejected',
      summary: `Application rejected: ${app.full_name || ''}`,
      severity: 'medium',
      actor_id: rejectorData.uid,
      actor_name: rejectorData.name,
      actor_role: rejectorData.role,
      target_type: 'application',
      target_id: app.applicant_uid,
      target_name: app.full_name || '',
      metadata: { reason },
    });

    // Step 2c: Notification
    if (app.email || app.applicant_email) {
      const { sendApplicationRejectedNotification } = await import('@/lib/services/admin-email.service');
      await sendApplicationRejectedNotification({
        studentName: app.full_name || 'Student',
        studentEmail: app.email || app.applicant_email,
        reason,
        rejectedBy: rejectorData.name,
      }).catch(err => console.error('Rejection email failed:', err));
    }

    // Step 3: Finalize (delete)
    const { data: finalizeResult } = await db.rpc('finalize_application_rejection', {
      p_application_id: applicationId,
      p_rejector_uid: rejectorData.uid,
    });

    return { success: finalizeResult?.success, error: finalizeResult?.error };

  } catch (error: any) {
    await db.rpc('release_application_lock', { p_application_id: applicationId });
    return { success: false, error: error.message, status: 500 };
  }
}

/**
 * Reject an unauthenticated student's application.
 */
export async function rejectUnauth(
  studentUid: string,
  moderatorData: { uid: string; name: string; role: string },
  reason: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  return reject(studentUid, moderatorData, reason);
}

/**
 * Check if a user has an active application.
 */
export async function checkApplication(uid: string): Promise<{
  hasApplication: boolean;
  applicationId?: string;
  state?: ApplicationState;
  applicationType?: ApplicationType;
  eligibleApproval?: string;
}> {
  const app = await repository.findByApplicantUid(uid);
  if (!app) {
    return { hasApplication: false };
  }
  return {
    hasApplication: true,
    applicationId: app.applicationId,
    state: app.state,
    applicationType: app.applicationType,
    eligibleApproval: app.eligibleApproval,
  };
}

/**
 * Get a student's own application.
 */
export async function getMyApplication(uid: string): Promise<Application | null> {
  return repository.findByApplicantUid(uid);
}

/**
 * Get a student's application status.
 */
export async function getMyStatus(uid: string): Promise<{
  status: string;
  message: string;
  applicationData?: Application;
}> {
  // Check if user exists in Identity system (approved)
  try {
    const { getUserById } = await import('@/domains/identity');
    const user = await getUserById(uid);
    if (user) {
      return {
        status: 'approved',
        message: 'Your application has been approved!',
      };
    }
  } catch {
    // User not found — continue checking application
  }

  const app = await repository.findByApplicantUid(uid);
  if (!app) {
    return { status: 'no_application', message: 'No application found' };
  }

  if (app.state === 'rejected') {
    return {
      status: 'rejected',
      message: 'Your application has been rejected',
      applicationData: app,
    };
  }

  if (app.state === 'approved') {
    return {
      status: 'approved',
      message: 'Your application has been approved!',
      applicationData: app,
    };
  }

  return {
    status: 'pending',
    message: 'Form submitted and verified! Waiting for approval from the Managing Team',
    applicationData: app,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildStudentData(
  app: any,
  approverData: { uid: string; name: string; role: string },
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<Record<string, any>> {
  const fd = app.form_data || app.formData || {};
  const si = fd.sessionInfo || {};
  const startYear = overrides?.startYear || si.sessionStartYear || fd.sessionStartYear || new Date().getFullYear();
  const endYear = overrides?.endYear || si.sessionEndYear || fd.sessionEndYear || (startYear + 1);
  const durationYears = Math.max(1, endYear - startYear);

  const busId = overrides?.busId || app.bus_id || app.busId || fd.busId || fd.bus_id || fd.selectedBus;
  const routeId = app.route_id || app.routeId || fd.routeId || fd.route_id || fd.selectedRoute;
  const stop_name = app.stop_name || fd.stop_name || fd.selected_stop_name || fd.selectedStop;
  const rawShift = app.shift || fd.shift || fd.selectedShift;
  const shift = normalizeShift(rawShift);
  if (!shift) {
    throw new Error('Application is missing a valid shift assignment.');
  }

  const fullName = app.full_name || fd.fullName || app.name || '';
  const email = app.email || fd.email || '';
  const enrollmentId = app.enrollment_id || app.enrollmentId || fd.enrollmentId || '';

  const deadlineConfig = await getDeadlineConfig();
  const validUntilDate = calculateValidUntilDate(startYear, durationYears, deadlineConfig);
  const validUntilStr = validUntilDate.toISOString();
  const blockDates = computeBlockDatesFromValidUntil(validUntilDate, deadlineConfig);

  return {
    applicationId: app.application_id || app.applicationId || app.id || null,
    fullName,
    email,
    phone: fd.phoneNumber || fd.phone || app.phone || '',
    altPhone: fd.alternatePhone || fd.altPhone || null,
    parentName: fd.parentName || null,
    parentPhone: fd.parentPhone || null,
    faculty: app.faculty || fd.faculty || '',
    department: app.department || fd.department || '',
    gender: fd.gender || null,
    dob: fd.dob || null,
    enrollmentId,
    bloodGroup: fd.bloodGroup || null,
    address: fd.address || null,
    profilePhotoUrl: fd.profilePhotoUrl || null,
    busId,
    routeId,
    stop_name,
    shift,
    sessionStartYear: startYear,
    sessionEndYear: endYear,
    sessionDuration: String(durationYears),
    semester: app.semester || fd.semester || '',
    durationYears,
    validUntil: validUntilStr,
    softBlock: (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as any)?.toISOString()) || null,
    hardBlock: (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as any)?.toISOString()) || null,
    approvedBy: approverData.name || approverData.uid,
  };
}

async function postCommitApprovalSideEffects(
  app: any,
  studentData: Record<string, any>,
  approverData: { uid: string; name: string; role: string },
  applicationType?: 'new' | 'renewal'
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  const purpose: 'new_registration' | 'renewal' = applicationType === 'renewal' ? 'renewal' : 'new_registration';

  // Payment (online: idempotent via upsertPayment; offline: session-level duplicate check via createPayment)
  // H2: All payment operations go through Payment domain public API — no internal implementation leakage.
  const amount = Number(app.amount_paid || app.form_data?.paymentInfo?.amountPaid || 0);
  if (amount > 0) {
    const paymentMode = app.payment_mode || app.form_data?.paymentInfo?.paymentMode;
    const studentIdVal = app.form_data?.enrollmentId || app.enrollment_id || app.enrollmentId || studentData.enrollmentId;
    const studentNameVal = app.form_data?.fullName || app.full_name || studentData.fullName;

    if (paymentMode === 'online') {
      tasks.push(
        import('@/domains/payment').then(({ upsertApprovalPayment }) =>
          upsertApprovalPayment({
            paymentId: app.form_data?.paymentInfo?.razorpayPaymentId || app.payment_id || `pay_${Date.now()}`,
            studentId: studentIdVal,
            studentUid: app.applicant_uid,
            studentName: studentNameVal,
            amount,
            method: 'Online',
            status: 'Completed',
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            durationYears: studentData.durationYears,
            validUntil: studentData.validUntil
              ? new Date(studentData.validUntil)
              : new Date(Date.UTC(studentData.sessionEndYear || (new Date().getFullYear() + 1), 5, 30, 23, 59, 59, 999)),
            razorpayPaymentId: app.form_data?.paymentInfo?.razorpayPaymentId,
            razorpayOrderId: app.form_data?.paymentInfo?.razorpayOrderId,
            approvedAt: new Date(),
          })
        ).catch(err => { console.error('Payment upsert failed:', err); })
      );
    } else {
      tasks.push(
        import('@/domains/payment').then(({ createOfflinePaymentAtApproval }) =>
          createOfflinePaymentAtApproval({
            studentId: studentIdVal,
            studentUid: app.applicant_uid,
            studentName: studentNameVal,
            amount,
            durationYears: studentData.durationYears,
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            validUntil: studentData.validUntil || new Date(Date.UTC(studentData.sessionEndYear || (new Date().getFullYear() + 1), 5, 30, 23, 59, 59, 999)).toISOString(),
            transactionId: app.form_data?.paymentInfo?.paymentReference || '',
            paidAt: app.form_data?.paymentInfo?.paidAt
              ? new Date(app.form_data.paymentInfo.paidAt)
              : new Date(),
            receipt: app.form_data?.paymentInfo?.paymentEvidenceUrl || '',
            approverUserId: approverData.uid,
            approverName: approverData.name,
            approverEmpId: '',
            approverRole: approverData.role,
            purpose,
          })
        ).catch(err => { console.error('Payment creation failed:', err); })
      );
    }
  }

  // Audit (idempotent)
  tasks.push(
    createAuditEvent({
      category: 'applications',
      action: 'application_approved',
      summary: `Application approved: ${app.full_name || ''}`,
      severity: 'high',
      actor_id: approverData.uid,
      actor_name: approverData.name,
      actor_role: approverData.role,
      target_type: 'student',
      target_id: app.applicant_uid,
      target_name: app.full_name || '',
      metadata: { applicationId: app.application_id },
    })
  );

  // Notification (idempotent)
  tasks.push(
    Notification.createNotification(
      { userId: 'system', userName: 'System', userRole: 'admin' },
      { type: 'specific_users', specificUserIds: [app.applicant_uid] },
      'Your bus service application has been approved.',
      'Application Approved',
      { applicationId: app.application_id }
    ).catch(err => { console.error('Notification failed:', err); })
  );

  await Promise.allSettled(tasks);
}

export type { Application };
