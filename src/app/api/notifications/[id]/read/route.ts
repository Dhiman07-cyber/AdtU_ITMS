/**
 * POST /api/notifications/[id]/read
 *
 * Marks a notification as read for the current user.
 * Replaces notificationService.markAsRead() from the old client-side NotificationService.
 */
import * as Notification from '@/domains/notification';
import { getByUid as getStudentByUid } from '@/domains/student';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';

function extractId(url: string): string | null {
  const match = url.match(/\/api\/notifications\/([^/]+)\/read/);
  return match ? match[1] : null;
}

export const POST = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const id = extractId(request.url);
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Notification ID required' },
          { status: 400 }
        );
      }

      // Only users who can see the notification may mark it as read.
      // Prevents forged read-receipts and ID-existence probing.
      if (auth.role === 'student' || auth.role === 'driver') {
        const notification = await Notification.findById(id);
        if (!notification) {
          return NextResponse.json(
            { success: false, error: 'Notification not found' },
            { status: 404 }
          );
        }
        let userRouteId: string | null = null;
        if (auth.role === 'student') {
          try {
            const student = await getStudentByUid(auth.uid);
            userRouteId = (student as any)?.routeId || (student as any)?.route_id || null;
          } catch {
            userRouteId = null;
          }
        }
        const visibility = Notification.isNotificationVisibleToUser(
          notification,
          auth.uid,
          auth.role as any,
          userRouteId
        );
        if (!visibility.visible) {
          return NextResponse.json(
            { success: false, error: 'Notification not found' },
            { status: 404 }
          );
        }
      }

      await Notification.markAsRead(auth.uid, id);

      return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: any) {
      console.error('[API] Error marking notification as read:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to mark as read' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator', 'driver', 'student'],
    rateLimit: { maxRequests: 60, windowMs: 60_000 },
  }
);
