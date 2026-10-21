# Domain 01: Trip Lifecycle, Realtime Telematics & Fleet Tracking

================================================================================
EXECUTIVE SUMMARY & SYSTEM TOPOLOGY
================================================================================

The **Trip Lifecycle Domain** is the core operational engine of the Assam down town University Intelligent Transport Management System (ADTU ITMS). It orchestrates mission-critical transit workflows for thousands of students and faculty commuting across Guwahati and Kamrup transit corridors:
- Sub-50ms telematics ingestion and validation pipeline.
- Three-way mutual exclusion trip locking (`bus_id`, `driver_id`, `route_id`).
- Stop-anchored incontrovertible audit proof logging (geofenced arrival, dwell duration, departure).
- Bidirectional real-time student-driver coordination (stop proximity alerts, waiting flags, boarding scans).
- Distributed WebSocket fan-out (WS1 cluster on port 3001) backed by Redis 7.2 Pub/Sub.
- Unified teardown orchestrator (`evictAllBusRuntimeState`) eradicating ghost flags and stale session locks.

```
                              [ DRIVER MOBILE PWA ]
                                       │
                      1. HTTP Ingress (GPS Telematics)
                         POST /api/location/update
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │      NGINX REVERSE PROXY      │
                       │ - SSL/TLS (443)               │
                       │ - /ws  -> WS1 Cluster (:3001) │
                       │ - /api -> Next.js Engine      │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │    NEXT.JS 16 APP ROUTER      │
                       │  - GpsPipelineService         │
                       │  - StopDwellService           │
                       │  - TripOrchestrator           │
                       └───────┬───────────────┬───────┘
                               │               │
       2. Realtime Event Emit  │               │ 3. State & Locks
          (emitEvent -> WS1)   │               │    (ACID Transactions)
                               ▼               ▼
                   ┌───────────────────┐   ┌───────────────────────────┐
                   │  REDIS 7 BROKER   │   │   SUPABASE POSTGRESQL     │
                   │ - Pub/Sub Hub     │   │ - active_trips (UNIQUE)   │
                   │ - Ephemeral Locks │   │ - stop_dwell_logs (PROOF) │
                   │ - Dwell Cache     │   │ - driver_trip_history     │
                   └─────────┬─────────┘   │ - waiting_flags           │
                             │             └───────────────────────────┘
                             ▼
                   ┌───────────────────┐
                   │ WS1 NODE.JS (3001)│
                   │ - Room Isolation  │
                   │ - Sub-50ms Fanout │
                   └─────────┬─────────┘
                             │
                  4. Sub-50ms Socket Broadcast
                             │
                             ▼
                 [ STUDENT CLIENT (MapLibre GL) ]
```

---

## 1. Domain State Taxonomy & Lifecycle Invariants

| State Classification | Storage Engine | Concrete Entities | Retention / Eviction Policy | Invariant Enforced |
| :--- | :--- | :--- | :--- | :--- |
| **Durable Authoritative** | PostgreSQL 16 | `public.active_trips`, `public.buses`, `public.driver_profiles`, `public.driver_trip_history` | Permanent history; active locks pruned on journey completion. | `INV-TRIP-001`: Three-way unique lock (`bus_id`, `driver_id`, `route_id`). |
| **Transactional State** | PostgreSQL 16 | `acquire_trip_lock`, `end_trip_atomically`, `reassign_students_atomically` | ACID boundary; rollbacks on failure. | Single active trip per vehicle and driver; non-overlapping trips. |
| **Audit History (Proof)** | PostgreSQL 16 | `public.stop_dwell_logs`, `public.audit_events` | Immutable, append-only records with geofence entry/exit. | `INV-TRIP-002`: Incontrovertible dwell proof (`arrived_at`, `dwell_seconds`, `departed_at`). |
| **Ephemeral Cache** | Redis 7.2 | Active waiting flags, throttled dwell markers, GPS pipeline session | 15s - 600s TTL; instant flush on trip conclusion. | `INV-TRIP-003`: Speed bounds ($\le 120$ km/h), Assam corridor bounding box. |
| **Process-Local L1 Cache** | Node.js Memory | Driver active trip cache, scanner bus context (`scannerBusCache`) | 15s TTL; O(1) eviction; explicit invalidation on trip start/end. | Zero database queries during burst boarding scans. |

---

## 2. Low-Level Component Architecture

### 2.1 Trip Lifecycle Orchestration (`src/domains/trip/services/`)
- **`trip-orchestrator.ts`**:
  - `startTrip(params)`: Executes preflight validation, acquires atomic PostgreSQL lock via `acquire_trip_lock` RPC, provisions Redis trip lock key, updates driver profile to `on_duty`, invalidates scanner cache via `invalidateScannerBusCache(driverId)`, and emits `trip_started` over WebSockets.
  - `endTrip(params)`: Validates that operating driver matches active lock, executes `end_trip_atomically` RPC (discarding trips $<10$ minutes to prevent analytics pollution), marks driver `off_duty`, and triggers unified teardown orchestrator.
- **`trip-cleanup.service.ts`**:
  - `evictAllBusRuntimeState(busId, driverId, tripId)`: The single authoritative teardown function executed on trip termination and stale-lock recovery:
    1. Invalidates active trip lock cache (`invalidateActiveTripCache`).
    2. Clears in-memory raw GPS coordinates (`clearInMemoryLastLocation`) and GPS pipeline sessions.
    3. Flushes and clears stop-dwell memory and Redis cache (`clearStopDwellState`, `flushStopDwellOnTripEnd`).
    4. Purges Redis waiting flags (`clearRedisActiveFlags`) and Redis trip locks (`clearRedisTripLock`).
    5. Invalidates shared bus trip snapshot (`invalidateBusTripSnapshot`).
    6. Invalidates driver device session (`invalidateCachedDeviceSession`) and process-local scanner bus cache (`invalidateScannerBusCache`).
    7. Clears breadcrumb write-throttle cache (`clearTripBreadcrumbCache`).

### 2.2 Telematics & Stop Dwell Pipeline (`src/domains/gps/services/`)
- **`gps-pipeline.service.ts`**:
  - Validates coordinate bounding box: Latitude `[25.5, 26.5]`, Longitude `[91.4, 92.2]` (Greater Guwahati Corridor).
  - Enforces speed sanity gate: speed $\le 120$ km/h. Jump filter rejects unrealistic teleportation ($>200$m in 2s).
  - Kalman filter smoothing reduces GPS jitter while stationary at signals or bus stops.
- **`stop-dwell.service.ts`**:
  - Evaluates bus proximity against static route stop geofences ($80$m radius).
  - Entry records `arrived_at`. While stationary inside the stop zone, in-memory dwell updates every 2s, but Redis sync is throttled to once every 15s ($>85\%$ Redis traffic reduction).
  - Exit commits immutable dwell log to `public.stop_dwell_logs` (`arrived_at`, `dwell_seconds`, `departed_at`).

---

## 3. Detailed Document Roadmap

The `01-trip-lifecycle/` directory contains complete low-level architectural specifications:

1. [**01-architecture-and-dataflow.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/01-architecture-and-dataflow.md)
   - Complete architectural topology, start-trip initiation, three-way lock acquisition, and student tracking live experience.
2. [**02-redis-pubsub.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/02-redis-pubsub.md)
   - Authoritative GPS ingress, Redis Lua guard script (`gps_guard.lua`), channel topologies, and throttled 10-second persistence.
3. [**03-websocket-cluster.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/03-websocket-cluster.md)
   - Dedicated Node.js WebSocket cluster (WS1), HTTP upgrade handshake, room isolation, ping/pong heartbeats, and FCM push fan-out alerting.
4. [**04-gps-pipeline.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/04-gps-pipeline.md)
   - Telematics validation, Assam bounding box sanity gate, Kalman smoothing, and incontrovertible stop dwell audit engine.
5. [**05-state-machine-and-cleanup.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/05-state-machine-and-cleanup.md)
   - FSM state transitions, `end_trip_atomically`, automated stale-lock reaper, and unified `evictAllBusRuntimeState` aggregate.
6. [**06-nginx-and-networking.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/06-nginx-and-networking.md)
   - Reverse proxy configuration, SSL/TLS, WebSocket upgrade headers, upstream keepalives, and Prometheus probe endpoints.
7. [**07-waiting-flags-and-corridor-locks.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/07-waiting-flags-and-corridor-locks.md)
   - Student waiting flags, hands-free driver HUD alerts, 3-lock route corridor concurrency, and proximity auto-dismissal.
8. [**08-database-schema-and-rpc-reference.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/08-database-schema-and-rpc-reference.md)
   - Active trips schema, three-way locks (`bus_id`, `driver_id`, `route_id`), stop dwell tables, and PL/pgSQL stored procedures.
9. [**09-chaos-hardening-and-verification-gates.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/09-chaos-hardening-and-verification-gates.md)
   - 18-point chaos hardening, 24-hour continuous endurance test suite, 12 cross-pillar integration seam remediations, and production freeze certification.
10. [**TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md)
    - Consolidated master reference (scheduled for archival after child file transition verification).

---

## 4. Key Production Verification Gates

Every component in this domain complies with the 4 production verification gates:
- **Strict TypeScript 5.x**: Zero `any` leaks in runtime contracts (`npx tsc --noEmit`).
- **ESLint Clean**: Conformance to production security and coding standards (`npm run lint`).
- **Automated Vitest Coverage**: Tested under concurrency and chaos conditions (`npm run test:run`).
- **Turbopack Build**: Static and dynamic routes pre-rendered without runtime compilation overhead (`npm run build`).
