import { processUpdate } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (_request, { auth, body, requestId }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId } = body as any;
    const driverUid = auth.uid;

    const numLat = Number(lat);
    const numLng = Number(lng);

    if (!busId || isNaN(numLat) || isNaN(numLng) || numLat === 0 || numLng === 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid GPS location data provided. Please ensure GPS is active and try again.',
        requestId,
      }, { status: 400 });
    }

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
      correlationId: requestId,
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

    // Persist heartbeat to PostgreSQL active_trips
    const supabase = getSupabaseServer();
    supabase.from('active_trips')
      .update({
        last_heartbeat: new Date().toISOString()
      })
      .eq('bus_id', busId)
      .eq('status', 'active')
      .then(({ error }) => {
        if (error) console.warn('Failed to update active_trips heartbeat:', error);
      });

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
