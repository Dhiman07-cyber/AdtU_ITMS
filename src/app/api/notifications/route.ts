/**
 * GET /api/notifications
 *
 * Returns the current user's notifications from PostgreSQL.
 * Replaces the Firestore onSnapshot / getDocs read in NotificationContext.
 */
import * as Notification from '@/domains/notification';
import { getByUid as getStudentByUid, getCachedStudentAssignment } from '@/domains/student';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';

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

      let userRouteId: string | null = null;
      if (userRole === 'student') {
        try {
          const cachedStudent = await getCachedStudentAssignment(uid);
          if (cachedStudent?.routeId) {
            userRouteId = cachedStudent.routeId;
          } else {
            const student = await getStudentByUid(uid);
            userRouteId = (student as any)?.routeId || (student as any)?.route_id || (auth as any).routeId || null;
          }
        } catch {
          userRouteId = (auth as any).routeId || null;
        }
      } else if (userRole === 'driver') {
        try {
          userRouteId = (auth as any).routeId || (auth as any).route_id || null;
          if (!userRouteId) {
            const { getDriverById } = await import('@/domains/identity');
            const driver = await getDriverById(uid);
            userRouteId = (driver as any)?.routeId || (driver as any)?.route_id || (driver as any)?.assignedRouteId || (driver as any)?.assigned_route_id || null;
          }
        } catch {
          userRouteId = null;
        }
      }

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
