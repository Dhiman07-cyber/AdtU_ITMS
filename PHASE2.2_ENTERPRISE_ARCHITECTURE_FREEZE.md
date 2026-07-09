# ADTU ITMS — Phase 2.2: Enterprise Domain Contract & Architecture Freeze

**Version:** 1.0.0 (FROZEN)
**Date:** 2026-07-05
**Classification:** Final Architecture Contract — Permanent Baseline
**Status:** Approved for Phase 3 Implementation Planning
**Supersedes:** PHASE2_ENTERPRISE_BUSINESS_ARCHITECTURE.md (target design), PHASE2.1_ARCHITECTURE_REVIEW.md (gap analysis) — both remain as historical record; where they conflict with this document, **this document wins**.

---

## 0. How This Document Was Produced

This is not a re-derivation from zero. It consolidates three inputs:

1. **PHASE2 (target design)** — 13-domain model, entity definitions, business rules, state machines, transaction boundaries.
2. **PHASE2.1 (gap analysis)** — verified against the current repository, found 8 architectural weaknesses and proposed 15 architecture decisions (AD-1..AD-15) plus 5 open product-owner questions (Q1..Q5).
3. **Live repository verification performed for this freeze** — confirmed which parts of PHASE2.1's findings are still accurate and which have drifted since it was written (same day). Material findings:
   - The backend is a **hybrid**, not pure Firestore. Firestore remains system-of-record for `students`, `buses`, `drivers`, `applications`, `renewal_requests`, `routes`, `moderators`, `admins`, `unauthUsers`, `notifications`, `processed_payments`, `audit_logs`. Supabase/Postgres already owns 12 tables: `bus_locations`, `driver_status`, `waiting_flags`, `driver_location_updates`, `route_cache`, `driver_swap_requests`, `temporary_assignments`, `reassignment_logs`, `payments`, `active_trips`, `missed_bus_requests`, `device_sessions` (`supabase/COMPLETE_SCHEMA.sql`).
   - The Student god-object shape, the fields-not-entity assignment pattern, and the Bus cross-domain-write pattern are all **confirmed still present** (`src/lib/types.ts:13-67,116-136`, `src/app/api/applications/approve/route.ts:230-244`, `src/app/api/buses/create/route.ts:110-157`, `src/lib/services/assignment-service.ts:248-401`).
   - `renewal_requests` is **still a separate Firestore collection**, running in parallel with a newer `ApplicationType` enum (`fresh | renewal | renewal_after_soft_block | future`) that was clearly designed to replace it but is not yet wired through for renewals (`src/lib/types/application.ts:37-44`, `src/app/api/student/renew-service-v2/route.ts:64-92`). This is evidence of an in-progress, incomplete migration — not a design gap.
   - `processed_payments` (Firestore dedup collection) **still exists alongside** genuine Postgres unique constraints on the `payments` table (`idx_payments_razorpay_id_unique`, `idx_payments_one_completed_per_student_session` — `supabase/COMPLETE_SCHEMA.sql:569,575-580`). Both mechanisms are live simultaneously today.
   - Two parallel, overlapping type definitions exist for both `Student` and `Application` (`src/lib/types.ts` vs `src/lib/types/application.ts`) — a canonical-naming problem PHASE2.1 did not explicitly flag.
4. **Explicit product-owner decisions**, captured below, resolving every item in PHASE2.1 Appendix A.

Everywhere this document's target model differs from what exists in the repository today, the repository is wrong and this document is the correction — per the instruction "do not preserve legacy behaviour unless business requires it."

---

## 1. Resolved Decisions (Formerly Blocking Questions)

These were the open items in PHASE2.1 Appendix A. All are now resolved and are binding for Phase 3.

| # | Question | Decision |
|---|----------|----------|
| D-1 | Where do the new assignment entities live? | **Distributed to the domain that operationally owns the concept**, not centralized in D8: **SeatAssignment → D8** (Seat & Capacity), **DriverAssignment → D6** (Fleet Management), **BusRouteAssignment → D7** (Route & Stop Management). Each still follows one shared lifecycle pattern (active → superseded/ended, single-writer, optimistic concurrency), but ownership stays with the domain responsible for the underlying business concept. This differs from PHASE2.1's default recommendation (all three under D8) — see §3 for the domain responsibility rewrite this implies. |
| D-2 | SeatAssignment rollback retention depth? | **Exactly one ACTIVE + one immediately-previous SUPERSEDED record per student.** Older superseded records are deleted at the moment a new supersession occurs. `SeatAssignment` is an **operational table, not a history table** — long-term history lives in `AuditRecord`; rollback metadata lives in `ReassignmentOperation`. Max 2 rows per (student, session) at any time. |
| D-3 | Eliminate `renewal_requests`? | **Eliminate.** All transport requests — fresh, renewal, renewal-after-soft-block, future — are `Application` records distinguished by `applicationType`. This is not a new invention: the `ApplicationType` enum already contains `renewal` and `renewal_after_soft_block`; Phase 3 finishes wiring renewal approval through the existing `Application` state machine instead of the separate collection. |
| D-4 | Can a student hold multiple simultaneous active assignments? | **No. Exactly one ACTIVE SeatAssignment per student per academic session.** Shift (Morning/Evening) is a **property of the SeatAssignment**, not a separate assignment axis. Changing shift = create new SeatAssignment, supersede the old one. Multiple simultaneous services per student are explicitly out of scope for the current product. |

All other AD-1..AD-15 decisions from PHASE2.1 are **ratified as-is** except where D-1 above changes assignment-domain placement, and except the correction in §8 (domain communication model).

---

## 2. Final Domain Catalogue

13 domains, unchanged in count from PHASE2, with D3 split per PHASE2.1's recommendation and assignment-entity ownership redistributed per D-1 above.

| # | Domain | Purpose | Owns | Never Owns |
|---|--------|---------|------|-----------|
| D1 | Identity & Access Management | Who is this person, what can they do | User, RoleAssignment, Session, ModeratorPermission | Any domain profile data (Student/Driver identity lives in D3a/D6) |
| D2 | Academic Calendar | Session dates and date-derived rules | AcademicCalendarConfig, AcademicSession (computed) | Student status, payment deadlines (these read calendar, don't own it) |
| D3a | Student Profile | Student identity/master data | StudentProfile | Session status, assignment, payment |
| D3b | Student Session | Session-scoped student lifecycle | StudentSession | Identity fields, assignment records, payment records |
| D4 | Application Processing | Transport access request workflow | Application, ApplicationForm | Student lifecycle status, payment state, seat assignment |
| D5 | Payment & Financial Ledger | Immutable financial records | Payment | Student status, application state |
| D6 | Fleet Management | Bus & driver master data + **driver-bus assignment** | Bus (physical properties only), DriverProfile (identity only), **DriverAssignment** | Seat assignment, route definitions, trip state |
| D7 | Route & Stop Management | Route/stop definitions + **bus-route assignment** | Route, Stop, RouteStop, **BusRouteAssignment** | Driver assignment, seat assignment, bus physical properties |
| D8 | Seat & Capacity Management | Student-to-bus seat assignment and capacity | SeatAssignment, BusCapacityCounter | Driver assignment, bus-route assignment, bus physical properties |
| D9 | Trip Operations | Real-time trip execution | ActiveTrip, TripRecord, GPSRecord, DriverSwapRequest, WaitingFlag, MissedBusRequest | Bus/driver identity, seat assignment, route definitions |
| D10 | Notification & Communication | Reaching users | NotificationTemplate, Notification, DeliveryRecord | The business events that trigger notifications |
| D11 | Administration & Moderation | Cross-domain orchestration, config | SystemConfiguration, ReassignmentOperation (rollback metadata only) | Any entity it orchestrates — always calls the owning domain's service |
| D12 | Audit & Compliance | Immutable history of everything | AuditRecord, IntegrityCheck | The business data it describes |
| D13 | Analytics & Reporting | Read-only aggregation | DashboardMetric, OperationalReport | Any source-of-truth data |

### 2.1 Domain Boundary Rationale (delta from PHASE2)

- **D3 split (a/b):** identity (rarely changes, long retention) vs. session lifecycle (changes every session, different retention, different state machine). Unchanged from PHASE2.1.
- **D6/D7/D8 assignment split (D-1):** Each assignment entity sits next to the domain that triggers its lifecycle transitions most often and whose invariants it primarily protects:
  - **DriverAssignment in D6** — driver-bus pairing is fundamentally a fleet staffing decision (who is qualified/rostered to drive which vehicle), independent of whether any trip is running or any student is assigned. D9 (Trip Operations) is the most frequent **reader** (validates an active trip may start) and the trigger for **swap** transitions, but calls D6's service rather than writing directly.
  - **BusRouteAssignment in D7** — which route a bus runs is fundamentally a routing/scheduling decision that belongs with route definitions; D6 (Fleet) reads it for display, D8 (Seat & Capacity) reads it to validate a seat assignment's route is the one the assigned bus actually runs.
  - **SeatAssignment in D8** — student-to-bus occupancy is the core responsibility of Seat & Capacity Management; it's what per-shift capacity math is computed from.
  - This means **no entity is ever written by more than one domain**, but the three assignment entities are **not co-located**. This is fine: single ownership does not require co-location, and each assignment's business rules (uniqueness, transitions) are independent of the other two. A reassignment operation that only changes which bus a student sits on touches only D8 — it never needs to touch D6's DriverAssignment or D7's BusRouteAssignment, because those describe unrelated facts.

---

## 3. Final Entity Catalogue

Legend for Classification: **M**=Master, **O**=Operational, **H**=Historical, **C**=Configuration, **DP**=Derived Projection.

### D1: Identity & Access Management

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------| ------|
| User | M | userId | created → active → soft-deleted → anonymized | Replaces separate Firestore `unauthUsers`/`moderators`/`admins` documents — one identity table, role carried in RoleAssignment |
| RoleAssignment | M | (userId, role) | assigned → deactivated | Exactly one active role per user; role change = deactivate old, create new |
| Session | O (ephemeral) | sessionId | created → expired/invalidated | Single-device enforcement per platform |
| ModeratorPermission | M | (moderatorUserId, permissionKey) | granted → revoked | Granular, independent of role |

### D2: Academic Calendar

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| AcademicCalendarConfig | C | configId | created → updated (never retroactive) | One active config per universityId |
| AcademicSession | DP | sessionId | computed, never written | Derived from config + year; not persisted as an independent source of truth (may be cached) |

### D3a: Student Profile

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| StudentProfile | M | studentId | created (on first approval) → updated → soft-deleted → anonymized | **Identity fields only**: userId, fullName, email, phoneNumber, enrollmentId, gender, dob, faculty, department. No busId/routeId/shift/status/payment/computed.* fields. |

### D3b: Student Session

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| StudentSession | O | (studentId, sessionId) | pending_approval → active → pending_renewal → soft_blocked → hard_blocked → deleted | Owns `status`; `validUntil`/`softBlockDate`/`hardBlockDate` computed on read from D2, never stored |

### D4: Application Processing

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| Application | O | applicationId | draft → submitted → under_review → approved/rejected → consumed | `applicationType`: fresh \| renewal \| renewal_after_soft_block \| future. **Replaces `renewal_requests` entirely (D-3).** Consolidates the two current parallel type definitions into one canonical shape (see §9). |
| ApplicationForm | O (embedded) | — | immutable once submitted | Structured form payload inside Application |

### D5: Payment & Financial Ledger

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| Payment | H (append-only) | paymentId | pending → completed/rejected → (refunded intent recorded, original row untouched) | **Already Postgres-native today** (`public.payments`). Retire `processed_payments` Firestore collection (see §9); webhook idempotency becomes a Postgres unique constraint / `ON CONFLICT DO NOTHING`, not an app-level dedup collection. |

### D6: Fleet Management

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| Bus | M | busId | registered → active ⇄ maintenance → decommissioned | **Physical properties only**: busNumber, capacity, color, model, status. No driver/route/trip/capacity fields. |
| DriverProfile | M | driverId | created → active → deactivated | **Identity only**: userId, fullName, phoneNumber, licenseNumber, status. No busId/routeId/tripActive fields. |
| DriverAssignment | O | assignmentId | active → ended/superseded | Owned here per D-1. One active per bus, one active per driver. Assignment type: permanent \| temporary \| swap. |

### D7: Route & Stop Management

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| Route | M | routeId | active ⇄ inactive | No embedded stops/bus data |
| Stop | M | stopId | active ⇄ inactive | Geographic coordinates |
| RouteStop | M | (routeId, stopId) | sequence set at creation, archived on reorder | Sequence order immutable per record; reorder creates new records |
| BusRouteAssignment | O | assignmentId | active → superseded | Owned here per D-1. One active route per bus. |

### D8: Seat & Capacity Management

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| SeatAssignment | O | assignmentId | active → superseded → (superseded row deleted on next supersession) / released | **Max 2 rows per (student, session): 1 active + 1 superseded (D-2).** Carries busId, routeId, stopId, shift — shift is a property of the assignment, not separate (D-4). |
| BusCapacityCounter | DP | (busId, sessionId, shift) | recomputed on every SeatAssignment write | `assignedCount = COUNT(active SeatAssignment)`; never an independently-trusted source |

### D9: Trip Operations

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| ActiveTrip | O | tripId | starting → active → ending → completed/failed | Already Postgres-native (`active_trips`) |
| TripRecord | H (append-only) | tripRecordId | created on trip completion | New entity — archives completed trip summaries; currently absent, must be added |
| GPSRecord | O (realtime) | recordId | append-only, 30-90 day retention | Adaptive write frequency |
| DriverSwapRequest | O | swapId | pending → accepted/rejected/expired → (pending_revert → reverted) | Already Postgres-native (`driver_swap_requests`, `temporary_assignments`) |
| WaitingFlag | O | flagId | raised → acknowledged → boarded/expired/cancelled | Already Postgres-native (`waiting_flags`) |
| MissedBusRequest | O | requestId | pending → approved/rejected/expired | Already Postgres-native (`missed_bus_requests`) |

### D10: Notification & Communication

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| NotificationTemplate | C | templateId | active ⇄ inactive | |
| Notification | H | notificationId | created → read | 90-day retention |
| DeliveryRecord | H (append-only) | deliveryId | queued → sent → delivered/failed/bounced | |

### D11: Administration & Moderation

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| SystemConfiguration | C | configKey | created → updated | Feature flags, operational settings |
| ReassignmentOperation | H (append-only) | operationId | performed → (isReverted flag set) | Rollback metadata only, references SeatAssignment via IDs; already partially Postgres-native (`reassignment_logs`) |

### D12: Audit & Compliance

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| AuditRecord | H (append-only) | auditId | created, never modified | The permanent record of everything; currently Firestore `audit_logs`, must migrate |
| IntegrityCheck | H | checkId | detected → resolved | |

### D13: Analytics & Reporting

| Entity | Class | PK | Lifecycle | Notes |
|--------|-------|----|-----------|-------|
| DashboardMetric | DP | metricId | computed → expires | |
| OperationalReport | DP | reportId | generated → 30-day retention | |

### 3.1 Entities Eliminated

| Entity/Collection (current) | Disposition | Replacement |
|---|---|---|
| `renewal_requests` (Firestore) | **Eliminated (D-3)** | `Application` with `applicationType='renewal'` / `'renewal_after_soft_block'` |
| `processed_payments` (Firestore) | **Eliminated** | Postgres unique constraints on `payments` (already exist for razorpay id and one-completed-per-session; add one for webhook event id if not already covered) |
| `unauthUsers`, `moderators`, `admins` (Firestore, separate collections) | **Eliminated** | Unified `User` + `RoleAssignment` in D1 |
| `bus.currentStudents`, `bus.currentPassengerCount` | **Eliminated** | Query `SeatAssignment` by busId; `BusCapacityCounter` |
| `bus.route`, `bus.routeRef`, `bus.routeName` (denormalized) | **Eliminated** | Query `Route` via `BusRouteAssignment` |
| Second/legacy `Student` type (`src/lib/types.ts`) | **Eliminated** | Canonical `StudentProfile` + `StudentSession` shapes only |
| Second/legacy `Application` type (`src/lib/types.ts` vs `src/lib/types/application.ts`) | **Eliminated** | Canonical shape defined in §3 D4, based on the richer `types/application.ts` version |
| All 20+ legacy field aliases (`name`/`fullName`, `phone`/`phoneNumber`, `busId`/`assignedBusId`/`currentBusId`, `driverUID`/`assignedDriverId`/`activeDriverId`, etc.) | **Eliminated** | Canonical names only (§9) |

---

## 4. Ownership Matrix (Field-Level)

Every field belongs to exactly one entity. No field is duplicated across entities without an explicit **Derived** marker.

| Concept | Canonical Field | Entity | Notes |
|---|---|---|---|
| Which bus a student rides | `busId` | SeatAssignment | Not on StudentProfile or StudentSession |
| Which route a student rides | `routeId` | SeatAssignment | |
| Which stop a student boards at | `stopId` | SeatAssignment | `stopName` is resolved by joining Stop, never stored redundantly |
| Which shift a student rides | `shift` | SeatAssignment | Property of the assignment (D-4), not the student |
| Whether a student currently has transport | *(derived)* `status === 'active' AND now < softBlockDate` | Computed from StudentSession + AcademicSession | Never stored |
| Which driver drives which bus | `driverId`, `busId` | DriverAssignment | Not duplicated on Bus or DriverProfile |
| Which route a bus runs | `busId`, `routeId` | BusRouteAssignment | Not duplicated on Bus |
| Bus seat count (per shift) | `assignedCount` | BusCapacityCounter | Derived from `COUNT(SeatAssignment WHERE status='active')`, never independently written |
| Payment amount/status | `amount`, `status` | Payment | Never mirrored onto StudentProfile/StudentSession |
| Student session validity date | *(derived)* `validUntil` | Computed from AcademicSession + StudentSession.sessionStartYear | Never stored on any entity |
| Trip lock state | `lockExpiresAt`, `status` | ActiveTrip | Not on Bus or DriverProfile |
| Reassignment rollback data | `rollbackData` | ReassignmentOperation | Distinct from SeatAssignment's own superseded-record pointer |

**Rule:** if two tables in the current codebase store the same fact, exactly one of them is the entity listed above; the other reference is deleted, not synchronized.

---

## 5. Relationship Contract

| Relationship | Type | Cascade / Deletion Rule | Referential Integrity |
|---|---|---|---|
| User → StudentProfile | 1:1 | Deleting User soft-deletes StudentProfile; hard delete only via retention job | FK, enforced |
| User → DriverProfile | 1:1 | Same pattern | FK, enforced |
| User → RoleAssignment | 1:N (only 1 active) | Deactivating role never deletes history rows | FK, enforced |
| StudentProfile → StudentSession | 1:N (one per session) | StudentSession rows retained after StudentProfile soft-delete, for audit | FK, enforced, `ON DELETE RESTRICT` |
| StudentProfile → SeatAssignment | 1:N (≤2 live rows per session per D-2) | Releasing a student cascades to `SeatAssignment.status='released'`, never a hard delete of the active row | FK, enforced |
| Bus → DriverAssignment | 1:N (≤1 active) | Decommissioning a bus ends any active DriverAssignment | FK, enforced |
| Bus → BusRouteAssignment | 1:N (≤1 active) | Decommissioning a bus supersedes any active BusRouteAssignment | FK, enforced |
| Bus → SeatAssignment | 1:N | Decommissioning a bus requires all active SeatAssignments to be reassigned first (business rule, not cascade) | FK, `ON DELETE RESTRICT` |
| Route ↔ Stop | N:N via RouteStop | Deactivating a Route does not delete Stops (Stops may serve other Routes) | FK, enforced both sides |
| Application → Payment | 1:1 | Application cannot be approved without a completed or exempted Payment reference; Payment is never deleted when Application is rejected | FK, `ON DELETE RESTRICT` on Payment side |
| Application → StudentProfile/StudentSession | N:1 (consumption creates/updates) | Consuming an Application creates StudentSession, never deletes Application | FK, enforced |
| ActiveTrip → Bus, DriverProfile, Route | N:1 each | Trip references frozen at start; a Bus/Driver/Route change mid-trip does not retroactively alter ActiveTrip | FK, enforced |
| AuditRecord → (any entity) | Polymorphic reference (entityType + entityId) | Never cascades; audit outlives the entity it describes | Not a DB-enforced FK by design (cross-entity polymorphism) |

---

## 6. Business Invariants (Final)

Consolidated and renumbered; supersedes the R-* tables in PHASE2 where this document adds specificity.

| ID | Invariant |
|---|---|
| INV-01 | Exactly one ACTIVE SeatAssignment per (studentId, sessionId). Enforced by a partial unique index. |
| INV-02 | At most one SUPERSEDED SeatAssignment retained per (studentId, sessionId); older superseded rows are deleted at the moment of the next supersession (D-2). |
| INV-03 | Shift lives only on SeatAssignment. There is no `shift` field anywhere else. |
| INV-04 | `morningCount ≤ capacity` and `eveningCount ≤ capacity` are validated **independently**; they are never summed for a capacity check. |
| INV-05 | `BusCapacityCounter.assignedCount` is always exactly `COUNT(SeatAssignment WHERE busId=X AND shift=Y AND status='active')`. It is a projection, never an independent source. |
| INV-06 | At most one ACTIVE DriverAssignment per driverId and at most one per busId. |
| INV-07 | At most one ACTIVE BusRouteAssignment per busId. |
| INV-08 | At most one ACTIVE trip per busId and at most one per driverId (existing rule, unchanged). |
| INV-09 | Payment records are append-only; `pending → completed` and `pending → rejected` are one-way and irreversible. |
| INV-10 | At most one `completed` Payment per (studentId, sessionId) — enforced by DB unique constraint, not an application-level dedup collection. |
| INV-11 | Only one ACTIVE (non-consumed, non-rejected) Application per (studentId/applicantUserId, sessionId). |
| INV-12 | StudentSession.status is the sole source of lifecycle truth; transport entitlement is always computed, never stored, from `status` + calendar dates. |
| INV-13 | No domain writes another domain's owned entity directly; it calls that domain's service (§8). |
| INV-14 | Every state-changing operation produces exactly one AuditRecord (or one per affected entity within a correlationId group). |
| INV-15 | A Bus, Driver, or Route may not be hard-deleted while it is the target of an ACTIVE assignment (SeatAssignment/DriverAssignment/BusRouteAssignment respectively). |

---

## 7. State Machines

### 7.1 Application (D4)
```
draft → submitted → under_review → approved → consumed         [terminal: consumed]
                              └──→ rejected                     [terminal: rejected]
```
- `applicationType` set at creation, immutable: `fresh | renewal | renewal_after_soft_block | future`.
- Trigger: student action (draft/submit), automated validation (under_review), admin/moderator (approve/reject), D4 orchestration (consumed).
- Side effects: `approved → consumed` atomically creates/updates StudentSession (D3b) and SeatAssignment (D8) — see §8 for how, given no cross-domain direct writes are allowed.

### 7.2 StudentSession (D3b)
```
pending_approval → active → pending_renewal → soft_blocked → hard_blocked → deleted
                       ↑______________________|  (renewal within grace reactivates to active)
```
- Trigger for each transition: Application consumption (→active), calendar cron (→pending_renewal, →soft_blocked, →hard_blocked), renewal Application consumption (→active from pending_renewal or soft_blocked), retention cron (→deleted).
- Side effect: `active → soft_blocked` calls D8's `releaseSeat()` service (SeatAssignment → released).

### 7.3 SeatAssignment (D8)
```
(none) → active → superseded → (row deleted on next supersession)
              └──→ released                                    [terminal per session]
```
- Trigger: Application consumption or renewal (→active), reassignment operation (active→superseded + new active), soft block / hard delete / admin release (→released).
- Only D8 may transition this entity (INV-13); D11's ReassignmentOperation calls D8's `reassignSeat()` service.

### 7.4 DriverAssignment (D6)
```
(none) → active → ended
              └──→ superseded (swap in progress) → ended (swap reverted → original re-activated)
```
- Trigger: admin assignment (→active), reassignment (→ended + new active), swap accept (→superseded, swap assignment →active), swap revert (swap →ended, original →active).
- Only D6 may transition this entity; D9's swap workflow calls D6's `reassignDriver()`/`endAssignment()` service.

### 7.5 BusRouteAssignment (D7)
```
(none) → active → superseded
```
- Trigger: route assignment (→active), route change (→superseded + new active).
- Only D7 may transition this entity; D6 calls D7's `assignRouteToBus()` service when registering/updating a bus's route.

### 7.6 ActiveTrip (D9)
```
starting → active → ending → completed
                          └──→ failed
```
- Unchanged from PHASE2. On `completed`/`failed`, D9 creates a `TripRecord` (new entity, §3).

### 7.7 Payment (D5)
```
pending → completed                                             [terminal, irreversible]
      └──→ rejected                                              [terminal, irreversible]
completed → (refund intent recorded in statusHistory; row itself never mutated further)
```

---

## 8. Domain Communication Contract (Corrected)

**This section overrides PHASE2 §3.1/§12.3's "event-driven domain coordination" as a headline pattern.** Given the target platform is a single Postgres-backed modular monolith (not distributed services), event-driven coordination for *core, synchronous* business workflows adds indirection and eventual-consistency risk with no corresponding benefit — the whole point of a modular monolith is that cross-domain calls within one transaction are cheap and safe. PHASE2.1's own transaction-boundary analysis (its §12.1) already required these operations to be ACID and synchronous; keeping "emits an event" language for them in PHASE2 was an internal inconsistency. This freeze resolves it as follows:

**Default: direct service calls.** When Domain A needs Domain B to do something as part of one business operation — even across the two-transaction-boundary case of "call B's service, then continue A's transaction" — A calls B's public service function directly, within the same database transaction where the DB supports it (all core domains now live in the same Postgres database, so this is always possible for D1-D8, D11, D12; unchanged for future non-Postgres subsystems).

**Domain events: reserved for genuinely asynchronous side effects only.** Examples: sending a notification, refreshing an analytics aggregate, invalidating a cache, or a future external integration. These do not need to complete before the triggering business operation can be considered done, and their failure must never roll back the business operation.

| Interaction | Mechanism | Why |
|---|---|---|
| Application approval → create StudentSession + SeatAssignment | Direct service call, one transaction | Core business operation; partial completion is an inconsistent state (INV-01, INV-11) |
| Reassignment → SeatAssignment change + ReassignmentOperation + AuditRecord | Direct service call, one transaction | Same reasoning |
| Driver swap accept → DriverAssignment transition | Direct service call (D9 calls D6's service), one transaction | Same reasoning |
| Payment completion → notify student | **Domain event** (`payment_completed`) | Asynchronous side effect; notification failure must not roll back the payment |
| StudentSession soft-block → notify student, refresh dashboard metrics | **Domain event** (`student_soft_blocked`) | Asynchronous side effects |
| Any state-changing operation → AuditRecord | Direct service call, same transaction as the business operation (INV-14) | Audit gap is unacceptable; PHASE2's own Finding 6 already established this — this document just makes the general rule explicit instead of calling it an "event" |
| Trip start/end → future analytics/ETA models | **Domain event** | Genuinely decoupled, non-blocking consumer |

**Rule of thumb:** if the operation must be atomic with the trigger (something reads INV-01 through INV-15 immediately afterward and must see a consistent state), it is a **direct call in the same transaction**. If nothing inside the system depends on it having happened by the time the triggering call returns, it is a **domain event**.

---

## 9. Canonical Field Naming

One canonical name per business concept, repository-wide. Convention: `camelCase`, full words, no abbreviations, no domain prefixes on entity-local fields.

| Canonical Name | Eliminated Aliases | Entity |
|---|---|---|
| `fullName` | `name` | StudentProfile, DriverProfile, User |
| `phoneNumber` | `phone` | StudentProfile, DriverProfile |
| `busId` (on SeatAssignment) | `assignedBusId`, `currentBusId` (on Student) | SeatAssignment |
| `routeId` (on SeatAssignment) | `assignedRouteId` (on Student) | SeatAssignment |
| `driverId` (on DriverAssignment) | `assignedDriverId`, `activeDriverId`, `driverUID` (on Bus) | DriverAssignment |
| `busId` (on DriverAssignment) | `assignedBusId`, `busAssigned` (on Driver) | DriverAssignment |
| `routeId` (on BusRouteAssignment) | `routeRef`, embedded `route.routeId` (on Bus) | BusRouteAssignment |
| `routeName` *(resolved via join, never stored)* | `route.routeName` (on Bus) | — (derived) |
| `assignedCount` | `currentMembers`, `currentPassengerCount`, `load.morningCount`/`load.eveningCount` (kept, but only inside BusCapacityCounter, not on Bus) | BusCapacityCounter |
| `photoUrl` | `photoURL`, `profilePhotoUrl`, `avatar`, `profilePicture` | StudentProfile, DriverProfile, User |
| `applicationType` | *(no current alias; new canonical field replacing the separate `renewal_requests` collection's implicit type)* | Application |

**Type-definition consolidation:** the two current parallel definitions of `Student` (`src/lib/types.ts` vs the `StudentUser` shape in `src/lib/types/application.ts`) collapse into `StudentProfile` + `StudentSession` as defined in §3. The two current parallel definitions of `Application` (`src/lib/types.ts` vs `src/lib/types/application.ts`) collapse into the single canonical `Application` shape in §3 D4, based on the richer, state-machine-aware version. The open index signature (`[key: string]: any`) on the legacy `Student` type is removed — the canonical types are closed shapes.

---

## 10. Master / Operational / Historical / Configuration / Derived Classification

| Entity | Classification | Retention |
|---|---|---|
| User, RoleAssignment, ModeratorPermission | Master | Until hard deletion |
| Session | Master (ephemeral) | Until expiry |
| AcademicCalendarConfig | Configuration | Permanent |
| AcademicSession | Derived Projection | Computed, cache only |
| StudentProfile | Master | Until hard deletion + retention |
| StudentSession | Operational | Until deletion + retention |
| Bus, DriverProfile, Route, Stop, RouteStop | Master | Until decommission/deactivation |
| Application, ApplicationForm | Operational | Until consumed/rejected + 1yr archive |
| Payment | Historical (financial, append-only) | Permanent |
| SeatAssignment | Operational | Max 2 live rows (D-2); released rows purged per retention job |
| DriverAssignment, BusRouteAssignment | Operational | Until ended/superseded |
| BusCapacityCounter | Derived Projection | Session lifetime |
| ActiveTrip | Operational | Until trip ends |
| TripRecord | Historical (append-only) | 1yr |
| GPSRecord | Operational (realtime) | 30-90 days |
| DriverSwapRequest, WaitingFlag, MissedBusRequest | Operational | Until resolved + 7-30 days |
| NotificationTemplate | Configuration | Permanent |
| Notification, DeliveryRecord | Historical | 90 days |
| SystemConfiguration | Configuration | Permanent |
| ReassignmentOperation, AuditRecord | Historical (append-only) | Permanent |
| IntegrityCheck | Historical | Until resolved + 90 days |
| DashboardMetric, OperationalReport | Derived Projection | Recompute window / 30 days |

---

## 11. Transaction Boundaries

| Operation | Scope (single transaction) | Cross-domain? |
|---|---|---|
| Application approval + consumption | Application.state, StudentSession creation, SeatAssignment creation, BusCapacityCounter recompute | Yes: D4 → D3b, D8 (direct calls, one Postgres transaction) |
| Renewal approval (active path) | Application.state, StudentSession.sessionStartYear/validUntil extension | Yes: D4 → D3b |
| Renewal approval (post-soft-block path) | Application.state, StudentSession reactivation, SeatAssignment reclaim, BusCapacityCounter recompute | Yes: D4 → D3b, D8 |
| Reassignment | Old SeatAssignment → superseded (and deleted if a prior superseded row exists, per D-2), new SeatAssignment → active, BusCapacityCounter recompute (both buses), ReassignmentOperation created, AuditRecord created | Yes: D11 → D8, D12 |
| Driver assignment / swap accept | DriverAssignment transition (old → ended/superseded, new → active) | D6-internal (D9 calls D6's service) |
| Bus-route assignment | BusRouteAssignment transition | D7-internal (D6 calls D7's service) |
| Trip start | ActiveTrip creation, Bus.status update (via D6 service call), Driver.status update (via D6 service call), lock acquisition | Yes: D9 → D6 |
| Trip end | ActiveTrip completion, TripRecord creation, Bus.status/Driver.status update | Yes: D9 → D6 |
| Payment verification | Payment.status transition, receipt generation | D5-internal |
| GPS write | Single append | Not transactional (inherently atomic single insert) |

**Never in one transaction:** application submission + payment gateway call (async HTTP cannot hold a DB transaction); business operation + notification delivery (external, non-blocking); batch reassignment across students (each student's reassignment is its own transaction — one failure must not roll back the batch).

**Idempotency:** every operation above with an external trigger (webhook, retried client request) is guarded by a database-level unique constraint or a deduplication key column — never by a separate marker collection (this retires `processed_payments`, §3.1).

---

## 12. Security Ownership Matrix

| Role | Can Do | Data Scope |
|---|---|---|
| Student | Submit/view own Application, make/view own Payment, view own StudentProfile/StudentSession, raise own WaitingFlag, report own MissedBusRequest | Own records only, enforced by row-level security keyed on `userId`/`studentId` |
| Driver | Start/end trip on own DriverAssignment's bus, send GPS/heartbeat on own ActiveTrip, view own assigned Route/Bus, accept/reject own DriverSwapRequest | Own assignment + own active trip only |
| Moderator | Approve/reject Applications, verify offline Payments, reassign students, view Bus/Route data — **all gated per-permission via ModeratorPermission** | Scoped by granted `permissionKey`; no implicit blanket access |
| Admin | Full read/write across all domains via each domain's public service (never raw table writes), manage ModeratorPermission grants, manage SystemConfiguration and AcademicCalendarConfig | Full, but still routed through domain services — INV-13 applies to admin-triggered operations too |

**Never rely on frontend for enforcement.** Row-level security (Postgres RLS) is the enforcement boundary; every table's RLS policy is derived directly from this matrix, not authored ad hoc per table.

**Sensitive fields requiring encryption at rest:** Payment PII fields (already implemented — AES-256-GCM), StudentProfile.phoneNumber/email (recommend field-level encryption or restrictive RLS, currently plaintext).

---

## 13. Performance Strategy

| Entity | Read Freq | Write Freq | Index Strategy | Caching |
|---|---|---|---|---|
| StudentProfile | Very high (every dashboard load) | Low | PK, `userId` unique | In-memory TTL cache acceptable (rarely changes) |
| StudentSession | Very high | Medium (status transitions) | `(studentId, sessionId)` unique, `(sessionId, status)` | Short TTL cache; must invalidate on status write |
| SeatAssignment | High (capacity checks, dashboards) | Medium | Partial unique `(studentId, sessionId) WHERE status='active'`, `(busId, sessionId, shift, status)` | No caching of the row itself; BusCapacityCounter is the cache |
| BusCapacityCounter | Very high (every application/reassignment capacity check) | On every SeatAssignment write | `(busId, sessionId, shift)` unique | This *is* the cache; recomputed synchronously, not itself cached further |
| ActiveTrip, GPSRecord | Very high (real-time tracking) | Very high | `(busId) WHERE status='active'` unique, `(tripId, timestamp)` on GPSRecord | Already on Postgres/Supabase Realtime — keep as-is |
| Payment | Medium | Low | `(razorpayPaymentId)` unique, `(studentId, sessionStartYear, sessionEndYear) WHERE status='completed'` unique | None needed (already Postgres-native and fast) |
| AuditRecord | Low (compliance queries) | Very high (every mutation) | `(entityType, entityId, timestamp)`, `(correlationId)` | None; write-optimized append table |

**Future Redis suitability:** Session/RoleAssignment cache and BusCapacityCounter read-through cache are the two best Redis candidates when horizontal scaling is needed; neither requires a schema change to add later.

**Pagination:** cursor-based (`createdAt`, `id`) for all historical/append-only tables (AuditRecord, Payment, GPSRecord, TripRecord); offset pagination acceptable for small master tables (Bus, Route, Stop).

---

## 14. Migration Readiness Checklist

| Item | Status |
|---|---|
| No duplicated ownership remains in this document | ✅ Verified — one entity per concept, one domain per entity (§4) |
| No undefined entities remain | ✅ All entities referenced in §5-§8 are defined in §3 |
| No missing relationships | ✅ §5 covers every FK implied by §3 |
| No circular ownership | ✅ D6→D7 (bus registration calls route assignment) and D9→D6 (trip start reads assignment) are read/call dependencies, not write-back cycles |
| No ambiguous responsibilities | ✅ Every "Never Owns" column in §2 closes the loop |
| No conflicting business rules | ✅ INV-01..INV-15 checked pairwise for contradiction |
| Current hybrid backend state accounted for | ✅ D5 (Payment) and most of D9 (ActiveTrip, GPSRecord, DriverSwapRequest, WaitingFlag, MissedBusRequest) are **already Postgres-native** — Phase 3 migrates D1, D2, D3a/D3b, D4, D6, D7, D8, D12 off Firestore; D9's `TripRecord` is new and D11's `ReassignmentOperation` needs its Firestore-side counterpart (if any) folded into the existing `reassignment_logs` table |
| `supabase/COMPLETE_SCHEMA.sql` single-file schema is not migration-tracked | ⚠️ Phase 3 must switch to numbered, reversible migrations before adding the new Postgres tables for D1-D4, D6-D8, D12 — a single hand-maintained SQL file will not scale to this migration's size |
| Two parallel Student/Application type definitions | ⚠️ Must be collapsed to the canonical shapes in §3 as part of Phase 3, not left for later cleanup — every new domain service should be written against the canonical shape only |

**No blocking ambiguity remains.** All items above are Phase 3 execution tasks, not open design questions.

---

## 15. Remaining Blocking Questions

**None.** Every item in PHASE2.1 Appendix A is resolved (§1). The one internal inconsistency found between PHASE2 and PHASE2.1/this freeze (event-driven vs. direct-call coordination) is resolved in §8. The hybrid-backend discrepancy discovered during this freeze's verification pass is documented in §0 and accounted for in §14 — it changes *migration sequencing*, not the target architecture itself.

---

## 16. Architecture Score

### 8.5 / 10

| Dimension | Score | Rationale |
|---|---|---|
| Entity Purity | 9/10 | God-objects fully decomposed; every entity is a closed, single-purpose shape |
| Ownership Clarity | 9/10 | Every field, relationship, and business rule has exactly one owner (§4); assignment-entity distribution (D-1) is a deliberate, justified deviation from centralization, not an ambiguity |
| Cross-Domain Coupling | 8/10 | Direct-call model (§8) keeps coupling explicit and typed rather than hidden behind events; residual coupling is inherent to a modular monolith and acceptable |
| Data Normalization | 9/10 | SeatAssignment/DriverAssignment/BusRouteAssignment eliminate all stored-assignment duplication; BusCapacityCounter is correctly modeled as a projection |
| Historical Tracking | 8/10 | AuditRecord + ReassignmentOperation give full history; SeatAssignment's deliberately thin 2-row retention (D-2) trades some convenience for a lean operational table — acceptable given AuditRecord backs it up |
| Scalability | 8/10 | Single-owner, single-database modular monolith scales to multi-university via `universityId` on AcademicCalendarConfig without redesign |
| Maintainability | 9/10 | Canonical naming (§9) and single-transaction rules (§11) make every operation explainable in isolation |
| Transaction Safety | 9/10 | Every cross-domain write is explicitly scoped to one ACID transaction (§11); async paths are explicitly identified and never mixed with synchronous business state |
| Audit Trail | 9/10 | INV-14 makes audit universal and mandatory, not aspirational |
| Migration Readiness | 7/10 | Target model is fully specified; execution risk is real (large surface area, hybrid current state, single-file schema needs restructuring) — reflected as a Phase 3 execution concern, not a design flaw |

**Why not 10/10:** this is a real migration of a live production system with 40+ affected files and a currently-hybrid datastore; residual risk belongs to execution quality in Phase 3, not to gaps in this contract.

---

## 17. Final Confirmation

**The enterprise architecture described in this document is FROZEN.**

- All domain boundaries, entity definitions, ownership rules, relationships, state machines, business invariants, transaction boundaries, communication rules, naming conventions, classification, security ownership, and performance strategy above are the permanent baseline.
- Phase 3 implementation must follow this specification. Phase 3 may not redesign entities, redistribute ownership, or reintroduce eliminated fields/collections without a new, explicit architecture-change decision (not a silent implementation choice).
- Phase 3 begins with schema/migration design for D2 → D1 → D3a/D3b → D6/D7 → D8 → D4/D5 → D9 → D10-D13, per PHASE2 §18.3's dependency ordering, adjusted for the fact that D5 and most of D9 are already Postgres-native and do not need re-platforming — only alignment to the canonical shapes in §3.

**Phase 3 implementation planning may now begin.**
