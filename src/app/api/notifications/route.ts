/**
 * GET /api/notifications
 *
 * Returns the current user's notifications from PostgreSQL.
 * Replaces the Firestore onSnapshot / getDocs read in NotificationContext.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import * as Notification from '@/domains/notification';

const NOTIFICATION_LIMIT = 50;

export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const uid = auth.uid;
      const userRole = auth.role as string;

      // Parse optional query params
      const url = new URL(request.url);
      const limitParam = parseInt(url.searchParams.get('limit') || String(NOTIFICATION_LIMIT), 10);
      const limit = Math.min(Math.max(limitParam, 1), 100);

      const records = await Notification.findByUser(uid, limit);

      // Process into UserNotificationView[] (server-side, same logic as old processNotifications)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const userRouteId = (auth as any).routeId || (auth as any).assignedRouteId || null;

      let unreadCount = 0;
      const notifications = records
        .filter(n => {
          // 30-day window
          const createdAt = new Date(n.createdAt);
          if (createdAt < thirtyDaysAgo) return false;

          // Visibility check
          try {
            const vis = Notification.isNotificationVisibleToUser(n, uid, userRole as any, userRouteId);
            return vis.visible;
          } catch {
            return false;
          }
        })
        .map(n => {
          const isSender = n.sender?.userId === uid;
          const isRead = n.readByUserIds?.includes(uid) || false;

          const canEdit = n.sender?.userId !== 'system' &&
            (userRole === 'admin' || userRole === 'moderator')
            ? n.sender?.userId === uid
            : false;

          const canDeleteGlobally = n.sender?.userId !== 'system' &&
            (userRole === 'admin' ||
              (userRole === 'moderator' && n.sender?.userId === uid));

          if (!isRead && !n.isDeletedGlobally && !isSender) {
            unreadCount++;
          }

          return {
            id: n.id,
            title: n.isDeletedGlobally ? 'Deleted Message' : n.title,
            content: n.isDeletedGlobally ? 'This message was deleted.' : n.content,
            type: n.type || 'announcement',
            sender: n.sender,
            target: n.target,
            isRead,
            isEdited: n.isEdited || false,
            isDeletedGlobally: n.isDeletedGlobally || false,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            canEdit: canEdit && !n.isDeletedGlobally,
            canDeleteGlobally,
            metadata: n.metadata,
          };
        });

      return NextResponse.json({
        notifications,
        unreadCount,
      }, { status: 200 });
    } catch (error: any) {
      console.error('[API] Error fetching notifications:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch notifications' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator', 'driver', 'student'],
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
  }
);
