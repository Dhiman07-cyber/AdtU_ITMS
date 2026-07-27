import * as tripService from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const InitiateTripSchema = z.object({
  busId: z.string().min(1).max(100),
  shift: z.enum(['Morning', 'Evening']),
});

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, shift } = body as z.infer<typeof InitiateTripSchema>;
    const driverUid = auth.uid;

    const result = await tripService.startTrip({ driverId: driverUid, busId, shift });

    if (!result.success) {
      return NextResponse.json(
        { error: result.reason, errorCode: result.errorCode },
        { status: result.errorCode === 'LOCKED_BY_OTHER' ? 409 : 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Trip started successfully',
      tripId: result.tripId,
      busId,
      routeId: result.routeId,
      shift: result.shift,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: InitiateTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  },
);
