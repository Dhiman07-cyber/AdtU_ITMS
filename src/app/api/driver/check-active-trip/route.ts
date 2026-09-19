import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BusIdSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
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
      const startTime = myTrip.start_time ? new Date(myTrip.start_time).getTime() : Date.now();
      return NextResponse.json({
        hasActiveTrip: true,
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
    // If a specific busId was explicitly queried, check whether THAT bus is currently locked by another driver.
    const targetBusId = inputBusId;
    if (targetBusId) {
      const { data: activeTrip } = await supabase
        .from('active_trips')
        .select('trip_id, driver_id, status, start_time')
        .eq('bus_id', targetBusId)
        .eq('status', 'active')
        .gt('expires_at', now)
        .maybeSingle();

      if (activeTrip && activeTrip.driver_id && activeTrip.driver_id !== driverUid) {
        return NextResponse.json({
          hasActiveTrip: false,
          tripData: null,
          busLockedByOther: true,
          targetBusId,
          lockInfo: {
            lockedByDriver: activeTrip.driver_id,
            tripId: activeTrip.trip_id,
            since: activeTrip.start_time
          },
          reason: 'This specific bus is currently being operated by another driver. Please select another available bus.'
        });
      }
    }

    return NextResponse.json({
      hasActiveTrip: false,
      tripData: null,
      busLockedByOther: false,
    });
  },
  {
    requiredRoles: ['driver'],
    rateLimit: RateLimits.READ,
    allowBodyToken: true
  }
);
