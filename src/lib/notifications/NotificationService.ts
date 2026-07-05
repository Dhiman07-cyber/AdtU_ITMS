/**
 * Core Notification Service
 * Handles all notification operations with role-based permissions
 */

import {
  Firestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  UserRole,
  TargetType,
  NotificationTarget,
  NotificationSender,
  PermissionCheckResult,
  VisibilityCheckResult
} from './types';
import { normalizeShift } from '@/lib/utils/shift-utils';

export class NotificationService {
  private db: Firestore;

  constructor(database?: Firestore) {
    this.db = database || db;
  }

  // ==================== Permission Checkers ====================

  /**
   * Check if a user can send notifications based on their role
   */
  canUserSend(senderRole: UserRole, targetType: TargetType, targetRole?: UserRole): PermissionCheckResult {
    switch (senderRole) {
      case 'admin':
        // Admin can send to everyone
        return { allowed: true };

      case 'moderator':
        // Moderator can send to everyone except Admin (unless explicitly included)
        if (targetRole === 'admin' && targetType !== 'all_users') {
          return {
            allowed: false,
            reason: 'Moderators cannot directly target admins (but admins will receive copy automatically)'
          };
        }
        return { allowed: true };

      case 'driver':
        // Driver can only send to students
        if (targetType === 'all_users' || (targetRole && targetRole !== 'student')) {
          return {
            allowed: false,
            reason: 'Drivers can only send notifications to students'
          };
        }
        return { allowed: true };

      case 'student':
        // Students cannot send any notifications
        return {
          allowed: false,
          reason: 'Students cannot send notifications'
        };

      default:
        return {
          allowed: false,
          reason: 'Invalid user role'
        };
    }
  }

  /**
   * Check if a user can edit a notification
   */
  canUserEdit(userRole: UserRole, userId: string, senderId: string): PermissionCheckResult {
    // Only sender can edit their own notifications
    if (userId !== senderId) {
      return {
        allowed: false,
        reason: 'You can only edit your own notifications'
      };
    }

    // Drivers and students cannot edit
    if (userRole === 'driver' || userRole === 'student') {
      return {
        allowed: false,
        reason: `${userRole}s cannot edit notifications`
      };
    }

    return { allowed: true };
  }

  /**
   * Check if a user can delete a notification globally
   */
  canUserDeleteGlobally(userRole: UserRole, userId: string, senderId: string): PermissionCheckResult {
    switch (userRole) {
      case 'admin':
        // Admin can delete any notification globally
        return { allowed: true };

      case 'moderator':
        // Moderator can only delete their own notifications globally
        if (userId !== senderId) {
          return {
            allowed: false,
            reason: 'Moderators can only delete their own notifications globally'
          };
        }
        return { allowed: true };

      case 'driver':
      case 'student':
        // Drivers and students cannot delete globally
        return {
          allowed: false,
          reason: `${userRole}s cannot delete notifications globally`
        };

      default:
        return {
          allowed: false,
          reason: 'Invalid user role'
        };
    }
  }

  // ==================== Recipient Resolvers ====================

  /**
   * Auto-inject recipients based on sender role
   */
  async getAutoInjectedRecipients(senderRole: UserRole): Promise<string[]> {
    const injectedUserIds: string[] = [];

    try {
      switch (senderRole) {
        case 'moderator':
          // When moderator sends, admin also receives
          const adminsQuery = query(
            collection(this.db, 'users'),
            where('role', '==', 'admin')
          );
          const adminDocs = await getDocs(adminsQuery);
          adminDocs.forEach(doc => injectedUserIds.push(doc.id));
          break;

        case 'driver':
          // When driver sends, admin and all moderators receive
          const staffQuery = query(
            collection(this.db, 'users'),
            where('role', 'in', ['admin', 'moderator'])
          );
          const staffDocs = await getDocs(staffQuery);
          staffDocs.forEach(doc => injectedUserIds.push(doc.id));
          break;
      }
    } catch (error) {
      console.error('Error getting auto-injected recipients:', error);
    }

    return injectedUserIds;
  }

  /**
   * Resolve target recipients based on notification target
   */
  async resolveTargetRecipients(target: NotificationTarget): Promise<string[]> {
    const recipientIds: string[] = [];

    try {
      switch (target.type) {
        case 'all_users':
          // Get all users
          const allUsersQuery = query(collection(this.db, 'users'));
          const allUsersDocs = await getDocs(allUsersQuery);
          allUsersDocs.forEach(doc => recipientIds.push(doc.id));
          break;

        case 'all_role':
          // Get all users of specific role
          if (target.roleFilter) {
            const roleQuery = query(
              collection(this.db, 'users'),
              where('role', '==', target.roleFilter)
            );
            const roleDocs = await getDocs(roleQuery);
            roleDocs.forEach(doc => recipientIds.push(doc.id));
          }
          break;

        case 'shift_based':
          // Get students in specific shift using canonical shift-utils
          if (target.shift) {
            const normalizedShift = normalizeShift(target.shift);
            const shiftQuery = normalizedShift === 'Both'
              ? query(collection(this.db, 'students'))
              : query(collection(this.db, 'students'), where('shift', '==', normalizedShift));
            const shiftDocs = await getDocs(shiftQuery);
            shiftDocs.forEach(doc => recipientIds.push(doc.id));
          }
          break;

        case 'bus_based':
          // Get students on specific buses
          if (target.busIds && target.busIds.length > 0) {
            const busQuery = query(
              collection(this.db, 'students'),
              where('busId', 'in', target.busIds)
            );
            const busDocs = await getDocs(busQuery);
            busDocs.forEach(doc => recipientIds.push(doc.id));
          }
          break;

        case 'route_based':
          // Get all students on specific routes
          if (target.routeIds && target.routeIds.length > 0) {
            const routeQuery = query(
              collection(this.db, 'students'),
              where('routeId', 'in', target.routeIds)
            );
            const routeDocs = await getDocs(routeQuery);
            routeDocs.forEach(doc => recipientIds.push(doc.id));
          }
          break;

        case 'specific_users':
          // Use specified user IDs
          if (target.specificUserIds) {
            recipientIds.push(...target.specificUserIds);
          }
          break;
      }
    } catch (error) {
      console.error('Error resolving target recipients:', error);
    }

    return recipientIds;
  }

  // ==================== CRUD Operations ====================

  /**
   * Create a new notification
   */
  async createNotification(
    sender: NotificationSender,
    target: NotificationTarget,
    content: string,
    title: string,
    metadata: any = {}
  ): Promise<string> {
    // Check permissions
    const canSend = this.canUserSend(sender.userRole, target.type, target.roleFilter);
    if (!canSend.allowed) {
      throw new Error(canSend.reason || 'Permission denied');
    }

    // Resolve recipients
    const targetRecipients = await this.resolveTargetRecipients(target);
    const autoInjectedRecipients = await this.getAutoInjectedRecipients(sender.userRole);

    // Combine all recipients (remove duplicates)
    const allRecipientIds = [...new Set([...targetRecipients, ...autoInjectedRecipients])];

    // Clean sender object - remove undefined values (Firestore doesn't allow them)
    const cleanSender: NotificationSender = {
      userId: sender.userId,
      userName: sender.userName,
      userRole: sender.userRole,
      ...(sender.employeeId !== undefined && { employeeId: sender.employeeId })
    };

    // Clean target object - remove undefined values
    const cleanTarget: NotificationTarget = {
      type: target.type,
      ...(target.roleFilter !== undefined && { roleFilter: target.roleFilter }),
      ...(target.routeIds !== undefined && { routeIds: target.routeIds }),
      ...(target.specificUserIds !== undefined && { specificUserIds: target.specificUserIds })
    };

    // Create notification document
    const notificationData = {
      title,
      content,
      sender: cleanSender,
      target: cleanTarget,
      recipientIds: allRecipientIds,
      autoInjectedRecipientIds: autoInjectedRecipients,
      createdAt: serverTimestamp(),
      isEdited: false,
      isDeletedGlobally: false,
      hiddenForUserIds: [], // Added to satisfy Firestore rules
      readByUserIds: [cleanSender.userId],
      metadata: {
        ...metadata,
        messageId: doc(collection(this.db, 'notifications')).id
      }
    };

    // Save to Firestore
    const docRef = await addDoc(collection(this.db, 'notifications'), notificationData);

    console.log(`✅ Notification created: ${docRef.id}`);
    return docRef.id;
  }

  /**
   * Edit a notification
   */
  async editNotification(
    userId: string,
    userRole: UserRole,
    notificationId: string,
    updates: {
      title?: string;
      content: string;
      metadata?: any;
    }
  ): Promise<void> {
    // Get the notification
    const notificationRef = doc(this.db, 'notifications', notificationId);
    const notificationDoc = await getDoc(notificationRef);

    if (!notificationDoc.exists()) {
      throw new Error('Notification not found');
    }

    const notificationData = notificationDoc.data();

    // Check permissions
    const canEdit = this.canUserEdit(userRole, userId, notificationData.sender.userId);
    if (!canEdit.allowed) {
      throw new Error(canEdit.reason || 'Permission denied');
    }

    // Update notification
    await updateDoc(notificationRef, {
      content: updates.content,
      ...(updates.title && { title: updates.title }),
      ...(updates.metadata && { metadata: updates.metadata }),
      isEdited: true,
      updatedAt: serverTimestamp(),
      // Reset read status so it appears as new for everyone
      readByUserIds: [userId], // Keep it read for the editor
      editHistory: arrayUnion({
        editedAt: new Date(),
        previousContent: notificationData.content,
        editedBy: userId
      })
    });

    console.log(`✅ Notification edited and reset to unread: ${notificationId}`);
  }

  /**
   * Delete a notification globally (for everyone)
   */
  async deleteNotificationGlobally(
    userId: string,
    userRole: UserRole,
    notificationId: string
  ): Promise<void> {
    // Get the notification
    const notificationRef = doc(this.db, 'notifications', notificationId);
    const notificationDoc = await getDoc(notificationRef);

    if (!notificationDoc.exists()) {
      throw new Error('Notification not found');
    }

    const notificationData = notificationDoc.data();

    // Check permissions
    const canDelete = this.canUserDeleteGlobally(userRole, userId, notificationData.sender.userId);
    if (!canDelete.allowed) {
      throw new Error(canDelete.reason || 'Permission denied');
    }

    // Mark as globally deleted (don't actually delete, just mark)
    await updateDoc(notificationRef, {
      isDeletedGlobally: true,
      deletedByUserId: userId,
      deletedAt: serverTimestamp(),
      content: 'This message was deleted.',
      title: 'Deleted Message'
    });

    console.log(`✅ Notification globally deleted: ${notificationId}`);
  }


  /**
   * Mark notification as read by a user
   */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const notificationRef = doc(this.db, 'notifications', notificationId);

    // Add user to readByUserIds array
    await updateDoc(notificationRef, {
      readByUserIds: arrayUnion(userId)
    });

    console.log(`✅ Notification marked as read: ${notificationId} - ${userId}`);
  }

  /**
   * Check if a notification is visible to a specific user
   */
  isNotificationVisibleToUser(
    notification: any,
    userId: string,
    userRole: UserRole,
    userRouteId: string | null = null
  ): VisibilityCheckResult {
    // Check if notification is deleted globally
    if (notification.isDeletedGlobally) {
      return { visible: false, reason: 'Notification was deleted' };
    }

    // Check if notification has expired
    if (notification.expiryAt) {
      let expiryMillis = 0;
      if (typeof notification.expiryAt.toMillis === 'function') {
        expiryMillis = notification.expiryAt.toMillis();
      } else if (typeof notification.expiryAt === 'number') {
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

    // ADMIN/MODERATOR VISIBILITY (Global Access)
    // Admins and Moderators can see ALL notifications for auditing purposes
    if (userRole === 'admin' || userRole === 'moderator') {
      return { visible: true };
    }

    // Check if user is the sender
    const isSender = notification.sender?.userId === userId;

    // Special case: Students should NOT see their own renewal request submissions
    // They will receive a separate notification when admin/moderator approves/rejects
    const isRenewalRequest = notification.title?.includes('New Renewal Request') ||
      notification.title?.includes('Renewal Request');

    if (isSender) {
      // If sender is student and it's a renewal request, don't show to them
      if (notification.sender?.userRole === 'student' && isRenewalRequest) {
        return { visible: false, reason: 'Student should not see their own renewal request' };
      }
      // Other senders (admin, moderator, driver) can see their own notifications
      return { visible: true };
    }

    // Check if user is direct recipient (from auto-injection or targeting)
    const isDirectRecipient = notification.recipientIds?.includes(userId);
    const isAutoInjected = notification.autoInjectedRecipientIds?.includes(userId);

    if (isDirectRecipient || isAutoInjected) {
      return { visible: true };
    }

    // Check target-based visibility
    const target = notification.target;

    // Handle missing or invalid target (backwards compatibility for old notifications)
    if (!target || typeof target !== 'object' || !target.type) {
      // If user is in recipientIds but target is missing, show it (legacy notifications)
      if (isDirectRecipient || isAutoInjected) {
        return { visible: true };
      }

      // For students/drivers, hide malformed notifications
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
}

// Export singleton instance
export const notificationService = new NotificationService();
