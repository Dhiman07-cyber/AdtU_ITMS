import { NextRequest, NextResponse } from 'next/server';
import { saveToken, isValidTokenFormat, subscribeToTopic } from '@/lib/services/fcm-token-service';
import { withSecurity } from '@/lib/security/api-security';
import { SaveFCMTokenSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getStudentById } from '@/domains/identity';

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

    // 3. Only allow student role to register FCM tokens
    if (auth.role !== 'student') {
      return NextResponse.json({
        success: false,
        skipped: true,
        message: 'FCM tokens are only available for student accounts',
        requestId,
      }, { status: 200 });
    }

    // 4. Validate user exists in student_profiles in PostgreSQL and is active (approved)
    const userData = await getStudentById(uid);
    if (!userData || userData.status !== 'active') {
      return NextResponse.json({
        success: false,
        skipped: true,
        message: 'FCM tokens are only registered for approved active student profiles',
        requestId,
      }, { status: 200 });
    }

    // 5. Save token to PostgreSQL fcm_tokens table (multi-device support)
    const result = await saveToken(uid, 'students', token, platform || 'web');

    if (!result.success) {
      console.error(`[${requestId}] FCM Token Service error:`, result.error);
      return NextResponse.json(
        { success: false, error: 'Failed to record device token', requestId },
        { status: 500 }
      );
    }

    // 6. Topic Subscription: Subscribe to route-specific topic if student is assigned to a route
    const routeId = userData?.routeId || userData?.route_id;
    if (routeId) {
      try {
        const topic = `route_${routeId}`;
        await subscribeToTopic(token, topic);
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