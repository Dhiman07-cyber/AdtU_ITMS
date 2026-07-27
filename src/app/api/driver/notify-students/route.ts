import * as routeService from '@/domains/route';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NotifyStudentsSchema } from '@/lib/security/validation-schemas';
import { notifyRouteTopic,verifyDriverRouteBinding } from '@/lib/services/fcm-notification-service';
import { NextResponse } from 'next/server';

/**
 * POST /api/driver/notify-students
 * 
 * Sends FCM push notifications to all students assigned to a bus/route
 * using high-performance FCM Topics.
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId, routeId, tripId } = body as any;
    const driverUid = auth.uid;

    // 1. Parallelize Binding Check and Route Fetching from PostgreSQL
    const [authCheck, routeData] = await Promise.all([
      verifyDriverRouteBinding(driverUid, routeId, busId),
      routeService.getById(routeId)
    ]);

    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.reason || 'Driver not authorized' }, { status: 403 });
    }

    const routeName = routeData?.name || routeData?.routeName || 'your route';

    // 2. Optimized Topic-Based Notification
    // This is much faster than the legacy per-student multicast for large routes
    const result = await notifyRouteTopic({
      routeId,
      tripId,
      routeName,
      busId,
      eventType: 'TRIP_STARTED'
    });

    if (!result.success) {
      return NextResponse.json({ error: 'Failed to send topic notification', details: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Students notified via topic successfully',
      topic: `route_${routeId}`,
      messageId: result.messageId
    });
  },
  {
    requiredRoles: ['driver'],
    schema: NotifyStudentsSchema,
    rateLimit: RateLimits.NOTIFICATION_CREATE,
    allowBodyToken: true
  }
);
