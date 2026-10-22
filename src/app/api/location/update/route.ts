import { processUpdate, setActiveTripCache, getPositiveTripLock, getRedisTripLock } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getCachedDeviceSession, setCachedDeviceSession } from '@/lib/services/device-session-cache';
import { shouldWriteHeartbeat } from '@/lib/services/location-write-throttle';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId, deviceId } = body as any;
    const driverUid = auth.uid;

    const requestDeviceId = deviceId || (request instanceof Request ? request.headers.get('x-device-id') : (request as any).headers?.get?.('x-device-id'));
    const supabase = getSupabaseServer();
    const writePromises: Promise<void>[] = [];

    // Zero-Waste Fast Path: If incoming request matches the active trip lock in memory,
    // device session is verified in <0.01ms with 0 Supabase reads.
    let sessionVerified = false;
    let activeLock = getPositiveTripLock(driverUid, busId);
    if (!activeLock) {
      // Cold-start or cross-worker: Check Redis lock to populate positiveLockCache
      const redisLock = await getRedisTripLock(busId);
      if (redisLock && redisLock.driverId === driverUid && redisLock.expiresAtMs > Date.now()) {
        setActiveTripCache(busId, redisLock);
        activeLock = getPositiveTripLock(driverUid, busId);
      }
    }
    if (activeLock && activeLock.driverId === driverUid) {
      sessionVerified = true;
      if (requestDeviceId) {
        if (activeLock.deviceId !== requestDeviceId) {
          // Same driver logged in on new device (phone swap/spare device) -> update session cleanly
          activeLock.deviceId = requestDeviceId;
          writePromises.push(
            (async () => {
              await supabase.from('buses').update({ driver_device_session: requestDeviceId }).eq('id', busId);
              await supabase.from('active_trips').update({ device_id: requestDeviceId }).eq('bus_id', busId).eq('driver_id', driverUid).eq('status', 'active');
            })()
          );
        }
        setCachedDeviceSession(driverUid, requestDeviceId, Date.now());
      }
    }

    if (!sessionVerified) {
      // Check buses table directly
      const { data: busRow } = await supabase.from('buses').select('driver_device_session, driver_uid').eq('id', busId).maybeSingle();
      if (busRow && (busRow.driver_uid === driverUid || !busRow.driver_uid)) {
        sessionVerified = true;
        if (requestDeviceId && busRow.driver_device_session !== requestDeviceId) {
          writePromises.push(
            (async () => {
              await supabase.from('buses').update({ driver_device_session: requestDeviceId, driver_uid: driverUid }).eq('id', busId);
              await supabase.from('active_trips').update({ device_id: requestDeviceId }).eq('bus_id', busId).eq('driver_id', driverUid).eq('status', 'active');
            })()
          );
        }
        if (requestDeviceId) {
          setCachedDeviceSession(driverUid, requestDeviceId, Date.now());
        }
      } else {
        let sessionData = getCachedDeviceSession(driverUid);
        if (sessionData && requestDeviceId && sessionData.deviceId !== requestDeviceId) {
          // Same driver switching devices -> auto-update without error
          setCachedDeviceSession(driverUid, requestDeviceId, Date.now());
          sessionVerified = true;
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
      shift: (body as any).shift,
    } as any);

    if (!result.accepted) {
      const isUnavailable = result.errorClass === 'DATABASE_UNAVAILABLE' || result.reason?.toLowerCase().includes('unavailable');
      return NextResponse.json({ error: result.reason }, { status: isUnavailable ? 503 : 400 });
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


    // Persist heartbeat to PostgreSQL active_trips (throttled to 1 write/bus/45s).
    // Rule 8: Automatically extends active_trips.last_heartbeat = NOW(), expires_at = NOW() + INTERVAL '2 hours'
    const nowMs = Date.now();

    if (shouldWriteHeartbeat(busId, nowMs)) {
      const extendedExpiresAt = new Date(nowMs + 7200 * 1000).toISOString();
      const currentLock = getPositiveTripLock(driverUid, busId);
      setActiveTripCache(busId, {
        tripId: norm?.tripId || tripId || currentLock?.tripId || 'unknown_trip',
        driverId: driverUid,
        routeId: routeId || currentLock?.routeId || norm?.routeId,
        shift: (body as any).shift || norm?.shift || currentLock?.shift,
        deviceId: requestDeviceId || currentLock?.deviceId || undefined,
        expiresAtMs: nowMs + 7200 * 1000,
      });
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
      if (requestDeviceId) {
        writePromises.push(
          (async () => {
            const { error } = await supabase
              .from('device_sessions')
              .update({
                last_active_at: new Date(nowMs).toISOString(),
                last_active: new Date(nowMs).toISOString(),
                expires_at: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
              })
              .eq('user_id', driverUid)
              .eq('device_id', requestDeviceId)
              .eq('feature', 'driver_location_share');
            if (error) console.warn('Failed to update device_sessions heartbeat:', error);
          })()
        );
      }
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
