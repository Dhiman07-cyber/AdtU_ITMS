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
    let myTripQuery = supabase
      .from('active_trips')
      .select('trip_id, driver_id, bus_id, route_id, shift, start_time')
      .eq('driver_id', driverUid)
      .eq('status', 'active');

    if (inputBusId) {
      myTripQuery = myTripQuery.eq('bus_id', inputBusId);
    }

    const { data: myTrip } = await myTripQuery.maybeSingle();

    if (myTrip) {
      console.log('✅ Active trip found for driver in active_trips:', myTrip.trip_id);
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

    // 2. If busId provided, perform lock check for other drivers
    const targetBusId = inputBusId;
    if (targetBusId) {
      const { data: activeTrip } = await supabase
        .from('active_trips')
        .select('trip_id, driver_id, status, start_time, expires_at')
        .eq('bus_id', targetBusId)
        .eq('status', 'active')
        .maybeSingle();

      if (activeTrip) {
        let isLockExpired = false;
        if (activeTrip.expires_at) {
          isLockExpired = Date.now() > new Date(activeTrip.expires_at).getTime();
        }

        if (activeTrip.driver_id && activeTrip.driver_id !== driverUid && !isLockExpired) {
          console.log(`🔒 Bus ${targetBusId} is locked by driver ${activeTrip.driver_id}`);
          return NextResponse.json({
            hasActiveTrip: false,
            tripData: null,
            busLockedByOther: true,
            lockInfo: {
              lockedByDriver: activeTrip.driver_id,
              tripId: activeTrip.trip_id,
              since: activeTrip.start_time
            },
            reason: 'This bus is currently being operated by another driver. Please wait or try again later.'
          });
        }
      }
    }

    return NextResponse.json({
      hasActiveTrip: false,
      tripData: null,
    });
  },
  {
    requiredRoles: ['driver'],
    rateLimit: RateLimits.READ,
    allowBodyToken: true
  }
);
