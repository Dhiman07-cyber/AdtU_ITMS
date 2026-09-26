import { processUpdate } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getCachedDeviceSession, setCachedDeviceSession } from '@/lib/services/device-session-cache';
import { shouldWriteLocationBreadcrumb, shouldWriteHeartbeat } from '@/lib/services/location-write-throttle';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId, deviceId } = body as any;
    const driverUid = auth.uid;

    const requestDeviceId = deviceId || (request instanceof Request ? request.headers.get('x-device-id') : (request as any).headers?.get?.('x-device-id'));
    const supabase = getSupabaseServer();
    let sessionData = getCachedDeviceSession(driverUid);
    if (!sessionData) {
      const { data } = await supabase
        .from('device_sessions')
        .select('device_id, last_active_at')
        .eq('user_id', driverUid)
        .eq('feature', 'driver_location_share')
        .order('last_active_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        const lastActiveAtMs = new Date(data.last_active_at).getTime();
        setCachedDeviceSession(driverUid, data.device_id, lastActiveAtMs);
        sessionData = { deviceId: data.device_id, lastActiveAtMs, cachedAtMs: Date.now() };
      }
    }

    if (sessionData) {
      const sessionAge = Date.now() - sessionData.lastActiveAtMs;
      if (sessionAge <= 30000 && (!requestDeviceId || sessionData.deviceId !== requestDeviceId)) {
        return NextResponse.json({
          error: 'Active session exists on another device. Location update rejected.',
          code: 'ANOTHER_DEVICE_ACTIVE',
          requestId,
        }, { status: 403 });
      }
    }

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

    // Non-blocking broadcast via WebSocket and Redis PubSub
    emitEvent(`bus_location_${busId}`, 'bus_location_update', {
      busId, driverUid,
      lat: Number(lat), lng: Number(lng),
      accuracy, speed, heading: heading || 0,
      tripId: result.normalized?.tripId || tripId || undefined,
      timestamp: result.normalized?.timestamp?.toISOString() || (timestamp ? String(timestamp) : new Date().toISOString()),
    }).catch((err: Error) => console.warn('Location broadcast failed:', err));

    // Throttled heartbeat to active_trips
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

    // Throttled fallback to bus_locations
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

    const n = result.normalized!;
    return NextResponse.json({
      success: true,
      message: 'Location updated successfully',
      data: { busId, routeId, lat: n.lat, lng: n.lng, timestamp: n.timestamp.toISOString() },
      requestId,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: LocationUpdateBodySchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
