# Trip Lifecycle — System Architecture & End-to-End Data Flow

## 1. High-Level System Architecture

The ITMS (Intelligent Transport Management System) Trip domain orchestrates real-time bus tracking, driver operations, student boarding verification, and student-driver interactions across Assam Down Town University (AdtU) bus routes.

The platform is engineered as a distributed, dual-path architecture combining durable PostgreSQL state machines with sub-50ms WebSocket/Redis fan-out.

```
+----------------------------------------------------------------------------------------------------+
|                                      SYSTEM TOPOLOGY & DATA FLOW                                    |
+----------------------------------------------------------------------------------------------------+

   [ Driver Mobile Web App ]                                [ Student Mobile/Desktop Web App ]
       │                                                           ▲                   ▲
       │ 1. HTTP Ingress API                                       │ 4. MapLibre GL    │ 5. Notifications
       │    (GPS Bounds, Speed, Jump, Lua Guard)                   │    Target Update  │    (Flags & Alerts)
       │    POST /api/location/update                              │    WSS Channel    │    WSS Channel
       ▼                                                           │                   │
+───────────────────────────────────+                              │                   │
|        NGINX Reverse Proxy        |                              │                   │
|   - SSL/TLS Termination (443)     |                              │                   │
|   - /ws -> ws_backend (ip_hash)   |                              │                   │
|   - /api -> nextjs_backend        |                              │                   │
+─────────────────┬─────────────────+                              │                   │
                  │                                                │                   │
                  ▼                                                │                   │
+───────────────────────────────────+                              │                   │
|  Next.js API Engine               |                              │                   │
|  (Authoritative Ingress & State)  |                              │                   │
+──────────┬────────────────────────+                              │                   │
           │                                                       │                   │
           │ 2. Validated Coordinates & Events                     │                   │
           │    (emitEvent -> WebSocketTransport)                  │                   │
           ▼                                                       │                   │
+─────────────────────+     Cross-Node Relay        +─────────────────────+            │
| Redis 7.2 Broker    |────────────────────────────►| WebSocket Cluster   |────────────┘
| - Pub/Sub Bus       |     (ws:broadcast)          | (ws1:3001, ws2:3001)|
| - Distributed Lua   |                             | Sub-50ms Fan-out    |
| - Monotonic Guard   |                             +─────────────────────+
+──────────┬──────────+
           │
           │ 3. Throttled Heartbeats & Persistence
           ▼
+─────────────────────────────────────────────────────────────+
| Supabase PostgreSQL                                         |
| - active_trips      (Status CHECK = 'active', 3-way UNIQUE) |
| - bus_locations     (Single-row fallback per bus)           |
| - waiting_flags     (Unique partial index per student)      |
| - driver_trip_history (Archived audit logs >= 10 min)       |
+─────────────────────────────────────────────────────────────+
```

---

## 2. Actors & System Roles

| Actor / Component | Core Responsibility | Auth Mechanism | Primary Protocol | Codebase Reference |
| :--- | :--- | :--- | :--- | :--- |
| **Driver** | Initiates trips, streams GPS telemetry via authoritative HTTP ingress, acknowledges student waiting flags, marks students boarded, terminates trips. | Firebase Auth (Bearer ID Token) with `role: "driver"`. Verified via Supabase `driver_profiles` and active trip lock in `active_trips`. | HTTPS POST & WSS (notifications & presence) | [`src/app/driver/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/driver), [`src/app/api/driver/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver) |
| **Student** | Subscribes to assigned bus telemetry, views real-time vehicle movement, raises stop waiting flags, verifies boarding pass. | Firebase Auth (Bearer ID Token) with `role: "student"`. Verified via Supabase `student_profiles` + `requireTransportEntitlement`. | HTTPS GET & WSS (stream subscriber) | [`src/app/student/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/student), [`src/hooks/useBusLocation.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/hooks/useBusLocation.ts) |
| **Next.js Engine** | Authoritative API gateway, handles trip state transitions, validates GPS pipeline, executes PostgreSQL RPCs (`acquire_trip_lock`, `end_trip_atomically`). | Service Role key (`SUPABASE_SERVICE_ROLE_KEY`) to Supabase; verifies client Firebase JWTs via Firebase Admin SDK. | Internal IPC / HTTP / SQL | [`src/domains/trip/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/trip), [`src/domains/gps/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps) |
| **WebSocket Cluster** | High-concurrency push server (`server/websocket-server.ts`). Handles client sessions, heartbeats, channel routing, rate limiting, and dual-lane queuing. | First-message wire auth (`{ type: "auth", token }`). Tokens in URL queries are rejected in production. | RFC 6455 WebSockets | [`server/websocket-server.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/websocket-server.ts), [`server/socket-router.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/socket-router.ts) |
| **Redis Broker** | Inter-node broadcast bus (`ws:broadcast`), atomic Lua GPS guard (`gps_guard.lua`), and cross-node session invalidation (`role_invalidate`). | Authenticated via Redis URL (`REDIS_URL`). | TCP / RESP | [`server/redis-broadcast.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/redis-broadcast.ts), [`src/domains/gps/services/gps-redis-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/services/gps-redis-guard.ts) |
| **PostgreSQL Database** | Single source of truth for persistent state (`active_trips`, `buses`, `driver_trip_history`, `waiting_flags`, `bus_locations`). | PostgreSQL connection pooling via Supabase client. | TCP / SQL | [`supabase/COMPLETE_SCHEMA.sql`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql) |
| **Admin / Moderator** | Fleet observability only (`/admin/fleet-map`, `/moderator/fleet-map`). Subscribes strictly to live vehicle coordinates (`bus_location_*`, `fleet_locations`). **Strictly forbidden** from `waiting_flags_*` and `driver_wait_request_*`. | Firebase Auth (`role: "admin"` / `"moderator"`). | HTTPS GET & WSS (location subscriber only) | [`src/app/admin/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/admin), [`server/socket-router.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/socket-router.ts) |

---

## 3. End-to-End Trip Lifecycle Sequences

### Phase A: Preflight, QR Resolution & Atomic Lock Acquisition

A bus can have at most **one** active trip, and a driver can drive at most **one** bus at a time. This invariant is enforced by PostgreSQL table-level UNIQUE constraints on `active_trips(bus_id)` and `active_trips(driver_id)` and verified via atomic RPC `acquire_trip_lock`.

```
Driver App                 Next.js API Gateway           Supabase PostgreSQL           Redis / WS Cluster
    │                              │                              │                         │
    ├── POST /api/driver/initiate-trip                            │                         │
    │   { busId, shift: 'Morning' }│                              │                         │
    │   [Bearer Driver JWT]        ├── 1. tripStartPreflight ────►│                         │
    │                              │      (buses + active_trips)  │                         │
    │                              │                              │                         │
    │                              ├── 2. RPC acquire_trip_lock ─►│                         │
    │                              │   (Row lock on buses,        │ (active_trips inserted, │
    │                              │    active_trips insert)      │  status = 'active',     │
    │                              │◄── Return tripId ────────────┤  expires_at = now+600s) │
    │                              │                              │                         │
    │                              ├── 3. Invalidate Caches ──────┤                         │
    │                              │   (activeTrip, lastLocation) │                         │
    │                              │                              │                         │
    │                              ├── 4. broadcastTripEvent ──────────────────────────────►│
    │                              │   channel: trip-status-{busId}                         │ (Fan-out to
    │                              │   event: 'trip_started'                                │  channel 'ws:broadcast')
    │                              │                              │                         │
    │                              ├── 5. dispatchFcmBounded ─────► (Push to students)      │
    │◄── 200 OK { tripId, shift } ─┤                              │                         │
    │                              │                              │                         │
    ├── WSS Connect ───────────────────────────────────────────────────────────────────────►│
    │   1. Frame: { type: 'auth', token: '<Driver_JWT>' }                                   │
    │◄── Frame: { type: 'auth_ok', data: { reconnect_token } } ─────────────────────────────┤
    │   2. Frame: { type: 'presence', busId, tripId }                                       │
    │◄── Frame: { type: 'presence_ok' } ────────────────────────────────────────────────────┤
```

#### Code Implementation: Preflight & Start Sequence
In [`src/domains/trip/services/trip-orchestrator.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/trip/services/trip-orchestrator.ts):
```typescript
export async function startTrip(params: StartTripParams): Promise<StartTripOutput> {
  const normalized = normalizeShift(params.shift);
  if (!normalized) {
    return { success: false, reason: 'Invalid or missing trip shift parameters', errorCode: 'VALIDATION_ERROR' };
  }
  const tripShift = normalized.toLowerCase() as ShiftLower;

  // 1. Single preflight: queries buses + active_trips in parallel
  const preflight = await tripStartPreflight(params.driverId, params.busId);
  if (!preflight.authorized) {
    const errorCode = preflight.conflict ? 'LOCKED_BY_OTHER' : 'VALIDATION_ERROR';
    return { success: false, reason: preflight.reason, errorCode };
  }

  // Idempotency: if driver already owns active trip, return existing tripId
  if (preflight.existingTripId) {
    return { success: true, tripId: preflight.existingTripId, routeId: preflight.busData?.route_id || '', shift: tripShift };
  }

  const tripId = params.tripId || crypto.randomUUID();

  // 2. Atomic lock acquisition via PostgreSQL RPC
  const lockResult = await tripLockService.startTrip(params.driverId, params.busId, effectiveRouteId, tripShift, tripId);
  if (!lockResult.success) {
    return { success: false, reason: lockResult.reason, errorCode: lockResult.errorCode };
  }

  // 3. Invalidate caches so new trip begins with clean state
  invalidateActiveTripCache(params.busId, params.driverId);
  clearInMemoryLastLocation(params.busId);

  // 4. WebSocket broadcast on dedicated lifecycle channel 'trip-status-{busId}'
  if (!lockResult.alreadyActive) {
    broadcastTripEvent({
      busId: params.busId,
      tripId: activeTripId,
      event: 'trip_started',
      driverId: params.driverId,
      routeId: effectiveRouteId,
      shift: tripShift,
      busNumber,
    });

    // 5. Bounded FCM push (5s timeout ensures serverless runtimes don't freeze)
    await dispatchFcmBounded(
      dispatchTripNotification({
        routeId: effectiveRouteId,
        tripId: activeTripId,
        routeName,
        busId: params.busId,
        shift: tripShift,
        eventType: 'TRIP_STARTED',
      }),
      'trip start'
    );
  }

  return { success: true, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift };
}
```

---

### Phase B: Authoritative GPS Telemetry Ingestion & Real-Time Fan-Out

GPS telemetry operates across an authoritative ingress and real-time distribution architecture:
- **Authoritative Ingress (HTTP POST `/api/location/update` or `/api/driver/update-location`)**:
  - Validates driver role and single-device exclusivity (`device_sessions` check).
  - Validates physical bounds: Null island `(0,0)`, latitude `[-90, 90]`, longitude `[-180, 180]`, speed cap `< 200 km/h`, heading `[0, 360]`, accuracy `< 150m`.
  - Performs positive active trip verification directly against PostgreSQL `active_trips` (negative cache only, 2s TTL).
  - Executes atomic Redis Lua script (`gps_guard.lua` via `gps-redis-guard.ts`): raw clock replay check, 5000ms timestamp ordering tolerance, Haversine jump check (`< 5000m`), duplicate relocation check (`> 50m`), and calculated speed check (`< 200 km/h`).
  - **Fail-Closed Semantics**: In `production`, if Redis is unavailable, updates fail closed (`redis_unavailable`) to prevent multi-instance split-brain telemetry.
- **Real-Time Distribution (Redis PubSub -> WebSocket)**:
  - Dispatches coordinates to WebSocket channel `bus_location_{busId}` (event: `bus_location_update`).
  - Multiplexed over Redis channel `ws:broadcast` for sub-50ms push across all cluster nodes.
- **Durable Persistence (PostgreSQL Throttling)**:
  - Throttled heartbeats extend `active_trips.expires_at = now + 600s` (throttled to 1 write per bus per 20s).
  - Throttled fallback coordinates upserted into `bus_locations` (throttled to 1 write per bus per 30s).
- **Direct WS Ingress Deprecated**: Direct WebSocket `location_update` frames from clients are dropped (`gpsLegacyDropped` metric) to guarantee all telemetry passes through the authoritative HTTP pipeline.

```
 Driver App                    Next.js API Gateway             Redis Broker              WS Cluster (ws1/ws2)      PostgreSQL DB
     │                                 │                            │                             │                      │
     │── [HTTPS POST 1Hz] ────────────►│                            │                             │                      │
     │   /api/location/update          ├── 1. Device Exclusivity    │                             │                      │
     │   { busId, tripId, lat, lng }   ├── 2. GPS Pipeline Bounds   │                             │                      │
     │                                 │   (Bounds, Jump, Speed)    │                             │                      │
     │                                 │                            │                             │                      │
     │                                 ├── 3. Redis Lua Guard ─────►│                             │                      │
     │                                 │      (gps_guard.lua)       │                             │                      │
     │                                 │                            │                             │                      │
     │                                 ├── 4. emitEvent() ─────────►│                             │                      │
     │                                 │   channel: bus_location    │                             │                      │
     │                                 │                            ├── 5. Relay ws:broadcast ───►│                      │
     │                                 │                            │                             ├── 6. Push to Students│
     │                                 │                            │                             │      (Sub-50ms)      │
     │                                 ├── 7. Heartbeat Throttle ───┼─────────────────────────────┼─────────────────────►│ UPDATE active_trips
     │                                 │   (Every 20s)              │                             │                      │ expires_at = now+600s
     │                                 │                            │                             │                      │
     │                                 ├── 8. Location Throttle ────┼─────────────────────────────┼─────────────────────►│ UPSERT bus_locations
     │                                 │   (Every 30s)              │                             │                      │ (Fallback snapshot)
     │◄── 200 OK { success: true } ────┤                            │                             │                      │
```

---

### Phase C: Student Reception & Client Packet Guard

Students subscribe to two dedicated channels upon opening the tracking interface:
1. `bus_location_{busId}`: Live GPS telemetry snapshots and continuous updates.
2. `trip-status-{busId}`: Authoritative lifecycle events (`trip_started`, `trip_ended`).

```
WebSocket Cluster Node                 Student Browser                     MapLibre GL Map View
        │                                     │                                      │
        ├── Frame { lat, lng, timestamp } ───►│                                      │
        │                                     ├── decideLocationPacket()             │
        │                                     │   (Check tombstone, ordering, skew)  │
        │                                     │                                      │
        │                                     ├── Packet Accepted                    │
        │                                     │   (Update React State)               │
        │                                     │                                      │
        │                                     ├── Set Marker Coordinates ───────────►│ Smooth coordinate
        │                                     │   (window.__itmsMarkerPosition)      │ animation & bearing
```

#### Client Guard Invariants ([`src/domains/realtime/location-packet-guard.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/realtime/location-packet-guard.ts)):
1. **Permanent Tombstone for Ended Trips**:
   ```typescript
   if (state.endedTripId && packet.tripId && packet.tripId === state.endedTripId) {
     return rejected(state, 'ended-trip', incomingTsMs);
   }
   ```
2. **Cross-Trip Auto-Adoption**:
   When a new trip begins (`packet.tripId !== state.activeTripId`), the guard verifies the incoming packet is not older than 5,000ms before adopting the new trip and resetting tombstone tracking.
3. **Monotonic Timestamp Guard (5,000ms Skew Tolerance)**:
   ```typescript
   const SKEW_TOLERANCE_MS = 5000;
   if (incomingTsMs > 0 && decision.lastTimestampMs > 0 && incomingTsMs + SKEW_TOLERANCE_MS < decision.lastTimestampMs) {
     return rejected(state, 'stale-timestamp', incomingTsMs);
   }
   ```
4. **Adaptive HTTP Recovery Polling**:
   - In [`src/hooks/useBusLocation.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/hooks/useBusLocation.ts), when the app resumes (`visibilitychange` or `online`), it polls `/api/student/trip-status`.
   - The snapshot is applied **only if** `snapshotTs > lastTimestampRef.current`, preventing stale database breadcrumbs from regressing client known coordinates.

---

### Phase D: Waiting Flags (Student-Driver Interaction)

Students waiting at assigned stops can signal the approaching driver by raising a waiting flag:
- **Global Single Active Flag Invariant**:
  A student can have at most **one** active waiting flag across the entire university system at any given time. Enforced by PostgreSQL unique partial index:
  ```sql
  CREATE UNIQUE INDEX idx_waiting_flags_one_active_student
  ON public.waiting_flags (student_uid)
  WHERE (status IN ('raised', 'acknowledged', 'waiting'));
  ```
- **Lifecycle Transitions**:
  - `raised`: Student creates flag via `/api/waiting-flag/create` -> driver notified via WebSocket channel `waiting_flags_{busId}`.
  - `acknowledged`: Driver acknowledges flag via `/api/driver/ack-flag` -> student notified via private channel `student_{student_uid}`.
  - `boarded`: Driver confirms boarding via `/api/driver/mark-boarded` -> student notified.
  - `cancelled` / `removed`: Student cancels or trip completes -> flag deleted and purged.

```
Student App                    Next.js API Gateway             PostgreSQL DB              Driver App (WS)
     │                                  │                            │                          │
     ├── POST /api/waiting-flag/create ►│                            │                          │
     │   { busId, stop_name, lat, lng } ├── 1. requireEntitlement ──►│                          │
     │                                  ├── 2. Active Trip Check ───►│                          │
     │                                  ├── 3. Unique Index Check ──►│                          │
     │                                  ├── 4. Insert waiting_flags ─►│                          │
     │                                  │   (status = 'raised')      │                          │
     │                                  │                            │                          │
     │                                  ├── 5. emitEvent ────────────┼─────────────────────────►│
     │                                  │   channel: waiting_flags   │                          │ Toast Alert:
     │◄── 200 OK { flagId } ────────────┤                            │                          │ "Student waiting at Stop"
     │                                  │                            │                          │
     │                                  │◄── POST /api/driver/ack-flag ─────────────────────────┤
     │                                  │    { flagId }              │                          │ Driver taps "Acknowledge"
     │                                  ├── 6. Verify Trip Lock ────►│                          │
     │                                  ├── 7. Update 'acknowledged'►│                          │
     │◄── WS: flag_acknowledged ────────┴────────────────────────────┴──────────────────────────┤
```

---

### Phase E: Atomic Trip Termination & Post-Trip Cleanup

When a driver taps "End Trip" in the mobile interface, the system executes atomic lock release and cleanup:
- **Canonical Endpoints**:
  - `POST /api/driver/end-journey-v2` (Primary endpoint used by web and mobile)
  - `POST /api/driver/end-trip` (Deprecated compatibility route)
- **Atomic Termination RPC (`end_trip_atomically`)**:
  - Validates driver ownership.
  - Atomically **deletes** the row from `active_trips` and **deletes** the corresponding row from `bus_locations`.
  - **Accidental 10-Minute Trip Rule**: If the trip duration is strictly less than 10 minutes (`v_dur_sec < 600`), the trip is discarded from `driver_trip_history` (`shortTripDiscarded: true`). If >= 10 minutes, a completed audit record is inserted into `driver_trip_history` with `ON CONFLICT (trip_id) DO NOTHING`.
- **Post-Trip Cleanup Pipeline (`cleanupTrip`)**:
  - Unconditionally deletes all active waiting flags on that `bus_id` (`DELETE FROM waiting_flags WHERE bus_id = ... AND status IN ('raised', 'acknowledged', 'waiting')`).
  - Deletes driver device session (`DELETE FROM device_sessions WHERE user_id = ...`).
  - Emits `waiting_flag_removed` (`reason: 'trip_ended'`) to student private channels and bus channels.
  - Clears process-local in-memory GPS cache and Redis state (`clearGpsState`).
  - Broadcasts `trip_ended` on `trip-status-{busId}`.
  - Dispatches bounded FCM `TRIP_ENDED` notification.

```
Driver App                 Next.js API Gateway           Supabase PostgreSQL           Redis / WS Cluster
    │                              │                              │                         │
    ├── POST /api/driver/end-journey-v2                           │                         │
    │   { busId, tripId }          ├── 1. Verify Driver Ownership►│                         │
    │                              │                              │                         │
    │                              ├── 2. RPC end_trip_atomically►│ (DELETE active_trips,   │
    │                              │   (Duration check >= 10 min) │  DELETE bus_locations,  │
    │                              │                              │  INSERT trip_history)   │
    │                              │                              │                         │
    │                              ├── 3. cleanupTrip() ──────────►│ (Purge all active flags │
    │                              │   - Purge waiting_flags      │  on bus_id, purge       │
    │                              │   - Purge device_sessions    │  device sessions)       │
    │                              │                              │                         │
    │                              ├── 4. Clear GPS Caches ───────┼────────────────────────►│ clearInMemoryLastLocation
    │                              │                              │                         │ clearGpsState(busId)
    │                              │                              │                         │
    │                              ├── 5. broadcastTripEvent ──────────────────────────────►│ channel: trip-status-{busId}
    │                              │   event: 'trip_ended'        │                         │ (All student UI markers
    │◄── 200 OK { success: true } ─┤                              │                         │  clear instantly)
```

---

## 4. State Ownership & Source-of-Truth Matrix

| State Entity | Authoritative Source | Cache / Transient Mirror | Eviction / Invalidation Trigger |
| :--- | :--- | :--- | :--- |
| **Active Trip Registration** | PostgreSQL table `active_trips` (Unique bus_id, driver_id, trip_id; CHECK status = 'active') | Redis key `gps:last:{busId}` & Next.js negative cache (`negativeLockCache`) | `end_trip_atomically` RPC deletes row, or lock expiry (`expires_at < now`). |
| **Live Bus Position** | Authoritative HTTP Ingress (`/api/location/update`) | Redis Pub/Sub (`ws:broadcast`), WS in-memory map (`liveBusLocations`), and PostgreSQL `bus_locations` (30s fallback) | Trip completion deletes `bus_locations` rows, clears in-memory map, and broadcasts `trip_ended`. |
| **Driver Lock Ownership** | PostgreSQL table `active_trips` (`driver_id`, `bus_id`) | In-memory `activeTripCache` & `heartbeatWriteCache` | `invalidateActiveTripCache()` and `clearInMemoryLastLocation()` on start/end. |
| **Waiting Flags** | PostgreSQL table `waiting_flags` (enforced by `idx_waiting_flags_one_active_student`) | Channel `waiting_flags_{busId}` & `student_{uid}` | Purged unconditionally on `bus_id` upon trip end and broadcast as `waiting_flag_removed`. |
| **Student UI Render State** | Local MapLibre GL Target (`__itmsMarkerPosition`) | React Hook `useBusLocation` (`location-packet-guard.ts`) | Cleared immediately upon receiving `trip_ended` event or tombstone rejection. |

---

## 5. Security & Isolation Boundaries

### 1. Cross-Bus & Role Isolation
- **Driver Boundaries**: A driver token is bound to `bus_id` in `active_trips`. If Driver A attempts to submit coordinates or acknowledge a flag for Bus B, the API rejects the request with HTTP 403 (`ownership_denied`).
- **Student Boundaries**: The student frontend queries `/api/student/trip-status`. The server validates that the student holds active transport entitlement and is assigned to the requested bus (`studentBusId === busId`), rejecting unauthorized requests with HTTP 403.
- **Admin/Moderator Channel Isolation**: In [`server/socket-router.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/socket-router.ts), administrators and moderators are **strictly forbidden** from subscribing to student waiting flags (`waiting_flags_*`) or driver wait requests (`driver_wait_request_*`). They may only subscribe to vehicle GPS streams (`bus_location_*`, `fleet_locations`).

### 2. Cross-Node Synchronization
- In a multi-node deployment (`ws1` on 3001, `ws2` on 3003 behind NGINX `ip_hash`), a driver connected to `ws1` broadcasts coordinates that are relayed across Redis channel `ws:broadcast` to `ws2`.
- Each envelope carries `originNodeId: MY_NODE_ID`. Receiving nodes inspect this UUID and discard messages originating from themselves to prevent infinite reflection storms.

### 3. Graceful Failure & Offline Behavior
- **Redis Outage (Fail-Closed in Production)**: If Redis becomes unreachable in production, `gps-redis-guard.ts` rejects incoming GPS updates (`redis_unavailable`) to protect multi-instance spatial safety. In development, it gracefully falls back to local process memory.
- **Socket Disconnection**: If a student or driver disconnects mid-trip, client reconnect logic uses exponential backoff and restores channel subscriptions via `reconnect_token`.
- **Adaptive Fallback**: Student tracking relaxes HTTP polling to 25s when the WebSocket connection is healthy and accelerates to 5s during disconnections, updating the marker monotonically (`newTs > prevTs`) so location updates never freeze or jump backward.
