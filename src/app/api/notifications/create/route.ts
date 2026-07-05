/**
 * POST /api/notifications/create
 * 
 * Create a notification and save it to the `notifications` collection.
 * Accepts the payload shape from NotificationFormV2 and resolves recipients
 * based on target type. Also sends FCM push notifications.
 * 
 * Payload:
 *  - type: NotificationType (notice, pickup, dropoff, etc.)
 *  - title: string
 *  - content: string
 *  - targetType: TargetType (all_users, all_role, shift_based, bus_based, route_based, specific_users)
 *  - targetRole?: UserRole
 *  - targetShift?: 'morning' | 'evening' | 'both'
 *  - targetBusIds?: string[]
 *  - targetRouteIds?: string[]
 *  - targetUserIds?: string[]
 *  - expiryAt?: number (timestamp ms)
 *  - sendToAllRoles?: boolean (for dropoff)
 *  - metadata?: any
 */

import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { adminDb, adminMessaging } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { UserRole, TargetType, NotificationType } from '@/lib/notifications/types';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { NotificationCreateSchema } from '@/lib/security/validation-schemas';
import { z } from 'zod';

// ─── Recipient Resolution ────────────────────────────────────────────────────

async function resolveRecipientIds(
  targetType: TargetType,
  targetRole?: UserRole,
  targetShift?: string,
  targetBusIds?: string[],
  targetRouteIds?: string[],
  targetUserIds?: string[],
  sendToAllRoles?: boolean,
  senderRole?: UserRole
): Promise<string[]> {
  if (!adminDb) throw new Error('Firebase Admin not initialized');

  const recipientIds: string[] = [];

  switch (targetType) {
    case 'all_users': {
      // Get all users from all role collections
      const promises: Promise<FirebaseFirestore.QuerySnapshot>[] = [
        adminDb.collection('moderators').get(),
        adminDb.collection('drivers').get(),
        adminDb.collection('students').get(),
      ];
      
      // Only include admins if the sender is an admin
      if (senderRole === 'admin') {
        promises.push(adminDb.collection('admins').get());
      }
      
      const snapshots = await Promise.all(promises);
      snapshots.forEach(snapshot => {
        snapshot.docs.forEach(d => recipientIds.push(d.id));
      });
      break;
    }

    case 'all_role': {
      if (sendToAllRoles) {
        // For dropoff "all" target: both students and drivers
        const [drivers, students] = await Promise.all([
          adminDb.collection('drivers').get(),
          adminDb.collection('students').get(),
        ]);
        drivers.docs.forEach(d => recipientIds.push(d.id));
        students.docs.forEach(d => recipientIds.push(d.id));
      } else if (targetRole) {
        const colName = getCollectionForRole(targetRole);
        const snapshot = await adminDb.collection(colName).get();
        snapshot.docs.forEach(d => recipientIds.push(d.id));
      }
      break;
    }

    case 'shift_based': {
      if (targetShift) {
        let studentsQuery: FirebaseFirestore.Query = adminDb.collection('students');
        if (targetShift !== 'both') {
          const shiftValue = targetShift.charAt(0).toUpperCase() + targetShift.slice(1); // 'Morning' or 'Evening'
          studentsQuery = studentsQuery.where('shift', '==', shiftValue);
        }
        const snapshot = await studentsQuery.get();
        snapshot.docs.forEach(d => recipientIds.push(d.id));

        // Also include drivers assigned to matching shifts
        let driversQuery: FirebaseFirestore.Query = adminDb.collection('drivers');
        if (targetShift !== 'both') {
          const shiftValue = targetShift.charAt(0).toUpperCase() + targetShift.slice(1);
          // Drivers may have shift field -- try to include them
          const driverSnap = await driversQuery.get();
          driverSnap.docs.forEach(d => {
            const data = d.data();
            const driverShift = (data.shift || data.assignedShift || '').toLowerCase();
            if (driverShift === targetShift || driverShift === 'both') {
              recipientIds.push(d.id);
            }
          });
        } else {
          const driverSnap = await driversQuery.get();
          driverSnap.docs.forEach(d => recipientIds.push(d.id));
        }
      }
      break;
    }

    case 'bus_based': {
      if (targetBusIds && targetBusIds.length > 0) {
        // Firestore 'in' limited to 30 values
        for (let i = 0; i < targetBusIds.length; i += 30) {
          const chunk = targetBusIds.slice(i, i + 30);
          
          let q1: FirebaseFirestore.Query = adminDb.collection('students').where('busId', 'in', chunk);
          let q2: FirebaseFirestore.Query = adminDb.collection('students').where('assignedBusId', 'in', chunk);
          
          if (targetShift && targetShift !== 'both') {
            const shiftVal = targetShift.charAt(0).toUpperCase() + targetShift.slice(1);
            q1 = q1.where('shift', '==', shiftVal);
            q2 = q2.where('shift', '==', shiftVal);
          }

          const snapshot = await q1.get();
          snapshot.docs.forEach(d => recipientIds.push(d.id));

          // Also check assignedBusId
          const snapshot2 = await q2.get();
          snapshot2.docs.forEach(d => {
            if (!recipientIds.includes(d.id)) recipientIds.push(d.id);
          });
        }
      }
      break;
    }

    case 'route_based': {
      if (targetRouteIds && targetRouteIds.length > 0) {
        for (let i = 0; i < targetRouteIds.length; i += 30) {
          const chunk = targetRouteIds.slice(i, i + 30);
          
          let q1: FirebaseFirestore.Query = adminDb.collection('students').where('routeId', 'in', chunk);
          let q2: FirebaseFirestore.Query = adminDb.collection('students').where('assignedRouteId', 'in', chunk);
          
          if (targetShift && targetShift !== 'both') {
            const shiftVal = targetShift.charAt(0).toUpperCase() + targetShift.slice(1);
            q1 = q1.where('shift', '==', shiftVal);
            q2 = q2.where('shift', '==', shiftVal);
          }
          
          // 1. Get students on these routes
          const studentSnapshots = await Promise.all([
            q1.get(),
            q2.get()
          ]);
          studentSnapshots.forEach(s => s.docs.forEach(d => recipientIds.push(d.id)));

          // 2. Get drivers on these routes (Crucial for cross-communication)
          const driverSnapshots = await Promise.all([
            adminDb.collection('drivers').where('routeId', 'in', chunk).get(),
            adminDb.collection('drivers').where('assignedRouteId', 'in', chunk).get()
          ]);
          driverSnapshots.forEach(s => s.docs.forEach(d => recipientIds.push(d.id)));
        }
      }
      break;
    }

    case 'specific_users': {
      if (targetUserIds && targetUserIds.length > 0) {
        recipientIds.push(...targetUserIds);
      }
      break;
    }
  }

  // Deduplicate
  return [...new Set(recipientIds)];
}

function getCollectionForRole(role: UserRole): string {
  switch (role) {
    case 'admin': return 'admins';
    case 'moderator': return 'moderators';
    case 'driver': return 'drivers';
    case 'student': return 'students';
    default: return 'users';
  }
}

// ─── Auto-injection: Admin/Moderators always receive a copy ──────────────────

async function getAutoInjectedRecipients(
  senderRole: UserRole,
  existingRecipients: string[]
): Promise<string[]> {
  if (!adminDb) return [];
  const injected: string[] = [];

  try {
    if (senderRole === 'moderator' || senderRole === 'driver') {
      // Admin always gets a copy (unless moderator or driver sent it specifically to admin, 
      // which we handled in resolveRecipientIds for moderator)
      const admins = await adminDb.collection('admins').get();
      admins.docs.forEach(d => {
        if (!existingRecipients.includes(d.id) && !injected.includes(d.id)) {
          injected.push(d.id);
        }
      });
    }

    if (senderRole === 'driver') {
      // All moderators also get a copy
      const moderators = await adminDb.collection('moderators').get();
      moderators.docs.forEach(d => {
        if (!existingRecipients.includes(d.id) && !injected.includes(d.id)) {
          injected.push(d.id);
        }
      });
    }
  } catch (error) {
    console.error('Error getting auto-injected recipients:', error);
  }

  return injected;
}

// ─── FCM Push Notification ───────────────────────────────────────────────────

async function sendFCMNotifications(
  recipientIds: string[],
  title: string,
  content: string,
  notificationId: string
): Promise<{ sent: number; failed: number }> {
  if (!adminDb || !adminMessaging) {
    return { sent: 0, failed: 0 };
  }

  try {
    // Collect FCM tokens for all recipients from canonical subcollection
    const fcmTokens: string[] = [];

    // Read from students/{id}/tokens subcollection (canonical)
    for (const uid of recipientIds) {
      try {
        const studentDoc = await adminDb.collection('students').doc(uid).get();
        if (!studentDoc.exists) continue;
        
        const tokensSnapshot = await studentDoc.ref.collection('tokens')
          .where('valid', '==', true)
          .limit(3)
          .get();
        
        tokensSnapshot.docs.forEach(doc => {
          const token = doc.data().token;
          if (token && typeof token === 'string' && token.length > 10 && !fcmTokens.includes(token)) {
            fcmTokens.push(token);
          }
        });
      } catch {
        // Non-critical — skip
      }
    }

    if (fcmTokens.length === 0) {
      console.log('📱 No FCM tokens found for notification recipients');
      return { sent: 0, failed: 0 };
    }

    // Strip HTML from content for push body
    const rawText = content.replace(/<[^>]+>/g, '').trim();
    const bodyText = rawText.substring(0, 120) + (rawText.length > 120 ? '...' : '');

    const payload = {
      notification: { title, body: bodyText || 'You have a new notification' },
      data: {
        type: 'broadcast_notification',
        notificationId,
      },
    };

    let totalSent = 0;
    let totalFailed = 0;

    // FCM multicast limited to 500 tokens per call
    const BATCH = 500;
    for (let i = 0; i < fcmTokens.length; i += BATCH) {
      const chunk = fcmTokens.slice(i, i + BATCH);
      try {
        const result = await adminMessaging.sendEachForMulticast({
          ...payload,
          tokens: chunk,
        });
        totalSent += result.successCount;
        totalFailed += result.failureCount;
      } catch (err) {
        console.error('❌ FCM batch send error:', err);
        totalFailed += chunk.length;
      }
    }

    console.log(`📱 FCM: ${totalSent} sent, ${totalFailed} failed (${fcmTokens.length} tokens)`);
    return { sent: totalSent, failed: totalFailed };
  } catch (error) {
    console.error('❌ Error sending FCM notifications:', error);
    return { sent: 0, failed: 0 };
  }
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      if (!adminDb) {
        return NextResponse.json(
          { success: false, error: 'Server configuration error' },
          { status: 500 }
        );
      }

      const {
        type = 'notice',
        title,
        content,
        targetType = 'all_users',
        targetRole,
        targetShift,
        targetBusIds,
        targetRouteIds,
        targetUserIds,
        expiryAt,
        sendToAllRoles,
      } = body as z.infer<typeof NotificationCreateSchema>;

      // 4. Permission check
      const senderRole = auth.role as UserRole;
      if (senderRole === 'driver') {
        if (targetType === 'all_users') {
          return NextResponse.json(
            { success: false, error: 'Drivers can only send to students' },
            { status: 403 }
          );
        }
        if (targetType === 'all_role' && targetRole && targetRole !== 'student') {
          return NextResponse.json(
            { success: false, error: 'Drivers can only send to students' },
            { status: 403 }
          );
        }
      }

      // 5. Resolve recipients
      const directRecipientIds = await resolveRecipientIds(
        targetType as TargetType,
        targetRole as UserRole | undefined,
        targetShift,
        targetBusIds,
        targetRouteIds,
        targetUserIds,
        sendToAllRoles,
        senderRole
      );

      // 6. Auto-inject higher-ups
      const autoInjectedIds = await getAutoInjectedRecipients(senderRole, directRecipientIds);

      const filteredDirectRecipientIds = directRecipientIds.filter(id => id !== auth.uid);
      const filteredAutoInjectedIds = autoInjectedIds.filter(id => id !== auth.uid);
      const allRecipientIds = [...new Set([...filteredDirectRecipientIds, ...filteredAutoInjectedIds])];

      if (allRecipientIds.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No recipients found for this target' },
          { status: 400 }
        );
      }

      // 7. Build notification target object
      const target: Record<string, any> = { type: targetType };
      if (targetRole) target.roleFilter = targetRole;
      if (targetShift) target.shift = targetShift;
      if (targetBusIds && targetBusIds.length > 0) target.busIds = targetBusIds;
      if (targetRouteIds && targetRouteIds.length > 0) target.routeIds = targetRouteIds;
      if (targetUserIds && targetUserIds.length > 0) target.specificUserIds = targetUserIds;

      const sender: Record<string, any> = {
        userId: auth.uid,
        userName: auth.name || 'Staff',
        userRole: senderRole,
      };

      const notificationData: Record<string, any> = {
        title: title.trim(),
        content: content.trim(),
        type: type as NotificationType,
        sender,
        target,
        recipientIds: allRecipientIds,
        readByUserIds: [auth.uid],
        hiddenForUserIds: [],
        isEdited: false,
        isDeletedGlobally: false,
        createdAt: FieldValue.serverTimestamp(),
      };

      if (expiryAt && typeof expiryAt === 'number') {
        notificationData.expiryAt = Timestamp.fromMillis(expiryAt);
      }

      const docRef = await adminDb.collection('notifications').add(notificationData);

      // 11. Send FCM push notifications (non-blocking)
      const fcmResult = await sendFCMNotifications(
        allRecipientIds,
        title.trim(),
        content.trim(),
        docRef.id
      );

      return NextResponse.json({
        success: true,
        notificationId: docRef.id,
        recipientCount: filteredDirectRecipientIds.length,
        autoInjectedCount: filteredAutoInjectedIds.length,
        fcm: fcmResult,
      }, { status: 200 });

    } catch (error: any) {
      console.error('Error creating notification:', error);
      return NextResponse.json(
        { success: false, error: safeErrorMessage(error, 'Failed to create notification') },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator', 'driver'],
    schema: NotificationCreateSchema,
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  }
);
