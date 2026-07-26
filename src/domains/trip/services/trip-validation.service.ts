import { getSupabaseServer } from '@/lib/supabase-server';
import { getDriverUidByBusId, getBusIdByDriverUid } from '@/domains/assignment';

type BusRow = { id: string; driver_uid?: string | null; bus_number?: string | null; route_id?: string | null; route_name?: string | null; status?: string | null };

export async function verifyDriverBusAssignment(driverId: string, busId: string): Promise<{ authorized: boolean; reason?: string; busData?: BusRow }> {
  const supabase = getSupabaseServer();
  const [busResult, assignedDriverUid, driverAssignedBusId] = await Promise.all([
    supabase.from('buses').select('id, driver_uid, bus_number, route_id, route_name, status').eq('id', busId).maybeSingle(),
    getDriverUidByBusId(busId),
    getBusIdByDriverUid(driverId),
  ]);

  const busData = busResult.data;
  if (!busData) return { authorized: false, reason: 'Bus not found' };
  if (busData.status === 'inactive') return { authorized: false, reason: 'Bus is inactive' };

  const { data: activeTrip } = await supabase
    .from('active_trips')
    .select('bus_id, driver_id')
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  const driverClaimsBus = activeTrip?.bus_id === busId;
  const busClaimsDriver = assignedDriverUid === driverId || busData.driver_uid === driverId;
  const profileClaimsBus = driverAssignedBusId === busId;

  if (!driverClaimsBus && !busClaimsDriver && !profileClaimsBus) {
    return { authorized: false, reason: 'Driver is not assigned to this bus' };
  }

  return { authorized: true, busData };
}

export async function checkNoConflict(busId: string, driverId: string): Promise<{ conflict: boolean; reason?: string; existingTripId?: string }> {
  const supabase = getSupabaseServer();
  const { data: activeTrip } = await supabase
    .from('active_trips')
    .select('trip_id, driver_id')
    .eq('bus_id', busId)
    .eq('status', 'active')
    .maybeSingle();

  if (!activeTrip) return { conflict: false };
  if (activeTrip.driver_id === driverId) {
    return { conflict: false, existingTripId: activeTrip.trip_id };
  }
  return { conflict: true, reason: 'This bus is currently being operated by another driver', existingTripId: activeTrip.trip_id };
}

export async function resolveRouteId(busId: string, preferredRouteId?: string): Promise<string> {
  if (preferredRouteId) return preferredRouteId;
  const supabase = getSupabaseServer();
  const { data: bus } = await supabase.from('buses').select('route_id').eq('id', busId).maybeSingle();
  return bus?.route_id || 'unassigned_route';
}

export async function resolveRouteName(routeId: string): Promise<string> {
  if (routeId === 'unassigned_route') return 'your route';
  const supabase = getSupabaseServer();
  const { data: route } = await supabase.from('routes').select('name, route_name').eq('id', routeId).maybeSingle();
  return route?.name || route?.route_name || routeId;
}
