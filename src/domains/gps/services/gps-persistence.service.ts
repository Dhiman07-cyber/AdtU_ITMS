import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations } from '@/lib/utils';
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
  const busVariations = getBusIdVariations(busId);
  const now = Date.now();

  // Check positive in-memory cache for any variation
  for (const v of busVariations) {
    const positiveEntry = positiveLockCache.get(`${driverId}:${v}`);
    if (positiveEntry && now < positiveEntry.cachedUntilMs) {
      if (positiveEntry.expiresAtMs <= now) {
        positiveLockCache.delete(`${driverId}:${v}`);
        negativeLockCache.set(`${driverId}:${v}`, now + NEGATIVE_CACHE_TTL_MS);
        return { valid: false, reason: 'Active trip lock has expired' };
      }
      if (tripId && positiveEntry.tripId !== tripId) {
        return { valid: false, reason: 'Trip mismatch for location update' };
      }
      positiveEntry.cachedUntilMs = now + POSITIVE_CACHE_TTL_MS;
      return { valid: true, tripId: positiveEntry.tripId, routeId: positiveEntry.routeId, shift: positiveEntry.shift };
    }
  }

  // Multi-instance Redis check across variations
  for (const v of busVariations) {
    const redisLock = await getRedisTripLock(v);
    if (redisLock) {
      if (redisLock.driverId === driverId && redisLock.expiresAtMs > now) {
        if (tripId && redisLock.tripId !== tripId) {
          return { valid: false, reason: 'Trip mismatch for location update' };
        }
        for (const varKey of busVariations) {
          negativeLockCache.delete(`${driverId}:${varKey}`);
          positiveLockCache.set(`${driverId}:${varKey}`, {
            tripId: redisLock.tripId,
            driverId: redisLock.driverId,
            routeId: redisLock.routeId,
            shift: redisLock.shift,
            deviceId: redisLock.deviceId,
            expiresAtMs: redisLock.expiresAtMs,
            cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
          });
        }
        return { valid: true, tripId: redisLock.tripId, routeId: redisLock.routeId, shift: redisLock.shift };
      }
    }
  }

  const supabase = getSupabaseServer();

  const { data: activeTrip, error } = await supabase
    .from('active_trips')
    .select('trip_id, route_id, driver_id, shift, status, expires_at')
    .in('bus_id', busVariations)
    .eq('driver_id', driverId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error || !activeTrip) {
    for (const v of busVariations) {
      positiveLockCache.delete(`${driverId}:${v}`);
      negativeLockCache.set(`${driverId}:${v}`, now + NEGATIVE_CACHE_TTL_MS);
    }
    return { valid: false, reason: 'No active trip lock found for this driver/bus' };
  }

  const expiresAtMs = activeTrip.expires_at ? new Date(activeTrip.expires_at).getTime() : now + 600_000;
  if (expiresAtMs <= now) {
    for (const v of busVariations) {
      positiveLockCache.delete(`${driverId}:${v}`);
      negativeLockCache.set(`${driverId}:${v}`, now + NEGATIVE_CACHE_TTL_MS);
    }
    return { valid: false, reason: 'Active trip lock has expired' };
  }

  if (tripId && activeTrip.trip_id !== tripId) {
    return { valid: false, reason: 'Trip mismatch for location update' };
  }

  // Active trip confirmed from authoritative PostgreSQL.
  // Populate Redis cache and in-memory cache across all bus variations
  for (const v of busVariations) {
    setRedisTripLock(v, {
      tripId: activeTrip.trip_id,
      driverId,
      routeId: activeTrip.route_id,
      shift: activeTrip.shift,
      expiresAtMs,
    }).catch(() => {});

    negativeLockCache.delete(`${driverId}:${v}`);
    positiveLockCache.set(`${driverId}:${v}`, {
      tripId: activeTrip.trip_id,
      driverId,
      routeId: activeTrip.route_id,
      shift: activeTrip.shift,
      expiresAtMs,
      cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
    });
  }

  return { valid: true, tripId: activeTrip.trip_id, routeId: activeTrip.route_id, shift: activeTrip.shift };
}

