# Trip Lifecycle — System Architecture & End-to-End Data Flow

## 1. High-Level System Architecture

The ITMS (Intelligent Transport Management System) Trip domain orchestrates real-time bus tracking, driver operations, student boarding, and student-driver interactions across Assam Down Town University (AdtU) bus routes.

The platform is designed as a distributed, dual-path architecture combining durable PostgreSQL state machines with sub-50ms WebSocket/Redis fan-out.

```
+----------------------------------------------------------------------------------------------------+
|                                      SYSTEM TOPOLOGY & DATA FLOW                                    |
+----------------------------------------------------------------------------------------------------+

   [ Driver Mobile Web App ]                                [ Student Mobile/Desktop Web App ]
       │                                                           ▲                   ▲
       │ 1. HTTP Ingress API                                       │ 4. MapLibre GL    │ 5. Notifications
       │    (GPS Bounds, Speed, Jump, Lua Guard)                   │    Target Update  │    (Flags & Alerts)
       ▼                                                           │                   │
+───────────────────────────────────+                              │                   │
|        NGINX Reverse Proxy        |                              │                   │
|   - SSL/TLS Termination           |                              │                   │
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
           │ 2. Validated Coordinates                              │                   │
           │    & Trip Lifecycle Events                            │                   │
           ▼                                                       │                   │
+─────────────────────+     Cross-Node Relay        +─────────────────────+            │
| Redis 7.2 Broker    |────────────────────────────►| WebSocket Cluster   |────────────┘
| - Pub/Sub Bus       |     (ws:broadcast)          | (ws1:3001, ws2:3001)|
| - Distributed Lua   |                             | Sub-50ms Fan-out    |
| - GPS Monotonicity  |                             +─────────────────────+
+──────────┬──────────+
           │
           │ 3. Throttled Heartbeats & Persistence
           ▼
+─────────────────────+
| Supabase PostgreSQL |
| - active_trips      |
| - bus_locations     |
| - waiting_flags     |
+─────────────────────+
```

---

## 2. Actors & System Roles

| Actor / Component | Core Responsibility | Auth Mechanism | Primary Protocol |
| :--- | :--- | :--- | :--- |
| **Driver** | Initiates trips, streams GPS telemetry via authoritative HTTP ingress, acks student waiting flags, terminates trips. | Firebase Auth (Bearer ID Token) with `role: "driver"`. Verified via Supabase `driver_profiles`. | HTTPS POST & WSS (notifications) |
| **Student** | Subscribes to bus routes, views real-time bus motion, raises waiting flags, verifies boarding passes. | Firebase Auth (Bearer ID Token) with `role: "student"`. Verified via Supabase `student_profiles`. | HTTPS GET & WSS (stream subscriber) |
| **Next.js Engine** | Authoritative API gateway, handles trip state transitions, validates GPS pipeline, executes PostgreSQL RPCs. | Service Role to Supabase; verifies client Firebase JWTs via Admin SDK. | Internal IPC / SQL |
| **WebSocket Cluster** | High-concurrency push server (`server/websocket-server.ts`). Handles client sessions, heartbeats, channel routing. | Authenticates client JWT on connection handshake (`{ type: "auth", token }`). | RFC 6455 WebSockets |
| **Redis Broker** | Inter-node message bus. Relays broadcasts between `ws1` and `ws2` using node-origin deduplication, metric sync, and distributed Lua guards. | Authenticated via Redis connection string (`REDIS_URL`). | TCP / RESP |
| **PostgreSQL Database** | Single source of truth for persistent state (trips, buses, driver assignments, route coordinates, waiting flags). | PostgreSQL connection pooling via Supabase client. | TCP / SQL |
| **Admin / Moderator** | Fleet observability only. Monitors live bus locations across routes on the fleet radar map (`/admin/fleet-map`, `/moderator/fleet-map`). Has ZERO operational involvement in starting/stopping trips or interacting with student waiting flags. | Firebase Auth (`role: "admin"` / `"moderator"`). | HTTPS GET & WSS (location subscriber only) |

---

## 3. End-to-End Trip Lifecycle Sequences

### Phase A: Trip Initiation & Distributed Lock Acquisition

A bus can have at most **one** active trip, and a driver can drive at most **one** bus at a time.

```
Driver App                 Next.js API Gateway           Supabase PostgreSQL           Redis Broker
    │                              │                              │                         │
    ├── POST /api/trip/initiate ──►│                              │                         │
    │   { busId, shift, routeId }  │                              │                         │
    │   [Bearer Driver JWT]        ├── Preflight Validation ─────►│                         │
    │                              │   (buses & active_trips)     │                         │
    │                              │                              │                         │
    │                              ├── RPC acquire_trip_lock ────►│                         │
    │                              │   (Row lock on buses,        │ (active_trips created,  │
    │                              │    active_trips upsert)      │  status = 'active',     │
    │                              │◄── Return tripId ────────────┤  expires_at = now+600s) │
    │                              │                              │                         │
    │                              ├── Invalidate Trip Caches ────┤                         │
    │                              │                              │                         │
    │                              ├── broadcastTripEvent ─────────────────────────────────►│
    │                              │   event: 'trip_started'      │                         │ (Fan-out to
    │                              │                              │                         │  channel 'ws:broadcast')
    │◄── 200 OK { tripId } ────────┤                              │                         │
    │                              │                              │                         │
    ├── Connect & Auth WS ────────────────────────────────────────┼────────────────────────►│
    │   { type: 'presence', busId }                               │                         │
```

#### Verification & Boundary Matrix:
1. **Who authenticates?** Next.js API verifies the driver's Firebase JWT (`auth.uid`).
2. **Who validates?** `src/domains/trip/services/trip-validation.service.ts` validates that the bus exists and is assigned to the driver.
3. **Who locks?** PostgreSQL RPC `acquire_trip_lock` executes a single-statement transaction with `FOR UPDATE` semantics on the bus record.
4. **Idempotency**: If the same driver requests initiation for an active trip, the existing `tripId` is returned without error.

---

### Phase B: Authoritative GPS Telemetry Ingestion & Real-Time Fan-Out

GPS telemetry operates across an authoritative ingress and real-time distribution architecture:
- **Authoritative Ingress (HTTP POST)**: Validates coordinates against road bounds, checks speed (<200 km/h), horizontal accuracy (<150m), jump detection (<5000m), enforces single-device exclusivity, and validates monotonic ordering via an atomic Redis Lua script (`gps_guard.lua`).
- **Real-Time Distribution (Redis PubSub -> WebSocket)**: The API gateway immediately dispatches accepted coordinates to Redis channel `ws:broadcast`, fanning out to `ws1` and `ws2` for sub-50ms push to connected student map clients.
- **Durable Persistence (PostgreSQL)**: Throttled heartbeats extend `active_trips.expires_at` (every 20s), and fallback breadcrumb coordinates are upserted into `bus_locations` (every 30s).
- **Direct WS Ingress Deprecation**: Unauthenticated or bypass WebSocket `location_update` packets are ignored by the WebSocket server to prevent bypassing server-side security checks.

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

Students subscribe to their assigned bus channel (`bus_location_{busId}`) upon opening the tracking interface (`/student/track-bus`).

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
        │                                     ├── Set Marker Coordinates ───────────►│ Smooth animation frame
        │                                     │   (window.__itmsMarkerPosition)      │ coordinate interpolation
```

#### The Client Guard Rules (`location-packet-guard.ts`):
- **Tombstoned Trips**: If a trip has ended (`endedTripId === packet.tripId`), all subsequent packets are permanently rejected.
- **Clock Skew Tolerance**: Packets older than 5,000ms relative to `lastTimestampMs` are discarded as stale out-of-order data.
- **Cross-Trip Auto-Adoption**: If a packet with a new `tripId` arrives, the client automatically resets tombstone tracking and transitions to the new trip.

---

### Phase D: Waiting Flags (Student-Driver Interaction)

Students waiting at assigned stops can signal the approaching driver by raising a waiting flag.
- **Global Single Active Flag Invariant**: A student can have at most **one** active waiting flag across the entire university system at any given time. This invariant is enforced both at the application service level and at the database engine level via a unique partial index:
  ```sql
  CREATE UNIQUE INDEX idx_waiting_flags_one_active_student
  ON public.waiting_flags (student_uid)
  WHERE (status IN ('raised', 'acknowledged', 'waiting'));
  ```
- **Lifecycle Transitions**:
  - `raised`: Student creates flag -> driver notified via WebSocket.
  - `acknowledged`: Approaching driver acknowledges flag -> student notified.
  - `boarded`: Student verifies boarding -> flag resolved.
  - `cancelled` / `removed`: Student cancels or trip completes -> flag purged.

```
Student App                    Next.js API Gateway             PostgreSQL DB              Driver App (WS)
     │                                  │                            │                          │
     ├── POST /api/waiting-flag/create ►│                            │                          │
     │   { busId, stopName, lat, lng }  ├── Verify Active Trip ─────►│                          │
     │                                  ├── Enforce Single Flag ────►│ (Unique index check)     │
     │                                  ├── Insert waiting_flags ───►│                          │
     │                                  │   (status = 'raised')      │                          │
     │                                  │                            │                          │
     │                                  ├── emitEvent ───────────────┼─────────────────────────►│
     │                                  │   channel: waiting_flags   │                          │ Toast Alert:
     │◄── 200 OK { flagId } ────────────┤                            │                          │ "Student waiting at Garchuk"
     │                                  │                            │                          │
     │                                  │◄── POST /api/driver/ack ───┼──────────────────────────┤
     │                                  │    { flagId, busId }       │                          │ Driver taps "Acknowledge"
     │                                  ├── Verify Driver Ownership ─┤                          │
     │                                  ├── Update status = 'acked' ─►│                          │
     │◄── WS: waiting_flag_acked ───────┴────────────────────────────┴──────────────────────────┤
```

---

### Phase E: Trip Termination & Resource Reclamation

Ending a trip requires atomic execution across database tables, in-memory caches, and pub/sub channels to ensure no ghost pins or orphaned state remain.

```
Driver App                 Next.js API Gateway           Supabase PostgreSQL           Redis / WS Cluster
    │                              │                              │                         │
    ├── POST /api/trip/end ───────►│                              │                         │
    │   { busId, tripId }          ├── Verify Driver Assignment ─►│                         │
    │                              │                              │                         │
    │                              ├── RPC end_trip_atomically ──►│ (active_trips -> ended, │
    │                              │   (Row lock & state update)  │  release locks)         │
    │                              │                              │                         │
    │                              ├── Delete bus_locations ─────►│ (Remove marker rows)    │
    │                              │                              │                         │
    │                              ├── Purge Active Flags by Bus ─►│ (Purge all active flags │
    │                              │                              │  on bus_id unconditionally│
    │                              ├── clearInMemoryLastLocation ─┼────────────────────────►│ Purge local memory map
    │                              │                              │                         │
    │                              ├── broadcastTripEvent ─────────────────────────────────►│ Redis 'trip_ended'
    │                              │   event: 'trip_ended'        │                         │ (All student UI markers
    │◄── 200 OK { success: true } ─┤                              │                         │  clear instantly)
```

---

## 4. State Ownership & Source-of-Truth Matrix

| State Entity | Authoritative Source | Cache / Transient Mirror | Eviction / Invalidation Trigger |
| :--- | :--- | :--- | :--- |
| **Active Trip Registration** | PostgreSQL table `active_trips` | Redis key `trip:{busId}` & Next.js memory cache | `end_trip_atomically` RPC or lock expiry (`expires_at < now`). |
| **Live Bus Position** | Authoritative HTTP Ingress (`/api/location/update`) | Redis Pub/Sub (`ws:broadcast`), WS in-memory map, and PostgreSQL `bus_locations` (30s fallback) | Trip completion deletes `bus_locations` rows, clears in-memory map, and broadcasts `trip_ended`. |
| **Driver Lock Ownership** | PostgreSQL table `active_trips` (`driver_id`, `bus_id`) | In-memory `activeTripCache` | `invalidateActiveTripCache()` on start/end. |
| **Waiting Flags** | PostgreSQL table `waiting_flags` (single active flag invariant: `idx_waiting_flags_one_active_student`) | Channel `waiting_flags_{busId}` & `student_{uid}` | Purged unconditionally on `bus_id` upon trip end and broadcasted as `waiting_flag_removed`. |
| **Student UI Render State** | Local MapLibre GL Target (`__itmsMarkerPosition`) | React Hook `useBusLocation` | Cleared immediately upon receiving `trip_ended` event. |

---

## 5. Security & Isolation Boundaries

### 1. Cross-Bus Isolation
- **Driver Boundaries**: A driver token is bound to `bus_id` in `active_trips`. If Driver A attempts to submit coordinates or acknowledge a flag for Bus B, the API rejects the request with HTTP 403 (`ownership_denied`).
- **Student Boundaries**: The student frontend tracking route queries `/api/student/trip-status`. The server retrieves the student's assigned bus and returns data **only** for that bus.

### 2. Cross-Node Synchronization
- In a multi-node environment (`ws1` and `ws2`), a driver connected to `ws1` broadcasts coordinates that are relayed across Redis to `ws2`.
- Each envelope carries `originNodeId`. Nodes ignore their own broadcasts to prevent echo storms.

### 3. Graceful Failure & Offline Behavior
- **Redis Outage**: If Redis crashes, WebSocket nodes degrade gracefully to in-process broadcasts (students on the same node continue receiving updates).
- **Socket Disconnection**: If a driver or student disconnects mid-trip, client reconnect logic uses exponential backoff and restores channel subscriptions via `reconnect_token`.

### 4. Real-Time Transport & Adaptive Fallback Resilience

Earlier, client tracking and server-side event bridges were bound to static loopback addresses (`localhost:3001` and `127.0.0.1`), and the student UI discarded incoming HTTP polling snapshots (`if (prev) return prev;`) once an initial location was loaded.

After the new patch, centralized endpoint resolution (`getClientWsUrl()` and `getServerWsUrl()`), first-frame wire authentication, and adaptive monotonic HTTP recovery fallback were ensured. This means:
- **Dynamic Multi-Device Connectivity**: Client mobile browsers automatically resolve the host LAN IP when testing on physical devices, and auto-upgrade to `wss://` in HTTPS production environments.
- **Credential Protection**: The Next.js API server connects to dedicated WebSocket nodes without URL tokens, performing wire authentication over the encrypted socket.
- **Adaptive Fallback**: Student tracking relaxes HTTP polling to 25s when the WebSocket connection is healthy and accelerates to 5s during disconnections, updating the marker monotonically (`newTs > prevTs`) so location updates never freeze or jump backward.

