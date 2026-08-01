import { getSupabaseServer } from '@/lib/supabase-server';

type BusRow = { id: string; bus_number?: string | null; route_id?: string | null; route_name?: string | null; status?: string | null };

export interface TripPreflightResult {
  authorized: boolean;
  reason?: string;
  busData?: BusRow;
  conflict: boolean;
  existingTripId?: string;
}

/**
 * Single-round-trip preflight check for startTrip.
 * Fires buses + active_trips queries IN PARALLEL (was 3 serial queries before).
 *   - buses: bus existence, status, route assignment
 *   - active_trips: current lock + conflict detection
 */
export async function tripStartPreflight(driverId: string, busId: string): Promise<TripPreflightResult> {
  const supabase = getSupabaseServer();

  const [busResult, tripResult] = await Promise.all([
    supabase.from('buses').select('id, bus_number, route_id, route_name, status').eq('id', busId).maybeSingle(),
    supabase.from('active_trips').select('trip_id, driver_id, expires_at').eq('bus_id', busId).eq('status', 'active').maybeSingle(),
  ]);

  const busData = busResult.data;
  if (!busData) return { authorized: false, reason: 'Bus not found', conflict: false };
  if (busData.status === 'inactive') return { authorized: false, reason: 'Bus is inactive', conflict: false };

  const activeTrip = tripResult.data;

  // No active trip — bus is free
  if (!activeTrip) {
    return { authorized: true, busData, conflict: false };
  }

  // Same driver — idempotent re-entry
  if (activeTrip.driver_id === driverId) {
    return { authorized: true, busData, conflict: false, existingTripId: activeTrip.trip_id };
  }

  // Different driver — check lock expiry
  const isExpired = activeTrip.expires_at ? Date.now() > new Date(activeTrip.expires_at).getTime() : false;
  if (isExpired) {
    return { authorized: true, busData, conflict: false };
  }

  return {
    authorized: false,
    reason: 'This bus is currently being operated by another driver',
    busData,
    conflict: true,
    existingTripId: activeTrip.trip_id,
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
  const { data: bus } = await supabase.from('buses').select('route_id').eq('id', busId).maybeSingle();
  if (!bus?.route_id) {
    throw new Error(`Bus ${busId} is not assigned to a valid route.`);
  }
  return bus.route_id;
}

const routeNamesCache = new Map<string, { name: string; expiresAt: number }>();
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;

export async function resolveRouteName(routeId: string): Promise<string> {
  if (!routeId) return 'your route';

  const cached = routeNamesCache.get(routeId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  const supabase = getSupabaseServer();
  const { data: route } = await supabase.from('routes').select('name, route_name').eq('id', routeId).maybeSingle();
  const resolvedName = route?.name || route?.route_name || routeId;

  if (routeNamesCache.size > 500) {
    routeNamesCache.clear();
  }
  routeNamesCache.set(routeId, { name: resolvedName, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });

  return resolvedName;
}
