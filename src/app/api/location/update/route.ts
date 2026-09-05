import { processUpdate } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { shouldWriteLocationBreadcrumb, shouldWriteHeartbeat } from '@/lib/services/location-write-throttle';
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
      tripId: result.normalized?.tripId || tripId || undefined,
      timestamp: result.normalized?.timestamp?.toISOString() || (timestamp ? String(timestamp) : new Date().toISOString()),
    }).catch((err: Error) => console.warn('Location broadcast failed:', err));


    // Persist heartbeat to PostgreSQL active_trips (throttled to 1 write/bus/20s).
    // CRITICAL: must also extend expires_at, not just last_heartbeat.
    // trip-status filters .gt('expires_at', now) — if we only write last_heartbeat
    // the trip lock expires 10 minutes after start and the student sees "Trip Inactive"
    // even though GPS HTTP 200 continues. The 600s TTL matches acquire_trip_lock /
    // extend_trip_lock RPCs (LOCK_TTL_SECONDS = 600 in trip-lock-service.ts).
    const supabase = getSupabaseServer();
    const nowMs = Date.now();
    if (shouldWriteHeartbeat(busId, nowMs)) {
      const extendedExpiresAt = new Date(nowMs + 600 * 1000).toISOString();
      const { error: heartbeatError } = await supabase
        .from('active_trips')
        .update({
          last_heartbeat: new Date(nowMs).toISOString(),
          expires_at: extendedExpiresAt,
        })
        .eq('bus_id', busId)
        .eq('driver_id', driverUid)
        .eq('status', 'active');
      if (heartbeatError) console.warn('Failed to update active_trips heartbeat:', heartbeatError);
    }

    // Persist last position to bus_locations (throttled to 1 write/bus/30s).
    // Student trip-status reads this as a DB fallback when the WS bridge has
    // no cached position (e.g. right after a WS server restart).
    const normalizedTripId = result.normalized?.tripId || tripId || '';
    if (shouldWriteLocationBreadcrumb(normalizedTripId || busId, Date.now())) {
      const { error: locationError } = await supabase
        .from('bus_locations')
        .upsert({
          bus_id: busId,
          trip_id: normalizedTripId || null,
          driver_id: driverUid,
          route_id: routeId || null,
          lat: Number(lat),
          lng: Number(lng),
          accuracy: accuracy !== undefined ? Number(accuracy) : null,
          speed: speed !== undefined ? Number(speed) : null,
          heading: heading !== undefined ? Number(heading) : null,
          timestamp: new Date().toISOString(),
        }, { onConflict: 'bus_id' });
      if (locationError) console.warn('Failed to persist bus location:', locationError);
    }

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
