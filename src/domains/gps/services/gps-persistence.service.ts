import { getSupabaseServer } from '@/lib/supabase-server';

// Negative and short positive cache to mitigate PostgREST query flood while ensuring
// trips ending via trip-orchestrator immediately purge cache via invalidateActiveTripCache().
const negativeLockCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 2_000; // 2 seconds

interface PositiveTripLock {
  tripId: string;
  expiresAtMs: number;
  cachedUntilMs: number;
}
const positiveLockCache = new Map<string, PositiveTripLock>();
const POSITIVE_CACHE_TTL_MS = 6_000; // 6 seconds: absorbs 3 GPS pings at 2s cadence

export function invalidateActiveTripCache(busId?: string, driverId?: string): void {
  const purgeKeys = (map: Map<string, any>) => {
    if (busId && driverId) {
      map.delete(`${driverId}:${busId}`);
      map.delete(`${busId}:${driverId}`);
    } else if (busId || driverId) {
      const target = busId || driverId;
      for (const key of map.keys()) {
        if (key.includes(target!)) {
          map.delete(key);
        }
      }
    } else {
      map.clear();
    }
  };

  purgeKeys(negativeLockCache);
  purgeKeys(positiveLockCache);
}

export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string }> {
  const cacheKey = `${driverId}:${busId}`;
  const now = Date.now();

  // Check negative cache first (if recently confirmed nonexistent, reject immediately)
  const negativeUntil = negativeLockCache.get(cacheKey);
  if (negativeUntil && (now < negativeUntil)) {
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  // Check positive cache (absorbs 66% of high-frequency GPS query load during steady-state driving)
  const positiveEntry = positiveLockCache.get(cacheKey);
  if (positiveEntry && now < positiveEntry.cachedUntilMs) {
    if (positiveEntry.expiresAtMs <= now) {
      positiveLockCache.delete(cacheKey);
      negativeLockCache.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
      return { valid: false, reason: 'Active trip lock has expired' };
    }
    if (tripId && positiveEntry.tripId !== tripId) {
      return { valid: false, reason: 'Trip mismatch for location update' };
    }
    return { valid: true };
  }

  const supabase = getSupabaseServer();

  const { data: activeTrip, error } = await supabase
    .from('active_trips')
    .select('trip_id, route_id, driver_id, status, expires_at')
    .eq('bus_id', busId)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !activeTrip) {
    positiveLockCache.delete(cacheKey);
    negativeLockCache.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    if (negativeLockCache.size > 5000) {
      const firstKey = negativeLockCache.keys().next().value;
      if (firstKey) negativeLockCache.delete(firstKey);
    }
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  const expiresAtMs = activeTrip.expires_at ? new Date(activeTrip.expires_at).getTime() : now + 600_000;
  if (expiresAtMs <= now) {
    positiveLockCache.delete(cacheKey);
    negativeLockCache.set(cacheKey, now + NEGATIVE_CACHE_TTL_MS);
    return { valid: false, reason: 'Active trip lock has expired' };
  }

  if (tripId && activeTrip.trip_id !== tripId) {
    return { valid: false, reason: 'Trip mismatch for location update' };
  }

  // Active trip confirmed from authoritative PostgreSQL.
  // Clear any stale negative cache entry and populate short-lived positive cache.
  negativeLockCache.delete(cacheKey);
  positiveLockCache.set(cacheKey, {
    tripId: activeTrip.trip_id,
    expiresAtMs,
    cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
  });
  if (positiveLockCache.size > 5000) {
    const firstKey = positiveLockCache.keys().next().value;
    if (firstKey) positiveLockCache.delete(firstKey);
  }

  return { valid: true };
}

