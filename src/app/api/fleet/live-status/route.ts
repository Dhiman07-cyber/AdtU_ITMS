import { getLastLocationForBus } from '@/domains/gps/services/gps-pipeline.service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

export interface FleetBusLiveStatus {
  busId: string;
  busNumber: string;
  model?: string | null;
  capacity?: number | null;
  currentMembers?: number | null;
  routeId?: string | null;
  routeName?: string | null;
  stops?: any[] | null;
  tripStatus: 'active' | 'inactive';
  tripId?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  shift?: string | null;
  startTime?: string | null;
  locationStatus: 'LIVE' | 'STALE' | 'NO_SIGNAL' | 'INACTIVE';
  location: {
    lat: number;
    lng: number;
    accuracy?: number | null;
    speed?: number | null;
    heading?: number | null;
    timestamp: string;
    ageSeconds: number;
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    // 1. Authorize admin or moderator
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // 2. Rate limiting
    const rl = await applyRateLimit(
      createRateLimitId(auth.uid, 'fleet-live-status'),
      RateLimits.READ
    );
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const supabase = getSupabaseServer();
    const now = Date.now();

    // Check if client explicitly requests all buses (default is active trips only)
    const showAll = request.nextUrl.searchParams.get('all') === 'true';

    // 3. Parallel fetch from PostgreSQL with exact schema-verified columns
    const [busesRes, routesRes, activeTripsRes, busLocationsRes, activeDriversRes] = await Promise.all([
      supabase
        .from('buses')
        .select('id, bus_number, model, capacity, current_members, driver_uid, driver_name, route_id, route_name, status')
        .order('bus_number', { ascending: true }),
      supabase
        .from('routes')
        .select('id, route_name, stops, total_stops'),
      supabase
        .from('active_trips')
        .select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, end_time, last_heartbeat, expires_at')
        .eq('status', 'active'),
      supabase
        .from('bus_locations')
        .select('bus_id, trip_id, driver_id, route_id, lat, lng, accuracy, speed, heading, timestamp'),
      supabase
        .from('driver_profiles')
        .select('uid, full_name, phone, bus_id, route_id, shift, trip_active, active_trip_id')
        .eq('trip_active', true),
    ]);

    if (busesRes.error) {
      console.error('Error fetching buses for fleet live status:', busesRes.error);
      return NextResponse.json(
        handleApiError(busesRes.error, 'fleet-live-status', 'Failed to fetch buses'),
        { status: 500 }
      );
    }

    const buses = busesRes.data || [];
    const routes = routesRes.data || [];
    const activeTrips = activeTripsRes.data || [];
    const dbLocations = busLocationsRes.data || [];
    const activeDrivers = activeDriversRes.data || [];

    // Map routes by id
    const routeMap = new Map<string, { id: string; route_name: string; stops?: any; total_stops?: number }>();
    for (const r of routes) {
      if (r.id) routeMap.set(r.id, r);
    }

    // Map active trips by bus_id
    const activeTripMap = new Map<string, any>();
    for (const trip of activeTrips) {
      const isStillActive = trip.expires_at ? new Date(trip.expires_at).getTime() > now : true;
      if (isStillActive && trip.bus_id) {
        activeTripMap.set(trip.bus_id, trip);
      }
    }

    // Map active drivers by bus_id
    const activeDriverMap = new Map<string, any>();
    for (const d of activeDrivers) {
      if (d.bus_id) {
        activeDriverMap.set(d.bus_id, d);
      }
    }

    // Map DB locations by bus_id
    const dbLocationMap = new Map<string, any>();
    for (const loc of dbLocations) {
      if (loc.bus_id) {
        dbLocationMap.set(loc.bus_id, loc);
      }
    }

    // Filter to active buses unless explicit 'all=true' requested
    const targetBuses = showAll
      ? buses
      : buses.filter((b: any) => {
          const busId = b.id;
          const busNumber = b.bus_number;
          return (
            activeTripMap.has(busId) ||
            activeTripMap.has(busNumber) ||
            activeDriverMap.has(busId) ||
            activeDriverMap.has(busNumber)
          );
        });

    let liveCount = 0;
    let staleCount = 0;
    let noSignalCount = 0;

    const enrichedBuses: FleetBusLiveStatus[] = targetBuses.map((b: any) => {
      const busId = b.id;
      const activeTrip = activeTripMap.get(busId) || activeTripMap.get(b.bus_number);
      const activeDriver = activeDriverMap.get(busId) || activeDriverMap.get(b.bus_number);
      const isTripActive = Boolean(activeTrip || activeDriver);

      // Check in-memory fast cache first, then DB location
      const memLoc = getLastLocationForBus(busId) || getLastLocationForBus(b.bus_number);
      const dbLoc = dbLocationMap.get(busId) || dbLocationMap.get(b.bus_number);

      // Pick latest
      let chosenLoc: any = null;
      if (memLoc && dbLoc) {
        const memTime = new Date(memLoc.timestamp).getTime();
        const dbTime = new Date(dbLoc.timestamp).getTime();
        chosenLoc = memTime >= dbTime ? memLoc : dbLoc;
      } else {
        chosenLoc = memLoc || dbLoc || null;
      }

      let locationStatus: 'LIVE' | 'STALE' | 'NO_SIGNAL' | 'INACTIVE' = 'INACTIVE';
      let locationObj: FleetBusLiveStatus['location'] = null;

      if (isTripActive) {
        if (!chosenLoc || !chosenLoc.lat || !chosenLoc.lng) {
          locationStatus = 'NO_SIGNAL';
          noSignalCount++;
        } else {
          const locTime = new Date(chosenLoc.timestamp).getTime();
          const ageMs = Math.max(0, now - locTime);
          const ageSeconds = Math.round(ageMs / 1000);

          if (ageMs <= 15000) {
            locationStatus = 'LIVE';
            liveCount++;
          } else if (ageMs <= 60000) {
            locationStatus = 'STALE';
            staleCount++;
          } else {
            locationStatus = 'NO_SIGNAL';
            noSignalCount++;
          }

          locationObj = {
            lat: Number(chosenLoc.lat),
            lng: Number(chosenLoc.lng),
            accuracy: chosenLoc.accuracy != null ? Number(chosenLoc.accuracy) : null,
            speed: chosenLoc.speed != null ? Number(chosenLoc.speed) : null,
            heading: chosenLoc.heading != null ? Number(chosenLoc.heading) : null,
            timestamp: chosenLoc.timestamp,
            ageSeconds,
          };
        }
      } else {
        locationStatus = 'INACTIVE';
        if (chosenLoc && chosenLoc.lat && chosenLoc.lng) {
          const locTime = new Date(chosenLoc.timestamp).getTime();
          const ageSeconds = Math.max(0, Math.round((now - locTime) / 1000));
          locationObj = {
            lat: Number(chosenLoc.lat),
            lng: Number(chosenLoc.lng),
            accuracy: chosenLoc.accuracy != null ? Number(chosenLoc.accuracy) : null,
            speed: chosenLoc.speed != null ? Number(chosenLoc.speed) : null,
            heading: chosenLoc.heading != null ? Number(chosenLoc.heading) : null,
            timestamp: chosenLoc.timestamp,
            ageSeconds,
          };
        }
      }

      const assignedRouteId = activeTrip?.route_id || activeDriver?.route_id || b.route_id;
      const matchedRoute = assignedRouteId ? routeMap.get(assignedRouteId) : null;

      return {
        busId,
        busNumber: b.bus_number,
        model: b.model || null,
        capacity: b.capacity || 55,
        currentMembers: b.current_members || 0,
        routeId: assignedRouteId || null,
        routeName: matchedRoute?.route_name || b.route_name || 'Unassigned Route',
        stops: matchedRoute?.stops || null,
        tripStatus: isTripActive ? 'active' : 'inactive',
        tripId: activeTrip?.trip_id || activeDriver?.active_trip_id || null,
        driverId: activeTrip?.driver_id || activeDriver?.uid || b.driver_uid || null,
        driverName: activeDriver?.full_name || b.driver_name || 'Assigned Driver',
        driverPhone: activeDriver?.phone || null,
        shift: activeTrip?.shift || activeDriver?.shift || null,
        startTime: activeTrip?.start_time || null,
        locationStatus,
        location: locationObj,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          buses: enrichedBuses,
          summary: {
            totalFleet: buses.length,
            activeTrips: enrichedBuses.filter((b) => b.tripStatus === 'active').length,
            liveSignal: liveCount,
            staleSignal: staleCount,
            noSignal: noSignalCount,
            inactiveUnits: buses.length - enrichedBuses.length,
          },
          timestamp: new Date().toISOString(),
        },
      },
      { headers: rl.headers }
    );
  } catch (error: any) {
    console.error('Unhandled error in fleet-live-status:', error);
    return NextResponse.json(
      handleApiError(error, 'fleet-live-status', 'Internal server error'),
      { status: 500 }
    );
  }
}
