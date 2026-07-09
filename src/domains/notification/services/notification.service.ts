/**
 * D10 NotificationService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: notification CRUD, permission enforcement, recipient
 * resolution, visibility checks.
 *
 * ponytail: delegates entirely to existing production logic in
 * src/lib/notifications/NotificationService.ts (via notificationRepository) —
 * zero behavior change. FCM push dispatch, token management, and template
 * resolution stay internal to their respective modules, not part of the
 * domain's public capability surface.
 */
import * as notificationRepository from '../repositories/notification.repository';
import type {
  UserRole,
  TargetType,
  NotificationTarget,
  NotificationSender,
  PermissionCheckResult,
  VisibilityCheckResult,
} from '../repositories/notification.repository';

export function canUserSend(
  senderRole: UserRole,
  targetType: TargetType,
  targetRole?: UserRole,
): PermissionCheckResult {
  return notificationRepository.canUserSend(senderRole, targetType, targetRole);
}

export function canUserEdit(
  userRole: UserRole,
  userId: string,
  senderId: string,
): PermissionCheckResult {
  return notificationRepository.canUserEdit(userRole, userId, senderId);
}

export function canUserDeleteGlobally(
  userRole: UserRole,
  userId: string,
  senderId: string,
): PermissionCheckResult {
  return notificationRepository.canUserDeleteGlobally(userRole, userId, senderId);
}

export async function getAutoInjectedRecipients(senderRole: UserRole): Promise<string[]> {
  return notificationRepository.getAutoInjectedRecipients(senderRole);
}

export async function resolveTargetRecipients(target: NotificationTarget): Promise<string[]> {
  return notificationRepository.resolveTargetRecipients(target);
}

export async function createNotification(
  sender: NotificationSender,
  target: NotificationTarget,
  content: string,
  title: string,
  metadata?: any,
): Promise<string> {
  return notificationRepository.createNotification(sender, target, content, title, metadata);
}

export async function editNotification(
  userId: string,
  userRole: UserRole,
  notificationId: string,
  updates: { title?: string; content: string; metadata?: any },
): Promise<void> {
  return notificationRepository.editNotification(userId, userRole, notificationId, updates);
}

export async function deleteNotificationGlobally(
  userId: string,
  userRole: UserRole,
  notificationId: string,
): Promise<void> {
  return notificationRepository.deleteNotificationGlobally(userId, userRole, notificationId);
}

export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  return notificationRepository.markAsRead(userId, notificationId);
}

export function isNotificationVisibleToUser(
  notification: any,
  userId: string,
  userRole: UserRole,
  userRouteId?: string | null,
): VisibilityCheckResult {
  return notificationRepository.isNotificationVisibleToUser(notification, userId, userRole, userRouteId);
}

export type {
  UserRole,
  TargetType,
  NotificationTarget,
  NotificationSender,
  PermissionCheckResult,
  VisibilityCheckResult,
};
