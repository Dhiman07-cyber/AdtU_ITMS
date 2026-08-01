import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { SaveFCMTokenSchema } from '@/lib/security/validation-schemas';
import { isValidTokenFormat,saveToken,subscribeToTopic } from '@/lib/services/fcm-token-service';
import { getStudentProfileAndShift } from '@/lib/student-shift-resolver';
import { NextResponse } from 'next/server';

/**
 * POST /api/save-fcm-token
 * 
 * Saves FCM tokens to PostgreSQL (fcm_tokens table).
 * 
 * Security:
 * - JWT-authenticated (via withSecurity)
 * - UID must match authenticated user (prevents saving tokens for other users)
 * - Role-based collection mapping (no fallback search)
 * - Token format validation
 * - Rate limited
 */
export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const { userUid, token, platform } = body;
    const uid = auth.uid;

    // 1. Authorization: Only allow saving tokens for the authenticated user
    if (userUid !== uid) {
      console.warn(`[${requestId}] UID mismatch: auth=${uid}, body=${userUid}`);
      return NextResponse.json(
        { success: false, error: 'Unauthorized: UID mismatch', requestId },
        { status: 403 }
      );
    }

    // 2. Validate token format
    if (!isValidTokenFormat(token)) {
      return NextResponse.json(
        { success: false, error: 'Invalid FCM token format', requestId },
        { status: 400 }
      );
    }

    // 3. Only allow students to register FCM tokens
    if (auth.role !== 'student') {
      console.warn(`[${requestId}] FCM token registration denied for non-student role: ${auth.role}`);
      return NextResponse.json({
        success: false,
        error: 'FCM tokens are only available for student accounts',
        requestId,
      }, { status: 403 });
    }

    // 4. Resolve student profile and save token to PostgreSQL (multi-device support)
    const resolved = await getStudentProfileAndShift(uid);

    const result = await saveToken(uid, 'students', token, platform || 'web');

    if (!result.success) {
      console.error(`[${requestId}] FCM Token Service error:`, result.error);
      return NextResponse.json(
        { success: false, error: 'Failed to record device token', requestId },
        { status: 500 }
      );
    }

    // 5. Topic Subscription: Subscribe to both general and shift-specific topics
    if (resolved.routeId) {
      const routeId = resolved.routeId;
      const busId = resolved.busId;
      try {
        const shiftLower = resolved.shift ? resolved.shift.toLowerCase() : 'both';
        const topicPromises = [
          subscribeToTopic(token, `route_${routeId}`),
          subscribeToTopic(token, `route_${routeId}_${shiftLower}`),
        ];
        if (busId) {
          const rawBusId = busId.replace('bus_', '');
          topicPromises.push(
            subscribeToTopic(token, `bus_${busId}`),
            subscribeToTopic(token, `bus_${rawBusId}`),
            subscribeToTopic(token, `bus_${busId}_${shiftLower}`)
          );
        }
        await Promise.all(topicPromises);
      } catch (topicErr) {
        console.warn(`[${requestId}] Topic subscription failed (non-critical):`, topicErr);
      }
    }

    return NextResponse.json({
      success: true,
      requestId,
    });
  },
  {
    requiredRoles: [], // Allow any authenticated user
    schema: SaveFCMTokenSchema,
    rateLimit: RateLimits.CREATE,
  }
);