import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { EndTripSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import * as tripService from '@/domains/trip';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, tripId } = body as any;
    const driverUid = auth.uid;

    const result = await tripService.endTrip({ driverId: driverUid, busId, tripId });

    if (!result.success) {
      return NextResponse.json({ error: result.reason }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      message: 'Journey ended successfully',
      tripId: result.tripId,
      busId,
      cleanupStats: { activeTrips: result.tripId ? 1 : 0, totalTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  },
  {
    requiredRoles: ['driver'],
    schema: EndTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
