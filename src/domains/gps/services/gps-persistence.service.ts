import { getSupabaseServer } from '@/lib/supabase-server';
import { shouldWriteLocationBreadcrumb } from '@/lib/services/location-write-throttle';
import type { LocationUpdateNormalized } from './types';

export async function persistLocation(n: LocationUpdateNormalized): Promise<boolean> {
  const supabase = getSupabaseServer();
  const timestampIso = n.timestamp.toISOString();

  const busLocationWrite = supabase.from('bus_locations').insert({
    bus_id: n.busId,
    route_id: n.routeId,
    driver_uid: n.driverId,
    lat: n.lat,
    lng: n.lng,
    accuracy: n.accuracy,
    speed: n.speed,
    heading: n.heading,
    timestamp: timestampIso,
    trip_id: n.tripId,
    is_snapshot: false,
  });

  const writeBreadcrumb = shouldWriteLocationBreadcrumb(n.tripId, n.timestamp.getTime());
  const breadcrumbWrite = writeBreadcrumb
    ? supabase.from('driver_location_updates').insert({
        driver_uid: n.driverId,
        bus_id: n.busId,
        lat: n.lat,
        lng: n.lng,
        speed: n.speed,
        heading: n.heading,
        timestamp: timestampIso,
      })
    : Promise.resolve({ error: null });

  const results = await Promise.allSettled([busLocationWrite, breadcrumbWrite]);
  return !results.some(r => r.status === 'rejected');
}

export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string }> {
  const supabase = getSupabaseServer();
  const [statusResult, activeTripResult] = await Promise.all([
    supabase.from('driver_status').select('status, bus_id, trip_id').eq('driver_uid', driverId).maybeSingle(),
    supabase.from('active_trips').select('trip_id, route_id, driver_id, status').eq('bus_id', busId).eq('driver_id', driverId).eq('status', 'active').maybeSingle(),
  ]);

  if (statusResult.error || activeTripResult.error || !statusResult.data || !activeTripResult.data) {
    return { valid: false, reason: 'No active session found for this driver/bus' };
  }
  if (statusResult.data.bus_id !== busId || statusResult.data.status !== 'on_trip' || statusResult.data.trip_id !== activeTripResult.data.trip_id) {
    return { valid: false, reason: 'No active session found for this driver/bus' };
  }
  if (activeTripResult.data.trip_id !== tripId) {
    return { valid: false, reason: 'Trip mismatch for location update' };
  }
  return { valid: true };
}

export async function getLastLocation(busId: string, tripId: string): Promise<{ lat: number; lng: number; timestamp: string } | null> {
  const supabase = getSupabaseServer();
  const { data: lastLocations } = await supabase
    .from('bus_locations')
    .select('lat, lng, timestamp')
    .eq('bus_id', busId)
    .eq('trip_id', tripId)
    .order('timestamp', { ascending: false })
    .limit(1);
  return lastLocations && lastLocations.length > 0 ? lastLocations[0] : null;
}
