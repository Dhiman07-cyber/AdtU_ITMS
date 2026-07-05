import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { Application, AuditLogEntry } from '@/lib/types/application';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { deriveCreationCategorisation } from '@/lib/utils/application-eligibility';

/** Thrown inside the submit transaction when the application is no longer in a submittable state (concurrent submit / retry). */
class NotSubmittableError extends Error {}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { applicationId } = body;

    if (!applicationId) {
      return NextResponse.json({ error: 'Application ID required' }, { status: 400 });
    }

    // Get application
    const appRef = adminDb.collection('applications').doc(applicationId);
    const appDoc = await appRef.get();

    if (!appDoc.exists) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    const appData = appDoc.data() as Application;

    if (appData.applicantUid !== uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Validate state - must be verified
    if (appData.state !== 'verified') {
      return NextResponse.json({ 
        error: 'Application must be verified before submission' 
      }, { status: 400 });
    }

    // Re-validate required fields server-side
    const formData = appData.formData;
    if (!formData.fullName || !formData.phoneNumber || !formData.enrollmentId ||
        !formData.department || !formData.semester || !formData.routeId || !formData.stopId ||
        !formData.paymentInfo.paymentEvidenceProvided || !formData.declarationAccepted) {
      return NextResponse.json({ 
        error: 'Incomplete application data' 
      }, { status: 400 });
    }

    // Submit application
    const submittedAt = new Date().toISOString();
    const auditEntry: AuditLogEntry = {
      actorId: uid,
      actorRole: 'student',
      action: 'application_submitted',
      timestamp: submittedAt,
      notes: 'Application submitted for admin/moderator review'
    };

    // Phase 2: categorise (fresh vs future) and freeze eligibleApproval from the
    // chosen session. Renewal applications are categorised by the renewal flow,
    // not this fresh-application submission path.
    const deadlineConfig = await getDeadlineConfig();
    const categorisation = deriveCreationCategorisation(
      Number(formData.sessionInfo?.sessionStartYear || new Date().getFullYear()),
      Number(formData.sessionInfo?.sessionEndYear || (Number(formData.sessionInfo?.sessionStartYear || new Date().getFullYear()) + 1)),
      deadlineConfig,
      submittedAt
    );

    // Atomic verified → submitted transition. The state is RE-READ inside the
    // transaction and the flip only succeeds from 'verified', so two concurrent
    // submits (double-click / browser refresh) can never both pass — exactly one
    // wins and proceeds to payment + notifications; the loser gets 409. This closes
    // the former time-of-check/time-of-use window between the read and the update.
    try {
      await adminDb.runTransaction(async (transaction) => {
        const fresh = await transaction.get(appRef);
        if (!fresh.exists || (fresh.data() as Application).state !== 'verified') {
          throw new NotSubmittableError();
        }
        const freshData = fresh.data() as Application;
        transaction.update(appRef, {
          state: 'submitted',
          submittedAt,
          submittedBy: uid,
          updatedAt: submittedAt,
          applicationType: categorisation.applicationType,
          targetSession: categorisation.targetSession,
          eligibleApproval: categorisation.eligibleApproval,
          stateHistory: [...(freshData.stateHistory || []), { state: 'submitted', timestamp: submittedAt, actor: uid }],
          auditLogs: [...(freshData.auditLogs || []), auditEntry]
        });
      });
    } catch (txErr) {
      if (txErr instanceof NotSubmittableError) {
        return NextResponse.json({ error: 'Application already submitted' }, { status: 409 });
      }
      throw txErr;
    }

    // OFFLINE PAYMENT: No Supabase payment row is created at submission time.
    // Financial ledger records are created ONLY after admin/moderator verification
    // and approval. The student's submitted payment details (transaction reference,
    // paid date/time, receipt) are stored in the application's formData for review.

    // Notify all admins and moderators — non-blocking: notification failure
    // must NOT fail the submission (the application is already committed).
    try {
      const adminsQuery = await adminDb.collection('admins').get();
      const moderatorsQuery = await adminDb.collection('moderators').get();

      const notificationPromises = [];

      // Notify admins
      for (const adminDoc of adminsQuery.docs) {
        const notifRef = adminDb.collection('notifications').doc();
        notificationPromises.push(
          notifRef.set({
            title: 'New Application Submitted',
            content: `${formData.fullName} (${formData.enrollmentId}) has submitted a new bus service application.`,
            type: 'info',
            sender: {
              userId: uid,
              userName: formData.fullName || 'Student',
              userRole: 'student'
            },
            target: {
              type: 'specific_users',
              specificUserIds: [adminDoc.id]
            },
            recipientIds: [adminDoc.id],
            autoInjectedRecipientIds: [],
            readByUserIds: [],
            isEdited: false,
            isDeletedGlobally: false,
            hiddenForUserIds: [],
            createdAt: submittedAt,
            metadata: {
              applicationId,
              reviewPage: `/admin/applications/${applicationId}`
            }
          }).catch(err => console.warn('Failed to notify admin:', err))
        );
      }

      // Notify moderators
      for (const modDoc of moderatorsQuery.docs) {
        const notifRef = adminDb.collection('notifications').doc();
        notificationPromises.push(
          notifRef.set({
            title: 'New Application Submitted',
            content: `${formData.fullName} (${formData.enrollmentId}) has submitted a new bus service application.`,
            type: 'info',
            sender: {
              userId: uid,
              userName: formData.fullName || 'Student',
              userRole: 'student'
            },
            target: {
              type: 'specific_users',
              specificUserIds: [modDoc.id]
            },
            recipientIds: [modDoc.id],
            autoInjectedRecipientIds: [],
            readByUserIds: [],
            isEdited: false,
            isDeletedGlobally: false,
            hiddenForUserIds: [],
            createdAt: submittedAt,
            metadata: {
              applicationId,
              reviewPage: `/moderator/applications/${applicationId}`
            }
          }).catch(err => console.warn('Failed to notify moderator:', err))
        );
      }

      await Promise.allSettled(notificationPromises);

      // Send confirmation to student
      const studentNotifRef = adminDb.collection('notifications').doc();
      await studentNotifRef.set({
        title: 'Application Submitted',
        content: 'Your bus service application has been submitted successfully. You will be notified once it is reviewed.',
        type: 'info',
        sender: {
          userId: 'system',
          userName: 'System',
          userRole: 'admin'
        },
        target: {
          type: 'specific_users',
          specificUserIds: [uid]
        },
        recipientIds: [uid],
        autoInjectedRecipientIds: [],
        readByUserIds: [],
        isEdited: false,
        isDeletedGlobally: false,
        hiddenForUserIds: [],
        createdAt: submittedAt,
        metadata: {
          applicationId,
          statusPage: `/apply/status/${applicationId}`
        }
      }).catch(err => console.warn('Failed to notify student of submission:', err));
    } catch (notifErr) {
      console.warn('Non-critical: notification batch failed after application submit:', notifErr);
    }

    return NextResponse.json({
      success: true,
      applicationId,
      message: 'Application submitted successfully'
    });
  } catch (error: any) {
    console.error('Error submitting application:', error);
    return NextResponse.json(
      { error: 'Failed to submit application' },
      { status: 500 }
    );
  }
}

