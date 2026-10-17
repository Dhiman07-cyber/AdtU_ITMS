import { processUpdate } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getCachedDeviceSession, setCachedDeviceSession } from '@/lib/services/device-session-cache';
import { shouldWriteHeartbeat } from '@/lib/services/location-write-throttle';
import { NextResponse } from 'next/server';

const lastSessionRefreshMap = new Map<string, number>();
const SESSION_REFRESH_THROTTLE_MS = 10_000;

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId, deviceId } = body as any;
    const driverUid = auth.uid;

    const requestDeviceId = deviceId || (request instanceof Request ? request.headers.get('x-device-id') : (request as any).headers?.get?.('x-device-id'));
    const supabase = getSupabaseServer();
    const writePromises: Promise<void>[] = [];
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
          success: false,
          error: 'Active session exists on another device. Location update rejected.',
          code: 'ANOTHER_DEVICE_ACTIVE',
          requestId,
        }, { status: 403 });
      }

      // Valid GPS update from current device refreshes session activity (throttled to 10s)
      if (requestDeviceId && sessionData.deviceId === requestDeviceId) {
        const nowMs = Date.now();
        const lastRefresh = lastSessionRefreshMap.get(driverUid) || 0;
        if (nowMs - lastRefresh >= SESSION_REFRESH_THROTTLE_MS) {
          lastSessionRefreshMap.set(driverUid, nowMs);
          setCachedDeviceSession(driverUid, requestDeviceId, nowMs);
          const nowIso = new Date(nowMs).toISOString();
          writePromises.push(
            (async () => {
              const { error } = await supabase
                .from('device_sessions')
                .update({ last_active_at: nowIso, last_active: nowIso })
                .eq('user_id', driverUid)
                .eq('feature', 'driver_location_share')
                .eq('device_id', requestDeviceId);
              if (error) console.warn('Failed to refresh device session during location update:', error);
            })()
          );
        }
      }
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    if (!busId || isNaN(numLat) || isNaN(numLng) || (numLat === 0 && numLng === 0)) {
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

    // Non-blocking broadcast via WebSocket.
    // Use pipeline-normalized values (not raw body) so the broadcast is consistent
    // with what was validated and persisted by the GPS pipeline.
    const norm = result.normalized;
    emitEvent(`bus_location_${busId}`, 'bus_location_update', {
      busId,
      driverUid,
      lat: norm?.lat ?? numLat,
      lng: norm?.lng ?? numLng,
      accuracy: norm?.accuracy ?? accuracy,
      speed: norm?.speed ?? speed,
      heading: norm?.heading ?? heading ?? 0,
      tripId: norm?.tripId || tripId || undefined,
      timestamp: norm?.timestamp?.toISOString() || (timestamp ? String(timestamp) : new Date().toISOString()),
    }).catch((err: Error) => console.warn('Location broadcast failed:', err));


    // Persist heartbeat to PostgreSQL active_trips (throttled to 1 write/bus/20s).
    // CRITICAL: must also extend expires_at, not just last_heartbeat.
    // trip-status filters .gt('expires_at', now) — if we only write last_heartbeat
    // the trip lock expires 10 minutes after start and the student sees "Trip Inactive"
    // even though GPS HTTP 200 continues. The 600s TTL matches acquire_trip_lock /
    // extend_trip_lock RPCs (LOCK_TTL_SECONDS = 600 in trip-lock-service.ts).
    const nowMs = Date.now();

    if (shouldWriteHeartbeat(busId, nowMs)) {
      const extendedExpiresAt = new Date(nowMs + 600 * 1000).toISOString();
      writePromises.push(
        (async () => {
          const { error } = await supabase
            .from('active_trips')
            .update({
              last_heartbeat: new Date(nowMs).toISOString(),
              expires_at: extendedExpiresAt,
            })
            .eq('bus_id', busId)
            .eq('driver_id', driverUid)
            .eq('status', 'active');
          if (error) console.warn('Failed to update active_trips heartbeat:', error);
        })()
      );
    }


    if (writePromises.length > 0) {
      await Promise.all(writePromises);
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
