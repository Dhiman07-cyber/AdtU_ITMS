/**
 * D10 Notification Repository
 *
 * Persistence only — no business logic. Wraps the existing
 * NotificationService singleton which handles Firestore CRUD,
 * permission checks, recipient resolution, and visibility logic.
 *
 * ponytail: src/lib/notifications/NotificationService.ts already implements
 * the complete notification lifecycle — wrapped by reference, not reimplemented.
 * FCM push notification dispatch (fcm-notification-service.ts) stays internal
 * as it is an implementation detail used by API routes, not a domain capability.
 */
import { notificationService } from '@/lib/notifications/NotificationService';
import type {
  UserRole,
  TargetType,
  NotificationTarget,
  NotificationSender,
  PermissionCheckResult,
  VisibilityCheckResult,
} from '@/lib/notifications/types';

export function canUserSend(
  senderRole: UserRole,
  targetType: TargetType,
  targetRole?: UserRole,
): PermissionCheckResult {
  return notificationService.canUserSend(senderRole, targetType, targetRole);
}

export function canUserEdit(
  userRole: UserRole,
  userId: string,
  senderId: string,
): PermissionCheckResult {
  return notificationService.canUserEdit(userRole, userId, senderId);
}

export function canUserDeleteGlobally(
  userRole: UserRole,
  userId: string,
  senderId: string,
): PermissionCheckResult {
  return notificationService.canUserDeleteGlobally(userRole, userId, senderId);
}

export async function getAutoInjectedRecipients(senderRole: UserRole): Promise<string[]> {
  return notificationService.getAutoInjectedRecipients(senderRole);
}

export async function resolveTargetRecipients(target: NotificationTarget): Promise<string[]> {
  return notificationService.resolveTargetRecipients(target);
}

export async function createNotification(
  sender: NotificationSender,
  target: NotificationTarget,
  content: string,
  title: string,
  metadata?: any,
): Promise<string> {
  return notificationService.createNotification(sender, target, content, title, metadata);
}

export async function editNotification(
  userId: string,
  userRole: UserRole,
  notificationId: string,
  updates: { title?: string; content: string; metadata?: any },
): Promise<void> {
  return notificationService.editNotification(userId, userRole, notificationId, updates);
}

export async function deleteNotificationGlobally(
  userId: string,
  userRole: UserRole,
  notificationId: string,
): Promise<void> {
  return notificationService.deleteNotificationGlobally(userId, userRole, notificationId);
}

export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  return notificationService.markAsRead(userId, notificationId);
}

export function isNotificationVisibleToUser(
  notification: any,
  userId: string,
  userRole: UserRole,
  userRouteId?: string | null,
): VisibilityCheckResult {
  return notificationService.isNotificationVisibleToUser(notification, userId, userRole, userRouteId);
}

export type {
  UserRole,
  TargetType,
  NotificationTarget,
  NotificationSender,
  PermissionCheckResult,
  VisibilityCheckResult,
};
