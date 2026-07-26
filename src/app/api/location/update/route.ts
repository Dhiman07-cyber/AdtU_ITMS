import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { processUpdate } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';

export const POST = withSecurity(
  async (_request, { auth, body }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId } = body as any;
    const driverUid = auth.uid;

    const result = await processUpdate({
      driverId: driverUid,
      tripId: tripId || '',
      busId,
      routeId: routeId || '',
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

    // Non-blocking broadcast via WebSocket
    emitEvent(`bus_location_${busId}`, 'bus_location_update', {
      busId, driverUid,
      lat: Number(lat), lng: Number(lng),
      accuracy, speed, heading: heading || 0,
      timestamp: new Date().toISOString(),
    }).catch((err: Error) => console.warn('Location broadcast failed:', err));

    return NextResponse.json({
      success: true,
      message: 'Location updated successfully',
      tripId: result.normalized?.tripId,
      timestamp: result.normalized?.timestamp.toISOString(),
    });
  },
  {
    requiredRoles: ['driver'],
    schema: LocationUpdateBodySchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
