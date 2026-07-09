# ADTU ITMS — Phase 2.1: Enterprise Domain Model Refinement & Ownership Normalization

**Version:** 2.1.0  
**Date:** 2026-07-05  
**Classification:** Final Architecture Review — Pre-Migration Baseline  
**Status:** Architecture Verification — No Implementation, No SQL, No Migration

---

## 1. Architecture Score

### Score: 6.5 / 10

| Dimension | Score | Notes |
|-----------|-------|-------|
| Entity Purity | 4/10 | Student has 67 fields mixing master, operational, payment, and computed data. Bus has 29 fields mixing physical, operational, and trip state. Driver has 28 fields mixing identity and assignment. |
| Ownership Clarity | 5/10 | 8+ domains write to Bus. 8+ domains write to Student. No single domain owns "which bus is a student on" — it is stored on Student as fields, not as a dedicated entity. |
| Cross-Domain Coupling | 4/10 | Payment writes to Student. Application creates Student. Trip modifies Bus. Driver Swap modifies both Driver and Bus. Reassignment modifies Student + Bus in one transaction. |
| Data Normalization | 3/10 | No SeatAssignment entity (assignment stored on Student). No DriverAssignment entity (stored bidirectionally on Driver + Bus). Route denormalized into Bus. Capacity counters stored on Bus, written by 6+ code paths. |
| Historical Tracking | 3/10 | No assignment history. When student is reassigned, old assignment is overwritten. No driver assignment history. No bus-route assignment history. |
| Scalability | 6/10 | Per-shift capacity model is correct. Atomic transactions are well-structured. But bidirectional sync and cross-domain writes will not scale to multi-university deployment. |
| Maintainability | 7/10 | Business rules are well-documented. Canonical capacity rules are clear. Entitlement system is clean. But legacy aliases, denormalized data, and scattered ownership make the codebase fragile. |
| Transaction Safety | 8/10 | Atomic Firestore transactions used correctly. Idempotency guards in place. Capacity validation in transactions. Dedup guards on seat release. |
| Audit Trail | 8/10 | Comprehensive audit logging. Reassignment logs with rollback data. Tier A (in-transaction) and Tier B (outbox) patterns. |
| Future Readiness | 6/10 | Architecture supports future features conceptually, but the tight coupling means adding multi-campus or new vehicle types would require significant refactoring. |

**Overall Assessment:** The system is production-functional and operationally sound. But the data model has accumulated significant technical debt from organic growth. The lack of dedicated assignment entities, the god-object patterns on Student/Bus/Driver, and the 8+ cross-domain write paths to Bus create a system that is fragile, difficult to reason about, and will not scale cleanly to multi-university deployment.

---

## 2. Major Strengths

1. **Per-shift capacity model is correct.** Morning and Evening are independent. `currentMembers` is derived. This is the right design and must be preserved.

2. **Immutable payment ledger.** Append-only, DELETE blocked at RLS, cryptographic receipts. This is enterprise-grade financial architecture.

3. **Atomic multi-domain transactions.** Application approval, reassignment, driver swap, and session activation all use Firestore transactions correctly. No partial success states.

4. **Comprehensive audit trail.** Every state-changing operation produces an audit record. Reassignment logs support rollback. This is production-grade.

5. **Entitlement system is clean.** `getTransportEntitlement()` is a pure function over student state. Single source of truth. No ad-hoc status checks.

6. **Feature flag architecture.** `SEAT_RELEASE_AT_SOFT_BLOCK` gates entire architectural modes. Enables progressive rollout.

7. **Capacity reconciliation as safety net.** `adminReconcileBusLoads` can correct any counter drift. This is the right defensive pattern.

8. **Idempotent operations.** Deduplication guards across payments, reassignments, swaps, and session activation. Prevents double-processing.

---

## 3. Architectural Weaknesses

### W1: Student is a God Object (CRITICAL)

The Student entity has **67 distinct fields** mixing:

| Category | Fields | Count |
|----------|--------|-------|
| Master (identity) | uid, fullName, email, phoneNumber, enrollmentId, gender, dob, etc. | ~20 |
| Operational (assignment) | busId, routeId, stopId, shift, stopName | ~6 |
| Lifecycle | status, softBlock, hardBlock, seatReleasedAt, validUntil | ~8 |
| Payment | paymentAmount, paid_on, paymentInfo, feesStatus | ~4 |
| Approval audit | approvedBy, approvedAt, approvedById | ~3 |
| Computed deadlines | computed.serviceExpiryDate, computed.renewalDeadlineDate, etc. | ~7 |
| Session | sessionStartYear, sessionEndYear, durationYears | ~3 |
| Legacy aliases | name, phone, assignedBusId, assignedRouteId, pickupPoint, currentBusId, etc. | ~12 |
| Metadata | createdAt, updatedAt, createdBy | ~3 |
| Misc legacy | waitingFlag, boardedFlag, courseDetails, joiningDate, photoURL, avatar, profilePicture | ~4 |

**Why this is a problem:**
- 8+ different domains write to Student (Application, Payment, Renewal, Admin, Cleanup, Session Activation, Reassignment, Expiry Check).
- No single domain "owns" Student — it is written to by almost everyone.
- When a student is reassigned, `busId`, `routeId`, `stopId`, and `shift` are overwritten — the previous assignment is lost forever.
- Payment fields (`paymentAmount`, `paid_on`, `paymentInfo`) duplicate data that belongs in the Payment domain.

### W2: Bus is a Cross-Domain Write Target (CRITICAL)

The Bus entity has **29 distinct fields** and is written to by **8+ different domains**:

| Writer Domain | Fields Written |
|---------------|---------------|
| Fleet Management | busNumber, capacity, status, color |
| Driver Assignment | assignedDriverId, activeDriverId |
| Trip Operations | activeTripLock, activeTripId, lastStartedAt, lastEndedAt |
| Capacity Service | load.morningCount, load.eveningCount, currentMembers |
| Route Management | routeId, routeRef, route (denormalized object) |
| Driver Swap | activeDriverId, assignedDriverId |
| Session Activation | load.morningCount, load.eveningCount, currentMembers |
| Cleanup Cron | activeDriverId, activeTripLock |
| Reconciliation | load.morningCount, load.eveningCount, currentMembers |

**Why this is a problem:**
- No single domain owns Bus. Every domain reaches in and modifies it.
- The most-written-to fields (capacity counters) are written by 6+ independent code paths.
- A bug in ANY writer can corrupt Bus state.
- Bus conflates physical identity, driver assignment, trip state, route assignment, and capacity — all different business concerns.

### W3: No Assignment Entities (CRITICAL)

The system has **NO dedicated entity** for:
- **SeatAssignment** — "which student is on which bus" is stored as `busId`, `routeId`, `stopId`, `shift` on the Student document.
- **DriverAssignment** — "which driver drives which bus" is stored bidirectionally on Driver (`assignedBusId`) and Bus (`assignedDriverId`).
- **BusRouteAssignment** — "which route does a bus run" is stored as `routeId` on the Bus document.

**Why this is a problem:**
- **No history.** When a student is reassigned, the old assignment is overwritten. There is no record of which bus the student was previously on.
- **No rollback.** The reassignment service stores rollback data in a separate log, but the actual assignment history is lost.
- **Bidirectional sync.** Driver and Bus must be updated in lockstep. If one write fails, the system is in an inconsistent state.
- **Multiple write paths.** Bus is written by 8+ domains. Driver is written by 4+ domains. No single domain controls the assignment.

### W4: Payment Directly Mutates Student (HIGH)

The function `applyPaymentValidityToStudent()` in `payment.service.ts` writes directly to Student:
- `validUntil`
- `status`
- `sessionStartYear`
- `sessionEndYear`
- `lastRenewalDate`

**Why this is a problem:**
- Payment is a financial record. It should not own student lifecycle state.
- The Payment domain writing to Student creates hidden coupling.
- If the student write fails after payment is recorded, the system is inconsistent.

### W5: Capacity Counters Are Multi-Writer (HIGH)

`load.morningCount`, `load.eveningCount`, and `currentMembers` on Bus are written by:
1. Application approval (increment)
2. Session activation (increment)
3. Reassignment (decrement source + increment destination)
4. Soft block / seat release (decrement)
5. Hard delete (decrement)
6. Manual deletion (decrement)
7. Reconciliation (overwrite)
8. Admin update (decrement source + increment destination)

**Why this is a problem:**
- 8 independent code paths write the same fields.
- A bug in any path creates counter drift.
- The reconciliation service exists specifically to fix drift caused by this design.
- In a normalized model, these counters would be derived from SeatAssignment counts, not independently stored.

### W6: Route Denormalized into Bus (MEDIUM)

Bus stores a denormalized copy of Route data:
- `routeId`, `routeRef`, `route.routeId`, `route.routeName`, `route.stops`, `route.totalStops`

**Why this is a problem:**
- When a route is updated, all buses on that route must be updated (see `routes/[id]/update/route.ts` line 42-45).
- The denormalized route data can become stale.
- Route data belongs in the Route domain, not duplicated across Bus documents.

### W7: Legacy Aliases Create Confusion (MEDIUM)

At least 20 legacy field aliases exist:
- `name` / `fullName` (Student, Driver)
- `phone` / `phoneNumber` (Student, Driver)
- `busId` / `assignedBusId` / `currentBusId` (Student)
- `routeId` / `assignedRouteId` (Student, Driver)
- `pickupPoint` / `stopName` / `stopId` (Student)
- `driverUID` / `assignedDriverId` / `activeDriverId` (Bus)
- `route` / `routeName` / `routeId` (Bus)
- `currentPassengerCount` / `currentMembers` (Bus)

**Why this is a problem:**
- Two names for the same data create confusion.
- Code must check multiple fields to find the canonical value.
- The `getEffectiveDriverId()` and `getEffectiveBusId()` functions exist solely to resolve these aliases.

### W8: No Formal Event/Message System (LOW)

Cross-domain communication is entirely through direct function calls and database writes. There is no formal event bus, message queue, or publish-subscribe system.

**Why this is a problem (for future scaling):**
- Adding a new notification type for an existing operation requires modifying the operation's code.
- Analytics cannot subscribe to business events without modifying the source code.
- Multi-campus deployment would benefit from async event propagation.

---

## 4. Hidden Coupling Discovered

| Coupling | Source | Target | Impact |
|----------|--------|--------|--------|
| Payment → Student | `applyPaymentValidityToStudent()` | Student.validUntil, status | Payment failure after student write = inconsistency |
| Application → Student | `session-activation.service.ts` | Student (30+ fields) | Application approval creates entire student document |
| Application → Bus | `session-activation.service.ts` | Bus capacity counters | Application approval modifies bus state |
| Trip → Bus | `trip-lock-service.ts` | Bus.activeTripLock, activeDriverId | Trip operations modify bus operational state |
| Driver Swap → Bus | `driver-swap-supabase.ts` | Bus.activeDriverId, assignedDriverId | Swap modifies bus driver assignment |
| Driver Swap → Driver | `driver-swap-supabase.ts` | Driver.assignedBusId, routeId | Swap modifies driver assignment |
| Reassignment → Student | `reassignment-service.ts` | Student.busId, routeId, shift | Reassignment modifies student operational fields |
| Reassignment → Bus | `reassignment-service.ts` | Bus capacity counters | Reassignment modifies bus counters |
| Cleanup → Student | `cleanup-expired-students/route.ts` | Student.status, seatReleasedAt | Cron modifies student lifecycle |
| Cleanup → Bus | `cleanup-expired-students/route.ts` | Bus capacity counters | Cron modifies bus counters |
| Cleanup → Application | `cleanup-expired-students/route.ts` | Application.state | Cron modifies application state |
| Route Update → Bus | `routes/[id]/update/route.ts` | Bus.route (denormalized) | Route change propagates to all buses |
| Admin Update → Student + Bus | `admin/update-user/route.ts` | Student + Bus in one transaction | Admin modifies both domains atomically |
| Admin Create → Student + User + Bus | `admin/create-user/route.ts` | All three in one transaction | Admin creates across three domains |

**Total cross-domain write paths: 14+**

---

## 5. Duplicated Ownership Discovered

| Business Concept | Currently Owned By | Should Be Owned By |
|-----------------|-------------------|-------------------|
| "Which bus is student X on?" | Student (busId field) | SeatAssignment |
| "Which route is student X on?" | Student (routeId field) | SeatAssignment |
| "Which shift does student X attend?" | Student (shift field) | SeatAssignment |
| "Which stop does student X board at?" | Student (stopId, stopName fields) | SeatAssignment |
| "Which driver drives bus X?" | Bus (assignedDriverId, activeDriverId) AND Driver (assignedBusId) | DriverAssignment |
| "Which route does bus X run?" | Bus (routeId, route denormalized) AND Route (assignedBuses) | BusRouteAssignment |
| "How many students are on bus X morning trip?" | Bus (load.morningCount) | Derived from SeatAssignment count |
| "How many students are on bus X evening trip?" | Bus (load.eveningCount) | Derived from SeatAssignment count |
| "When does student X's transport expire?" | Student (validUntil) AND Payment (valid_until) | StudentSession (derived from AcademicCalendar) |
| "What payment did student X make?" | Student (paymentAmount, paid_on, paymentInfo) AND Payment (amount, status) | Payment only |
| "Is student X currently entitled to transport?" | Student (status) AND computed function AND seatReleasedAt | Derived from StudentSession + SeatAssignment |

---

## 6. Fields That Should Move

### From Student → SeatAssignment (Operational)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `busId` | Student | SeatAssignment.busId | Assignment is operational, not master |
| `routeId` | Student | SeatAssignment.routeId | Assignment is operational, not master |
| `stopId` | Student | SeatAssignment.stopId | Assignment is operational, not master |
| `stopName` | Student | SeatAssignment.stopName | Assignment is operational, not master |
| `shift` | Student | SeatAssignment.shift | Assignment is operational, not master |
| `seatReleasedAt` | Student | SeatAssignment.releasedAt | Assignment lifecycle, not student attribute |

### From Student → Payment (Financial)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `paymentAmount` | Student | Payment.amount | Financial data belongs in Payment |
| `paid_on` | Student | Payment.completedAt | Financial data belongs in Payment |
| `paymentInfo` | Student | Payment (already exists) | Financial data belongs in Payment |
| `feesStatus` | Student | Payment.status | Financial data belongs in Payment |

### From Student → StudentSession (Session)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `sessionStartYear` | Student | StudentSession.sessionStartYear | Session data, not student attribute |
| `sessionEndYear` | Student | StudentSession.sessionEndYear | Session data, not student attribute |
| `durationYears` | Student | StudentSession.durationYears | Session data, not student attribute |
| `validUntil` | Student | StudentSession.validUntil | Derived from calendar + session |
| `softBlock` | Student | StudentSession.softBlockDate | Derived from calendar + session |
| `hardBlock` | Student | StudentSession.hardBlockDate | Derived from calendar + session |
| `softBlockedAt` | Student | StudentSession.softBlockedAt | Lifecycle event, not student attribute |
| `hardDeleteScheduledAt` | Student | StudentSession.hardDeleteDate | Lifecycle event, not student attribute |
| `lastRenewalDate` | Student | StudentSession.lastRenewalAt | Session data, not student attribute |
| `computed.*` (7 fields) | Student | StudentSession (derived) | Derived from calendar, should not be stored |

### From Bus → DriverAssignment (Assignment)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `assignedDriverId` | Bus | DriverAssignment.driverId | Assignment, not bus property |
| `activeDriverId` | Bus | DriverAssignment.activeDriverId (or ActiveTrip) | Assignment, not bus property |
| `driverUID` | Bus | (legacy, remove) | Alias, already replaced |

### From Bus → BusRouteAssignment (Assignment)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `routeId` | Bus | BusRouteAssignment.routeId | Assignment, not bus property |
| `routeRef` | Bus | (remove, use FK) | Firestore reference, not needed in normalized model |
| `route.routeId` | Bus | (remove, denormalized) | Redundant with Route entity |
| `route.routeName` | Bus | (remove, denormalized) | Redundant with Route entity |
| `route.stops` | Bus | (remove, denormalized) | Redundant with Route entity |
| `route.totalStops` | Bus | (remove, denormalized) | Redundant with Route entity |
| `routeName` | Bus | (legacy, remove) | Alias |

### From Bus → ActiveTrip (Operational)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `activeTripLock` | Bus | ActiveTrip | Trip state, not bus property |
| `activeTripId` | Bus | ActiveTrip.tripId | Trip state, not bus property |
| `lastStartedAt` | Bus | TripRecord.startedAt | Trip state, not bus property |
| `lastEndedAt` | Bus | TripRecord.endedAt | Trip state, not bus property |

### From Driver → DriverAssignment (Assignment)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `assignedBusId` | Driver | DriverAssignment.busId | Assignment, not driver property |
| `busId` | Driver | (legacy, remove) | Alias |
| `busAssigned` | Driver | (legacy, remove) | Alias |
| `assignedRouteId` | Driver | DriverAssignment.routeId | Assignment, not driver property |
| `routeId` | Driver | (legacy, remove) | Alias |
| `tripActive` | Driver | ActiveTrip (derived) | Trip state, not driver property |
| `activeTripId` | Driver | ActiveTrip.tripId | Trip state, not driver property |

### From Driver → ActiveTrip (Operational)

| Field | Current Location | Target | Reason |
|-------|-----------------|--------|--------|
| `tripActive` | Driver | ActiveTrip | Trip state belongs in Trip domain |
| `activeTripId` | Driver | ActiveTrip | Trip state belongs in Trip domain |

---

## 7. New Entities That Should Exist

### 7.1 SeatAssignment

**Purpose:** The single canonical record of "which student is on which bus, which route, which stop, which shift."

| Attribute | Type | Constraints |
|-----------|------|-------------|
| assignmentId | UUID | Primary key |
| studentId | FK → StudentProfile | Required, indexed |
| busId | FK → Bus | Required, indexed |
| routeId | FK → Route | Required |
| stopId | FK → Stop | Required |
| shift | ENUM (Morning, Evening) | Required |
| sessionId | FK → AcademicSession | Required, indexed |
| status | ENUM (active, superseded, released) | Required, indexed |
| assignedAt | TIMESTAMP | Immutable |
| assignedBy | FK → User | Required |
| releasedAt | TIMESTAMP | Nullable |
| releaseReason | ENUM (reassigned, soft_blocked, deleted, admin) | Nullable |
| supersededAt | TIMESTAMP | Nullable (when replaced by new assignment) |
| supersededBy | FK → SeatAssignment | Nullable (FK to replacement assignment) |
| createdAt | TIMESTAMP | Immutable |
| updatedAt | TIMESTAMP | Updated on change |

**Constraints:**
- UNIQUE (studentId, sessionId, status) WHERE status = 'active' — one active assignment per student per session
- INDEX on (busId, sessionId, shift) — for capacity counting
- INDEX on (sessionId, status) — for session-level queries

**Lifecycle:**
1. Created when application is approved or student is created.
2. Status = 'active' while student uses transport.
3. On reassignment: current assignment → status='superseded', new assignment → status='active'.
4. On soft block: status='released', releaseReason='soft_blocked'.
5. On hard delete: status='released', releaseReason='deleted'.
6. Superseded records retained for rollback (configurable depth, default: last 1).

**History:** Superseded records are retained. Long-term history belongs to AuditRecord.

### 7.2 DriverAssignment

**Purpose:** The single canonical record of "which driver is assigned to which bus and route."

| Attribute | Type | Constraints |
|-----------|------|-------------|
| assignmentId | UUID | Primary key |
| driverId | FK → DriverProfile | Required, indexed |
| busId | FK → Bus | Required, indexed |
| routeId | FK → Route | Required |
| shift | ENUM (Morning, Evening, Both) | Required |
| assignmentType | ENUM (permanent, temporary, swap) | Required |
| status | ENUM (active, superseded, ended) | Required, indexed |
| assignedAt | TIMESTAMP | Immutable |
| assignedBy | FK → User | Required |
| expiresAt | TIMESTAMP | Nullable (for temporary/swap assignments) |
| endedAt | TIMESTAMP | Nullable |
| endReason | ENUM (reassigned, swap_reverted, admin, expired) | Nullable |
| createdAt | TIMESTAMP | Immutable |
| updatedAt | TIMESTAMP | Updated on change |

**Constraints:**
- UNIQUE (busId, status) WHERE status = 'active' — one active assignment per bus
- UNIQUE (driverId, status) WHERE status = 'active' — one active assignment per driver
- INDEX on (driverId, status) — for driver lookup

**Lifecycle:**
1. Created when admin assigns a driver to a bus.
2. Status = 'active' while driver is assigned.
3. On reassignment: current → status='ended', new → status='active'.
4. On swap: current → status='ended', swap → status='active' with assignmentType='swap'.
5. On swap revert: swap → status='ended', original → status='active'.
6. On driver deactivation: status='ended'.

### 7.3 BusRouteAssignment

**Purpose:** The single canonical record of "which route does a bus run."

| Attribute | Type | Constraints |
|-----------|------|-------------|
| assignmentId | UUID | Primary key |
| busId | FK → Bus | Required, indexed |
| routeId | FK → Route | Required, indexed |
| status | ENUM (active, superseded) | Required |
| assignedAt | TIMESTAMP | Immutable |
| assignedBy | FK → User | Required |
| supersededAt | TIMESTAMP | Nullable |
| createdAt | TIMESTAMP | Immutable |
| updatedAt | TIMESTAMP | Updated on change |

**Constraints:**
- UNIQUE (busId, status) WHERE status = 'active' — one active route per bus

**Lifecycle:**
1. Created when admin assigns a route to a bus.
2. Status = 'active' while bus runs this route.
3. On route change: current → status='superseded', new → status='active'.

### 7.4 StudentSession

**Purpose:** The session-level record for a student, containing all session-dependent lifecycle data.

| Attribute | Type | Constraints |
|-----------|------|-------------|
| studentSessionId | UUID | Primary key |
| studentId | FK → StudentProfile | Required, indexed |
| sessionId | FK → AcademicSession | Required, indexed |
| status | ENUM (pending_approval, active, pending_renewal, soft_blocked, hard_blocked, suspended, deleted) | Required |
| validUntil | TIMESTAMP | Derived from calendar |
| softBlockDate | TIMESTAMP | Derived from calendar |
| hardBlockDate | TIMESTAMP | Derived from calendar |
| softBlockedAt | TIMESTAMP | Nullable |
| seatReleasedAt | TIMESTAMP | Nullable |
| lastRenewalAt | TIMESTAMP | Nullable |
| createdAt | TIMESTAMP | Immutable |
| updatedAt | TIMESTAMP | Updated on change |

**Constraints:**
- UNIQUE (studentId, sessionId) — one session record per student per session

**Lifecycle:**
1. Created when application is approved.
2. Status transitions through the student lifecycle state machine.
3. Dates derived from AcademicCalendarConfig + sessionStartYear.
4. Retained after hard deletion for audit purposes.

### 7.5 TripRecord

**Purpose:** Historical record of completed trips (separate from ActiveTrip which is operational).

| Attribute | Type | Constraints |
|-----------|------|-------------|
| tripRecordId | UUID | Primary key |
| tripId | FK → ActiveTrip | Required (links to operational record) |
| busId | FK → Bus | Required, indexed |
| driverId | FK → Driver | Required, indexed |
| routeId | FK → Route | Required |
| shift | ENUM (Morning, Evening) | Required |
| sessionId | FK → AcademicSession | Required |
| startedAt | TIMESTAMP | Required |
| endedAt | TIMESTAMP | Required |
| duration | INTERVAL | Derived |
| totalGpsPoints | INTEGER | Derived |
| totalDistance | NUMERIC | Derived |
| status | ENUM (completed, failed, aborted) | Required |
| createdAt | TIMESTAMP | Immutable |

**Lifecycle:**
1. Created when ActiveTrip transitions to 'ended' or 'failed'.
2. Append-only. Never modified or deleted.
3. Retained for analytics and audit.
4. GPS records linked via tripId.

---

## 8. Entities That Should Disappear

| Entity | Reason | Replacement |
|--------|--------|-------------|
| `renewal_requests` (Firestore) | Duplicate of Application with type='renewal'. Separate collection creates dual flow. | Application entity with applicationType='renewal' |
| `processed_payments` (Firestore) | Deduplication guard that should be a database constraint, not a separate collection. | Unique constraint on Payment.payment_id |
| `verificationCodes` (Firestore) | Temporary data that should use a short-lived store (Redis, in-memory, or Supabase with TTL). | Ephemeral store with auto-expiry |
| `pendingProfileUpdates` (Firestore) | Temporary data that should use a short-lived store. | Ephemeral store with auto-expiry |
| `bus.currentStudents` (field) | Legacy array of student IDs. Redundant with SeatAssignment query. | Query SeatAssignment by busId |
| `bus.currentPassengerCount` (field) | Legacy counter. Redundant with capacity counters. | BusCapacityCounter (materialized) |
| `bus.route` (denormalized object) | Denormalized route data. Stale risk. | Query Route by busId via BusRouteAssignment |
| `bus.routeRef` (field) | Firestore DocumentReference. Not needed in normalized model. | FK to Route |
| `bus.routeName` (field) | Denormalized route name. | Query Route via BusRouteAssignment |
| All 20+ legacy aliases | Two names for the same data. | Canonical names only |

---

## 9. Domain Boundary Improvements

### Current Boundaries (Phase 2)

```
D1: IAM
D2: Academic Calendar
D3: Student Lifecycle
D4: Application Processing
D5: Payment & Financial Ledger
D6: Fleet Management
D7: Route & Stop Management
D8: Seat & Capacity Management
D9: Trip Operations
D10: Notification & Communication
D11: Administration & Moderation
D12: Audit & Compliance
D13: Analytics & Reporting
```

### Recommended Boundary Changes

| Change | Rationale |
|--------|-----------|
| **D3 split into D3a: Student Profile + D3b: Student Session** | Student Profile is master data (identity). Student Session is session-dependent lifecycle data. Different lifecycles, different retention. |
| **D6: Fleet Management remains** but loses operational fields | Bus becomes pure master data (physical properties only). Driver becomes pure master data (identity only). |
| **D8: Seat & Capacity gains SeatAssignment, DriverAssignment, BusRouteAssignment** | These assignment entities are the core of this domain. Capacity counters become materialized projections. |
| **D9: Trip Operations gains ActiveTrip, TripRecord** | ActiveTrip is operational. TripRecord is historical. GPS records are operational (short retention). |
| **D11: Administration remains** but loses direct entity writes | Admin orchestrates through domain services, never writes directly to other domains' entities. |

### Revised Domain Map

```
D1: IAM
  Owns: User, RoleAssignment, Session, ModeratorPermission

D2: Academic Calendar
  Owns: AcademicCalendarConfig, AcademicSession (computed)

D3a: Student Profile
  Owns: StudentProfile (identity/personal data ONLY)

D3b: Student Session
  Owns: StudentSession (lifecycle status, session dates, entitlement)

D4: Application Processing
  Owns: Application, ApplicationForm

D5: Payment & Financial Ledger
  Owns: Payment (immutable ledger)

D6: Fleet Management
  Owns: Bus (physical properties ONLY), Driver (identity ONLY)

D7: Route & Stop Management
  Owns: Route, Stop, RouteStop

D8: Seat & Capacity Management
  Owns: SeatAssignment, DriverAssignment, BusRouteAssignment, BusCapacityCounter

D9: Trip Operations
  Owns: ActiveTrip, TripRecord, GPSRecord, DriverSwapRequest, WaitingFlag, MissedBusRequest

D10: Notification & Communication
  Owns: NotificationTemplate, Notification, DeliveryRecord

D11: Administration & Moderation
  Owns: SystemConfiguration, ReassignmentOperation (rollback data ONLY)

D12: Audit & Compliance
  Owns: AuditRecord, IntegrityCheck

D13: Analytics & Reporting
  Owns: DashboardMetric, OperationalReport
```

---

## 10. Assignment Model Recommendation

### SeatAssignment

| Aspect | Design |
|--------|--------|
| **Purpose** | Canonical record of student-to-bus assignment |
| **Owner** | D8: Seat & Capacity Management |
| **Lifecycle** | Created on approval → Active → Superseded on reassignment / Released on soft block |
| **Transaction boundary** | Always atomic with StudentSession status change and BusCapacityCounter update |
| **Business rules** | One active per student per session; capacity validation before creation; shift-specific |
| **History** | Superseded records retained (last N for rollback). Long-term in AuditRecord. |
| **Rollback** | SupersededBy FK links to replacement. Reversal creates new assignment, does not un-supersede. |
| **Indexes** | (studentId, sessionId, status), (busId, sessionId, shift, status), (sessionId, status) |
| **Concurrency** | Optimistic concurrency via updatedAt. Transaction validates before commit. |

### DriverAssignment

| Aspect | Design |
|--------|--------|
| **Purpose** | Canonical record of driver-to-bus-route assignment |
| **Owner** | D8: Seat & Capacity Management (or D6: Fleet, pending decision) |
| **Lifecycle** | Created on assignment → Active → Ended on reassignment / swap |
| **Transaction boundary** | Atomic with Bus record update (if Bus still stores last-assigned-driver for display) |
| **Business rules** | One active per bus; one active per driver; swap creates temporary with expiry |
| **History** | Ended records retained for audit. |
| **Rollback** | Swap revert ends current assignment and re-activates previous. |
| **Indexes** | (driverId, status), (busId, status), (assignmentType, status) |
| **Concurrency** | Optimistic concurrency. Swap uses dedicated lock. |

### BusRouteAssignment

| Aspect | Design |
|--------|--------|
| **Purpose** | Canonical record of bus-to-route assignment |
| **Owner** | D7: Route & Stop Management (or D8: Seat & Capacity, pending decision) |
| **Lifecycle** | Created on assignment → Active → Superseded on route change |
| **Transaction boundary** | Can be independent (route change does not affect students unless route is decommissioned) |
| **Business rules** | One active per bus; route must exist and be active |
| **History** | Superseded records retained for audit. |
| **Rollback** | Re-assign previous route (creates new superseded → active transition). |
| **Indexes** | (busId, status), (routeId, status) |
| **Concurrency** | Optimistic concurrency. Low contention. |

---

## 11. Final Normalized Business Model

### Master Data Entities

| Entity | Domain | Purpose | Key Fields |
|--------|--------|---------|------------|
| **User** | D1: IAM | Authentication identity | userId, email, displayName, authProvider, createdAt |
| **RoleAssignment** | D1: IAM | User role mapping | userId, role, assignedAt, isActive |
| **Session** | D1: IAM | Active auth session | sessionId, userId, deviceId, expiresAt |
| **ModeratorPermission** | D1: IAM | Granular permissions | moderatorUserId, permissionKey, grantedAt |
| **AcademicCalendarConfig** | D2: Calendar | Date rules | configId, universityId, startMonth, startDay, blocking delays |
| **AcademicSession** | D2: Calendar | Computed session | sessionId, configId, startDate, endDate, renewalDates |
| **StudentProfile** | D3a: Student | Identity ONLY | studentId, userId, fullName, email, phoneNumber, enrollmentId, gender, dob, faculty, department |
| **Bus** | D6: Fleet | Physical properties | busId, busNumber, capacity, status, color |
| **DriverProfile** | D6: Driver | Identity ONLY | driverId, userId, fullName, email, phoneNumber, licenseNumber, status |
| **Route** | D7: Routes | Route definition | routeId, routeName, status |
| **Stop** | D7: Routes | Stop definition | stopId, stopName, latitude, longitude |
| **RouteStop** | D7: Routes | Stop sequencing | routeId, stopId, sequenceOrder |

### Operational Data Entities

| Entity | Domain | Purpose | Key Fields |
|--------|--------|---------|------------|
| **StudentSession** | D3b: Session | Student lifecycle per session | studentId, sessionId, status, validUntil, softBlockDate |
| **SeatAssignment** | D8: Seat | Student-to-bus assignment | studentId, busId, routeId, stopId, shift, sessionId, status |
| **DriverAssignment** | D8: Seat | Driver-to-bus assignment | driverId, busId, routeId, shift, assignmentType, status |
| **BusRouteAssignment** | D8: Seat | Bus-to-route assignment | busId, routeId, status |
| **BusCapacityCounter** | D8: Seat | Materialized capacity | busId, sessionId, shift, assignedCount, capacity |
| **ActiveTrip** | D9: Trip | Running trip state | tripId, busId, driverId, routeId, shift, status, lastHeartbeatAt |
| **GPSRecord** | D9: Trip | Real-time location | tripId, busId, lat, lng, speed, timestamp |
| **DriverSwapRequest** | D9: Trip | Swap state | swapId, fromDriverId, toDriverId, status, expiresAt |
| **WaitingFlag** | D9: Trip | Student waiting signal | studentId, busId, stopId, status |
| **MissedBusRequest** | D9: Trip | Missed bus recovery | studentId, originalBusId, alternateBusId, status |
| **Application** | D4: Application | Transport request | applicationId, applicantUserId, type, state, formData |
| **Payment** | D5: Payment | Financial record | paymentId, applicationId, amount, method, status, documentSignature |

### Historical Data Entities

| Entity | Domain | Purpose | Key Fields |
|--------|--------|---------|------------|
| **TripRecord** | D9: Trip | Completed trip archive | tripId, busId, driverId, startedAt, endedAt, duration |
| **ReassignmentOperation** | D11: Admin | Rollback data | operationId, studentId, source, destination, rollbackData |
| **AuditRecord** | D12: Audit | Immutable audit trail | auditId, entityType, entityId, action, actorId, beforeState, afterState |
| **IntegrityCheck** | D12: Audit | Consistency verification | checkId, entityType, entityId, expectedState, actualState |
| **Notification** | D10: Notification | In-app messages | notificationId, recipientUserId, title, body, isRead |
| **DeliveryRecord** | D10: Notification | Delivery tracking | deliveryId, templateId, channel, status |
| **SystemConfiguration** | D11: Admin | System settings | configKey, configValue, lastModifiedBy |

### Configuration Data Entities

| Entity | Domain | Purpose | Key Fields |
|--------|--------|---------|------------|
| **AcademicCalendarConfig** | D2: Calendar | Date rules | (listed above under Master) |
| **SystemConfiguration** | D11: Admin | Feature flags, settings | (listed above under Historical) |
| **NotificationTemplate** | D10: Notification | Message templates | templateId, templateName, channel, bodyTemplate |

---

## 12. Final Master/Operational/History Classification

| Entity | Classification | Retention | Consistency | Write Pattern |
|--------|---------------|-----------|-------------|---------------|
| User | Master | Until hard deletion + 2yr | Strong | Single writer (IAM) |
| RoleAssignment | Master | Until hard deletion | Strong | Single writer (IAM) |
| Session | Master (ephemeral) | Until expiry | Strong | Single writer (IAM) |
| ModeratorPermission | Master | Until revoked | Strong | Single writer (IAM) |
| AcademicCalendarConfig | Master | Permanent | Strong | Single writer (Calendar) |
| AcademicSession | Master (derived) | Permanent | Strong | Computed, not written |
| StudentProfile | Master | Until hard deletion | Strong | Single writer (D3a) |
| Bus | Master | Until decommission | Strong | Single writer (Fleet) |
| DriverProfile | Master | Until deactivation | Strong | Single writer (Fleet) |
| Route | Master | Until decommission | Strong | Single writer (Routes) |
| Stop | Master | Until decommission | Strong | Single writer (Routes) |
| RouteStop | Master | Until route decommission | Strong | Single writer (Routes) |
| StudentSession | Operational | Until deletion + retention | Strong | Single writer (D3b) |
| SeatAssignment | Operational | Until superseded + rollback depth | Strong | Single writer (D8) |
| DriverAssignment | Operational | Until ended | Strong | Single writer (D8) |
| BusRouteAssignment | Operational | Until superseded | Strong | Single writer (D8) |
| BusCapacityCounter | Operational (derived) | Session lifetime | Eventual OK (recomputed on write) | Derived from SeatAssignment |
| ActiveTrip | Operational | Until trip ends | Strong | Single writer (Trip Ops) |
| GPSRecord | Operational (realtime) | 30-90 days | Eventual OK | Append-only |
| DriverSwapRequest | Operational | Until resolved + 30d | Strong | Single writer (Trip Ops) |
| WaitingFlag | Operational | Until resolved or expires | Eventual OK | Single writer (Trip Ops) |
| MissedBusRequest | Operational | Until resolved + 30d | Strong | Single writer (Trip Ops) |
| Application | Operational | Until consumed/rejected + 1yr | Strong | Single writer (D4) |
| Payment | Historical (financial) | Permanent | Strong (ACID) | Append-only |
| TripRecord | Historical | 1yr | Strong | Append-only |
| ReassignmentOperation | Historical | Permanent | Strong | Append-only |
| AuditRecord | Historical | Permanent | Strong | Append-only |
| IntegrityCheck | Historical | Until resolved + 90d | Strong | Append-only |
| Notification | Historical | 90 days | Strong | Single writer (D10) |
| DeliveryRecord | Historical | 90 days | Strong | Append-only |
| SystemConfiguration | Configuration | Permanent | Strong | Single writer (Admin) |
| NotificationTemplate | Configuration | Permanent | Strong | Single writer (D10) |

---

## 13. Final Ownership Matrix

| Entity | Created By | Modified By | Read By | Never Modified By |
|--------|-----------|-------------|---------|-------------------|
| User | D1: IAM | D1: IAM | All | All non-IAM |
| RoleAssignment | D1: IAM | D1: IAM | D1, D11 | All non-IAM |
| Session | D1: IAM | D1: IAM | D1 | All non-IAM |
| ModeratorPermission | D1: IAM | D1: IAM | D4, D8, D9, D11 | All non-IAM |
| AcademicCalendarConfig | D2: Calendar | D2: Calendar | D3b, D4, D5, D8, D11 | All non-Calendar |
| AcademicSession | D2: Calendar | Never (computed) | D3b, D4, D5, D8, D9 | Everyone (derived) |
| StudentProfile | D3a: Student | D3a: Student | D3b, D4, D5, D8, D9, D10, D11, D12 | D4, D5, D8, D9, D10 (no writes) |
| StudentSession | D3b: Session | D3b: Session | D4, D5, D8, D9, D11, D12, D13 | D4, D5, D8, D9 (no writes) |
| Bus | D6: Fleet | D6: Fleet | D7, D8, D9, D11, D12, D13 | D7, D8, D9, D11 (no property writes) |
| DriverProfile | D6: Fleet | D6: Fleet | D1, D8, D9, D11, D12, D13 | D1, D8, D9 (no profile writes) |
| Route | D7: Routes | D7: Routes | D6, D8, D9, D11 | D6, D8, D9 (no route writes) |
| Stop | D7: Routes | D7: Routes | D4, D8, D11 | D4, D8 (no stop writes) |
| RouteStop | D7: Routes | D7: Routes | D8, D11 | D8, D11 (no writes) |
| SeatAssignment | D8: Seat | D8: Seat (status only) | D3b, D9, D11, D12, D13 | D3b, D9, D11 (no direct writes) |
| DriverAssignment | D8: Seat | D8: Seat (status only) | D6, D9, D11, D12 | D6, D9, D11 (no direct writes) |
| BusRouteAssignment | D8: Seat | D8: Seat (status only) | D6, D9, D11 | D6, D9, D11 (no direct writes) |
| BusCapacityCounter | D8: Seat | D8: Seat (recompute) | D3b, D4, D11, D13 | All other domains (derived) |
| ActiveTrip | D9: Trip | D9: Trip (status, heartbeat) | D6, D8, D11, D12, D13 | D6, D8, D11 (no trip writes) |
| TripRecord | D9: Trip | Never (append-only) | D12, D13 | Everyone (historical) |
| GPSRecord | D9: Trip | Never (append-only) | D9, D13 | Everyone (historical) |
| DriverSwapRequest | D9: Trip | D9: Trip (status) | D6, D8, D11, D12 | D6, D8, D11 (no swap writes) |
| WaitingFlag | D9: Trip | D9: Trip (status) | D9, D11 | D11 (no flag writes) |
| MissedBusRequest | D9: Trip | D9: Trip (status) | D9, D11 | D11 (no request writes) |
| Application | D4: Application | D4: Application (state) | D3b, D5, D11, D12 | D3b, D5, D8 (no application writes) |
| Payment | D5: Payment | D5: Payment (status only) | D3b, D4, D11, D12, D13 | D3b, D4, D11 (no payment writes) |
| Notification | D10: Notification | D10: Notification (read status) | D1, D3a | D1, D3a (no notification writes) |
| DeliveryRecord | D10: Notification | Never (append-only) | D10, D12 | Everyone (historical) |
| SystemConfiguration | D11: Admin | D11: Admin | All | All non-admin |
| ReassignmentOperation | D11: Admin | D11: Admin (revert flag) | D3b, D8, D12 | D3b, D8 (no reassignment writes) |
| AuditRecord | D12: Audit | Never (append-only) | D12, D13 | Everyone (historical) |
| IntegrityCheck | D12: Audit | D12: Audit (resolve) | D11, D12 | D11 (no integrity writes) |

---

## 14. Final Architecture Decisions Before Migration

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| AD-1 | Assignment entities | Dedicated entities (SeatAssignment, DriverAssignment, BusRouteAssignment) | Single source of truth, history tracking, eliminates bidirectional sync |
| AD-2 | Capacity counters | Materialized projection from SeatAssignment | Fast reads, always consistent within transaction, not an independent source of truth |
| AD-3 | Student model | Split into StudentProfile (master) + StudentSession (operational) | Clean separation of identity from session-dependent lifecycle |
| AD-4 | Bus model | Pure master data only (busId, busNumber, capacity, status, color) | All operational fields move to dedicated entities |
| AD-5 | Driver model | Pure master data only (driverId, userId, fullName, etc.) | All assignment fields move to DriverAssignment |
| AD-6 | Payment → Student | Payment emits event; Student lifecycle service processes it | Decouples financial domain from student lifecycle |
| AD-7 | Cross-domain communication | Direct service calls for synchronous operations; events for async side effects | Simple, debuggable, explicit dependencies |
| AD-8 | Legacy aliases | Remove all. Canonical names only. | Clean break. Migration handles transformation. |
| AD-9 | Assignment history | Superseded records retained (last N for rollback). Long-term in Audit. | Rollback capability without operational complexity |
| AD-10 | Denormalized route on Bus | Remove. Query via BusRouteAssignment → Route. | Eliminates stale data risk, single source of truth |
| AD-11 | `renewal_requests` collection | Eliminate. Use Application with type='renewal'. | Unified application model, single flow |
| AD-12 | `processed_payments` collection | Eliminate. Use unique constraint on Payment.payment_id. | Database constraint, not application-level dedup |
| AD-13 | `computed.*` fields on Student | Remove. Derive from AcademicCalendarConfig + sessionStartYear. | Derived data should not be stored |
| AD-14 | Multi-university support | AcademicCalendarConfig per universityId | Configuration-driven, not code-driven |
| AD-15 | Audit separation from Reassignment | Reassignment stores rollback data only. Audit stores full trail. | Different purposes, different retention, different query patterns |

---

## 15. Blocking Issues That MUST Be Resolved Before Phase 3

### BLOCKER-1: No SeatAssignment Entity (CRITICAL)

**Impact:** Every service that reads `student.busId` must be rewritten. Every service that writes `student.busId` must be rewritten. Capacity counting must be rebuilt. Reassignment must be rebuilt. The entire student-on-bus concept has no canonical entity.

**Resolution:** Create SeatAssignment entity. Migrate all `student.busId` references to SeatAssignment queries. Rebuild capacity counting from SeatAssignment counts. Rebuild reassignment to create new SeatAssignment records.

**Scope:** ~30+ files affected. ~50+ code paths affected.

### BLOCKER-2: No DriverAssignment Entity (CRITICAL)

**Impact:** Driver-bus assignment is stored bidirectionally on Driver and Bus. 4+ code paths write to both. Driver swap modifies both. No history of assignments.

**Resolution:** Create DriverAssignment entity. Migrate all `driver.assignedBusId` and `bus.assignedDriverId` references. Rebuild driver swap to create/end DriverAssignment records. Rebuild trip start to validate via DriverAssignment.

**Scope:** ~20+ files affected. ~30+ code paths affected.

### BLOCKER-3: Bus Is a Cross-Domain Write Target (HIGH)

**Impact:** 8+ domains write to Bus. Capacity counters written by 6+ code paths. Trip lock written by trip service. Driver assignment written by admin/swap/assignment services. Route denormalized and synced on route update.

**Resolution:** After creating SeatAssignment, DriverAssignment, and BusRouteAssignment, Bus becomes read-only for most domains. Only Fleet Management writes to Bus properties. Only ActiveTrip writes trip lock (or move to ActiveTrip entity). Capacity counters become derived from SeatAssignment.

**Scope:** Depends on BLOCKER-1, BLOCKER-2 resolution.

### BLOCKER-4: Payment Directly Mutates Student (HIGH)

**Impact:** `applyPaymentValidityToStudent()` writes to Student.validUntil, status, sessionStartYear, sessionEndYear, lastRenewalDate. If student write fails after payment is committed, the system is inconsistent.

**Resolution:** Payment records completion event. Student lifecycle service (D3b) processes the event and updates StudentSession. Payment never touches StudentSession directly.

**Scope:** ~5 files. Payment service refactor + StudentSession service creation.

### BLOCKER-5: `renewal_requests` Collection Still Exists (MEDIUM)

**Impact:** Two separate flows for fresh applications and renewals. Renewal approval writes to `renewal_requests` and `students` and `buses` in one transaction. This is conceptually the same as application approval.

**Resolution:** Eliminate `renewal_requests`. All transport requests go through Application entity with appropriate `applicationType`. Renewal approval becomes a variant of application approval.

**Scope:** ~10 files. Renewal flow consolidation.

### BLOCKER-6: Legacy Field Aliases (MEDIUM)

**Impact:** ~20+ legacy aliases exist. Code must check multiple fields (e.g., `driver.assignedBusId || driver.busId || driver.busAssigned`). The `getEffectiveDriverId()` and `getEffectiveBusId()` functions exist solely to resolve these.

**Resolution:** Canonical names only. Migration layer transforms legacy data. All code uses canonical names.

**Scope:** ~40+ files with alias references.

### BLOCKER-7: `computed.*` Fields Stored on Student (LOW)

**Impact:** 7 computed deadline fields are stored on Student document. These are derived from AcademicCalendarConfig + sessionStartYear. Storing them creates drift risk if config changes.

**Resolution:** Remove `computed.*` fields. Compute on-the-fly from AcademicCalendarConfig. Cache in memory if needed for performance.

**Scope:** ~10 files. Cron jobs + deadline computation.

### BLOCKER-8: Route Denormalized into Bus (LOW)

**Impact:** Bus stores `route.routeId`, `route.routeName`, `route.stops`, `route.totalStops`. When route is updated, all buses must be synced. Stale data risk.

**Resolution:** Remove denormalized route from Bus. Query via BusRouteAssignment → Route.

**Scope:** ~15 files. Bus queries + route update propagation.

---

## Appendix A: Questions Requiring Product Owner Decision

| # | Question | Options | Default |
|---|----------|---------|---------|
| Q1 | How many previous SeatAssignment records to retain for rollback? | 1 (minimal), 3 (moderate), 5 (generous) | 1 |
| Q2 | Should DriverAssignment domain be D6 (Fleet) or D8 (Seat & Capacity)? | D6: Fleet owns driver assignments. D8: Seat & Capacity owns all assignments. | D8 |
| Q3 | Should BusRouteAssignment domain be D7 (Routes) or D8 (Seat & Capacity)? | D7: Routes owns bus-route assignments. D8: Seat & Capacity owns all assignments. | D8 |
| Q4 | Should `renewal_requests` be eliminated entirely, or kept as a separate collection for reporting? | Eliminate (unified model) or Keep (separate reporting) | Eliminate |
| Q5 | Should the system support multiple active SeatAssignments per student (e.g., student uses two buses)? | Single assignment only or Multiple assignments | Single only |

---

## Appendix B: Migration Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| SeatAssignment migration breaks all bus queries | Critical | Feature flag: dual-write (old + new) during transition |
| DriverAssignment migration breaks trip start | Critical | Feature flag: read from new, fallback to old |
| Capacity counter migration creates drift | High | Reconciliation cron runs continuously during migration |
| Payment → Student decoupling creates inconsistency | High | Outbox pattern: write event, process async, verify consistency |
| Legacy alias removal breaks client code | Medium | Comprehensive grep + test coverage before removal |
| Denormalized route removal breaks display queries | Medium | Add BusRouteAssignment join before removing denormalized data |
| `renewal_requests` elimination breaks renewal flow | Medium | Unified Application model must be complete before elimination |
| Multi-university config migration | Low | Config-driven, not code-driven. Add universityId to existing config. |

---

*This document is the final architecture baseline before Firestore → Supabase migration begins. All blocking issues must be resolved in Phase 3 before any implementation work starts.*
