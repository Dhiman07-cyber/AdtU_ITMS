# Core Functionalities Integration & Implementations Guide
### Master Technical Orchestration and Code-Level Integration Manual
**ADTU ITMS Platform — Consolidation of Phase 1, Phase 2, Phase 3, and Phase 4**

---

## Overview

This guide serves as the definitive reference manual for the Integrated Transit Management System (ITMS) core implementations. It details the journey from initial architectural flaws to a hardened, mathematically consistent, auditable, and resilient production-grade system. 

### Technology Stack & Architecture Setup
The ITMS platform is engineered on top of a serverless modular architecture:
1. **Core Web Framework**: Next.js App Router (React 19) providing isomorphic client/server execution, server API endpoints, and edge middleware.
2. **Primary Operational Storehouse**: Supabase PostgreSQL (Postgres 17) holding all canonical domain entities (`student_profiles`, `driver_profiles`, `buses`, `routes`, `applications`, `payments`, `reassignment_logs`, `system_config`).
3. **Real-time Location & Event Streams**: Supabase Realtime WebSocket Channels (`supabase.channel()`) for sub-second GPS map updates, driver location events, and student waiting flags.
4. **Authentication**: Firebase Auth strictly used for user authentication and Bearer ID token verification (zero Firestore DB calls).
5. **Push Notifications & Storage**: FCM Topic Messaging (`route_{routeId}`) and Cloudinary SDK for storage verification.

```
                    ┌────────────────────────────┐
                    │     Next.js Web Client     │
                    └──────────────┬─────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼ (Real-time WebSocket)                   ▼ (REST APIs & Auth)
    ┌────────────────────┐                     ┌────────────────────┐
    │ Supabase Realtime  │                     │    Next.js APIs    │
    └─────────┬──────────┘                     └──────────┬─────────┘
              │ (Live Locations & Flags)                  │
              │                                  ┌────────┴────────┐
              ▼                                  ▼                 ▼
    ┌──────────────────────────────────────────────┐       ┌────────────────┐
    │              Supabase Postgres               │       │ Firebase Auth  │
    │ (Profiles, Buses, Routes, Trips, Payments)   │       │ (ID Tokens)    │
    └──────────────────────────────────────────────┘       └────────────────┘
```

---

# PART 1 — ORIGINAL PROBLEMS DISCOVERED

Before the system was hardened, several critical architectural defects existed in the codebase. These defects impacted system stability, capacity metrics, and access controls.

### 1.1 Capacity Corruption Risks
Previously, multiple independent paths could modify bus capacity without transactional safety. Student approvals, renewals, manual reassignments, student deletions, soft blocks, and hard deletes all updated capacity counters via simple, non-atomic read-then-write operations.

#### The Lost-Update Race Condition
When two admin actions occurred concurrently (for example, Student A and Student B being approved at the same time), a race condition occurred:

```
Timeline of Lost Update:
──────────────────────────────────────────────────────────────────────────────
Time  Admin/API Session 1 (Student A)    Admin/API Session 2 (Student B)
──────────────────────────────────────────────────────────────────────────────
T1    Reads Bus-6 (currentMembers = 49)  -
T2    -                                  Reads Bus-6 (currentMembers = 49)
T3    Computes 49 + 1 = 50               -
T4    -                                  Computes 49 + 1 = 50
T5    Writes Bus-6 (currentMembers = 50) -
T6    -                                  Writes Bus-6 (currentMembers = 50)
──────────────────────────────────────────────────────────────────────────────
Result: currentMembers is 50, but 51 students were approved.
```

In code, this was caused by doing an asynchronous Firestore get followed by a set:
```typescript
// OLD INSECURE CODE PATH (Example)
const busDoc = await db.collection('buses').doc(busId).get();
const current = busDoc.data().currentMembers;
await db.collection('buses').doc(busId).update({ currentMembers: current + 1 });
```
Under high admin concurrency (e.g., at the start of a semester during bulk approvals), this pattern consistently led to over-allocated vehicles, leaving students without physical seats on the bus.

#### Counter Divergence and Orphans
*   **Orphaned Deletions:** When a student was deleted from Firestore, a separate fire-and-forget API call was made to decrement the bus. If the network dropped or the second write failed, the student document was deleted, but the bus count remained permanently inflated.
*   **Partial Reassignments:** Reassignment of a student from Bus X to Bus Y was not wrapped in an atomic transaction. If the write to Bus Y failed, Bus X was decremented, but Bus Y was not incremented, corrupting both vehicle counts.

---

### 1.2 Lifecycle Inconsistencies
The database schema lacked a unified student lifecycle. Student states (Active, Soft Blocked, Pending Deletion, Renewal, and Future-Session) were managed using inconsistent rules across separate collections:
*   Active and Soft Blocked students were stored in the `/students` collection.
*   New onboarding applicants were stored in `/applications`.
*   Offline renewals were recorded in a separate `/renewal_applications` collection.
*   Online payments directly bypassed approval lists, creating database inconsistencies where a student was marked active in Firestore but pending in the billing records.

This fragmentation meant that the system could not easily answer a basic question: *What is the state of student registration X?*

---

### 1.3 Entitlement Leaks (Access Control Gaps)
Transport entitlement rules were duplicated across different client files and backend routes:
*   The **Dashboard** evaluated validity dates.
*   The **QR Code Pass** checked the status field.
*   The **Live Map** page checked if a `busId` existed on the profile, ignoring expiration dates.
*   **Supabase Websocket Subscriptions:** Even when a student was soft-blocked and their QR code disabled, the browser client continued to stream active GPS coordinates from Supabase because the socket authentication rule only checked for a valid Firebase Auth session, rather than inspecting the student's entitlement status. This resulted in background resource leaks and unauthorized access to driver location streams.

---

### 1.4 Operational Integrity Gaps
Critical database mutations lacked a standardized audit trail. When a student was reassigned to a different bus or an onboarding application was rejected, there was no record of:
*   **Who** authorized the action (actor identification).
*   **Why** the change was made (justification).
*   **When** it occurred (precise timestamps).
*   **What** the previous values were (pre-mutation snapshots).

This gap made operational troubleshooting and billing audits difficult, rendering the system vulnerable to undetected administrative errors.

---

# PART 2 — PHASE 1: CAPACITY & SEAT OWNERSHIP HARDENING

**Goal:** Create a mathematically consistent transport-capacity architecture with transactional safety.

```
                  ┌──────────────────────────────────────────────┐
                  │                 Bus Document                 │
                  ├──────────────────────────────────────────────┤
                  │ capacity: 55                                 │
                  │ currentMembers: 45 (Canonical Total)         │
                  │ load: {                                      │
                  │   morningCount: 25 (Per-Shift Truth)         │
                  │   eveningCount: 20 (Per-Shift Truth)         │
                  │ }                                            │
                  └──────────────────────────────────────────────┘
```

### 2.1 The Core Invariant
To ensure consistency, the system enforces the following mathematical invariant across all capacity-modifying operations:

$$\text{currentMembers} = \text{load.morningCount} + \text{load.eveningCount}$$

No database transaction may commit unless this invariant is preserved.

*   `load.morningCount` tracks the number of unique active/soft-blocked students assigned to the Morning shift.
*   `load.eveningCount` tracks the Evening shift count.
*   `currentMembers` represents the total number of seat-owning students. A student can only be assigned to either the morning shift or the evening shift, never to both. Thus, `currentMembers` is the simple sum of the two shift counts.

---

### 2.2 Transactional Capacity Architecture
To prevent race conditions, the system uses transactional increments and decrements via [busCapacityService.ts](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/busCapacityService.ts):

*   **`buildCapacityDelta(busData, shift, change)`**: Computes the load increment mapping based on the student's shift. It returns a pure update object.
    ```typescript
    export function buildCapacityDelta(
      busData: Record<string, any>,
      shift: string,
      sign: 1 | -1
    ): CapacityDelta {
      if (!busData) {
        throw new Error('Bus data is required');
      }
      if (!shift) {
        throw new Error('Student shift is required');
      }

      const oldMembers = busData.currentMembers;
      const capacity = busData.capacity;
      const newMembers = sign === 1 ? oldMembers + 1 : Math.max(0, oldMembers - 1);

      const updates: Record<string, unknown> = {
        currentMembers: newMembers,
        updatedAt: new Date().toISOString()
      };

      const normalizedShift = shift.toLowerCase();
      const currentLoad = busData.load || { morningCount: 0, eveningCount: 0 };

      if (normalizedShift === 'morning') {
        const morning = currentLoad.morningCount;
        updates['load.morningCount'] = sign === 1 ? morning + 1 : Math.max(0, morning - 1);
      } else if (normalizedShift === 'evening') {
        const evening = currentLoad.eveningCount;
        updates['load.eveningCount'] = sign === 1 ? evening + 1 : Math.max(0, evening - 1);
      } else {
        throw new Error(`Invalid student shift: ${shift}`);
      }
      return { updates, oldMembers, newMembers, capacity };
    }
    ```
*   **`incrementBusCapacity(busId, uid, shift)` / `decrementBusCapacity(busId, uid, shift)`**: Runs an atomic transaction to mutate the bus document.

#### Atomic Student Onboarding Approval Workflow
The onboarding approval API `/api/applications/approve` executes all mutations inside a single Firestore transaction to guarantee that capacity updates cannot drift from student account creation:

```
Approve Onboarding Application Transaction Flow:
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Read /applications/{appId}                                               │
│    - Verifies the state is 'submitted' (Idempotency check).                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Read /buses/{busId}                                                      │
│    - Fetches the bus details under transaction lock.                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Check Capacity Gate                                                      │
│    - Evaluates: shiftLoad < capacity (e.g. morningCount or eveningCount)    │
│    - Aborts if shift-specific capacity is exceeded.                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Prepare updates                                                          │
│    - Computes validUntil, softBlock, and hardBlock dates.                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. Perform Atomic Write operations:                                         │
│    - Write /users/{uid} (role = 'student')                                  │
│    - Write /students/{uid} (profile & entitlement boundaries)               │
│    - Update /buses/{busId} (increment using delta.updates)                  │
│    - Delete /applications/{appId}                                           │
│    - Delete /unauthUsers/{uid}                                              │
│    - Write Supabase audit log (Tier A Audit)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

If the transaction fails (e.g. database locking conflict, concurrent approval consuming the last seat), the entire set of mutations rolls back, preventing orphaned documents.

---

### 2.3 Seat Release at Soft Block
When a student fails to renew by the configured `softBlockDate`, the cleanup cron job (/api/cron/cleanup-expired-students) executes a status transition and frees up capacity:
1.  **Student Doc Update:** Fills the `seatReleasedAt` timestamp and changes the status:
    ```json
    {
      "status": "soft_blocked",
      "softBlockedAt": "2026-06-24T17:00:00Z",
      "seatReleasedAt": "2026-06-24T17:00:00Z"
    }
    ```
    *Note: `busId`, `routeId`, `stopId`, and `shift` are **retained** on the document as historical markers for late renewals.*
2.  **Bus Capacity Decrement:** Decrements the bus capacity counters inside the transaction, making the seat immediately available for new applicants.

---

### 2.4 Late Renewal & Seat Reclaim
When a soft-blocked student attempts a late renewal:
1.  **Capacity Pre-Check:** The renewal API queries the student's historical `busId` and checks availability for their shift. 
2.  **Path A: Capacity Available:** Atomically increments the bus capacity, clears the student's `seatReleasedAt` field, and updates their status back to `'active'`.
Online payment - Checks automatically, if capacity exists, just assign to that bus only.
Offline payment - Payment goes to RENEWAL TAB of student, if approved, then only perform these operations.

3.  **Path B: Capacity Full:** The renewal remains pending. The student's status remains `'soft_blocked'` and access is denied. The student is placed in a waiting queue or prompted to select an alternative bus. In case capacity is full, situation is out of our hand.
Online payment - Payment made online + Capacity doesn't exist => Sent to RENEWAL TAB of admin/moderator
Offline payment - Payment made offline + Capacity doesn't exists => Sent to RENEWAL TAB of admin/moderator


---

### 2.5 Server-Side Reconciliation (`adminReconcileBusLoads.ts`)
To correct capacity drift, a server-safe reconciliation script runs at the end of every cleanup cron cycle:
1.  **Source of Truth Query:** Queries active student records (`status == 'active'` or legacy blocked students with no `seatReleasedAt` marker).
    ```typescript
    const studentsSnap = await adminDb
      .collection('students')
      .where('status', 'in', ['active', 'soft_blocked', 'pending_deletion'])
      .get();
    ```
2.  **Predicate check:** Checks if the student occupies a seat using `occupiesSeat(student)`:
    ```typescript
    function occupiesSeat(s: Record<string, any>): boolean {
      if (s.seatReleasedAt) return false;
      const status = s.status;
      if (status === 'active') return true;
      if (status === 'soft_blocked' || status === 'pending_deletion') return true;
      return false;
    }
    ```
3.  **Aggregation:** Groups and counts student records in memory by `busId` and `shift`.
4.  **Case-Insensitive Normalization:** Normalizes shift fields (`shift.toLowerCase().includes('morning'|'evening')`) to prevent casing discrepancies.
5.  **Parity Update:** Runs a transaction to write the reconciled counts back to `/buses/{busId}`:
    ```json
    {
      "currentMembers": 45,
      "load.morningCount": 25,
      "load.eveningCount": 20
    }
    ```
    If a discrepancy is corrected, it writes an audit log and alerts admins if the drift was large ($\ge 5$ seats).

---

### 2.6 Proximity Suggester Engine & Reassignment
The reassignment engine suggests alternative routes when a primary bus is full:

```
Reassignment Suggester Decision Tree:
┌───────────────────────────────┐
│     Primary Bus is Full?      │
└──────────────┬────────────────┘
               │
       ┌───────┴───────┐
    No │           Yes │
┌──────▼──────┐ ┌──────▼──────────────────────────────┐
│  Normal     │ │ Alternatives stop at student stop?  │
│  Approval   │ └──────────────┬──────────────────────┘
└─────────────┘                │
                       ┌───────┴───────┐
                   Yes │            No │
       ┌───────────────▼─────┐ ┌───────▼─────────────┐
       │ Alternative Bus     │ │ High-Demand Alert   │
       │ Picker list         │ │ sent to Admins      │
       └─────────────────────┘ └─────────────────────┘
```

*   **Case 1 (Full + No Alternatives):** Returns `canAssign = false`. Dispatches a high-demand alert notification to administrators.
*   **Case 2 (Full + Alternatives Exist):** Lists alternative buses (going through student selected stop) sorted by available seats.
*   **Case 3 (Seats Available):** Returns `canAssign = true` and assigns the student to the primary bus.

---

# PART 3 — PHASE 2: UNIFIED REGISTRATION PIPELINE & COMPOSITION PATTERNS

**Goal:** Unify all student registration flows into a single pipeline and collection.

```
Unified Registration Pipeline:
┌──────────────────┐
│ Freshers         ├──────┐
├──────────────────┤      │    ┌───────────────────┐    ┌─────────────────┐
│ Renewals         ├──────┼───►│   applications    ├───►│  Unified Admin  │
├──────────────────┤      │    │    Collection     │    │  Review Queue   │
│ Future Students  ├──────┘    └───────────────────┘    └─────────────────┘
└──────────────────┘
```

### 3.1 Unified Application Schema
All registration types are stored in the single `/applications` collection. The document type is defined by the `applicationType` field:
*   `'fresh'`: New registrations.
*   `'renewal'`: Existing student renewals.
*   `'future'`: Delayed activation registrations.

#### Application Document Fields:
```typescript
interface Application {
  applicationId: string;
  applicantUid: string;
  applicationType: 'fresh' | 'renewal' | 'future';
  state: 'draft' | 'submitted' | 'approved' | 'rejected' | 'expired';
  eligibleApproval: string; // ISO Timestamp (Frozen boundary)
  targetSession: {
    startYear: number;
    endYear: number;
  };
  formData: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}
```

---

### 3.2 Upcoming/Future Student Model
Future students are applicants whose requested start year is greater than the current academic year.
*   **Status Gating:** They are kept in the `/applications` collection with `state = 'submitted'`.
*   **No Allocation:** They do not generate student profiles, do not consume bus capacity, and cannot access the transit pass.
*   **Date-Locking Rule:** At creation, the eligibility date is calculated and saved on the application document:
    $$\text{eligibleApproval} = \text{softBlock of Outgoing Session} + 1 \text{ day}$$
    This frozen date ensures eligibility is deterministic and unaffected by subsequent config changes.

#### Current Session Derivation:
The current academic session start year is derived dynamically from the `anchorMonth` of the deadline config:
```typescript
const anchorMonth = config.academicYear.anchorMonth; // 0-indexed, e.g., 6 = July
const currentSessionStartYear = now.getMonth() >= anchorMonth ? now.getFullYear() : now.getFullYear() - 1;
```
If the application's `sessionStartYear > currentSessionStartYear`, the application is typed as `'future'` and is gated by `eligibleApproval`.

---

### 3.3 Unified Approval Workflow
Administrators review all application types in a single queue.
1.  **Eligibility Verification:** The API validates the application is eligible using `isApprovalEligible()`. For future students, checks if `now >= eligibleApproval`.
2.  **Capacity Check:** Evaluates shift seat availability on the requested bus.
3.  **Database Migration:** Deletes the application document, creates/extends the student profile, and updates the payments ledger.

---

# PART 4 — PHASE 3: SINGLE TRANSPORT ENTITLEMENT & ACCESS GATING

**Goal:** Centralize access control checks using a single source of truth helper function.

```
Access Gating Topology:
                         ┌──────────────────────────┐
                         │ getTransportEntitlement()│
                         └────────────┬─────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
      ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
      │   Dashboard   │       │   QR Pass     │       │ Live tracking │
      │  Gated Mount  │       │  Code Generator │    │ Map websocket │
      └───────────────┘       └───────────────┘       └───────────────┘
```

### 4.1 Single Source of Truth Entitlement Check
The system routes all access checks through the function `getTransportEntitlement(studentDoc)` located in [transport-entitlement.ts](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/entitlement/transport-entitlement.ts):

```typescript
export function getTransportEntitlement(
  student: EntitlementStudentLike | null | undefined,
  now: Date = new Date()
): EntitlementResult {
  if (!student) return { entitled: false, reason: 'no_account' };

  // (1) Check lifecycle status.
  if (student.status !== 'active') {
    return { entitled: false, reason: 'inactive_status' };
  }

  // (2) Evaluate soft-block boundary.
  const softBlock = toDate(student.softBlock);
  if (softBlock) {
    return softBlock > now
      ? { entitled: true, reason: 'entitled' }
      : { entitled: false, reason: 'past_soft_block' };
  }

  // (3) Fallback to validUntil for legacy data.
  const validUntil = toDate(student.validUntil);
  if (validUntil) {
    return validUntil > now
      ? { entitled: true, reason: 'entitled' }
      : { entitled: false, reason: 'expired' };
  }

  // (4) Incomplete legacy fallback - grant access, flag for backfill.
  return { entitled: true, reason: 'entitled_legacy_incomplete' };
}
```

---

### 4.2 Subscription Gating & Access Controls
*   **Student Dashboard:** The page layout runs an entitlement check during mounting. If it fails, the page redirects the user to `/student/renew`.
*   **QR Pass Generator:** The UI hides the pass generation widget and disables QR code generation if the student is not entitled.
*   **Live Tracking Map:** In [track-bus/page.tsx](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/student/track-bus/page.tsx), map components verify entitlement before subscribing to the Supabase location channel. If entitlement is revoked, the map unmounts and closes WebSocket connections, preventing background location updates.

#### Client-Side Component Gating:
```typescript
// Gated inside StudentTrackBusPage
export default function StudentTrackBusPage() {
  return (
    <TransportEntitlementGuard>
      <TrackBusLive />
    </TransportEntitlementGuard>
  );
}
```
Because the subscribing page `TrackBusLive` is rendered only when `TransportEntitlementGuard` validates the student's access, none of the map's hooks/effects (Supabase channels, geolocation watchers) ever mount or execute for ineligible users.

---

### 4.3 Webhook Renewal Activation Fix
Previously, online Razorpay capture webhooks directly set the student's status to `'active'`.
*   **The Flaw:** This bypassed manual capacity checks, allowing students to reclaim seats on full buses.
*   **The Fix:** Online payments now record a transaction in the `payments` table in Supabase PostgreSQL. The student status remains `'soft_blocked'` until an administrator reviews capacity and approves the renewal.

#### Webhook Idempotency & Pending Flow:
1. **Timing-Safe Verification:** Signature compared timing-safely to prevent timing attacks.
2. **Atomic Idempotency check:** Inside a Supabase PostgreSQL transaction, checks if the payment exists in `payments` table. If not, inserts it atomically to prevent race conditions:
   ```typescript
   await supabase.from('payments').insert({
     id: paymentId,
     order_id: order_id,
     amount: amount / 100,
     student_uid: studentUid,
     status: 'completed',
     source: 'webhook'
   });
   ```

---

# PART 5 — PHASE 4: OPERATIONAL INTEGRITY & FORENSIC AUDITING

**Goal:** Build a robust audit logging framework and transaction recovery architecture.

```
Orchestration of Transaction & Audit Logging:
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Supabase PostgreSQL Transaction                       │
│ ┌───────────────────────────────┐         ┌───────────────────────────────┐ │
│ │     Execute Bus Mutex         │────────►│      Update Student Status    │ │
│ └───────────────────────────────┘         └───────────────────────────────┘ │
│                                                          │                  │
│                                                          ▼                  │
│ ┌───────────────────────────────┐         ┌───────────────────────────────┐ │
│ │   Insert Audit Log (Supabase) │◄────────│    Update Application State   │ │
│ └───────────────────────────────┘         └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Tier A: Audit Trail Logging
All state changes (Approvals, Rejections, Deletions, Reassignments, and Rollbacks) commit an immutable audit log to Supabase PostgreSQL `audit_logs` and `reassignment_logs` tables.
*   **Transactional Logging:** The audit log record is committed within the database transaction block via `writeAuditInTransaction`. If the transaction rolls back, the audit log rolls back.
*   **Log Structure:** Audit records contain pre-mutation and post-mutation JSON snapshots:
    ```json
    {
      "action": "student_reassigned",
      "actorId": "admin_uid_123",
      "actorRole": "admin",
      "actorName": "System Admin",
      "targetId": "student_uid_abc",
      "targetType": "student",
      "targetName": "John Doe",
      "reason": "route_restructuring",
      "before": {
        "busId": "bus_1",
        "routeId": "route_1"
      },
      "after": {
        "busId": "bus_6",
        "routeId": "route_6"
      },
      "details": {
        "notes": "Reassigned due to high demand on Route 1"
      },
      "correlationId": "op_90812731671_admin",
      "createdAtISO": "2026-06-24T17:00:00.000Z"
    }
    ```

---

### 5.2 Tier B: Operational Audits & Log Recovery
*   **Operational Events:** Background tasks, cleanup crons, alerts, and system configuration edits are logged best-effort using `recordOperationalEvent`.
*   **Audit Failures Queue:** If a network drop prevents writing audit logs, the system logs the error to `audit_logs` in PostgreSQL with `status = 'failed'`.
*   **Self-Healing Cron Task:** The background task `/api/cron/cleanup-expired-students` or a recovery job replays failed audit entries back to `audit_logs` once the connection is restored.

---

### 5.3 Automated Integrity Sweep (The Detective)
An automated checker runs daily via `integrity-detector.ts` to detect data inconsistencies:

| Diagnostic Checks | Severity | Description | Resolution Path |
| :--- | :--- | :--- | :--- |
| `orphan_bus_reference` | **High** | Student profile contains a `busId` that does not exist in `buses`. | Resets student `busId` to null and flags for admin review. |
| `active_without_seat` | **High** | Student is `'active'` but is not assigned to any bus in Supabase PostgreSQL. | Admin notified to allocate a bus or block the profile. |
| `seat_marker_inconsistent`| **Medium** | Student status is `'active'` but `seatReleasedAt` is populated. | Verifies capacity. Clears marker if active, or triggers soft block decrement. |
| `duplicate_pending_renewal`| **High** | Multiple pending renewal requests exist for a single student. | Deduplicates queue by keeping the oldest record. |
| `orphan_renewal_request` | **Medium** | A renewal request exists for a student whose profile has been deleted. | Deletes the orphaned renewal request from the table. |
| `duplicate_live_application`| **Medium** | Student has multiple draft/submitted applications for the same session. | Keeps the latest active draft/submission and cancels duplicates. |

---

### 5.4 Transaction Recovery & Idempotency
*   **Double-Click Protection:** API endpoints check for active transaction locks in Supabase PostgreSQL before running mutations. Duplicate incoming requests return a conflict error.
*   **Idempotent Webhooks:** Razorpay webhooks run signature checks and look up transaction status in Supabase `payments`. If the payment is already marked completed, the webhook returns a success status immediately to prevent double updates.
*   **Reassignment Rollback:** Bulk reassignments write rollback actions in a transaction. If a reassignment fails mid-operation, the system executes the rollback action to restore the original bus capacity counts.

#### Reassignment Rollback Implementation:
In `/api/reassignment-logs/rollback`, a POST request executes a multi-row revert in PostgreSQL:
1. **Precondition validation:** The API reads each target row inside the transaction, and verifies that the current state exactly matches the `'after'` snapshot of the original operation. If any field differs (e.g. the student was reassigned again after the operation), it throws a `RollbackConflictError` and aborts.
2. **Atomic Rollback:** Re-applies the `'before'` snapshot state to all student and bus rows in a single PostgreSQL transaction, guaranteeing that a failed rollback never leaves the database in a partially rolled-back state.

---

# FINAL ARCHITECTURE SUMMARY

The ITMS platform relies on the following design principles to ensure data consistency and system reliability:

*   **Atomic Transactions:** All capacity mutations and profile transitions are processed using atomic Supabase PostgreSQL transactions, eliminating concurrent data races.
*   **Single Entitlement Helper:** Centralizes student access checks to prevent background location leaks and unauthorized QR generation.
*   **Append-Only Payments:** Database RLS rules block delete operations on payment tables to protect financial records.
*   **Automated Reconciliation:** Daily background tasks reconcile bus load counts and student profile records in PostgreSQL to self-heal data discrepancies.
*   **Edge Middleware Protection:** Edge-level rate limiting, CSRF verification, and path blocking protect backend APIs from automated abuse.
