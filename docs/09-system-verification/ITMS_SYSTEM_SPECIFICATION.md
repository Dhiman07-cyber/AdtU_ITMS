# ADTU ITMS Master System Specification & Architecture Reference

**System:** Assam down town University Intelligent Transport Management System (ADTU ITMS)  
**Architecture Spine:** Trip Lifecycle (`active_trips` three-way unique lock)  
**Document Status:** CANONICAL & CONSOLIDATED  
**Last Updated:** 2026-09-25

---

## 1. System Overview & Core Philosophy

The Assam down town University Intelligent Transport Management System (ADTU ITMS) is an enterprise transit orchestration platform designed for real-time university bus tracking, student transport pass lifecycle management, driver dispatch, and administrative fleet monitoring.

### 1.1 The Operational Spine: Trip-First Architecture
The system is anchored around the **Trip Lifecycle**. A bus exists as an asset, but only an active trip transforms it into an operational, observable, real-time tracking stream.
All critical invariants flow from this operational spine:
- **Driver Exclusivity:** A driver cannot operate multiple buses simultaneously.
- **Bus Exclusivity:** A bus cannot be operated by multiple drivers simultaneously.
- **Lock Integrity:** Exactly one active trip row per driver, bus, and trip ID is enforced by a three-way PostgreSQL UNIQUE constraint in `public.active_trips`.
- **GPS Ingress Gating:** GPS coordinate updates are rejected unless the publishing driver holds the active trip lock.
- **Lifecycle Cleanup:** When a trip terminates (`release_trip_lock`), all ephemeral markers, Redis location caches, and active waiting flags for that trip are atomically purged.
- **Operational Role Isolation:** Only authenticated active drivers have access to initiate trips, stream live GPS telemetry, acknowledge waiting flags, respond to wait requests, mark students boarded, and terminate trips. Neither administrators nor moderators have ANY operational involvement in starting or stopping trips or interacting with student waiting flags. Admin and moderator visibility in the trip domain is strictly limited to passive, read-only vehicle location tracking on the fleet radar map.

### 1.2 Open Seating vs. Aggregate Bus Enrollment Capacity Quota
> **CRITICAL CLARIFICATION (Zero Individual Seat Reservations):**  
> In ADTU ITMS, **there is NO individual seat assignment, seat reservation, or seat numbering**.  
> - A student is registered for a **Bus and Shift (Morning / Evening)**.  
> - Upon boarding, students may sit in **any available physical seat**.  
> - The metric `buses.capacity` is the physical seating capacity (e.g. 50 seats).  
> - The database columns `buses.morning_load` and `buses.evening_load` represent the **aggregate enrollment headcount quota** (number of registered transport passes).  
> - During student admission/renewal approvals, PostgreSQL RPCs (`bus_increment_capacity`, `approve_renewal_with_seat`) acquire row locks (`FOR UPDATE`) to ensure total registered passes do not exceed vehicle capacity.  
> - Physical in-trip boarding (`/api/driver/mark-boarded`) merely flips the waiting flag to `boarded` for driver accountability. It **does NOT check or decrement capacity at the door**, allowing open transit boarding without blocking passengers.

---

## 2. System Architecture & Topology

```
                  ┌──────────────────────────────────────────────┐
                  │                 NGINX TLS Proxy               │
                  │             Ports 80 / 443 (Reverse Proxy)    │
                  └───────┬──────────────────────────────┬───────┘
                          │                              │
                          ▼                              ▼
             ┌─────────────────────────┐    ┌─────────────────────────┐
             │ Next.js App Router Node │    │ Clustered WS Cluster    │
             │   (Port 3000, Node 20)  │    │  WS1 (:3001), WS2 (:3003)│
             └────────────┬────────────┘    └────────────┬────────────┘
                          │                              │
                          ├──────────────┬───────────────┤
                          ▼              ▼               ▼
                 ┌────────────────┐┌───────────┐┌────────────────┐
                 │  PostgreSQL 15 ││  Redis 7  ││ Firebase Auth  │
                 │   (Supabase)   ││  Pub/Sub  ││  & Admin SDK   │
                 └────────────────┘└───────────┘└────────────────┘
```

### 2.1 Component Breakdown
1. **Next.js Web & API Server (Port 3000):**
   - App Router handling user identity, student admissions, driver assignments, fleet management, and offline/online payment processing.
   - Guarded by `withSecurity` middleware providing JWT decoding, RBAC validation, and fail-closed error formatting.
2. **Clustered WebSocket Nodes (WS1 on :3001, WS2 on :3003):**
   - Clustered socket servers providing sub-100ms real-time bus location delivery, waiting flag alerts, and emergency notifications.
   - Connected via Redis Pub/Sub relay (`bus_location_events` and `driver_channel`).
3. **Redis 7 (Port 6379):**
   - Message broker for cross-node WebSocket relay.
   - L1 in-memory cache for live GPS snapshots (`bus_location:{busId}`).
   - Distributed driver session cache (`driver_session:{driverUid}`).
   - Atomic rate limiting and monotonic GPS timestamp sequencing via Lua scripts.
4. **PostgreSQL 15 (Supabase):**
   - Authoritative relational data store with ACID row-locking RPCs, foreign keys with `ON DELETE CASCADE`, and check constraints.

---

## 3. Actor Permission Matrix (RBAC)

The system enforces four distinct, non-overlapping roles:

| Domain / Endpoint | Student | Driver | Moderator (Default) | Moderator (Granted) | Admin |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Track Assigned Bus (`/api/student/tracking`)** | ✅ Allowed | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **View Fleet Map / Bus Locations (All Buses)** | ❌ Forbidden | ❌ Forbidden | ✅ `canView: true` | ✅ `canView: true` | ✅ Full (View Only) |
| **Track Unassigned Bus** | ❌ 403 Forbidden | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **Raise / Cancel Waiting Flag (`/api/student/waiting-flag`)** | ✅ Allowed | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **Initiate Trip (`/api/driver/initiate-trip`)** | ❌ Forbidden | ✅ Allowed (Active) | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **Publish GPS (`/api/location/update`)** | ❌ Forbidden | ✅ Trip Lock Holder | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **Acknowledge / Board Flag (`/api/driver/ack-flag`, `mark-boarded`)** | ❌ Forbidden | ✅ Trip Lock Holder | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **End Trip (`/api/driver/end-trip`)** | ❌ Forbidden | ✅ Trip Lock Holder | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden |
| **View Fleet / Student Data** | ❌ Forbidden | ❌ Forbidden | ✅ `canView: true` | ✅ `canView: true` | ✅ Full |
| **Mutate Students / Reassign** | ❌ Forbidden | ❌ Forbidden | ❌ 403 Forbidden | ✅ If `canEdit/Reassign` | ✅ Full |
| **Approve Applications / Passes** | ❌ Forbidden | ❌ Forbidden | ❌ 403 Forbidden | ✅ If `canApprove` | ✅ Full |
| **Approve Offline Payments** | ❌ Forbidden | ❌ Forbidden | ❌ 403 Forbidden | ✅ If `canApproveOffline` | ✅ Full |
| **Grant Moderator Permissions** | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden | ❌ Forbidden | ✅ Admin Only |
| **Fleet / Route CRUD** | ❌ Forbidden | ❌ Forbidden | ❌ 403 Forbidden | ✅ If `routes.canEdit` | ✅ Full |

---

## 4. State Machines

### 4.1 Trip Lifecycle State Machine
```
   [IDLE / NO TRIP]
          │
          │ Driver calls /api/driver/initiate-trip
          │ (Atomic RPC acquire_trip_lock)
          ▼
     [ACTIVE TRIP] ◄──────────────────────────────┐
          │                                       │
          ├─► Driver sends GPS / Heartbeat ───────┘ (Extends expires_at)
          │
          ├─► Heartbeat fails > 60s
          │   (Background worker calls cleanup_stale_trips)
          │   ▼
          │ [EXPIRED] ──► Deleted from active_trips & archived to trips
          │
          │ Driver calls /api/driver/end-trip
          │ (Atomic RPC release_trip_lock)
          ▼
       [ENDED] ──► Deleted from active_trips, purged from Redis, archived to trips
```

### 4.2 Waiting Flag State Machine
```
   [NONE]
     │ Student raises flag (/api/student/waiting-flag)
     ▼
  [RAISED] ───────────► Student cancels ───────────► [CANCELLED]
     │
     │ Driver acknowledges (/api/driver/ack-flag)
     ▼
  [ACKNOWLEDGED]
     │
     │ Driver boards student (/api/driver/mark-boarded)
     ▼
  [BOARDED] (Terminal success)

  * Special Transition: If trip ends while flag is in [RAISED] or [ACKNOWLEDGED],
    release_trip_lock atomically marks flag as [CANCELLED].
```

### 4.3 Student Transport Pass Enrollment Lifecycle
```
   [SUBMITTED APPLICATION]
             │
             ├─► Application Rejected ──────────► [REJECTED]
             │
             ├─► Future Session (Start Year > Current)
             │   ▼ (Verify)
             │ [VERIFIED_UPCOMING] (Zero profile created, zero capacity consumed)
             │   │
             │   ▼ Session Starts (cron/session-activation)
             │   ├─► Capacity Available ────► [ACTIVE STUDENT]
             │   └─► Bus Full ──────────────► [PENDING_SEAT_ALLOCATION] (Manual Review)
             │
             │ Current Session Approved (RPC bus_increment_capacity verifies load < capacity)
             ▼
      [ACTIVE STUDENT]
             │
             ├─► Academic year expires
             ▼
      [SOFT BLOCKED] ──► Seat quota released to bus inventory via
             │           RPC soft_block_student_with_seat_release
             │
             ├─► Renewal Approved (RPC approve_renewal_with_seat reclaims quota)
             │   ▼
             │ [ACTIVE STUDENT]
             │
             └─► Expiration + Grace period expires
                 ▼
          [HARD DELETED] (Permanent purge via deleteUserAndData after retention window)
```

---

## 5. Database Schema & RPC Enforcement Ledger

All critical invariants are guaranteed by PostgreSQL constraints and ACID RPCs in `supabase/COMPLETE_SCHEMA.sql`:

| RPC Function | Signature | Authoritative Actions & Invariant Guarantees |
| :--- | :--- | :--- |
| `acquire_trip_lock` | `(p_bus_id, p_driver_id, p_trip_id, p_ttl_seconds)` | 1. Auto-cleans expired trips (`cleanup_stale_trips`).<br>2. Verifies driver is active and bus is available.<br>3. Inserts row into `active_trips` with 3-way uniqueness.<br>4. Rejects concurrent attempts with error code `TRIP_ALREADY_ACTIVE`. |
| `release_trip_lock` | `(p_trip_id, p_driver_id, p_end_time)` | 1. Locks and deletes row in `active_trips`.<br>2. Deletes active tracking points in `bus_locations`.<br>3. Cancels unresolved waiting flags (`raised`, `acknowledged`).<br>4. Inserts completed trip record into `trips` history. |
| `cleanup_stale_trips` | `()` | 1. Scans `active_trips` where `expires_at < now()`.<br>2. Deletes expired active trips and cancels dangling waiting flags.<br>3. Archives expired records to `trips` with `status = 'interrupted'`. |
| `bus_increment_capacity` | `(p_bus_id, p_shift)` | 1. Locks target bus row (`SELECT ... FOR UPDATE`).<br>2. Evaluates `morning_load < capacity` (or evening).<br>3. Increments load by 1. Aborts with `CAPACITY_FULL` if full. |
| `bus_decrement_capacity` | `(p_bus_id, p_shift)` | 1. Locks target bus row (`SELECT ... FOR UPDATE`).<br>2. Decrements load by 1, clamping at minimum 0. |
| `approve_renewal_with_seat` | `(p_application_id, p_approver_uid, p_student_uid, p_bus_id, p_shift, ...)` | 1. Atomically increments bus quota under `FOR UPDATE` lock.<br>2. Extends student `valid_until` timestamp.<br>3. Resets soft/hard block dates.<br>4. Transitions renewal application to `approved`. |
| `soft_block_student_with_seat_release` | `(p_student_uid, p_bus_id, p_shift, p_release_seat, ...)` | 1. Atomically decrements bus quota under `FOR UPDATE` lock.<br>2. Transitions student status to `soft_blocked`.<br>3. Sets `seat_released_at = NOW()`. |
| `reassign_students_atomically` | `(p_plans JSONB)` | 1. Acquires `FOR UPDATE` lock on each student profile.<br>2. Decrements source bus shift load and increments target bus shift load.<br>3. Aborts batch atomically if target bus exceeds capacity.<br>4. Recalculates exact shift loads from active profiles. |
| `execute_reassignment_rollback` | `(p_operation_id, p_actor_id, p_actor_label, p_changes JSONB)` | 1. Verifies operation is committed and students have not changed buses.<br>2. Atomically restores previous bus, route, shift, and stop.<br>3. Recalculates bus capacity counters from active profiles.<br>4. Sets log status to `rolled_back`. |

---

## 6. Real-Time WebSocket, Ingress & Redis Architecture

1. **Authentication & Handshake:**
   - Every client initiates a custom handshake token containing Firebase UID and Role.
   - Server-to-server connections (WS node to Next.js API) use HMAC-signed `x-server-auth` header verified by timing-safe string comparison.
2. **Channel Authorization:**
   - `bus_location_{busId}` / `fleet_locations`: Students can only subscribe to their registered `busId` (validated by `socket-router.ts`). Admins and moderators may subscribe to all buses to view current vehicle locations on their fleet map page.
   - `waiting_flags_{busId}`: Only enrolled students (for their assigned bus) and the active trip driver (holding the trip lock) can subscribe. Admins and moderators are STRICTLY FORBIDDEN from subscribing to waiting flag channels.
   - `driver_{driverId}` / `driver_wait_request_{busId}`: Strictly restricted to the authorized driver holding the active trip lock. Students, administrators, and moderators are rejected with 403 if they attempt to subscribe to driver command or waiting flag dispatch channels.
3. **Monotonic Packet Guard:**
   - The browser tracking view utilizes `decideLocationPacket` (`location-packet-guard.ts`).
   - Packets with `timestamp <= lastRenderedTimestamp` are dropped immediately to prevent out-of-order jitter.
4. **GPS Ingress Validation:**
   - Evaluated at `/api/location/update`:
     - Bounding Box: Latitude `[25.5, 26.8]`, Longitude `[91.2, 92.5]`.
     - Max Speed: `<= 120 km/h`.
     - Accuracy: `<= 50m`.
     - Monotonic sequence: No stale packets older than 15s.
     - Single-Device Check: In-memory/Redis driver session cache prevents dual-device transmission.

---

## 7. Test Harness & Staging Verification

The test harness (`scripts/staging/master-simulation.ts` and `e2e/`) validates system resilience under real-world conditions:
- **No Mock Cheats:** Simulates 13 concurrent drivers and 150 student agents executing genuine HTTP requests and real WebSocket frames.
- **Staging IP Bypass Guard:** Header `x-load-test-bypass` bypasses ONLY the global per-IP DDoS rate limit when `STAGING_MODE=true` and `LOAD_TEST_SECRET` matches. It **never bypasses user authentication, RBAC, business rules, or database locks**.
- **Privileged Token Security:** Checked at WebSocket server startup via `assertPrivilegedTokenSafe()`. In production, weak, default, or empty tokens immediately abort server startup.
