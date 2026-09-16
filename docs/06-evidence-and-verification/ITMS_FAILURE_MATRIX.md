# ADTU ITMS — Failure Injection Matrix

This document provides the canonical failure-injection analysis across all primary subsystem dependencies: Redis, PostgreSQL, Firebase Auth, FCM Push Notifications, WebSocket Nodes, and Browser/Client Networks.

---

## Failure Simulation Taxonomy

| Subsystem | Failure Scenario | Trigger | Observed Branch | DB State | Redis State | WS State | External Side Effects | Recovery Behavior |
|---|---|---|---|---|---|---|---|---|
| **Redis** | Completely Unavailable | Host unreachable / container stopped | `atomicGpsGuardAndUpdate` catches connection error | Unchanged (no mutation) | Offline / Unreachable | Sockets remain up; inter-node relay paused | None; updates rejected with 503/400 | Fail-closed: returns `redis_unavailable`. Reconnects automatically when Redis recovers. |
| **Redis** | Command Timeout | Redis CPU pegged / network latency spike | Promise rejects after timeout threshold | Unchanged | Timeout / dropped | Message queue drains local items only | None | Callers receive timeout exception; operations retry idempotently. |
| **Redis** | Pub/Sub Partition | Disconnect on Pub/Sub socket only | `redisPubSub.publish().catch(err)` | Unchanged | Partial partition | Local in-process broadcast succeeds; peer nodes missed | Logged at `warn` level | Sibling nodes catch up via subsequent HTTP poll or student fallback interval. |
| **Redis** | Cluster Split (Node 1 Up, Node 2 Down) | Network partition between Node 2 and Redis | Node 1 coordinates normally; Node 2 fails closed | Consistent | Node 1 connected; Node 2 offline | Node 1 handles live traffic; Node 2 rejects ingestion | None | Driver reconnects through NGINX to healthy Node 1. |
| **PostgreSQL** | Transaction Timeout | Long-running locks / query timeout | RPC raises `57014 query_canceled` | Transaction rolled back | Unchanged | WebSocket relays failure response | None | Transaction rollback restores source state without capacity leak. |
| **PostgreSQL** | Connection Failure | Supabase pool exhausted / network drop | `getSupabaseServer()` query rejects with connection error | Intact (read-only) | Unchanged | WS continues running from memory caches | HTTP 500 returned to API callers | Connection retry with exponential backoff on pool re-establishment. |
| **PostgreSQL** | RPC Failure | Parameter mismatch or logic error | `db.rpc()` returns `{ error: { message, code } }` | Rolled back | Unchanged | Route returns HTTP 400 / 500 | None | Application surfaces typed error to caller. |
| **PostgreSQL** | Constraint Violation | Concurrent duplicate insertion (e.g. unique index) | Postgres raises `23505 unique_violation` | Unmutated | Unchanged | Sockets unaffected | None | Caught by error handler; returns HTTP 409 or `{ status: 'already_processed' }`. |
| **Firebase Auth** | Auth Service Outage | Firebase API unreachable | `verifyToken()` promise rejects | Unchanged | Unchanged | New connections rejected with code 4001 | None | Existing authenticated sessions continue using active in-memory session state. |
| **Firebase Auth** | Token Revocation | Admin revokes user refresh tokens | `verifyToken(token)` throws `auth/id-token-revoked` | Role invalidated | Role cache purged via Redis | Socket terminated with code 4401 | None | User must re-authenticate with fresh credentials. |
| **Firebase Auth** | Stale Role Claim | Firebase custom claim differs from PG role | `authenticateSocket()` resolves role from PG `users` table | Authoritative in PG | Synchronized | Socket granted role from PG, ignoring stale claim | None | PG is authoritative; claims cannot override Postgres role. |
| **FCM** | Unregistered Token | Student uninstalls app or clears browser storage | Firebase returns `messaging/registration-token-not-registered` | Token deleted from `fcm_tokens` | Unchanged | Unchanged | None | Token pruned from DB to prevent future delivery failures. |
| **FCM** | Transient Send Failure | FCM network timeout / 5xx error | Catch block in `fcm-notification-service.ts` | Notification row marked `pending_retry` | Unchanged | In-app notification still saved in DB | Push alert omitted | Background retry cron sweeps unconfirmed deliveries. |
| **FCM** | Partial Batch Failure | 5 of 100 tokens fail in batch send | Multi-cast response contains `failureCount > 0` | Failed tokens recorded for cleanup | Unchanged | Unchanged | Successful 95 receive message | Failed tokens pruned; successful items marked delivered. |
| **WebSocket** | Sudden Node Termination | SIGKILL / OOM kill on WS Node 1 | Process exits; TCP FIN/RST to clients | Unchanged | Sibling nodes continue | Sockets on Node 1 disconnected | None | Clients auto-reconnect to Node 2 via NGINX upstream with reconnect token. |
| **WebSocket** | Slow Consumer (Backpressure) | Mobile device on 2G throttles TCP ACK | `ws.bufferedAmount` exceeds 1,048,576 bytes | Unchanged | Unchanged | Non-critical location frames dropped; socket closed with 1008 if stalled | Memory footprint bounded | Client reconnects with clean buffers; other clients unaffected. |
| **WebSocket** | Abrupt Disconnect (Airplane Mode) | Client loses connection without TCP FIN | Heartbeat detector times out after 30s | Stale locks cleaned by cron | Unchanged | Socket cleaned from registries; subscriptions removed | None | Driver GPS stream pauses until reconnection. |
| **Browser / Network** | Duplicate HTTP Request | User clicks submit button twice simultaneously | Route receives two requests with identical body | CAS / Unique index permits exactly 1 | Unchanged | Unchanged | Receipt generated once | First request succeeds; second request returns idempotent success or 409. |
| **Browser / Network** | Network Interruption During GPS | Cellular network drops packets mid-route | Watchdog detects silence >10s | Trip active | Unchanged | Marker turns amber (warning) on student map | Driver UI shows GPS signal warning | Reconnection re-establishes authoritative stream; stale packets dropped. |
| **Browser / Network** | Replay of Old Location Packet | Attacker captures and replays earlier GPS JSON | Redis Lua script checks timestamp against last update | Breadcrumbs unchanged | Authoritative coordinates unchanged | No broadcast emitted | HTTP 400 rejected | Late packet rejected with "Stale or out-of-order GPS packet". |

---

## Critical Failure Guarantees
1. **Financial Immutability**: No failure scenario in external delivery (FCM, email) causes financial rollback of an already committed payment ledger row.
2. **Spatial Integrity**: An outage of Redis in production strictly causes GPS rejection (fail-closed) rather than uncontrolled split-brain location broadcasting.
3. **Capacity Invariant**: Database transaction rollbacks restore capacity counts with deterministic arithmetic (`occupied_seats <= capacity` strictly preserved).
4. **Identity Perimeter**: Token verification failures fail closed across both HTTP and WebSocket interfaces.
