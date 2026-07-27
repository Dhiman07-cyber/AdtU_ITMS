import * as tripService from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { StartTripSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity<{ busId: string; routeId: string; shift?: string }>(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, routeId, shift } = body;
    const driverId = auth.uid;

    const result = await tripService.startTrip({ driverId, busId, routeId, shift });

    if (!result.success) {
      return NextResponse.json(
        { success: false, reason: result.reason, errorCode: result.errorCode },
        { status: result.errorCode === 'LOCKED_BY_OTHER' ? 409 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      tripId: result.tripId,
      busId,
      routeId: result.routeId,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: StartTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
