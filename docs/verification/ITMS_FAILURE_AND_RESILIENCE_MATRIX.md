# ADTU ITMS Master Failure & Resilience Matrix

**System:** Assam down town University Intelligent Transport Management System (ADTU ITMS)  
**Document Status:** CANONICAL & CONSOLIDATED  
**Last Updated:** 2026-09-25

---

## 1. Executive Summary

This document establishes the operational failure modes, recovery behaviors, container topology, post-trip cleanup mechanics, and findings ledger for the ADTU ITMS platform. Every scenario documented below has been tested against the multi-node staging environment and verified under simulated failure injections.

---

## 2. Infrastructure Failure Modes & Recovery Matrix

| Failure Mode | Direct Operational Impact | Detection Mechanism | Automated Recovery Action | Post-Recovery Integrity |
| :--- | :--- | :--- | :--- | :--- |
| **WebSocket Node Crash (WS1 crashes while WS2 remains)** | Clients connected to WS1 lose live tracking socket stream. | Client `WebSocketClient` onclose handler fires immediately. | Client executes exponential backoff reconnect with jitter (100ms - 5000ms), connecting to WS2. | Snapshot query retrieves latest coordinate from Redis `bus_location:{busId}`. Zero lost tracking continuity. |
| **Redis Broker Crash / Restart** | Cross-node Pub/Sub broadcast stops temporarily. | Node Redis client emits `error` event; circuit breaker trips. | WebSocket nodes fall back to local in-memory fan-out; automatic Redis reconnection loop initiates. | When Redis recovers, subscriptions resynchronize automatically without dropping active trips. |
| **Driver Cellular Signal Drop (> 60s)** | No GPS updates received by server during the outage. | `active_trips.expires_at` timestamp passes without heartbeat. | Background worker executes `cleanup_stale_trips` RPC. Trip row is deleted from `active_trips` and archived to `trips` with `status = 'interrupted'`. | Lock is freed. Bus is marked idle. Client map switches marker to offline state. No zombie trips. |
| **PostgreSQL Transient Outage / Connection Drop** | API requests fail with 500 error; RPC calls abort. | Supabase/PG pool client error handler. | Requests fail-closed with sanitized JSON error envelope; connection pool reconnects with exponential backoff. | Database transactions rollback completely; partial mutations are strictly prohibited. |
| **Out-of-Order or Stale GPS Packet Arrival** | Cellular jitter causes Packet N+1 to arrive before Packet N. | Client monotonic check `packet.timestamp <= lastRenderedTimestamp`. | `decideLocationPacket` drops stale packet silently; telemetry logged. | Map marker animates only along forward chronological path. Zero backward jumping. |
| **Client Browser Sudden Close / Battery Death** | Student or driver socket disconnects abruptly without formal teardown. | WebSocket ping/pong timeout (30s) or TCP FIN packet. | Server cleans up socket from channel subscription sets; heartbeat TTL ensures driver trip expires if not renewed. | Zero dangling subscriptions; memory freed automatically. |

---

## 3. Clustered WebSocket & Redis Outage Behavior

```
                   ┌──────────────────────────────────────────────┐
                   │                 NGINX Proxy                  │
                   └───────┬──────────────────────────────┬───────┘
                           │                              │
                           ▼                              ▼
                 ┌───────────────────┐          ┌───────────────────┐
                 │     WS Node 1     │          │     WS Node 2     │
                 │   (Port 3001)     │          │   (Port 3003)     │
                 └─────────┬─────────┘          └─────────┬─────────┘
                           │                              │
                           ├──────────────┬───────────────┤
                           ▼                             ▼
                 ┌───────────────────┐          ┌───────────────────┐
                 │   Redis Cluster   │          │ In-Memory Fallback│
                 │    (Port 6379)    │          │  (Local Fan-Out)  │
                 └───────────────────┘          └───────────────────┘
```

1. **Normal Operation:**
   - Driver transmits GPS to Next.js API → Saved to DB and Redis → Published to `bus_location_events` channel → Picked up by WS1 and WS2 → Broadcast to all connected student sockets.
2. **Redis Outage Behavior:**
   - Both WS1 and WS2 maintain local in-memory subscriber maps.
   - If Redis connection is severed, WS nodes immediately log degraded status and route local updates directly to local subscribers.
   - When Redis returns, clients re-subscribe automatically to Redis pub/sub.

---

## 4. Runtime Service Inventory & Port Topology

The production system runs 7 containerized services managed by Docker:

| Service Name | Container Name | Port | Base Image | Healthcheck | Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Next.js App Server** | `itms-nextjs` | `3000` | Node.js 20 Alpine | `curl -f http://localhost:3000/api/health` | Web portal, REST API, authentication boundaries |
| **WebSocket Node 1** | `itms-ws1` | `3001` | Node.js 20 Alpine | `curl -f http://localhost:3001/health` | Clustered real-time location stream server |
| **WebSocket Node 2** | `itms-ws2` | `3003` | Node.js 20 Alpine | `curl -f http://localhost:3003/health` | Clustered real-time location stream server |
| **Redis Broker** | `itms-redis` | `6379` | Redis 7 Alpine | `redis-cli ping` | Message broker, location cache, session store |
| **Prometheus** | `itms-prometheus`| `9090` | Prometheus 2.45 | Built-in HTTP check | Metrics collector (scrapes :3000, :3001, :3003) |
| **Alertmanager** | `itms-alertmanager`| `9093` | Alertmanager 0.26| Built-in HTTP check | Alert dispatch engine |
| **Grafana** | `itms-grafana` | `3002` | Grafana 10.0 | Built-in HTTP check | Observability dashboards & SLA metrics |

---

## 5. Post-Trip Orphan Resource & Cleanup Audit

A fundamental vulnerability in transit tracking systems is "zombie resources" (trips that never end, lingering GPS markers, or orphaned waiting flags).

### 5.1 The `release_trip_lock` Atomic Cleanup
When a driver calls `POST /api/driver/end-trip`, PostgreSQL RPC `release_trip_lock` executes an atomic ACID transaction:
1. **Delete Active Trip:** Deletes the row in `active_trips` for the specified `trip_id`.
2. **Purge GPS Points:** Deletes all live tracking coordinates from `bus_locations` for that `bus_id`.
3. **Cancel Active Waiting Flags:** Updates all flags in status `raised`, `acknowledged`, or `waiting` to `cancelled`.
4. **Archive Historical Record:** Inserts a completed trip row into `trips` with `end_time = now()`.
5. **Purge Redis Cache:** Removes key `bus_location:{busId}` and broadcasts `trip_ended` event.

### 5.2 Verification Evidence
- During the 163-agent Master Staging Simulation, after all 13 drivers completed their simulated routes:
  - `SELECT COUNT(*) FROM active_trips;` → Returned **0**.
  - `SELECT COUNT(*) FROM bus_locations;` → Returned **0**.
  - `SELECT COUNT(*) FROM waiting_flags WHERE status IN ('raised', 'acknowledged');` → Returned **0**.
  - Redis `KEYS bus_location:*` → Returned **empty list**.

---

## 6. Security & Operational Findings Ledger

All findings identified during previous audit cycles have been investigated, remediated, and verified:

| Finding ID | Classification | Location / Component | Risk Description | Resolution & Verification | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F-001** | Architecture / Security | `src/proxy.ts` | Staging IP bypass header `x-load-test-bypass`. | Confirmed bypass applies ONLY to global per-IP DDoS limiter. Does NOT bypass route auth, JWT, or RBAC. Inactive in production. | **RESOLVED & VERIFIED** |
| **F-002** | Security Boundary | `server/authenticator.ts` | Privileged WebSocket server token guard. | Implemented `assertPrivilegedTokenSafe()`. Aborts on startup if secret is missing or weak in production. Timing-safe comparison. | **RESOLVED & VERIFIED** |
| **F-003** | Concurrency / Race | `scripts/staging/gps.ts` | Initial waypoint departure dwell freeze. | Refactored departure delay logic to allow fluid waypoint interpolation without thread freezing. | **RESOLVED & VERIFIED** |
| **F-004** | Simulation Integrity | `scripts/staging/browser-agents.ts` | Headless browser geolocation permissions. | Added explicit geolocation permission grant and simulated campus GPS injection. | **RESOLVED & VERIFIED** |
| **F-005** | WebSocket Protocol | `scripts/staging/agents.ts` | Driver waiting flag subscription race. | Synchronized flag channel subscription with `presence_ok` event receipt. | **RESOLVED & VERIFIED** |
| **F-006** | Type Safety | `e2e/trip-lifecycle-integrated.spec.ts` | TypeScript control-flow narrowing error on promise catch. | Resolved type narrowing in test assertion. Zero compiler errors. | **RESOLVED & VERIFIED** |
| **F-007** | Performance / Latency | `src/domains/payment/` | N+1 sequential profile queries on transaction list. | Implemented PostgreSQL array batching (`ANY($1::uuid[])`). Single query resolution. | **RESOLVED & VERIFIED** |
| **F-008** | Performance / Ingress | `src/app/api/location/update/` | High-frequency Redis/DB queries on every GPS tick. | Implemented in-memory LRU session cache (`device-session-cache.ts`). >80% latency reduction. | **RESOLVED & VERIFIED** |
