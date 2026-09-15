import { getSupabaseServer } from '@/lib/supabase-server';

// Negative cache only (to mitigate brute-force/unauthorized flood without risking stale positive state)
// Positive trip validity is ALWAYS verified directly against authoritative PostgreSQL active_trips,
// guaranteeing that the microsecond end_trip_atomically commits in the database, ALL nodes reject subsequent GPS updates.
const negativeLockCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 2_000; // 2 seconds

export function invalidateActiveTripCache(busId?: string, driverId?: string): void {
  if (busId && driverId) {
    negativeLockCache.delete(`${driverId}:${busId}`);
    negativeLockCache.delete(`${busId}:${driverId}`);
  } else if (busId || driverId) {
    const target = busId || driverId;
    for (const key of negativeLockCache.keys()) {
      if (key.includes(target!)) {
        negativeLockCache.delete(key);
      }
    }
  } else {
    negativeLockCache.clear();
  }
}

export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string }> {
  const cacheKey = `${driverId}:${busId}`;
  const now = Date.now();

  // Check negative cache first (if recently confirmed nonexistent, reject immediately)
  const negativeUntil = negativeLockCache.get(cacheKey);
  if (negativeUntil && (now < negativeUntil)) {
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
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
    negativeLockCache.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    if (negativeLockCache.size > 5000) {
      const firstKey = negativeLockCache.keys().next().value;
      if (firstKey) negativeLockCache.delete(firstKey);
    }
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  if (tripId && activeTrip.trip_id !== tripId) {
    return { valid: false, reason: 'Trip mismatch for location update' };
  }

  // Active trip confirmed from authoritative PostgreSQL.
  // Clear any stale negative cache entry.
  negativeLockCache.delete(cacheKey);

  return { valid: true };
}

