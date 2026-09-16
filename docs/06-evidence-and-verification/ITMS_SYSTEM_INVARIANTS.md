# ADTU ITMS — Canonical System Invariant Ledger

This document establishes the permanent, non-negotiable architectural, security, and business invariants governing the ADTU ITMS production platform. Every invariant is designated with a permanent identifier (`INV-*`) that must be preserved across engineering cycles.

---

## 1. Authentication & Identity Invariants

### `INV-AUTH-001`: Authentication Boundary
* **Statement:** Unauthenticated requests cannot execute protected operations under any circumstances.
* **Authoritative Boundary:** Firebase Authentication ID token verification via `verifyToken()` (Admin SDK) and server-side route wrapper `withSecurity()` (`src/lib/security/api-security.ts`).
* **Enforcement Mechanics:** Handshake/request headers must supply `Authorization: Bearer <token>`. Absence, expiration, or cryptographic tampering terminates execution before domain handlers run.
* **Verification Proof:** Negative API suites reject unauthenticated requests (`401 Unauthorized`), malformed tokens (`401`), and revoked tokens. Unit tests in `src/lib/security/__tests__/security-boundaries-master.test.ts`.

### `INV-AUTH-002`: Horizontal Ownership (Anti-IDOR)
* **Statement:** User A cannot read or mutate User B's protected resources unless an explicit privileged administrative role (`admin`, `moderator`) authorizes cross-user execution.
* **Scope:** Student profiles, renewal applications, payment records, driver assignments, device sessions, push tokens, and audit trails.
* **Enforcement Mechanics:** Because server routes use Supabase `service_role` (which intentionally bypasses Postgres RLS), ownership checks MUST be explicitly executed in application route code:
  `if (auth.role !== 'admin' && auth.uid !== targetUid) throw new ForbiddenError()`
* **Verification Proof:** Unit & integration tests in `src/domains/student/__tests__/student.service.test.ts` and `src/app/api/students/__tests__/pagination.test.ts`.

### `INV-AUTH-003`: Role Revocation & Active WS Eviction
* **Statement:** When a user's privileged role is revoked or permissions modified, future authentication must reflect the new role, the role cache must invalidate across all nodes, already-connected privileged WebSocket sessions must immediately lose authority and be closed (code `4401`), and all registries must evict them.
* **Authoritative Boundary:** PostgreSQL `users.role` + Redis Pub/Sub channel `role_invalidate` + `server/redis-broadcast.ts`.
* **Enforcement Mechanics:**
  1. Admin updates role in DB and calls `invalidateRoleCache(uid)`.
  2. Redis broadcasts `uid` on channel `role_invalidate`.
  3. Every WS server process purges `tokenAuthCache` and closes matching sessions with `4401` (`Role revoked`).
  4. Sockets are synchronously unregistered from `connectionRegistry` and `sessionManager`.
* **Verification Proof:** Handlers in `server/redis-broadcast.ts` and `server/privileged-guard.test.ts`.

### `INV-AUTH-004`: Device Session Exclusivity
* **Statement:** Only the currently authorized driver device may perform live GPS ingestion and trip controls. A secondary device cannot hijack or submit GPS while an active session exists.
* **Authoritative Boundary:** PostgreSQL table `device_sessions` + heartbeat lease (30s window) + backend check in `/api/location/update` and `/api/driver/update-location`.
* **Enforcement Mechanics:**
  - Active session on Device A rejects Device B requests with `403` and error code `ANOTHER_DEVICE_ACTIVE`.
  - Missing device identifier while an active session exists is strictly rejected.
  - Expired sessions (>30s without heartbeat) allow takeover.
* **Verification Proof:** Route handlers in `src/app/api/location/update/route.ts` and `src/app/api/driver/update-location/route.ts`, plus unit suite in `src/lib/security/__tests__/security-boundaries-master.test.ts`.

### `INV-AUTH-005`: CSRF & Origin Validation
* **Statement:** Malicious cross-origin browser requests cannot execute state-changing operations (`POST`, `PUT`, `PATCH`, `DELETE`).
* **Authoritative Boundary:** Edge proxy (`src/proxy.ts`) + `validateOrigin()`.
* **Enforcement Mechanics:**
  - State-changing browser requests must provide a verified `Origin` or `Referer` matching allowlisted production domains or localhost.
  - Requests missing `Origin`/`Referer` are strictly rejected unless accompanied by an `Authorization: Bearer <token>` header (non-browser API/mobile client).
  - Wildcard subdomain parsing is prevented; exact host matches are enforced.
* **Verification Proof:** `src/lib/security/__tests__/security-boundaries-master.test.ts` (`SEC-01`, `SEC-02`, `SEC-03`).

### `INV-AUTH-006`: Trusted Client IP Resolution
* **Statement:** Rate-limiting keys and IP auditing cannot be spoofed or rotated by arbitrary client-supplied forwarding headers.
* **Authoritative Boundary:** NGINX reverse proxy (`nginx/nginx.conf`) overwrites `X-Real-IP: $remote_addr`. Application layer in `src/lib/security/api-security.ts` trusts `X-Real-IP` first, falling back to the rightmost hop of `X-Forwarded-For`.
* **Enforcement Mechanics:**
  - Direct client manipulation of `X-Forwarded-For` prefix cannot spoof the trusted address.
  - When reaching Next.js through NGINX, `X-Real-IP` is unconditionally authoritative.
* **Verification Proof:** Unit tests in `src/lib/security/__tests__/security-boundaries-master.test.ts`.

### `INV-AUTH-007`: Bootstrap Protection
* **Statement:** First-admin and system initialization endpoints are timing-safe, rate-limited, fail-closed on DB uncertainty, and permanently disabled once an administrator exists.
* **Authoritative Boundary:** `/api/create-first-admin` + PostgreSQL `users` count check.
* **Enforcement Mechanics:** Strict IP rate limiting (3 req/hour), environment secret verification, fail-closed database query.

---

## 2. Real-Time & WebSocket Invariants

### `INV-WS-001`: Authentication Before Privileged Processing
* **Statement:** No client WebSocket message (subscribe, presence, trip commands) can be processed before successful authentication.
* **Authoritative Boundary:** `server/websocket-server.ts` connection handshake and 5-second `preAuthBuffer`.
* **Enforcement Mechanics:**
  - Client must send `{ type: "auth", token: "..." }` within 5,000ms.
  - Sockets failing auth within the timeout are terminated with code `4001`.
  - Max buffer during authentication is capped at 50 messages to eliminate memory exhaustion attacks.
* **Verification Proof:** `server/websocket-server.test.ts` ("rejects connections that never send an auth message").

### `INV-WS-002`: URL Token Policy
* **Statement:** Production WebSocket authentication strictly forbids bearer credentials in URL query parameters (`?token=...`).
* **Authoritative Boundary:** `server/websocket-server.ts` (`SEC-04`).
* **Enforcement Mechanics:** In `NODE_ENV === 'production'`, any connection attempt with `?token=` in the query string is immediately rejected with close code `4001`. First-message JSON authentication is required.
* **Verification Proof:** `server/websocket-server.test.ts` & `server/privileged-guard.test.ts`.

### `INV-WS-003`: Active Session Revocation (Multi-Node)
* **Statement:** Receipt of `role_invalidate` over Redis must locate and immediately terminate all active connections for that UID on ALL running WebSocket nodes.
* **Authoritative Boundary:** `server/redis-broadcast.ts` + `sessionManager.getByUid(uid)`.
* **Enforcement Mechanics:** Iterates local sessions for the UID, invokes `ws.close(4401)`, evicts from `connectionRegistry`, cleans up subscriptions, and clears `tokenAuthCache`.

### `INV-WS-004`: Channel Authorization
* **Statement:** Clients can only subscribe to channels authorized for their authenticated identity and active trip assignments.
* **Authoritative Boundary:** `server/socket-router.ts` subscription guard.
* **Enforcement Mechanics:**
  - Drivers can only publish on their assigned bus channels.
  - Server broadcasts are restricted to `role === 'server'`.
  - Student channels require valid session associations.

### `INV-WS-005`: Backpressure & Slow Consumer Isolation
* **Statement:** A slow or stalled consumer cannot cause unbounded memory growth on the server or block broadcasts to healthy clients.
* **Authoritative Boundary:** `server/websocket-server.ts` `bufferedAmount` monitoring.
* **Enforcement Mechanics:** Sockets with `bufferedAmount > 1MB` drop non-critical frames or disconnect with code `1008`.

### `INV-WS-006`: Cross-Node Event Integrity
* **Statement:** An event published on WS Node 1 must reach authorized subscribers on WS Node 2 via Redis Pub/Sub without loops or message amplification.
* **Authoritative Boundary:** `server/redis-broadcast.ts` (`MY_NODE_ID` deduplication guard).
* **Enforcement Mechanics:** Each envelope carries `originNodeId`. Receiving nodes ignore messages where `originNodeId === MY_NODE_ID`.

---

## 3. Trip Lifecycle Invariants

### `INV-TRIP-001`: Exactly One Active Trip per Bus/Driver
* **Statement:** A bus and driver combination can have at most one active trip at any instant.
* **Authoritative Boundary:** PostgreSQL table `active_trips` with unique constraint `UNIQUE (bus_id)` and atomic RPC `acquire_trip_lock`.
* **Enforcement Mechanics:** Driver attempt to start a concurrent trip returns `409 Conflict`.
* **Verification Proof:** `src/domains/trip/__tests__/concurrency.test.ts`.

### `INV-TRIP-002`: Authoritative Trip Ownership
* **Statement:** Only the assigned driver for an active trip may emit trip lifecycle transitions or GPS updates.
* **Authoritative Boundary:** `active_trips.driver_id` verified by `validateTripOwnership()`.

### `INV-TRIP-003`: Atomic Trip Termination
* **Statement:** Ending a trip must atomically remove active trip locks, clear live location caches, transition trip history, and broadcast termination.
* **Authoritative Boundary:** PostgreSQL RPC `end_trip_atomically` + Redis event emission.
* **Verification Proof:** `src/domains/trip/__tests__/end-trip-atomicity.test.ts`.

### `INV-TRIP-004`: No Resurrection After Trip End
* **Statement:** A late or replayed GPS packet from an ended trip cannot recreate active state in `active_trips` or resurrect student UI markers.
* **Authoritative Boundary:** `active_trips` existence check + Redis heartbeat check before accepting location breadcrumbs.

---

## 4. GPS & Ingestion Invariants

### `INV-GPS-001`: Device & Role Authentication
* **Statement:** GPS ingestion is strictly restricted to authenticated drivers possessing an active trip and valid device session.

### `INV-GPS-002`: Monotonic Timestamp Ordering
* **Statement:** Out-of-order GPS packets (older timestamp arriving after newer timestamp) are rejected and cannot overwrite live location state.
* **Authoritative Boundary:** `gps-redis-guard.ts` atomic Redis Lua script comparing millisecond timestamps.

### `INV-GPS-003`: Impossible Movement Rejection
* **Statement:** Packets with impossible velocity (>120 km/h) or geographic teleportation (>1.5 km jump within 5 seconds) are rejected.
* **Authoritative Boundary:** `src/domains/gps/services/gps-pipeline.service.ts`.

### `INV-GPS-004`: Distributed Multi-Node Redis Coordination
* **Statement:** When Redis is available, GPS updates coordinate across all instances through atomic Lua script execution.

### `INV-GPS-005`: Redis Failure Safety (Fail-Closed in Production)
* **Statement:** In production, Redis outage or partition MUST cause GPS ingestion to fail-closed (`redis_unavailable`) rather than falling back to unsynchronized in-memory storage.
* **Authoritative Boundary:** `atomicGpsGuardAndUpdate()` in `src/domains/gps/services/gps-redis-guard.ts`.
* **Verification Proof:** `src/lib/security/__tests__/security-boundaries-master.test.ts`.

### `INV-GPS-006`: No Alternate/Bypass Ingestion Routes
* **Statement:** No direct WebSocket message, legacy HTTP route, or test helper can bypass the canonical GPS pipeline to mutate authoritative live location.
* **Authoritative Boundary:** `server/socket-router.ts` drops direct WS location updates; all traffic routes through `/api/location/update`.

---

## 5. Payment & Financial Invariants

### `INV-PAY-001`: Payment Identity & Amount Binding
* **Statement:** A payment transaction must be cryptographically bound to its trusted order, student, and exact currency amount before ledger commitment.
* **Authoritative Boundary:** Razorpay order verification (`fetchOrderDetails`) + HMAC signature verification (`crypto.timingSafeEqual`).

### `INV-PAY-002`: Provider Event Idempotency
* **Statement:** Repeated processing of the same provider payment ID (webhook retries, client verify-payment collisions) produces zero duplicate business effects.
* **Authoritative Boundary:** PostgreSQL `payments.payment_id` unique constraint + `paymentsSupabaseService.createPayment()` CAS logic.
* **Verification Proof:** `src/lib/payment/__tests__/` and `docs/06-evidence-and-verification/PAYMENT_CONCURRENCY_EVIDENCE.md`.

### `INV-PAY-003`: Concurrent Distinct Payments for Same Renewal
* **Statement:** Two distinct payment transactions executed concurrently for the same student academic session cannot allocate duplicate seats or double-renew validity.
* **Authoritative Boundary:** Partial unique index `idx_applications_active_student_session` ON `applications(applicant_uid, session_start_year)` WHERE `state NOT IN ('rejected', 'cancelled', 'expired')`.

### `INV-PAY-004`: processed_payments Architecture Alignment
* **Statement:** Database tables and RPCs declared for idempotency must accurately reflect runtime application dependencies without phantom layers.
* **Resolution:** PostgreSQL `payments(payment_id UNIQUE)` and `applications(applicant_uid, session_start_year UNIQUE)` provide the authoritative idempotency gate in production.

### `INV-PAY-005`: Application Lifecycle Uniqueness
* **Statement:** A student can have at most one active application per academic session year.
* **Authoritative Boundary:** Database unique index `idx_applications_active_student_session`.

### `INV-PAY-006`: Exactly-Once Financial Commitments
* **Statement:** Financial ledger writes in PostgreSQL are atomic and retry-safe. External side effects (push notification, email receipt) fail gracefully without rolling back financial ledger commits.

---

## 6. Capacity & Allocation Invariants

### `INV-CAP-001`: Occupied Seats Never Exceed Capacity
* **Statement:** For every bus and shift, `occupied_seats <= capacity` at all times.
* **Authoritative Boundary:** PostgreSQL CHECK constraints and transactional locking in `bus_increment_capacity` and `approve_renewal_with_seat`.
* **Verification Proof:** `docs/06-evidence-and-verification/CAPACITY_CONCURRENCY_EVIDENCE.md`.

### `INV-CAP-002`: Authoritative Capacity RPC
* **Statement:** Client and API route pre-checks are strictly advisory. The database RPC transaction (`bus_increment_capacity`) executes the authoritative seat check with row-level locks (`FOR UPDATE`).

### `INV-CAP-003`: Atomic Student Reassignment
* **Statement:** Reassigning students across buses is all-or-nothing, locks both buses in deterministic order to prevent deadlocks, and verifies available seats.
* **Authoritative Boundary:** PostgreSQL RPC `reassign_students_atomically(JSONB)`.

### `INV-CAP-004`: Rollback Safety
* **Statement:** Reassignment rollback restores source bus capacity and decrements destination bus capacity transactionally.
* **Authoritative Boundary:** PostgreSQL RPC `execute_reassignment_rollback`.

### `INV-CAP-005`: Duplicate Application Prevention
* **Statement:** Concurrent renewal or registration requests for the same student and year are rejected by database partial index.

---

## 7. Database & Schema Invariants

### `INV-DB-001`: Schema Reproducibility
* **Statement:** A clean database built from `COMPLETE_SCHEMA.sql` must produce the identical table structure, indexes, and constraints as the cumulative migration chain.
* **Verification Proof:** Schema reconciliation in `20260916000002_reconcile_schema_drift.sql` and `20260916000003_fix_renewal_and_reassign_invariants.sql`.

### `INV-DB-002`: RPC Signature Parity
* **Statement:** All PostgreSQL RPC function signatures must match TypeScript invocation argument names, order, and data types with zero drift.

### `INV-DB-003`: SECURITY DEFINER Execution Hardening
* **Statement:** All `SECURITY DEFINER` functions in PostgreSQL must specify `SET search_path = public`, revoke execution permissions from `public`, `anon`, and `authenticated`, and grant execution exclusively to `service_role`.

### `INV-DB-004`: Service-Role Perimeter Authorization
* **Statement:** Every API route invoking Supabase `service_role` must explicitly authenticate the caller and verify resource ownership.

---

## 8. Cron & Scheduled Execution Invariants

### `INV-CRON-001`: Cron Endpoint Authentication
* **Statement:** Scheduled cron routes (`/api/cron/*`) can only be executed by requests supplying the authoritative `CRON_SECRET` in the `Authorization: Bearer <secret>` header.
* **Authoritative Boundary:** `src/lib/security/cron-auth.ts`.

### `INV-CRON-002`: Overlapping Cron Safety
* **Statement:** Concurrent execution of the same cron job must be safely idempotent and transactionally non-destructive.
* **Authoritative Boundary:** Database locks (`cleanup_stale_locks`) and idempotent conditional queries (`WHERE expires_at < NOW()`).

### `INV-CRON-003`: Partial Failure Recovery
* **Statement:** Transient failure of external services (FCM push, email) during cron sweeps must not prevent remaining batch items from completing.

---

## 9. Notification Invariants

### `INV-NOTIF-001`: Recipient Authorization
* **Statement:** Notifications and FCM messages are dispatched exclusively to the intended user's registered device tokens.

### `INV-NOTIF-002`: Duplicate Notification Prevention
* **Statement:** Repeated events (e.g. repeated GPS ticks or retried webhooks) do not trigger duplicate student notifications.

### `INV-NOTIF-003`: Invalid FCM Token Cleanup
* **Statement:** When Firebase FCM responds with `messaging/registration-token-not-registered`, the token is pruned from `fcm_tokens` to prevent future deliverability degradation.

### `INV-NOTIF-004`: Read-State Concurrency
* **Statement:** Concurrent mark-as-read requests from multiple tabs are idempotent and safe.

---

## 10. Cryptographic Invariants

### `INV-CRYPTO-001`: Strong Token Generation
* **Statement:** Bus pass QR codes and payment reference tokens use authenticated encryption (`AES-256-GCM` with 128-bit authentication tags and unique IVs).
* **Authoritative Boundary:** `src/lib/security/encryption.service.ts`.

### `INV-CRYPTO-002`: Legacy Token Policy
* **Statement:** Version 1 legacy tokens are validated with explicit backward compatibility checks and scheduled for strict deprecation.

### `INV-CRYPTO-003`: Node-Local Key Caching & Safe Rotation
* **Statement:** Cryptographic keys loaded from environment variables are validated at boot. Key rotation invalidates local cryptographic caches.

---

## 11. Infrastructure & Deployment Invariants

### `INV-INFRA-001`: Trusted Proxy Boundary
* **Statement:** Forwarding headers are only trusted from the controlled NGINX proxy boundary.

### `INV-INFRA-002`: Zero Direct Exposure of Internal Services
* **Statement:** Internal application services (Next.js port 3000, WS ports 3001/3003, Redis port 6379, Prometheus port 9090, Grafana port 3002) are bound strictly to `127.0.0.1` or internal Docker networks. Only ports 80 and 443 on NGINX are exposed publicly.
* **Authoritative Boundary:** `docker-compose.prod.yml` network and port mappings.

### `INV-INFRA-003`: Redis Authentication
* **Statement:** Production Redis instances require password authentication (`requirepass`) configured via environment variables.

### `INV-INFRA-004`: Operational Observability
* **Statement:** Critical operational failures (Redis disconnects, payment capture errors, role revocation errors, DB connection pool depletion) emit structured telemetry metrics to Prometheus.
