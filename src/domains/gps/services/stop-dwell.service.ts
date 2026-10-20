/**
 * Stop Dwell Audit Engine & Hands-Free Waiting Flag Processor
 *
 * Implements lightweight O(1) stop-proximity tracking for ADTU ITMS buses.
 * Stop dwell records are incontrovertible transit proof (INV-2):
 * - Enters <= 80m of a route stop: record arrived_at under canonical stop_name
 * - While inside 80m and speed < 5 km/h: accumulate dwell_seconds
 * - Roadside halts between stops: if bus halts (< 5 km/h for >= 15s) along the route
 *   corridor (<= 80m from road polyline), records dwell under "Roadside Halt (near <NearestStopName>)"
 * - Exits > 100m of that stop/halt (or trip ends): asynchronously persist completed
 *   record to public.stop_dwell_logs.
 *
 * Hands-Free Waiting Flag Hot-Path (Zero Supabase reads on the 2s GPS tick):
 * - Auto-acknowledges flags <= 600m upstream.
 * - Auto-clears flags passed by > 200m.
 */

import { appLogger } from '@/lib/logger';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getCanonicalStopsForRoute } from '@/domains/route/data/canonical-route-geometries';
import { projectPointToRouteCorridor, isReverseRouteDirection } from '@/domains/route/services/route-alignment-engine';
import { pgFindById } from '@/domains/route/repositories/route.repository.pg';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { invalidateBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import {
  getRedisActiveDwell,
  setRedisActiveDwell,
  clearRedisActiveDwell,
  getRedisActiveFlags,
  setRedisActiveFlag,
  updateRedisActiveFlag,
  removeRedisActiveFlag,
  isRedisFlagsHydrated,
  setRedisFlagsHydrated,
} from './gps-redis-guard';

export interface ActiveDwellState {
  busId: string;
  tripId: string;
  driverId: string;
  routeId: string;
  stopId: string;
  stopName: string;
  stopLat: number;
  stopLng: number;
  arrivedAt: string;
  arrivedAtMs: number;
  lastTickMs: number;
  dwellSeconds: number;
  isRoadside?: boolean;
  lastRedisWriteMs?: number;
}

export interface StopDwellInput {
  busId: string;
  tripId: string;
  driverId: string;
  routeId?: string;
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: Date;
}

const STOP_ENTER_RADIUS_METERS = 80;
const STOP_EXIT_RADIUS_METERS = 100;
const CORRIDOR_HALT_ENTER_RADIUS_METERS = 80;
const STATIONARY_SPEED_THRESHOLD_KMH = 5.0;
const MIN_ROADSIDE_DWELL_SECONDS = 15;

// In-memory active dwell states by busId (backed by Redis across stateless requests)
const activeDwells = new Map<string, ActiveDwellState>();
const lastDwellRedisCheckMs = new Map<string, number>();
const lastFlagsRedisCheckMs = new Map<string, number>();
const recentStopDwells = new Map<string, { lastDepartedMs: number; dwellSeconds: number }>();

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Persist completed dwell record to Supabase stop_dwell_logs asynchronously.
 * Never throws to the caller. Discards roadside halts < 15s and stops < 5s.
 */
async function persistDwellRecord(dwell: ActiveDwellState, departedAtIso: string): Promise<void> {
  // Continuous zone residency duration while bus was inside the stop capture zone:
  const residencySeconds = Math.max(0, Math.round((dwell.lastTickMs - dwell.arrivedAtMs) / 1000));
  // Resilient dwell duration against urban multipath GPS speed jitter:
  // If the bus remained inside the stop radius with bounded displacement,
  // compute total dwell duration from Math.max(accumulatedLowSpeedSeconds, residencySeconds)
  // so single-tick speed spikes (>5 km/h) never zero out or truncate the dwell.
  const dwellSeconds = Math.max(Math.round(dwell.dwellSeconds), residencySeconds);

  // Filter out micro stop jitter < 5s
  if (dwellSeconds < 5) {
    return;
  }

  // Filter out brief roadside traffic taps < 15s
  if (dwell.isRoadside && dwellSeconds < MIN_ROADSIDE_DWELL_SECONDS) {
    return;
  }

  // Deduplicate named stop dwell records logged within 3 minutes for the same stop on the same trip (Fix 16)
  const recentKey = `${dwell.tripId}:${dwell.stopId}`;
  const recent = recentStopDwells.get(recentKey);
  if (!dwell.isRoadside && recent && (Date.now() - recent.lastDepartedMs < 180_000)) {
    return;
  }
  recentStopDwells.set(recentKey, { lastDepartedMs: Date.now(), dwellSeconds });

  try {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from('stop_dwell_logs').insert({
      trip_id: dwell.tripId,
      bus_id: dwell.busId,
      driver_id: dwell.driverId,
      route_id: dwell.routeId,
      stop_id: dwell.stopId,
      stop_name: dwell.stopName,
      arrived_at: dwell.arrivedAt,
      departed_at: departedAtIso,
      dwell_seconds: dwellSeconds,
    });

    if (error) {
      appLogger.warn('gps', 'stop_dwell_log_insert_failed', {
        busId: dwell.busId,
        stopName: dwell.stopName,
        error: error.message,
      });
    } else {
      appLogger.info('gps', 'stop_dwell_logged', {
        busId: dwell.busId,
        tripId: dwell.tripId,
        stopName: dwell.stopName,
        dwellSeconds,
        isRoadside: dwell.isRoadside ?? false,
        arrivedAt: dwell.arrivedAt,
        departedAt: departedAtIso,
      });
    }
  } catch (err: any) {
    appLogger.warn('gps', 'stop_dwell_persist_error', {
      busId: dwell.busId,
      error: err?.message || err,
    });
  }
}

/**
 * Process a location tick for stop dwell tracking.
 * Called on every accepted GPS update in the pipeline.
 */
export async function trackStopDwell(input: StopDwellInput): Promise<void> {
  try {
    const { busId, tripId, driverId, routeId, lat, lng, speed, timestamp } = input;
    if (!busId || !lat || !lng) return;

    const currentMs = timestamp.getTime();
    let active = activeDwells.get(busId);
    if (!active) {
      const isCruising = speed !== null && speed !== undefined && speed >= STATIONARY_SPEED_THRESHOLD_KMH;
      const lastCheck = lastDwellRedisCheckMs.get(busId) || 0;
      // Zero-Waste Highway Guard: A bus moving >= 5 km/h between stops skips sequential Redis calls
      // if checked within the last 10 seconds.
      if (!isCruising || currentMs - lastCheck >= 10_000) {
        lastDwellRedisCheckMs.set(busId, currentMs);
        active = (await getRedisActiveDwell(busId)) || undefined;
        if (active) {
          activeDwells.set(busId, active);
        }
      }
    }

    if (active) {
      // Check if bus is still dwelling at this stop or roadside halt
      const distToActive = haversineMeters(lat, lng, active.stopLat, active.stopLng);

      if (distToActive <= STOP_ENTER_RADIUS_METERS) {
        // Still inside stop/halt radius
        const deltaSeconds = Math.min(30, Math.max(0, (currentMs - active.lastTickMs) / 1000));
        const isStationary = speed === null || speed === undefined || speed < STATIONARY_SPEED_THRESHOLD_KMH;
        if (isStationary) {
          active.dwellSeconds += deltaSeconds;
        }
        active.lastTickMs = currentMs;
        activeDwells.set(busId, active);

        // Throttle Redis setRedisActiveDwell: once every 15s thereafter (Fix 6)
        const lastWrite = active.lastRedisWriteMs || active.arrivedAtMs || 0;
        if (currentMs - lastWrite >= 15_000) {
          active.lastRedisWriteMs = currentMs;
          await setRedisActiveDwell(busId, active).catch(() => { });
        }
        return;
      }

      if (distToActive > STOP_EXIT_RADIUS_METERS) {
        // Exited stop radius — conclude dwell
        activeDwells.delete(busId);
        await clearRedisActiveDwell(busId).catch(() => { });
        const departedAt = new Date(currentMs).toISOString();
        await persistDwellRecord(active, departedAt).catch(() => { });
      } else {
        // Between 80m and 100m hysteresis buffer — update tick time
        active.lastTickMs = currentMs;
        activeDwells.set(busId, active);
        const lastWrite = active.lastRedisWriteMs || active.arrivedAtMs || 0;
        if (currentMs - lastWrite >= 15_000) {
          active.lastRedisWriteMs = currentMs;
          await setRedisActiveDwell(busId, active).catch(() => { });
        }
        return;
      }
    }

    // If no active dwell, search candidate stops on this route
    if (!routeId) return;
    let stops = getCanonicalStopsForRoute(routeId);
    if (!stops || stops.length === 0) {
      const dbRoute = await pgFindById(routeId).catch(() => null);
      if (dbRoute?.stops) {
        stops = dbRoute.stops.map((s, idx) => ({
          name: s.name,
          stop_name: s.stop_name || s.name,
          lat: s.lat,
          lng: s.lng,
          sequence: s.sequence || idx + 1,
        }));
      }
    }

    // 1. Check if bus entered a canonical stop radius (<= 80m)
    let enteredNamedStop = false;
    if (stops && stops.length > 0) {
      for (const stop of stops) {
        const dist = haversineMeters(lat, lng, stop.lat, stop.lng);
        if (dist <= STOP_ENTER_RADIUS_METERS) {
          // Bus entered canonical stop radius — start new dwell tracking
          const newDwell: ActiveDwellState = {
            busId,
            tripId: tripId || 'unknown_trip',
            driverId: driverId || 'unknown_driver',
            routeId,
            stopId: (stop as any).stop_id || `stop_${stop.sequence || 1}`,
            stopName: (stop as any).stop_name || stop.name,
            stopLat: stop.lat,
            stopLng: stop.lng,
            arrivedAt: timestamp.toISOString(),
            arrivedAtMs: currentMs,
            lastTickMs: currentMs,
            dwellSeconds: 0,
            isRoadside: false,
            lastRedisWriteMs: currentMs,
          };
          activeDwells.set(busId, newDwell);
          await setRedisActiveDwell(busId, newDwell).catch(() => { });
          enteredNamedStop = true;
          break; // Only anchor to closest stop
        }
      }
    }

    if (enteredNamedStop) return;

    // 2. Check for roadside halt along route corridor between named stops
    // Bus must be stationary (< 5 km/h) and within <= 80m of route polyline
    const isStationary = speed === null || speed === undefined || speed < STATIONARY_SPEED_THRESHOLD_KMH;
    if (isStationary) {
      const corridor = projectPointToRouteCorridor({ lat, lng }, routeId, stops);
      if (corridor.crossTrackDistanceMeters <= CORRIDOR_HALT_ENTER_RADIUS_METERS) {
        const nearestName = corridor.nearestStopName || 'En Route';
        const roadsideDwell: ActiveDwellState = {
          busId,
          tripId: tripId || 'unknown_trip',
          driverId: driverId || 'unknown_driver',
          routeId,
          stopId: `roadside_${Math.round(lat * 10000)}_${Math.round(lng * 10000)}`,
          stopName: `Roadside Halt (near ${nearestName})`,
          stopLat: lat,
          stopLng: lng,
          arrivedAt: timestamp.toISOString(),
          arrivedAtMs: currentMs,
          lastTickMs: currentMs,
          dwellSeconds: 0,
          isRoadside: true,
          lastRedisWriteMs: currentMs,
        };
        activeDwells.set(busId, roadsideDwell);
        await setRedisActiveDwell(busId, roadsideDwell).catch(() => { });
      }
    }
  } catch (err: any) {
    // Non-blocking fail-safe: never crash the GPS pipeline
    appLogger.warn('gps', 'stop_dwell_tracking_error', { error: err?.message || err });
  }
}

/**
 * Hands-Free Proximity Auto-Ack & Pass-By Auto-Clear on the 2s GPS Tick.
 * Zero Supabase reads on the hot path (uses Redis flags:active:<busId>).
 */
export async function processWaitingFlagsOnGpsTick(input: {
  busId: string;
  routeId?: string;
  lat: number;
  lng: number;
  shift?: string;
}): Promise<void> {
  try {
    const { busId, routeId, lat, lng, shift } = input;
    if (!busId || !lat || !lng) return;

    // Self-Healing Lazy Redis Hydration:
    // If Redis flushed or restarted mid-trip, hydrate active waiting flags once from Supabase
    const isHydrated = await isRedisFlagsHydrated(busId);
    if (!isHydrated) {
      await setRedisFlagsHydrated(busId);
      try {
        const supabase = getSupabaseServer();
        let query = supabase
          .from('waiting_flags')
          .select('id, student_uid, student_name, stop_name, lat, lng, stop_lat, stop_lng, route_progress_meters, ack_sent, shift, bus_id, route_id, trip_id, created_at')
          .eq('bus_id', busId)
          .in('status', ['waiting', 'raised', 'acknowledged']);

        if (query && typeof (query as any).gt === 'function') {
          query = (query as any).gt('expires_at', new Date().toISOString());
        }
        const { data: dbFlags } = await query;

        if (dbFlags && dbFlags.length > 0) {
          for (const dbf of dbFlags) {
            const flagLat = Number(dbf.lat || dbf.stop_lat || 0);
            const flagLng = Number(dbf.lng || dbf.stop_lng || 0);
            let progress = typeof dbf.route_progress_meters === 'number' ? dbf.route_progress_meters : 0;
            if (!progress && flagLat && flagLng) {
              const p = projectPointToRouteCorridor({ lat: flagLat, lng: flagLng }, routeId);
              progress = p.routeProgressMeters;
            }
            await setRedisActiveFlag(busId, {
              flagId: dbf.id,
              studentUid: dbf.student_uid || (dbf as any).student_id || 'unknown_student',
              studentName: dbf.student_name || 'Student',
              stopName: dbf.stop_name || 'Roadside Stop',
              lat: flagLat,
              lng: flagLng,
              routeProgressMeters: progress,
              ackSent: dbf.ack_sent || false,
              busId,
              routeId: dbf.route_id || routeId || 'route_1',
              tripId: dbf.trip_id || 'unknown_trip',
              createdAt: dbf.created_at ? new Date(dbf.created_at).getTime() : Date.now(),
              shift: dbf.shift || shift,
            });
          }
        }
      } catch (hydrateErr: any) {
        appLogger.warn('gps', 'lazy_flag_hydration_error', { busId, error: hydrateErr?.message });
      }
    }

    // Read active flags from Redis in O(1) time (0 DB reads!)
    const flagsMap = await getRedisActiveFlags(busId);
    const flags = Object.values(flagsMap);
    if (!flags || flags.length === 0) return;

    const busCorridor = projectPointToRouteCorridor({ lat, lng }, routeId);
    const busProgress = busCorridor.routeProgressMeters;

    for (const flag of flags) {
      // Expiration check: evict flags older than 90 minutes (Fix 15)
      if (flag.createdAt && flag.createdAt + 90 * 60 * 1000 < Date.now()) {
        await removeRedisActiveFlag(busId, flag.flagId).catch(() => { });
        invalidateBusTripSnapshot(busId);
        continue;
      }

      // Direction-Aware Route Progress:
      // In outbound (Morning, 0 -> L): student is ahead of bus (flagProgress > busProgress).
      // In return (Evening, L -> 0): student is ahead of bus (busProgress > flagProgress).
      const isReverse = isReverseRouteDirection(flag.shift || shift);
      const signedAheadMeters = isReverse
        ? busProgress - flag.routeProgressMeters
        : flag.routeProgressMeters - busProgress;

      // 1. Hands-Free Proximity Auto-Acknowledge (<= 600m upstream):
      // When 0 <= signedAheadMeters <= 600 and !flag.ackSent
      if (signedAheadMeters >= 0 && signedAheadMeters <= 600 && !flag.ackSent) {
        await updateRedisActiveFlag(busId, flag.flagId, { ackSent: true });
        invalidateBusTripSnapshot(busId);
        const ackPayload = {
          flagId: flag.flagId,
          studentUid: flag.studentUid,
          busId,
          autoAck: true,
          distanceMeters: Math.round(signedAheadMeters),
        };
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_acknowledged', ackPayload).catch(() => { });
        emitEvent(`student_${flag.studentUid}`, 'waiting_flag_acknowledged', ackPayload).catch(() => { });
        // Non-blocking PostgreSQL update to maintain DB consistency across cache rehydrations (Fix 5)
        try {
          const supabase = getSupabaseServer();
          Promise.resolve(
            supabase
              .from('waiting_flags')
              .update({ status: 'acknowledged', ack_sent: true })
              .eq('id', flag.flagId)
              .in('status', ['raised', 'waiting'])
          ).catch(() => { });
        } catch { /* best-effort non-blocking */ }
        appLogger.info('gps', 'waiting_flag_auto_acknowledged', {
          busId,
          flagId: flag.flagId,
          distanceMeters: Math.round(signedAheadMeters),
        });
      }

      // 2. Hands-Free Pass-By Auto-Cleanup (> 200m past flag):
      // When signedAheadMeters < -200 (bus is > 200m past the waiting flag)
      if (signedAheadMeters < -200) {
        await removeRedisActiveFlag(busId, flag.flagId);
        invalidateBusTripSnapshot(busId);
        const removePayload = {
          flagId: flag.flagId,
          studentUid: flag.studentUid,
          busId,
          reason: 'bus_passed',
        };
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_removed', removePayload).catch(() => { });
        emitEvent(`student_${flag.studentUid}`, 'waiting_flag_removed', removePayload).catch(() => { });

        // Single non-blocking async cleanup to update/expire flag in PostgreSQL.
        // Constrain with .in('status', ['raised', 'waiting', 'acknowledged']) so boarded/cancelled are NEVER overwritten (Fix 5)
        try {
          const supabase = getSupabaseServer();
          Promise.resolve(
            supabase
              .from('waiting_flags')
              .update({ status: 'expired' })
              .eq('id', flag.flagId)
              .in('status', ['raised', 'waiting', 'acknowledged'])
          ).catch((err: any) => {
            appLogger.warn('gps', 'waiting_flag_pass_cleanup_failed', { flagId: flag.flagId, error: err?.message });
          });
        } catch {
          // ignore async errors
        }

        appLogger.info('gps', 'waiting_flag_auto_cleaned', {
          busId,
          flagId: flag.flagId,
          passDist: Math.round(-signedAheadMeters),
        });
      }
    }
  } catch (err: any) {
    appLogger.warn('gps', 'process_waiting_flags_error', { error: err?.message || err });
  }
}

/**
 * Flush and persist any active dwell state when a trip ends.
 */
export async function flushStopDwellOnTripEnd(busId: string): Promise<void> {
  let active = activeDwells.get(busId);
  if (!active) {
    active = (await getRedisActiveDwell(busId)) || undefined;
  }
  if (!active) return;

  activeDwells.delete(busId);
  clearRedisActiveDwell(busId).catch(() => { });
  const nowIso = new Date().toISOString();
  await persistDwellRecord(active, nowIso);
}

/**
 * Clear in-memory stop dwell state for a bus without persisting.
 */
export function clearStopDwellState(busId: string): void {
  activeDwells.delete(busId);
  lastDwellRedisCheckMs.delete(busId);
  lastFlagsRedisCheckMs.delete(busId);
  recentStopDwells.clear();
  clearRedisActiveDwell(busId).catch(() => { });
}

/**
 * Get active dwell state for testing / monitoring.
 */
export function getActiveDwellState(busId: string): ActiveDwellState | undefined {
  return activeDwells.get(busId);
}
