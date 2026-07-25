import { NextResponse } from 'next/server';
import { notifyRoute } from '@/lib/services/fcm-notification-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { tripLockService } from '@/lib/services/trip-lock-service';
import { withSecurity } from '@/lib/security/api-security';
import { StartTripSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { formatIdForDisplay } from '@/lib/utils';
import { getDriverUidByBusId } from '@/domains/fleet/repositories/driver-assignment.repository';
import crypto from 'crypto';

/**
 * POST /api/driver/start-journey-v2
 * 
 * Optimized:
 * - Parallelized document fetching (Driver and Bus)
 * - Removed external geocoding dependencies (Nominatim)
 * - Parallelized Supabase state initialization
 * - Non-blocking background notifications and broadcasts
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, routeId } = body as any;
    const driverUid = auth.uid;

    const supabase = getSupabaseServer();

    // 1. Parallelize Supabase fetching (Driver, Bus, Assignments, Profile)
    const [activeTripResult, busResult, assignedDriverUid, driverProfileResult] = await Promise.all([
      supabase.from('active_trips').select('driver_id, bus_id').eq('driver_id', driverUid).eq('status', 'active').maybeSingle(),
      supabase.from('buses').select('id, bus_number, route_id, route_name, driver_uid').eq('id', busId).maybeSingle(),
      getDriverUidByBusId(busId),
      supabase.from('driver_profiles').select('bus_id, route_id').eq('uid', driverUid).maybeSingle()
    ]);

    const busData = busResult.data;
    if (!busData) return NextResponse.json({ error: 'Bus not found' }, { status: 404 });

    const driverHasActiveTrip = activeTripResult.data?.bus_id === busId;
    const busClaimsDriver = assignedDriverUid === driverUid || busData.driver_uid === driverUid;
    const profileClaimsBus = driverProfileResult.data?.bus_id === busId;

    if (!driverHasActiveTrip && !busClaimsDriver && !profileClaimsBus) {
      return NextResponse.json({ error: 'Driver is not assigned to this bus' }, { status: 403 });
    }

    const requestedTripId = crypto.randomUUID();
    const lockResult = await tripLockService.startTrip(driverUid, busId, routeId, 'both', requestedTripId);
    if (!lockResult.success) {
      return NextResponse.json(
        { error: lockResult.reason || 'Lock acquisition failed', errorCode: lockResult.errorCode },
        { status: lockResult.errorCode === 'LOCKED_BY_OTHER' ? 409 : 500 }
      );
    }

    const tripId = lockResult.tripId || requestedTripId;
    const isExistingTrip = tripId !== requestedTripId;

    // 2. State Initialization
    const effectiveRouteId = routeId || busData?.route_id || driverProfileResult.data?.route_id || 'unassigned_route';
    const stops = (busData as any)?.route?.stops || (busData as any)?.stops || [];
    const rawRouteName = (busData as any)?.route_name || effectiveRouteId;
    const routeName = formatIdForDisplay(rawRouteName);
    const busNumber = formatIdForDisplay(busData?.bus_number || busId);
    const nowIso = new Date().toISOString();

    // 3. Fire-and-forget Broadcasts and Notifications
    if (!isExistingTrip) (async () => {
        try {
            const channel = supabase.channel(`trip-status-${busId}`);
            await channel.subscribe();
            await channel.send({
                type: 'broadcast', event: 'trip_started',
                payload: { busId, routeId, driverUid, tripId, routeName, busNumber, timestamp: nowIso }
            });
            await supabase.removeChannel(channel);

            await notifyRoute({ routeId, tripId, routeName: routeName as string, busId });
        } catch (e) {
            console.error('Non-critical notification/broadcast failed:', e);
        }
    })();

    const elapsed = Date.now() - startTime;
    return NextResponse.json({
      success: true,
      message: isExistingTrip ? 'Journey already active' : 'Journey started successfully',
      tripId,
      busId,
      routeId,
      timestamp: nowIso,
      processingTimeMs: elapsed
    });
  },
  {
    requiredRoles: ['driver'],
    schema: StartTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true
  }
);
