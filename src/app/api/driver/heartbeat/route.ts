import * as tripService from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { HeartbeatSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { tripId, busId } = body;
    const driverId = auth.uid;

    const result = await tripService.heartbeat({ driverId, busId, tripId });

    if (!result.success) {
      return NextResponse.json(
        { success: false, reason: result.reason },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  },
  {
    requiredRoles: ['driver'],
    schema: HeartbeatSchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
