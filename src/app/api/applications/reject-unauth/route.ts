import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { v2 as cloudinary } from 'cloudinary';
import { sendApplicationRejectedNotification } from '@/lib/services/admin-email.service';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditLogInTransaction } from '@/lib/services/audit.service';
import { Application } from '@/lib/types/application';
import { ApplicationGoneError } from '@/lib/errors/sentinel-errors';

// Configure Cloudinary
if (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET && process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const moderatorUid = decodedToken.uid;
    const moderatorEmail = decodedToken.email;

    const body = await request.json();
    const { studentUid } = body;
    const reason = body.reason || "Application rejected by moderator";

    if (!studentUid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify user is admin or moderator
    const moderatorDoc = await adminDb.collection('moderators').doc(moderatorUid).get();
    const adminDoc = await adminDb.collection('admins').doc(moderatorUid).get();

    if (!moderatorDoc.exists && !adminDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const moderatorData = moderatorDoc.exists ? moderatorDoc.data() : adminDoc.data();
    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: moderatorEmail || '',
        role: adminDoc.exists ? 'admin' : 'moderator',
        name: moderatorData?.fullName || moderatorData?.name || '',
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    // Get application data
    const applicationRef = adminDb.collection('applications').doc(studentUid);
    const applicationDoc = await applicationRef.get();

    if (!applicationDoc.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    const appData = applicationDoc.data() as Application;
    const formData = appData.formData;
    const now = new Date().toISOString();

    // Allow rejection from any pre-activation live state.
    const REJECTABLE_STATES = new Set(['submitted', 'verified_upcoming', 'pending_seat_allocation']);
    if (!REJECTABLE_STATES.has(appData.state)) {
      return NextResponse.json({
        error: 'Application is not in a rejectable state'
      }, { status: 400 });
    }

    // Capture payment ID and Cloudinary URLs before the transaction — used for cleanup AFTER
    // successful deletion. Payment/Cloudinary cleanup is moved AFTER the Firestore transaction
    // to prevent partial-commit: if the transaction fails (application already processed),
    // photos and payment are NOT deleted (application still exists).
    const rejectPaymentId = (appData as any).paymentId || null;
    const paymentEvidenceUrl = formData.paymentInfo?.paymentEvidenceUrl || null;
    const profilePhotoUrl = formData.profilePhotoUrl || null;

    // ✅ CLEANUP: Delete from applications collection after rejection (in transaction with audit)
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
        const fresh = await transaction.get(applicationRef);
        if (!fresh.exists || !REJECTABLE_STATES.has((fresh.data() as Application).state)) {
          throw new ApplicationGoneError();
        }
        transaction.delete(applicationRef);
        createAuditLogInTransaction(transaction, {
          category: 'applications',
          action: 'application_rejected',
          summary: `Application rejected: ${formData.fullName || ''}`,
          severity: 'medium',
          performedBy: moderatorUid,
          performedByName: moderatorData?.fullName || moderatorData?.name || 'Moderator',
          performedByRole: (adminDoc.exists ? 'admin' : 'moderator') as any,
          targetType: 'application',
          targetId: appData.applicantUid,
          targetName: formData.fullName || '',
          metadata: {
            reason,
            before: { applicationId: studentUid, applicationState: 'submitted', ...destroyedSnapshot },
            after: { applicationState: 'deleted' },
            details: { applicationId: studentUid, rejectorName: moderatorData?.fullName || moderatorData?.name || 'Moderator', rejectorId: moderatorUid, channel: 'unauthenticated' },
          },
        });
      });
      applicationDeleted = true;
      console.log('✅ Deleted rejected applications document for:', studentUid);

      // Cloudinary cleanup AFTER transaction — photos are safe to delete only
      // once we know the application is actually gone.
      if (paymentEvidenceUrl && cloudinary.config().api_key) {
        try {
          const publicId = extractPublicIdFromUrl(paymentEvidenceUrl);
          if (publicId) {
            await cloudinary.uploader.destroy(publicId);
            console.log(`✅ Deleted payment proof from Cloudinary: ${publicId}`);
          }
        } catch (cloudinaryError) {
          console.error('⚠️ Error deleting payment proof from Cloudinary:', cloudinaryError);
        }
      }
      if (profilePhotoUrl && cloudinary.config().api_key) {
        try {
          const publicId = extractPublicIdFromUrl(profilePhotoUrl);
          if (publicId) {
            await cloudinary.uploader.destroy(publicId);
            console.log(`✅ Deleted profile photo from Cloudinary: ${publicId}`);
          }
        } catch (cloudinaryError) {
          console.error('⚠️ Error deleting profile photo from Cloudinary:', cloudinaryError);
        }
      }
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
          userId: moderatorUid,
          name: moderatorData?.fullName || moderatorData?.name || 'Moderator',
          empId: moderatorData?.employeeId || moderatorData?.staffId || '',
          role: adminDoc.exists ? 'Admin' : 'Moderator',
        });
      } catch (paymentError) {
        console.error('Failed to reject pending payment record:', paymentError);
      }
    }

    // ✅ EMAIL NOTIFICATION: Send rejection email to student
    if (formData.email) {
      console.log(`📧 Notification: Queuing rejection email for application ${studentUid.substring(0, 8)}...`);
      const emailResult = await sendApplicationRejectedNotification({
        studentName: formData.fullName || 'Student',
        studentEmail: formData.email,
        reason: reason,
        rejectedBy: moderatorData?.name || moderatorData?.fullName || 'Moderator'
      });
      console.log('📧 Notification result:', emailResult);
    } else {
      console.warn('⚠️ Notification: No email found in formData, skipping rejection email.');
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

function extractPublicIdFromUrl(url: string): string | null {
  try {
    // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{version}/{public_id}.{format}
    const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    return matches ? matches[1] : null;
  } catch (error) {
    return null;
  }
}
