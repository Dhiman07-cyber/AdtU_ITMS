import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations, normalizeBusId } from '@/lib/utils';

type BusRow = { id: string; bus_number?: string | null; route_id?: string | null; route_name?: string | null; status?: string | null };

export interface TripPreflightResult {
  authorized: boolean;
  reason?: string;
  busData?: BusRow;
  conflict: boolean;
  existingTripId?: string;
  handover?: boolean;
  previousDriverId?: string;
  handoverFromTripId?: string;
}

/**
 * Single-round-trip preflight check for startTrip.
 * Fires buses + active_trips queries IN PARALLEL (was 3 serial queries before).
 *   - buses: bus existence, status, route assignment
 *   - active_trips: current lock + conflict detection
 */
export async function tripStartPreflight(driverId: string, busId: string): Promise<TripPreflightResult> {
  const supabase = getSupabaseServer();
  const busVariations = getBusIdVariations(busId);

  const busQuery = supabase.from('buses').select('id, bus_number, route_id, route_name, status, primary_driver_uid, assigned_driver_id');
  let busBuilder: any = typeof (busQuery as any).in === 'function'
    ? (busQuery as any).in('id', busVariations)
    : (busQuery as any).eq('id', busId);
  if (typeof busBuilder?.limit === 'function') {
    busBuilder = busBuilder.limit(1);
  }
  const busPromise = typeof busBuilder?.maybeSingle === 'function'
    ? busBuilder.maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const tripQuery = supabase.from('active_trips').select('trip_id, driver_id, bus_id, expires_at');
  let tripBuilder: any = typeof (tripQuery as any).in === 'function'
    ? (tripQuery as any).in('bus_id', busVariations)
    : (tripQuery as any).eq('bus_id', busId);
  if (typeof tripBuilder?.eq === 'function') {
    tripBuilder = tripBuilder.eq('status', 'active');
  }
  if (typeof tripBuilder?.limit === 'function') {
    tripBuilder = tripBuilder.limit(1);
  }
  const tripPromise = typeof tripBuilder?.maybeSingle === 'function'
    ? tripBuilder.maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [busResult, tripResult, driverTripResult, driverProfileResult] = await Promise.all([
    busPromise,
    tripPromise,
    supabase.from('active_trips').select('trip_id, bus_id, expires_at').eq('driver_id', driverId).eq('status', 'active').limit(1).maybeSingle(),
    supabase.from('driver_profiles').select('uid, bus_id, assigned_bus_id, status, is_reserved').eq('uid', driverId).maybeSingle(),
  ]);

  const busData = busResult.data;
  if (!busData) return { authorized: false, reason: 'Bus not found', conflict: false };
  if (busData.status === 'inactive' || busData.status === 'maintenance') {
    return { authorized: false, reason: `Bus is currently ${busData.status} and cannot start a trip`, conflict: false };
  }

  // Check driver assignment (compare using normalized bus IDs)
  const driverProfile = driverProfileResult?.data;
  if (driverProfile) {
    const driverBusId = driverProfile.assigned_bus_id || driverProfile.bus_id;
    if (driverBusId && !driverProfile.is_reserved && normalizeBusId(driverBusId) !== normalizeBusId(busId)) {
      return {
        authorized: false,
        reason: `You are assigned to bus ${driverBusId}, but attempting to start a trip on bus ${busId}`,
        busData,
        conflict: false,
      };
    }
  }

  // 1. Check if the driver is already participating in an active trip on another vehicle (Invariant 1)
  const driverActiveTrip = driverTripResult?.data;
  if (driverActiveTrip && normalizeBusId(driverActiveTrip.bus_id) !== normalizeBusId(busId)) {
    const isDriverExpired = driverActiveTrip.expires_at ? Date.now() > new Date(driverActiveTrip.expires_at).getTime() : false;
    if (!isDriverExpired) {
      return {
        authorized: false,
        reason: 'You are currently operating an active trip on another bus. End your active trip before starting a new one.',
        busData,
        conflict: true,
        existingTripId: driverActiveTrip.trip_id,
      };
    }
  }

  const activeTrip = tripResult?.data;

  // No active trip — bus is free
  if (!activeTrip) {
    return { authorized: true, busData, conflict: false };
  }

  // Same driver — idempotent re-entry
  if (activeTrip.driver_id === driverId) {
    return { authorized: true, busData, conflict: false, existingTripId: activeTrip.trip_id };
  }

  // Different driver — seamless atomic handover! Driver 2 can take over the bus in 0 seconds.
  return {
    authorized: true,
    busData,
    conflict: false,
    handover: true,
    previousDriverId: activeTrip.driver_id,
    handoverFromTripId: activeTrip.trip_id,
  };
}

/** Backward-compat wrapper — used by external callers */
export async function verifyDriverBusAssignment(driverId: string, busId: string): Promise<{ authorized: boolean; reason?: string; busData?: BusRow }> {
  const result = await tripStartPreflight(driverId, busId);
  return { authorized: result.authorized, reason: result.reason, busData: result.busData };
}

/** Backward-compat wrapper — used by external callers */
export async function checkNoConflict(busId: string, driverId: string): Promise<{ conflict: boolean; reason?: string; existingTripId?: string }> {
  const result = await tripStartPreflight(driverId, busId);
  return { conflict: result.conflict, reason: result.reason, existingTripId: result.existingTripId };
}

export async function resolveRouteId(busId: string, preferredRouteId?: string): Promise<string> {
  if (preferredRouteId) return preferredRouteId;
  const supabase = getSupabaseServer();
  const busVariations = getBusIdVariations(busId);
  let routeQuery: any = supabase.from('buses').select('route_id');
  if (typeof routeQuery?.in === 'function') {
    routeQuery = routeQuery.in('id', busVariations);
  } else if (typeof routeQuery?.eq === 'function') {
    routeQuery = routeQuery.eq('id', busId);
  }
  if (typeof routeQuery?.limit === 'function') {
    routeQuery = routeQuery.limit(1);
  }
  const { data: bus } = typeof routeQuery?.maybeSingle === 'function' ? await routeQuery.maybeSingle() : { data: null };
  if (!bus?.route_id) {
    throw new Error(`Bus ${busId} is not assigned to a valid route.`);
  }
  return bus.route_id;
}

const routeNamesCache = new Map<string, { name: string; expiresAt: number }>();
const pendingResolutions = new Map<string, Promise<string>>();
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;

export async function resolveRouteName(routeId: string): Promise<string> {
  if (!routeId) return 'your route';

  const cached = routeNamesCache.get(routeId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  // Prevent thundering herd on concurrent cache misses
  const existing = pendingResolutions.get(routeId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const supabase = getSupabaseServer();
      const { data: route } = await supabase.from('routes').select('name, route_name').eq('id', routeId).maybeSingle();
      const resolvedName = route?.name || route?.route_name || routeId;

      if (routeNamesCache.size > 500) {
        routeNamesCache.clear();
      }
      routeNamesCache.set(routeId, { name: resolvedName, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });

      return resolvedName;
    } finally {
      pendingResolutions.delete(routeId);
    }
  })();

  pendingResolutions.set(routeId, promise);
  return promise;
}
