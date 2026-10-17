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
| **WebSocket Node Restart / Interruption** | Clients connected to WS lose live tracking socket stream. | Client `WebSocketClient` onclose handler fires immediately. | Client executes exponential backoff reconnect with jitter (100ms - 5000ms), restoring channel subscriptions. | Snapshot delivery retrieves latest coordinate from in-process memory immediately upon re-subscribe. Zero lost tracking continuity. |
| **Redis Broker Crash / Restart** | Distributed Lua validation unavailable. | Redis client emits error/close events. | In production, GPS ingress fails closed (`redis_unavailable`) to preserve spatial safety; in development, in-memory fallback continues. Redis client automatically reconnects. | When Redis recovers, Lua validation resumes immediately with zero database corruption. |
| **Driver Cellular Signal Drop (> 60s)** | No GPS updates received by server during the outage. | `active_trips.expires_at` timestamp passes without heartbeat. | Background worker executes `cleanup_stale_trips` RPC. Trip row is deleted from `active_trips` and archived to `trips` with `status = 'interrupted'`. | Lock is freed. Bus is marked idle. Client map switches marker to offline state. No zombie trips. |
| **PostgreSQL Transient Outage / Connection Drop** | API requests fail with 500 error; RPC calls abort. | Supabase/PG pool client error handler. | Requests fail-closed with sanitized JSON error envelope; connection pool reconnects with exponential backoff. | Database transactions rollback completely; partial mutations are strictly prohibited. |
| **Out-of-Order or Stale GPS Packet Arrival** | Cellular jitter causes Packet N+1 to arrive before Packet N. | Client monotonic check `packet.timestamp <= lastRenderedTimestamp`. | `decideLocationPacket` drops stale packet silently; telemetry logged. | Map marker animates only along forward chronological path. Zero backward jumping. |
| **Client Browser Sudden Close / Battery Death** | Student or driver socket disconnects abruptly without formal teardown. | WebSocket ping/pong timeout (30s) or TCP FIN packet. | Server cleans up socket from channel subscription sets; heartbeat TTL ensures driver trip expires if not renewed. | Zero dangling subscriptions; memory freed automatically. |

---

## 3. Realtime Delivery & Redis Failure Behavior

```
                   ┌──────────────────────────────────────────────┐
                   │                 NGINX Proxy                  │
                   └──────────────────────┬───────────────────────┘
                                          │
                                          ▼
                                ┌───────────────────┐
                                │     WS Node 1     │
                                │   (Port 3001)     │
                                └─────────┬─────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
              ┌───────────────────┐               ┌───────────────────┐
              │   Redis Broker    │               │ In-Memory Snapshot│
              │  (Coordination)   │               │  (Direct Fan-Out) │
              └───────────────────┘               └───────────────────┘
```

1. **Normal Operation:**
   - Driver transmits GPS to Next.js API → Validated atomically via Redis Lua guard → Emitted directly to WebSocket service (`ws1`) → Broadcast locally to all connected student sockets with sub-50ms latency.
2. **Redis Outage Behavior:**
   - Realtime delivery to already-connected clients continues in-process within `ws1`.
   - In production, new incoming GPS packets fail closed (`redis_unavailable`) to prevent spatial safety degradation across application containers.
   - When Redis returns, Lua validation resumes transparently.

---

## 4. Runtime Service Inventory & Port Topology

The production system runs containerized services managed by Docker:

| Service Name | Container Name | Port | Base Image | Healthcheck | Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Next.js App Server** | `itms-nextjs` | `3000` | Node.js 20 Alpine | `wget http://localhost:3000/api/health` | Web portal, REST API, authentication boundaries |
| **WebSocket Node** | `itms-ws1` | `3001` | Node.js 20 Alpine | `wget http://localhost:9090/health/live` | Realtime telemetry stream server |
| **NGINX Proxy** | `itms-nginx` | `80`, `443` | NGINX 1.27 Alpine | HTTP check on `/health` | SSL/TLS ingress and reverse proxy |
| **Redis Broker** | `itms-redis` | `6379` | Redis 7 Alpine | `redis-cli ping` | Atomic GPS guard, session coordination |
| **Prometheus** | `itms-prometheus`| `9090` | Prometheus 2.45 | Built-in HTTP check | Metrics collector (scrapes :3000, :3001) |
| **Alertmanager** | `itms-alertmanager`| `9093` | Alertmanager 0.26| Built-in HTTP check | Alert dispatch engine |
| **Grafana** | `itms-grafana` | `3002` | Grafana 10.0 | Built-in HTTP check | Observability dashboards & SLA metrics |

---

## 5. Post-Trip Orphan Resource & Cleanup Audit

A fundamental vulnerability in transit tracking systems is "zombie resources" (trips that never end, lingering GPS markers, or orphaned waiting flags).

### 5.1 The `release_trip_lock` Atomic Cleanup
When a driver calls `POST /api/driver/end-trip`, PostgreSQL RPC `release_trip_lock` executes an atomic ACID transaction:
1. **Delete Active Trip:** Deletes the row in `active_trips` for the specified `trip_id`.
2. **Purge Ephemeral GPS Points:** Clears live tracking coordinates from Redis (`gps:last:{busId}`) and process memory.
3. **Cancel Active Waiting Flags:** Updates all flags in status `raised`, `acknowledged`, or `waiting` to `cancelled`.
4. **Archive Historical Record:** Inserts a completed trip row into `trips` with `end_time = now()`.
5. **Purge Redis Cache:** Removes key `gps:last:{busId}` and broadcasts `trip_ended` event.

### 5.2 Verification Evidence
- During the 163-agent Master Staging Simulation, after all 13 drivers completed their simulated routes:
  - `SELECT COUNT(*) FROM active_trips;` → Returned **0**.
  - Redis `KEYS gps:last:*` → Returned **empty list**.
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
