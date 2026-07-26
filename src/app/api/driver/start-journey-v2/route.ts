import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { StartTripSchema } from '@/lib/security/validation-schemas';
import * as tripService from '@/domains/trip';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, routeId } = body as any;
    const driverUid = auth.uid;

    const result = await tripService.startTrip({ driverId: driverUid, busId, routeId });

    if (!result.success) {
      return NextResponse.json(
        { error: result.reason, errorCode: result.errorCode },
        { status: result.errorCode === 'LOCKED_BY_OTHER' ? 409 : 500 }
      );
    }

    const isExistingTrip = result.shift === undefined;

    return NextResponse.json({
      success: true,
      message: isExistingTrip ? 'Journey already active' : 'Journey started successfully',
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
