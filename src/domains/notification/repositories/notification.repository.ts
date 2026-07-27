/**
 * D10 Notification Repository
 *
 * Persistence + read-only queries for other domains' data.
 *
 * NOTIFICATION WRITES: All notification CRUD goes through PG repository
 * (notification.repository.pg.ts). Firestore is frozen for notifications.
 *
 * RECIPIENT RESOLUTION: Routes through Identity domain service API
 * (getUsersByRole, getAllUsers, getStudentsByShift, etc.) which read
 * from PostgreSQL. No direct Firestore access.
 *
 * PERMISSION CHECKERS: Pure functions, no persistence.
 *
 * VISIBILITY: Pure function, no persistence.
 */
import {
	getAllStudents,
	getAllUsers,
	getStudentsByBusIds,
	getStudentsByRouteIds,
	getStudentsByShift,
	getUsersByRole,
} from '@/domains/identity';
import type {
	NotificationSender,
	NotificationTarget,
	PermissionCheckResult,
	TargetType,
	UserRole,
	VisibilityCheckResult,
} from '@/lib/notifications/types';
import { normalizeShift } from '@/lib/utils/shift-utils';
import type {
	CreateNotificationInput,
	NotificationRecord,
} from './notification.repository.pg';
import {
	pgBulkDeleteNotifications,
	pgDeleteNotification,
	pgDeleteNotificationsByUser,
	pgFindExpiredNotifications,
	pgFindNotificationById,
	pgFindNotificationsByUser,
	pgInsertNotification,
	pgUpdateNotification,
} from './notification.repository.pg';

// ─── Permission Checkers (pure functions, no persistence) ────────────────────

export function canUserSend(
  senderRole: UserRole,
  targetType: TargetType,
  targetRole?: UserRole,
): PermissionCheckResult {
  switch (senderRole) {
    case 'admin':
      return { allowed: true };

    case 'moderator':
      if (targetRole === 'admin' && targetType !== 'all_users') {
        return {
          allowed: false,
          reason: 'Moderators cannot directly target admins (but admins will receive copy automatically)',
        };
      }
      return { allowed: true };

    case 'driver':
      if (targetType === 'all_users' || (targetRole && targetRole !== 'student')) {
        return {
          allowed: false,
          reason: 'Drivers can only send notifications to students',
        };
      }
      return { allowed: true };

    case 'student':
      return {
        allowed: false,
        reason: 'Students cannot send notifications',
      };

    default:
      return {
        allowed: false,
        reason: 'Invalid user role',
      };
  }
}

export function canUserEdit(
  userRole: UserRole,
  userId: string,
  senderId: string,
): PermissionCheckResult {
  if (userId !== senderId) {
    return {
      allowed: false,
      reason: 'You can only edit your own notifications',
    };
  }

  if (userRole === 'driver' || userRole === 'student') {
    return {
      allowed: false,
      reason: `${userRole}s cannot edit notifications`,
    };
  }

  return { allowed: true };
}

export function canUserDeleteGlobally(
  userRole: UserRole,
  userId: string,
  senderId: string,
): PermissionCheckResult {
  switch (userRole) {
    case 'admin':
      return { allowed: true };

    case 'moderator':
      if (userId !== senderId) {
        return {
          allowed: false,
          reason: 'Moderators can only delete their own notifications globally',
        };
      }
      return { allowed: true };

    case 'driver':
    case 'student':
      return {
        allowed: false,
        reason: `${userRole}s cannot delete notifications globally`,
      };

    default:
      return {
        allowed: false,
        reason: 'Invalid user role',
      };
  }
}

// ─── Recipient Resolution (reads other domains' Firestore collections) ───────

export async function getAutoInjectedRecipients(senderRole: UserRole): Promise<string[]> {
  const injectedUserIds: string[] = [];

  try {
    switch (senderRole) {
      case 'moderator': {
        const admins = await getUsersByRole('admin');
        admins.forEach(user => injectedUserIds.push(user.uid));
        break;
      }

      case 'driver': {
        const admins = await getUsersByRole('admin');
        const moderators = await getUsersByRole('moderator');
        admins.forEach(user => injectedUserIds.push(user.uid));
        moderators.forEach(user => injectedUserIds.push(user.uid));
        break;
      }
    }
  } catch (error) {
    console.error('Error getting auto-injected recipients:', error);
  }

  return injectedUserIds;
}

export async function resolveTargetRecipients(target: NotificationTarget): Promise<string[]> {
  const recipientIds: string[] = [];

  try {
    switch (target.type) {
      case 'all_users': {
        const allUsers = await getAllUsers();
        allUsers.forEach(user => recipientIds.push(user.uid));
        break;
      }

      case 'all_role': {
        if (target.roleFilter) {
          const roleUsers = await getUsersByRole(target.roleFilter as UserRole);
          roleUsers.forEach(user => recipientIds.push(user.uid));
        }
        break;
      }

      case 'shift_based': {
        if (target.shift) {
          const normalizedShift = normalizeShift(target.shift);
          if (normalizedShift === 'Both') {
            const allStudents = await getAllStudents();
            allStudents.forEach(doc => recipientIds.push(doc.id));
          } else {
            const students = await getStudentsByShift(normalizedShift);
            students.forEach(doc => recipientIds.push(doc.id));
          }
        }
        break;
      }

      case 'bus_based': {
        if (target.busIds && target.busIds.length > 0) {
          const students = await getStudentsByBusIds(target.busIds);
          students.forEach(doc => recipientIds.push(doc.id));
        }
        break;
      }

      case 'route_based': {
        if (target.routeIds && target.routeIds.length > 0) {
          const students = await getStudentsByRouteIds(target.routeIds);
          students.forEach(doc => recipientIds.push(doc.id));
        }
        break;
      }

      case 'specific_users': {
        if (target.specificUserIds) {
          recipientIds.push(...target.specificUserIds);
        }
        break;
      }
    }
  } catch (error) {
    console.error('Error resolving target recipients:', error);
  }

  return recipientIds;
}

// ─── Notification CRUD (delegates to PG repository) ─────────────────────────

export async function findById(id: string): Promise<NotificationRecord | null> {
  return pgFindNotificationById(id);
}

export async function findByUser(uid: string, limit?: number): Promise<NotificationRecord[]> {
  return pgFindNotificationsByUser(uid, limit);
}

export async function findExpired(): Promise<NotificationRecord[]> {
  return pgFindExpiredNotifications();
}

export async function insert(input: CreateNotificationInput): Promise<string> {
  return pgInsertNotification(input);
}

export async function update(id: string, input: Record<string, any>): Promise<void> {
  return pgUpdateNotification(id, input);
}

export async function remove(id: string): Promise<void> {
  return pgDeleteNotification(id);
}

export async function bulkDelete(ids: string[]): Promise<number> {
  return pgBulkDeleteNotifications(ids);
}

export async function deleteByUser(userId: string): Promise<number> {
  return pgDeleteNotificationsByUser(userId);
}

// ─── Visibility Check (pure function, no persistence) ───────────────────────

export function isNotificationVisibleToUser(
  notification: any,
  userId: string,
  userRole: UserRole,
  userRouteId: string | null = null,
): VisibilityCheckResult {
  if (notification.isDeletedGlobally) {
    return { visible: false, reason: 'Notification was deleted' };
  }

  if (notification.expiryAt) {
    let expiryMillis = 0;
    if (typeof notification.expiryAt === 'number') {
      expiryMillis = notification.expiryAt;
    } else if (typeof notification.expiryAt === 'string') {
      expiryMillis = new Date(notification.expiryAt).getTime();
    } else if (notification.expiryAt instanceof Date) {
      expiryMillis = notification.expiryAt.getTime();
    }
    if (expiryMillis > 0 && expiryMillis <= Date.now()) {
      return { visible: false, reason: 'Notification has expired' };
    }
  }

  if (userRole === 'admin' || userRole === 'moderator') {
    return { visible: true };
  }

  const isSender = notification.sender?.userId === userId;
  const isRenewalRequest = notification.title?.includes('New Renewal Request') ||
    notification.title?.includes('Renewal Request');

  if (isSender) {
    if (notification.sender?.userRole === 'student' && isRenewalRequest) {
      return { visible: false, reason: 'Student should not see their own renewal request' };
    }
    return { visible: true };
  }

  const isDirectRecipient = notification.recipientIds?.includes(userId);
  const isAutoInjected = notification.autoInjectedRecipientIds?.includes(userId);

  if (isDirectRecipient || isAutoInjected) {
    return { visible: true };
  }

  const target = notification.target;

  if (!target || typeof target !== 'object' || !target.type) {
    if (isDirectRecipient || isAutoInjected) {
      return { visible: true };
    }
    return { visible: false, reason: 'Invalid notification target' };
  }

  switch (target.type) {
    case 'all_users':
      return { visible: true };

    case 'all_role':
      if (target.roleFilter === (userRole as UserRole)) {
        return { visible: true };
      }
      break;

    case 'route_based':
      if (userRole === 'student' && userRouteId && target.routeIds?.includes(userRouteId)) {
        return { visible: true };
      }
      break;

    case 'specific_users':
      if (target.specificUserIds?.includes(userId)) {
        return { visible: true };
      }
      break;
  }

  return { visible: false, reason: 'User is not a recipient of this notification' };
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type {
	CreateNotificationInput,NotificationRecord
};

	export type {
		NotificationSender,NotificationTarget,PermissionCheckResult,TargetType,UserRole,VisibilityCheckResult
	};
