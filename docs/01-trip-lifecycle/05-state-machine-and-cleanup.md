# Trip State Machine, Fleet Radar, Stale-Lock Reaper & Bus Runtime State Eviction (Forensic Truth)

**Module:** Trip Lifecycle FSM (`SCHEDULED` -> `IN_TRANSIT` -> `COMPLETED`/`CANCELLED`), Stale Lock Eviction & Fleet Radar  
**File Authority:** `src/app/api/trips/end/route.ts`, `src/app/api/cron/stale-trip-reaper/route.ts`, `src/lib/services/bus-runtime-state.ts`  
**Database Procedures:** `end_trip_atomically`, `reap_stale_trips_v2`, `evictAllBusRuntimeState`  

---

## PART 10: Admin/Moderator Live Fleet Radar, Trip Termination ("End Trip") & Automated Stale-Lock Cron Recovery

### 10.1 Sub-Domain Architecture & Exact Execution Pipeline

The Fleet Radar, Trip Termination, and Stale-Lock Recovery engines handle aggregate visibility, orderly shutdown, and unassisted recovery from driver phone dropouts or dead-zone abandonments.

```
                  [ Driver Taps "End Trip" on HUD ]
                                 │
                                 │ POST /api/driver/end-journey-v2
                                 │ (Note: /api/driver/end-trip is 410 Gone)
                                 ▼
       ┌────────────────────────────────────────────────────────┐
       │ 1. Trip Orchestrator Preflight (trip-orchestrator.ts)  │
       │ - Ownership verification: activeTrip.driver_id === auth│
       │ - Compute trip duration: (now - start_time)            │
       │ - Short-Trip Classification:                           │
       │   duration < 10 min -> 'terminated_early' in history   │
       └────────────────────────┬───────────────────────────────┘
                                │
                                ▼
       ┌────────────────────────────────────────────────────────┐
       │ 2. PostgreSQL Atomic RPC: end_trip_atomically          │
       │ - Row lock (FOR UPDATE) on active_trips                │
       │ - DELETE FROM active_trips                             │
       │ - Filter < 10m short trips from regular completion     │
       │ - INSERT INTO driver_trip_history                      │
       └────────────────────────┬───────────────────────────────┘
                                │
                                ▼
       ┌────────────────────────────────────────────────────────┐
       │ 3. Comprehensive Trip Teardown (trip-cleanup.service)  │
       │ - Parallel cleanup:                                    │
       │   * DELETE FROM waiting_flags WHERE bus_id = $1        │
       │   * DELETE FROM device_sessions WHERE user_id = driver │
       │   * DEL Redis flags:active:<busId>                     │
       │   * DEL Redis dwell:active:<busId> & trip:active:<busId│
       │   * DEL Redis gps:last:<busId>                         │
       │ - Invalidate in-memory caches:                         │
       │   * invalidateActiveTripCache()                        │
       │   * clearInMemoryLastLocation()                        │
       │   * invalidateBusTripSnapshot()                        │
       │ - Flush open stop dwell log to stop_dwell_logs         │
       └────────────────────────┬───────────────────────────────┘
                                │
                                ▼
       ┌────────────────────────────────────────────────────────┐
       │ 4. Fan-Out & Notification Teardown                     │
       │ - Broadcast waiting_flag_removed for deleted flags     │
       │ - Broadcast trip_ended to bus and route channels       │
       │ - Bounded FCM Dispatch: TRIP_ENDED (5,000ms race)      │
       └────────────────────────────────────────────────────────┘

                               OR

            [ Automated Nightly / Webhook Cron Recovery ]
                                 │
                                 │ GET /api/cron/cleanup-stale-locks
                                 ▼
       ┌────────────────────────────────────────────────────────┐
       │ 1. Timing-Safe Authorization (cron-auth.ts)            │
       │ - crypto.timingSafeEqual(header, CRON_SECRET)          │
       │ - Fail-closed: 401 Unauthorized if secret missing      │
       └────────────────────────┬───────────────────────────────┘
                                │
                                ▼
       ┌────────────────────────────────────────────────────────┐
       │ 2. PostgreSQL Stale Sweeper RPC: cleanup_stale_locks   │
       │ - Parameter: p_heartbeat_timeout_seconds = 600 (10 min)│
       │ - Finds active_trips where last_heartbeat < now - 600s │
       │   OR expires_at < now                                  │
       │ - Atomically deletes stale records and archives them   │
       │   into driver_trip_history (status: 'expired')         │
       │ - Returns list of cleaned bus_id, driver_id, trip_id   │
       └────────────────────────┬───────────────────────────────┘
                                │
                                ▼
       ┌────────────────────────────────────────────────────────┐
       │ 3. Parallel Cross-Domain Eviction                      │
       │ - For each cleaned lock in parallel:                   │
       │   * Clear Redis keys & in-memory caches                │
       │   * Flush any lingering stop dwell log                 │
       │   * Soft-archive waiting_flags to status = 'expired'   │
       │   * DELETE device_sessions                             │
       │   * Emit trip_ended (reason: 'heartbeat_timeout')      │
       │ - Run ancillary RPCs:                                  │
       │   * expire_waiting_flags()                             │
       │   * cleanup_stale_device_sessions()                    │
       │   * cleanup_abandoned_application_locks()              │
       └────────────────────────────────────────────────────────┘
```

---

### 10.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/fleet/live-status/route.ts` | `GET` | `FleetMap.tsx`, Admin / Moderator Dashboards | `verifyApiAuth`, `applyRateLimit`, `getLastLocationForBusAsync`, `getSupabaseServer` | Mutates `fleetCache` (3s TTL), `inFlightFleetFetches` |
| `src/components/maps/FleetMap.tsx` | `FleetMap` | `src/app/admin/fleet-map/page.tsx`, `src/app/moderator/fleet-map/page.tsx` | `maplibregl`, `fetch('/api/fleet/live-status')` | MapLibre fleet pins and popups |
| `src/app/api/driver/end-journey-v2/route.ts` | `POST` (wrapped in `withSecurity`) | Driver live tracking HUD ("End Trip" button) | `tripService.endTrip`, `trip-orchestrator.ts` | Canonical HTTP entrypoint for ending trips |
| `src/app/api/driver/end-trip/route.ts` | `POST` (Deprecated stub) | Legacy callers (returns 410 Gone) | None | Rejects with 410 Gone |
| `src/domains/trip/services/trip-orchestrator.ts` | `endTrip`, `startTrip`, `heartbeat` | `src/app/api/driver/end-journey-v2/route.ts` | `tripLockService.endTrip`, `cleanupTrip`, `invalidateActiveTripCache`, `clearInMemoryLastLocation`, `broadcastTripEvent`, `dispatchFcmBounded` | Mutates active trip locks, history records, and caches |
| `src/domains/trip/services/trip-cleanup.service.ts` | `cleanupTrip` | `trip-orchestrator.ts` | `supabase.from('waiting_flags')`, `supabase.from('device_sessions')`, `clearRedisActiveFlags`, `flushStopDwellOnTripEnd` | Deletes transient flags and sessions, evicts Redis keys |
| `src/app/api/cron/cleanup-stale-locks/route.ts` | `GET` | Vercel Cron / External keepalive schedulers | `verifyCronAuth`, `supabase.rpc('cleanup_stale_locks')`, `emitEvent`, `cleanupTrip` | Cleans stale database locks and evicts zombie state |
| `src/lib/security/cron-auth.ts` | `verifyCronAuth` | `src/app/api/cron/cleanup-stale-locks/route.ts` | `crypto.timingSafeEqual` | None |

---

### 10.3 Method-by-Method Low-Level Walkthrough

#### 10.3.1 Fleet Live Status Radar API (`src/app/api/fleet/live-status/route.ts`)
1. **Security & Authorization**:
   - Access restricted to roles `['admin', 'moderator']`. Rate limited via `RateLimits.READ`.
2. **Singleflight Fleet Status Coalescing (`getCoalescedFleetStatus`)**:
   - Checks `fleetCache` (3,000ms TTL).
   - If miss, uses `inFlightFleetFetches` to ensure only **1 execution** runs across simultaneous requests.
3. **Parallel Database Queries**:
   - Executes 4 queries in parallel via `Promise.all`:
     1. `supabase.from('buses').select('id, bus_number, model, capacity, current_members, driver_uid, driver_name, route_id, route_name, status')`.
     2. `supabase.from('routes').select('id, route_name, stops, total_stops')`.
     3. `supabase.from('active_trips').select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, end_time, last_heartbeat, expires_at').eq('status', 'active')`.
     4. `supabase.from('driver_profiles').select('uid, full_name, phone, bus_id, route_id, shift, trip_active, active_trip_id').eq('trip_active', true)`.
4. **Telemetry Ingestion & Freshness Classification**:
   - For each bus, reads latest coordinate from Redis via `getLastLocationForBusAsync(busId)`.
   - Categorizes signal health:
     - **`LIVE`**: `ageMs <= 15,000ms` (15s).
     - **`STALE`**: `15,000ms < ageMs <= 60,000ms` (60s).
     - **`NO_SIGNAL`**: `ageMs > 60,000ms` or coordinate missing on an active trip.
     - **`INACTIVE`**: Bus has no active trip running.
5. **Response Summary**:
   - Returns JSON: `{ buses, summary: { totalFleet, activeTrips, liveSignal, staleSignal, noSignal, inactiveUnits }, timestamp }`.

---

#### 10.3.2 Driver Trip Termination (`src/app/api/driver/end-journey-v2/route.ts` & `trip-orchestrator.ts`)
1. **Endpoint Resolution**:
   - Driver HUD calls `POST /api/driver/end-journey-v2`. (`POST /api/driver/end-trip` returns HTTP `410 Gone`).
2. **Ownership & Duration Preflight**:
   - Queries `active_trips` for the bus. Validates that `activeTrip.driver_id === auth.uid`.
   - Computes elapsed trip duration: `tripDurationMinutes = (Date.now() - startTimeMs) / 60000`.
   - **Short-Trip Classification**: If `tripDurationMinutes > 0 && tripDurationMinutes < 10`, marks as short trip (`terminated_early`).
3. **Atomic State Transition (`end_trip_atomically` RPC)**:
   - Invokes PostgreSQL RPC: `end_trip_atomically(activeTripId, driverId, busId, 600)`.
   - Executes `SELECT ... FROM active_trips FOR UPDATE`.
   - Deletes row from `active_trips`.
   - If duration >= 10 minutes: inserts into `driver_trip_history` with status `'completed'`.
   - If duration < 10 minutes: inserts with status `'terminated_early'`, reason `'short_trip'`.
4. **Comprehensive Teardown (`cleanupTrip`)**:
   - Executes parallel cleanup via `Promise.all`:
     1. `supabase.from('waiting_flags').delete().eq('bus_id', busId).in('status', ['raised', 'acknowledged', 'waiting']).select('id, student_uid, bus_id')`.
     2. `supabase.from('device_sessions').delete().eq('user_id', driverId)`.
     3. Evicts Redis active flags: `clearRedisActiveFlags(busId)`.
   - Invalidates caches: `invalidateCachedDeviceSession(driverId)`, `invalidateActiveTripCache(busId, driverId)`, `clearInMemoryLastLocation(busId)`.
   - Flushes active stop dwell: `flushStopDwellOnTripEnd(busId)` (persists any ongoing stop visit to `stop_dwell_logs`).
5. **Realtime & Push Notification Broadcast**:
   - For every deleted waiting flag, emits `waiting_flag_removed` (`reason: 'trip_ended'`) to both the student channel and the bus channel.
   - Broadcasts `trip_ended` event to WebSocket cluster: `broadcastTripEvent({ busId, tripId, event: 'trip_ended' })`.
   - Dispatches FCM push notification with 5,000ms race timeout: `dispatchFcmBounded(dispatchTripNotification(..., 'TRIP_ENDED'))`.

---

#### 10.3.3 Automated Stale-Lock Cron Recovery (`src/app/api/cron/cleanup-stale-locks/route.ts`)
1. **Timing-Safe Cron Authorization**:
   - `verifyCronAuth(request)`: extracts `Authorization: Bearer <CRON_SECRET>`.
   - Compares with `process.env.CRON_SECRET` using `crypto.timingSafeEqual`. Returns 401 if missing or mismatched.
2. **PostgreSQL RPC Sweeper (`cleanup_stale_locks`)**:
   - Calls `supabase.rpc('cleanup_stale_locks', { p_heartbeat_timeout_seconds: 600 })`.
   - Finds rows where `last_heartbeat < now - 600s` or `expires_at < now`.
   - Atomically deletes stale rows from `active_trips` and inserts archive entries into `driver_trip_history` with `status: 'expired'`.
3. **Parallel Cross-Domain Eviction**:
   - Iterates through all returned cleaned locks concurrently via `Promise.allSettled`:
     - Clears in-memory GPS state: `clearInMemoryLastLocation(lock.cleaned_bus_id)`.
     - Evicts Redis active flags: `clearRedisActiveFlags(lock.cleaned_bus_id)`.
     - Invalidates active trip cache: `invalidateActiveTripCache(lock.cleaned_bus_id, lock.cleaned_driver_id)`.
     - Flushes stop dwell: `flushStopDwellOnTripEnd(lock.cleaned_bus_id)`.
     - Broadcasts `trip_ended` over WebSocket with `reason: 'heartbeat_timeout'`.
     - Soft-archives remaining waiting flags to status `'expired'`.
     - Deletes driver `device_sessions`.
4. **Ancillary System Maintenance**:
   - Runs database cleanup RPCs in parallel:
     - `supabase.rpc('expire_waiting_flags')`
     - `supabase.rpc('cleanup_stale_device_sessions')`
     - `supabase.rpc('cleanup_abandoned_application_locks')`

---

### 10.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Scenario A: Driver Ends Trip Normally via HUD (`POST /api/driver/end-journey-v2`)
- **PostgreSQL Operations**: **3 to 4**
  1. Preflight check: `SELECT ... FROM active_trips WHERE bus_id = $1`.
  2. RPC call: `end_trip_atomically` (Row lock, delete `active_trips`, insert `driver_trip_history`).
  3. Cleanup write: `DELETE FROM waiting_flags WHERE bus_id = $1 ... RETURNING ...`.
  4. Cleanup write: `DELETE FROM device_sessions WHERE user_id = $1`.
  5. (Optional flush of `stop_dwell_logs` if bus was dwelling at stop: 1 insert).
- **Redis Commands**: **4**
  1. `DEL flags:active:<busId>`.
  2. `DEL dwell:active:<busId>`.
  3. `DEL trip:active:<busId>`.
  4. `DEL gps:last:<busId>`.
- **WebSocket Frames Emitted**: **1 + M**
  - 1 `trip_ended` frame broadcast to `trip-status-<busId>`.
  - M `waiting_flag_removed` frames (1 for each student flag that was cancelled).
- **External Calls**: **1** (FCM multicast dispatch via Firebase Admin SDK with 5s timeout).

#### Scenario B: Admin/Moderator Views Fleet Live Radar (`GET /api/fleet/live-status`)
- **PostgreSQL Queries**: **4 Total across entire fleet!** (Singleflight deduplicated with 3s TTL):
  1. `SELECT ... FROM buses`.
  2. `SELECT ... FROM routes`.
  3. `SELECT ... FROM active_trips WHERE status = 'active'`.
  4. `SELECT ... FROM driver_profiles WHERE trip_active = true`.
- **Redis Commands**: **N** (`HMGET gps:last:<busId>` for each active bus).
- **WebSocket Frames**: **0**.
- **External Calls**: **0**.

#### Scenario C: Cron Stale-Lock Execution (`GET /api/cron/cleanup-stale-locks`)
- **PostgreSQL Operations**: **4 to 5**
  1. RPC call: `cleanup_stale_locks(600)`.
  2. Scoped waiting flags archive: `UPDATE waiting_flags SET status = 'expired' WHERE bus_id = $1 ...`.
  3. Scoped session delete: `DELETE FROM device_sessions WHERE user_id = $1`.
  4. Ancillary sweeps: `expire_waiting_flags`, `cleanup_stale_device_sessions`, `cleanup_abandoned_application_locks`.
- **Redis Commands**: **1 to 2 per cleaned bus** (`clearRedisActiveFlags`, `clearRedisTripLock`).
- **WebSocket Frames Emitted**: **1 per cleaned bus** (`trip_ended` with `reason: 'heartbeat_timeout'`).
- **External Calls**: **0**.

---

### 10.5 Verbatim Source Code from Live Codebase

#### 10.5.1 `src/app/api/driver/end-journey-v2/route.ts`
```typescript
// Lines 1 - 35 of src/app/api/driver/end-journey-v2/route.ts
import * as tripService from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EndTripSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const startTime = Date.now();
    const { busId, tripId } = body as any;
    const driverUid = auth.uid;

    const result = await tripService.endTrip({ driverId: driverUid, busId, tripId });

    if (!result.success) {
      return NextResponse.json({ error: result.reason }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      message: 'Journey ended successfully',
      tripId: result.tripId,
      busId,
      cleanupStats: { activeTrips: result.tripId ? 1 : 0, totalTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  },
  {
    requiredRoles: ['driver'],
    schema: EndTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
```

---

#### 10.5.2 `src/app/api/driver/end-trip/route.ts` (Deprecated 410 Gone Endpoint)
```typescript
// Lines 1 - 31 of src/app/api/driver/end-trip/route.ts
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint reached end-of-life on 2026-09-01 and has been permanently removed.',
      alternative: 'POST /api/driver/end-journey-v2',
      code: 'ENDPOINT_REMOVED',
    },
    {
      status: 410,
      headers: {
        'Sunset': 'Mon, 01 Sep 2026 00:00:00 GMT',
        'Link': '</api/driver/end-journey-v2>; rel="successor-version"',
      },
    }
  );
}
```

---

#### 10.5.3 `src/domains/trip/services/trip-orchestrator.ts` (`endTrip`)
```typescript
// Lines 162 - 293 of src/domains/trip/services/trip-orchestrator.ts
export async function endTrip(params: EndTripParams): Promise<EndTripOutput> {
  const start = Date.now();
  const supabase = getSupabaseServer();
  const logCtx = { driverId: params.driverId, busId: params.busId, tripId: params.tripId };

  let activeTripId = params.tripId;
  let routeId = '';
  let routeName = 'your route';
  let tripDurationMinutes = 0;

  const activeTrip = await tripLockService.getActiveTrip(params.busId);
  if (activeTrip) {
    if (activeTrip.driver_id !== params.driverId) {
      appLogger.warn('trip', 'end_rejected', { ...logCtx, reason: 'ownership_denied', errorClass: ErrorClass.TRIP_OWNERSHIP_DENIED, latencyMs: Date.now() - start });
      return { success: false, reason: 'Only the assigned driver can end this trip' };
    }
    if (activeTripId && activeTripId !== activeTrip.trip_id) {
      appLogger.warn('trip', 'end_rejected', { ...logCtx, reason: 'trip_mismatch', errorClass: ErrorClass.TRIP_NOT_FOUND, latencyMs: Date.now() - start });
      return { success: false, reason: 'Trip mismatch for this bus' };
    }
    if (!activeTripId) activeTripId = activeTrip.trip_id;
    routeId = activeTrip.route_id || '';

    const startTimeStr = (activeTrip as any).start_time || (activeTrip as any).created_at;
    if (startTimeStr) {
      const startTimeMs = new Date(startTimeStr).getTime();
      if (Number.isFinite(startTimeMs) && startTimeMs > 0) {
        tripDurationMinutes = (Date.now() - startTimeMs) / (1000 * 60);
      }
    }
  } else {
    const { data: busData } = await supabase
      .from('buses')
      .select('route_id, route_name, bus_number')
      .eq('id', params.busId)
      .maybeSingle();
    if (busData) {
      routeId = busData.route_id || '';
      routeName = busData.route_name || 'your route';
      Object.assign(params, { _cachedBusNumber: busData.bus_number || params.busId });
    }
  }

  if (routeId) {
    const resolvedName = await resolveRouteName(routeId);
    if (resolvedName !== routeId) routeName = resolvedName;
  }

  if (!activeTripId) {
    appLogger.info('trip', 'end_noop', { ...logCtx, reason: 'no_active_trip', latencyMs: Date.now() - start });
    return { success: true, reason: 'No active trip found' };
  }

  const IS_SHORT_TRIP = tripDurationMinutes > 0 && tripDurationMinutes < 10;

  if (IS_SHORT_TRIP) {
    appLogger.info('trip', 'short_duration_classified', {
      ...logCtx,
      tripId: activeTripId,
      durationMinutes: Math.round(tripDurationMinutes * 10) / 10,
      classification: 'terminated_early (short_trip)',
      reason: 'Trip duration < 10 minutes — recorded as terminated_early in history',
    });
  }

  // 1. Authoritative state transition FIRST — no side effects until this succeeds.
  const endResult = await tripLockService.endTrip(activeTripId, params.driverId, params.busId, 600);

  if (!endResult.success) {
    appLogger.error('trip', 'end_failed', { ...logCtx, tripId: activeTripId, reason: endResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: endResult.reason };
  }

  if (endResult.alreadyEnded) {
    appLogger.info('trip', 'end_duplicate_suppressed', { ...logCtx, tripId: activeTripId, latencyMs: Date.now() - start });
    invalidateActiveTripCache(params.busId, params.driverId);
    return { success: true, tripId: activeTripId };
  }

  // 2. RPC succeeded — clean up transient state.
  await Promise.allSettled([
    cleanupTrip({ driverId: params.driverId, busId: params.busId, tripId: activeTripId }),
  ]);

  invalidateActiveTripCache(params.busId, params.driverId);
  clearInMemoryLastLocation(params.busId);

  const cachedBusNumber = (params as any)._cachedBusNumber;
  const busNumber = cachedBusNumber || (activeTrip ? (activeTrip as any).bus_number : null) || params.busId;

  appLogger.info('trip', 'ended', { ...logCtx, tripId: activeTripId, routeId, durationMinutes: Math.round(tripDurationMinutes * 10) / 10, latencyMs: Date.now() - start });

  // 3. Broadcast only after authoritative success.
  broadcastTripEvent({
    busId: params.busId,
    tripId: activeTripId,
    event: 'trip_ended',
    busNumber,
  });

  await dispatchFcmBounded(
    dispatchTripNotification({
      routeId: routeId || 'unassigned_route',
      tripId: activeTripId,
      routeName,
      busId: params.busId,
      eventType: 'TRIP_ENDED',
    }),
    'trip end'
  );

  return { success: true, tripId: activeTripId };
}
```

---

#### 10.5.4 `src/domains/trip/services/trip-cleanup.service.ts`
```typescript
// Lines 1 - 63 of src/domains/trip/services/trip-cleanup.service.ts
import { clearHistory, flushStopDwellOnTripEnd, invalidateActiveTripCache } from '@/domains/gps';
import { clearRedisActiveFlags } from '@/domains/gps/services/gps-redis-guard';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { clearTripBreadcrumbCache } from '@/lib/services/location-write-throttle';
import { invalidateCachedDeviceSession } from '@/lib/services/device-session-cache';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function cleanupTrip(params: {
  driverId: string;
  busId: string;
  tripId: string;
}) {
  const supabase = getSupabaseServer();

  // 1. Delete first, capturing what was actually removed.
  const [{ data: deletedFlags }, ] = await Promise.all([
    supabase.from('waiting_flags')
      .delete()
      .eq('bus_id', params.busId)
      .in('status', ['raised', 'acknowledged', 'waiting'])
      .select('id, student_uid, bus_id'),
    supabase.from('device_sessions').delete().eq('user_id', params.driverId),
    clearRedisActiveFlags(params.busId).catch(() => {}),
  ]);

  // 2. Atomically evict all bus runtime state across all memory and Redis layers 
  await evictAllBusRuntimeState(params.busId, params.driverId, params.tripId);

  // 3. Broadcast only the flags that were actually deleted.
  if (deletedFlags && deletedFlags.length > 0) {
    const broadcastPromises: Promise<any>[] = [];

    for (const flag of deletedFlags) {
      broadcastPromises.push(
        emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
          flagId: flag.id,
          studentUid: flag.student_uid,
          busId: flag.bus_id,
          status: 'cancelled',
          reason: 'trip_ended',
        }).catch((err: Error) => console.warn('[cleanupTrip] student broadcast failed:', err))
      );

      broadcastPromises.push(
        emitEvent(`waiting_flags_${flag.bus_id}`, 'waiting_flag_removed', {
          flagId: flag.id,
          studentUid: flag.student_uid,
          student_uid: flag.student_uid,
          busId: flag.bus_id,
          status: 'cancelled',
          reason: 'trip_ended',
        }).catch((err: Error) => console.warn('[cleanupTrip] bus channel broadcast failed:', err))
      );
    }

    await Promise.allSettled(broadcastPromises);
  }
}
```

---

#### 10.5.5 `src/app/api/cron/cleanup-stale-locks/route.ts`
```typescript
// Lines 39 - 146 of src/app/api/cron/cleanup-stale-locks/route.ts
export async function GET(request: Request) {
    if (!verifyCronAuth(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    const stats = {
        staleLocksCleaned: 0,
        comprehensiveCleanups: 0,
        errors: [] as string[]
    };

    try {
        const supabase = getSupabaseServer();

        // STEP 1: Clean stale active trips using database function
        try {
            const { data: cleanedLocks, error: cleanError } = await supabase
                .rpc('cleanup_stale_locks', { p_heartbeat_timeout_seconds: HEARTBEAT_TIMEOUT_SECONDS });

            if (cleanError) {
                console.error('Error cleaning stale locks:', cleanError);
                stats.errors.push('stale_locks_cleanup_error');
            } else if (cleanedLocks && cleanedLocks.length > 0) {
                stats.staleLocksCleaned = cleanedLocks.length;

                const cleanupResults = await Promise.allSettled(
                    cleanedLocks.map(async (lock: any) => {
                        // Atomically evict all bus runtime state across all memory and Redis layers 
                        await evictAllBusRuntimeState(lock.cleaned_bus_id, lock.cleaned_driver_id, lock.cleaned_trip_id);
                        emitEvent(`trip-status-${lock.cleaned_bus_id}`, 'trip_ended', {
                            busId: lock.cleaned_bus_id,
                            tripId: lock.cleaned_trip_id,
                            reason: 'heartbeat_timeout',
                            timestamp: new Date().toISOString()
                        }).catch(() => {});

                        const { data: expiredFlags } = await supabase
                            .from('waiting_flags')
                            .update({ status: 'expired' })
                            .eq('bus_id', lock.cleaned_bus_id)
                            .in('status', ['raised', 'acknowledged', 'waiting'])
                            .select('id, student_uid, bus_id');

                        if (expiredFlags && expiredFlags.length > 0) {
                            for (const flag of expiredFlags) {
                                emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
                                    flagId: flag.id,
                                    studentUid: flag.student_uid,
                                    busId: flag.bus_id,
                                    reason: 'heartbeat_timeout',
                                }).catch(() => {});
                                emitEvent(`waiting_flags_${lock.cleaned_bus_id}`, 'waiting_flag_removed', {
                                    flagId: flag.id,
                                    studentUid: flag.student_uid,
                                    busId: flag.bus_id,
                                    reason: 'heartbeat_timeout',
                                }).catch(() => {});
                            }
                        }

                        await supabase.from('device_sessions').delete().eq('user_id', lock.cleaned_driver_id);

                        return lock.cleaned_bus_id;
                    })
                );

                for (const r of cleanupResults) {
                    if (r.status === 'fulfilled') {
                        stats.comprehensiveCleanups++;
                    } else {
                        stats.errors.push(`comprehensive_cleanup_error`);
                    }
                }
            }
        } catch (err: any) {
            stats.errors.push('stale_locks_general_error');
        }

        // STEP 2: Ancillary system health sweep
        try {
            await Promise.allSettled([
                supabase.rpc('expire_waiting_flags'),
                supabase.rpc('cleanup_stale_device_sessions'),
                supabase.rpc('cleanup_abandoned_application_locks'),
            ]);
        } catch {}

        return NextResponse.json({
            success: true,
            stats,
            durationMs: Date.now() - startTime
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
```

---

#### 10.5.6 `src/lib/security/cron-auth.ts`
```typescript
// Lines 1 - 21 of src/lib/security/cron-auth.ts
import crypto from 'crypto';

/**
 * SECURITY: Fail-closed timing-safe cron authorization check.
 * Verifies Authorization: Bearer <CRON_SECRET> header against process.env.CRON_SECRET.
 */
export function verifyCronAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('🚫 CRON_SECRET not configured — blocking cron request');
    return false;
  }

  const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
  if (providedToken.length !== cronSecret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(cronSecret));
}
```

---

## 11. FORENSIC AUDIT SUMMARY: END-TO-END TRIP LIFECYCLE MATRIX

The following comprehensive synthesis documents the exact file count, architectural roles, and physical I/O budgets across all 10 stages of the Assam down town University Intelligent Transport Management System (ADTU ITMS) Trip Lifecycle.

| Part | Sub-Domain Focus | Primary Production Source Files Audited | Invariants Enforced | Typical PostgreSQL I/O | Typical Redis I/O | Typical WebSocket Traffic |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| **PART 1** | Database Spine, DDL, Constraints & RPCs | `COMPLETE_SCHEMA.sql`, `acquire_trip_lock`, `end_trip_atomically`, `cleanup_stale_locks` | INV-1 (3-way trip lock), RLS, Partial Unique Indexes | DDL / ACID RPCs | N/A | N/A |
| **PART 2** | Driver Trip Initiation & Lock Acquisition | `/api/driver/initiate-trip`, `trip-orchestrator.ts`, `trip-lock-service.ts` | Preflight lookups, Idempotent resume, Device session lock | 2 reads (preflight) + 1 RPC (`acquire_trip_lock`) | 1 `SET` (trip lock) | 1 frame (`trip_started`) |
| **PART 3** | Push Notification Fan-Out (FCM) | `trip-notification-service.ts`, `fcm.service.ts`, `dispatchFcmBounded` | 5,000ms bounded race, dead-token pruning, route topic fallback | 1 query (`fcm_tokens` chunked) | N/A | 0 frames |
| **PART 4** | Driver Live Tracking HUD & Maps | `/driver/live-tracking/page.tsx`, `LiveTrackingDriverMap.tsx`, `GuwahatiDriverMap.tsx` | WakeLock re-acquisition, 3s ticker, offline FIFO queue | 0 DB queries (client-side) | 0 Redis (client-side) | Local WebSocket loop |
| **PART 5** | Authoritative GPS Ingress & Lua Guard | `/api/location/update/route.ts`, `gps-pipeline.service.ts`, `gps-redis-guard.ts` | Regional bounds, 150m accuracy, atomic `LUA_GPS_GUARD`, 30s heartbeat throttle | 0 on cruising ticks; 2 updates per 30s | 1 `EVAL` (`LUA_GPS_GUARD`) per tick | 1 frame (`bus_location_update`) |
| **PART 6** | Incontrovertible Stop Dwell Audit Engine | `stop-dwell.service.ts`, `canonical-route-geometries.ts`, `/api/admin/trip-dwell-logs` | INV-2 (Dwell proof), 80m enter / 100m exit, 15s roadside halt | 0 cruising; 1 insert on stop exit | 0 cruising; 1 `SET` dwelling; 1 `DEL` exit | 0 frames |
| **PART 7** | WebSocket Server Cluster (`ws1`) | `server/websocket-server.ts`, `socket-router.ts`, `authenticator.ts`, `redis-broadcast.ts` | First-message JWT auth, Permanent Shift Isolation, 4401 security eviction | 2 reads on cold presence; 0 on warm | 1 pub/sub listener (`role_invalidate`) | 1 frame per subscriber |
| **PART 8** | Student Live Tracking Experience | `/student/track-bus`, `/api/student/trip-status`, `trip-snapshot-cache.ts`, `GuwahatiMap.tsx` | Singleflight 3s coalescing, 3-strike hysteresis snap, 1800ms quartic ease-out | 1 query per 60 students; 0 on warm cache | 1 `HMGET` (live fix) | 1 snapshot frame on subscribe |
| **PART 9** | Waiting Flag 3-Lock Corridor Engine | `/api/student/waiting-flag`, `stop-dwell.service.ts`, `/api/driver/ack-flag` | 120m corridor lock, 4km approach lock, max 2 anti-spam, auto-ack <= 600m | 2 reads + 1 insert on raise; 0 on auto-ack | 3 on raise; 2 on auto-ack; 2 on pass-by | 2 frames on raise; 2 on auto-ack; 2 on pass-by |
| **PART 10** | Fleet Radar, End Trip & Stale-Lock Cron | `/api/fleet/live-status`, `/api/driver/end-journey-v2`, `/api/cron/cleanup-stale-locks` | Sub-10m short trip filter, 410 Gone stub, timing-safe cron, 600s heartbeat timeout | 4 queries for fleet; 3 writes on end trip; 4 on cron sweep | 4 `DEL` on end trip; 2 `DEL` per stale lock | 1 `trip_ended` frame |

---



---

## PART 14: THE 7 FORENSIC CODE DEFECTS & UNIFIED BUS RUNTIME STATE AGGREGATE (FINAL POST-AUDIT HARDENING)

Following the forensic code inspection of the live `.ts` implementations, 7 concrete code defects and state fragmentation issues were identified, surgically remediated on disk, and verified against all invariants:

### 14.1 Forensic Code Defect Remediations

#### Architectural Specification 1: Preserve `shift` and `routeId` Across All `setActiveTripCache` Calls & Heartbeat Refreshes
* **Locations:** [`src/domains/gps/services/gps-persistence.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-persistence.service.ts), [`src/domains/gps/services/gps-redis-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-redis-guard.ts), [`src/app/api/location/update/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/location/update/route.ts), [`src/app/api/driver/initiate-trip/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver/initiate-trip/route.ts), [`src/domains/trip/services/trip-orchestrator.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/trip/services/trip-orchestrator.ts)
* **Defect Caught:** In `location/update/route.ts`, when `shouldWriteHeartbeat` ran every 30s, it called `setActiveTripCache` without passing `shift`, wiping out `shift` from `positiveLockCache` and Redis `trip:active:<busId>`. After 30s, evening reverse-direction waiting-flag calculations degraded.
* **Hardened Verbatim Solution:**
  - Added `shift?: string` to `PositiveTripLock` and `RedisTripLockData`.
  - In `setActiveTripCache(busId, data)`, if `data.shift`, `data.routeId`, or `data.deviceId` are undefined, the existing values from `positiveLockCache.get(cacheKey)` are merged non-destructively.
  - Heartbeat refreshes in `location/update/route.ts` pass `shift: (body as any).shift || norm?.shift || currentLock?.shift`.
  - `initiate-trip/route.ts` and `trip-orchestrator.ts` pass `shift` explicitly on trip start and resume.

#### Architectural Specification 2: Move Waiting-Flag Cooldown Increment (`incrementStudentTripFlagCount`) AFTER Validation
* **Locations:** [`src/domains/gps/services/gps-redis-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-redis-guard.ts), [`src/app/api/student/waiting-flag/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/student/waiting-flag/route.ts)
* **Defect Caught:** Lock 3 (`incrementStudentTripFlagCount`) executed before Lock 1 (Corridor) and Lock 2 (Approaching Bus). Students attempting to raise a flag while the bus was 4.2 km away burned their 2-flag quota on `400 BUS_TOO_FAR_UPSTREAM` rejections, blocking legitimate flags later with `429 FLAG_COOLDOWN_ACTIVE`.
* **Hardened Verbatim Solution:**
  - Added read-only helper `getStudentTripFlagCount(tripId, studentUid)` in `gps-redis-guard.ts` (reading `flag:count:<tripId>:<studentUid>` with in-memory fallback).
  - In `waiting-flag/route.ts`, evaluated `const currentTripFlagCount = await getStudentTripFlagCount(tripId, studentUid); if (currentTripFlagCount >= 2) return 429;` before geofencing.
  - Moved `incrementStudentTripFlagCount(tripId, studentUid)` strictly **after** geofence validation and successful PostgreSQL `waiting_flags` insertion.

#### Architectural Specification 3: Enforce Permanent Shift Compatibility in `POST /api/student/waiting-flag/route.ts`
* **Location:** [`src/app/api/student/waiting-flag/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/student/waiting-flag/route.ts)
* **Defect Caught:** While `trip-status/route.ts` and `socket-router.ts` enforced shift isolation, `waiting-flag/route.ts` allowed students assigned to Morning shifts to raise waiting flags during an Evening trip.
* **Hardened Verbatim Solution:**
  - Verifies `isShiftCompatible(studentData.shift, activeTripRes.data?.shift)`.
  - Rejects cross-shift attempts with HTTP `403 Forbidden` (`code: 'SHIFT_MISMATCH'`, `error: 'You cannot raise a waiting flag for a trip outside your assigned shift.'`).

#### Architectural Specification 4: Canonical Bus ID Matching Across Endpoints & WebSockets
* **Locations:** [`src/lib/utils.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/utils.ts), [`server/socket-router.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/socket-router.ts), [`src/app/api/student/waiting-flag/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/student/waiting-flag/route.ts), [`src/app/api/student/trip-status/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/student/trip-status/route.ts), [`src/app/api/driver/ack-flag/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver/ack-flag/route.ts), [`src/app/api/driver/mark-boarded/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver/mark-boarded/route.ts)
* **Defect Caught:** Strict inequality `studentBusId !== busId` caused false rejections when student profiles stored `'01'` while route/bus hardware reported `'bus_01'`. Active trip queries with `.eq('bus_id', busId)` missed prefix-normalized active trips.
* **Hardened Verbatim Solution:**
  - Implemented and exported pure helpers `isMatchingBusId(a?, b?)` and `getBusIdVariations(busId)` stripping `bus_`, `bus-`, or leading zeros.
  - Converted `active_trips` lookups to `.in('bus_id', getBusIdVariations(busId))`.
  - Replaced strict string comparisons with `isMatchingBusId(...)` across all student, driver, and WebSocket presence handlers.

#### Architectural Specification 5: Graceful Redis Blip Fallback & HTTP 503 Status Code on Ingress Outage
* **Locations:** [`src/domains/gps/services/gps-redis-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-redis-guard.ts), [`src/app/api/location/update/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/location/update/route.ts)
* **Defect Caught:** In `location/update/route.ts`, `!result.accepted` returned HTTP 400 for all rejections. On transient Redis timeouts, returning 400 caused the driver HUD's offline queue to discard GPS packets as client validation errors rather than retrying.
* **Hardened Verbatim Solution:**
  - In `atomicGpsGuardAndUpdate`, when Redis throws a connection or timeout error after `checkActiveTrip` has already validated the trip, execution gracefully falls back to `memoryGuard(busId, newLat, newLng, newTs, newRawTs, speed, heading, accuracy)` with a warning log, preserving monotonicity and speed checks in process memory without blinding the vehicle.
  - In `location/update/route.ts`, if `result.errorClass === 'DATABASE_UNAVAILABLE'` or `result.reason?.includes('unavailable')`, the endpoint returns HTTP `503 Service Unavailable`, correctly triggering the driver client's retry and offline queue preservation.

#### Architectural Specification 6: Throttled Stop-Dwell Redis Writes & Unified Bus Runtime State Teardown
* **Locations:** [`src/domains/gps/services/stop-dwell.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/stop-dwell.service.ts), [`src/domains/trip/services/trip-cleanup.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/trip/services/trip-cleanup.service.ts), [`src/app/api/cron/cleanup-stale-locks/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/cron/cleanup-stale-locks/route.ts)
* **Defect Caught:** While stationary in an 80m stop zone, `setRedisActiveDwell` was invoked on every 2s tick. In addition, runtime cache invalidation on trip completion was fragmented across 6 distinct files, risking stale memory state if an invalidation step was omitted.
* **Hardened Verbatim Solution:**
  - In `stop-dwell.service.ts`, in-memory dwell time updates on every 2-second tick (`activeDwells.set`), but Redis synchronization is throttled to once on initial stop entry and once every 15 seconds thereafter (`lastRedisWriteMs`), reducing Redis dwell write traffic by **>85%**. Exit clears Redis immediately.
  - Implemented single unified teardown orchestrator `evictAllBusRuntimeState(busId: string, driverId?: string, tripId?: string)` in `trip-cleanup.service.ts`:
    ```typescript
    export async function evictAllBusRuntimeState(busId: string, driverId?: string, tripId?: string): Promise<void> {
      if (!busId) return;

      // 1. Invalidate active trip lock cache & DB state
      invalidateActiveTripCache(busId, driverId);

      // 2. Clear GPS pipeline location anchors, process-local raw timestamps, and driver history
      clearInMemoryLastLocation(busId);
      await clearGpsState(busId).catch(() => {});
      if (driverId) {
        clearHistory(driverId);
      }

      // 3. Flush & clear stop-dwell state (memory & Redis)
      await flushStopDwellOnTripEnd(busId).catch(() => {});
      clearStopDwellState(busId);

      // 4. Clear Redis waiting flags & active trip locks
      await Promise.allSettled([
        clearRedisActiveFlags(busId),
        clearRedisTripLock(busId),
      ]);

      // 5. Invalidate shared bus trip snapshot
      invalidateBusTripSnapshot(busId);

      // 6. Invalidate device session & local scanner cache if driverId provided
      if (driverId) {
        invalidateCachedDeviceSession(driverId);
        invalidateScannerBusCache(driverId);
      }

      // 7. Clear breadcrumb throttle cache if tripId provided
      if (tripId) {
        clearTripBreadcrumbCache(tripId);
      }
    }
    ```
  - Executed in both `cleanupTrip` (driver journey end) and `cleanup-stale-locks` (automated cron recovery).

#### Architectural Specification 7: Route Handlers Verification & Truth Synchronization
* **Locations:** [`src/app/api/driver/ack-flag/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver/ack-flag/route.ts), [`src/app/api/driver/mark-boarded/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver/mark-boarded/route.ts), [`src/app/api/cron/cleanup-stale-locks/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/cron/cleanup-stale-locks/route.ts)
* **Hardened Verbatim Solution:**
  - `ack-flag/route.ts`: Sets `status: 'acknowledged'`, `ack_sent: true`, updates Redis flag, invalidates bus trip snapshot, and emits to both `waiting_flags_<busId>` and `student_<uid>`.
  - `mark-boarded/route.ts`: Purges flag from Redis via `removeRedisActiveFlag(flagData.bus_id, flagId)` and invalidates snapshots.
  - `cleanup-stale-locks/route.ts`: Scopes flag expiration to `.in('status', ['waiting', 'raised', 'acknowledged'])`, calls `evictAllBusRuntimeState`, and broadcasts cancellation to affected students.

---

