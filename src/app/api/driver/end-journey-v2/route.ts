/**
 * POST /api/driver/end-journey-v2
 * 
 * End trip with comprehensive event-driven cleanup:
 * - Immediate cleanup of ALL trip-related Supabase tables
 * - Parallel Supabase cleanup
 * - Broadcast notifications
 * - FCM notifications to students
 * - Stale FCM token auto-removal
 */

import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { tripLockService } from '@/lib/services/trip-lock-service';
import { withSecurity } from '@/lib/security/api-security';
import { EndTripSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { notifyRoute } from '@/lib/services/fcm-notification-service';
import { formatIdForDisplay } from '@/lib/utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface CleanupStats {
  busLocations: number;
  waitingFlags: number;
  driverLocationUpdates: number;
  activeTrips: number;
  driverStatus: number;
  missedBusRequests: number;
  deviceSessions: number;
  totalTime: number;
}

/**
 * Comprehensive Supabase cleanup — ALL trip-related tables
 * 
 * Tables cleaned on trip end:
 * 1. bus_locations        — Delete all location rows for this bus
 * 2. driver_location_updates — Delete historical breadcrumbs
 * 3. waiting_flags        — Delete raised/acknowledged flags for this bus
 * 4. active_trips         — DELETE rows for this bus/driver
 * 5. driver_status        — Delete driver status row entirely
 * 6. missed_bus_requests  — Expire any pending requests linked to this bus/trip
 * 7. device_sessions      — Clean up driver's device sessions
 */
async function cleanupSupabase(
  supabase: any,
  busId: string,
  routeId: string,
  tripId: string | null,
  driverUid: string
): Promise<Partial<CleanupStats>> {
  console.log('🧹 Starting COMPREHENSIVE Supabase cleanup...');
  const startTime = Date.now();
  const stats: Partial<CleanupStats> = {};

  // Execute all cleanup operations in parallel
  const results = await Promise.allSettled([
    // 1. Delete bus_locations for this bus (current state)
    (tripId
      ? supabase.from('bus_locations').delete().eq('bus_id', busId).eq('trip_id', tripId)
      : supabase.from('bus_locations').delete().eq('bus_id', busId).eq('driver_uid', driverUid)
    )
      .then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error deleting bus_locations:', error);
        else {
          stats.busLocations = count || 0;
          console.log(`✅ Deleted ${count || 0} bus_locations`);
        }
      }),

    // 2. Delete driver_location_updates for this bus (historical trail)
    supabase
      .from('driver_location_updates')
      .delete()
      .eq('bus_id', busId)
      .eq('driver_uid', driverUid)
      .then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error deleting driver_location_updates:', error);
        else {
          stats.driverLocationUpdates = count || 0;
          console.log(`✅ Deleted ${count || 0} driver_location_updates`);
        }
      }),

    // 3. Delete/expire waiting_flags (raised or acknowledged)
    (tripId
      ? supabase.from('waiting_flags').delete().eq('bus_id', busId).eq('trip_id', tripId).in('status', ['raised', 'acknowledged'])
      : supabase.from('waiting_flags').delete().eq('bus_id', busId).in('status', ['raised', 'acknowledged'])
    ).then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error deleting waiting_flags:', error);
        else {
          stats.waitingFlags = count || 0;
          console.log(`✅ Deleted ${count || 0} waiting_flags`);
        }
      }),

    // 5. DELETE this driver's status row only
    (tripId
      ? supabase.from('driver_status').delete().eq('driver_uid', driverUid).eq('trip_id', tripId)
      : supabase.from('driver_status').delete().eq('driver_uid', driverUid)
    )
      .then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error deleting driver_status:', error);
        else {
          stats.driverStatus = count || 0;
          console.log(`✅ Deleted ${count || 0} driver_status row(s)`);
        }
      }),

    // 5b. Also delete driver_status by driver_uid (safety fallback)
    supabase
      .from('driver_status')
      .delete()
      .eq('driver_uid', driverUid)
      .eq('trip_id', tripId || '')
      .then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error deleting driver_status by driver_uid:', error);
        else console.log(`✅ Deleted ${count || 0} driver_status row(s) by driver_uid`);
      }),

    // 6. Expire any pending missed_bus_requests that reference this bus's route
    //    These are no longer actionable once the trip has ended
    supabase
      .from('missed_bus_requests')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .eq('route_id', routeId)
      .then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error expiring missed_bus_requests:', error);
        else {
          stats.missedBusRequests = count || 0;
          console.log(`✅ Expired ${count || 0} missed_bus_requests`);
        }
      }),

    // 7. Clean up device sessions for this driver
    supabase
      .from('device_sessions')
      .delete()
      .eq('user_id', driverUid)
      .then(({ count, error }: { count: number | null, error: any }) => {
        if (error) console.error('❌ Error deleting device_sessions:', error);
        else {
          stats.deviceSessions = count || 0;
          console.log(`✅ Deleted ${count || 0} device_sessions`);
        }
      })
  ]);

  // Check for rejected promises
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`❌ Cleanup task ${index + 1} failed:`, result.reason);
    }
  });

  const elapsed = Date.now() - startTime;
  console.log(`🎉 Supabase cleanup completed in ${elapsed}ms`);

  return { ...stats, totalTime: elapsed };
}

/**
 * Broadcast trip end to all channels
 */
async function broadcastTripEnd(
  supabase: any,
  busId: string,
  tripId: string,
  busNumber: string
): Promise<void> {
  console.log('📢 Broadcasting trip end events...');

  // Broadcast to multiple channels for different subscribers
  const channels = [
    `trip-status-${busId}`,
    `bus_${busId}_students`,
    `bus_location_${busId}`
  ];

  const payload = {
    busId,
    tripId,
    busNumber,
    event: 'trip_ended',
    timestamp: new Date().toISOString()
  };

  for (const channelName of channels) {
    try {
      // NOTE: channel.httpSend(...) was used here previously but is NOT a method on
      // RealtimeChannel — it threw every time and was swallowed by this catch, so the
      // SERVER never actually notified students of trip end (it only worked because the
      // driver's browser also broadcasts trip_ended + students poll trip-status every 30s).
      // Use the same subscribe → send → removeChannel pattern that start-journey-v2 uses so
      // trip end propagates reliably from the server even if the driver's device drops off
      // immediately after the API call.
      const channel = supabase.channel(channelName);
      await channel.subscribe();
      await channel.send({ type: 'broadcast', event: 'trip_ended', payload });
      await supabase.removeChannel(channel);
      console.log(`✅ Broadcast sent to ${channelName}`);
    } catch (broadcastErr) {
      console.warn(`⚠️ Broadcast to ${channelName} failed (non-critical):`, broadcastErr);
    }
  }
}

// sendTripEndFCM removed: we now use the centralized notifyRoute from fcm-notification-service.ts which is 100% reliable and handles both token subcollections and route fallbacks.
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, tripId } = body as any;
    const driverUid = auth.uid;

    // Initialize Supabase client
    if (!supabaseUrl || !supabaseKey) {
      console.error("❌ Missing Supabase credentials in end-journey-v2");
      return NextResponse.json(
        { error: 'Server configuration error: Missing Supabase credentials' },
        { status: 500 }
      );
    }

    // Create client inside handler
    const supabase = getSupabaseServer();

    console.log(`🏁 Ending journey for bus ${busId}, trip ${tripId || 'current'}...`);

    // 1. D9: Read bus metadata from Supabase instead of Firestore
    const { data: busData } = await supabase
      .from('buses')
      .select('id, bus_number, route_id, route_name, driver_uid')
      .eq('id', busId)
      .maybeSingle();

    if (!busData) return NextResponse.json({ error: 'Bus not found' }, { status: 404 });

    let activeTripId = tripId;

    if (!activeTripId) {
      const { data: activeTrip } = await supabase
        .from('active_trips')
        .select('trip_id, route_id')
        .eq('bus_id', busId)
        .eq('driver_id', driverUid)
        .eq('status', 'active')
        .maybeSingle();

      activeTripId = activeTrip?.trip_id || null;
    }

    const rawBusNumber = busData.bus_number || busId;
    const busNumber = formatIdForDisplay(rawBusNumber);
    const routeId = busData.route_id || busId;
    const rawRouteName = busData.route_name || `Route for Bus ${busNumber}`;
    const routeName = formatIdForDisplay(rawRouteName);

    // D9: Lock verification via active_trips instead of Firestore activeTripLock
    if (activeTripId) {
      const { data: lockTrip } = await supabase
        .from('active_trips')
        .select('driver_id, status, expires_at')
        .eq('trip_id', activeTripId)
        .eq('bus_id', busId)
        .eq('status', 'active')
        .maybeSingle();

      if (lockTrip && lockTrip.driver_id && lockTrip.driver_id !== driverUid) {
        // Check if lock has expired
        const isExpired = lockTrip.expires_at && Date.now() > new Date(lockTrip.expires_at).getTime();
        if (!isExpired) {
          return NextResponse.json({ error: 'Not the lock holder', errorCode: 'NOT_LOCK_HOLDER' }, { status: 403 });
        }
      }
    }

    if (activeTripId) {
      const endResult = await tripLockService.endTrip(activeTripId, driverUid, busId);
      if (!endResult.success) {
        return NextResponse.json({ error: endResult.reason || 'Failed to end trip' }, { status: 403 });
      }
    }

    // 2. Parallelize cleanup and notifications after the durable trip state is ended.
    const finalizationTasks: any[] = [
        // Supabase: Comprehensive Cleanup
        cleanupSupabase(supabase, busId, routeId, activeTripId, driverUid),
    ];

    if (activeTripId) {
      finalizationTasks.push(
        broadcastTripEnd(supabase, busId, activeTripId, busNumber),
        notifyRoute({
          routeId,
          tripId: activeTripId, routeName, busId, eventType: 'TRIP_ENDED'
        })
      );
    }

    const taskResults = await Promise.allSettled(finalizationTasks);
    
    // Extract stats from cleanup task (index 0)
    const supabaseStats = taskResults[0].status === 'fulfilled' ? (taskResults[0].value as any) : {};
    
    const totalElapsed = Date.now() - startTime;

    // Prepare cleanup summary
    const cleanupSummary = {
      busLocations: supabaseStats.busLocations || 0,
      waitingFlags: supabaseStats.waitingFlags || 0,
      driverLocationUpdates: supabaseStats.driverLocationUpdates || 0,
      activeTrips: activeTripId ? 1 : 0,
      driverStatus: supabaseStats.driverStatus || 0,
      missedBusRequests: supabaseStats.missedBusRequests || 0,
      deviceSessions: supabaseStats.deviceSessions || 0,
      supabaseTime: supabaseStats.totalTime || 0,
      totalTime: totalElapsed
    };

    console.log('\n📊 CLEANUP SUMMARY:');
    console.log(`  Bus Locations: ${cleanupSummary.busLocations}`);
    console.log(`  Waiting Flags: ${cleanupSummary.waitingFlags}`);
    console.log(`  Location Updates: ${cleanupSummary.driverLocationUpdates}`);
    console.log(`  Active Trips Ended: ${cleanupSummary.activeTrips}`);
    console.log(`  Driver Status: ${cleanupSummary.driverStatus}`);
    console.log(`  Missed Bus Requests: ${cleanupSummary.missedBusRequests}`);
    console.log(`  Device Sessions: ${cleanupSummary.deviceSessions}`);
    console.log(`  Supabase Time: ${cleanupSummary.supabaseTime}ms`);
    console.log(`  Total Time: ${cleanupSummary.totalTime}ms`);
    console.log('\n✅ Journey ended successfully with COMPLETE cleanup!\n');

    return NextResponse.json({
      success: true,
      message: 'Journey ended successfully',
      tripId: activeTripId,
      busId,
      cleanupStats: cleanupSummary,
      timestamp: new Date().toISOString()
    });
  },
  {
    requiredRoles: ['driver'],
    schema: EndTripSchema,
    rateLimit: RateLimits.CREATE, // Prevent spam
    allowBodyToken: true
  }
);
