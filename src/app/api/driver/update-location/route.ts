import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { processUpdate } from '@/domains/gps';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId } = body as any;
    const driverUid = auth.uid;

    const result = await processUpdate({
      driverId: driverUid,
      tripId: tripId || '',
      busId,
      routeId,
      lat: Number(lat),
      lng: Number(lng),
      accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
      heading: heading !== undefined ? Number(heading) : undefined,
      speed: speed !== undefined ? Number(speed) : undefined,
      timestamp: timestamp ? String(timestamp) : new Date().toISOString(),
    });

    if (!result.accepted) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    const n = result.normalized!;
    return NextResponse.json({
      success: true,
      message: 'Location updated successfully',
      data: { busId, routeId, lat: n.lat, lng: n.lng, timestamp: n.timestamp.toISOString() },
    });
  },
  {
    requiredRoles: ['driver'],
    schema: LocationUpdateBodySchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
