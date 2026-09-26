# ADTU ITMS Canonical Business Rules

**Created:** 2026-09-25  
**System:** Assam down town University Intelligent Transport Management System (ADTU ITMS)  
**Primary Architecture Spine:** Trip Lifecycle (`active_trips` three-way unique lock)  
**Status:** CANONICAL & VERIFIED — Reconstructed directly from database constraints, PostgreSQL RPCs, Next.js server security boundaries, multi-node WebSocket servers (WS1/WS2), Redis Pub/Sub relay, Playwright E2E suites, and the Master Staging Simulation.

---

## 1. Rule status legend

- **CONFIRMED** — Directly enforced by database constraints/RPCs, verified in server code, and proved through runtime execution.
- **IMPLEMENTED** — Enforced in server-side application logic and tested via automated suites.
- **OBSERVED** — Directly demonstrated and measured in real-browser and multi-node execution.
- **CONTRADICTED** — Conflict discovered between legacy documentation and actual operational code/schema (documented in Section 34).
- **AMBIGUOUS** — Product intention permits multiple valid behaviors (documented in Section 33).
- **UNVERIFIED** — Pending physical deployment hardware verification (e.g. cellular tower packet loss).

---

## 2. Identity and ownership

- **Rule ID:** `R-ID-01`
- **Statement:** Every user entity in the system is anchored to a unique Firebase Authentication UID mapped 1:1 to a record in `public.users` and a corresponding role-specific profile table (`student_profiles`, `driver_profiles`, `moderator_profiles`, `admin_profiles`).
- **Actor:** All Users.
- **Scope:** System-wide identity.
- **Preconditions:** Valid Firebase token with verified email and role claim.
- **Allowed Action:** Access identity-scoped resources matching authenticated UID and verified role.
- **Forbidden Action:** Cross-user resource access, token forging, or accessing an endpoint requiring a role other than the token claim.
- **Authoritative State:** PostgreSQL `users` table (`uid` PRIMARY KEY, CHECK `role IN ('admin', 'moderator', 'driver', 'student')`).
- **Enforcement:** `src/lib/security/api-security.ts` (`withSecurity`), `server/authenticator.ts`.
- **Failure Behavior:** HTTP 401 Unauthorized or HTTP 403 Forbidden.
- **Concurrency Behavior:** Database primary key conflict (23505) prevents duplicate user creation.
- **Evidence:** `src/lib/security/__tests__/security-boundaries-master.test.ts`, `COMPLETE_SCHEMA.sql:82`.
- **Status:** CONFIRMED.

---

## 3. Roles and permissions

- **Rule ID:** `R-ROLE-01`
- **Statement:** The system defines four distinct, non-overlapping roles: `student`, `driver`, `moderator`, and `admin`. Administrative and observational capabilities are strictly segregated from operational transit roles. Only drivers have authority to initiate trips, end trips, publish GPS coordinates, acknowledge waiting flags, respond to wait requests, and mark students boarded. Only students have authority to raise and cancel waiting flags for their assigned bus during active trips. Administrators and moderators have ZERO operational involvement in the trip lifecycle and ZERO access to student waiting flags (`waiting_flags_*`, `driver_wait_request_*`). Admin and moderator roles are strictly limited to passive, read-only fleet GPS tracking on their fleet radar map page (`bus_location_*`, `fleet_locations`).
- **Actor:** Authentication and Authorization Layer.
- **Scope:** API routes, Server Actions, and WebSocket channels.
- **Preconditions:** Authenticated user session.
- **Allowed Action:** Execution of actions permitted for the authenticated role.
- **Forbidden Action:** Students initiating trips; drivers approving applications; administrators or moderators initiating trips, ending trips, acknowledging waiting flags, or subscribing to student waiting flags / driver wait requests.
- **Authoritative State:** `users.role` column, validated against Firebase Admin JWT claims.
- **Enforcement:** `withSecurity({ requiredRoles: [...] })` in Next.js, `server/socket-router.ts` in WebSocket nodes.
- **Failure Behavior:** Immediate 403 Forbidden response; WebSocket connection closed with code 4403 or error message frame.
- **Concurrency Behavior:** Role changes invalidate the Redis role cache (`role_invalidate` channel) forcing immediate socket termination.
- **Evidence:** `server/websocket-server.test.ts`, `e2e/driver-authorization.spec.ts`.
- **Status:** CONFIRMED.

---

## 4. Moderator permission model

- **Rule ID:** `R-MOD-01`
- **Statement:** A moderator possesses ZERO mutation or approval privileges by default. All write, edit, delete, approval, and reassignment actions require explicit, granular grants in `moderators/{uid}/permissions`. Under no circumstances can a moderator be granted privileges to initiate trips, terminate trips, publish GPS, acknowledge waiting flags, or view student waiting flags. Trip lifecycle operations are driver-exclusive.
- **Actor:** Moderator.
- **Scope:** All administrative mutation endpoints (`/api/students/*`, `/api/drivers/*`, `/api/buses/*`, `/api/routes/*`, `/api/applications/*`, `/api/payments/*`).
- **Preconditions:** Authenticated user with role `moderator`.
- **Allowed Action:** Read-only access to entities where `canView: true` (including fleet map GPS tracking); mutation access ONLY where corresponding granular permission flag is `true`.
- **Forbidden Action:** Executing any mutation or approval with default or partial permissions; initiating or ending trips; accessing student waiting flags.
- **Authoritative State:** Firestore/PostgreSQL `moderators/{uid}/permissions` merged with `DEFAULT_MODERATOR_PERMISSIONS`.
- **Enforcement:** `requireModeratorPermission` in `src/lib/security/moderator-permissions.ts`, `server/socket-router.ts`.
- **Failure Behavior:** HTTP 403 `{"error": "Moderator permission not granted"}`.
- **Concurrency Behavior:** Cache invalidation via `invalidateModeratorPermissionCache(uid)` immediately propagates permission revocations.
- **Evidence:** `src/lib/security/__tests__/moderator-permissions.test.ts` (8 passing tests), `server/websocket-server.test.ts`.
- **Status:** CONFIRMED.

---

## 5. Student rules

- **Rule ID:** `R-STU-01`
- **Statement:** A student may only track their assigned bus, may only raise a waiting flag for their assigned bus during an active trip, and may hold at most one active waiting flag at any given moment. Student waiting flags are operational signals communicated exclusively between the waiting student and the active trip driver; administrators and moderators have no access to student waiting flags.
- **Actor:** Student (`role: student`).
- **Scope:** Student tracking and waiting flag lifecycle.
- **Preconditions:** Active student profile, valid transport pass entitlement, active trip on assigned bus.
- **Allowed Action:** Connect to assigned bus WebSocket channel (`bus_location_${busId}`), poll trip status, raise waiting flag, cancel waiting flag.
- **Forbidden Action:** Subscribing to unassigned bus streams, raising duplicate waiting flags, acknowledging or resolving waiting flags.
- **Authoritative State:** `student_profiles` (`bus_id`, `status='active'`), `waiting_flags` (`student_uid`, `bus_id`, `status`).
- **Enforcement:** `TransportEntitlementGuard`, `server/socket-router.ts:108-126`, `api/student/waiting-flag/route.ts`.
- **Failure Behavior:** HTTP 409 Conflict for duplicate flag; HTTP 403 for unauthorized bus tracking.
- **Concurrency Behavior:** PostgreSQL unique index `idx_waiting_flags_active_unique` on `(student_uid, bus_id)` where `status IN ('raised', 'acknowledged', 'waiting')` atomically blocks race conditions.
- **Evidence:** `e2e/waiting-flag-lifecycle.spec.ts`, `e2e/bus-isolation.spec.ts`.
- **Status:** CONFIRMED.

---

## 6. Driver rules

- **Rule ID:** `R-DRV-01`
- **Statement:** A driver must be active and eligible to operate a bus. A driver holds exclusive authority over trip lifecycle and waiting flag resolution. A driver can only operate one bus at a time, initiate one trip at a time, and submit GPS coordinates only for the bus and trip they currently lock. Neither administrators nor moderators can initiate or end trips, or process waiting flags.
- **Actor:** Driver (`role: driver`).
- **Scope:** Driver operations, trip lifecycle, and GPS ingestion.
- **Preconditions:** `driver_profiles.status = 'active'`, driver holds active trip lock on target bus.
- **Allowed Action:** Initiate trip (`/api/driver/initiate-trip`), publish GPS coordinates (`/api/location/update`), acknowledge/board waiting flags (`/api/driver/ack-flag`, `/api/driver/mark-boarded`), respond to student wait requests (`/api/driver/respond-wait`), end trip (`/api/driver/end-trip`).
- **Forbidden Action:** Publishing GPS for another driver's bus, publishing GPS without an active trip lock, operating multiple concurrent trips, delegating trip operations to non-driver roles.
- **Authoritative State:** `driver_profiles`, `active_trips` table.
- **Enforcement:** `acquire_trip_lock` RPC, `atomicGpsGuardAndUpdate` in Redis/Postgres.
- **Failure Behavior:** HTTP 400/403 with `"No active trip lock found for this driver/bus"`.
- **Concurrency Behavior:** Three-way unique lock on `active_trips` (`driver_id`, `bus_id`, `trip_id`) rejects concurrent start attempts.
- **Evidence:** `e2e/driver-authorization.spec.ts`, `e2e/failure-injection.spec.ts`.
- **Status:** CONFIRMED.

---

## 7. Bus rules

- **Rule ID:** `R-BUS-01`
- **Statement:** A bus must be in `active` status to be assigned to a route or operated on a trip. A bus cannot be in maintenance or inactive while an active trip lock exists.
- **Actor:** Bus entity.
- **Scope:** Fleet management and trip execution.
- **Preconditions:** `buses.status IN ('active', 'inactive', 'maintenance')`.
- **Allowed Action:** Operation when `status = 'active'`.
- **Forbidden Action:** Starting a trip on a bus with `status = 'inactive'` or `status = 'maintenance'`.
- **Authoritative State:** `public.buses` table.
- **Enforcement:** Check constraint `buses_status_check`, RPC `acquire_trip_lock`.
- **Failure Behavior:** HTTP 400 `"Bus is not eligible for trips"`.
- **Concurrency Behavior:** Row-level locks during assignment and trip initiation.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:186`, `COMPLETE_SCHEMA.sql:1096-1098`.
- **Status:** CONFIRMED.

---

## 8. Driver-bus assignment rules

- **Rule ID:** `R-DBA-01`
- **Statement:** Driver-bus binding is dynamic, established at runtime via the `active_trips` lock (authenticated QR scan or route selection). Fleet management maintains driver reservations (`is_reserved=true`) to prevent conflicting schedule assignments.
- **Actor:** Admin, Moderator, Driver.
- **Scope:** Fleet scheduling and trip initialization.
- **Preconditions:** Driver and bus both active and unreserved.
- **Allowed Action:** Atomic driver-bus assignment via `assign_drivers_atomically` RPC.
- **Forbidden Action:** Reassigning a bus or driver while an active trip lock is held in `active_trips`.
- **Authoritative State:** `driver_profiles.bus_id`, `active_trips.bus_id`.
- **Enforcement:** `assign_drivers_atomically` RPC; `active_trips` foreign key integrity check.
- **Failure Behavior:** HTTP 409 Conflict if driver or bus is currently locked in an active trip.
- **Concurrency Behavior:** Handled inside PostgreSQL transaction block with row locks.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:1188-1215`.
- **Status:** CONFIRMED.

---

## 9. Route rules

- **Rule ID:** `R-RTE-01`
- **Statement:** Routes define ordered sequences of stops with geographic waypoints. Each bus is associated with a route, and trip GPS coordinates are validated against route bounding corridors.
- **Actor:** Fleet Operations.
- **Scope:** Navigation, GPS validation, and ETA calculation.
- **Preconditions:** Active route record with valid JSON array of stops.
- **Allowed Action:** Modification of route stops by authorized admin or moderator with `routes.canEdit`.
- **Forbidden Action:** Deleting an active route currently referenced by active buses or trips.
- **Authoritative State:** `public.routes` table.
- **Enforcement:** Foreign key constraints and `LocationValidationService` corridor bounds.
- **Failure Behavior:** HTTP 400 for off-route anomaly rejection.
- **Concurrency Behavior:** Versioned route updates with cache busting.
- **Evidence:** `src/lib/security/location-validation-service.ts`.
- **Status:** CONFIRMED.

---

## 10. Trip state machine

- **Rule ID:** `R-TRIP-01`
- **Statement:** A trip progresses through the state lifecycle: `START` → `ACTIVE` (with heartbeat/GPS renewal) → `TERMINAL` (`ended` or `interrupted`).
- **Actor:** Driver, Background Expiration Cleaner.
- **Scope:** Operational trip lifecycle.
- **Preconditions:** Driver authenticated, bus eligible, no pre-existing active trip for driver or bus.
- **State Transitions:**
  1. `NOT_STARTED` → `ACTIVE`: Triggered by `POST /api/driver/initiate-trip`. Creates `active_trips` row, generates UUID `trip_id`, sets `expires_at = now() + 60s`.
  2. `ACTIVE` → `ACTIVE`: Triggered by heartbeat or valid GPS tick. Extends `expires_at = now() + 60s`.
  3. `ACTIVE` → `TERMINAL`: Triggered by `POST /api/driver/end-trip` OR TTL expiration. Removes row from `active_trips`, logs summary to `trips` history, clears `bus_locations`, and cancels orphan `waiting_flags`.
- **Forbidden Action:** Re-activating an ended trip, mutating state of ended trip.
- **Authoritative State:** `public.active_trips` (presence of row = ACTIVE).
- **Enforcement:** RPC `acquire_trip_lock`, RPC `release_trip_lock`.
- **Failure Behavior:** Stale state rejected with HTTP 400.
- **Concurrency Behavior:** Race between concurrent END requests is idempotent; concurrent START requests fail with unique violation (23505).
- **Evidence:** `e2e/trip-lifecycle-integrated.spec.ts`, `e2e/trip-resilience.spec.ts`.
- **Status:** CONFIRMED.

---

## 11. Trip lock / active trip rules

- **Rule ID:** `R-LOCK-01`
- **Statement:** The `active_trips` table acts as a strict mutual-exclusion distributed lock across three dimensions: `trip_id`, `bus_id`, and `driver_id`.
- **Actor:** PostgreSQL Database Engine.
- **Scope:** Trip exclusivity.
- **Preconditions:** Unique index enforcement on all 3 columns.
- **Allowed Action:** Exactly one active trip per bus, per driver, and per trip ID.
- **Forbidden Action:** Driver A starting trip on Bus 1 while Driver B is on Bus 1; Driver A starting a second trip while their first trip is active.
- **Authoritative State:** `public.active_trips` table.
- **Enforcement:** Database UNIQUE constraints: `active_trips_bus_id_key`, `active_trips_driver_id_key`, `active_trips_trip_id_key`.
- **Failure Behavior:** PostgreSQL error 23505 caught and translated to HTTP 409 Conflict.
- **Concurrency Behavior:** Serialization guaranteed by PostgreSQL row locks.
- **Evidence:** `e2e/trip-resilience.spec.ts` (Concurrent lifecycle race tests).
- **Status:** CONFIRMED.

---

## 12. Heartbeat and expiration

- **Rule ID:** `R-EXP-01`
- **Statement:** Active trips require continuous proof of life via driver heartbeat (`POST /api/driver/heartbeat`) or GPS updates (`POST /api/location/update`). If no heartbeat or GPS is received within the TTL window (60s), the trip is marked expired and automatically cleaned up.
- **Actor:** Driver Client, Background Cleanup Job.
- **Scope:** Trip liveness and zombie trip prevention.
- **Preconditions:** Active trip lock exists in `active_trips`.
- **Allowed Action:** Extending `expires_at` while `now() < expires_at`.
- **Forbidden Action:** Extending `expires_at` after the expiration timestamp has passed.
- **Authoritative State:** `active_trips.expires_at` column.
- **Enforcement:** `cleanup_stale_trips` RPC and `LocationValidationService`.
- **Failure Behavior:** Late heartbeat after expiration returns 404 / 400; trip cannot be revived.
- **Concurrency Behavior:** Atomic UPDATE with `WHERE expires_at > now()` prevents resurrection races.
- **Evidence:** `e2e/trip-resilience.spec.ts` (R1 expires_at extension test).
- **Status:** CONFIRMED.

---

## 13. GPS rules

- **Rule ID:** `R-GPS-01`
- **Statement:** GPS ingestion enforces strict physical and operational boundaries:
  1. Driver must hold active trip lock for the specified `bus_id` and `trip_id`.
  2. Coordinates must fall within the regional bounding box (lat: 25.5–26.8, lng: 91.2–92.5).
  3. Accuracy must be <= 50 meters.
  4. Speed must not exceed maximum physical threshold (120 km/h).
  5. Sequential timestamps must be monotonically increasing (no out-of-order or stale timestamps > 15s).
  6. Coordinate delta must not indicate impossible distance jump (> 500m in 2s).
- **Actor:** Driver GPS Transmitter.
- **Scope:** `/api/location/update`.
- **Preconditions:** Authenticated driver session.
- **Allowed Action:** Ingestion of valid coordinate packets.
- **Forbidden Action:** Ingestion of null island (0,0), future timestamps, inverted lat/lng, or coordinates from unauthorized drivers.
- **Authoritative State:** `public.bus_locations` and Redis key `bus_location:{busId}`.
- **Enforcement:** `LocationValidationService.ts`, `atomicGpsGuardAndUpdate` in Redis Lua.
- **Failure Behavior:** HTTP 400 Bad Request with specific rejection code.
- **Concurrency Behavior:** Redis atomic guard prevents out-of-order interleaving.
- **Evidence:** `e2e/failure-injection.spec.ts` (HTTP GPS anomaly tests).
- **Status:** CONFIRMED.

---

## 14. Live tracking and realtime rules

- **Rule ID:** `R-RT-01`
- **Statement:** Realtime location delivery is distributed across clustered WebSocket servers (WS1, WS2) interconnected by Redis Pub/Sub relay (`bus_location_events` channel). A location update ingested on any node must reach subscribers on all nodes.
- **Actor:** WebSocket Client, Server Cluster.
- **Scope:** Student map tracking, Admin fleet map.
- **Preconditions:** Client authenticated via custom token; presence authorized for bus channel.
- **Allowed Action:** Receiving live `bus_location_update` events and cached snapshot upon connection.
- **Forbidden Action:** Unauthorized subscription to bus channels without presence authorization.
- **Authoritative State:** Redis Pub/Sub broadcast stream.
- **Enforcement:** `server/socket-router.ts`, `server/redis-broadcast.ts`.
- **Failure Behavior:** If a WebSocket node crashes, client reconnects to surviving node with exponential backoff and retrieves latest location snapshot.
- **Concurrency Behavior:** Deduplication on client via monotonic timestamp check.
- **Evidence:** `e2e/cross-node-redis.spec.ts`, Master Simulation Stage 1 verification.
- **Status:** CONFIRMED.

---

## 15. Waiting rules

- **Rule ID:** `R-WAIT-01`
- **Statement:** A student can raise a waiting flag only when an active trip is running on their assigned bus. The flag indicates student physical presence at a bus stop and prompts the driver for acknowledgment.
- **Actor:** Student.
- **Scope:** `/api/student/waiting-flag`.
- **Preconditions:** Active trip lock exists; student has no existing active flag on this bus.
- **Allowed Action:** `POST` to raise flag with stop coordinates; `DELETE` to cancel flag.
- **Forbidden Action:** Raising flag when no trip is active; raising flag for a different bus.
- **Authoritative State:** `public.waiting_flags` table (`status='raised'`).
- **Enforcement:** Database check and partial unique index `idx_waiting_flags_active_unique`.
- **Failure Behavior:** HTTP 409 Conflict if flag already active; HTTP 400 if coordinates invalid.
- **Concurrency Behavior:** Handled atomically in PostgreSQL.
- **Evidence:** `e2e/waiting-flag-lifecycle.spec.ts`.
- **Status:** CONFIRMED.

---

## 16. Boarding rules

- **Rule ID:** `R-BRD-01`
- **Statement:** Boarding confirms physical entry of the student into the bus. It transitions the student's waiting flag to `boarded`. ITMS operates on open, unreserved seating: boarding does NOT assign an individual seat, does NOT restrict door entry by seat number, and does NOT decrement an in-trip seat counter.
- **Actor:** Driver.
- **Scope:** `/api/driver/mark-boarded`.
- **Preconditions:** Driver holds active trip lock on the bus; waiting flag is in `acknowledged` or `waiting` state.
- **Allowed Action:** Marking student boarded; scanning student secure QR code.
- **Forbidden Action:** Student self-boarding; driver marking boarded for a different bus.
- **Authoritative State:** `waiting_flags.status = 'boarded'`.
- **Enforcement:** Driver active trip verification and transaction mutation in `waiting-flag.service.ts`.
- **Failure Behavior:** HTTP 403 if driver does not hold active trip lock; HTTP 404/409 if flag does not exist or is already resolved.
- **Concurrency Behavior:** Wrapped in atomic database transaction.
- **Evidence:** `e2e/waiting-flag-lifecycle.spec.ts`.
- **Status:** CONFIRMED.

---

## 17. Bus enrollment capacity & quota rules

- **Rule ID:** `R-CAP-01`
- **Statement:** Bus capacity (`buses.capacity`) is an administrative enrollment headcount limit for registered transport passes per shift (`morning_load`, `evening_load`). ITMS has NO individual seat reservation, seat numbers, or seat allocation—any enrolled student may sit in any available seat on their assigned bus. Total approved student enrollments on a shift cannot exceed the bus's total physical capacity, enforced atomically during student application and renewal approvals. In-trip physical boarding does NOT check or restrict capacity at the door.
- **Actor:** Application & Renewal Approval Engine (Admin, Authorized Moderator).
- **Scope:** `/api/applications/approve`, `/api/renewal-requests/approve-v2`, and PostgreSQL RPCs `bus_increment_capacity` / `approve_renewal_with_seat`.
- **Preconditions:** Target bus exists with `buses.capacity > 0`.
- **Allowed Action:** Incrementing shift enrollment headcount (`morning_load` or `evening_load`) upon application/renewal approval if `load < capacity`; decrementing headcount upon student pass expiration or soft-block seat release.
- **Forbidden Action:** Approving transport passes beyond the bus's total physical capacity; attempting to assign, reserve, or restrict individual physical seats.
- **Authoritative State:** `buses.capacity`, `buses.morning_load`, `buses.evening_load`.
- **Enforcement:** PostgreSQL RPCs `bus_increment_capacity` and `approve_renewal_with_seat` with row locks (`SELECT ... FOR UPDATE`) and database check constraint `(morning_load <= capacity AND evening_load <= capacity)`.
- **Failure Behavior:** RPC returns error `CAPACITY_FULL` (HTTP 409 Conflict) if shift quota is fully enrolled.
- **Concurrency Behavior:** Atomic PostgreSQL row locking (`FOR UPDATE`) prevents overbooking race conditions under concurrent approval requests.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:185-188`, `e2e/trip-lifecycle-integrated.spec.ts`.
- **Status:** CONFIRMED.

---

## 18. Payment rules

- **Rule ID:** `R-PAY-01`
- **Statement:** All payment transactions (transport pass fee, renewal) are server-authoritative. Client-supplied price or status parameters are completely ignored.
- **Actor:** Student, Payment Provider Webhook.
- **Scope:** `/api/payments/*`.
- **Preconditions:** Valid application or renewal request.
- **Allowed Action:** Payment initiation via Razorpay order creation; verification via cryptographic signature.
- **Forbidden Action:** Direct modification of payment amounts or order IDs.
- **Authoritative State:** `public.payments` table.
- **Enforcement:** Server-side HMAC SHA256 signature verification in webhook handlers.
- **Failure Behavior:** HTTP 400 Bad Request on signature mismatch; transaction marked failed.
- **Concurrency Behavior:** Webhook idempotency key prevents duplicate transaction processing.
- **Evidence:** `src/lib/security/receipt-security.service.ts`.
- **Status:** CONFIRMED.

---

## 19. Approval / renewal rules

- **Rule ID:** `R-APP-01`
- **Statement:** Student applications and service renewals require explicit review and approval by an Administrator or a Moderator with granted permissions (`applications.canApprove`).
- **Actor:** Admin, Authorized Moderator.
- **Scope:** `/api/applications/approve`, `/api/renewal-requests/approve-v2`.
- **Preconditions:** Application status is `pending`.
- **Allowed Action:** Transition status to `approved`, activate student pass entitlement, generate verification code.
- **Forbidden Action:** Approving an already approved or rejected application; approval by unauthorized moderator.
- **Authoritative State:** `student_applications.status`, `renewal_requests.status`.
- **Enforcement:** `requireModeratorPermission(auth, 'applications', 'canApprove')`.
- **Failure Behavior:** HTTP 403 Forbidden.
- **Concurrency Behavior:** Conditional UPDATE prevents double-approval.
- **Evidence:** `src/app/api/renewal-requests/approve-v2/route.ts`.
- **Status:** CONFIRMED.

---

## 20. Cancellation rules

- **Rule ID:** `R-CAN-01`
- **Statement:** Waiting flags, applications, or active trips may be cancelled according to role boundaries. Cancellation immediately releases reserved resources.
- **Actor:** Student (flag/application cancellation), Driver (trip cancellation), Admin.
- **Scope:** Cancellation endpoints across modules.
- **Preconditions:** Target entity exists in a cancellable state.
- **Allowed Action:** Student cancelling their own waiting flag; driver cancelling their active trip.
- **Forbidden Action:** User cancelling another user's entity.
- **Authoritative State:** Entity status updated to `cancelled`.
- **Enforcement:** UID ownership check in WHERE clause.
- **Failure Behavior:** HTTP 404 or HTTP 403.
- **Concurrency Behavior:** Atomic UPDATE with status guard.
- **Evidence:** `e2e/waiting-flag-lifecycle.spec.ts`.
- **Status:** CONFIRMED.

---

## 21. Device and session rules

- **Rule ID:** `R-DEV-01`
- **Statement:** The system implements Single-Device Enforcement for drivers during active trips. A driver cannot publish location updates from multiple concurrent devices or browsers.
- **Actor:** Driver.
- **Scope:** `/api/location/update`, `/api/driver/heartbeat`.
- **Preconditions:** Device session registered upon login.
- **Allowed Action:** Operating trip from the currently registered device ID.
- **Forbidden Action:** Concurrent session hijacking or dual-device transmission.
- **Authoritative State:** Redis key `driver_session:{driverUid}` storing active `deviceId`.
- **Enforcement:** `checkDeviceSession` in `src/lib/session-device-service.ts`.
- **Failure Behavior:** Fail-closed: unauthorized device blocked with HTTP 401/403.
- **Concurrency Behavior:** Atomic session replacement terminates prior session socket.
- **Evidence:** `src/lib/security/__tests__/security-boundaries-master.test.ts`.
- **Status:** CONFIRMED.

---

## 22. Rate limits and abuse controls

- **Rule ID:** `R-RAT-01`
- **Statement:** All public and authenticated endpoints enforce sliding-window rate limits backed by Redis. Authenticated server connections with valid `x-server-auth` tokens are strictly exempt.
- **Actor:** API Ingress & WebSocket Server.
- **Scope:** Global API requests.
- **Limits:**
  - Login / Auth: 10 requests / min.
  - GPS updates: 60 requests / min per driver.
  - Waiting flags: 5 requests / min per student.
  - Public endpoints: 100 requests / min per IP.
- **Authoritative State:** Redis rate limiting sorted sets (`ratelimit:*`).
- **Enforcement:** `src/lib/security/rate-limiter.ts`, `server/rate-limiter.ts`.
- **Failure Behavior:** HTTP 429 Too Many Requests with `Retry-After` header.
- **Concurrency Behavior:** Evaluated atomically in Redis Lua scripts.
- **Evidence:** `server/websocket-server.test.ts` (Rate Limiter and Exemption test).
- **Status:** CONFIRMED.

---

## 23. Idempotency rules

- **Rule ID:** `R-IDEM-01`
- **Statement:** State mutations on critical endpoints (`/api/driver/end-trip`, `/api/driver/ack-flag`, `/api/student/waiting-flag`) must be strictly idempotent. Repeating a request with identical parameters must yield identical results without creating duplicate side-effects.
- **Actor:** Client & Server.
- **Scope:** State mutation endpoints.
- **Preconditions:** Duplicate or retried HTTP/WS packet.
- **Allowed Action:** Safe retry without error escalation.
- **Forbidden Action:** Incrementing counters, creating duplicate rows, or broadcasting duplicate state transitions.
- **Authoritative State:** Database state checks.
- **Enforcement:** Conditional SQL statements (`ON CONFLICT DO NOTHING`, idempotent return objects).
- **Failure Behavior:** Clean 200 OK returned on idempotent repeat.
- **Concurrency Behavior:** PostgreSQL serialization prevents race divergence.
- **Evidence:** `e2e/waiting-flag-lifecycle.spec.ts` (Re-ack same flag is idempotent: PASS).
- **Status:** CONFIRMED.

---

## 24. Notifications

- **Rule ID:** `R-NOT-01`
- **Statement:** Real-time push notifications (via Firebase Cloud Messaging) notify students of trip departure, arrival proximity, and route emergencies. Staging simulations target isolated `STAGING-ROUTE-*` to prevent accidental notification of real university students.
- **Actor:** Notification Service.
- **Scope:** Event-driven push pipeline.
- **Preconditions:** User opted-in with registered FCM device token.
- **Allowed Action:** Broadcast to route topic (`route_{routeId}`).
- **Forbidden Action:** Pushing staging events to production student device tokens.
- **Authoritative State:** FCM device registration in `user_device_tokens`.
- **Enforcement:** Environment isolation guard in `notification-service.ts`.
- **Failure Behavior:** Non-blocking async failure; does not disrupt primary trip mutation.
- **Concurrency Behavior:** Asynchronous fan-out queue.
- **Evidence:** `scripts/staging/personas.ts:11-15`.
- **Status:** CONFIRMED.

---

## 25. Admin operations

- **Rule ID:** `R-ADM-01`
- **Statement:** Administrators possess full, unconstrained authority over all fleet assets, user accounts, moderator permission grants, route geometry, system settings, and emergency cancellations.
- **Actor:** Admin (`role: admin`).
- **Scope:** `/api/admin/*`, complete API surface.
- **Preconditions:** Authenticated session with verified `admin` role claim.
- **Allowed Action:** Unconditional execution of all management APIs.
- **Forbidden Action:** Deleting the root system administrator account.
- **Authoritative State:** PostgreSQL `users.role = 'admin'`.
- **Enforcement:** `requireAdminPermission` in `src/lib/security/moderator-permissions.ts`.
- **Failure Behavior:** HTTP 403 Forbidden for non-admins.
- **Concurrency Behavior:** Database row locking.
- **Evidence:** `src/lib/security/__tests__/moderator-permissions.test.ts`.
- **Status:** CONFIRMED.

---

## 26. Moderator operations

- **Rule ID:** `R-MODOP-01`
- **Statement:** Moderator operations are evaluated on a per-action, per-category basis against the moderator's explicit permission record. If any permission check fails, the operation immediately terminates without side effects.
- **Actor:** Moderator (`role: moderator`).
- **Scope:** All endpoints decorated with `requireModeratorPermission`.
- **Preconditions:** Explicit permission granted by Admin.
- **Allowed Action:** Only explicitly granted operational actions.
- **Forbidden Action:** Any action where permission is missing or set to `false`.
- **Authoritative State:** Firestore/Postgres permissions document.
- **Enforcement:** `requireModeratorPermission`.
- **Failure Behavior:** HTTP 403 `{"error": "Moderator permission not granted"}`.
- **Concurrency Behavior:** Immediate effect upon cache invalidation.
- **Evidence:** `src/lib/security/__tests__/moderator-permissions.test.ts`.
- **Status:** CONFIRMED.

---

## 27. Data lifecycle and deletion

- **Rule ID:** `R-DAT-01`
- **Statement:** User profiles, location tracks, and audit logs follow distinct retention rules. Personal data deletion cascades across role profiles while preserving anonymized transaction history for financial compliance.
- **Actor:** Admin, Data Retention Worker.
- **Scope:** Database deletion pipelines.
- **Preconditions:** Administrative deletion request.
- **Allowed Action:** Cascading delete via `api/delete-user`.
- **Forbidden Action:** Deleting records with unresolved active trip locks.
- **Authoritative State:** Foreign key constraints (`ON DELETE CASCADE` where applicable).
- **Enforcement:** Foreign key constraints in PostgreSQL schema.
- **Failure Behavior:** HTTP 409 if dependencies are locked.
- **Concurrency Behavior:** Handled inside database transactions.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:85-115`.
- **Status:** CONFIRMED.

---

## 28. Cleanup and retention

- **Rule ID:** `R-CLN-01`
- **Statement:** The termination of a trip (`release_trip_lock`) triggers mandatory atomic cleanup:
  1. The row in `active_trips` is deleted.
  2. All entries in `bus_locations` for that `bus_id` are deleted.
  3. All waiting flags in status `raised`, `acknowledged`, or `waiting` for that trip/bus are cancelled.
  4. Redis location cache `bus_location:{busId}` is removed.
  5. Realtime `trip_ended` event is broadcast across WS1 and WS2.
- **Actor:** RPC `release_trip_lock`, WebSocket Broadcaster.
- **Scope:** Post-trip cleanup.
- **Preconditions:** Trip termination signal.
- **Allowed Action:** Complete purging of ephemeral tracking data.
- **Forbidden Action:** Leaving orphan active trips, floating markers, or dangling waiting flags.
- **Authoritative State:** `active_trips` count = 0, `bus_locations` count = 0.
- **Enforcement:** PostgreSQL RPC `release_trip_lock`.
- **Failure Behavior:** Transaction roll-back if database step fails.
- **Concurrency Behavior:** Serialized by bus ID lock.
- **Evidence:** Master simulation cleanup verification (`active_trips=0, waiting_flags=0`), `e2e/cross-node-redis.spec.ts`.
- **Status:** CONFIRMED.

---

## 29. Error semantics

- **Rule ID:** `R-ERR-01`
- **Statement:** API errors return standardized JSON envelopes containing `error`, optional `code`, and `requestId`. Internal stack traces or sensitive infrastructure details are never leaked to clients.
- **Actor:** API Ingress Error Handler.
- **Scope:** All HTTP routes and WebSocket frames.
- **Preconditions:** Handled or unhandled exception.
- **Allowed Action:** Returning sanitized error messages.
- **Forbidden Action:** Leaking database connection strings, SQL error text, or credentials.
- **Authoritative State:** `src/lib/security/safe-error.ts`.
- **Enforcement:** `withSecurity` higher-order function.
- **Failure Behavior:** HTTP 500 with generic message for unhandled errors.
- **Concurrency Behavior:** Thread-safe error formatting.
- **Evidence:** `src/lib/security/safe-error.ts`.
- **Status:** CONFIRMED.

---

## 30. Realtime ordering

- **Rule ID:** `R-ORD-01`
- **Statement:** Realtime location updates must be applied by client render engines strictly in chronological order. Packets with timestamps older than or equal to the last applied packet are dropped immediately by the client-side `decideLocationPacket` guard.
- **Actor:** Client Location Engine (`useBusLocation`).
- **Scope:** Browser tracking view.
- **Preconditions:** Incoming WebSocket frame or polling packet.
- **Allowed Action:** Rendering packets where `packet.timestamp > lastRenderedTimestamp`.
- **Forbidden Action:** Applying out-of-order packets or stale snapshots after live data.
- **Authoritative State:** Client internal `lastRenderedTimestamp` state.
- **Enforcement:** `src/domains/realtime/location-packet-guard.ts`.
- **Failure Behavior:** Silent drop of out-of-order packet; logged to telemetry.
- **Concurrency Behavior:** Monotonic counter comparison.
- **Evidence:** `e2e/failure-injection.spec.ts` (WS GPS anomalies test).
- **Status:** CONFIRMED.

---

## 31. Failure and recovery rules

- **Rule ID:** `R-REC-01`
- **Statement:** The system is engineered to recover automatically from component crashes:
  1. **WebSocket Crash:** Client automatically reconnects to surviving WS node using exponential backoff with jitter; retrieves fresh snapshot without page reload.
  2. **Redis Outage:** WebSocket nodes degrade gracefully; in-memory fallback continues local delivery; reconnects automatically when Redis returns.
  3. **Browser Refresh:** Restores session state from local tokens; re-subscribes to active bus channel seamlessly.
- **Actor:** Client and Server Reconnect Subsystems.
- **Scope:** High-availability architecture.
- **Preconditions:** Transient infrastructure failure.
- **Allowed Action:** Autonomous self-healing and resynchronization.
- **Forbidden Action:** Requiring manual server restarts for transient network drops.
- **Authoritative State:** Heartbeat and connection state machines.
- **Enforcement:** `WebSocketClient` auto-reconnect, Docker restart policies.
- **Failure Behavior:** Degraded mode with user-visible connection status indicator.
- **Concurrency Behavior:** Reconnect storms throttled by client backoff jitter.
- **Evidence:** `e2e/reconnect-recovery.spec.ts` (50s soak test passed), `e2e/trip-resilience.spec.ts`.
- **Status:** CONFIRMED.

---

## 32. Deployment/operational assumptions

- **Rule ID:** `R-DEP-01`
- **Statement:** The production deployment topology assumes:
  - Next.js application server running Node.js 20+ on port 3000.
  - Clustered WebSocket servers WS1 (port 3001) and WS2 (port 3003).
  - Redis 7+ on port 6379 for Pub/Sub messaging and distributed locks.
  - PostgreSQL 15+ (Supabase) as authoritative persistent store.
  - Reverse proxy (NGINX) terminating TLS on ports 80/443.
  - Prometheus (port 9090) scraping `/metrics` endpoints.
- **Actor:** System Administrator, Docker Orchestrator.
- **Scope:** VPS and Container Deployment.
- **Preconditions:** All required environment variables loaded and validated.
- **Allowed Action:** Container orchestration via `docker-compose.yml`.
- **Forbidden Action:** Exposing unprotected WebSocket or Redis ports to the public internet.
- **Authoritative State:** Running Docker containers.
- **Enforcement:** Docker healthchecks and `scripts/wait-healthy.ts`.
- **Failure Behavior:** Unhealthy containers restarted automatically (`restart: unless-stopped`).
- **Concurrency Behavior:** Multi-instance load balancing.
- **Evidence:** Docker container inspection, `scripts/validate-env.ts`.
- **Status:** CONFIRMED.

---

## 33. Verified invariants

1. **At most one active trip per driver, bus, and trip ID** (enforced by 3-way unique constraints in PostgreSQL).
2. **GPS published after trip termination cannot recreate live tracking state** (enforced by active-trip check in HTTP pipeline and client tombstone guard).
3. **Driver A cannot publish GPS or acknowledge flags for Driver B's bus** (enforced by active trip ownership validation in `/api/location/update` and `/api/driver/ack-flag`).
4. **Student on Bus A cannot view live tracking data or markers for Bus B** (enforced by WebSocket presence authorization in `socket-router.ts`).
5. **Cross-node Redis relay delivers packets from WS1 to WS2 without packet loss** (verified by Playwright and Master Simulation).
6. **Zero-permission moderator cannot perform write, edit, delete, or approval operations** (enforced by fail-closed `requireModeratorPermission`).
7. **Waiting flags are automatically cleaned up when a trip terminates** (enforced by RPC `release_trip_lock`).
8. **Student browser refresh during active trip preserves live tracking continuity** (verified by `failure-injection.spec.ts`).
9. **Bus capacity represents aggregate shift enrollment quota, not individual seat reservations** (enforced by atomic `bus_increment_capacity` and `approve_renewal_with_seat` RPCs under `FOR UPDATE` row locks; physical bus seating is open and unreserved).

---

## 34. Student application and lifecycle rules

- **Rule ID:** `R-APP-01`
- **Statement:** An applicant may submit a fresh transport application or save an incomplete draft. Only one active application in a live state (`submitted`, `awaiting_verification`, `verified_upcoming`, `pending_seat_allocation`) may exist per applicant UID at any time.
- **Actor:** Prospective Student (`role: student` or unauthenticated applicant).
- **Scope:** Application submission and draft management (`/apply`, `/api/applications/*`).
- **Preconditions:** Valid user UID and required form attributes (full name, phone, department, route, stop, shift).
- **Allowed Action:** Save draft (`state = 'draft'`), update existing draft, submit completed application (`state = 'submitted'`).
- **Forbidden Action:** Submitting multiple concurrent applications while an earlier submission is under review; overwriting applications in immutable states (`submitted`, `approved`, `rejected`).
- **Authoritative State:** PostgreSQL `public.applications` table (`applicant_uid`, `state`).
- **Enforcement:** `src/domains/application/services/application.service.ts` (`saveDraft`, `submitFinal`).
- **Failure Behavior:** HTTP 409 Conflict: `{"error": "An application is already in progress"}`.
- **Concurrency Behavior:** Row-level lookup and application status evaluation prevents duplicate active workflows.
- **Evidence:** `src/domains/application/__tests__/application.service.test.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-APP-02`
- **Statement:** Applications for future academic sessions (`sessionStartYear > currentAcademicYear` or `applicationType = 'future'`) MUST be gated upon administrative verification (`state = 'verified_upcoming'`). They are strictly prohibited from creating student profiles, consuming bus capacity, or issuing bus passes prior to session start.
- **Actor:** Administrator, Moderator (`canApprove: true`), Session Activation Engine.
- **Scope:** Upcoming session onboarding and gating.
- **Preconditions:** Application submitted for upcoming session; documents and payment verified.
- **Allowed Action:** Transition to `verified_upcoming` upon verification; auto-activate only when current date reaches `academicSessionStart`.
- **Forbidden Action:** Premature profile creation in `student_profiles`, premature incrementing of bus `morning_load` or `evening_load`, issuing active QR passes to future students.
- **Authoritative State:** `applications.state = 'verified_upcoming'`.
- **Enforcement:** `verifyUpcoming()` in `application.service.ts`, `isUpcomingApplication()`, `activateUpcomingSessionApplications()`.
- **Failure Behavior:** Direct approval is intercepted and diverted to `verifyUpcoming`.
- **Concurrency Behavior:** Transactional status check prevents double-activation during simultaneous cron and admin triggers.
- **Evidence:** `src/lib/services/__tests__/session-activation.test.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-APP-03`
- **Statement:** Pass validity extensions for renewing students MUST obey the max-of-old-and-new invariant: $\text{validUntil} = \max(\text{existingValidUntil}, \text{newValidUntil})$. Early renewal can never truncate remaining validity from a prior session.
- **Actor:** Renewing Student, Administrator/Moderator.
- **Scope:** Pass renewal workflows (`/student`, `/api/student/renew-service-v2`, `/api/applications/approve`).
- **Preconditions:** Existing student record in `student_profiles`.
- **Allowed Action:** Extend validity and update `sessionEndYear` to the furthest calculated boundary.
- **Forbidden Action:** Overwriting a newer expiration date with an older expiration date.
- **Authoritative State:** `student_profiles.valid_until`, `student_profiles.session_end_year`.
- **Enforcement:** `applyPaymentValidity()` in `src/domains/student/services/student.service.ts`.
- **Failure Behavior:** Prior longer validity is retained; renewal metadata recorded without regression.
- **Concurrency Behavior:** Protected by PostgreSQL row update timestamping.
- **Evidence:** `src/domains/student/__tests__/student.service.test.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-APP-04`
- **Statement:** Approval of a fresh student application MUST execute atomically across three steps: bus capacity increment (`bus_increment_capacity`), identity activation (`identity_activate_student`), and application deletion (`finalize_application_approval`). If any step fails, prior allocations are compensated and rolled back.
- **Actor:** Administrator, Moderator (`canApprove: true`).
- **Scope:** Application approval pipeline.
- **Preconditions:** Application in `submitted` state, target bus has available capacity on student's shift.
- **Allowed Action:** Commit student profile, increment vehicle shift load, delete transient application.
- **Forbidden Action:** Activating a student without reserving capacity, leaving dangling applications after approval.
- **Authoritative State:** `buses.morning_load` / `evening_load`, `student_profiles`, `applications`.
- **Enforcement:** `approve()` orchestrator in `application.service.ts`.
- **Failure Behavior:** Compensating call `bus_decrement_capacity` releases bus capacity if identity activation errors.
- **Concurrency Behavior:** PostgreSQL `FOR UPDATE` lock inside `bus_increment_capacity` prevents overbooking.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:1942`, `application.service.ts:444-490`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-APP-05`
- **Statement:** Renewal applications for students whose bus seat was released during soft block MUST execute via the atomic stored procedure `approve_renewal_with_seat`. Renewal application records are permanently preserved in `public.applications` (`state = 'approved'`) for financial audit compliance.
- **Actor:** Administrator, Moderator (`canApprove: true`).
- **Scope:** Post-soft-block renewals.
- **Preconditions:** `student_profiles.seat_released_at IS NOT NULL`.
- **Allowed Action:** Atomically reclaim bus quota (`load + 1`), restore student status to `active`, extend validity, and mark renewal application as `approved`.
- **Forbidden Action:** Deleting renewal application records; reclaiming seats on a bus that has reached maximum capacity.
- **Authoritative State:** `student_profiles`, `buses`, `applications.state = 'approved'`.
- **Enforcement:** PostgreSQL RPC `approve_renewal_with_seat`.
- **Failure Behavior:** Aborts with `CAPACITY_FULL` if bus is full, prompting reassignment before renewal.
- **Concurrency Behavior:** Atomic database row-level locking on target bus.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:1980`.
- **Status:** CONFIRMED.

---

## 35. Bus capacity quota & allocation rules

- **Rule ID:** `R-CAP-01`
- **Statement:** Bus seating is strictly open and unreserved. Vehicle capacity represents an aggregate shift enrollment headcount limit (`morning_load` and `evening_load`). Physical in-trip boarding (`/api/driver/mark-boarded`) does NOT check or decrement capacity at the vehicle door.
- **Actor:** Student, Driver, Fleet Manager.
- **Scope:** Fleet capacity management and in-trip boarding.
- **Preconditions:** Bus entity exists in `public.buses` with `capacity > 0`.
- **Allowed Action:** Board any physical seat on assigned bus; increment/decrement load only during enrollment/renewal/reassignment.
- **Forbidden Action:** Enforcing individual seat numbers; blocking boarding passengers due to door-side counter checks.
- **Authoritative State:** `buses.capacity`, `buses.morning_load`, `buses.evening_load`.
- **Enforcement:** ITMS Master Architecture Invariant, `bus_increment_capacity` RPC.
- **Failure Behavior:** Non-pass holders denied entry based on QR validation, not seat availability.
- **Concurrency Behavior:** Independent counters for Morning and Evening shifts.
- **Evidence:** `docs/ITMS_SYSTEM_SPECIFICATION.md:23-32`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CAP-02`
- **Statement:** [Allocation Case 1: Ideal Case] When the bus selected by a student has available capacity on their shift (`shift_load < capacity`), the application proceeds with `needsCapacityReview = false` and `reassignmentReason = 'no_issue'`, allowing immediate one-click administrative approval.
- **Actor:** Student applicant, Administrative reviewer.
- **Scope:** Initial application submission and capacity review.
- **Preconditions:** Selected bus serves stop and has remaining capacity on shift.
- **Allowed Action:** Direct submission, direct approval without modal prompt.
- **Forbidden Action:** Flagging application for capacity review when seats are available.
- **Authoritative State:** `buses.morning_load < buses.capacity` or `buses.evening_load < buses.capacity`.
- **Enforcement:** `src/app/api/buses/capacity/route.ts:213-225`.
- **Failure Behavior:** Normal approval path.
- **Concurrency Behavior:** Verified authoritatively at commit time by `bus_increment_capacity`.
- **Evidence:** `src/app/api/buses/capacity/route.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CAP-03`
- **Statement:** [Allocation Case 2: Alternative Bus Available] When the primary bus chosen by a student is full on their shift (`shift_load >= capacity`) but another bus serves the same route or stop on that shift with available capacity, the system flags `reassignmentReason = 'bus_full_alternatives_exist'` and presents alternative vehicles via `AlternativeBusPicker`.
- **Actor:** Student applicant, Administrative reviewer.
- **Scope:** Application capacity checking.
- **Preconditions:** Primary bus full; at least one candidate bus serving stop has available capacity on shift.
- **Allowed Action:** Student chooses alternative bus or system proposes nearest alternative; administrator approves to alternative vehicle.
- **Forbidden Action:** Silently dropping student application; assigning student to an alternative bus running a different shift.
- **Authoritative State:** Candidate buses matching route and shift.
- **Enforcement:** `src/app/api/buses/capacity/route.ts:180-195`, `AlternativeBusPicker.tsx`.
- **Failure Behavior:** Informs student and provides selectable alternative bus numbers with seat counts.
- **Concurrency Behavior:** Advisory check; final allocation locked upon approval.
- **Evidence:** `src/lib/bus-capacity-checker.ts:180-195`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CAP-04`
- **Statement:** [Allocation Case 3: Worst Case — No Alternatives (`bus_full_only_option`)] When the primary bus is full and NO other bus serves that stop on that shift, the student is permitted to submit with notice, but the application is flagged with `needsCapacityReview = true` and `reassignmentReason = 'bus_full_only_option'`. Direct one-click approval in the admin/moderator dashboard is strictly LOCKED; clicking approve intercepts the action and forces open the Reassignment Modal to stage an alternative bus override before approval.
- **Actor:** Student applicant, Administrator, Moderator.
- **Scope:** Over-subscribed stop management.
- **Preconditions:** Primary bus full, alternative candidate count = 0.
- **Allowed Action:** Submission with review warning; administrative staging of override bus (`overrideBusId`).
- **Forbidden Action:** Direct unreviewed approval without staging an alternative bus; blocking student from submitting.
- **Authoritative State:** `applications.needs_capacity_review = true`, `applications.reassignment_reason = 'bus_full_only_option'`.
- **Enforcement:** `src/app/api/buses/capacity/route.ts:197-210`, `src/app/admin/applications/page.tsx:667-679`.
- **Failure Behavior:** Approve button disabled until bus is staged; warning banner displayed.
- **Concurrency Behavior:** Guarantees no overbooking can occur through administrative oversight.
- **Evidence:** `src/app/admin/applications/page.tsx:1464-1473`.
- **Status:** CONFIRMED.

---

## 36. Student reassignment & rollback rules

- **Rule ID:** `R-REAS-01`
- **Statement:** Reassignment of students across buses, routes, shifts, and stops MUST execute through the atomic stored procedure `public.reassign_students_atomically(p_plans JSONB)`. The RPC locks student profiles under `FOR UPDATE`, decrements source capacity, increments target capacity, updates student profiles, and recalculates exact bus loads from active profiles in a single database transaction.
- **Actor:** Administrator, Moderator (`canReassign: true`).
- **Scope:** Student fleet reassignment (`/admin/smart-allocation`, `/api/admin/reassign-students`).
- **Preconditions:** Valid source and destination bus IDs, active student profile.
- **Allowed Action:** Migrate single students or batches of students across buses and shifts.
- **Forbidden Action:** Reassignment via multiple uncoordinated client queries; exceeding destination vehicle capacity.
- **Authoritative State:** `student_profiles`, `buses` load counters.
- **Enforcement:** `public.reassign_students_atomically` in `COMPLETE_SCHEMA.sql:2075`.
- **Failure Behavior:** If any student causes destination capacity to exceed limit, the entire batch transaction aborts. Zero partial transfers.
- **Concurrency Behavior:** Row-level locking on students and buses ensures ACID isolation.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:2075-2173`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-REAS-02`
- **Statement:** Concurrent reassignments between overlapping buses MUST avoid deadlocks by locking bus records in deterministic ascending identifier order (`ORDER BY bus_id ASC`).
- **Actor:** Database Engine, Stored Procedures.
- **Scope:** Batch student and fleet reassignments.
- **Preconditions:** Multiple concurrent reassignments touching shared sets of buses.
- **Allowed Action:** Deterministic sequential lock acquisition.
- **Forbidden Action:** Arbitrary or reverse lock acquisition order across transactions.
- **Authoritative State:** PostgreSQL transaction lock manager.
- **Enforcement:** Sorted array processing in stored procedures and application service batchers.
- **Failure Behavior:** Eliminates deadlock aborts (error code 40P01).
- **Concurrency Behavior:** Serializable/Read Committed transaction queuing.
- **Evidence:** `docs/06-evidence-and-verification/ITMS_CONCURRENCY_EVIDENCE.md:24`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-REAS-03`
- **Statement:** Every committed student reassignment MUST persist an immutable log in `public.reassignment_logs` containing `operation_id`, `actor_id`, and full before/after snapshots of affected students and bus counters.
- **Actor:** Reassignment Subsystem (`reassignmentLogsService`).
- **Scope:** Audit trail and rollback preparation.
- **Preconditions:** Successful execution of `reassign_students_atomically`.
- **Allowed Action:** Append-only log creation; updating status to `'rolled_back'` upon successful reversal.
- **Forbidden Action:** Deleting or mutating previous change snapshots.
- **Authoritative State:** `public.reassignment_logs` table.
- **Enforcement:** `src/app/api/reassignment-logs/write/route.ts`.
- **Failure Behavior:** Log creation failure triggers administrative alerting.
- **Concurrency Behavior:** Unique `operation_id` primary key prevents duplicate entries.
- **Evidence:** `src/lib/services/__tests__/reassignment-logs-preservation.test.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-REAS-04`
- **Statement:** Reassignment rollbacks via `execute_reassignment_rollback` MUST verify strict preconditions before reverting: each affected student must still exist in `student_profiles` and must currently still be assigned to the destination bus of the original operation (`student_profiles.bus_id == change.after.bus_id`). If any student was subsequently modified or moved, rollback aborts immediately.
- **Actor:** Administrator, Moderator (`canReassign: true`).
- **Scope:** Reassignment undo engine (`/api/reassignment-logs/rollback`).
- **Preconditions:** Operation status is `'committed'`.
- **Allowed Action:** Revert student profiles to `before` state and recalculate exact bus loads from active profiles.
- **Forbidden Action:** Executing rollback if student was subsequently moved by another operation; rolling back an already rolled-back operation.
- **Authoritative State:** `public.reassignment_logs`, `student_profiles`.
- **Enforcement:** `execute_reassignment_rollback` RPC in `COMPLETE_SCHEMA.sql:2218-2347`.
- **Failure Behavior:** Returns `{"success": false, "error": "Precondition failed: Student ... busId has changed"}`.
- **Concurrency Behavior:** Row-level locks on affected students during rollback verification and execution.
- **Evidence:** `supabase/COMPLETE_SCHEMA.sql:2272-2286`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-REAS-05`
- **Statement:** Reassigning a student who is currently `soft_blocked` and whose seat quota was already released (`seatReleasedAt IS NOT NULL`) MUST NOT decrement the source bus capacity, because that quota was already returned to the fleet inventory at the time of soft-blocking.
- **Actor:** Reassignment Subsystem.
- **Scope:** Edge-case student reassignments.
- **Preconditions:** Student status is `soft_blocked` with `seatReleasedAt` set.
- **Allowed Action:** Update student bus assignment; increment target bus only upon active renewal.
- **Forbidden Action:** Double-decrementing the source vehicle load below ground-truth active passenger count.
- **Authoritative State:** `student_profiles.seat_released_at`, `buses.morning_load` / `evening_load`.
- **Enforcement:** `wasSeatReleased()` check, `adminReconcileBusLoads`.
- **Failure Behavior:** Source decrement bypassed for released seats.
- **Concurrency Behavior:** Prevented by ground-truth active profile recount in stored procedure.
- **Evidence:** `src/lib/config/capacity-flags.ts`, `src/lib/services/admin-reconcile-bus-loads.ts:10-18`.
- **Status:** CONFIRMED.

---

## 37. Academic calendar, soft block & hard block rules

- **Rule ID:** `R-CAL-01`
- **Statement:** The Academic Calendar configuration in `settings/deadline` stores Month and Day ONLY (`academicSessionStart: { month, day }`). Static calendar years are strictly forbidden in configuration. All operational milestone years are dynamically derived from each student's individual `sessionEndYear`.
- **Actor:** Calendar Service, Administrator.
- **Scope:** Global academic schedule.
- **Preconditions:** Valid month (0-11) and day (1-31).
- **Allowed Action:** Configure annual reference start date; compute per-student lifecycle milestones via `deriveAcademicLifecycle()`.
- **Forbidden Action:** Hardcoding calendar years in system configuration documents.
- **Authoritative State:** PostgreSQL `settings/deadline` / `calendar` domain table.
- **Enforcement:** `src/domains/calendar/services/calendar.service.ts`, `deriveAcademicLifecycle()`.
- **Failure Behavior:** Configuration validation fails closed if month/day is invalid.
- **Concurrency Behavior:** Cached in memory with 5-minute TTL; invalidated on administrative update.
- **Evidence:** `src/lib/utils/deadline-computation.ts:8-12`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CAL-02`
- **Statement:** When computing lifecycle dates involving February 29 during non-leap years, the date engine MUST normalize the timestamp to February 28 using `normalizeLeapYearDate()`. Under no circumstances may February 29 overflow into March 1.
- **Actor:** Date Computation Engine.
- **Scope:** All per-student and global date calculations.
- **Preconditions:** Month = 1 (February) and Day = 29.
- **Allowed Action:** Return February 28 if `year` is not a leap year.
- **Forbidden Action:** Allowing JavaScript `Date` to automatically overflow to March 1.
- **Authoritative State:** Normalized `Date` object.
- **Enforcement:** `normalizeLeapYearDate` in `src/lib/utils/deadline-computation.ts:23-32`.
- **Failure Behavior:** Clamped to Feb 28.
- **Concurrency Behavior:** Deterministic pure function.
- **Evidence:** `src/lib/utils/deadline-computation.ts:23-32`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CAL-03`
- **Statement:** When an active student passes their computed `softBlock` date without renewing, their pass status transitions to `soft_blocked` and their seat quota is immediately released back to the fleet inventory via `soft_block_student_with_seat_release`. The student can no longer board buses or raise waiting flags.
- **Actor:** Scheduled Cleanup Cron (`cron/cleanup-expired-students`).
- **Scope:** Student access revocation and capacity reclamation.
- **Preconditions:** `today >= student.softBlock`, `student.status = 'active'`.
- **Allowed Action:** Transition to `soft_blocked`, set `seat_released_at = NOW()`, decrement vehicle shift load.
- **Forbidden Action:** Releasing seat quota more than once; soft-blocking an already soft-blocked student.
- **Authoritative State:** `student_profiles.status = 'soft_blocked'`, `buses` load counter.
- **Enforcement:** `soft_block_student_with_seat_release` RPC in `COMPLETE_SCHEMA.sql:2020`.
- **Failure Behavior:** RPC is idempotent; active status check prevents duplicate decrements.
- **Concurrency Behavior:** Exclusive row lock on bus during capacity decrement.
- **Evidence:** `src/app/api/cron/cleanup-expired-students/route.ts:250-258`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CAL-04`
- **Statement:** Permanent account deletion (`hardDelete`) occurs after the data retention window expires (two academic sessions post-expiry). Hard delete MUST fail closed: it is strictly forbidden to delete students with missing/invalid `validUntil`, future validity, missing `sessionEndYear`, or recorded activity within the last 30 days.
- **Actor:** Scheduled Cleanup Cron (`cron/cleanup-expired-students`).
- **Scope:** Data minimization and account purging.
- **Preconditions:** `today >= student.hardBlock`, all safety rails verified.
- **Allowed Action:** Purge student profile, delete Cloudinary ID photos, remove associated records via `deleteUserAndData(uid, 'student')`.
- **Forbidden Action:** Deleting recently active students; deleting students with unverified or future validity.
- **Authoritative State:** PostgreSQL user and profile tables.
- **Enforcement:** `src/app/api/cron/cleanup-expired-students/route.ts:137-166`.
- **Failure Behavior:** Safety check cancels deletion; warning logged to server telemetry.
- **Concurrency Behavior:** Atomic deletion workflow.
- **Evidence:** `src/app/api/cron/cleanup-expired-students/route.ts:137-166`.
- **Status:** CONFIRMED.

---

## 38. Scheduled cron lifecycle rules

- **Rule ID:** `R-CRON-01`
- **Statement:** All cron endpoints (`/api/cron/*`, `/api/unauth-users/cleanup`) MUST enforce authentication via `verifyCronAuth()` or `verifyCronSecret()`. Unauthenticated requests without the valid bearer secret are rejected immediately with HTTP 401 Unauthorized.
- **Actor:** External Schedulers (Vercel Cron, Cloud Scheduler, Curl).
- **Scope:** Scheduled API routes.
- **Preconditions:** Request contains `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret` matching environment configuration.
- **Allowed Action:** Execute scheduled batch maintenance.
- **Forbidden Action:** Public execution of maintenance endpoints.
- **Authoritative State:** Environment secret `CRON_SECRET`.
- **Enforcement:** `src/lib/security/cron-auth.ts`.
- **Failure Behavior:** HTTP 401 `{"error": "Unauthorized"}`.
- **Concurrency Behavior:** Stateless authentication validation.
- **Evidence:** `src/app/api/cron/cleanup-expired-students/route.ts:38`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CRON-02`
- **Statement:** The trip lock cleanup cron (`/api/cron/cleanup-stale-locks`) MUST execute at 1-minute intervals. It invokes `cleanup_stale_trips()` to purge active trip locks where the driver heartbeat has expired (`expires_at < NOW()`), cancel associated waiting flags, and archive records to `trips` with `status = 'interrupted'`.
- **Actor:** Background Cron Runner.
- **Scope:** Real-time operational lock recovery.
- **Preconditions:** Trip record in `active_trips` with `expires_at < NOW()`.
- **Allowed Action:** Release stranded locks; purge Redis live location keys.
- **Forbidden Action:** Allowing abandoned trips to block vehicles or drivers indefinitely.
- **Authoritative State:** `public.active_trips`.
- **Enforcement:** `cleanup_stale_trips` RPC in `COMPLETE_SCHEMA.sql:1900`.
- **Failure Behavior:** Stale trips automatically archived without human intervention.
- **Concurrency Behavior:** Row-level locks prevent race conditions with drivers ending trips normally.
- **Evidence:** `src/app/api/cron/cleanup-stale-locks/route.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CRON-03`
- **Statement:** The session activation cron (`/api/cron/session-activation`) MUST compare current date against the dynamic session start date before processing. If `today < activationDate`, the automated cron terminates immediately with zero database mutations.
- **Actor:** Scheduled Activation Runner.
- **Scope:** Future-session pass activation.
- **Preconditions:** Current date reaches configured academic session start date.
- **Allowed Action:** Activate `verified_upcoming` applications for current session; increment bus loads; transition to `pending_seat_allocation` if capacity exhausted.
- **Forbidden Action:** Activating applications before session start date; double-activating students.
- **Authoritative State:** `applications.state = 'verified_upcoming'`, `settings/deadline`.
- **Enforcement:** `activateUpcomingSessionApplications()` in `session-activation.service.ts:114-120`.
- **Failure Behavior:** Early execution logs notice and skips processing safely.
- **Concurrency Behavior:** Re-reads application state in transaction to prevent double activation.
- **Evidence:** `src/lib/services/session-activation.service.ts`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CRON-04`
- **Statement:** Ephemeral in-app notifications older than 3 days MUST be purged daily via `/api/cron/cleanup-notifications` to prevent database table bloat.
- **Actor:** Scheduled Notification Cleanup.
- **Scope:** In-app notification store.
- **Preconditions:** Notifications where `created_at < NOW() - INTERVAL '3 days'`.
- **Allowed Action:** Delete stale notifications from `notifications` table.
- **Forbidden Action:** Deleting persistent audit events or financial payment records.
- **Authoritative State:** PostgreSQL `public.notifications` table.
- **Enforcement:** `src/app/api/cron/cleanup-notifications/route.ts`.
- **Failure Behavior:** Stale records purged silently.
- **Concurrency Behavior:** Bulk DELETE execution with timestamp index.
- **Evidence:** `src/app/api/cron/cleanup-notifications/route.ts`.
- **Status:** CONFIRMED.

---

## 39. Admin system configuration & bus fee rules

- **Rule ID:** `R-CFG-01`
- **Statement:** Transit bus fees stored in `settings/config` (`config.busFee.amount`) are 100% server-authoritative. The system enforces a strict NO-FALLBACK guarantee: if fee configuration is missing or non-positive in the database, the server throws an error and fails closed. Under no circumstances may client-supplied fees or hardcoded default amounts be used for financial checkout.
- **Actor:** Payment Engine, Administrator.
- **Scope:** Online and offline fee calculation (`/api/student/renew-service-v2`).
- **Preconditions:** Valid numeric fee amount in `settings/config`.
- **Allowed Action:** Compute `totalFee = busFee.amount * durationYears`; create Razorpay Order with server-calculated amount.
- **Forbidden Action:** Accepting `totalFee` or `amount` from client request bodies; defaulting to 5000 if database query fails.
- **Authoritative State:** Firestore `settings/config` document, `busFee.amount`.
- **Enforcement:** `getCurrentBusFee()` in `src/lib/bus-fee-service.ts:65-94`.
- **Failure Behavior:** HTTP 500 `{"error": "Bus fee configuration is missing in settings database"}`.
- **Concurrency Behavior:** Atomic read-before-order generation.
- **Evidence:** `src/lib/bus-fee-service.ts:65-94`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CFG-02`
- **Statement:** Updates to bus fees (`POST /api/settings/bus-fees`) require master Administrator privileges (`role: 'admin'`). Every revision MUST increment `busFee.version`, append the previous rate to `busFee.history` (capped at the last 3 entries), and automatically dispatch a system-wide announcement notification (`notifyBusFeeChange`) to all users.
- **Actor:** Master Administrator.
- **Scope:** Pricing administration.
- **Preconditions:** Authenticated user with role `admin`, valid new amount (`amount >= 1`).
- **Allowed Action:** Update global transit fee, record history snapshot, broadcast notification.
- **Forbidden Action:** Modification by moderators or non-admin roles; erasing pricing revision history.
- **Authoritative State:** `settings/config` document, `notifications` table.
- **Enforcement:** `src/app/api/settings/bus-fees/route.ts`, `src/lib/bus-fee-service.ts`.
- **Failure Behavior:** HTTP 403 Forbidden for non-admin callers.
- **Concurrency Behavior:** Monotonically increasing version counter.
- **Evidence:** `src/app/api/settings/bus-fees/route.ts:46-75`.
- **Status:** CONFIRMED.

- **Rule ID:** `R-CFG-03`
- **Statement:** System configuration documents saved to storage MUST be cleaned via `cleanConfigForStorage()`, which automatically strips presentation-only properties (`icon`, `gradient`, `color`, `description`, `label`). System configuration is cached in memory with a 5-minute TTL; administrative mutations MUST explicitly invalidate this cache (`invalidateConfigCache()`).
- **Actor:** Admin Config Service.
- **Scope:** System configuration persistence and memory caching.
- **Preconditions:** Valid configuration object.
- **Allowed Action:** Strip volatile UI fields; cache reads in memory; purge cache on write.
- **Forbidden Action:** Persisting transient presentation styling to system configuration tables; serving stale config past mutation events.
- **Authoritative State:** `settings/config` document, `configMemoryCache`.
- **Enforcement:** `src/domains/admin/services/config.service.ts:68-98`.
- **Failure Behavior:** Cleaned config persisted without presentation clutter.
- **Concurrency Behavior:** Process-local cache invalidated immediately on update.
- **Evidence:** `src/domains/admin/services/config.service.ts:89-98`.
- **Status:** CONFIRMED.

