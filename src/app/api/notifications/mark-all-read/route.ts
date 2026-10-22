/**
 * POST /api/notifications/mark-all-read
 *
 * Batch marks a list of notification IDs as read for the authenticated user.
 * Replaces N individual requests with a single atomic batch operation.
 */
import * as Notification from '@/domains/notification';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const MarkAllReadSchema = z.object({
  notificationIds: z.array(z.string().min(1)).max(100),
});

export const POST = withSecurity(
  async (request, { auth, body }) => {
    try {
      const { notificationIds } = body as z.infer<typeof MarkAllReadSchema>;

      if (!notificationIds || notificationIds.length === 0) {
        return NextResponse.json({ success: true, count: 0 }, { status: 200 });
      }

      await Notification.markMultipleAsRead(notificationIds, auth.uid);

      return NextResponse.json(
        { success: true, count: notificationIds.length },
        { status: 200 }
      );
    } catch (error: any) {
      console.error('[API] Error in mark-all-read:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to mark notifications as read' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator', 'driver', 'student'],
    rateLimit: { maxRequests: 60, windowMs: 60_000 },
    schema: MarkAllReadSchema,
  }
);
