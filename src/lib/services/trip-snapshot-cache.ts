/**
 * Singleflight Request Coalescing & Shared Bus Snapshot Cache
 *
 * Prevents "Thundering Herd" query storms on Supabase PostgreSQL when multiple students
 * on the same bus (or students during reconnect blips) query /api/student/trip-status simultaneously.
 *
 * Invariants:
 * - In-flight Promise deduplication (Singleflight): If 60 students query bus_04 within the same
 *   execution window, only ONE Supabase query executes. All 60 callers resolve with the same snapshot.
 * - Short-lived L1 cache: 3,000ms TTL. Fresh enough to absorb high-concurrency bursts while
 *   ensuring fast convergence.
 * - Deterministic, immediate invalidation: Invalidate immediately on trip_started, trip_ended,
 *   or active trip cancellation.
 */

import { getSupabaseServer } from '@/lib/supabase-server';
import { getLastLocationForBusAsync, getLastLocationForBus } from '@/domains/gps';

export interface ActiveWaitingFlagSummary {
  id: string;
  studentUid: string;
  status: string;
  lat: number;
  lng: number;
  routeProgressMeters?: number;
}

export interface BusTripSnapshot {
  tripActive: boolean;
  tripData: {
    tripId: string;
    status: string;
    driverUid: string;
    routeId: string;
    shift: string;
    startedAt: string;
    lastUpdated: string;
    current_location: {
      busId: string;
      driverUid: string;
      lat: number;
      lng: number;
      speed: number;
      heading: number;
      accuracy?: number;
      timestamp: string;
    } | null;
  } | null;
  activeFlagsByStudentUid: Record<string, ActiveWaitingFlagSummary>;
  fetchedAtMs: number;
}

const SNAPSHOT_CACHE_TTL_MS = 3000; // 3 seconds
const busSnapshotCache = new Map<string, { snapshot: BusTripSnapshot; expiresAtMs: number }>();
const inFlightBusFetches = new Map<string, Promise<BusTripSnapshot>>();

function normalizeBusKey(busId: string): string {
  if (!busId) return '';
  return busId.trim().toLowerCase();
}

function getBusVariations(busId: string): string[] {
  const norm = normalizeBusKey(busId);
  if (!norm) return [];
  if (norm.startsWith('bus_')) {
    return [norm, norm.replace('bus_', '')];
  }
  return [norm, `bus_${norm}`];
}

/**
 * Get shared bus trip snapshot with singleflight request deduplication
 */
export async function getSharedBusTripSnapshot(busId: string): Promise<BusTripSnapshot> {
  const normKey = normalizeBusKey(busId);
  if (!normKey) {
    return { tripActive: false, tripData: null, activeFlagsByStudentUid: {}, fetchedAtMs: Date.now() };
  }

  const now = Date.now();

  // 1. Check L1 Memory Cache
  const cached = busSnapshotCache.get(normKey);
  if (cached && now < cached.expiresAtMs) {
    return cached.snapshot;
  }

  // 2. Singleflight: Deduplicate concurrent in-flight fetches for the same bus
  const inFlight = inFlightBusFetches.get(normKey);
  if (inFlight) {
    return inFlight;
  }

  // 3. Initiate fetch promise
  const fetchPromise = (async (): Promise<BusTripSnapshot> => {
    try {
      const busVariations = getBusVariations(normKey);
      const supabase = getSupabaseServer();

      // Parallel fetch: active trip status and active waiting flags for this bus
      const [tripsRes, flagsRes] = await Promise.all([
        supabase
          .from('active_trips')
          .select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at')
          .in('bus_id', busVariations)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .order('start_time', { ascending: false })
          .limit(1),
        supabase
          .from('waiting_flags')
          .select('id, student_uid, status, lat, lng, stop_lat, stop_lng, route_progress_meters, expires_at')
          .in('bus_id', busVariations)
          .in('status', ['waiting', 'raised', 'acknowledged'])
          .limit(100),
      ]);

      if (tripsRes.error) {
        console.error('[trip-snapshot-cache] Error querying active_trips:', tripsRes.error.message);
        return { tripActive: false, tripData: null, activeFlagsByStudentUid: {}, fetchedAtMs: Date.now() };
      }

      const activeRow = tripsRes.data && tripsRes.data.length > 0 ? tripsRes.data[0] : null;

      if (!activeRow) {
        const inactiveSnapshot: BusTripSnapshot = {
          tripActive: false,
          tripData: null,
          activeFlagsByStudentUid: {},
          fetchedAtMs: Date.now(),
        };
        busSnapshotCache.set(normKey, {
          snapshot: inactiveSnapshot,
          expiresAtMs: Date.now() + SNAPSHOT_CACHE_TTL_MS,
        });
        return inactiveSnapshot;
      }

      // Build active waiting flags index by studentUid (0 per-student queries on trip-status!)
      const activeFlagsByStudentUid: Record<string, ActiveWaitingFlagSummary> = {};
      if (flagsRes.data && flagsRes.data.length > 0) {
        const nowMs = Date.now();
        for (const flag of flagsRes.data) {
          const expiresAtMs = flag.expires_at ? new Date(flag.expires_at).getTime() : 0;
          if ((!expiresAtMs || expiresAtMs > nowMs) && flag.student_uid) {
            activeFlagsByStudentUid[flag.student_uid] = {
              id: flag.id,
              studentUid: flag.student_uid,
              status: flag.status,
              lat: Number(flag.lat || flag.stop_lat || 0),
              lng: Number(flag.lng || flag.stop_lng || 0),
              routeProgressMeters: flag.route_progress_meters ?? undefined,
            };
          }
        }
      }

      // Resolve live location from in-memory cache or Redis
      const lastLoc = (await getLastLocationForBusAsync(normKey)) || getLastLocationForBus(normKey);

      let currentLocation = null;
      if (lastLoc) {
        currentLocation = {
          busId: normKey,
          driverUid: activeRow.driver_id,
          lat: lastLoc.lat,
          lng: lastLoc.lng,
          speed: lastLoc.speed != null ? Number(lastLoc.speed) : 0,
          heading: lastLoc.heading != null ? Number(lastLoc.heading) : 0,
          accuracy: lastLoc.accuracy ?? 10,
          timestamp: lastLoc.timestamp,
        };
      }

      const snapshot: BusTripSnapshot = {
        tripActive: true,
        tripData: {
          tripId: activeRow.trip_id,
          status: activeRow.status,
          driverUid: activeRow.driver_id,
          routeId: activeRow.route_id,
          shift: activeRow.shift,
          startedAt: activeRow.start_time,
          lastUpdated: activeRow.last_heartbeat,
          current_location: currentLocation,
        },
        activeFlagsByStudentUid,
        fetchedAtMs: Date.now(),
      };

      // Store in L1 cache for all variations of this busId
      const expiresAtMs = Date.now() + SNAPSHOT_CACHE_TTL_MS;
      for (const v of busVariations) {
        busSnapshotCache.set(v, { snapshot, expiresAtMs });
      }

      // Bound cache size
      if (busSnapshotCache.size > 1000) {
        const oldestKey = busSnapshotCache.keys().next().value;
        if (oldestKey) busSnapshotCache.delete(oldestKey);
      }

      return snapshot;
    } finally {
      inFlightBusFetches.delete(normKey);
    }
  })();

  inFlightBusFetches.set(normKey, fetchPromise);
  return fetchPromise;
}

/**
 * Immediate cache invalidation on trip start, end, or cancellation
 */
export function invalidateBusTripSnapshot(busId?: string): void {
  if (busId) {
    const variations = getBusVariations(busId);
    for (const v of variations) {
      busSnapshotCache.delete(v);
      inFlightBusFetches.delete(v);
    }
  } else {
    busSnapshotCache.clear();
    inFlightBusFetches.clear();
  }
}
