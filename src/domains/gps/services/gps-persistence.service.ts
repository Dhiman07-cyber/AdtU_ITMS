import { getSupabaseServer } from '@/lib/supabase-server';
import { getRedisTripLock, setRedisTripLock, clearRedisTripLock } from './gps-redis-guard';
import { invalidateBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';

// Negative and short positive cache to mitigate PostgREST query flood while ensuring
// trips ending via trip-orchestrator immediately purge cache via invalidateActiveTripCache().
const negativeLockCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL_MS = 2_000; // 2 seconds

export interface PositiveTripLock {
  tripId: string;
  driverId: string;
  routeId?: string;
  shift?: string;
  deviceId?: string;
  expiresAtMs: number;
  cachedUntilMs: number;
}
const positiveLockCache = new Map<string, PositiveTripLock>();
const POSITIVE_CACHE_TTL_MS = 35_000; // 35 seconds: covers 30s heartbeat interval

export function setActiveTripCache(busId: string, data: { tripId: string; driverId: string; routeId?: string; shift?: string; deviceId?: string; expiresAtMs: number }): void {
  const cacheKey = `${data.driverId}:${busId}`;
  negativeLockCache.delete(cacheKey);

  // Preserve existing fields if omitted or undefined in data (Fix 1)
  const existing = positiveLockCache.get(cacheKey);
  const routeId = data.routeId || existing?.routeId;
  const shift = data.shift || existing?.shift;
  const deviceId = data.deviceId || existing?.deviceId;

  const mergedData = {
    tripId: data.tripId,
    driverId: data.driverId,
    routeId,
    shift,
    deviceId,
    expiresAtMs: data.expiresAtMs,
    cachedUntilMs: Date.now() + POSITIVE_CACHE_TTL_MS,
  };

  positiveLockCache.set(cacheKey, mergedData);
  setRedisTripLock(busId, mergedData).catch(() => {});
}

export function getPositiveTripLock(driverId: string, busId: string): PositiveTripLock | null {
  const cacheKey = `${driverId}:${busId}`;
  const entry = positiveLockCache.get(cacheKey);
  if (entry && Date.now() < entry.cachedUntilMs) {
    return entry;
  }
  return null;
}

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

  if (busId) {
    clearRedisTripLock(busId).catch(() => {});
  }
  invalidateBusTripSnapshot(busId);
}

export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string; tripId?: string; routeId?: string; shift?: string }> {
  const cacheKey = `${driverId}:${busId}`;
  const now = Date.now();

  // Check negative cache first (if recently confirmed nonexistent, reject immediately)
  const negativeUntil = negativeLockCache.get(cacheKey);
  if (negativeUntil && (now < negativeUntil)) {
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  // Check positive in-memory cache (absorbs high-frequency GPS query load during steady-state driving)
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
    positiveEntry.cachedUntilMs = now + POSITIVE_CACHE_TTL_MS;
    return { valid: true, tripId: positiveEntry.tripId, routeId: positiveEntry.routeId, shift: positiveEntry.shift };
  }

  // Multi-instance Redis check: Zero-DB read path across Next.js containers
  const redisLock = await getRedisTripLock(busId);
  if (redisLock) {
    if (redisLock.driverId === driverId && redisLock.expiresAtMs > now) {
      if (tripId && redisLock.tripId !== tripId) {
        return { valid: false, reason: 'Trip mismatch for location update' };
      }
      negativeLockCache.delete(cacheKey);
      positiveLockCache.set(cacheKey, {
        tripId: redisLock.tripId,
        driverId: redisLock.driverId,
        routeId: redisLock.routeId,
        shift: redisLock.shift,
        deviceId: redisLock.deviceId,
        expiresAtMs: redisLock.expiresAtMs,
        cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
      });
      return { valid: true, tripId: redisLock.tripId, routeId: redisLock.routeId, shift: redisLock.shift };
    }
  }

  const supabase = getSupabaseServer();

  const { data: activeTrip, error } = await supabase
    .from('active_trips')
    .select('trip_id, route_id, driver_id, shift, status, expires_at')
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
  // Populate Redis cache for cross-node 0-DB read path
  setRedisTripLock(busId, {
    tripId: activeTrip.trip_id,
    driverId,
    routeId: activeTrip.route_id,
    shift: activeTrip.shift,
    expiresAtMs,
  }).catch(() => {});

  // Clear any stale negative cache entry and populate short-lived positive cache.
  negativeLockCache.delete(cacheKey);
  positiveLockCache.set(cacheKey, {
    tripId: activeTrip.trip_id,
    driverId,
    routeId: activeTrip.route_id,
    shift: activeTrip.shift,
    expiresAtMs,
    cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
  });
  if (positiveLockCache.size > 5000) {
    const firstKey = positiveLockCache.keys().next().value;
    if (firstKey) positiveLockCache.delete(firstKey);
  }

  return { valid: true, tripId: activeTrip.trip_id, routeId: activeTrip.route_id, shift: activeTrip.shift };
}

