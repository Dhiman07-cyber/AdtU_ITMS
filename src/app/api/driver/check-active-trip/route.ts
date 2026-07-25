import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { BusIdSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getDriverUidByBusId } from '@/domains/fleet/repositories/driver-assignment.repository';

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
    const { busId } = body as any;
    const driverUid = auth.uid;

    console.log(`🔄 Check active trip API called for bus ${busId}`);

    const supabase = getSupabaseServer();

    // Verify driver assignment across active_trips, driver_assignments, buses, and driver_profiles
    const [busResult, assignedDriverUid, driverProfileResult] = await Promise.all([
      supabase.from('buses').select('id, driver_uid').eq('id', busId).maybeSingle(),
      getDriverUidByBusId(busId),
      supabase.from('driver_profiles').select('bus_id').eq('uid', driverUid).maybeSingle()
    ]);

    if (!busResult.data) {
      return NextResponse.json({ error: 'Bus not found' }, { status: 404 });
    }

    const { data: activeTripCheck } = await supabase
      .from('active_trips')
      .select('driver_id, bus_id')
      .eq('driver_id', driverUid)
      .eq('status', 'active')
      .maybeSingle();

    const driverClaimsBus =
      activeTripCheck?.bus_id === busId ||
      assignedDriverUid === driverUid ||
      busResult.data.driver_uid === driverUid ||
      driverProfileResult.data?.bus_id === busId;

    if (!driverClaimsBus) {
      return NextResponse.json(
        { error: 'Driver is not assigned to this bus' },
        { status: 403 }
      );
    }

    // =====================================================
    // MULTI-DRIVER LOCK CHECK
    // D9: Check active_trips instead of Firestore activeTripLock
    // =====================================================
    const { data: activeTrip } = await supabase
      .from('active_trips')
      .select('trip_id, driver_id, status, start_time, expires_at')
      .eq('bus_id', busId)
      .eq('status', 'active')
      .maybeSingle();

    if (activeTrip) {
      // Check if lock has expired (stale lock recovery)
      let isLockExpired = false;
      if (activeTrip.expires_at) {
        isLockExpired = Date.now() > new Date(activeTrip.expires_at).getTime();
        if (isLockExpired) {
          console.log(`⏰ Lock for bus ${busId} has expired (was held by ${activeTrip.driver_id}), allowing new operations`);
        }
      }

      // If another driver has an active, NON-EXPIRED lock on this bus
      if (activeTrip.driver_id && activeTrip.driver_id !== driverUid && !isLockExpired) {
        console.log(`🔒 Bus ${busId} is locked by driver ${activeTrip.driver_id}`);
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

    const { data: myTrip } = await supabase
      .from('active_trips')
      .select('trip_id, driver_id, bus_id, start_time')
      .eq('driver_id', driverUid)
      .eq('bus_id', busId)
      .eq('status', 'active')
      .maybeSingle();

    if (myTrip) {
      console.log('✅ Active trip found in active_trips');
      const startTime = myTrip.start_time ? new Date(myTrip.start_time).getTime() : Date.now();
      return NextResponse.json({
        hasActiveTrip: true,
        tripData: {
          tripId: myTrip.trip_id,
          startTime: startTime,
          busId: busId,
          driverUid: driverUid,
          busStatus: 'enroute'
        }
      });
    }

    console.log('ℹ️ No active trip found in active_trips');
    return NextResponse.json({
      hasActiveTrip: false,
      tripData: null,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: BusIdSchema,
    rateLimit: RateLimits.READ,
    allowBodyToken: true
  }
);
