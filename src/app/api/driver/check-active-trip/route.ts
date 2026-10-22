import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BusIdSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { shouldWriteHeartbeat } from '@/lib/services/location-write-throttle';
import { setActiveTripCache } from '@/domains/gps/services/gps-persistence.service';
import { NextResponse } from 'next/server';

/**
 * POST /api/driver/check-active-trip
 *
 * Body: { busId }
 *
 * Checks if there's an active trip for the driver and bus
 * Returns trip data if found, null if not
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId: inputBusId } = (body || {}) as any;
    const driverUid = auth.uid;

    const supabase = getSupabaseServer();

    // 1. Check if driver has an active trip in active_trips (primary check)
    // IMPORTANT: Do NOT filter by inputBusId here! Any driver can start any bus, so if this
    // driver has an active trip on ANY bus, we must return that active trip immediately.
    const now = new Date().toISOString();
    const { data: myTrip } = await supabase
      .from('active_trips')
      .select('trip_id, driver_id, bus_id, route_id, shift, start_time')
      .eq('driver_id', driverUid)
      .eq('status', 'active')
      .gt('expires_at', now)
      .maybeSingle();

    if (myTrip) {
      const nowMs = Date.now();
      // Keep trip lock alive under temporary satellite blindness
      if (shouldWriteHeartbeat(myTrip.bus_id, nowMs)) {
        const extendedExpiresAt = new Date(nowMs + 1800 * 1000).toISOString();
        setActiveTripCache(myTrip.bus_id, {
          tripId: myTrip.trip_id,
          driverId: driverUid,
          routeId: myTrip.route_id,
          shift: myTrip.shift,
          expiresAtMs: nowMs + 1800 * 1000,
        });
        Promise.resolve(
          supabase
            .from('active_trips')
            .update({
              last_heartbeat: new Date(nowMs).toISOString(),
              expires_at: extendedExpiresAt,
            })
            .eq('trip_id', myTrip.trip_id)
        ).catch(() => {});
      }

      const startTime = myTrip.start_time ? new Date(myTrip.start_time).getTime() : nowMs;
      return NextResponse.json({
        hasActiveTrip: true,
        busLockedByOther: false,
        tripData: {
          tripId: myTrip.trip_id,
          startTime: startTime,
          busId: myTrip.bus_id,
          routeId: myTrip.route_id,
          shift: myTrip.shift,
          driverUid: driverUid,
          busStatus: 'enroute'
        }
      });
    }

    // 2. Driver has NO active trip.
    // Zero-Wait Handover Architecture: even if another driver has an unended trip on this bus,
    // Driver 2 is NEVER blocked. They can start their shift immediately.
    return NextResponse.json({
      hasActiveTrip: false,
      tripData: null,
      busLockedByOther: false,
      canHandover: true,
    });
  },
  {
    requiredRoles: ['driver'],
    rateLimit: RateLimits.READ,
    allowBodyToken: true
  }
);
