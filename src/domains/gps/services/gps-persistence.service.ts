import { getSupabaseServer } from '@/lib/supabase-server';

interface CachedTripLock {
  valid: boolean;
  tripId: string;
  cachedAt: number;
}

const tripLockCache = new Map<string, CachedTripLock>();
const CACHE_TTL_MS = 10_000; // 10 seconds

export function invalidateActiveTripCache(busId?: string, driverId?: string): void {
  if (busId && driverId) {
    tripLockCache.delete(`${driverId}:${busId}`);
    tripLockCache.delete(`${busId}:${driverId}`);
  } else if (busId || driverId) {
    const target = busId || driverId;
    for (const key of tripLockCache.keys()) {
      if (key.includes(target!)) {
        tripLockCache.delete(key);
      }
    }
  } else {
    tripLockCache.clear();
  }
}

export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string }> {
  const cacheKey = `${driverId}:${busId}`;
  const now = Date.now();
  const cached = tripLockCache.get(cacheKey);

  if (cached && (now - cached.cachedAt < CACHE_TTL_MS)) {
    if (tripId && cached.tripId !== tripId) {
      return { valid: false, reason: 'Trip mismatch for location update' };
    }
    return { valid: cached.valid };
  }

  const supabase = getSupabaseServer();

  const { data: activeTrip, error } = await supabase
    .from('active_trips')
    .select('trip_id, route_id, driver_id, status')
    .eq('bus_id', busId)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !activeTrip) {
    tripLockCache.delete(cacheKey);
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  if (tripId && activeTrip.trip_id !== tripId) {
    return { valid: false, reason: 'Trip mismatch for location update' };
  }

  if (tripLockCache.size > 5000) {
    const firstKey = tripLockCache.keys().next().value;
    if (firstKey) tripLockCache.delete(firstKey);
  }

  tripLockCache.set(cacheKey, {
    valid: true,
    tripId: activeTrip.trip_id,
    cachedAt: now,
  });

  return { valid: true };
}

