import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { v2 as cloudinary } from 'cloudinary';
import { createAuditLogInTransaction, type AuditActorRole } from '@/lib/services/audit.service';
import { calculateRenewalDate } from '@/lib/utils/renewal-utils';
import { calculateValidUntilDate } from '@/lib/utils/date-utils';
import { buildCapacityDelta, sendBusFullAlert, validateAndSuggestBus } from '@/lib/busCapacityService';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { sendApplicationApprovedNotification } from '@/lib/services/admin-email.service';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createOfflinePaymentAtApproval } from '@/lib/payment/payment.service';
import { isApprovalEligible, isUpcomingApplication } from '@/lib/utils/application-eligibility';
import type { Application } from '@/lib/types/application';
import { CapacityFullError, ApprovalConflictError } from '@/lib/errors/sentinel-errors';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { normalizeShift, getShiftLoad } from '@/lib/utils/shift-utils';

type JsonRecord = Record<string, unknown>;

if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET && process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractPublicIdFromUrl(url: string): string | null {
  try {
    const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    return matches ? matches[1] : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const moderatorUid = decodedToken.uid;
    const moderatorEmail = decodedToken.email || '';
    const body = asRecord(await request.json());
    const studentUid = asString(body.studentUid);

    if (!studentUid) {
      return NextResponse.json({ error: 'Missing student UID' }, { status: 400 });
    }

    const [moderatorDoc, adminDoc, applicationDoc] = await Promise.all([
      adminDb.collection('moderators').doc(moderatorUid).get(),
      adminDb.collection('admins').doc(moderatorUid).get(),
      adminDb.collection('applications').doc(studentUid).get(),
    ]);

    if (!moderatorDoc.exists && !adminDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const moderatorData = moderatorDoc.exists ? moderatorDoc.data() : adminDoc.data();
    const approverRole = adminDoc.exists ? 'admin' : 'moderator';
    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: moderatorEmail,
        role: approverRole,
        name: moderatorData?.fullName || moderatorData?.name || '',
      },
      'applications',
      'canApprove'
    );
    if (permissionDenied) return permissionDenied;

    if (!applicationDoc.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    const appData = applicationDoc.data() as JsonRecord;

    // Future-session approval (parity with /approve): a future-session
    // application verified by admin/moderator always transitions to
    // `verified_upcoming`. No student doc / seat / capacity decrement —
    // activation is deferred exclusively to the Session Activation Service.
    if (isUpcomingApplication(appData as Partial<Application>)) {
      const nowIsoVU = new Date().toISOString();
      const formDataVU = asRecord(appData.formData);
      const approverNameVU = moderatorData?.name || moderatorData?.fullName || 'Approver';
      const approverEmpIdVU = moderatorData?.employeeId || moderatorData?.staffId || moderatorUid;
      try {
        await adminDb.runTransaction(async (transaction) => {
          const freshSnap = await transaction.get(applicationDoc.ref);
          if (!freshSnap.exists) {
            throw new ApprovalConflictError('Application already processed');
          }
          if (freshSnap.data()?.state !== 'submitted') {
            throw new ApprovalConflictError(`Application state is '${freshSnap.data()?.state}', expected 'submitted'`);
          }
          transaction.update(freshSnap.ref, {
            state: 'verified_upcoming',
            verifiedUpcomingAt: nowIsoVU,
            verifiedUpcomingBy: adminDoc.exists ? `${approverNameVU} (Admin)` : `${approverNameVU} (${approverEmpIdVU})`,
            verifiedUpcomingById: moderatorUid,
            updatedAt: nowIsoVU,
          });
          createAuditLogInTransaction(transaction, {
            category: 'applications',
            action: 'application_verified_upcoming',
            summary: `Application verified for upcoming session: ${asString(formDataVU.fullName)}`,
            severity: 'medium',
            performedBy: moderatorUid,
            performedByName: approverNameVU,
            performedByRole: approverRole as any,
            targetType: 'application',
            targetId: asString(appData.applicantUid) || studentUid,
            targetName: asString(formDataVU.fullName),
            metadata: {
              before: { applicationId: studentUid, state: 'submitted', channel: 'unauthenticated' },
              after: { applicationId: studentUid, state: 'verified_upcoming', eligibleApproval: appData.eligibleApproval, targetSession: appData.targetSession },
              details: { applicationId: studentUid, channel: 'unauthenticated' },
            },
          });
        });
      } catch (vuErr: any) {
        if (vuErr instanceof ApprovalConflictError) {
          return NextResponse.json({ error: vuErr.message }, { status: 409 });
        }
        throw vuErr;
      }
      // Notify the applicant.
      try {
        const notifRef = adminDb.collection('notifications').doc();
        await notifRef.set({
          title: 'Application verified — awaiting new session',
          content: 'Your application has been verified and will become active when the new academic session begins.',
          type: 'info',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [asString(appData.applicantUid) || studentUid]
          },
          recipientIds: [asString(appData.applicantUid) || studentUid],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          isEdited: false,
          isDeletedGlobally: false,
          hiddenForUserIds: [],
          createdAt: nowIsoVU,
          metadata: {
            applicationId: studentUid,
            statusPage: `/apply/status/${studentUid}`
          }
        });
      } catch (notifErr) {
        console.warn('verified_upcoming notify failed:', notifErr);
      }
      return NextResponse.json({
        success: true,
        message: 'Application verified for the upcoming academic session. It will activate when the session begins.',
        state: 'verified_upcoming',
        eligibleApproval: appData.eligibleApproval,
      });
    }

    const formData = asRecord(appData.formData);
    const sessionInfo = asRecord(formData.sessionInfo);
    const paymentInfo = asRecord(formData.paymentInfo);
    const applicantUid = asString(appData.applicantUid) || studentUid;
    const nowIso = new Date().toISOString();
    const approverName = moderatorData?.name || moderatorData?.fullName || 'Approver';
    const approverEmpId = moderatorData?.employeeId || moderatorData?.staffId || moderatorUid;
    const approvedByDisplay = adminDoc.exists
      ? `${approverName} (Admin)`
      : `${approverName} (${approverEmpId})`;

    // Check for overridden session start/end years (Part 2 & 3)
    const overrideStartYear = body.sessionStartYear ? Number(body.sessionStartYear) : null;
    const overrideEndYear = body.sessionEndYear ? Number(body.sessionEndYear) : null;

    const deadlineConfig = await getDeadlineConfig();
    
    // Compute final start year, duration, and end year based on overrides
    const finalStartYear = overrideStartYear !== null ? overrideStartYear : Number(sessionInfo.sessionStartYear || new Date().getUTCFullYear());
    const finalEndYear = overrideEndYear !== null ? overrideEndYear : (Number(sessionInfo.sessionEndYear) || (finalStartYear + 1));
    const finalDurationYears = overrideStartYear !== null && overrideEndYear !== null ? (overrideEndYear - overrideStartYear) : Number(sessionInfo.durationYears || 1);

    const validUntilDate = calculateValidUntilDate(finalEndYear - finalDurationYears, finalDurationYears, deadlineConfig);
    const validUntil = validUntilDate.toISOString();
    const sessionEndYear = finalEndYear;
    
    const blockDates = computeBlockDatesFromValidUntil(validUntil, deadlineConfig);
    let busId = asString(formData.routeId) ? asString(formData.routeId).replace('route_', 'bus_') : '';
    const requestedBusId = busId; // preserved for audit when overridden
    const overrideBusId = asString(body.overrideBusId);
    const shift = normalizeShift(asString(formData.shift));

    // ── Override bus (Case 2: alternative-bus picker) ──────────────────────────
    // When the moderator explicitly selects a different bus (the original is full
    // but alternatives exist), validate the override and use it instead. The
    // atomic capacity gate inside the transaction is the final authority.
    if (overrideBusId && overrideBusId !== busId) {
      const overrideBusDoc = await adminDb.collection('buses').doc(overrideBusId).get();
      if (!overrideBusDoc.exists) {
        return NextResponse.json({ error: 'Selected alternative bus not found' }, { status: 404 });
      }
      const overrideData = overrideBusDoc.data() || {};
      const overrideShift = (overrideData.shift || '').toLowerCase();
      const shiftLower = shift.toLowerCase();
      const shiftCompatible =
        overrideShift === 'both' ||
        overrideShift.includes(shiftLower) ||
        shiftLower.includes(overrideShift);
      if (!shiftCompatible) {
        return NextResponse.json({ error: 'Selected bus is not compatible with the required shift' }, { status: 400 });
      }
      // Pre-check capacity for the applicant's trip only (non-authoritative; the txn gate is binding).
      if (getShiftLoad(overrideData, shift) >= (overrideData.capacity || 55)) {
        return NextResponse.json({ error: 'Selected alternative bus is also full' }, { status: 400 });
      }
      busId = overrideBusId;
      // Also update the routeId to match the new bus so the student doc has
      // the correct routeRef. stopId stays the same (the bus must serve that stop).
      (formData as Record<string, unknown>).routeId = overrideData.routeId || overrideData.routeRef || formData.routeId;
    }

    // Capacity pre-check (parity with /approve): reject full buses up front with
    // alternative suggestions, before recording payment or creating the student.
    const validationStopId = asString(formData.stopId) || asString(formData.pickupPoint);
    if (busId) {
      const capacityValidation = await validateAndSuggestBus({
        routeId: asString(formData.routeId),
        stopId: validationStopId,
        shift,
      });
      if (!capacityValidation.canAssign) {
        return NextResponse.json({
          error: 'Bus is at full capacity',
          message: capacityValidation.message,
          alternatives: capacityValidation.alternatives
        }, { status: 400 });
      }
    }

    const userDoc = {
      createdAt: nowIso,
      email: asString(appData.email) || asString(formData.email),
      name: asString(formData.fullName),
      role: 'student',
      uid: applicantUid,
    };

    const studentDoc = {
      address: formData.address,
      alternatePhone: formData.alternatePhone || '',
      approvedAt: nowIso,
      approvedBy: approvedByDisplay,
      bloodGroup: formData.bloodGroup,
      busId,
      createdAt: nowIso,
      department: formData.department,
      dob: formData.dob,
      durationYears: finalDurationYears,
      email: asString(appData.email) || asString(formData.email),
      enrollmentId: formData.enrollmentId,
      faculty: formData.faculty,
      fullName: formData.fullName,
      gender: formData.gender,
      parentName: formData.parentName,
      parentPhone: formData.parentPhone,
      phoneNumber: formData.phoneNumber,
      profilePhotoUrl: formData.profilePhotoUrl || '',
      role: 'student',
      routeId: formData.routeId || '',
      semester: formData.semester,
      sessionEndYear,
      sessionStartYear: finalStartYear,
      shift,
      status: 'active',
      stopId: formData.stopId || '',
      uid: applicantUid,
      updatedAt: nowIso,
      validUntil,
      softBlock: blockDates.softBlock,
      hardBlock: blockDates.hardBlock,
      paymentAmount: Number(paymentInfo.amountPaid || 0),
      paid_on: nowIso,
    };


    // Atomic entitlement + capacity allocation (single Firestore transaction).
    //   Student + user creation, application/unauth cleanup, and the capacity
    //   increment commit together or not at all. The application is re-read inside
    //   the transaction for idempotency (duplicate / retry), and an atomic capacity
    //   gate enforces the same first-come-first-served rule as /approve (no moderator
    //   path may bypass capacity; explicit overrides exist via admin-create/reassignment).
    const studentRef = adminDb.collection('students').doc(applicantUid);
    const userRef = adminDb.collection('users').doc(applicantUid);
    const unauthRef = adminDb.collection('unauthUsers').doc(applicantUid);
    const applicationRef = applicationDoc.ref;
    const busRef = busId ? adminDb.collection('buses').doc(busId) : null;

    let capacityNewMembers = 0;
    let capacityNewShiftLoad = 0;
    let capacityLimit = 0;
    let busNumberForAlert = '';
    let routeIdForAlert = '';

    try {
      await adminDb.runTransaction(async (transaction) => {
        // Reads first (Firestore requires all reads before writes)
        const freshAppSnap = await transaction.get(applicationRef);
        if (!freshAppSnap.exists) {
          throw new ApprovalConflictError('Application already processed');
        }
        // Reject drafts — only 'submitted' applications may be approved.
        const freshState = freshAppSnap.data()?.state;
        if (freshState !== 'submitted') {
          throw new ApprovalConflictError(`Application state is '${freshState}', expected 'submitted'`);
        }
        let busSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (busRef) {
          busSnap = await transaction.get(busRef);
        }

        // Atomic capacity gate (parity with /approve): reject when no free seat
        // remains. Closes the last-seat race between concurrent approvals.
        let delta: ReturnType<typeof buildCapacityDelta> | null = null;
        if (busRef) {
          if (busSnap && busSnap.exists) {
            const busData = busSnap.data();
            delta = buildCapacityDelta(busData, studentDoc.shift, 1);
            // Per-shift gate: only the student's own trip counter is constrained.
            if (delta.oldShiftLoad >= delta.capacity) {
              throw new CapacityFullError();
            }
            capacityNewMembers = delta.newMembers;
            capacityNewShiftLoad = delta.newShiftLoad;
            capacityLimit = delta.capacity;
            busNumberForAlert = busData?.busNumber || '';
            routeIdForAlert = busData?.routeId || '';
          } else {
            // Bus referenced but does not exist — abort, don't create a phantom assignment.
            throw new Error(`Assigned bus ${busId} not found; cannot approve without a valid bus`);
          }
        }

        // Writes
        transaction.set(userRef, userDoc);
        transaction.set(studentRef, studentDoc);
        transaction.delete(applicationRef);
        transaction.delete(unauthRef);
        if (busRef && delta) {
          transaction.update(busRef, delta.updates);
        }

        // ── Tier A audit (in-transaction). Guarantees every unauth approval is
        //    audited atomically with the entitlement/capacity mutation, replacing
        //    the former best-effort post-commit logs.
        const sessionModified =
          (overrideStartYear !== null || overrideEndYear !== null) &&
          (Number(sessionInfo.sessionStartYear || 0) !== finalStartYear ||
            Number(sessionInfo.sessionEndYear || 0) !== finalEndYear);
        const usedAlternativeBus = !!overrideBusId && overrideBusId !== requestedBusId;
        createAuditLogInTransaction(transaction, {
          category: 'applications',
          action: 'application_approved',
          summary: `Application approved: ${asString(formData.fullName)}`,
          severity: 'high',
          performedBy: moderatorUid,
          performedByName: approverName,
          performedByRole: approverRole as any,
          targetType: 'student',
          targetId: applicantUid,
          targetName: asString(formData.fullName),
          metadata: {
            reason: usedAlternativeBus ? 'capacity_reallocation' : 'application_approval_unauth',
            before: { applicationId: studentUid, applicationState: 'submitted', requestedBusId: requestedBusId || null },
            after: { studentUid: applicantUid, busId: busId || null, shift: studentDoc.shift, sessionStartYear: finalStartYear, sessionEndYear: finalEndYear, validUntil, status: 'active' },
            details: {
              applicationId: studentUid,
              channel: 'unauthenticated',
              sessionModified,
              previousStartYear: Number(sessionInfo.sessionStartYear || 0),
              previousEndYear: Number(sessionInfo.sessionEndYear || 0),
              alternativeBus: usedAlternativeBus ? { requestedBusId: requestedBusId || null, approvedBusId: overrideBusId } : null,
            },
          },
        });
      });
    } catch (txErr: any) {
      if (txErr instanceof ApprovalConflictError) {
        return NextResponse.json({ error: txErr.message }, { status: 409 });
      }
      if (txErr instanceof CapacityFullError) {
        // Lost the last seat after the up-front pre-check — return the same
        // "bus full" response (with alternatives) as /approve.
        const fullValidation = await validateAndSuggestBus({
          routeId: asString(formData.routeId),
          stopId: validationStopId,
          shift,
        });
        return NextResponse.json({
          error: 'Bus is at full capacity',
          message: fullValidation.message,
          alternatives: fullValidation.alternatives
        }, { status: 400 });
      }
      throw txErr;
    }

    // (Approval audit is now written atomically inside the transaction above.)

    // Payment processing AFTER successful transaction — prevents inconsistent
    //    state where payment is Completed but student was never created (e.g. bus
    //    full race or duplicate approval conflict).
    const paymentAmount = Number(paymentInfo.amountPaid || 0);
    if (paymentAmount > 0) {
      const isOnlinePayment = paymentInfo.paymentMode === 'online';

      if (isOnlinePayment) {
        const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
        const studentPayments = await paymentsSupabaseService.getPaymentsByStudentUid(applicantUid);
        const onlinePayment = studentPayments.find(p => p.method === 'Online' && p.status === 'Completed');
        if (!onlinePayment) {
          console.error('Completed online payment record not found post-transaction for', applicantUid);
        } else {
          const updatedPaymentId = await paymentsSupabaseService.upsertPayment({
            paymentId: onlinePayment.payment_id,
            studentId: onlinePayment.student_id,
            studentUid: onlinePayment.student_uid,
            studentName: onlinePayment.student_name,
            amount: onlinePayment.amount,
            method: 'Online',
            status: 'Completed',
            sessionStartYear: finalStartYear,
            sessionEndYear,
            durationYears: finalDurationYears,
            validUntil: new Date(validUntil),
            razorpayPaymentId: onlinePayment.razorpay_payment_id,
            razorpayOrderId: onlinePayment.razorpay_order_id,
          });

          if (!updatedPaymentId) {
            console.error('Failed to update online payment validity post-transaction for', applicantUid);
          }
        }
      } else {
        // OFFLINE PAYMENT: Create completed payment record AT APPROVAL TIME.
        // Financial ledger contains ONLY verified financial events.
        const transactionId = asString(paymentInfo.paymentReference);
        const paidAtFromStudent = paymentInfo.paidAt
          ? new Date(asString(paymentInfo.paidAt))
          : new Date(nowIso);
        const receipt = asString(paymentInfo.paymentEvidenceUrl);

        await createOfflinePaymentAtApproval({
          studentId: asString(formData.enrollmentId),
          studentUid: applicantUid,
          studentName: asString(formData.fullName),
          amount: paymentAmount,
          durationYears: finalDurationYears,
          sessionStartYear: finalStartYear,
          sessionEndYear,
          validUntil,
          transactionId,
          paidAt: paidAtFromStudent,
          receipt,
          approverUserId: moderatorUid,
          approverName: asString(moderatorData?.name) || moderatorEmail || 'Approver',
          approverEmpId: asString(moderatorData?.employeeId) || moderatorUid,
          approverRole,
          purpose: 'new_registration',
        });
      }
    }

    if (studentDoc.email) {
      try {
        await sendApplicationApprovedNotification({
          studentName: asString(studentDoc.fullName),
          studentEmail: asString(studentDoc.email),
          busNumber: busId ? busId.replace('bus_', 'Bus-') : 'Assigned Soon',
          routeName: asString(formData.routeName) || `Route ${asString(studentDoc.routeId).replace('route_', '')}`,
          shift,
          validUntil: new Date(validUntil).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
        });
      } catch (emailError) {
        console.error('Failed to send application approval email:', emailError);
      }
    }

    // Post-commit: bus full alert if this approval consumed the last seat on the affected shift (never affects committed state).
    if (busId && capacityLimit > 0 && capacityNewShiftLoad >= capacityLimit) {
      await sendBusFullAlert(busId, busNumberForAlert, routeIdForAlert).catch(error => {
        console.error(`Failed to send bus full alert for ${busId}:`, error);
      });
    }

    const paymentEvidenceUrl = asString(paymentInfo.paymentEvidenceUrl);
    if (paymentEvidenceUrl && cloudinary.config().api_key) {
      const publicId = extractPublicIdFromUrl(paymentEvidenceUrl);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId).catch(error => {
          console.error('Failed to delete payment proof from Cloudinary:', error);
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Application approved successfully',
      studentUid: applicantUid,
    });
  } catch (error) {
    console.error('Error approving application:', error);
    return NextResponse.json(
      { error: safeErrorMessage(error, 'Failed to approve application') },
      { status: 500 }
    );
  }
}
