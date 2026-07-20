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
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getValidFcmTokensForUsers } from '@/domains/identity';
import { UserRole, TargetType, NotificationType } from '@/lib/notifications/types';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { NotificationCreateSchema } from '@/lib/security/validation-schemas';
import { z } from 'zod';
import { getAllStudents, getAllDrivers, getUsersByRole, getStudentsByBusIds, getStudentsByRouteIds, getStudentsByShift } from '@/domains/identity';

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
  const recipientIds: string[] = [];

  switch (targetType) {
    case 'all_users': {
      const promises = [
        getUsersByRole('moderator'),
        getAllDrivers(),
        getAllStudents(),
      ];
      if (senderRole === 'admin') {
        promises.push(getUsersByRole('admin'));
      }
      const results = await Promise.all(promises);
      results.forEach(items => {
        items.forEach((item: any) => recipientIds.push(item.uid));
      });
      break;
    }

    case 'all_role': {
      if (sendToAllRoles) {
        const [drivers, students] = await Promise.all([
          getAllDrivers(),
          getAllStudents(),
        ]);
        drivers.forEach(d => recipientIds.push(d.uid));
        students.forEach(s => recipientIds.push(s.uid));
      } else if (targetRole) {
        const users = await getUsersByRole(targetRole);
        users.forEach(u => recipientIds.push(u.uid));
      }
      break;
    }

    case 'shift_based': {
      if (targetShift) {
        if (targetShift === 'both') {
          const [students, drivers] = await Promise.all([
            getAllStudents(),
            getAllDrivers(),
          ]);
          students.forEach(s => recipientIds.push(s.uid));
          drivers.forEach(d => recipientIds.push(d.uid));
        } else {
          const shiftValue = targetShift.charAt(0).toUpperCase() + targetShift.slice(1);
          const [students, drivers] = await Promise.all([
            getStudentsByShift(shiftValue),
            getAllDrivers(),
          ]);
          students.forEach(s => recipientIds.push(s.uid));
          drivers.forEach(d => {
            const driverShift = (d.shift || d.assignedShift || '').toLowerCase();
            if (driverShift === targetShift || driverShift === 'both') {
              recipientIds.push(d.uid);
            }
          });
        }
      }
      break;
    }

    case 'bus_based': {
      if (targetBusIds && targetBusIds.length > 0) {
        const students = await getStudentsByBusIds(targetBusIds);
        for (const student of students) {
          if (targetShift && targetShift !== 'both') {
            const shiftVal = targetShift.charAt(0).toUpperCase() + targetShift.slice(1);
            if (student.shift !== shiftVal) continue;
          }
          if (!recipientIds.includes(student.uid)) recipientIds.push(student.uid);
        }
      }
      break;
    }

    case 'route_based': {
      if (targetRouteIds && targetRouteIds.length > 0) {
        const [students, drivers] = await Promise.all([
          getStudentsByRouteIds(targetRouteIds),
          getAllDrivers(),
        ]);
        for (const student of students) {
          if (targetShift && targetShift !== 'both') {
            const shiftVal = targetShift.charAt(0).toUpperCase() + targetShift.slice(1);
            if (student.shift !== shiftVal) continue;
          }
          if (!recipientIds.includes(student.uid)) recipientIds.push(student.uid);
        }
        for (const driver of drivers) {
          if (targetRouteIds.includes(driver.routeId) || targetRouteIds.includes(driver.assignedRouteId)) {
            recipientIds.push(driver.uid);
          }
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

// ─── Auto-injection: Admin/Moderators always receive a copy ──────────────────

async function getAutoInjectedRecipients(
  senderRole: UserRole,
  existingRecipients: string[]
): Promise<string[]> {
  const injected: string[] = [];

  try {
    if (senderRole === 'moderator' || senderRole === 'driver') {
      const admins = await getUsersByRole('admin');
      admins.forEach(a => {
        if (!existingRecipients.includes(a.uid) && !injected.includes(a.uid)) {
          injected.push(a.uid);
        }
      });
    }

    if (senderRole === 'driver') {
      const moderators = await getUsersByRole('moderator');
      moderators.forEach(m => {
        if (!existingRecipients.includes(m.uid) && !injected.includes(m.uid)) {
          injected.push(m.uid);
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
  if (!adminMessaging) {
    return { sent: 0, failed: 0 };
  }

  try {
    // Get FCM tokens from PostgreSQL
    const tokenRecords = await getValidFcmTokensForUsers(recipientIds);
    const fcmTokens = tokenRecords.map(t => t.token);

    if (fcmTokens.length === 0) {
      console.log('No FCM tokens found for notification recipients');
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
        console.error('FCM batch send error:', err);
        totalFailed += chunk.length;
      }
    }

    console.log(`FCM: ${totalSent} sent, ${totalFailed} failed (${fcmTokens.length} tokens)`);
    return { sent: totalSent, failed: totalFailed };
  } catch (error) {
    console.error('Error sending FCM notifications:', error);
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

      const notificationData = {
        title: title.trim(),
        content: content.trim(),
        type: type as NotificationType,
        sender: sender as any,
        target: target as any,
        recipientIds: allRecipientIds,
        readByUserIds: [auth.uid],
        hiddenForUserIds: [],
        expiresAt: (expiryAt && typeof expiryAt === 'number')
          ? new Date(expiryAt).toISOString()
          : undefined,
        metadata: {
          ...(((target as Record<string, any>).roleFilter) && { roleFilter: (target as Record<string, any>).roleFilter }),
          ...(((target as Record<string, any>).shift) && { shift: (target as Record<string, any>).shift }),
          ...(((target as Record<string, any>).busIds) && { busIds: (target as Record<string, any>).busIds }),
          ...(((target as Record<string, any>).routeIds) && { routeIds: (target as Record<string, any>).routeIds }),
        } as Record<string, any> | undefined,
      };

      const createdId = await pgInsertNotification(notificationData);

      // 11. Send FCM push notifications (non-blocking)
      const fcmResult = await sendFCMNotifications(
        allRecipientIds,
        title.trim(),
        content.trim(),
        createdId
      );

      return NextResponse.json({
        success: true,
        notificationId: createdId,
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
