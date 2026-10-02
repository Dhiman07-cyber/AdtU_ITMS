# Student Applications, Verification & Digital Bus Passes

## 1. Application Architecture & Overview

The Assam down town University (AdtU) ITMS student onboarding pipeline orchestrates the complete lifecycle from initial registration to digital bus pass issuance and transit validation.

The system enforces three distinct application processing streams:
1. **Fresh Student Applications (`applicationType: 'fresh'`):** New students seeking bus transit services for the current academic session.
2. **Upcoming Session Applications (`applicationType: 'future'`):** Students applying in advance for future academic sessions, strictly gated against premature access or capacity consumption.
3. **Renewal Applications (`applicationType: 'renewal'` or `'renewal_after_soft_block'`): Existing students renewing transit passes for subsequent academic terms.

```
                         ┌────────────────────────────────────────────────────────┐
                         │                  STUDENT APPLICATION                   │
                         │           Form Submission (/apply) or Draft            │
                         └──────────────────────────┬─────────────────────────────┘
                                                    │
                                                    ▼
                         ┌────────────────────────────────────────────────────────┐
                         │                   SUBMITTED STATE                      │
                         │    Stored in PostgreSQL `applications` Table           │
                         └───────┬────────────────────────────────────────┬───────┘
                                 │                                        │
           Current Academic Term │                  Future Academic Term  │
           (Start Year <= Current)                  (Start Year > Current)│
                                 │                                        │
                                 ▼                                        ▼
                  ┌──────────────────────────────┐         ┌──────────────────────────────┐
                  │    ADMIN / MODERATOR REVIEW  │         │    ADMIN / MODERATOR REVIEW  │
                  │   Checks Fee & Stop Details  │         │   Document & Payment Review  │
                  └──────────────┬───────────────┘         └──────────────┬───────────────┘
                                 │                                        │
                    ┌────────────┴────────────┐                           ▼ (Click "Verify")
                    ▼                         ▼            ┌──────────────────────────────┐
     ┌────────────────────────┐   ┌────────────────────┐   │      VERIFIED_UPCOMING       │
     │        REJECTED        │   │      APPROVED      │   │ - NO student profile created │
     │ - Notified with reason │   │ (Atomic RPC Flow)  │   │ - NO bus capacity consumed   │
     │ - Application archived │   └──────────┬─────────┘   │ - NO bus pass issued         │
     └────────────────────────┘              │             └──────────────┬───────────────┘
                                             │                            │ Session Starts
                                             ▼                            ▼ (Cron / Runner)
                                  ┌────────────────────┐   ┌──────────────────────────────┐
                                  │   ACTIVE STUDENT   │◄──┤      SESSION ACTIVATION      │
                                  │ - Profile created  │   │ - Atomic capacity increment  │
                                  │ - Capacity updated │   │ - Student profile created    │
                                  │ - Dynamic QR Pass  │   │ - Transport pass activated   │
                                  └────────────────────┘   └──────────────────────────────┘
```

---

## 2. The Three Application Streams

### 2.1 Fresh Student Applications (`fresh`)
1. **Draft Saving (`saveDraft`):**
   - Students can save incomplete application forms to PostgreSQL (`state: 'draft'`).
   - If an existing draft exists for the authenticated user, it is updated; otherwise, a unique identifier `app_{timestamp}_{uuid}` is generated.
   - Applications in immutable states (`submitted`, `verified_upcoming`, `approved`, `rejected`) cannot be overwritten as drafts.
2. **Submission (`submitFinal`):**
   - Accepts applicant contact details, enrollment number, academic department, selected route, pickup stop, shift (Morning or Evening), and payment mode (Online Razorpay or Offline Cash/Challan with uploaded receipt).
   - Validates that no active application is already in progress for the applicant UID.
   - Transitions state to `submitted`.
3. **Approval (`approve` / `approveUnauth`):**
   - Executed by an authorized Administrator or Moderator with `canApprove` permission.
   - **Step 1: Application Locking:** Invokes database RPC `approve_application` to acquire a transactional lock on the application record.
   - **Step 2: Capacity Increment:** Invokes atomic PostgreSQL RPC `bus_increment_capacity(p_bus_id, p_shift)`. If `morning_load` or `evening_load` has reached `capacity`, the transaction aborts with `CAPACITY_FULL`.
   - **Step 3: Identity & Profile Activation:** Invokes database RPC `identity_activate_student` to create or update the user record in `public.users` and create the authoritative `public.student_profiles` row.
   - **Step 4: Application Finalization:** Invokes database RPC `finalize_application_approval` which deletes the transient application record from `public.applications`.
   - **Step 5: Post-Commit Side Effects:** Creates an immutable audit event in `public.audit_events` and emits a welcome notification.

### 2.2 Upcoming Session Applications (`verified_upcoming`)
1. **Gating Architecture:**
   - Identified when `sessionStartYear > currentAcademicYear` or `applicationType === 'future'`.
   - Designed to prevent students applying months in advance from exhausting bus seats needed by currently enrolled students.
2. **Verification Workflow (`verifyUpcoming`):**
   - Administrator or Moderator verifies the student's admission eligibility and payment proof.
   - The application transitions to `state = 'verified_upcoming'`.
   - **Absolute Gating Invariants:**
     - **NO** row is created in `public.student_profiles`.
     - **NO** capacity is incremented on the assigned bus (`morning_load` and `evening_load` remain unchanged).
     - **NO** digital QR bus pass is issued.
     - The applicant cannot board buses or track live fleet telemetry.
3. **Session Activation Engine (`cron/session-activation`):**
   - When the configured academic session start date arrives (e.g. July 1), the scheduled activation cron or administrative trigger executes `activateUpcomingSessionApplications()`.
   - Scans all applications where `state = 'verified_upcoming'` and `targetSession.startYear == currentSessionStartYear`.
   - Evaluates bus capacity. If available, executes the full student profile creation and atomic capacity increment.
   - If bus capacity has filled up in the interim, the application transitions to `pending_seat_allocation` and notifies both the student and administrators for manual reassignment.

### 2.3 Renewal Applications (`renewal` & `renewal_after_soft_block`)
1. **Term Extension Invariant:**
   - Existing active students renew their transport pass via `/student` dashboard.
   - The new expiry date is computed using the canonical **max-of-old-and-new** invariant:
     $$\text{validUntil} = \max(\text{existingValidUntil}, \text{newValidUntil})$$
   - Ensures that early renewals never truncate remaining validity from previous sessions.
2. **Renewal Without Seat Loss (`renewal`):**
   - If the student renewed before their seat quota was released, their bus enrollment is retained.
   - Approval extends `valid_until`, recomputes `soft_block` and `hard_block` dates, and marks the renewal application as `approved`.
   - **Audit Compliance:** Unlike fresh applications, renewal application records are **preserved** in `public.applications` in `state = 'approved'` to maintain a permanent financial audit trail.
3. **Renewal After Soft Block (`renewal_after_soft_block`):**
   - If a student failed to renew before the grace period ended, their status was transitioned to `soft_blocked` and their seat quota was released back to the fleet inventory (`seatReleasedAt` is set).
   - Upon payment and approval, the system executes atomic RPC `approve_renewal_with_seat(p_application_id, p_approver_uid, p_student_uid, p_bus_id, p_shift, ...)`.
   - Under a PostgreSQL `FOR UPDATE` row lock, the RPC verifies that the bus still has available capacity on that shift, reclaims the quota (`load + 1`), resets soft/hard block dates, and restores the student to `active` status.

---

## 3. Dynamic QR Pass Architecture

Once approved and active, a student's mobile dashboard (`/student`) renders their digital transit credential. The pass contains an encrypted, time-sensitive QR code:

### 3.1 QR Code Data Contract (`src/domains/trip/qr-contract.ts`):
```json
{
  "studentUid": "usr_stu_109284",
  "enrollmentId": "ADTU/2026/CS/042",
  "busId": "BUS-102",
  "routeId": "ROUTE-01",
  "validUntil": "2027-06-30T00:00:00.000Z",
  "issuedAt": 1772701200000,
  "signature": "hmac_sha256_hash"
}
```

### 3.2 Security & Integrity Invariants
- **Cryptographic Offline Verifiability:** The payload is signed with a server-side HMAC-SHA256 secret. Drivers can verify pass authenticity offline even if cellular data connectivity drops in rural transit zones.
- **Anti-Screenshot Tampering:** The digital pass renders an animated live security watermark displaying the server-synchronized millisecond clock and user profile photo, preventing screenshot sharing between students.
- **Temporal Validity Guard:** Scanners evaluate `validUntil >= now()`. Expired passes fail closed.

---

## 4. Boarding Validation & Scanner Workflow

Physical boarding verification occurs directly on the driver's mobile console (`/driver`):

```
       [Student Presents QR Pass]
                   │
                   ▼
     [Driver Scans via Camera Feed]
                   │
                   ▼
       [Scanner Validates Context]
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
    Valid Pass          Invalid Pass
  Matching BusId       (Expired / Wrong Bus)
         │                   │
         ▼                   ▼
   [Green Feedback]    [Red Feedback]
   Status: BOARDED     Access Denied
```

### 4.1 Scanner Validation Rules
1. **Trip Lock Authority:** Scans are only processed if the driver currently holds an active trip lock in `public.active_trips`.
2. **Bus Assignment Matching:** The pass's `busId` must match the vehicle currently being operated by the driver.
3. **No Door-Side Capacity Decrement (Open Seating):**
   - Seating on university buses is open and unreserved.
   - When a student boards, `/api/driver/mark-boarded` updates the student's waiting flag status to `boarded` for driver roll-call accountability.
   - **Crucial Invariant:** Physical boarding **does NOT check or decrement capacity at the vehicle door**. Vehicle enrollment limits are enforced exclusively during the administrative admission/renewal stage, ensuring boarding operations remain rapid and frictionless.
4. **Grace Period Warning:** If a student's pass is within its renewal grace window (prior to soft block), the scanner alerts the driver with a visual yellow warning while permitting entry.
