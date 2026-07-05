import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { adminDb } from '@/lib/firebase-admin';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { deriveCreationCategorisation } from '@/lib/utils/application-eligibility';
import { checkBusCapacity } from '@/lib/busCapacityService';
import { SubmitApplicationSchema } from '@/lib/security/validation-schemas';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      if (!adminDb) {
        return NextResponse.json({ error: 'Database not available' }, { status: 500 });
      }

      const uid = auth.uid;
      const email = auth.email;
      const rawFormData = { ...asRecord((body as any).formData) };
      if ('age' in rawFormData) {
        delete rawFormData.age;
      }

      if (Object.keys(rawFormData).length === 0) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      const paymentInfo = asRecord(rawFormData.paymentInfo);
      const sessionInfo = asRecord(rawFormData.sessionInfo);
      const isOnlinePayment = paymentInfo.paymentMode === 'online';
      const now = new Date().toISOString();

      // Server-side duplicate-submission guard
      const existingAppSnap = await adminDb.collection('applications').doc(uid).get();
      if (existingAppSnap.exists) {
        const existingState = asString(existingAppSnap.data()?.state);
        const LIVE_STATES = [
          'submitted', 'approved', 'verified', 'awaiting_verification',
          'verified_upcoming', 'pending_seat_allocation',
        ];
        if (LIVE_STATES.includes(existingState)) {
          return NextResponse.json(
            {
              error: 'An application is already in progress',
              message: 'You already have an active application. You cannot submit another until it is resolved.',
              state: existingState,
            },
            { status: 409 }
          );
        }
      }

      const paymentId = isOnlinePayment ? asString(paymentInfo.razorpayPaymentId) : '';
      const amountPaid = Number(paymentInfo.amountPaid || 0);

      const deadlineConfig = await getDeadlineConfig();
      const categorisation = deriveCreationCategorisation(
        Number(sessionInfo.sessionStartYear || new Date().getFullYear()),
        Number(sessionInfo.sessionEndYear || (Number(sessionInfo.sessionStartYear || new Date().getFullYear()) + 1)),
        deadlineConfig,
        now
      );

      let serverNeedsCapacityReview = false;
      const submitBusId = asString(rawFormData.busId) || asString(rawFormData.busAssigned);
      if (submitBusId) {
        try {
          const capacityInfo = await checkBusCapacity(submitBusId);
          serverNeedsCapacityReview = !capacityInfo.available;
        } catch {
          // If bus not found or capacity check fails, default to no alert
        }
      }

      let assignedDriverId = '';
      let assignedDriverName = '';
      if (submitBusId) {
        try {
          const driversSnap = await adminDb.collection('drivers').where('assignedBusId', '==', submitBusId).get();
          if (!driversSnap.empty) {
            const drivers = driversSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const studentShift = (asString(rawFormData.shift) || '').toLowerCase();
            
            let matchedDriver = drivers.find((d: any) => (d.shift || '').toLowerCase().includes(studentShift));
            if (!matchedDriver) {
              matchedDriver = drivers.find((d: any) => (d.shift || '').toLowerCase().includes('both'));
            }
            if (!matchedDriver) {
              matchedDriver = drivers[0];
            }

            if (matchedDriver) {
              assignedDriverId = matchedDriver.id;
              assignedDriverName = matchedDriver.fullName || matchedDriver.name || '';
            }
          }
        } catch (err) {
          console.error('Error fetching driver for submission:', err);
        }
      }

      const applicationData = {
        applicationId: uid,
        applicantUid: uid,
        email: email || asString(rawFormData.email),
        state: 'submitted',
        formData: { ...rawFormData, paymentId },
        paymentId,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
        verifiedBy: isOnlinePayment ? 'system_online_payment' : 'system_offline_submission_bypass',
        verifiedAt: now,
        needsCapacityReview: serverNeedsCapacityReview,
        applicationType: categorisation.applicationType,
        targetSession: categorisation.targetSession,
        eligibleApproval: categorisation.eligibleApproval,
        assignedDriverId,
        assignedDriverName,
      };

      await adminDb.collection('applications').doc(uid).set(applicationData);

      if (serverNeedsCapacityReview) {
        try {
          const [adminsSnapshot, modsSnapshot] = await Promise.all([
            adminDb.collection('admins').get(),
            adminDb.collection('moderators').get(),
          ]);

          const recipientIds = [
            ...adminsSnapshot.docs.map(doc => doc.id),
            ...modsSnapshot.docs.map(doc => doc.id),
          ];

          if (recipientIds.length > 0) {
            const batch = adminDb.batch();

            recipientIds.forEach(recipientId => {
              const notifRef = adminDb.collection('notifications').doc();
              batch.set(notifRef, {
                title: 'Bus Capacity Alert - Overloaded Bus Request',
                content: `A new application from ${asString(rawFormData.fullName)} (${asString(rawFormData.enrollmentId)}) needs review because the selected bus (${asString(rawFormData.busAssigned) || asString(rawFormData.busId)}) is at full capacity.`,
                type: 'alert',
                sender: {
                  userId: 'system',
                  userName: 'System',
                  userRole: 'admin'
                },
                target: {
                  type: 'specific_users',
                  specificUserIds: [recipientId]
                },
                recipientIds: [recipientId],
                autoInjectedRecipientIds: [],
                readByUserIds: [],
                isEdited: false,
                isDeletedGlobally: false,
                hiddenForUserIds: [],
                createdAt: now,
                metadata: {
                  applicationId: uid,
                  routeId: asString(rawFormData.routeId)
                }
              });
            });

            await batch.commit();
          }
        } catch (notificationError) {
          console.error('Failed to send capacity notifications:', notificationError);
        }
      }

      return NextResponse.json({
        success: true,
        applicationId: uid,
        message: 'Application submitted successfully and waiting for approval',
      });
    } catch (error) {
      console.error('Failed to submit application:', error);
      return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
    }
  },
  {
    requiredRoles: [],
    schema: SubmitApplicationSchema,
  }
);
