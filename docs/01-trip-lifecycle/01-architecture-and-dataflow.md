# Trip Lifecycle — System Architecture & End-to-End Data Flow

## 1. High-Level System Architecture

The ITMS (Intelligent Transport Management System) Trip domain orchestrates real-time bus tracking, driver operations, student boarding, and student-driver interactions across Assam Down Town University (AdtU) bus routes.

The platform is designed as a distributed, dual-path architecture combining durable PostgreSQL state machines with sub-50ms WebSocket/Redis fan-out.

```
+----------------------------------------------------------------------------------------------------+
|                                      SYSTEM TOPOLOGY & DATA FLOW                                    |
+----------------------------------------------------------------------------------------------------+

   [ Driver Mobile Web App ]                                [ Student Mobile/Desktop Web App ]
       │              │                                            ▲                   ▲
       │ 1. HTTP API  │ 2. WS Live Telemetry                       │ 4. MapLibre GL    │ 5. Notifications
       ▼              ▼                                            │    Target Update  │    (Flags & Alerts)
+───────────────────────────────────+                              │                   │
|        NGINX Reverse Proxy        |                              │                   │
|   - SSL/TLS Termination           |                              │                   │
|   - /ws -> ws_backend (ip_hash)   |                              │                   │
|   - /api -> nextjs_backend        |                              │                   │
+─────────────────┬─────────────────+                              │                   │
                  │                                                │                   │
         ┌────────┴────────────────────────┐                       │                   │
         ▼                                 ▼                       │                   │
+─────────────────────+         +─────────────────────+            │                   │
|  Next.js API Engine |         | WebSocket Cluster   |────────────┴───────────────────┘
|  (Stateless Node)   |         | (ws1:3001, ws2:3001)|
+──────────┬──────────+         +──────────┬──────────+
           │                               │
           │ 3. Database Transactions      │ 6. Cross-Node Relay
           │    & Distributed Locks        │    (ws:broadcast)
           ▼                               ▼
+─────────────────────+         +─────────────────────+
| Supabase PostgreSQL |         | Redis 7.2 Broker    |
| - active_trips      |         | - Pub/Sub bus       |
| - bus_locations     |         | - Node dedup        |
| - waiting_flags     |         | - Transient cache   |
+─────────────────────+         +─────────────────────+
```

---

## 2. Actors & System Roles

| Actor / Component | Core Responsibility | Auth Mechanism | Primary Protocol |
| :--- | :--- | :--- | :--- |
| **Driver** | Initiates trips, streams GPS telemetry (dual-path), acks student waiting flags, terminates trips. | Firebase Auth (Bearer ID Token) with `role: "driver"`. Verified via Supabase `driver_profiles`. | HTTPS POST & WSS |
| **Student** | Subscribes to bus routes, views real-time bus motion, raises waiting flags, verifies boarding passes. | Firebase Auth (Bearer ID Token) with `role: "student"`. Verified via Supabase `student_profiles`. | HTTPS GET & WSS |
| **Next.js Engine** | Authoritative API gateway, handles trip state transitions, validates GPS pipeline, executes PostgreSQL RPCs. | Service Role to Supabase; verifies client Firebase JWTs via Admin SDK. | Internal IPC / SQL |
| **WebSocket Cluster** | High-concurrency push server (`server/websocket-server.ts`). Handles client sessions, heartbeats, channel routing. | Authenticates client JWT on connection handshake (`{ type: "auth", token }`). | RFC 6455 WebSockets |
| **Redis Broker** | Inter-node message bus. Relays broadcasts between `ws1` and `ws2` using node-origin deduplication. | Authenticated via Redis connection string (`REDIS_URL`). | TCP / RESP |
| **PostgreSQL Database** | Single source of truth for persistent state (trips, buses, driver assignments, route coordinates, waiting flags). | PostgreSQL connection pooling via Supabase client. | TCP / SQL |

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

### Phase B: Dual-Path GPS Telemetry Ingestion

GPS telemetry operates across two synchronized paths:
- **Fast Realtime Path (WSS)**: Directly pushes low-latency coordinates (<50ms) to connected students.
- **Authoritative Durable Path (HTTP)**: Validates coordinates against road bounds, checks speed/jumps, extends database locks, and throttles DB breadcrumbs.

```
 Driver App                    WebSocket Node                 Next.js API Gateway        PostgreSQL / Redis
     │                               │                                 │                         │
     │── [Path A: WSS 1Hz] ─────────►│                                 │                         │
     │   { type: 'location_update',  ├── Broadcast to Local Clients ───┼────────────────────────►│
     │     busId, lat, lng }         └── Relay to Redis ───────────────┼────────────────────────►│ Redis ws:broadcast
     │                                                                 │                         │
     │── [Path B: HTTPS POST 1Hz] ────────────────────────────────────►│                         │
     │   /api/location/update                                          ├── GPS Pipeline Check    │
     │   { busId, tripId, lat, lng }                                   │   (Bounds, Jump, Speed) │
     │                                                                 │                         │
     │                                                                 ├── Heartbeat Throttle ──►│ UPDATE active_trips
     │                                                                 │   (Every 20s)           │ expires_at = now+600s
     │                                                                 │                         │
     │                                                                 ├── DB Location Throttle ─►│ UPSERT bus_locations
     │                                                                 │   (Every 30s)           │ (Fallback snapshot)
     │◄── 200 OK { success: true } ────────────────────────────────────┤                         │
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

```
Student App                    Next.js API Gateway             PostgreSQL DB              Driver App (WS)
     │                                  │                            │                          │
     ├── POST /api/waiting-flag/create ►│                            │                          │
     │   { busId, stopName, lat, lng }  ├── Verify Active Trip ─────►│                          │
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
    │                              ├── Delete active flags ──────►│ (Cancel pending flags)  │
    │                              │                              │                         │
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
| **Live Bus Position** | WebSocket Stream (Transient Event) | PostgreSQL table `bus_locations` (30s throttled fallback) | Trip completion deletes `bus_locations` rows and clears in-memory map. |
| **Driver Lock Ownership** | PostgreSQL table `active_trips` (`driver_id`, `bus_id`) | In-memory `activeTripCache` | `invalidateActiveTripCache()` on start/end. |
| **Waiting Flags** | PostgreSQL table `waiting_flags` | Channel `waiting_flags_{busId}` | Deleted and broadcasted as `waiting_flag_removed` on trip completion. |
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
