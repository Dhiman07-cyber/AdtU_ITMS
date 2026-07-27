import * as tripService from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EndTripSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity<{ busId: string; tripId?: string }>(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { tripId, busId } = body;
    const driverId = auth.uid;

    const result = await tripService.endTrip({ driverId, busId, tripId });

    if (!result.success) {
      return NextResponse.json(
        { success: false, reason: result.reason },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      tripId: result.tripId,
      busId,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: EndTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
