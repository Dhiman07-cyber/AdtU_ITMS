# Redis Pub/Sub, Lua Ingress Guard & Throttled Persistence Engine (Forensic Truth)

**Module:** High-Frequency GPS Ingress, Lua Script Atomic Guards, Redis Channel Topologies & 10-Second DB Flusher  
**File Authority:** `server/src/services/redis.service.ts`, `server/src/scripts/gps_guard.lua`, `src/lib/redis.ts`  
**Redis Channels:** `channel:gps:{route_id}`, `channel:events:{trip_id}`, `channel:presence:{bus_id}`  

---

## PART 5: Authoritative GPS Telemetry Ingress, Sanity Pipeline, Redis Lua Guard & Throttled Persistence

### 5.1 Sub-Domain Architecture & Exact Execution Pipeline

The GPS Telemetry Ingress pipeline processes high-frequency (every 2-3 seconds) vehicle telemetry coordinates emitted by active driver devices. The pipeline balances sub-second real-time responsiveness and strict anti-spoofing/spatial sanity verification against database read/write saturation.

```
                                  [ Driver Device ]
                                         │  POST /api/location/update
                                         │  Payload: { busId, routeId, lat, lng,
                                         │             accuracy, speed, heading,
                                         │             timestamp, tripId, deviceId }
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │       Next.js API Layer: withSecurity()          │
                 │ 1. Validate JWT role ('driver')                  │
                 │ 2. Check RateLimits.LOCATION_UPDATE              │
                 │ 3. Validate Zod Schema (LocationUpdateBodySchema)│
                 └───────────────────────┬──────────────────────────┘
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │ Zero-Waste Device Session Exclusivity Guard      │
                 │ Check in-memory activeLock:                      │
                 │ - getPositiveTripLock(driverUid, busId)          │
                 │ - If miss, getRedisTripLock(busId)               │
                 │ If match activeLock.deviceId === requestDeviceId:│
                 │   -> sessionVerified = true (<0.01ms, 0 DB reads)│
                 │ Else: fallback to device_sessions query (8s TTL) │
                 │ If active on another device <=30s: 403 Forbidden │
                 └───────────────────────┬──────────────────────────┘
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │ GPS Pipeline Normalization & Regional Bounds     │
                 │ 1. normalizeLocationUpdate() (round 6 decimals,  │
                 │    clamp clock skew <= 120s)                     │
                 │ 2. Reject synthetic / fallback payloads          │
                 │ 3. Bounds check: Null Island (0,0), finite lat/lng│
                 │    Regional Bounding Box (Assam / NE Corridor):  │
                 │    Lat: [25.0, 28.5], Lng: [89.5, 96.5]          │
                 │    Speed <= 200 km/h, Heading [0,360],           │
                 │    Accuracy <= 150m                              │
                 └───────────────────────┬──────────────────────────┘
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │ Active Trip Lock Verification (checkActiveTrip)  │
                 │ 1. Negative Cache (TTL 2s): fast rejection       │
                 │ 2. Positive Cache (TTL 35s): warm driver memory  │
                 │ 3. Redis L2 Lock: getRedisTripLock('trip:active:')│
                 │ 4. Fallback L3: Supabase active_trips query      │
                 └───────────────────────┬──────────────────────────┘
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────────┐
                 │ Multi-Instance Atomic Redis Lua Guard            │
                 │ EVAL LUA_GPS_GUARD 1 gps:last:<busId>            │
                 │ Checks in single atomic round-trip:              │
                 │ - Stale raw clock (newRawTs < curRawTs)          │
                 │ - Out-of-order normalized ts (skew > 5000ms)     │
                 │ - Haversine jump > 5000m                         │
                 │ - Duplicate timestamp with jump > 50m            │
                 │ - Implied calculated speed > 200 km/h            │
                 │ Updates HSET: lat, lng, ts, rawTs, speed, etc.   │
                 │ Refreshes EXPIRE: 1200s (20 minutes)             │
                 │ (In production: fails closed if Redis down)      │
                 └───────────────────────┬──────────────────────────┘
                                         │
                 ┌───────────────────────┴──────────────────────────┐
                 │                                                  │
                 ▼ (Parallel / Asynchronous Side Effects)           ▼
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│ Realtime Broadcast (ws1)        │               │ Background Audit & Stop Tasks   │
│ emitEvent(                      │               │ 1. trackStopDwell()             │
│   'bus_location_<busId>',       │               │    (Incontrovertible audit)     │
│   'bus_location_update',        │               │ 2. processWaitingFlagsOnGpsTick │
│   normalized                    │               │    (Proximity auto-ack <= 600m) │
│ )                               │               └─────────────────────────────────┘
└─────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ Heartbeat Persistence Throttling (shouldWriteHeartbeat)         │
│ Interval: 1 write per bus per 30,000ms                           │
│ IF elapsed >= 30s:                                               │
│ 1. Refresh setActiveTripCache with expiresAtMs = now + 600s      │
│ 2. UPDATE active_trips SET last_heartbeat = now,                 │
│                            expires_at = now + 600s               │
│ 3. UPDATE device_sessions SET last_active_at = now               │
│ ELSE:                                                            │
│ Bypass DB writes (0 PostgreSQL writes on steady cruising ticks)  │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
                    [ Return HTTP 200 JSON ]
                    { success: true, tripId, timestamp }
```

---

### 5.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/location/update/route.ts` | `POST` (wrapped in `withSecurity`) | Driver devices / Background GPS timer / `LiveTrackingDriverMap` | `processUpdate`, `setActiveTripCache`, `getPositiveTripLock`, `getRedisTripLock`, `emitEvent`, `getCachedDeviceSession`, `setCachedDeviceSession`, `shouldWriteHeartbeat`, `supabase.from('active_trips')`, `supabase.from('device_sessions')` | Mutates `sessionCache`, `heartbeatWriteCache`, `active_trips` (heartbeat), `device_sessions` (heartbeat) |
| `src/domains/gps/services/gps-pipeline.service.ts` | `processLocationUpdate`, `processLocationUpdateSimple`, `getBusIdVariations`, `clearInMemoryLastLocation`, `setInMemoryLastLocation`, `getLastLocationForBus`, `getLastLocationForBusAsync` | `src/app/api/location/update/route.ts`, `src/domains/gps/index.ts`, WebSocket socket router, `trip-status` route | `normalizeLocationUpdate`, `validateBounds`, `checkActiveTrip`, `atomicGpsGuardAndUpdate`, `trackStopDwell`, `processWaitingFlagsOnGpsTick`, `clearGpsState` | Mutates `inMemoryLastLocations`, `inMemoryLastRawTs` |
| `src/domains/gps/services/gps-persistence.service.ts` | `setActiveTripCache`, `getPositiveTripLock`, `invalidateActiveTripCache`, `checkActiveTrip` | `src/app/api/location/update/route.ts`, `gps-pipeline.service.ts`, `trip-orchestrator.ts`, `trip-lock-service.ts` | `getRedisTripLock`, `setRedisTripLock`, `clearRedisTripLock`, `invalidateBusTripSnapshot`, `supabase.from('active_trips')` | Mutates `negativeLockCache`, `positiveLockCache`, Redis `trip:active:<busId>` |
| `src/domains/gps/services/gps-redis-guard.ts` | `atomicGpsGuardAndUpdate`, `getGpsStateFromRedis`, `clearGpsState`, `getRedisTripLock`, `setRedisTripLock`, `clearRedisTripLock`, `getRedisActiveDwell`, `setRedisActiveDwell`, `clearRedisActiveDwell`, `getRedisActiveFlags`, `setRedisActiveFlag`, `updateRedisActiveFlag`, `removeRedisActiveFlag`, `isRedisFlagsHydrated`, `setRedisFlagsHydrated`, `clearRedisFlagsHydrated`, `clearRedisActiveFlags`, `incrementStudentTripFlagCount`, `clearStudentTripFlagCounts`, `seedGpsState`, `getGpsRedisHealth` | `gps-pipeline.service.ts`, `gps-persistence.service.ts`, `stop-dwell.service.ts`, `waiting-flag.service.ts`, `trip-orchestrator.ts`, `trip-cleanup.service.ts` | Raw TCP/TLS socket to Redis, RESP command parser, `LUA_GPS_GUARD` script | Mutates Redis `gps:last:<busId>`, `trip:active:<busId>`, `dwell:active:<busId>`, `flags:active:<busId>`, in-memory `memLast`, `memActiveFlags`, `memFlagsHydrated` |
| `src/domains/gps/services/gps-normalizer.service.ts` | `normalizeLocationUpdate`, `normalizeTimestamp`, `MAX_CLOCK_SKEW_MS` | `gps-pipeline.service.ts` | `roundTo` | Pure transformation; no state mutation |
| `src/domains/gps/services/types.ts` | TypeScript interfaces: `LocationUpdate`, `LocationUpdateNormalized`, `PipelineResult`, `LastLocation`, `GPSLocation` | Entire `src/domains/gps/` module | None | Type definitions |
| `src/lib/services/device-session-cache.ts` | `getCachedDeviceSession`, `setCachedDeviceSession`, `invalidateCachedDeviceSession` | `src/app/api/location/update/route.ts`, `src/domains/trip/services/trip-orchestrator.ts` | None | Mutates process-local `sessionCache` (8s TTL) |
| `src/lib/services/location-write-throttle.ts` | `shouldWriteHeartbeat`, `clearHeartbeatCache`, `shouldWriteLocationBreadcrumb`, `clearTripBreadcrumbCache` | `src/app/api/location/update/route.ts`, `trip-orchestrator.ts` | None | Mutates process-local `heartbeatWriteCache` (30s interval) |

---

### 5.3 Method-by-Method Low-Level Walkthrough

#### 5.3.1 `POST /api/location/update` (`src/app/api/location/update/route.ts`)
1. **Security & Authentication**:
   - Wrapped in `withSecurity` requiring role `driver`, body validation schema `LocationUpdateBodySchema`, and rate limit `RateLimits.LOCATION_UPDATE`. Allows token in body for background workers if cookie is stripped.
2. **Device Exclusivity Verification Fast Path**:
   - Driver UID is resolved from `auth.uid`.
   - Extracts `requestDeviceId` from payload `deviceId` or header `x-device-id`.
   - Checks `getPositiveTripLock(driverUid, busId)` in memory. If absent (e.g. cold container), checks `getRedisTripLock(busId)`. If valid, primes in-memory `setActiveTripCache` and sets `activeLock`.
   - If `activeLock` exists, belongs to `driverUid`, and matches `requestDeviceId`:
     - Sets `sessionVerified = true` in `<0.01ms` with **0 Supabase reads**.
     - Updates `setCachedDeviceSession(driverUid, requestDeviceId, Date.now())`.
   - If `!sessionVerified`:
     - Looks up `getCachedDeviceSession(driverUid)` (TTL 8 seconds).
     - If miss, queries PostgreSQL `device_sessions` for `feature = 'driver_location_share'` ordered by `last_active_at DESC`.
     - If an active session exists on another device within the last 30,000ms (`sessionAge <= 30000`), rejects with HTTP `403 Forbidden`, `code: 'ANOTHER_DEVICE_ACTIVE'`.
3. **Basic Coordinates Validation**:
   - Verifies `busId`, that `lat` and `lng` are numeric and not Null Island (`0, 0`). Rejects with `400 Bad Request` if invalid.
4. **Invocation of `processUpdate`**:
   - Calls `processLocationUpdate` from `src/domains/gps/services/gps-pipeline.service.ts`.
   - If `!result.accepted`, returns HTTP `400 Bad Request` with `{ error: result.reason }`.
5. **Realtime Broadcast**:
   - Non-blocking call to `emitEvent(`bus_location_${busId}`, 'bus_location_update', payload)` with normalized coordinates (`norm.lat`, `norm.lng`, `norm.speed`, `norm.heading`, `norm.accuracy`, `norm.tripId`, `norm.timestamp`).
   - Caught with `console.warn` so realtime transport failures never break HTTP 200 delivery to the driver.
6. **Throttled Heartbeat Persistence**:
   - Evaluates `shouldWriteHeartbeat(busId, nowMs)` against a 30,000ms window.
   - If 30 seconds have elapsed:
     - Calculates `extendedExpiresAt = new Date(nowMs + 600 * 1000).toISOString()`.
     - Calls `setActiveTripCache(busId, ...)` refreshing memory and Redis lock TTL to 600s.
     - Asynchronously dispatches `supabase.from('active_trips').update({ last_heartbeat, expires_at })` matching `bus_id`, `driver_id`, and `status = 'active'`.
     - If `requestDeviceId` is present, updates `supabase.from('device_sessions').update({ last_active_at })`.
     - Awaits `Promise.all(writePromises)`.
7. **HTTP Response**:
   - Returns HTTP `200 OK` with `{ success: true, message: 'Location updated successfully', tripId, timestamp }`.

---

#### 5.3.2 `processLocationUpdate` (`src/domains/gps/services/gps-pipeline.service.ts`)
1. **Defensive Rejection of Fallbacks**:
   - Rejects if `raw.isFallback === true` or `raw.source === 'fallback'` with `ErrorClass.GPS_INVALID_COORDINATES`.
2. **Bounds & Regional Sanity Checks (`validateBounds`)**:
   - Rejects non-finite coordinates.
   - Rejects Null Island (`lat === 0 && lng === 0`).
   - Rejects coordinates outside Assam / Northeast India corridor:
     - `lat < 25.0 || lat > 28.5`
     - `lng < 89.5 || lng > 96.5`
   - Rejects speed > `200 km/h`.
   - Rejects heading outside `[0, 360]`.
   - Rejects accuracy > `150 meters` (calibrated to prevent starved student maps while filtering severe urban canyon multipath reflections).
3. **Trip Ownership Verification (`checkActiveTrip`)**:
   - Checks negative cache (2s TTL).
   - Checks positive cache (35s TTL).
   - Checks Redis `trip:active:<busId>`.
   - Falls back to PostgreSQL `active_trips` if cache miss.
4. **Multi-Instance Redis Lua Atomic Guard (`atomicGpsGuardAndUpdate`)**:
   - Executes atomic Lua script in Redis.
   - Rejections mapped to exact error classes:
     - `stale_raw` -> `GPS_OUT_OF_ORDER`
     - `out_of_order` -> `GPS_OUT_OF_ORDER`
     - `jump` -> `GPS_JUMP_TOO_LARGE`
     - `speed` -> `GPS_SPEED_EXCEEDED`
     - `duplicate` -> `GPS_DUPLICATE_TIMESTAMP`
     - `redis_unavailable` -> `DATABASE_UNAVAILABLE` (fails closed in production).
5. **Synchronous Process-Local Sync**:
   - Updates `inMemoryLastLocations.set(busId, ...)` and `inMemoryLastRawTs.set(busId, ...)`.
6. **Non-Blocking Background Tasks**:
   - Calls `trackStopDwell` (stop dwell detection for incontrovertible audit logs).
   - Calls `processWaitingFlagsOnGpsTick` (hands-free proximity auto-ack <= 600m and pass-by cleanup).
7. **Return Value**:
   - Returns `{ accepted: true, normalized, persisted: false }`.

---

#### 5.3.3 `atomicGpsGuardAndUpdate` & `LUA_GPS_GUARD` (`src/domains/gps/services/gps-redis-guard.ts`)
1. **Network Layer**:
   - Direct raw TCP / TLS client implementing RESP protocol parser (`+OK`, `-ERR`, `:INT`, `$BULK`, `*ARRAY`).
   - Keeps connection alive with TCP keepalive (`30s`).
   - 2,000ms timeout per command to avoid hung promises under half-open TCP states.
2. **Lua Script Execution (`LUA_GPS_GUARD`)**:
   - Key: `gps:last:<busId>`.
   - `HMGET key lat lng ts rawTs`.
   - **Check 1: Raw Clock Replay Guard**:
     `if newRawTs > 0 and curRawTs ~= nil and newRawTs < curRawTs then return 'stale_raw' end`.
   - **Check 2: Normalised Timestamp Ordering**:
     `if curTs ~= nil and newTs > 0 and newTs + 5000 < curTs then return 'out_of_order' end` (5,000ms clock skew tolerance).
   - **Check 3: Haversine Jump Guard**:
     Calculates spherical distance between `(curLat, curLng)` and `(newLat, newLng)`.
     `if dist > maxJump (5000m) then return 'jump' end`.
   - **Check 4: Duplicate Timestamp Jump Guard**:
     `if curTs ~= nil and newTs == curTs then if dist > 50 then return 'duplicate' else return 'ok' end end`.
   - **Check 5: Implied Speed Guard**:
     `if dist > 100 and timeDiffSec > 0.5 then if (dist / timeDiffSec) > (200 / 3.6) then return 'speed' end end`.
   - **Commit & Refresh**:
     `HSET key lat newLat lng newLng ts newTs rawTs clampedRaw speed ARGV[9] heading ARGV[10] accuracy ARGV[11]`.
     `EXPIRE key 1200` (refreshes 20-minute key TTL).
     Returns `'ok'`.
3. **Multi-Instance Production Safety Invariant**:
   - If Redis connection fails in `NODE_ENV === 'production'`, the guard **FAILS CLOSED** and returns `'redis_unavailable'`. This prevents independent Next.js containers from accepting interleaved out-of-order packets.
   - Falls back to `memoryGuard` only in non-production/dev environments.

---

### 5.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Scenario A: Warm Cache, Normal Cruising Tick (Between Heartbeat Intervals, e.g. T = 2s, 4s, ..., 28s)
- **PostgreSQL Queries**: **0**
  - Device session verified via `activeLock.deviceId` in memory (<0.01ms).
  - Trip verified via `positiveLockCache` (35s TTL).
  - Heartbeat throttled by `shouldWriteHeartbeat` (30s interval).
- **Redis Commands**: **1 to 2**
  - `EVAL LUA_GPS_GUARD 1 gps:last:<busId> ...` (checks and updates coordinates in 1 round-trip).
  - (`trackStopDwell` cruising guard skips Redis if speed >= 5 km/h; `processWaitingFlagsOnGpsTick` returns local mirror if synced < 4s).
- **WebSocket Frames Emitted**: **1**
  - Frame sent to `bus_location_<busId>` with `bus_location_update`.
- **External Network Calls**: **0**.

#### Scenario B: Warm Cache, Heartbeat Persistence Tick (T = 30s, 60s, 90s, ...)
- **PostgreSQL Queries**: **2**
  1. `UPDATE public.active_trips SET last_heartbeat = now, expires_at = now + 600s WHERE bus_id = $1 AND driver_id = $2 AND status = 'active'` (Index: `idx_active_trips_bus_driver_active`).
  2. `UPDATE public.device_sessions SET last_active_at = now WHERE user_id = $1 AND device_id = $2 AND feature = 'driver_location_share'` (Index: `device_sessions_user_id_feature_idx`).
- **Redis Commands**: **2 to 3**
  1. `EVAL LUA_GPS_GUARD 1 gps:last:<busId> ...`
  2. `SET trip:active:<busId> ... EX 120` (refreshed via `setActiveTripCache`).
- **WebSocket Frames Emitted**: **1** (`bus_location_update`).
- **External Network Calls**: **0**.

#### Scenario C: Cold Cache / Worker Restart Tick (First packet landing on a fresh container)
- **PostgreSQL Queries**: **0 to 1**
  - If Redis has `trip:active:<busId>`: **0 DB queries**. Reads Redis lock, populates `positiveLockCache`, verifies device session in memory.
  - If Redis lock has expired: **1 DB query**: `SELECT trip_id, route_id, driver_id, status, expires_at FROM active_trips WHERE bus_id = $1 AND driver_id = $2 AND status = 'active' LIMIT 1`.
- **Redis Commands**: **2**
  1. `GET trip:active:<busId>` (to resolve lock across containers).
  2. `EVAL LUA_GPS_GUARD 1 gps:last:<busId> ...`
- **WebSocket Frames Emitted**: **1**.
- **External Network Calls**: **0**.

#### Scenario D: Redis / Network Failure
- **In Production (`NODE_ENV === 'production'`)**:
  - Redis connection fails -> Fails Closed -> Returns HTTP `400` with `{ error: 'GPS guard cluster coordination unavailable; packet rejected to preserve spatial safety' }`.
  - **PostgreSQL Queries**: **0**.
  - **WebSocket Frames**: **0** (broadcast blocked to prevent corrupted telemetry).
- **In Development (`NODE_ENV !== 'production'`)**:
  - Falls back to `memoryGuard` in-memory Map. Accepts valid packets locally.
  - **PostgreSQL Queries**: **0** (if in-memory cache valid).

---

### 5.5 Verbatim Source Code from Live Codebase

#### 5.5.1 `src/app/api/location/update/route.ts`
```typescript
// Lines 1 - 186 of src/app/api/location/update/route.ts
import { processUpdate, setActiveTripCache, getPositiveTripLock, getRedisTripLock } from '@/domains/gps';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getCachedDeviceSession, setCachedDeviceSession } from '@/lib/services/device-session-cache';
import { shouldWriteHeartbeat } from '@/lib/services/location-write-throttle';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId, deviceId } = body as any;
    const driverUid = auth.uid;

    const requestDeviceId = deviceId || (request instanceof Request ? request.headers.get('x-device-id') : (request as any).headers?.get?.('x-device-id'));
    const supabase = getSupabaseServer();
    const writePromises: Promise<void>[] = [];

    // Zero-Waste Fast Path: If incoming request matches the active trip lock in memory,
    // device session is verified in <0.01ms with 0 Supabase reads.
    let sessionVerified = false;
    let activeLock = getPositiveTripLock(driverUid, busId);
    if (!activeLock) {
      // Cold-start or cross-worker: Check Redis lock to populate positiveLockCache before falling back to device_sessions
      const redisLock = await getRedisTripLock(busId);
      if (redisLock && redisLock.driverId === driverUid && redisLock.expiresAtMs > Date.now()) {
        setActiveTripCache(busId, redisLock);
        activeLock = getPositiveTripLock(driverUid, busId);
      }
    }
    if (activeLock && activeLock.driverId === driverUid && requestDeviceId && activeLock.deviceId === requestDeviceId) {
      sessionVerified = true;
      setCachedDeviceSession(driverUid, requestDeviceId, Date.now());
    }

    if (!sessionVerified) {
      let sessionData = getCachedDeviceSession(driverUid);
      if (!sessionData) {
        const { data } = await supabase
          .from('device_sessions')
          .select('device_id, last_active_at')
          .eq('user_id', driverUid)
          .eq('feature', 'driver_location_share')
          .order('last_active_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data) {
          const lastActiveAtMs = new Date(data.last_active_at).getTime();
          setCachedDeviceSession(driverUid, data.device_id, lastActiveAtMs);
          sessionData = { deviceId: data.device_id, lastActiveAtMs, cachedAtMs: Date.now() };
        }
      }

      if (sessionData) {
        const sessionAge = Date.now() - sessionData.lastActiveAtMs;
        if (sessionAge <= 30000 && (!requestDeviceId || sessionData.deviceId !== requestDeviceId)) {
          return NextResponse.json({
            success: false,
            error: 'Active session exists on another device. Location update rejected.',
            code: 'ANOTHER_DEVICE_ACTIVE',
            requestId,
          }, { status: 403 });
        }

        if (requestDeviceId && sessionData.deviceId === requestDeviceId) {
          setCachedDeviceSession(driverUid, requestDeviceId, Date.now());
        }
      }
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    if (!busId || isNaN(numLat) || isNaN(numLng) || (numLat === 0 && numLng === 0)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid GPS location data provided. Please ensure GPS is active and try again.',
        requestId,
      }, { status: 400 });
    }

    const result = await processUpdate({
      driverId: driverUid,
      tripId: tripId || '',
      busId,
      routeId: routeId || '',
      lat: Number(lat),
      lng: Number(lng),
      accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
      heading: heading !== undefined ? Number(heading) : undefined,
      speed: speed !== undefined ? Number(speed) : undefined,
      timestamp: timestamp ? String(timestamp) : new Date().toISOString(),
      correlationId: requestId,
    });

    if (!result.accepted) {
      const isUnavailable = result.errorClass === 'DATABASE_UNAVAILABLE' || result.reason?.toLowerCase().includes('unavailable');
      return NextResponse.json({ error: result.reason }, { status: isUnavailable ? 503 : 400 });
    }

    // Non-blocking broadcast via WebSocket.
    // Use pipeline-normalized values (not raw body) so the broadcast is consistent
    // with what was validated and persisted by the GPS pipeline.
    const norm = result.normalized;
    emitEvent(`bus_location_${busId}`, 'bus_location_update', {
      busId,
      driverUid,
      lat: norm?.lat ?? numLat,
      lng: norm?.lng ?? numLng,
      accuracy: norm?.accuracy ?? accuracy,
      speed: norm?.speed ?? speed,
      heading: norm?.heading ?? heading ?? 0,
      tripId: norm?.tripId || tripId || undefined,
      timestamp: norm?.timestamp?.toISOString() || (timestamp ? String(timestamp) : new Date().toISOString()),
    }).catch((err: Error) => console.warn('Location broadcast failed:', err));


    // Persist heartbeat to PostgreSQL active_trips and device_sessions (throttled to 1 write/bus/30s).
    // CRITICAL: must also extend expires_at, not just last_heartbeat.
    // trip-status filters .gt('expires_at', now) — if we only write last_heartbeat
    // the trip lock expires 10 minutes after start and the student sees "Trip Inactive"
    // even though GPS HTTP 200 continues. The 600s TTL matches acquire_trip_lock /
    // extend_trip_lock RPCs (LOCK_TTL_SECONDS = 600 in trip-lock-service.ts).
    const nowMs = Date.now();

    if (shouldWriteHeartbeat(busId, nowMs)) {
      const extendedExpiresAt = new Date(nowMs + 600 * 1000).toISOString();
      const currentLock = getPositiveTripLock(driverUid, busId);
      setActiveTripCache(busId, {
        tripId: norm?.tripId || tripId || currentLock?.tripId || 'unknown_trip',
        driverId: driverUid,
        routeId: routeId || currentLock?.routeId || norm?.routeId,
        shift: (body as any).shift || norm?.shift || currentLock?.shift,
        deviceId: requestDeviceId || currentLock?.deviceId || undefined,
        expiresAtMs: nowMs + 600 * 1000,
      });
      writePromises.push(
        (async () => {
          const { error } = await supabase
            .from('active_trips')
            .update({
              last_heartbeat: new Date(nowMs).toISOString(),
              expires_at: extendedExpiresAt,
            })
            .eq('bus_id', busId)
            .eq('driver_id', driverUid)
            .eq('status', 'active');
          if (error) console.warn('Failed to update active_trips heartbeat:', error);
        })()
      );
      if (requestDeviceId) {
        writePromises.push(
          (async () => {
            const { error } = await supabase
              .from('device_sessions')
              .update({
                last_active_at: new Date(nowMs).toISOString(),
              })
              .eq('user_id', driverUid)
              .eq('device_id', requestDeviceId)
              .eq('feature', 'driver_location_share');
            if (error) console.warn('Failed to update device_sessions heartbeat:', error);
          })()
        );
      }
    }


    if (writePromises.length > 0) {
      await Promise.all(writePromises);
    }

    return NextResponse.json({
      success: true,
      message: 'Location updated successfully',
      tripId: result.normalized?.tripId,
      timestamp: result.normalized?.timestamp.toISOString(),
    });
  },
  {
    requiredRoles: ['driver'],
    schema: LocationUpdateBodySchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
```

---

#### 5.5.2 `src/domains/gps/services/gps-pipeline.service.ts`
```typescript
// Lines 1 - 307 of src/domains/gps/services/gps-pipeline.service.ts
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
```

---

#### 5.5.3 `src/domains/gps/services/gps-persistence.service.ts`
```typescript
// Lines 1 - 172 of src/domains/gps/services/gps-persistence.service.ts
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
  deviceId?: string;
  expiresAtMs: number;
  cachedUntilMs: number;
}
const positiveLockCache = new Map<string, PositiveTripLock>();
const POSITIVE_CACHE_TTL_MS = 35_000; // 35 seconds: covers 30s heartbeat interval

export function setActiveTripCache(busId: string, data: { tripId: string; driverId: string; routeId?: string; deviceId?: string; expiresAtMs: number }): void {
  const cacheKey = `${data.driverId}:${busId}`;
  negativeLockCache.delete(cacheKey);
  positiveLockCache.set(cacheKey, {
    tripId: data.tripId,
    driverId: data.driverId,
    routeId: data.routeId,
    deviceId: data.deviceId,
    expiresAtMs: data.expiresAtMs,
    cachedUntilMs: Date.now() + POSITIVE_CACHE_TTL_MS,
  });
  setRedisTripLock(busId, data).catch(() => {});
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

export async function checkActiveTrip(driverId: string, busId: string, tripId: string): Promise<{ valid: boolean; reason?: string }> {
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
    return { valid: true };
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
        deviceId: redisLock.deviceId,
        expiresAtMs: redisLock.expiresAtMs,
        cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
      });
      return { valid: true };
    }
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
  // Populate Redis cache for cross-node 0-DB read path
  setRedisTripLock(busId, {
    tripId: activeTrip.trip_id,
    driverId,
    routeId: activeTrip.route_id,
    expiresAtMs,
  }).catch(() => {});

  // Clear any stale negative cache entry and populate short-lived positive cache.
  negativeLockCache.delete(cacheKey);
  positiveLockCache.set(cacheKey, {
    tripId: activeTrip.trip_id,
    driverId,
    routeId: activeTrip.route_id,
    expiresAtMs,
    cachedUntilMs: now + POSITIVE_CACHE_TTL_MS,
  });
  if (positiveLockCache.size > 5000) {
    const firstKey = positiveLockCache.keys().next().value;
    if (firstKey) positiveLockCache.delete(firstKey);
  }

  return { valid: true };
}
```

---

#### 5.5.4 `src/domains/gps/services/gps-redis-guard.ts` (LUA_GPS_GUARD & Redis Coordination)
```typescript
// Excerpt of core atomic Redis Lua guard implementation in src/domains/gps/services/gps-redis-guard.ts
const KEY_PREFIX = 'gps:last:';
const TTL_SECONDS = 1200; // 20 minutes
const RECONNECT_DELAY_MS = 3000;
const CONNECT_TIMEOUT_MS = 3000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000; // 2 minutes

const LUA_GPS_GUARD = `
local key = KEYS[1]
local newLat    = tonumber(ARGV[1])
local newLng    = tonumber(ARGV[2])
local newTs     = tonumber(ARGV[3])
local newRawTs  = tonumber(ARGV[4])
local maxJump   = tonumber(ARGV[5])
local maxSkew   = tonumber(ARGV[6])

local cur = redis.call('HMGET', key, 'lat', 'lng', 'ts', 'rawTs')
local curLat   = tonumber(cur[1])
local curLng   = tonumber(cur[2])
local curTs    = tonumber(cur[3])
local curRawTs = tonumber(cur[4])

-- Raw clock replay guard
if newRawTs > 0 and curRawTs ~= nil and newRawTs < curRawTs then
  return 'stale_raw'
end

-- Normalised timestamp ordering guard (5s skew tolerance)
if curTs ~= nil and newTs > 0 and newTs + 5000 < curTs then
  return 'out_of_order'
end

-- Haversine jump + speed guard (only when we have a previous fix)
if curLat ~= nil and curLng ~= nil then
  local R = 6371000
  local lat1 = math.rad(curLat)
  local lat2 = math.rad(newLat)
  local dlat = math.rad(newLat - curLat)
  local dlng = math.rad(newLng - curLng)
  local sinDlat = math.sin(dlat / 2)
  local sinDlng = math.sin(dlng / 2)
  local a = sinDlat * sinDlat + math.cos(lat1) * math.cos(lat2) * sinDlng * sinDlng
  local c = 2 * math.atan(math.sqrt(a), math.sqrt(1 - a))
  local dist = R * c

  if dist > maxJump then
    return 'jump'
  end

  -- Duplicate timestamp check: identical ts with significant relocation (>50m) is rejected
  if curTs ~= nil and newTs > 0 and newTs == curTs then
    if dist > 50 then
      return 'duplicate'
    end
    return 'ok'
  end

  if curTs ~= nil and newTs > 0 then
    local timeDiffSec = (newTs - curTs) / 1000.0
    if dist > 100 and timeDiffSec > 0.5 then
      local speedMps = dist / timeDiffSec
      local maxSpeedMps = 200.0 / 3.6
      if speedMps > maxSpeedMps then
        return 'speed'
      end
    end
  end
end

-- Accept: write new state and refresh TTL
local clampedRaw = newRawTs
if newRawTs > 0 then
  local serverNow = tonumber(ARGV[7])
  if newRawTs > serverNow + maxSkew then
    clampedRaw = serverNow + maxSkew
  end
end

redis.call('HSET', key, 'lat', newLat, 'lng', newLng, 'ts', newTs, 'rawTs', clampedRaw)
if ARGV[9] and ARGV[9] ~= '' then redis.call('HSET', key, 'speed', ARGV[9]) end
if ARGV[10] and ARGV[10] ~= '' then redis.call('HSET', key, 'heading', ARGV[10]) end
if ARGV[11] and ARGV[11] ~= '' then redis.call('HSET', key, 'accuracy', ARGV[11]) end
redis.call('EXPIRE', key, tonumber(ARGV[8]))
return 'ok'
`;

export async function atomicGpsGuardAndUpdate(
  busId: string,
  newLat: number,
  newLng: number,
  newTs: number,
  newRawTs: number | null,
  speed?: number | null,
  heading?: number | null,
  accuracy?: number | null,
): Promise<GpsGuardResult> {
  ensureInit();
  const state = getState();

  if ((!state.ready || !state.socket || state.socket.destroyed) && process.env.REDIS_URL) {
    if (!state.socket || state.socket.destroyed) {
      connectGpsRedis(state);
    }
    await waitForReady(state, 800);
  }

  if (state.ready && state.socket && !state.socket.destroyed) {
    try {
      const key = `${KEY_PREFIX}${busId}`;
      const rawTsArg = newRawTs !== null ? String(newRawTs) : '-1';
      const serverNow = String(Date.now());
      const speedArg = speed != null && Number.isFinite(speed) ? String(speed) : '';
      const headingArg = heading != null && Number.isFinite(heading) ? String(heading) : '';
      const accuracyArg = accuracy != null && Number.isFinite(accuracy) ? String(accuracy) : '';

      // EVALSHA is not used here (no script pre-loading); EVAL is fine at this
      // call frequency (50 buses × 0.5 Hz = 25 calls/sec max).
      const result = await sendCommand(state, [
        'EVAL', LUA_GPS_GUARD, '1', key,
        String(newLat), String(newLng), String(newTs),
        rawTsArg,
        String(MAX_JUMP_M),
        String(MAX_CLOCK_SKEW_MS),
        serverNow,
        String(TTL_SECONDS),
        speedArg,
        headingArg,
        accuracyArg,
      ]);

      if (result === 'ok' || result === 'stale_raw' || result === 'jump'
          || result === 'speed' || result === 'out_of_order' || result === 'duplicate') {
        return result as GpsGuardResult;
      }
      // Unexpected result — log and evaluate fallback policy below
    } catch (e) {
      console.warn('[gps-redis] atomicGpsGuardAndUpdate Redis error:', e);
    }
  }

  // Multi-instance Production Invariant:
  // In production, if Redis is unavailable or unconfigured, FAIL CLOSED.
  // Independent Next.js serverless instances must not accept interleaved GPS packets bypassing jump/replay protection.
  const isProd = process.env.NODE_ENV === 'production';
  const hasRedisConfig = Boolean(process.env.REDIS_URL);

  if (isProd) {
    if (!hasRedisConfig) {
      console.error('[gps-redis] FAIL-CLOSED: REDIS_URL is not configured in production. Rejecting GPS update to protect spatial invariants across instances.');
      return 'redis_unavailable';
    }
    console.error('[gps-redis] FAIL-CLOSED: Redis coordination unavailable in production. Rejecting GPS update to protect spatial invariants.');
    return 'redis_unavailable';
  }

  // Non-production (development / test) fallback: allow local in-memory fallback
  return memoryGuard(busId, newLat, newLng, newTs, newRawTs, speed, heading, accuracy);
}
```

---

#### 5.5.5 `src/lib/services/device-session-cache.ts`
```typescript
// Lines 1 - 39 of src/lib/services/device-session-cache.ts
export interface CachedDeviceSession {
  deviceId: string;
  lastActiveAtMs: number;
  cachedAtMs: number;
}

const sessionCache = new Map<string, CachedDeviceSession>();
const CACHE_TTL_MS = 8000;

export function getCachedDeviceSession(userId: string): CachedDeviceSession | null {
  const cached = sessionCache.get(userId);
  if (!cached) return null;
  if (Date.now() - cached.cachedAtMs > CACHE_TTL_MS) {
    sessionCache.delete(userId);
    return null;
  }
  return cached;
}

export function setCachedDeviceSession(userId: string, deviceId: string, lastActiveAtMs: number): void {
  sessionCache.set(userId, {
    deviceId,
    lastActiveAtMs,
    cachedAtMs: Date.now(),
  });
}

export function invalidateCachedDeviceSession(userId: string): void {
  sessionCache.delete(userId);
}
```

---

#### 5.5.6 `src/lib/services/location-write-throttle.ts`
```typescript
// Lines 1 - 43 of src/lib/services/location-write-throttle.ts
const MIN_BREADCRUMB_INTERVAL_MS = 60 * 1000;
const breadcrumbWriteCache = new Map<string, number>();

export function shouldWriteLocationBreadcrumb(tripId: string, nowMs: number): boolean {
  const lastWrite = breadcrumbWriteCache.get(tripId) || 0;

  if (nowMs - lastWrite < MIN_BREADCRUMB_INTERVAL_MS) {
    return false;
  }

  breadcrumbWriteCache.set(tripId, nowMs);
  if (breadcrumbWriteCache.size > 5000) {
    const firstKey = breadcrumbWriteCache.keys().next().value;
    if (firstKey) breadcrumbWriteCache.delete(firstKey);
  }

  return true;
}

export function clearTripBreadcrumbCache(tripId: string): void {
  breadcrumbWriteCache.delete(tripId);
}

// Heartbeat throttle: caps active_trips.last_heartbeat writes to 1 per bus per 30s.
const MIN_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const heartbeatWriteCache = new Map<string, number>();

export function shouldWriteHeartbeat(busId: string, nowMs: number): boolean {
  const last = heartbeatWriteCache.get(busId) || 0;
  if (nowMs - last < MIN_HEARTBEAT_INTERVAL_MS) return false;
  heartbeatWriteCache.set(busId, nowMs);
  if (heartbeatWriteCache.size > 1000) {
    const first = heartbeatWriteCache.keys().next().value;
    if (first) heartbeatWriteCache.delete(first);
  }
  return true;
}

export function clearHeartbeatCache(busId: string): void {
  heartbeatWriteCache.delete(busId);
}
```

---

