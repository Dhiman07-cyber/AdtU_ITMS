/**
 * D10 NotificationService — domain service with business logic.
 *
 * Responsibilities:
 *   - Permission enforcement (canUserSend, canUserEdit, canUserDeleteGlobally)
 *   - Notification CRUD (create, edit, markAsRead, deleteGlobally)
 *   - Recipient computation (resolution + auto-injection)
 *   - Visibility checks
 *
 * Persistence: delegates to notification.repository.ts → PG repository.
 * FCM push dispatch stays internal to API routes, not a domain capability.
 */
import type {
	NotificationRecord,
	NotificationSender,
	NotificationTarget,
	PermissionCheckResult,
	TargetType,
	UserRole,
	VisibilityCheckResult,
} from '../repositories/notification.repository';
import * as notificationRepository from '../repositories/notification.repository';

// ─── Permission Checkers (pure functions, delegated) ─────────────────────────

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

// ─── Recipient Resolution (delegated) ───────────────────────────────────────

export async function getAutoInjectedRecipients(senderRole: UserRole): Promise<string[]> {
  return notificationRepository.getAutoInjectedRecipients(senderRole);
}

export async function resolveTargetRecipients(target: NotificationTarget): Promise<string[]> {
  return notificationRepository.resolveTargetRecipients(target);
}

// ─── CRUD Operations (business logic + PG persistence) ──────────────────────

/**
 * Create a new notification.
 *
 * Business logic:
 * 1. Permission check
 * 2. Resolve target recipients
 * 3. Auto-inject higher-ups
 * 4. Combine and deduplicate recipient lists
 * 5. Insert into PG
 */
export async function createNotification(
  sender: NotificationSender,
  target: NotificationTarget,
  content: string,
  title: string,
  metadata: any = {},
): Promise<string> {
  // 1. Permission check
  const canSend = notificationRepository.canUserSend(sender.userRole, target.type, target.roleFilter);
  if (!canSend.allowed) {
    throw new Error(canSend.reason || 'Permission denied');
  }

  // 2. Resolve recipients
  const targetRecipients = await notificationRepository.resolveTargetRecipients(target);
  const autoInjectedRecipients = await notificationRepository.getAutoInjectedRecipients(sender.userRole);

  // 3. Combine (deduplicated)
  const allRecipientIds = [...new Set([...targetRecipients, ...autoInjectedRecipients])];

  // 4. Insert into PG
  const id = await notificationRepository.insert({
    title,
    content,
    type: 'notice',
    sender,
    target,
    recipientIds: allRecipientIds,
    autoInjectedRecipientIds: autoInjectedRecipients,
    readByUserIds: [sender.userId],
    hiddenForUserIds: [],
    metadata,
  });

  console.log(`✅ Notification created: ${id}`);
  return id;
}

/**
 * Edit a notification.
 *
 * Business logic:
 * 1. Fetch notification from PG
 * 2. Permission check (canUserEdit)
 * 3. Construct edit history entry
 * 4. Reset readByUserIds to [editor]
 * 5. Update PG with composed fields
 */
export async function editNotification(
  userId: string,
  userRole: UserRole,
  notificationId: string,
  updates: { title?: string; content: string; metadata?: any },
): Promise<void> {
  // 1. Fetch
  const notification = await notificationRepository.findById(notificationId);
  if (!notification) {
    throw new Error('Notification not found');
  }

  // 2. Permission check
  const canEdit = notificationRepository.canUserEdit(userRole, userId, notification.sender.userId);
  if (!canEdit.allowed) {
    throw new Error(canEdit.reason || 'Permission denied');
  }

  // 3. Build edit history entry (business logic)
  const editEntry = {
    editedAt: new Date().toISOString(),
    previousContent: notification.content,
    editedBy: userId,
  };

  const updatedHistory = [...(notification.editHistory || []), editEntry];

  // 4. Update PG with composed fields (repository writes exactly what it's told)
  await notificationRepository.update(notificationId, {
    content: updates.content,
    ...(updates.title !== undefined && { title: updates.title }),
    ...(updates.metadata !== undefined && { metadata: updates.metadata }),
    isEdited: true,
    readByUserIds: [userId],
    editHistory: updatedHistory,
  });

  console.log(`✅ Notification edited: ${notificationId}`);
}

/**
 * Delete a notification globally (soft delete).
 *
 * Business logic:
 * 1. Fetch notification
 * 2. Permission check (canUserDeleteGlobally)
 * 3. Compose soft-delete fields
 * 4. Update PG
 */
export async function deleteNotificationGlobally(
  userId: string,
  userRole: UserRole,
  notificationId: string,
): Promise<void> {
  // 1. Fetch
  const notification = await notificationRepository.findById(notificationId);
  if (!notification) {
    throw new Error('Notification not found');
  }

  // 2. Permission check
  const canDelete = notificationRepository.canUserDeleteGlobally(userRole, userId, notification.sender.userId);
  if (!canDelete.allowed) {
    throw new Error(canDelete.reason || 'Permission denied');
  }

  // 3. Update PG with soft-delete fields (business rules: what title/content to use)
  await notificationRepository.update(notificationId, {
    isDeletedGlobally: true,
    deletedByUserId: userId,
    deletedAt: new Date().toISOString(),
    content: 'This message was deleted.',
    title: 'Deleted Message',
  });

  console.log(`✅ Notification globally deleted: ${notificationId}`);
}

/**
 * Mark notification as read by a user.
 *
 * Business logic:
 * 1. Idempotency check (if already read, no-op)
 * 2. Compose new readByUserIds array
 * 3. Update PG
 */
export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  // 1. Fetch current state
  const notification = await notificationRepository.findById(notificationId);
  if (!notification) {
    throw new Error('Notification not found');
  }

  // 2. Idempotency: already read
  if (notification.readByUserIds?.includes(userId)) {
    return;
  }

  // 3. Compose new array (business logic: append, not merge)
  const newReadByUserIds = [...(notification.readByUserIds || []), userId];

  // 4. Update PG
  await notificationRepository.update(notificationId, {
    readByUserIds: newReadByUserIds,
  });

  console.log(`✅ Notification marked as read: ${notificationId} - ${userId}`);
}

// ─── Visibility (pure function, delegated) ───────────────────────────────────

export function isNotificationVisibleToUser(
  notification: any,
  userId: string,
  userRole: UserRole,
  userRouteId?: string | null,
): VisibilityCheckResult {
  return notificationRepository.isNotificationVisibleToUser(
    notification, userId, userRole, userRouteId ?? null,
  );
}

// ─── Read Operations (service layer → repository) ────────────────────────────

/**
 * Find notifications for a user.
 * Returns NotificationRecord[] from PG — recipient OR sender.
 */
export async function findByUser(
  uid: string,
  limit: number = 50,
): Promise<NotificationRecord[]> {
  return notificationRepository.findByUser(uid, limit);
}

/**
 * Find a notification by ID. Returns null if not found.
 */
export async function findById(
  id: string,
): Promise<NotificationRecord | null> {
  return notificationRepository.findById(id);
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type {
	NotificationRecord,NotificationSender,NotificationTarget,PermissionCheckResult,TargetType,UserRole,VisibilityCheckResult
};
