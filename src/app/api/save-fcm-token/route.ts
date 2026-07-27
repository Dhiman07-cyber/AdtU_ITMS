import { getStudentById } from '@/domains/identity';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { SaveFCMTokenSchema } from '@/lib/security/validation-schemas';
import { isValidTokenFormat,saveToken,subscribeToTopic } from '@/lib/services/fcm-token-service';
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

    // 4. Validate user exists in students database in PostgreSQL (canonical source of truth) before saving token
    const userData = await getStudentById(uid);
    if (!userData) {
      console.warn(`[${requestId}] User ${uid} does not exist in PostgreSQL student_profiles`);
      return NextResponse.json({
        success: false,
        error: 'User account not found. Please contact support.',
        requestId,
      }, { status: 404 });
    }

    // 5. Additional validation: Only allow active student accounts
    if (userData.status === 'inactive' || userData.status === 'suspended') {
      console.warn(`[${requestId}] Student ${uid} account is not active`);
      return NextResponse.json({
        success: false,
        error: 'Student account is not active. Please contact support.',
        requestId,
      }, { status: 403 });
    }

    // 6. Save token to PostgreSQL (multi-device support)
    const result = await saveToken(uid, 'students', token, platform || 'web');

    if (!result.success) {
      console.error(`[${requestId}] FCM Token Service error:`, result.error);
      return NextResponse.json(
        { success: false, error: 'Failed to record device token', requestId },
        { status: 500 }
      );
    }

    // 7. Topic Subscription: Subscribe to route-specific topic for high-performance notifications
    const routeId = userData.routeId || userData.route_id || userData.routeId;
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