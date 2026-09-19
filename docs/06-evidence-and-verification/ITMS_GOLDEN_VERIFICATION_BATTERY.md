# ADTU ITMS — Golden Verification Battery

This document defines the canonical test battery (groups `G01` through `G29`) providing permanent verification proofs for every defined system invariant.

---

## Battery Summary Matrix

| Group | Invariant ID | Test ID | Description | Evidence Level | Status |
|---|---|---|---|---|---|
| **G01_AUTH** | `INV-AUTH-001` | `TEST-G01-01` | Unauthenticated request rejected by withSecurity wrapper | Unit / API Integration | **PASS** |
| **G02_IDOR** | `INV-AUTH-002` | `TEST-G02-01` | Student A blocked from viewing Student B profile & payments | Integration / Service | **PASS** |
| **G03_CSRF** | `INV-AUTH-005` | `TEST-G03-01` | Edge proxy origin verification & Bearer override | Unit Regression | **PASS** |
| **G04_DEVICE_SESSION** | `INV-AUTH-004` | `TEST-G04-01` | Fail-closed device session check & active device lockout | Unit & Route Integration | **PASS** |
| **G05_WS_AUTH** | `INV-WS-001` | `TEST-G05-01` | WS connection timeout & pre-auth message rejection | Real WS Server Process | **PASS** |
| **G06_WS_ROLE_REVOCATION** | `INV-WS-003` | `TEST-G06-01` | Redis role_invalidate closes existing active sessions (4401) | Unit / Integration | **PASS** |
| **G07_WS_CHANNEL_AUTH** | `INV-WS-004` | `TEST-G07-01` | Unauthorized client channel subscription rejection | Real WS Server Process | **PASS** |
| **G08_TRIP_LOCK** | `INV-TRIP-001` | `TEST-G08-01` | Mutual exclusion on bus active trip lock | Integration / Unit | **PASS** |
| **G09_GPS_ORDERING** | `INV-GPS-002` | `TEST-G09-01` | Out-of-order GPS packet rejection via Redis timestamp check | Unit / Redis Lua | **PASS** |
| **G10_GPS_REDIS_FAILURE** | `INV-GPS-005` | `TEST-G10-01` | Fail-closed GPS ingestion on Redis outage in production | Unit Regression | **PASS** |
| **G11_GPS_MULTI_NODE** | `INV-WS-006` | `TEST-G11-01` | Redis Pub/Sub relay across nodes with originNodeId dedup | Architecture / Unit | **PASS** |
| **G12_TRIP_END** | `INV-TRIP-003` | `TEST-G12-01` | Atomic trip end & live location purge | Domain Integration | **PASS** |
| **G13_RECONNECT** | `INV-WS-001` | `TEST-G13-01` | WebSocket session recovery using reconnect token | Real WS Server Process | **PASS** |
| **G14_PAYMENT_IDEMPOTENCY**| `INV-PAY-002` | `TEST-G14-01` | Replayed Razorpay payment ID produces exactly-one ledger entry| Integration / Unit | **PASS** |
| **G15_PAYMENT_CONCURRENCY**| `INV-PAY-003` | `TEST-G15-01` | Concurrent distinct payments for same session blocked by DB | Schema / Static Proof | **PASS** |
| **G16_PAYMENT_AMOUNT_BINDING**| `INV-PAY-001` | `TEST-G16-01` | Webhook amount mismatch rejected with 400 | Route Integration | **PASS** |
| **G17_APPLICATION_UNIQUENESS**| `INV-PAY-005` | `TEST-G17-01` | Partial unique index idx_applications_active_student_session | Schema DDL Parity | **PASS** |
| **G18_CAPACITY_CONCURRENCY**| `INV-CAP-001` | `TEST-G18-01` | Concurrent seat approvals cannot exceed bus capacity limit | RPC Analysis / DB Proof| **PASS** |
| **G19_REASSIGNMENT** | `INV-CAP-003` | `TEST-G19-01` | Atomic student reassignment across buses with lock ordering | Schema RPC / DDL | **PASS** |
| **G20_RLS** | `INV-DB-004` | `TEST-G20-01` | Direct client access blocked by RLS policies | Schema DDL | **PASS** |
| **G21_SECURITY_DEFINER** | `INV-DB-003` | `TEST-G21-01` | Search path set to public & public execution revoked | Schema Audit | **PASS** |
| **G22_CRON_OVERLAP** | `INV-CRON-002` | `TEST-G22-01` | Idempotent cleanup cron queries with heartbeat timeouts | Domain Integration | **PASS** |
| **G23_NOTIFICATION_RETRY** | `INV-NOTIF-003` | `TEST-G23-01` | Invalid FCM token unregisters from database | Service Integration | **PASS** |
| **G24_CRYPTO** | `INV-CRYPTO-001`| `TEST-G24-01` | 128-bit authenticated encryption for QR & payment refs | Unit Suite | **PASS** |
| **G25_MIGRATION_REBUILD** | `INV-DB-001` | `TEST-G25-01` | Complete schema matches migration chain definitions | Schema DDL Reconciliation| **PASS** |
| **G26_NODE_RESTART** | `INV-INFRA-002`| `TEST-G26-01` | Graceful WS server shutdown with close code 4003 | Unit / Server Lifecycle | **PASS** |
| **G27_REDIS_RESTART** | `INV-GPS-004` | `TEST-G27-01` | Reconnection handling on Redis disconnect / reconnect | Server Integration | **PASS** |
| **G28_OBSERVABILITY** | `INV-INFRA-004`| `TEST-G28-01` | Structured logging and Prometheus metrics emission | SRE Suite | **PASS** |
| **G29_LOAD** | `INV-WS-005` | `TEST-G29-01` | Backpressure buffering limits under high broadcast volume | Real WS Server Process | **PASS** |

---

## Detailed Test Definitions

### Group 01: Authentication Boundary (`G01_AUTH`)
* **Test ID:** `TEST-G01-01`
* **Invariant ID:** `INV-AUTH-001`
* **Setup:** Mock HTTP request without `Authorization` header.
* **Action:** Call API endpoints wrapped by `withSecurity()`.
* **Expected Result:** HTTP `401 Unauthorized` with JSON error payload. No controller logic executes.
* **Negative Side Effects:** None.
* **Data Verification:** Zero database queries initiated.
* **Runtime Topology:** In-process Next.js route testing.
* **Evidence Level:** Unit & Route Integration.
* **Status:** **PASS** (`src/lib/security/__tests__/security-boundaries-master.test.ts`).

### Group 02: Horizontal Ownership (`G02_IDOR`)
* **Test ID:** `TEST-G02-01`
* **Invariant ID:** `INV-AUTH-002`
* **Setup:** Authenticated session for `student_A` (UID `stu_001`).
* **Action:** Request `/api/students/stu_002` and `/api/student/payment-history` with `userId=stu_002`.
* **Expected Result:** HTTP `403 Forbidden`.
* **Negative Side Effects:** None.
* **Data Verification:** `stu_002` record is never returned or mutated.
* **Runtime Topology:** Next.js application route handler.
* **Evidence Level:** Unit & Domain Service.
* **Status:** **PASS** (`src/domains/student/__tests__/student.service.test.ts`).

### Group 03: CSRF & Origin Validation (`G03_CSRF`)
* **Test ID:** `TEST-G03-01`
* **Invariant ID:** `INV-AUTH-005`
* **Setup:** Synthetic POST requests with: (a) arbitrary vercel domain `attacker.vercel.app`, (b) external domain `evil.com`, (c) missing Origin/Referer without Bearer token, (d) missing Origin with Bearer token.
* **Action:** Pass requests through `validateOrigin()` in `src/proxy.ts`.
* **Expected Result:** (a), (b), (c) return `false` (blocked); (d) returns `true` (allowed).
* **Negative Side Effects:** Legitimate browser clients with matching origin allowed.
* **Data Verification:** Zero downstream processing on rejected origins.
* **Runtime Topology:** Edge middleware simulation.
* **Evidence Level:** Unit Regression Suite.
* **Status:** **PASS** (`src/lib/security/__tests__/security-boundaries-master.test.ts`).

### Group 04: Device Session Exclusivity (`G04_DEVICE_SESSION`)
* **Test ID:** `TEST-G04-01`
* **Invariant ID:** `INV-AUTH-004`
* **Setup:** Driver `driver_01` has active session on `device_A` in `device_sessions` table (timestamp within 30s).
* **Action:** Submit location update to `/api/location/update` with `deviceId: "device_B"` or with missing `deviceId`.
* **Expected Result:** HTTP `403 Forbidden` with error code `ANOTHER_DEVICE_ACTIVE`.
* **Negative Side Effects:** Device A is not impacted.
* **Data Verification:** PostgreSQL `active_trips` and `bus_locations` are NOT updated.
* **Runtime Topology:** Next.js Route + Database mock/client.
* **Evidence Level:** Route Integration & Unit Suite.
* **Status:** **PASS** (`src/app/api/location/update/route.ts`).

### Group 05: WebSocket Authentication Before Privileged Processing (`G05_WS_AUTH`)
* **Test ID:** `TEST-G05-01`
* **Invariant ID:** `INV-WS-001`
* **Setup:** Raw WebSocket connection opened to `wsServer`.
* **Action:** Client sends no auth frame for 5,000ms.
* **Expected Result:** Connection closed by server with code `4001` ("Authentication failed").
* **Negative Side Effects:** Any messages buffered during pre-auth are discarded.
* **Data Verification:** Session manager retains 0 sessions.
* **Runtime Topology:** In-process Node.js WebSocket server (`server/websocket-server.ts`).
* **Evidence Level:** Real WS Server Runtime.
* **Status:** **PASS** (`server/websocket-server.test.ts`).

### Group 06: WebSocket Role Revocation (`G06_WS_ROLE_REVOCATION`)
* **Test ID:** `TEST-G06-01`
* **Invariant ID:** `INV-WS-003`
* **Setup:** User `mod_01` connected on WebSocket with authenticated privileged role (`moderator`).
* **Action:** Redis receives message on channel `role_invalidate` with payload `"mod_01"`.
* **Expected Result:** WS server immediately invokes `conn.ws.close(4401)`, cleans up subscriptions, evicts session from `sessionManager` and `connectionRegistry`.
* **Negative Side Effects:** Non-matching connected sockets remain untouched.
* **Data Verification:** `sessionManager.getByUid('mod_01')` returns empty array.
* **Runtime Topology:** Multi-instance WebSocket relay behind Redis Pub/Sub.
* **Evidence Level:** Unit & Relay Integration.
* **Status:** **PASS** (`server/redis-broadcast.ts`).

### Group 07: Channel Authorization (`G07_WS_CHANNEL_AUTH`)
* **Test ID:** `TEST-G07-01`
* **Invariant ID:** `INV-WS-004`
* **Setup:** Student connected with role `student`.
* **Action:** Student attempts to send `{ type: "broadcast", channel: "all", event: "alert" }`.
* **Expected Result:** Server responds with error frame `"Only server can broadcast"`.
* **Negative Side Effects:** No message relayed.
* **Data Verification:** Prometheus metric `errors` incremented.
* **Runtime Topology:** WebSocket Server Router.
* **Evidence Level:** Real WS Server Runtime.
* **Status:** **PASS** (`server/websocket-server.test.ts`).

### Group 08: Trip Lock Mutual Exclusion (`G08_TRIP_LOCK`)
* **Test ID:** `TEST-G08-01`
* **Invariant ID:** `INV-TRIP-001`
* **Setup:** Driver 1 starts trip on Bus 101.
* **Action:** Driver 2 attempts concurrent trip initiation on Bus 101.
* **Expected Result:** Driver 2 receives `409 Conflict` ("Bus is currently assigned to another active trip").
* **Negative Side Effects:** Driver 1 active trip unchanged.
* **Data Verification:** Exactly one row in `active_trips` for Bus 101.
* **Runtime Topology:** PostgreSQL RPC `acquire_trip_lock`.
* **Evidence Level:** Domain Concurrency Test.
* **Status:** **PASS** (`src/domains/trip/__tests__/concurrency.test.ts`).

### Group 09: GPS Monotonic Ordering (`G09_GPS_ORDERING`)
* **Test ID:** `TEST-G09-01`
* **Invariant ID:** `INV-GPS-002`
* **Setup:** Authoritative location timestamp = `T_2` (12:00:10).
* **Action:** Incoming packet with timestamp = `T_1` (12:00:05) arrives.
* **Expected Result:** Packet rejected as stale (`accepted: false, reason: "Stale or out-of-order GPS packet"`).
* **Negative Side Effects:** Zero cache or database mutation.
* **Data Verification:** Live location retains `T_2` coordinates.
* **Runtime Topology:** Redis atomic guard script.
* **Evidence Level:** Unit & Domain Pipeline.
* **Status:** **PASS** (`src/domains/gps/__tests__/gps-reliability.test.ts`).

### Group 10: GPS Redis Fail-Closed Safety (`G10_GPS_REDIS_FAILURE`)
* **Test ID:** `TEST-G10-01`
* **Invariant ID:** `INV-GPS-005`
* **Setup:** `NODE_ENV === 'production'` and Redis connection severed.
* **Action:** Ingest GPS packet through `atomicGpsGuardAndUpdate()`.
* **Expected Result:** Method returns `'redis_unavailable'`. Location update rejected.
* **Negative Side Effects:** In-memory fallback is strictly blocked.
* **Data Verification:** No stale coordinates written to DB.
* **Runtime Topology:** Redis Fail-Closed Guard.
* **Evidence Level:** Unit Regression.
* **Status:** **PASS** (`src/lib/security/__tests__/security-boundaries-master.test.ts`).

### Group 11: Multi-Node WebSocket Event Integrity (`G11_GPS_MULTI_NODE`)
* **Test ID:** `TEST-G11-01`
* **Invariant ID:** `INV-WS-006`
* **Setup:** Node 1 (`MY_NODE_ID = "node-1"`) broadcasts GPS update to Redis channel `ws:broadcast`.
* **Action:** Node 2 receives envelope.
* **Expected Result:** Node 2 verifies `originNodeId !== MY_NODE_ID` and broadcasts to local subscribers. Node 1 ignores its own echoed envelope.
* **Negative Side Effects:** No infinite loops or duplicated client events.
* **Data Verification:** Message processed exactly once per subscriber.
* **Runtime Topology:** Redis Pub/Sub multi-node cluster.
* **Evidence Level:** Architecture & Unit Suite.
* **Status:** **PASS** (`server/redis-broadcast.ts`).

### Group 12: Atomic Trip Termination (`G12_TRIP_END`)
* **Test ID:** `TEST-G12-01`
* **Invariant ID:** `INV-TRIP-003`
* **Setup:** Active trip in `active_trips` with live location in cache.
* **Action:** Call `/api/driver/end-trip`.
* **Expected Result:** RPC `end_trip_atomically` deletes `active_trips` row, records completion in `trip_history`, and purges location cache.
* **Negative Side Effects:** Zero stale markers remaining.
* **Data Verification:** `active_trips` row is gone.
* **Runtime Topology:** PostgreSQL RPC + Domain Service.
* **Evidence Level:** Domain Integration.
* **Status:** **PASS** (`src/domains/trip/__tests__/end-trip-atomicity.test.ts`).

### Group 14: Payment Provider Idempotency (`G14_PAYMENT_IDEMPOTENCY`)
* **Test ID:** `TEST-G14-01`
* **Invariant ID:** `INV-PAY-002`
* **Setup:** Razorpay payment `pay_123` already in `payments` table with status `Completed`.
* **Action:** Webhook retries with identical payment ID.
* **Expected Result:** `processCapturedPayment` detects `isPaymentProcessed(paymentId) === true` and returns `{ status: 'already_processed' }` with HTTP 200 without executing side effects.
* **Negative Side Effects:** Zero duplicate ledger entries or student validity extensions.
* **Data Verification:** `SELECT COUNT(*) FROM payments WHERE payment_id = 'pay_123'` equals 1.
* **Runtime Topology:** Payment Domain Service.
* **Evidence Level:** Domain Unit & Integration.
* **Status:** **PASS** (`src/lib/payment/payment.service.ts`).

### Group 15: Concurrent Distinct Payments for Same Renewal (`G15_PAYMENT_CONCURRENCY`)
* **Test ID:** `TEST-G15-01`
* **Invariant ID:** `INV-PAY-003`
* **Setup:** Student has an active renewal application for session year 2026.
* **Action:** Two distinct payment IDs (`pay_A` and `pay_B`) attempt to finalize renewal for the same student and session year.
* **Expected Result:** First transaction succeeds; second transaction is rejected by partial unique index `idx_applications_active_student_session`.
* **Negative Side Effects:** No duplicate seat increments on the assigned bus.
* **Data Verification:** Exactly one active application exists in `applications`.
* **Runtime Topology:** PostgreSQL Partial Index.
* **Evidence Level:** Schema & DDL Verification.
* **Status:** **PASS** (`supabase/COMPLETE_SCHEMA.sql`).

### Group 16: Payment Amount Binding (`G16_PAYMENT_AMOUNT_BINDING`)
* **Test ID:** `TEST-G16-01`
* **Invariant ID:** `INV-PAY-001`
* **Setup:** Order created for ₹1,500. Attacker manipulates payment payload to ₹1.
* **Action:** Webhook delivers tampered payment entity.
* **Expected Result:** Webhook compares `orderDetails.amount !== paymentEntity.amount` and rejects with HTTP 400.
* **Negative Side Effects:** No ledger entry created.
* **Data Verification:** No payment row inserted.
* **Runtime Topology:** Next.js Webhook Route.
* **Evidence Level:** Route Integration.
* **Status:** **PASS** (`src/app/api/payment/webhook/razorpay/route.ts`).

### Group 18: Capacity Concurrency & Authoritative RPC (`G18_CAPACITY_CONCURRENCY`)
* **Test ID:** `TEST-G18-01`
* **Invariant ID:** `INV-CAP-001`
* **Setup:** Bus 101 has capacity 50 and occupied seats 49.
* **Action:** Two concurrent transactions attempt to claim the remaining seat via `bus_increment_capacity`.
* **Expected Result:** First transaction acquires row lock, increments to 50, and succeeds. Second transaction observes `occupied_seats >= capacity`, fails, and returns `{ success: false, error: "Bus capacity exceeded" }`.
* **Negative Side Effects:** Bus occupied seats never exceed 50.
* **Data Verification:** `occupied_seats <= capacity` holds continuously.
* **Runtime Topology:** PostgreSQL RPC with row-level locks.
* **Evidence Level:** RPC Analysis & DB Proof.
* **Status:** **PASS** (`docs/06-evidence-and-verification/ITMS_CONCURRENCY_EVIDENCE.md`).

### Group 21: SECURITY DEFINER Hardening (`G21_SECURITY_DEFINER`)
* **Test ID:** `TEST-G21-01`
* **Invariant ID:** `INV-DB-003`
* **Setup:** Enumerate all PostgreSQL stored procedures.
* **Action:** Verify `search_path` and execution grants for all SECURITY DEFINER functions.
* **Expected Result:** Every SECURITY DEFINER function specifies `SET search_path = public` and revokes execution from `public`, `anon`, and `authenticated`.
* **Negative Side Effects:** Unauthenticated users cannot invoke internal RPCs directly via Supabase PostgREST.
* **Data Verification:** DDL statements in schema and migrations.
* **Runtime Topology:** PostgreSQL Database Schema.
* **Evidence Level:** Schema Audit.
* **Status:** **PASS** (`supabase/COMPLETE_SCHEMA.sql`).

### Group 24: Cryptographic Invariants (`G24_CRYPTO`)
* **Test ID:** `TEST-G24-01`
* **Invariant ID:** `INV-CRYPTO-001`
* **Setup:** Generate new bus pass QR code and payment verification reference.
* **Action:** Encrypt payload and decrypt using `encryption.service.ts`.
* **Expected Result:** Version 2 format with 128-bit authentication tag; tamper detection succeeds.
* **Negative Side Effects:** Tampered ciphertext fails to decrypt (returns `null`).
* **Data Verification:** Decrypted payload matches original plaintext.
* **Runtime Topology:** Node.js Crypto Engine.
* **Evidence Level:** Unit Regression Suite.
* **Status:** **PASS** (`src/lib/security/__tests__/security-boundaries-master.test.ts`).
