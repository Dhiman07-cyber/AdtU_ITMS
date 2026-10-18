import { appLogger } from '@/lib/logger';
import { ErrorClass } from '@/lib/error-classes';
import { MAX_CLOCK_SKEW_MS, normalizeLocationUpdate } from './gps-normalizer.service';
import { checkActiveTrip } from './gps-persistence.service';
import { atomicGpsGuardAndUpdate, clearGpsState, seedGpsState, getGpsStateFromRedis } from './gps-redis-guard';
import { trackStopDwell, clearStopDwellState, processWaitingFlagsOnGpsTick } from './stop-dwell.service';
import type { LastLocation, LocationUpdate, LocationUpdateNormalized, PipelineResult } from './types';

// NOTE: live enforcement here is bounds, speed/heading/accuracy caps,
// active-trip check, jump/speed guards, and the raw-clock replay guard below.
// LocationValidationService (geofence/teleport/zigzag/blacklist) is exposed
// via gps.service for measured future wiring — it is NOT on this hot path
// today, and must not be assumed to be until wired + benchmarked.

const MAX_SPEED_KMH = 200;
const MAX_JUMP_METERS = 5000;
// Real-world Android GPS accuracy commonly ranges 80–300 m depending on
// signal strength, device hardware and urban canyons. 80 m was silently
// rejecting the majority of legitimate driver updates, which prevented
// emitEvent from firing and left the student's WS feed starved.
// 150 m is a safer threshold that blocks only genuinely degraded fixes.
const MAX_ACCURACY_METERS = 150;

// Regional bounding box for the ADTU ITMS operating corridor.
// Covers Assam and immediately adjacent Northeast Indian territories to prevent
// spoofed / corrupted coordinates (e.g. null-island, European GPS from test devices)
// from reaching the student map or audit trail.
//   Latitude:  25.0°N – 28.5°N  (Assam + Meghalaya + Arunachal southern strip)
//   Longitude: 89.5°E – 96.5°E  (Full Assam/NE corridor to Myanmar border)
// Bounds are intentionally generous (±1°) to avoid false-rejections near state borders.
const REGION_LAT_MIN = 25.0;
const REGION_LAT_MAX = 28.5;
const REGION_LNG_MIN = 89.5;
const REGION_LNG_MAX = 96.5;

function validateBounds(n: LocationUpdateNormalized): string | null {
  if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return 'Valid latitude and longitude are required';
  if (n.lat === 0 && n.lng === 0) return 'GPS fix not acquired (null island coordinates)';
  if (n.lat < -90 || n.lat > 90 || n.lng < -180 || n.lng > 180) return 'Coordinates are out of range';
  // Regional gate: reject coordinates outside the ADTU ITMS operating corridor (Assam / NE India).
  // This catches spoofed payloads and misconfigured test devices before they reach the audit trail.
  if (
    n.lat < REGION_LAT_MIN || n.lat > REGION_LAT_MAX ||
    n.lng < REGION_LNG_MIN || n.lng > REGION_LNG_MAX
  ) {
    return `Coordinates (${n.lat.toFixed(4)}, ${n.lng.toFixed(4)}) are outside the ADTU ITMS operating region`;
  }

  if (n.speed !== null && (n.speed < 0 || n.speed > MAX_SPEED_KMH)) return `Speed exceeds limit (${MAX_SPEED_KMH} km/h)`;
  if (n.heading !== null && (n.heading < 0 || n.heading > 360)) return 'Heading is out of range';
  if (n.accuracy !== null && (n.accuracy < 0 || n.accuracy > MAX_ACCURACY_METERS)) return `GPS accuracy (${Math.round(n.accuracy)}m) exceeds threshold (${MAX_ACCURACY_METERS}m)`;
  return null;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateJump(n: LocationUpdateNormalized, last: LastLocation): string | null {
  const lastTime = new Date(last.timestamp).getTime();
  const timeDiff = (n.timestamp.getTime() - lastTime) / 1000;

  // Reject out-of-order packets — older than last accepted location
  if (timeDiff < 0) return 'Out-of-order GPS packet (older than last accepted location)';

  // Duplicate timestamp: only reject if coordinates changed significantly
  if (timeDiff === 0) {
    const distance = haversine(Number(last.lat), Number(last.lng), n.lat, n.lng);
    if (distance > 50) return 'Duplicate timestamp with significant coordinate jump';
    return null;
  }

  const distance = haversine(Number(last.lat), Number(last.lng), n.lat, n.lng);

  if (distance > MAX_JUMP_METERS) return `Location jump too large (${Math.round(distance)}m)`;

  if (distance > 100 && timeDiff > 0.5) {
    const calculatedSpeedMps = distance / timeDiff;
    const maxSpeedMps = MAX_SPEED_KMH / 3.6;
    if (calculatedSpeedMps > maxSpeedMps) {
      const calculatedKmh = Math.round(calculatedSpeedMps * 3.6);
      return `Calculated speed ${calculatedKmh} km/h exceeds limit (${MAX_SPEED_KMH} km/h)`;
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Process-local last-location store
// Used by: WS socket-router (seeded positions), trip-status DB fallback,
//          and as a synchronous read path for getLastLocationForBus callers.
// NOT used for the primary jump/replay guard in the HTTP GPS pipeline
// (that uses the Redis-backed atomic guard — see gps-redis-guard.ts).
// ──────────────────────────────────────────────────────────────────────────────
const inMemoryLastLocations = new Map<string, LastLocation>();
const inMemoryLastRawTs = new Map<string, number>();

function getRawClientTime(raw: LocationUpdate): number | null {
  const t = (raw as any).timestamp;
  if (t === undefined || t === null) return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function getBusIdVariations(busId: string): string[] {
  if (!busId) return [];
  return busId.startsWith('bus_') ? [busId, busId.replace('bus_', '')] : [busId, `bus_${busId}`];
}

/**
 * Clear process-local GPS state for a bus and also evict from Redis.
 * Called when a trip ends to reset the guard for the next trip.
 */
export function clearInMemoryLastLocation(busId: string): void {
  if (!busId) return;
  for (const id of getBusIdVariations(busId)) {
    inMemoryLastLocations.delete(id);
    inMemoryLastRawTs.delete(id);
  }
  clearStopDwellState(busId);
  // Best-effort Redis eviction — does not block the caller.
  clearGpsState(busId).catch(() => { /* ignore */ });
}

/**
 * Seed the process-local position cache (used by WS socket-router to set
 * the initial anchor when a driver connects via WebSocket).
 * Does NOT update the Redis guard state — the HTTP pipeline manages that.
 */
export function setInMemoryLastLocation(busId: string, loc: LastLocation): void {
  if (busId) {
    inMemoryLastLocations.set(busId, loc);
    const rawMs = new Date(loc.timestamp).getTime();
    if (Number.isFinite(rawMs)) inMemoryLastRawTs.set(busId, rawMs);
    else inMemoryLastRawTs.delete(busId);
    // Keep memLast (in gps-redis-guard) coherent with this anchor so the
    // memory-fallback guard applies duplicate/replay checks correctly in
    // single-instance (no-Redis) mode.
    const tsMs = Number.isFinite(rawMs) ? rawMs : Date.now();
    const lat = typeof loc.lat === 'string' ? parseFloat(loc.lat) : loc.lat;
    const lng = typeof loc.lng === 'string' ? parseFloat(loc.lng) : loc.lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      seedGpsState(busId, lat, lng, tsMs, loc.speed, loc.heading, loc.accuracy);
    }
  }
}

/** Read last accepted location from the process-local cache. */
export function getLastLocationForBus(busId: string): LastLocation | null {
  if (!busId) return null;
  for (const id of getBusIdVariations(busId)) {
    const loc = inMemoryLastLocations.get(id);
    if (loc) return loc;
  }
  return null;
}

/**
 * Read last accepted location for a bus across instances.
 * Checks in-memory cache first (0ms), then falls back to Redis state (multi-instance safe).
 * Seeds in-memory cache upon cache miss so subsequent reads are immediate.
 */
export async function getLastLocationForBusAsync(busId: string): Promise<LastLocation | null> {
  if (!busId) return null;
  const syncLoc = getLastLocationForBus(busId);
  if (syncLoc) return syncLoc;

  for (const id of getBusIdVariations(busId)) {
    const redisLoc = await getGpsStateFromRedis(id);
    if (redisLoc) {
      inMemoryLastLocations.set(id, redisLoc);
      return redisLoc;
    }
  }
  return null;
}

export async function processLocationUpdate(raw: LocationUpdate): Promise<PipelineResult> {
  const start = Date.now();
  const normalized = normalizeLocationUpdate(raw);
  const logCtx = {
    correlationId: (raw as any).correlationId as string | undefined,
    busId: normalized.busId,
    tripId: normalized.tripId,
    driverId: normalized.driverId,
  };

  // Defensive Guard: Reject synthetic or fallback location payloads
  if ((raw as any).isFallback || (raw as any).source === 'fallback') {
    const reason = 'Synthetic or fallback location payload rejected';
    appLogger.warn('gps', 'location_rejected', { ...logCtx, reason, errorClass: ErrorClass.GPS_INVALID_COORDINATES, latencyMs: Date.now() - start });
    return { accepted: false, reason, normalized };
  }

  const boundsError = validateBounds(normalized);
  if (boundsError) {
    const errorClass = boundsError.includes('null island')
      ? ErrorClass.GPS_NULL_ISLAND
      : boundsError.includes('speed')
        ? ErrorClass.GPS_SPEED_EXCEEDED
        : boundsError.includes('operating region')
          ? ErrorClass.GPS_OUT_OF_REGION
          : ErrorClass.GPS_INVALID_COORDINATES;
    appLogger.warn('gps', 'location_rejected', { ...logCtx, reason: boundsError, errorClass, latencyMs: Date.now() - start });
    return { accepted: false, reason: boundsError, normalized };
  }

  const session = await checkActiveTrip(normalized.driverId, normalized.busId, normalized.tripId);
  if (!session.valid) {
    appLogger.warn('gps', 'location_rejected', { ...logCtx, reason: session.reason, errorClass: ErrorClass.GPS_NO_ACTIVE_TRIP, latencyMs: Date.now() - start });
    return { accepted: false, reason: session.reason, normalized };
  }

  // ── Multi-instance-safe jump/replay guard ──────────────────────────────────
  // atomicGpsGuardAndUpdate executes a Lua script in Redis that atomically
  // reads the current state, runs all guard checks, and writes the new state
  // in a single round-trip. This ensures correctness when the same bus's
  // packets arrive at different Next.js containers.
  // Falls back to process-local in-memory guard when Redis is unavailable.
  const rawTime = getRawClientTime(raw);
  const guardResult = await atomicGpsGuardAndUpdate(
    normalized.busId,
    normalized.lat,
    normalized.lng,
    normalized.timestamp.getTime(),
    rawTime,
  );

  if (guardResult !== 'ok') {
    const errorClassMap: Record<string, string> = {
      stale_raw: ErrorClass.GPS_OUT_OF_ORDER,
      out_of_order: ErrorClass.GPS_OUT_OF_ORDER,
      jump: ErrorClass.GPS_JUMP_TOO_LARGE,
      speed: ErrorClass.GPS_SPEED_EXCEEDED,
      duplicate: ErrorClass.GPS_DUPLICATE_TIMESTAMP,
      redis_unavailable: ErrorClass.DATABASE_UNAVAILABLE,
    };
    const reasonMap: Record<string, string> = {
      stale_raw: 'Out-of-order GPS packet (older than last accepted location)',
      out_of_order: 'Out-of-order GPS packet (older than last accepted location)',
      jump: `Location jump too large`,
      speed: `Calculated speed exceeds limit (200 km/h)`,
      duplicate: 'Duplicate timestamp with significant coordinate jump',
      redis_unavailable: 'GPS guard cluster coordination unavailable; packet rejected to preserve spatial safety',
    };
    const reason = reasonMap[guardResult] || `GPS packet rejected: ${guardResult}`;
    const errorClass = errorClassMap[guardResult] || ErrorClass.GPS_INVALID_COORDINATES;
    appLogger.warn('gps', 'location_rejected', { ...logCtx, reason, errorClass, guardResult, latencyMs: Date.now() - start });
    return { accepted: false, reason, normalized };
  }

  // Keep the process-local cache in sync so getLastLocationForBus() returns
  // a fresh value for the WS server fallback and trip-status DB readers.
  inMemoryLastLocations.set(normalized.busId, {
    lat: normalized.lat,
    lng: normalized.lng,
    timestamp: normalized.timestamp.toISOString(),
    speed: normalized.speed,
    heading: normalized.heading,
    accuracy: normalized.accuracy,
  });
  if (rawTime !== null) {
    inMemoryLastRawTs.set(normalized.busId, Math.min(rawTime, Date.now() + MAX_CLOCK_SKEW_MS));
  }

  // Non-blocking stop dwell tracking for incontrovertible audit proof (INV-2)
  trackStopDwell({
    busId: normalized.busId,
    tripId: normalized.tripId,
    driverId: normalized.driverId,
    routeId: normalized.routeId,
    lat: normalized.lat,
    lng: normalized.lng,
    speed: normalized.speed,
    timestamp: normalized.timestamp,
  }).catch(() => {});

  // Hands-free proximity auto-ack and pass-by auto-cleanup (0 Supabase reads on hot path)
  processWaitingFlagsOnGpsTick({
    busId: normalized.busId,
    routeId: normalized.routeId,
    lat: normalized.lat,
    lng: normalized.lng,
    shift: (raw as any).shift,
  }).catch(() => {});

  appLogger.debug('gps', 'location_accepted', { ...logCtx, lat: normalized.lat, lng: normalized.lng, latencyMs: Date.now() - start });
  return { accepted: true, normalized, persisted: false };
}

export async function processLocationUpdateSimple(raw: LocationUpdate): Promise<PipelineResult> {
  const normalized = normalizeLocationUpdate(raw);

  const boundsError = validateBounds(normalized);
  if (boundsError) return { accepted: false, reason: boundsError, normalized };

  return { accepted: true, normalized };
}

