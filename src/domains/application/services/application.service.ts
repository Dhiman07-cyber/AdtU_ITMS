/**
 * D4 ApplicationService — public service contract per PHASE2.2/2.4.
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
 *   - identity_activate_student() → Identity tables only
 *   - finalize_application_approval() → Application table only
 *
 * All side effects are idempotent. Retrying a completed operation
 * never produces duplicate state.
 */
import * as repository from '../repositories/application.repository';
import { getSupabaseServer } from '@/lib/supabase-server';
import { createAuditLog } from '@/domains/audit';
import * as Notification from '@/domains/notification';
import type { Application, ApplicationState, ApplicationType } from '@/lib/types/application';
import type { CreateAuditLogInput } from '@/lib/services/audit.service';

// ─── CRUD Methods ────────────────────────────────────────────────────────────

export async function getAll(): Promise<Application[]> {
  return repository.findAll();
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

  // Check for existing live application
  const existing = await repository.findByApplicantUid(uid);
  const LIVE_STATES: ApplicationState[] = [
    'submitted', 'approved', 'verified', 'awaiting_verification',
    'verified_upcoming', 'pending_seat_allocation',
  ];
  if (existing && LIVE_STATES.includes(existing.state)) {
    return { success: false, error: 'An application is already in progress' };
  }

  const applicationData: Partial<Application> = {
    applicationId: uid,
    applicantUid: uid,
    email,
    state: 'submitted',
    formData: { ...formData } as any,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    verifiedBy: formData.paymentInfo?.paymentMode === 'online'
      ? 'system_online_payment'
      : 'system_offline_submission_bypass',
    verifiedAt: now,
    needsCapacityReview: body.needsCapacityReview || false,
    applicationType: body.applicationType,
    targetSession: body.targetSession,
    eligibleApproval: body.eligibleApproval,
  } as Partial<Application>;

  await repository.upsert(applicationData);

  return { success: true, applicationId: uid };
}

/**
 * Approve an application. Orchestrates:
 * 1. Application RPC (validate + lock + return payload)
 * 2. Identity RPC (activate student)
 * 3. Payment (idempotent)
 * 4. Audit (idempotent)
 * 5. Notification (idempotent)
 * 6. Finalize RPC (delete application)
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

  try {
    // ── Step 2a: Identity — ONE atomic business capability ──────────
    const studentData = buildStudentData(app, approverData, overrides);

    const { data: identityResult } = await db.rpc('identity_activate_student', {
      p_uid: app.applicant_uid,
      p_email: app.email || app.applicant_email,
      p_full_name: app.full_name,
      p_student_data: studentData,
    });

    if (!identityResult?.success) {
      throw new Error('Identity activation failed');
    }

    // ── Step 2b-2d: Idempotent side effects ────────────────────────
    await postCommitApprovalSideEffects(app, studentData, approverData);

    // ── Step 3: Application RPC — finalize (delete) ────────────────
    const { data: finalizeResult } = await db.rpc('finalize_application_approval', {
      p_application_id: applicationId,
      p_approver_uid: approverData.uid,
    });

    if (!finalizeResult?.success) {
      throw new Error('Application finalization failed');
    }

    return { success: true, studentUid: app.applicant_uid };

  } catch (error: any) {
    // ── Failure path: release lock, application still exists ────────
    await db.rpc('release_application_lock', { p_application_id: applicationId });
    return { success: false, error: error.message, status: 500 };
  }
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
    if (app.payment_id) {
      try {
        const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
        await paymentsSupabaseService.updatePaymentStatus(app.payment_id, 'Rejected', {
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
    await createAuditLog({
      category: 'applications',
      action: 'application_rejected',
      summary: `Application rejected: ${app.full_name || ''}`,
      severity: 'medium',
      performedBy: rejectorData.uid,
      performedByName: rejectorData.name,
      performedByRole: rejectorData.role as any,
      targetType: 'application',
      targetId: app.applicant_uid,
      targetName: app.full_name || '',
      metadata: { reason },
    }).catch(err => console.error('Audit log failed:', err));

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

function buildStudentData(
  app: any,
  approverData: { uid: string; name: string; role: string },
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Record<string, any> {
  const fd = app.form_data || {};
  const si = fd.sessionInfo || {};
  const startYear = overrides?.startYear || si.sessionStartYear || new Date().getFullYear();
  const endYear = overrides?.endYear || si.sessionEndYear || startYear + 1;

  return {
    phone: fd.phoneNumber,
    altPhone: fd.alternatePhone,
    parentName: fd.parentName,
    parentPhone: fd.parentPhone,
    faculty: app.faculty || fd.faculty,
    department: app.department || fd.department,
    gender: fd.gender,
    dob: fd.dob,
    enrollmentId: app.enrollment_id || fd.enrollmentId,
    bloodGroup: fd.bloodGroup,
    address: fd.address,
    profilePhotoUrl: fd.profilePhotoUrl,
    busId: overrides?.busId || app.bus_id,
    routeId: app.route_id,
    stopId: app.stop_id,
    shift: app.shift,
    sessionStartYear: startYear,
    sessionEndYear: endYear,
    semester: app.semester || fd.semester,
    durationYears: endYear - startYear,
    approvedBy: approverData.name,
  };
}

async function postCommitApprovalSideEffects(
  app: any,
  studentData: Record<string, any>,
  approverData: { uid: string; name: string; role: string }
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];

  // Payment (idempotent via ensureApplicationPayment pattern)
  const amount = Number(app.amount_paid || app.form_data?.paymentInfo?.amountPaid || 0);
  if (amount > 0) {
    const paymentMode = app.payment_mode || app.form_data?.paymentInfo?.paymentMode;
    if (paymentMode === 'online') {
      tasks.push(
        import('@/lib/services/payments-supabase').then(({ paymentsSupabaseService }) =>
          paymentsSupabaseService.upsertPayment({
            paymentId: app.form_data?.paymentInfo?.razorpayPaymentId || '',
            studentId: app.enrollment_id,
            studentUid: app.applicant_uid,
            studentName: app.full_name,
            amount,
            method: 'Online',
            status: 'Completed',
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            durationYears: studentData.durationYears,
            validUntil: new Date(studentData.validUntil || Date.now()),
            razorpayPaymentId: app.form_data?.paymentInfo?.razorpayPaymentId,
            razorpayOrderId: app.form_data?.paymentInfo?.razorpayOrderId,
          })
        ).catch(err => { console.error('Payment upsert failed:', err); })
      );
    } else {
      tasks.push(
        import('@/lib/payment/payment.service').then(({ createOfflinePaymentAtApproval }) =>
          createOfflinePaymentAtApproval({
            studentId: app.enrollment_id,
            studentUid: app.applicant_uid,
            studentName: app.full_name,
            amount,
            durationYears: studentData.durationYears,
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            validUntil: studentData.validUntil || new Date().toISOString(),
            transactionId: app.form_data?.paymentInfo?.paymentReference || '',
            paidAt: app.form_data?.paymentInfo?.paidAt
              ? new Date(app.form_data.paymentInfo.paidAt)
              : new Date(),
            receipt: app.form_data?.paymentInfo?.paymentEvidenceUrl || '',
            approverUserId: approverData.uid,
            approverName: approverData.name,
            approverEmpId: '',
            approverRole: approverData.role,
            purpose: 'new_registration',
          })
        ).catch(err => { console.error('Payment creation failed:', err); })
      );
    }
  }

  // Audit (idempotent)
  tasks.push(
    createAuditLog({
      category: 'applications',
      action: 'application_approved',
      summary: `Application approved: ${app.full_name || ''}`,
      severity: 'high',
      performedBy: approverData.uid,
      performedByName: approverData.name,
      performedByRole: approverData.role as any,
      targetType: 'student',
      targetId: app.applicant_uid,
      targetName: app.full_name || '',
      metadata: { applicationId: app.application_id },
    }).catch(err => { console.error('Audit log failed:', err); })
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
