/**
 * GET /api/notifications/[id]
 *
 * Returns a single notification by ID from PostgreSQL.
 * Replaces Firestore getDoc(doc(db, 'notifications', id)) in view pages.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import * as Notification from '@/domains/notification';

function extractId(url: string): string | null {
  const match = url.match(/\/api\/notifications\/([^/]+)/);
  return match ? match[1] : null;
}

export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const id = extractId(request.url);
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Notification ID required' },
          { status: 400 }
        );
      }

      const notification = await Notification.findById(id);

      if (!notification) {
        return NextResponse.json(
          { success: false, error: 'Notification not found' },
          { status: 404 }
        );
      }

      return NextResponse.json(notification, { status: 200 });
    } catch (error: any) {
      console.error('[API] Error fetching notification:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch notification' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator', 'driver', 'student'],
    rateLimit: { maxRequests: 60, windowMs: 60_000 },
  }
);

/**
 * PUT /api/notifications/[id]
 *
 * Edits a notification (title, content, metadata).
 * Replaces notificationService.editNotification() from the old client-side NotificationService.
 */
export const PUT = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const id = extractId(request.url);
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Notification ID required' },
          { status: 400 }
        );
      }

      const { title, content, metadata } = body;
      if (!content || typeof content !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Content is required' },
          { status: 400 }
        );
      }

      await Notification.editNotification(auth.uid, auth.role as any, id, {
        ...(title !== undefined && { title }),
        content,
        ...(metadata !== undefined && { metadata }),
      });

      return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: any) {
      console.error('[API] Error editing notification:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to edit notification' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
  }
);

/**
 * DELETE /api/notifications/[id]
 *
 * Globally deletes a notification (soft delete).
 * Replaces notificationService.deleteNotificationGlobally() from the old client-side NotificationService.
 */
export const DELETE = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const id = extractId(request.url);
      if (!id) {
        return NextResponse.json(
          { success: false, error: 'Notification ID required' },
          { status: 400 }
        );
      }

      await Notification.deleteNotificationGlobally(auth.uid, auth.role as any, id);

      return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: any) {
      console.error('[API] Error deleting notification:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to delete notification' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: { maxRequests: 30, windowMs: 60_000 },
  }
);
