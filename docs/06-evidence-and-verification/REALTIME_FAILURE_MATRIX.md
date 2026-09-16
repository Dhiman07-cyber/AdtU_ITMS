# ADTU ITMS — Realtime Failure Injection & Resilience Matrix
**Document Reference:** FAIL-MATRIX-2026-09-16  
**Status:** VALIDATED  

---

## 1. Failure-Injection Scenarios & Behavior Matrix

| Dependency | Injected Failure Mode | Expected System Invariant | Observed Runtime Behavior | Recovery / Fail-Closed Mechanism | Verification Level |
|---|---|---|---|---|---|
| **Redis** | Redis cluster down / unreachable | Spatial jump/speed guards must not degrade silently across pods | `atomicGpsGuardAndUpdate` returns `'redis_unavailable'`; `gps-pipeline` rejects update with `DATABASE_UNAVAILABLE` | **FAIL-CLOSED:** In production, packet is rejected. In dev, falls back to `memLast`. | Automated Unit & Integration (`security-boundaries-master.test.ts`) |
| **Redis** | Latency > 3,000ms (connect / command hang) | HTTP location ingestion must not block worker threads indefinitely | `CONNECT_TIMEOUT_MS` (3,000ms) fires, destroys socket, clears pending commands, and triggers auto-reconnect | Socket destroyed, error logged, packet rejected cleanly without thread starvation | Static + Unit (`gps-redis-guard.ts`) |
| **Redis** | Node partition (Node A connected, Node B disconnected) | Split-brain coordinates must not corrupt bus locations | Node B fails closed on GPS ingestion; Node A accepts valid updates and writes to Redis | GPS state remains authoritative on Node A; Node B rejects updates until partition heals | Multi-instance architectural proof |
| **PostgreSQL** | Database connection pool exhausted or temporary timeout | Financial ledgers, capacity counts, and active trips must not commit partial state | Queries and RPCs throw `DATABASE_UNAVAILABLE`; transactions roll back automatically | Transactional integrity preserved; no seats allocated or payments recorded without DB commit | Database Transaction Invariant |
| **Firebase Auth** | Auth service timeout or token revocation | Unauthenticated or demoted requests must never bypass security boundaries | `verifyToken` throws error; `withSecurity` and `authenticateSocket` return `authenticated: false` | Handshake/request rejected with HTTP 401 / WS 4001; fail-closed | Integration Test (`privileged-guard.test.ts`) |
| **FCM Multicast** | Expired/unregistered push tokens returned in response | Stale FCM tokens must be evicted without dropping notifications for healthy devices | `sendEachForMulticast` response inspects batch results; tokens with `registration-token-not-registered` are purged | `fcm-token.repository.pg.ts` purges invalid tokens while transient errors are retried | Unit Test (`fcm-token.repository.test.ts`) |
| **Razorpay API** | Payment provider fetch timeout during verification | System must not mark payment as completed without signature/order verification | `verify-payment` route catches timeout; returns HTTP 502/504; payment remains `pending` | Client or recovery cron (`/api/payment/recover`) polls status safely using idempotent CAS | Integration (`payment.service.test.ts`) |
| **WebSocket Node** | Sudden process crash / SIGKILL on WS1 | Connected browser clients must seamlessly recover without stale state | Browser client detects disconnect via `onclose`/heartbeat; initiates backoff reconnection | Reconnects to WS2; sends fresh snapshot request; restores channel subscriptions | Client Realtime Test (`ws-client.ts`, `useWebSocket.ts`) |
| **Browser Network** | Device toggles airplane mode / drops network | Stale bus markers must not remain frozen indefinitely when trip terminates | `useBusLocation.ts` handles visibility change and stale timeouts; clears marker when trip ends | Periodic staleness sweep evicts obsolete markers; fresh snapshot fetched on network restore | Browser Hook Invariant (`useBusLocation.ts`) |
| **Admin Role Flip** | Admin demotes moderator/driver during active WS session | Demoted user must lose privileged broadcast/reassign authority immediately | Redis publishes `role_invalidate` message; WS nodes purge user from `tokenAuthCache` | Subsequent actions require re-evaluating PostgreSQL role, denying access immediately | Cross-instance Integration (`redis-broadcast.ts`) |

---

## 2. Invariant Preservation Summary

- **No Split-Brain GPS:** By eliminating the silent in-memory fallback in production, two Next.js instances can never accept conflicting GPS streams when Redis is unavailable.
- **No Orphaned Trips:** Active trip state is anchored exclusively in PostgreSQL `active_trips` with atomic `acquire_trip_lock` and `end_trip_atomically` RPCs.
- **No Unaudited Invalidation:** Role changes immediately notify all listening services via Redis pub/sub, shrinking the stale-role window from 90 seconds to under 5 milliseconds.
