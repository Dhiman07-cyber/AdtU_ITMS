import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { v2 as cloudinary } from 'cloudinary';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditLogInTransaction } from '@/lib/services/audit.service';

/** Thrown inside the rejection transaction when the request was already consumed (duplicate / retry). */
class RequestGoneError extends Error {}

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
    const uid = decodedToken.uid;

    const body = await request.json();
    const { requestId, rejectorName, rejectorId, reason } = body;

    if (!requestId || !rejectorName || !rejectorId || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify user is admin or moderator
    const adminDoc = await adminDb.collection('admins').doc(uid).get();
    const modDoc = await adminDb.collection('moderators').doc(uid).get();

    if (!adminDoc.exists && !modDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const rejectorData = adminDoc.exists ? adminDoc.data() : modDoc.data();
    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: adminDoc.exists ? 'admin' : 'moderator',
        name: rejectorData?.fullName || rejectorData?.name || '',
      },
      'payments',
      'canRejectOfflinePayment'
    );
    if (permissionDenied) return permissionDenied;

    // Get renewal request
    const requestRef = adminDb.collection('renewal_requests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return NextResponse.json({ error: 'Renewal request not found' }, { status: 404 });
    }

    const requestData = requestDoc.data();

    // Validate status - must be pending
    if (requestData?.status !== 'pending') {
      return NextResponse.json({
        error: 'Renewal request must be pending'
      }, { status: 400 });
    }

    const studentId = requestData?.studentId;
    const durationYears = requestData?.durationYears;

    if (!studentId) {
      return NextResponse.json({ error: 'Student ID not found in request' }, { status: 400 });
    }

    console.log('\n🚫 REJECTING RENEWAL REQUEST');
    console.log('Request ID:', requestId);
    console.log('Student ID:', studentId);
    console.log('Reason:', reason);

    // Fetch student email if not in request (read-only, safe before transaction)
    let studentEmail = requestData?.studentEmail;
    if (!studentEmail && studentId) {
      try {
        const studentDoc = await adminDb.collection('students').doc(studentId).get();
        if (studentDoc.exists) {
          studentEmail = studentDoc.data()?.email;
        } else {
          // Try searching by enrollmentId if studentId didn't work (fallback)
          const enrollmentId = requestData?.enrollmentId;
          if (enrollmentId) {
            const studentsQuery = await adminDb.collection('students').where('enrollmentId', '==', enrollmentId).limit(1).get();
            if (!studentsQuery.empty) {
              studentEmail = studentsQuery.docs[0].data()?.email;
            }
          }
        }
      } catch (err) {
        console.error('Error fetching student email:', err);
      }
    }

    // ── Tier A: a rejection PERMANENTLY destroys the renewal request. Delete it
    //    and write the audit (who/when/WHY/snapshot of WHAT) in ONE transaction,
    //    re-reading status inside for idempotency (concurrent double-reject).
    //    Payment update and email are sent ONLY after this transaction succeeds
    //    to prevent partial-commit where student is notified of a rejection
    //    that never actually happened.
    try {
      const destroyedSnapshot = {
        studentId,
        enrollmentId: requestData?.enrollmentId || null,
        studentName: requestData?.studentName || null,
        durationYears: durationYears ?? null,
        totalFee: requestData?.totalFee ?? null,
        paymentMode: requestData?.paymentMode || null,
        paymentId: requestData?.paymentId || null,
      };
      await adminDb.runTransaction(async (transaction) => {
        const fresh = await transaction.get(requestRef);
        if (!fresh.exists || fresh.data()?.status !== 'pending') {
          throw new RequestGoneError();
        }
        transaction.delete(requestRef);
        createAuditLogInTransaction(transaction, {
          category: 'renewals',
          action: 'renewal_request_rejected',
          summary: `Renewal request rejected: ${requestData?.studentName || ''}`,
          severity: 'medium',
          performedBy: uid,
          performedByName: rejectorData?.fullName || rejectorData?.name || rejectorName,
          performedByRole: (adminDoc.exists ? 'admin' : 'moderator') as any,
          targetType: 'renewal_request',
          targetId: studentId,
          targetName: requestData?.studentName || '',
          metadata: {
            reason,
            before: { requestId, requestStatus: 'pending', ...destroyedSnapshot },
            after: { requestStatus: 'deleted' },
            details: { requestId, rejectorName, rejectorId },
          },
        });
      });
      console.log('✅ Renewal request document deleted');
    } catch (deleteError) {
      if (deleteError instanceof RequestGoneError) {
        return NextResponse.json({ error: 'Renewal request already processed' }, { status: 409 });
      }
      console.error('❌ Failed to delete renewal request:', deleteError);
      return NextResponse.json({ error: 'Failed to reject renewal request' }, { status: 500 });
    }

    // ── Post-commit: payment update + email + Cloudinary cleanup.
    //    These are non-critical side effects that run ONLY after the transaction
    //    guarantees the renewal request was actually deleted.

    // Update payment status to Rejected (post-commit, non-critical)
    if (requestData?.paymentId) {
      try {
        const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
        await paymentsSupabaseService.updatePaymentStatus(requestData.paymentId, 'Rejected', {
          userId: uid,
          name: rejectorData?.fullName || rejectorData?.name || rejectorName,
          empId: rejectorData?.employeeId || rejectorData?.staffId || '',
          role: adminDoc.exists ? 'Admin' : 'Moderator',
        });
      } catch (paymentError) {
        console.error('Failed to reject pending renewal payment (non-critical):', paymentError);
      }
    }

    // Send Rejection Email (post-commit, non-critical)
    if (studentEmail) {
      try {
        const { sendApplicationRejectedNotification } = await import('@/lib/services/admin-email.service');

        console.log(`📧 Notification: Queuing renewal rejection email for request ${requestId}`);

        await sendApplicationRejectedNotification({
          studentName: requestData?.studentName || 'Student',
          studentEmail: studentEmail,
          reason: reason,
          rejectedBy: rejectorName || 'Administrator'
        });

        console.log(`📧 Rejection email sent for request ${requestId}`);
      } catch (emailError) {
        console.error('❌ Failed to send rejection email:', emailError);
        // Non-critical: rejection is already committed
      }
    } else {
      console.warn('⚠️ Student email not found. Notification skipped.');
    }

    // Invariant 7: Delete assets ONLY after transaction commit succeeds
    const receiptImageUrl = requestData?.receiptImageUrl;
    if (receiptImageUrl && cloudinary.config().api_key) {
      try {
        console.log('\n🗑️ DELETING PAYMENT PROOF FROM CLOUDINARY POST-COMMIT');
        const url = new URL(receiptImageUrl);
        const pathParts = url.pathname.split('/');
        const uploadIndex = pathParts.findIndex(part => part === 'upload');
        if (uploadIndex !== -1) {
          const afterUpload = pathParts.slice(uploadIndex + 1);
          const fileName = afterUpload[afterUpload.length - 1];
          if (fileName) {
            const publicIdParts = afterUpload.filter(part => !part.startsWith('v') || isNaN(Number(part.substring(1))));
            const lastPart = publicIdParts[publicIdParts.length - 1];
            const nameWithoutExtension = lastPart.split('.').slice(0, -1).join('.');
            publicIdParts[publicIdParts.length - 1] = nameWithoutExtension;
            const publicId = publicIdParts.join('/');
            await cloudinary.uploader.destroy(publicId);
            console.log(`✅ Deleted payment proof from Cloudinary post-commit: ${publicId}`);
          }
        }
      } catch (cloudinaryError) {
        console.error('⚠️ Error deleting payment proof from Cloudinary post-commit:', cloudinaryError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Renewal request rejected successfully'
    });

  } catch (error: any) {
    console.error('Error rejecting renewal request:', error);
    return NextResponse.json(
      { error: 'Failed to reject renewal request' },
      { status: 500 }
    );
  }
}
