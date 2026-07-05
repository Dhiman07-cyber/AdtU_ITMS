import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { Application, AuditLogEntry } from '@/lib/types/application';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { sendApplicationRejectedNotification } from '@/lib/services/admin-email.service';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditLogInTransaction } from '@/lib/services/audit.service';
import { ApplicationGoneError } from '@/lib/errors/sentinel-errors';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { applicationId, rejectorName, rejectorId, reason } = body;

    if (!applicationId || !rejectorName || !rejectorId || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify user is admin or moderator
    const adminDoc = await adminDb.collection('admins').doc(uid).get();
    const modDoc = await adminDb.collection('moderators').doc(uid).get();

    if (!adminDoc.exists && !modDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const actorData = adminDoc.exists ? adminDoc.data() : modDoc.data();
    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: adminDoc.exists ? 'admin' : 'moderator',
        name: actorData?.fullName || actorData?.name || '',
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    // Get application
    const appRef = adminDb.collection('applications').doc(applicationId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    const appData = appDoc.data() as Application;

    // Allow rejection from any pre-activation live state. Once a student has been
    // activated (state already deleted, student doc created), rejection routes are
    // not the right tool — that's a delete-student flow.
    const REJECTABLE_STATES = new Set(['submitted', 'verified_upcoming', 'pending_seat_allocation']);
    if (!REJECTABLE_STATES.has(appData.state)) {
      return NextResponse.json({
        error: 'Application is not in a rejectable state'
      }, { status: 400 });
    }

    const formData = appData.formData;

    // Capture payment ID before the transaction — used for cleanup AFTER successful
    // deletion. Payment rejection is moved AFTER the Firestore transaction to prevent
    // partial-commit: if the transaction fails (application already consumed), the
    // payment is NOT rejected (application still exists, so the payment is still valid).
    const rejectPaymentId = (appData as any).paymentId || null;

    // ── Tier A: a rejection PERMANENTLY destroys the application. Delete it and
    //    write the audit record (who rejected, when, WHY, and a snapshot of WHAT
    //    was destroyed) in ONE transaction, so the action is always reconstructible
    //    and the document can never vanish without an audit trail. The state is
    //    re-read inside the transaction for idempotency (concurrent double-reject).
    let applicationDeleted = false;
    try {
      const destroyedSnapshot = {
        applicantUid: appData.applicantUid,
        enrollmentId: formData.enrollmentId || null,
        fullName: formData.fullName || null,
        email: formData.email || null,
        routeId: formData.routeId || null,
        stopId: formData.stopId || null,
        shift: formData.shift || null,
        applicationType: (appData as any).applicationType || null,
        targetSession: (appData as any).targetSession || null,
        paymentId: (appData as any).paymentId || null,
        amountPaid: formData.paymentInfo?.amountPaid ?? null,
      };
      await adminDb.runTransaction(async (transaction) => {
        const fresh = await transaction.get(appRef);
        if (!fresh.exists || !REJECTABLE_STATES.has((fresh.data() as Application).state)) {
          throw new ApplicationGoneError();
        }
        transaction.delete(appRef);
        createAuditLogInTransaction(transaction, {
          category: 'applications',
          action: 'application_rejected',
          summary: `Application rejected: ${formData.fullName || ''}`,
          severity: 'medium',
          performedBy: uid,
          performedByName: actorData?.fullName || actorData?.name || rejectorName,
          performedByRole: (adminDoc.exists ? 'admin' : 'moderator') as any,
          targetType: 'application',
          targetId: appData.applicantUid,
          targetName: formData.fullName || '',
          metadata: {
            reason,
            before: { applicationId, applicationState: 'submitted', ...destroyedSnapshot },
            after: { applicationState: 'deleted' },
            details: { applicationId, rejectorName, rejectorId },
          },
        });
      });
      applicationDeleted = true;
      console.log('✅ Deleted rejected applications document for:', applicationId);
    } catch (deleteError) {
      if (deleteError instanceof ApplicationGoneError) {
        return NextResponse.json({ error: 'Application already processed' }, { status: 409 });
      }
      console.error('❌ Could not delete applications doc:', deleteError);
      return NextResponse.json({ error: 'Failed to reject application' }, { status: 500 });
    }

    // ✅ CLEANUP: Remove pending payment record from Supabase — ONLY after the
    //    Firestore transaction succeeds (application was actually deleted). Prevents
    //    partial-commit: if the transaction failed, the application still exists and
    //    the payment remains valid for it.
    if (applicationDeleted && rejectPaymentId) {
      try {
        const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
        
        await paymentsSupabaseService.updatePaymentStatus(rejectPaymentId, 'Rejected', {
          userId: uid,
          name: actorData?.fullName || actorData?.name || rejectorName,
          empId: actorData?.employeeId || actorData?.staffId || '',
          role: adminDoc.exists ? 'Admin' : 'Moderator',
        });
      } catch (paymentCleanupError) {
        console.error('Failed to reject pending payment record:', paymentCleanupError);
      }
    }

    // Invariant 7: Delete assets ONLY after transaction commit succeeds
    if (formData.paymentInfo?.paymentEvidenceUrl) {
      const publicId = extractPublicId(formData.paymentInfo.paymentEvidenceUrl);
      if (publicId) {
        await deleteAsset(publicId).catch((err) => console.error('Failed to delete payment proof asset:', err));
        console.log(`✅ Deleted payment proof from Cloudinary post-commit: ${publicId}`);
      }
    }
    if (formData.profilePhotoUrl) {
      const publicId = extractPublicId(formData.profilePhotoUrl);
      if (publicId) {
        await deleteAsset(publicId).catch((err) => console.error('Failed to delete profile photo asset:', err));
        console.log(`✅ Deleted profile photo from Cloudinary post-commit: ${publicId}`);
      }
    }

    // ✅ EMAIL NOTIFICATION: Send rejection email to student
    if (formData.email) {
      await sendApplicationRejectedNotification({
        studentName: formData.fullName || 'Student',
        studentEmail: formData.email,
        reason: reason,
        rejectedBy: rejectorName || 'Administrator'
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Application rejected'
    });
  } catch (error: any) {
    console.error('Error rejecting application:', error);
    return NextResponse.json(
      { error: 'Failed to reject application' },
      { status: 500 }
    );
  }
}

