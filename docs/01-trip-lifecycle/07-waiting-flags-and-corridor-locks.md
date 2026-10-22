# Waiting Flag 3-Lock Route-Corridor Engine & Hands-Free Driver HUD (Forensic Truth)

**Module:** Passenger Waiting Flags, Stop Proximity Auto-Dismissal, 3-Lock Corridor Serialization & HUD Alerts  
**File Authority:** `src/app/api/stops/waiting-flag/route.ts`, `src/domains/student/services/waiting-flag.service.ts`  
**Database Tables:** `student_waiting_flags`, `active_trips`, `stops`  

---

## PART 9: Waiting Flag 3-Lock Route-Corridor Engine, Hands-Free Driver HUD, Proximity Auto-Ack & Pass-By Cleanup

### 9.1 Sub-Domain Architecture & Exact Execution Pipeline

The Waiting Flag subsystem enables students to notify approaching bus drivers of their exact physical roadside pickup locations. To prevent false alarms, driver distraction, and database spam, the engine enforces a strict 3-Lock validation pipeline, self-healing Redis cache indexing, and hands-free automatic acknowledgment.

```
                    [ Student Taps "Raise Waiting Flag" ]
                                      │
                                      │ POST /api/student/waiting-flag
                                      │ Payload: { busId, lat, lng, timestamp, accuracy, ... }
                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ 1. Entitlement & Freshness Gates                             │
       │ - TransportEntitlementGuard: verify active semester pass     │
       │ - Bus Assignment Gate: studentBusId === busId                │
       │ - Duplicate Check: no existing active/unexpired flag         │
       │ - Active Trip Check: active trip must be running on bus      │
       │ - Freshness Gate: timestamp drift <= 60s from server time    │
       │ - Accuracy Gate: GPS horizontal accuracy <= 150m             │
       └──────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ 2. LOCK 3: Per-Trip Anti-Spam Cooldown Guard                 │
       │ - Redis INCR flag:count:<tripId>:<studentUid> (TTL 7200s)    │
       │ - IF count > 2: Reject HTTP 429 FLAG_COOLDOWN_ACTIVE         │
       │ - PostgreSQL Partial Unique Index:                           │
       │   idx_waiting_flags_one_active_student                       │
       └──────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ 3. LOCK 1: Continuous Route Corridor Geofence                │
       │ - projectPointToRouteCorridor({ lat, lng }, routeId)         │
       │ - IN-CORRIDOR VALIDATION:                                    │
       │   crossTrackDistanceMeters <= 120m to road centerline        │
       │   OR nearestStopDistanceMeters <= 200m to canonical stop     │
       │ - IF outside: Reject HTTP 403 OUT_OF_ROUTE_CORRIDOR          │
       └──────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ 4. LOCK 2: Directional Approaching Bus Window                │
       │ - Reads Redis getGpsStateFromRedis(busId) [0 DB reads!]      │
       │ - Computes route progress: busProgress vs studentProgress   │
       │ - Directional Awareness (Morning Outbound vs Evening Return):│
       │   * Already Passed: bus > 150m downstream -> HTTP 409        │
       │   * Too Far: bus > 4,000m upstream -> HTTP 400 (BUS_TOO_FAR) │
       └──────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
       ┌──────────────────────────────────────────────────────────────┐
       │ 5. Atomic Insertion & Multi-Channel Fan-Out                  │
       │ - INSERT INTO public.waiting_flags (status = 'raised')       │
       │ - Index in Redis flags:active:<busId> (TTL 7200s)            │
       │ - Set Redis flags:hydrated:<busId> (TTL 1800s)               │
       │ - Invalidate Bus Trip Snapshot cache                         │
       │ - Emit WebSocket events:                                     │
       │   * waiting_flags_<busId> ('waiting_flag_created')           │
       │   * student_<studentUid> ('waiting_flag_created')            │
       └──────────────────────────────┬───────────────────────────────┘
                                      │
       ┌──────────────────────────────┴───────────────────────────────┐
       │                                                              │
       │ (During Driver GPS Ingestion Ticks every 2s)                 │
       ▼                                                              ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Hands-Free Proximity Auto-Ack        │  │ Hands-Free Pass-By Auto-Cleanup      │
│ In stop-dwell.service.ts:            │  │ In stop-dwell.service.ts:            │
│ When 0 <= signedAheadMeters <= 600m: │  │ When signedAheadMeters < -200m:      │
│ - updateRedisActiveFlag(ackSent=true)│  │ - removeRedisActiveFlag(busId, flag) │
│ - Emit waiting_flag_acknowledged     │  │ - Emit waiting_flag_removed          │
│   (0 DB queries on hot path!)        │  │ - Async DB UPDATE status = 'expired' │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

---

### 9.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/student/waiting-flag/route.ts` | `POST`, `DELETE`, `GET` | Student UI (`/student/track-bus`, `/student/bus`) | `withSecurity`, `getTransportEntitlement`, `projectPointToRouteCorridor`, `checkApproachingBusWindow`, `incrementStudentTripFlagCount`, `setRedisActiveFlag`, `removeRedisActiveFlag`, `emitEvent`, `supabase.from('waiting_flags')` | Mutates PostgreSQL `waiting_flags`, Redis `flags:active:<busId>`, `flag:count:<tripId>:<uid>` |
| `src/domains/gps/services/stop-dwell.service.ts` | `processWaitingFlagsOnGpsTick` | `gps-pipeline.service.ts` | `isRedisFlagsHydrated`, `getRedisActiveFlags`, `updateRedisActiveFlag`, `removeRedisActiveFlag`, `projectPointToRouteCorridor`, `emitEvent`, `supabase.from('waiting_flags')` | Mutates Redis `flags:active:<busId>`, `flags:hydrated:<busId>`, PostgreSQL `waiting_flags` (expired) |
| `src/domains/gps/services/gps-redis-guard.ts` | `getRedisActiveFlags`, `setRedisActiveFlag`, `updateRedisActiveFlag`, `removeRedisActiveFlag`, `incrementStudentTripFlagCount`, `clearRedisActiveFlags` | `waiting-flag/route.ts`, `stop-dwell.service.ts`, `trip-cleanup.service.ts` | Redis TCP socket (`HGETALL`, `HSET`, `HDEL`, `INCR`, `EXPIRE`) | Mutates Redis `flags:active:<busId>`, `flag:count:<key>`, in-memory mirrors |
| `src/domains/route/services/route-alignment-engine.ts` | `projectPointToRouteCorridor`, `checkApproachingBusWindow`, `isReverseRouteDirection` | `waiting-flag/route.ts`, `stop-dwell.service.ts` | `getCanonicalRouteGeometry`, `getCanonicalStopsForRoute` | Pure computational geometry |
| `src/app/api/driver/ack-flag/route.ts` | `POST` (wrapped in `withSecurity`) | Driver live tracking HUD (`LiveTrackingDriverMap`) | `supabase.from('waiting_flags')`, `supabase.from('active_trips')`, `emitEvent` | Updates `waiting_flags.status = 'acknowledged'` |
| `src/app/api/driver/mark-boarded/route.ts` | `POST` (wrapped in `withSecurity`) | Driver live tracking HUD | `supabase.from('waiting_flags')`, `supabase.from('active_trips')`, `emitEvent` | Updates `waiting_flags.status = 'boarded'` |
| `src/hooks/useWaitingFlags.ts` | `useWaitingFlags` | Driver HUD components | `WebSocketClient`, `fetch('/api/driver/ack-flag')`, `fetch('/api/driver/mark-boarded')` | Driver UI active flags list |

---

### 9.3 Method-by-Method Low-Level Walkthrough

#### 9.3.1 Raising a Waiting Flag (`POST /api/student/waiting-flag`)
1. **Parallel Preflight Fetch**:
   - Queries student profile, existing active flags, and active bus trip in parallel:
     - Profile resolved via `getCachedStudentAssignment` (L1 + Redis).
     - `supabase.from('waiting_flags').select('id, status, created_at, expires_at').eq('student_uid', studentUid).in('status', ['raised', 'waiting', 'acknowledged'])`.
     - `supabase.from('active_trips').select('trip_id, bus_id, route_id, shift').eq('bus_id', busId).eq('status', 'active').maybeSingle()`.
2. **Entitlement & Bus Assignment Gate**:
   - `getTransportEntitlement(studentData)`: validates semester pass status, soft-block, and valid-until boundaries.
   - Validates that `studentData.bus_id === busId`.
   - Verifies active trip exists for bus; rejects with HTTP `409 NO_ACTIVE_TRIP` if no trip is currently active.
3. **Freshness & Accuracy Sanity Checks**:
   - Timestamp skew: `Math.abs(Date.now() - timestamp) > 60_000` -> Rejects with HTTP `400 TIMESTAMP_EXPIRED`.
   - GPS Accuracy: `accuracy > 150m` -> Rejects with HTTP `400 ACCURACY_TOO_LOW`.
4. **Lock 3: Per-Trip Anti-Spam Cooldown Guard**:
   - Executes atomic Redis counter `incrementStudentTripFlagCount(tripId, studentUid)`.
   - Sets a 7,200s key TTL on initial increment.
   - If count > 2, returns HTTP `429 Too Many Requests` with `code: 'FLAG_COOLDOWN_ACTIVE'`.
   - Backed at the database layer by partial unique index `idx_waiting_flags_one_active_student`.
5. **Lock 1: Continuous Route Corridor Geofence**:
   - Calls `projectPointToRouteCorridor({ lat, lng }, targetRouteId)`.
   - Computes perpendicular cross-track distance to the road centerline and distance to the nearest canonical stop.
   - Verification condition: `crossTrackDistanceMeters <= 120m || nearestStopDistanceMeters <= 200m`.
   - If false, returns HTTP `403 Forbidden` with `code: 'OUT_OF_ROUTE_CORRIDOR'`.
6. **Lock 2: Directional Approaching Bus Window**:
   - Reads current bus fix from Redis `getGpsStateFromRedis(busId)` (0 Supabase reads).
   - Computes bus route progress vs. student route progress.
   - Evaluates `checkApproachingBusWindow(busProgress, studentProgress, tripShift)`:
     - Direction-aware: Morning shifts travel 0 -> L (outbound); Evening shifts travel L -> 0 (return).
     - **Already Passed**: If bus has passed student location by `> 150m`, returns HTTP `409 Conflict` with `code: 'BUS_ALREADY_PASSED'`.
     - **Too Far Upstream**: If bus is `> 4,000m` upstream, returns HTTP `400 Bad Request` with `code: 'BUS_TOO_FAR_UPSTREAM'`.
7. **Atomic Insertion & Dual-Channel WebSocket Broadcast**:
   - Inserts row into PostgreSQL `waiting_flags` with `status = 'raised'`, `expires_at = now + 15 min`.
   - Caches flag in Redis `flags:active:<busId>` (TTL 7200s).
   - Emits `waiting_flag_created` on driver HUD channel `waiting_flags_<busId>` and student private channel `student_<uid>`.
   - Invalidates shared bus trip snapshot cache.

---

#### 9.3.2 Hands-Free Proximity Auto-Ack & Pass-By Auto-Cleanup (`stop-dwell.service.ts`)
1. **Execution Context**:
   - Runs inside `processWaitingFlagsOnGpsTick`, triggered on every accepted driver GPS update (0.5 Hz / 2s).
2. **Self-Healing Redis Hydration**:
   - Checks `isRedisFlagsHydrated(busId)`.
   - If Redis restarted mid-trip, executes a one-time lazy hydration from PostgreSQL `waiting_flags` into Redis `flags:active:<busId>` and sets `flags:hydrated:<busId>` (TTL 1800s).
3. **Proximity Auto-Acknowledgment (`<= 600m` upstream)**:
   - Reads active flags from Redis in O(1) time (**0 Supabase reads**).
   - Computes signed distance ahead: `signedAheadMeters`.
   - When `0 <= signedAheadMeters <= 600m` and `!flag.ackSent`:
     - Updates Redis flag: `updateRedisActiveFlag(busId, flagId, { ackSent: true })`.
     - Emits `waiting_flag_acknowledged` on `waiting_flags_<busId>` and `student_<uid>`.
     - Requires **0 PostgreSQL writes** on the hot path.
4. **Pass-By Auto-Cleanup (`> 200m` downstream)**:
   - When `signedAheadMeters < -200m` (bus is > 200m past student flag):
     - Evicts flag from Redis: `removeRedisActiveFlag(busId, flagId)`.
     - Emits `waiting_flag_removed` (`reason: 'bus_passed'`) to remove marker from driver map.
     - Fires non-blocking async PostgreSQL query: `UPDATE waiting_flags SET status = 'expired' WHERE id = flagId`.

---

#### 9.3.3 Driver Actions (`ack-flag` & `mark-boarded`)
1. **`POST /api/driver/ack-flag`**:
   - Authenticates driver and verifies active trip ownership on the flag's bus.
   - Atomically updates PostgreSQL `waiting_flags.status = 'acknowledged'`, `ack_by_driver_uid = driverUid`.
   - Broadcasts `waiting_flag_acknowledged` event to student and driver channels.
2. **`POST /api/driver/mark-boarded`**:
   - Verifies active trip on flag's bus.
   - Atomically updates `waiting_flags.status = 'boarded'`.
   - Broadcasts `waiting_flag_boarded` to driver channel and `flag_acknowledged` (`message: 'Driver has arrived!'`) to student channel.

---

### 9.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Scenario A: Student Raises Waiting Flag (Passing All 3 Locks)
- **PostgreSQL Queries**: **2**
  1. Preflight read: `SELECT id, status, created_at, expires_at FROM waiting_flags WHERE student_uid = $1 ...` AND `SELECT trip_id, bus_id, route_id, shift FROM active_trips WHERE bus_id = $2 ...` (executed in parallel).
  2. Write: `INSERT INTO public.waiting_flags (student_uid, student_name, bus_id, route_id, stop_name, status, trip_id, shift, stop_lat, stop_lng, expires_at) VALUES (...) RETURNING ...` (Hits partial unique index `idx_waiting_flags_one_active_student`).
- **Redis Commands**: **3**
  1. `INCR flag:count:<tripId>:<studentUid>` (Lock 3 spam check).
  2. `HMGET gps:last:<busId> lat lng` (Lock 2 approaching bus window).
  3. `HSET flags:active:<busId> <flagId> ...` (indexes active flag).
- **WebSocket Frames Emitted**: **2**
  1. `waiting_flag_created` -> `waiting_flags_<busId>` (Driver map HUD pin).
  2. `waiting_flag_created` -> `student_<studentUid>` (Student confirmation).
- **External Calls**: **0**.

#### Scenario B: Driver Approaches within 600m (Proximity Auto-Acknowledgment)
- **PostgreSQL Queries**: **0** (Entirely in-memory and Redis).
- **Redis Commands**: **2**
  1. `HGETALL flags:active:<busId>` (O(1) read).
  2. `HSET flags:active:<busId> <flagId> { ackSent: true }`.
- **WebSocket Frames Emitted**: **2** (`waiting_flag_acknowledged` to driver and student).
- **External Calls**: **0**.

#### Scenario C: Driver Passes Flag by > 200m (Pass-By Auto-Cleanup)
- **PostgreSQL Queries**: **1** (Non-blocking async update: `UPDATE waiting_flags SET status = 'expired' WHERE id = $1`).
- **Redis Commands**: **2** (`HGETALL flags:active:<busId>` + `HDEL flags:active:<busId> <flagId>`).
- **WebSocket Frames Emitted**: **2** (`waiting_flag_removed` to driver and student).
- **External Calls**: **0**.

#### Scenario D: Student Cancels Waiting Flag (`DELETE /api/student/waiting-flag`)
- **PostgreSQL Queries**: **1** (`UPDATE waiting_flags SET status = 'cancelled' WHERE id = $1 AND student_uid = $2`).
- **Redis Commands**: **1** (`HDEL flags:active:<busId> <flagId>`).
- **WebSocket Frames Emitted**: **2** (`waiting_flag_removed`).
- **External Calls**: **0**.

---

### 9.5 Verbatim Source Code from Live Codebase

#### 9.5.1 `src/app/api/student/waiting-flag/route.ts`
```typescript
// Lines 35 - 374 of src/app/api/student/waiting-flag/route.ts
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { busId, lat, lng, message, timestamp, routeId, stop_name, stopLat, stopLng, accuracy } = body as any;
        const studentUid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Parallelize student profile fetch, duplicate flag check, and active trip lookup
        const [studentData, existingFlagRes, activeTripRes] = await Promise.all([
            (async () => {
                if (typeof getCachedStudentAssignment === 'function') {
                    try {
                        const cached = await getCachedStudentAssignment(studentUid);
                        if (cached) {
                            return {
                                uid: cached.uid,
                                id: cached.uid,
                                fullName: cached.fullName,
                                bus_id: cached.busId,
                                busId: cached.busId,
                                route_id: cached.routeId,
                                routeId: cached.routeId,
                                shift: cached.shift,
                                stop_name: cached.stopName,
                                stopName: cached.stopName,
                                status: cached.status,
                                softBlock: cached.softBlock,
                                validUntil: cached.validUntil,
                                hardBlock: cached.hardBlock,
                            };
                        }
                    } catch {}
                }
                return getByUid(studentUid).catch(() => null);
            })(),
            supabase.from('waiting_flags')
                .select('id, status, created_at, expires_at')
                .eq('student_uid', studentUid)
                .in('status', ['raised', 'waiting', 'acknowledged'])
                .limit(5),
            supabase.from('active_trips')
                .select('trip_id, bus_id, route_id, shift')
                .in('bus_id', getBusIdVariations(busId))
                .eq('status', 'active')
                .maybeSingle()
        ]);

        if (!studentData) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

        const entitlement = getTransportEntitlement(studentData);
        if (!entitlement.entitled) {
            return NextResponse.json(
                { error: 'Transport access is not active for this account.', entitled: false, reason: entitlement.reason },
                { status: 403 }
            );
        }

        const studentBusId = studentData.bus_id || studentData.busId || (studentData as any).id;
        
        if (!studentBusId || !isMatchingBusId(studentBusId, busId)) {
            return NextResponse.json({
                error: `Forbidden: You are not assigned to bus ${busId}. Your assigned bus is ${studentBusId || 'none'}.`
            }, { status: 403 });
        }

        const activeExistingFlag = existingFlagRes.data?.find(f => !isWaitingFlagExpired(f));

        if (activeExistingFlag) {
            return NextResponse.json({
                success: false,
                error: 'You already have an active waiting flag for this bus',
                existingFlagId: activeExistingFlag.id
            }, { status: 409 });
        }

        if (existingFlagRes.data && existingFlagRes.data.length > 0) {
            const staleFlags = existingFlagRes.data.filter(f => isWaitingFlagExpired(f));
            for (const stale of staleFlags) {
                await supabase
                    .from('waiting_flags')
                    .update({ status: 'expired' })
                    .eq('id', stale.id);
            }
        }

        const tripId = activeTripRes.data?.trip_id;
        if (!tripId) {
            return NextResponse.json({
                success: false,
                error: 'Cannot raise waiting flag: No active trip is currently running on your assigned bus.',
                code: 'NO_ACTIVE_TRIP'
            }, { status: 409 });
        }

        // Permanent Shift Compatibility Validation (Invariant: Shift Compatibility)
        if (studentData.shift && activeTripRes.data?.shift && !isShiftCompatible(studentData.shift, activeTripRes.data.shift)) {
            return NextResponse.json({
                success: false,
                error: 'You cannot raise a waiting flag for a trip outside your assigned shift.',
                code: 'SHIFT_MISMATCH',
            }, { status: 403 });
        }

        // 2. Validate timestamp freshness (<= 60s skew)
        if (timestamp !== undefined && timestamp !== null) {
            const tsNum = Number(timestamp);
            if (Number.isFinite(tsNum) && Math.abs(Date.now() - tsNum) > 60_000) {
                return NextResponse.json({
                    success: false,
                    error: 'GPS coordinate timestamp expired or clock drifted > 60s from server time.',
                    code: 'TIMESTAMP_EXPIRED',
                }, { status: 400 });
            }
        }

        // 3. Validate GPS accuracy (<= 150m)
        if (accuracy !== undefined && accuracy !== null) {
            const accNum = Number(accuracy);
            if (Number.isFinite(accNum) && accNum > 150) {
                return NextResponse.json({
                    success: false,
                    error: `Reported GPS accuracy (${Math.round(accNum)}m) is too low (must be <= 150m).`,
                    code: 'ACCURACY_TOO_LOW',
                }, { status: 400 });
            }
        }

        let studentLat: number | null = null;
        let studentLng: number | null = null;
        if (lat !== undefined && lng !== undefined) {
            studentLat = parseFloat(lat as any);
            studentLng = parseFloat(lng as any);
        } else if (stopLat !== undefined && stopLng !== undefined) {
            studentLat = parseFloat(stopLat as any);
            studentLng = parseFloat(stopLng as any);
        }

        if (studentLat === null || studentLng === null || isNaN(studentLat) || isNaN(studentLng)) {
            return NextResponse.json({ error: 'Location is required', code: 'LOCATION_REQUIRED' }, { status: 400 });
        }

        // Lock 3: Per-Trip Anti-Spam Cooldown Guard (max 2 flag raises per trip) (Invariant: Anti-Spam Cooldown)
        const currentTripFlagCount = await getStudentTripFlagCount(tripId, studentUid);
        if (currentTripFlagCount >= 2) {
            return NextResponse.json({
                success: false,
                error: 'You have reached the maximum of 2 waiting flag raises for this trip.',
                code: 'FLAG_COOLDOWN_ACTIVE',
            }, { status: 429 });
        }

        const targetRouteId = routeId || studentData.route_id || studentData.routeId || activeTripRes.data?.route_id || 'route_1';
        const targetStopName = stop_name || studentData.stop_name || studentData.stopName;

        // Lock 1 — Continuous Route Corridor Geofence (<= 120m from Road Polyline OR <= 200m from Named Stop)
        const studentCorridor = projectPointToRouteCorridor(
            { lat: studentLat, lng: studentLng },
            targetRouteId
        );

        if (!studentCorridor.isInCorridor) {
            return NextResponse.json({
                success: false,
                error: 'You must be at the roadside along your bus route to raise a waiting flag.',
                code: 'OUT_OF_ROUTE_CORRIDOR',
                crossTrackDistanceMeters: studentCorridor.crossTrackDistanceMeters,
                nearestStopDistanceMeters: studentCorridor.nearestStopDistanceMeters,
            }, { status: 403 });
        }

        // Lock 2 — Directional & Approaching Bus Window (Zero DB Reads — Uses Redis gps:last:<busId>)
        const tripShift = activeTripRes.data?.shift || 'Morning';
        const busLoc = await getGpsStateFromRedis(busId);
        if (busLoc && Number.isFinite(busLoc.lat) && Number.isFinite(busLoc.lng)) {
            const busCorridor = projectPointToRouteCorridor(
                { lat: busLoc.lat, lng: busLoc.lng },
                targetRouteId
            );
            const busProgressMeters = busCorridor.routeProgressMeters;
            const studentProgressMeters = studentCorridor.routeProgressMeters;

            const windowCheck = checkApproachingBusWindow(
                busProgressMeters,
                studentProgressMeters,
                tripShift
            );

            if (windowCheck.alreadyPassed) {
                return NextResponse.json({
                    success: false,
                    error: 'Your bus has already passed your location on the route.',
                    code: 'BUS_ALREADY_PASSED',
                    busDeltaMeters: windowCheck.busDeltaMeters,
                }, { status: 409 });
            }

            if (windowCheck.tooFarUpstream) {
                return NextResponse.json({
                    success: false,
                    error: 'You can raise your waiting flag once the bus is within 4 km of your location.',
                    code: 'BUS_TOO_FAR_UPSTREAM',
                    upstreamDistanceMeters: windowCheck.signedAheadMeters,
                }, { status: 400 });
            }
        }

        const currentTimestamp = timestamp || Date.now();
        const flagExpiresAt = new Date(currentTimestamp + 15 * 60 * 1000).toISOString();
        const flagData: any = {
            student_uid: studentUid,
            student_name: studentData.fullName || studentData.name || 'Student',
            bus_id: busId,
            route_id: targetRouteId || 'unknown',
            stop_name: targetStopName || studentCorridor.nearestStopName || 'Roadside Pickup',
            status: 'raised',
            trip_id: tripId,
            shift: tripShift,
            created_at: new Date(currentTimestamp).toISOString(),
            expires_at: flagExpiresAt,
            message: message || null,
            stop_lat: studentLat,
            stop_lng: studentLng,
        };

        const { data: insertData, error: insertError } = await supabase
            .from('waiting_flags')
            .insert(flagData)
            .select('id, student_uid, student_name, bus_id, route_id, stop_name, stop_lat, stop_lng, status, trip_id, created_at, expires_at, message')
            .single();

        if (insertError) {
            if (insertError.code === '23505') {
                return NextResponse.json({ error: 'You already have an active waiting flag for this bus' }, { status: 409 });
            }
            return NextResponse.json({ error: 'Failed to create waiting flag' }, { status: 500 });
        }

        // Increment student trip flag count ONLY after successful insertion (Invariant: Anti-Spam Cooldown)
        await incrementStudentTripFlagCount(tripId, studentUid);

        await setRedisActiveFlag(busId, {
            flagId: insertData.id,
            studentUid,
            studentName: insertData.student_name,
            stopName: insertData.stop_name,
            lat: studentLat,
            lng: studentLng,
            routeProgressMeters: studentCorridor.routeProgressMeters,
            ackSent: false,
            busId,
            routeId: insertData.route_id,
            tripId,
            shift: tripShift,
            createdAt: currentTimestamp,
        });

        const broadcastPayload = {
            ...insertData,
            lat: studentLat,
            lng: studentLng,
            stop_lat: studentLat,
            stop_lng: studentLng,
            routeProgressMeters: studentCorridor.routeProgressMeters,
        };
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_created', broadcastPayload).catch(err => {
            console.warn('Broadcast failed (non-critical):', err);
        });
        emitEvent(`student_${studentUid}`, 'waiting_flag_created', broadcastPayload).catch(err => {
            console.warn('Student broadcast failed (non-critical):', err);
        });
        invalidateBusTripSnapshot(busId);

        return NextResponse.json({
            success: true,
            flagId: insertData.id,
            flag: broadcastPayload
        });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagPostSchema,
        rateLimit: RateLimits.WAITING_FLAG,
        allowBodyToken: true
    }
);
```

---

#### 9.5.2 `src/domains/gps/services/stop-dwell.service.ts` (Proximity Auto-Ack & Pass-By Auto-Cleanup)
```typescript
// Lines 284 - 416 of src/domains/gps/services/stop-dwell.service.ts
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
    const isHydrated = await isRedisFlagsHydrated(busId);
    if (!isHydrated) {
      await setRedisFlagsHydrated(busId);
      try {
        const supabase = getSupabaseServer();
        const { data: dbFlags } = await supabase
          .from('waiting_flags')
          .select('id, student_uid, student_name, stop_name, lat, lng, stop_lat, stop_lng, route_progress_meters, ack_sent, shift, bus_id, route_id, trip_id, created_at')
          .eq('bus_id', busId)
          .in('status', ['waiting', 'raised', 'acknowledged']);

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

    const flagsMap = await getRedisActiveFlags(busId);
    const flags = Object.values(flagsMap);
    if (!flags || flags.length === 0) return;

    const busCorridor = projectPointToRouteCorridor({ lat, lng }, routeId);
    const busProgress = busCorridor.routeProgressMeters;

    for (const flag of flags) {
      const isReverse = isReverseRouteDirection(flag.shift || shift);
      const signedAheadMeters = isReverse
        ? busProgress - flag.routeProgressMeters
        : flag.routeProgressMeters - busProgress;

      // 1. Hands-Free Proximity Auto-Acknowledge (<= 600m upstream):
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
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_acknowledged', ackPayload).catch(() => {});
        emitEvent(`student_${flag.studentUid}`, 'waiting_flag_acknowledged', ackPayload).catch(() => {});
        appLogger.info('gps', 'waiting_flag_auto_acknowledged', {
          busId,
          flagId: flag.flagId,
          distanceMeters: Math.round(signedAheadMeters),
        });
      }

      // 2. Hands-Free Pass-By Auto-Cleanup (> 200m past flag):
      if (signedAheadMeters < -200) {
        await removeRedisActiveFlag(busId, flag.flagId);
        invalidateBusTripSnapshot(busId);
        const removePayload = {
          flagId: flag.flagId,
          studentUid: flag.studentUid,
          busId,
          reason: 'bus_passed',
        };
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_removed', removePayload).catch(() => {});
        emitEvent(`student_${flag.studentUid}`, 'waiting_flag_removed', removePayload).catch(() => {});

        try {
          const supabase = getSupabaseServer();
          Promise.resolve(
            supabase
              .from('waiting_flags')
              .update({ status: 'expired' })
              .eq('id', flag.flagId)
          ).catch((err: any) => {
            appLogger.warn('gps', 'waiting_flag_pass_cleanup_failed', { flagId: flag.flagId, error: err?.message });
          });
        } catch {}

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
```

---

#### 9.5.3 `src/app/api/driver/ack-flag/route.ts`
```typescript
// Lines 22 - 97 of src/app/api/driver/ack-flag/route.ts
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { flagId } = body as any;
    const driverUid = auth.uid;
    const supabase = getSupabaseServer();

    const { data: flagData, error: flagError } = await supabase
      .from('waiting_flags').select('id, bus_id, status, student_uid, created_at, expires_at').eq('id', flagId).single();

    if (flagError || !flagData) {
      return NextResponse.json({ error: 'Waiting flag not found' }, { status: 404 });
    }

    const { data: activeTrip } = await supabase
      .from('active_trips')
      .select('trip_id')
      .eq('driver_id', driverUid)
      .in('bus_id', getBusIdVariations(flagData.bus_id))
      .eq('status', 'active')
      .maybeSingle();

    if (!activeTrip) {
      console.error('Driver assignment validation failed:', { driverUid, busId: flagData.bus_id });
      return NextResponse.json(
        { error: 'Driver is not assigned to this bus' },
        { status: 403 }
      );
    }

    // Check current flag status for idempotency and state guards
    if (flagData.status === 'acknowledged') {
      return NextResponse.json({
        success: true,
        message: 'Flag already acknowledged',
        data: { flagId, studentUid: flagData.student_uid, ackByDriverUid: driverUid }
      });
    }
    if (['boarded', 'picked_up', 'cancelled', 'expired'].includes(flagData.status)) {
      return NextResponse.json({ error: `Cannot acknowledge flag that is already ${flagData.status}` }, { status: 400 });
    }
    if (isWaitingFlagExpired(flagData)) {
      return NextResponse.json({ error: 'Cannot acknowledge flag that has expired' }, { status: 400 });
    }

    // Update waiting flag status atomically
    const { data: updatedData, error: updateError } = await supabase
      .from('waiting_flags')
      .update({
        status: 'acknowledged',
        ack_sent: true,
        ack_by_driver_uid: driverUid
      })
      .eq('id', flagId)
      .in('status', ['raised', 'waiting'])
      .select('id');

    if (updateError) {
      console.error('Error acknowledging flag:', updateError);
      return NextResponse.json(
        { error: 'Failed to acknowledge flag' },
        { status: 500 }
      );
    }

    if (!updatedData || updatedData.length === 0) {
      return NextResponse.json(
        { success: true, message: 'Flag already processed or acknowledged', data: { flagId, studentUid: flagData.student_uid, ackByDriverUid: driverUid } }
      );
    }

    // Synchronize Redis active waiting flags and bus snapshot cache (Invariant: Redis State Sync)
    await updateRedisActiveFlag(flagData.bus_id, flagId, { ackSent: true }).catch(() => {});
    invalidateBusTripSnapshot(flagData.bus_id);

    // Broadcast via WebSocket
    try {
      const ts = new Date().toISOString();
      await Promise.allSettled([
        emitEvent(`waiting_flags_${flagData.bus_id}`, 'waiting_flag_acknowledged', { flagId, studentUid: flagData.student_uid, status: 'acknowledged', driverUid }),
        emitEvent(`student_${flagData.student_uid}`, 'flag_acknowledged', { flagId, busId: flagData.bus_id, ackByDriverUid: driverUid, timestamp: ts, message: 'Driver has acknowledged your waiting flag!' }),
      ]);
    } catch (broadcastError) {
      console.error('Broadcast error (non-critical):', broadcastError);
    }

    console.log('✅ Flag acknowledged - student will see in-app toast via broadcast');

    return NextResponse.json({
      success: true,
      message: 'Flag acknowledged successfully',
      data: {
        flagId,
        studentUid: flagData.student_uid,
        ackByDriverUid: driverUid
      }
    });
  },
  {
    requiredRoles: ['driver'],
    schema: MarkBoardedSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true
  }
);
```

---

