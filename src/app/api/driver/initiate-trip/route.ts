/**
 * POST /api/driver/initiate-trip
 *
 * CANONICAL trip-start endpoint — the ONLY route that should be called
 * to start a bus trip. Duplicate routes (start-trip, start-journey-v2) have
 * been removed.
 *
 * Flow:
 *  1. Validates driver auth and role
 *  2. Calls tripService.startTrip() which:
 *     a. Runs preflight checks (bus ownership, no conflicting trips)
 *     b. Acquires the trip lock in active_trips
 *     c. Broadcasts trip_started via WebSocket
 *     d. Dispatches FCM push notifications to students (awaited)
 *  3. Returns the new tripId and shift to the client
 *
 * FCM notification is AWAITED so it completes before the response is
 * returned — critical for serverless environments (Vercel).
 */
import * as tripService from '@/domains/trip';
import { appLogger } from '@/lib/logger';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const InitiateTripSchema = z.object({
  busId: z.string().min(1).max(100),
  // Accept both 'Morning'/'Evening' (from web) and 'morning'/'evening' (from mobile)
  shift: z.string()
    .transform(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .pipe(z.enum(['Morning', 'Evening'])),
});

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const startTime = Date.now();
    const { busId, shift } = body as z.infer<typeof InitiateTripSchema>;
    const driverUid = auth.uid;

    appLogger.info('trip', 'initiate_trip_request', { driverId: driverUid, busId, shift, requestId });

    const result = await tripService.startTrip({ driverId: driverUid, busId, shift });

    const latencyMs = Date.now() - startTime;

    if (!result.success) {
      appLogger.warn('trip', 'initiate_trip_failed', {
        driverId: driverUid, busId, shift, reason: result.reason, errorCode: result.errorCode, latencyMs,
      });
      return NextResponse.json(
        { success: false, error: result.reason, errorCode: result.errorCode },
        { status: result.errorCode === 'LOCKED_BY_OTHER' ? 409 : 500 },
      );
    }

    appLogger.info('trip', 'initiate_trip_success', {
      driverId: driverUid, busId, tripId: result.tripId, routeId: result.routeId, shift: result.shift, latencyMs,
    });

    return NextResponse.json({
      success: true,
      message: 'Trip started successfully',
      tripId: result.tripId,
      busId,
      routeId: result.routeId,
      shift: result.shift,
      timestamp: new Date().toISOString(),
      processingTimeMs: latencyMs,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: InitiateTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  },
);
