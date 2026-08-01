# PHASE: Payment, Renewal & Academic Session Architecture Redesign

**Status:** DESIGN ONLY — No code changes  
**Date:** 2026-06-29  
**Scope:** Complete business architecture redesign for multi-university deployment

---

## Table of Contents

1. [Problems in Current Architecture](#1-problems-in-current-architecture)
2. [Business Ambiguities](#2-business-ambiguities)
3. [Incorrect Responsibilities](#3-incorrect-responsibilities)
4. [Better Domain Model](#4-better-domain-model)
5. [New State Machines](#5-new-state-machines)
6. [Academic Calendar Engine Design](#6-academic-calendar-engine-design)
7. [Payment Architecture](#7-payment-architecture)
8. [Session Engine](#8-session-engine)
9. [Renewal Engine](#9-renewal-engine)
10. [Seat Ownership Engine](#10-seat-ownership-engine)
11. [Permission Model](#11-permission-model)
12. [Migration Strategy](#12-migration-strategy)
13. [Repository Impact](#13-repository-impact)
14. [Implementation Phases](#14-implementation-phases)

---

## 1. Problems in Current Architecture

### P1: Academic Calendar Is Hardcoded to One University

The entire date system assumes a July → July academic year:

- `calculateValidUntil()` in `src/lib/utils/session.ts` hardcodes `new Date(endYear, 6, 1)` — July 1st
- `getDefaultSessionStartYear()` uses `month >= 6` (July) as the boundary
- `deadline-config.json` has `anchorMonth: 5, anchorDay: 30` (June 30)
- `computeDatesForStudent()` in `src/lib/utils/deadline-computation.ts` derives all dates from these hardcoded anchors

A university running January → December, April → March, or semester-based sessions cannot use this system without code changes.

### P2: Session Resolution Is Ambiguous

There is no explicit concept of CURRENT SESSION, NEXT SESSION, or PAST SESSION. The codebase has:

- `getDefaultSessionStartYear()` — a single function that guesses the "current" start year
- `sessionStartYear` / `sessionEndYear` on student documents — per-student, not global
- No session entity that students, applications, or payments can reference

A student opening the app cannot definitively answer: "What session am I in? What session comes next? Is there a future session I can register for?"

### P3: Payment Model Is an Immutable SQL Ledger (Migrated to Supabase)

1. **Online new registration:** Created as `Completed` in Supabase `payments` table and auto-approved.
2. **Online renewal:** Payment recorded in Supabase `payments` table, automatically extending `valid_until` in `student_profiles`.
3. **Offline payment:** Recorded in Supabase `payments` with status `Pending`, awaiting admin/moderator verification.
4. **Single payment ledger:** Supabase PostgreSQL `payments` table is the sole authoritative transaction ledger (zero Firestore fallbacks).
5. **Domain Repository Integrity:** Identity domain repository (`identity.repository.pg`) manages student validity and seat allocation updates.

### P4: Application and Renewal Workflow Streamlining

- Applications and renewals flow through Supabase PostgreSQL (`applications` and `student_profiles` tables).
- `applicationType` (`fresh`, `renewal`, `future`) is managed cleanly with atomic state transitions.

### P5: Seat Ownership Rules Enforced via PostgreSQL

The seat ownership logic is unified around Supabase PostgreSQL `student_profiles` (`seat_released_at`) and `buses` capacity counters:

- `identity.repository.pg` and `fleet.repository.pg` manage canonical seat allocation and release routines atomically.

### P6: Entitlement and Status Unified in PostgreSQL

- `student_profiles` table in Supabase PostgreSQL maintains `valid_until`, `soft_block`, `hard_block`, and `status`.
- Unified entitlement calculations evaluate PostgreSQL timestamps server-side with zero Firestore state drift.

### P7: Renewal Logic Is Tangled Across 4+ Endpoints

- `POST /api/student/renew-service-v2` — student-initiated, creates renewal request
- `POST /api/renewal-requests/approve-v2` — admin approves renewal
- `POST /api/renewal-requests/reject` — admin rejects renewal
- `POST /api/renew-services` — admin bulk renewal (completely different flow)
- `src/lib/utils/renewal-utils.ts` — `calculateRenewalDate()` (one computation)
- `src/app/api/payment/razorpay/verify-payment/route.ts` — renewal path inside online payment verification
- `src/app/api/payment/webhook/razorpay/route.ts` — renewal path inside webhook handler

Renewal date calculation exists in `renewal-utils.ts` AND is duplicated in `verify-payment` and `webhook` handlers.

### P8: Configuration Is Duplicated and Requires Manual Sync

- `src/config/deadline-config.json` — static defaults
- `settings/deadline` Firestore doc — runtime config
- `settings/config` Firestore doc — system config (duplicates date fields)
- `syncSystemConfigDates()` in `src/app/api/settings/deadline-config/route.ts` — manually copies dates between configs
- `getSystemConfig()` and `getDeadlineConfig()` — two separate services reading two separate docs

Changing the academic calendar requires updating multiple documents and hoping the sync function works correctly.

### P9: Moderator Permissions Are Incomplete

Current permission structure:
```typescript
payments: {
  canApproveOfflinePayment: boolean;
  canRejectOfflinePayment: boolean;
}
```

Missing permissions: view payments, edit payment metadata, edit paid date, edit transaction ID, export payments, view analytics, process refunds, configure payment settings. Each route does its own ad-hoc permission check.

### P10: Student Lifecycle Is Incomplete

Documented statuses vs actual statuses:
- Code has: `active`, `soft_blocked`, `pending_deletion`, `expired`, `suspended`, `inactive`
- Missing: `pending_renewal`, `pending_future_session`, `future_active`, `draft`
- No defined transitions between many states
- `submit-final` creates applications with different `verifiedBy` values (`system_online_payment` vs `system_offline_submission_bypass`) — same outcome, different labels

### P11: Non-Deterministic State Transitions

- Application approval: 2 codepaths (`/approve` and `/approve-unauth`)
- Application rejection: 2 codepaths (`/reject` and `/reject-unauth`)
- Application submission: 2 codepaths (`/submit` and `/submit-final`)
- Renewal approval: 1 codepath but with branching seat logic
- Payment creation: 3+ codepaths (Razorpay verify, Razorpay webhook, offline submit)

Multiple codepaths achieving the same outcome violate "every operation has exactly one responsibility."

### P12: Firestore + Supabase Dual-Write Without Clear Ownership

- Student data: Firestore `students` collection
- Payment data: Supabase `payments` table
- Bus data: Firestore `buses` collection
- Trip data: Supabase `active_trips` table
- Application data: Firestore `applications` collection

Approval writes to both systems (creates student in Firestore, records payment in Supabase). If one succeeds and the other fails, the `audit_failures` outbox is the only recovery mechanism. There is no transactional guarantee across systems.

---

## 2. Business Ambiguities

### B1: When Is a Seat Owned vs Available?

Current behavior is unclear:
- A student's seat is "owned" when `status === 'active'` AND no `seatReleasedAt`
- But `seatReleasedAt` is set by the cron job, not at the moment of soft block
- Between soft-block date passing and cron execution, the seat appears owned but shouldn't be
- `adminReconcileBusLoads()` fixes this after the fact, but it's reactive

### B2: Should Online Renewal Auto-Complete?

Current: Online renewal payment is marked `Completed` but a separate `renewal_requests` doc with `status: pending` is created. The student has paid but cannot use transport.

This is confusing. Either:
- (a) Online renewal should NOT auto-complete payment (create Pending payment + pending renewal request)
- (b) Online renewal SHOULD auto-complete and skip admin approval (like new registration)

The current hybrid (payment complete, access pending) is the worst of both options.

### B3: What Happens to Payment When Application Is Rejected?

Current: `reject` route calls `paymentsSupabaseService.updatePaymentStatus(paymentId, 'Rejected')`. But:
- What if the student paid online? The money is captured. Should it be refunded automatically?
- What if the student re-applies? Do they pay again? Is the rejected payment evidence reusable?
- The `payment_history` table may still show the old status

### B4: Which System Is the Source of Truth for Student Status?

- Firestore `students.status` — set by approval, soft block, hard delete
- `getTransportEntitlement()` — computed from status + dates
- Supabase has no student table — student status is only in Firestore

If Firestore and the entitlement computation disagree, which wins? Currently the entitlement function wins (it's the guard), but UI reads from Firestore.

### B5: When Can a Rejected Student Re-Apply?

Current: Application is deleted on rejection. Student can immediately re-apply. No cooldown.

Is this correct? Should there be a waiting period? Should the rejection reason prevent re-application for the same issue?

### B6: Should Pending Offline Payments Exist?

Current: Yes — offline payments are created as `Pending` in Supabase.

But if the student never completes verification, this pending record sits forever. Should there be an expiry? Who cleans it up?

### B7: What Is a "Renewal" vs a "Fresh Application"?

Current: Renewal is a separate flow entirely (`renewal_requests` collection). But conceptually:
- A renewal is "I had transport access, it expired/is expiring, I want it again"
- A fresh application is "I never had transport access, I want it"

The difference is only in seat handling (reclaim vs new allocation) and validity calculation (extend from current vs start fresh). These are implementation details, not different business processes.

---

## 3. Incorrect Responsibilities

### R1: Payment Service Owns Student Validity

`src/lib/payment/payment.service.ts` → `applyPaymentValidityToStudent()` writes to Firestore `students`:

```
student.validUntil = MAX(student.validUntil, payment.validUntil)
student.status = 'active'
student.lastRenewalDate = now
```

**Payment is a financial record.** It should not mutate student state. Student state should be derived from the application/approval that the payment belongs to.

### R2: Application Approval Does Too Many Things

`POST /api/applications/approve` performs:
1. Application state check
2. Capacity validation
3. Student document creation
4. User document creation
5. Bus capacity increment
6. Unauth user cleanup
7. Application deletion
8. Payment processing
9. Cloudinary cleanup
10. Bus full alert

This is 10 responsibilities in one transaction. Each should be a separate, composable step.

### R3: Renewal Duplicates Application Logic

The renewal flow reimplements:
- Application creation (as `renewal_requests`)
- Approval logic (as `approve-v2`)
- Capacity management (seat reclaim)
- Payment recording

All of this already exists in the application approval flow. Renewal should reuse it.

### R4: Session Logic Is Not Centralized

Session computation is scattered across:
- `src/lib/utils/session.ts` — `calculateSessionEndYear`, `getDefaultSessionStartYear`
- `src/lib/utils/deadline-computation.ts` — `computeDatesForStudent`, `computeBlockDatesFromValidUntil`
- `src/lib/utils/renewal-utils.ts` — `calculateRenewalDate`
- `src/lib/utils/application-eligibility.ts` — `deriveCreationCategorisation`
- `src/lib/payment/application-payment.service.ts` — `calculateSessionDates`

Five different files computing session-related dates. No single source of truth.

### R5: Deadline Computation Is Split

- `deadline-config.json` stores month/day config
- `deadline-computation.ts` derives per-student dates
- `cleanup-expired-students/route.ts` recomputes and writes dates to student docs
- `simulate-deadlines/route.ts` has its own computation path
- Student docs store pre-computed `softBlock` and `hardBlock` dates

Dates are computed, stored, then recomputed. This creates drift risk.

### R6: Bus Capacity Service Has Overlapping Implementations

- `busCapacityService.ts` — `buildCapacityDelta`, `incrementBusCapacity`, `decrementBusCapacity`
- `bus-capacity-checker.ts` — `checkBusCapacity`, `findBusesByStop`, `checkCapacityForApplication`
- `admin-reconcile-bus-loads.ts` — `occupiesSeat`, `adminReconcileBusLoads`

Three files implementing seat/capacity logic with different models.

---

## 4. Better Domain Model

### Principle: Seven Independent Engines

Every business concern becomes an independent engine with a single responsibility:

```
┌─────────────────────────────────────────────┐
│           ACADEMIC CALENDAR ENGINE           │
│  "When does the academic year start/end?"    │
├─────────────────────────────────────────────┤
│              SESSION ENGINE                  │
│  "What session is this? What comes next?"    │
├─────────────────────────────────────────────┤
│            PAYMENT LEDGER ENGINE             │
│  "Record financial transactions immutably"   │
├─────────────────────────────────────────────┤
│          APPLICATION STATE MACHINE           │
│  "Track requests for transport access"       │
├─────────────────────────────────────────────┤
│         SEAT OWNERSHIP ENGINE                │
│  "Who owns this seat? Is it available?"      │
├─────────────────────────────────────────────┤
│            RENEWAL ENGINE                    │
│  "Extend existing transport access"          │
├─────────────────────────────────────────────┤
│         STUDENT LIFECYCLE ENGINE             │
│  "Track student status transitions"          │
└─────────────────────────────────────────────┘
```

### Engine Interaction Rules

1. Engines communicate through events, not direct calls
2. Each engine owns its own data store
3. No engine writes to another engine's data
4. All inter-engine communication goes through a coordinator
5. Configuration flows from Academic Calendar → all other engines

### Domain Entities

```
AcademicCalendar (1 per university)
  └─ Session (N per calendar)
       └─ Application (N per session)
            └─ Payment (1 per application, immutable)
       └─ SeatAssignment (N per session, per bus)
       └─ StudentSession (N per student, per session)
  └─ Student (N per university)
       └─ Entitlement (derived, not stored)
```

---

## 5. New State Machines

### 5.1 Application State Machine

```
                    ┌──────────┐
                    │  DRAFT   │
                    └────┬─────┘
                         │ submit
                         ▼
                 ┌───────────────┐
                 │   SUBMITTED   │
                 └───┬───────┬───┘
                     │       │
            approve  │       │  reject
                     ▼       ▼
             ┌──────────┐  ┌──────────┐
             │ APPROVED │  │ REJECTED │
             └──────────┘  └──────────┘
                  │
                  │ (creates/updates student,
                  │  allocates seat, records payment)
                  ▼
             ┌──────────┐
             │ CONSUMED │  (application fully processed)
             └──────────┘
```

**States:**
- `draft` — Form partially filled, not yet submitted
- `submitted` — Form complete, payment attached, awaiting admin review
- `approved` — Admin approved, student entity created/updated, seat allocated
- `rejected` — Admin rejected, application archived
- `consumed` — Post-approval processing complete (payment recorded, seat confirmed)

**Transitions:**
| From | To | Trigger | Guard |
|------|-----|---------|-------|
| draft | submitted | Student submits form | All required fields valid, payment attached |
| submitted | approved | Admin approves | Capacity available, eligibility verified |
| submitted | rejected | Admin rejects | — |
| approved | consumed | System processes | Payment recorded, seat allocated |

**No other transitions are allowed.** A rejected application cannot be "un-rejected." An approved application cannot be "un-approved."

### 5.2 Payment State Machine (Immutable Ledger)

```
                 ┌───────────┐
                 │  PENDING  │
                 └─────┬─────┘
                       │
              ┌────────┴────────┐
              │                 │
         approve            reject
              │                 │
              ▼                 ▼
        ┌───────────┐    ┌───────────┐
        │ COMPLETED │    │ REJECTED  │
        └───────────┘    └───────────┘
```

**States:**
- `pending` — Awaiting verification/approval
- `completed` — Payment verified and confirmed
- `rejected` — Payment rejected or refunded

**Rules:**
- Payments are **append-only**. No UPDATE after creation except status transitions.
- Status transitions are **atomic** and **one-way**: `pending → completed` or `pending → rejected`
- `completed` and `rejected` are **terminal states** — no further transitions
- Rows are **never deleted** (Supabase RLS blocks DELETE)
- A unique constraint prevents multiple `completed` payments per student per session

### 5.3 Student Lifecycle State Machine

```
                       ┌──────────┐
                  ┌────│  ACTIVE  │────┐
                  │    └──────────┘    │
                  │                    │
        renew     │                    │  soft block
        approved  │                    │  date passes
                  │                    │
                  ▼                    ▼
         ┌──────────────┐    ┌────────────────┐
         │PENDING_RENEWAL│   │  SOFT_BLOCKED  │
         └──────────────┘    └───────┬────────┘
                                     │
                            ┌────────┴────────┐
                            │                 │
                     renew  │                 │ hard block
                     approved│                │ date passes
                            │                 │
                            ▼                 ▼
                    ┌──────────┐    ┌──────────────┐
                    │  ACTIVE  │    │HARD_BLOCKED  │
                    └──────────┘    └──────┬───────┘
                                           │
                                           │ 30-day grace
                                           │ period expires
                                           ▼
                                    ┌──────────────┐
                                    │   DELETED    │
                                    └──────────────┘
```

**States:**
| State | Meaning | Transport Access |
|-------|---------|-----------------|
| `active` | Currently enrolled, payment current | YES |
| `pending_renewal` | Renewal submitted, awaiting approval | YES (grace) |
| `soft_blocked` | Payment expired, grace period ended | NO (seat released) |
| `hard_blocked` | Long-term expired, pending deletion | NO |
| `deleted` | Account and data permanently removed | N/A |

**Transitions:**
| From | To | Trigger | Guard |
|------|-----|---------|-------|
| (none) | active | Application approved | — |
| active | pending_renewal | Student submits renewal | — |
| pending_renewal | active | Renewal approved | Capacity available if seat released |
| active | soft_blocked | Soft block date passes | Cron job execution |
| soft_blocked | active | Renewal approved | Capacity check, seat reclaim |
| soft_blocked | hard_blocked | Hard block date passes | Cron job execution |
| hard_blocked | deleted | 30-day grace expires | Cron job execution |

### 5.4 Seat State Machine

```
     ┌──────────────┐
     │  AVAILABLE   │
     └──────┬───────┘
            │ assign (approval)
            ▼
     ┌──────────────┐
     │    HELD      │
     │ (by student) │
     └──────┬───────┘
            │
     ┌──────┴──────┐
     │             │
  release       reclaim
  (soft block)  (renewal)
     │             │
     ▼             ▼
  ┌────────┐  ┌────────┐
  │RELEASED│  │  HELD  │ (same student)
  └───┬────┘  └────────┘
      │
      │ reassign
      ▼
  ┌──────────────┐
  │   ASSIGNED   │ (to new student)
  └──────────────┘
```

**States:**
- `available` — No student currently owns this seat
- `held` — A student owns this seat (active enrollment)
- `released` — Previously held, now available (soft-block released it)
- `assigned` — Reassigned to a different student after release

---

## 6. Academic Calendar Engine Design

### 6.1 Single Configuration Document

One configuration defines the entire academic calendar. Everything else is derived.

```typescript
interface AcademicCalendarConfig {
  // University identification
  universityId: string;
  calendarName: string;

  // Academic year structure
  academicYear: {
    startMonth: number;  // 0-indexed (0=Jan, 6=Jul)
    startDay: number;    // 1-31
    durationMonths: number;  // Typically 12
  };

  // Renewal window (relative to academic year END)
  renewalWindow: {
    opensBeforeEndDays: number;   // e.g., 30 → opens 30 days before year end
    closesAfterEndDays: number;   // e.g., 30 → closes 30 days after year end
  };

  // Blocking (relative to academic year END)
  blocking: {
    softBlockAfterEndDays: number;   // e.g., 30 → soft block 30 days after end
    hardBlockAfterEndDays: number;   // e.g., 395 → hard block ~13 months after end
    urgentWarningBeforeHardBlockDays: number;  // e.g., 15
  };

  // Future admission (relative to NEXT academic year START)
  futureAdmission: {
    opensBeforeStartDays: number;  // e.g., 60 → opens 60 days before next year
    closesAfterStartDays: number;  // e.g., 30 → closes 30 days after next year start
  };

  // Renewal reminder
  reminder: {
    firstReminderBeforeEndDays: number;  // e.g., 30
    secondReminderBeforeEndDays: number; // e.g., 15
  };
}
```

### 6.2 Derived Dates (Never Stored, Always Computed)

Given a `sessionStartYear` and the config, ALL dates are computed:

```typescript
function computeSessionDates(
  sessionStartYear: number,
  config: AcademicCalendarConfig
): SessionDates {
  const sm = config.academicYear.startMonth;
  const sd = config.academicYear.startDay;
  const duration = config.academicYear.durationMonths;

  // Core dates
  const sessionStart = new Date(sessionStartYear, sm, sd);
  const sessionEnd = addMonths(sessionStart, duration);
  const sessionEndYear = sessionEnd.getFullYear();

  // Renewal window
  const renewalOpens = addDays(sessionEnd, -config.renewalWindow.opensBeforeEndDays);
  const renewalCloses = addDays(sessionEnd, config.renewalWindow.closesAfterEndDays);

  // Blocking
  const softBlock = addDays(sessionEnd, config.blocking.softBlockAfterEndDays);
  const hardBlock = addDays(sessionEnd, config.blocking.hardBlockAfterEndDays);
  const urgentWarning = addDays(hardBlock, -config.blocking.urgentWarningBeforeHardBlockDays);

  // Future admission
  const nextSessionStart = new Date(sessionStartYear + 1, sm, sd);
  const futureAdmissionOpens = addDays(nextSessionStart, -config.futureAdmission.opensBeforeStartDays);
  const futureAdmissionCloses = addDays(nextSessionStart, config.futureAdmission.closesAfterStartDays);

  // Reminders
  const firstReminder = addDays(sessionEnd, -config.reminder.firstReminderBeforeEndDays);
  const secondReminder = addDays(sessionEnd, -config.reminder.secondReminderBeforeEndDays);

  return {
    sessionStart, sessionEnd, sessionEndYear,
    renewalOpens, renewalCloses,
    softBlock, hardBlock, urgentWarning,
    futureAdmissionOpens, futureAdmissionCloses,
    firstReminder, secondReminder,
  };
}
```

### 6.3 Multi-University Configuration Examples

**ADTU (July → June):**
```json
{
  "academicYear": { "startMonth": 6, "startDay": 1, "durationMonths": 12 },
  "renewalWindow": { "opensBeforeEndDays": 30, "closesAfterEndDays": 30 },
  "blocking": { "softBlockAfterEndDays": 30, "hardBlockAfterEndDays": 395 },
  "futureAdmission": { "opensBeforeStartDays": 60, "closesAfterStartDays": 30 }
}
```

**University B (January → December):**
```json
{
  "academicYear": { "startMonth": 0, "startDay": 1, "durationMonths": 12 },
  "renewalWindow": { "opensBeforeEndDays": 30, "closesAfterEndDays": 30 },
  "blocking": { "softBlockAfterEndDays": 31, "hardBlockAfterEndDays": 396 },
  "futureAdmission": { "opensBeforeStartDays": 60, "closesAfterStartDays": 30 }
}
```

**University C (Semester-based, 2 semesters):**
```json
{
  "academicYear": { "startMonth": 7, "startDay": 15, "durationMonths": 10 },
  "renewalWindow": { "opensBeforeEndDays": 21, "closesAfterEndDays": 21 },
  "blocking": { "softBlockAfterEndDays": 15, "hardBlockAfterEndDays": 380 },
  "futureAdmission": { "opensBeforeStartDays": 45, "closesAfterStartDays": 15 }
}
```

### 6.4 Impossibility Prevention

The config must enforce that:
1. `softBlockAfterEndDays < hardBlockAfterEndDays`
2. `renewalWindow.opensBeforeEndDays > 0`
3. `renewalWindow.closesAfterEndDays >= 0`
4. `academicYear.durationMonths > 0 AND <= 24`
5. `startDay` is valid for `startMonth` (no Feb 30)

Validation function rejects configs that create impossible states.

### 6.5 Config Changes Are Immediately Effective

When an admin updates the calendar config:
1. New config is saved to Firestore `settings/academic_calendar`
2. All subsequent date computations use the new config
3. Existing student dates are NOT retroactively changed (they were computed under the old config)
4. Next cron run uses new config for new computations

**No manual sync needed.** One config, one source of truth.

---

## 7. Payment Architecture

### 7.1 Principles

1. **Payments are immutable financial records.** Once created, rows are never updated except for status transitions.
2. **Append-only ledger.** New rows are inserted, never modified.
3. **One payment per application.** Each application references exactly one payment.
4. **Payment status is separate from application status.** A payment can be `completed` while the application is still `submitted`.
5. **No payment writes to student state.** Student state is derived from application approval, not from payment.

### 7.2 Payment Record Schema

```typescript
interface PaymentRecord {
  // Identity
  paymentId: string;           // Generated, globally unique
  applicationId: string;       // References the application
  studentUid: string;          // Firebase Auth UID

  // Financial
  amount: number;              // Positive, in smallest currency unit
  currency: string;            // ISO 4217
  method: 'online' | 'offline';

  // Status (only field that changes)
  status: 'pending' | 'completed' | 'rejected';

  // Online payment references
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;

  // Offline payment references
  offlineTransactionId?: string;
  receiptImageUrl?: string;

  // Session reference
  sessionStartYear: number;
  sessionEndYear: number;
  durationYears: number;

  // Approval
  approvedBy?: PaymentApprover;
  approvedAt?: string;         // ISO timestamp

  // Integrity
  documentSignature?: string;  // RSA-2048, computed on completion

  // Metadata
  createdAt: string;           // ISO timestamp, immutable
  updatedAt: string;           // ISO timestamp, updated on status change only
}
```

### 7.3 Payment Lifecycle by Type

**Online New Registration:**
1. Student initiates → Razorpay order created
2. Student pays → Razorpay captures
3. Webhook/verify → Payment record created with status `completed`
4. Application moves to `submitted`

**Online Renewal:**
1. Student initiates → Razorpay order created
2. Student pays → Razorpay captures
3. Webhook/verify → Payment record created with status `pending`
4. Renewal application created with status `submitted`
5. Admin approves → Payment status → `completed`, application → `approved`

**Offline New Registration:**
1. Student submits form with receipt image
2. Payment record created with status `pending`
3. Application moves to `submitted`
4. Admin reviews receipt → Payment status → `completed`, application → `approved`

**Offline Renewal:**
1. Student submits renewal with receipt image
2. Payment record created with status `pending`
3. Renewal application created with status `submitted`
4. Admin reviews → Payment status → `completed`, application → `approved`

### 7.4 Should Offline Payment Create a Row Before Verification?

**Yes.** A pending financial record represents actual financial state — the student has submitted proof of payment. This is information that exists in the real world and should be recorded. The pending state is meaningful: "payment evidence submitted, awaiting verification."

### 7.5 Should Online Payment Create It?

**Yes, immediately.** Online payments are verified by Razorpay's cryptographic signature. The payment is real at the moment of creation. Status = `completed`.

### 7.6 Should Rejected Payments Exist?

**Yes.** A rejected payment is a meaningful financial event: "payment was attempted but not valid." It should be recorded for audit purposes but should not grant any access.

### 7.7 Should Failed Payments Exist?

**No.** A failed payment (e.g., Razorpay capture failed) should not create a database record. The Razorpay order exists as evidence of the attempt. Only captured/verified payments create ledger entries.

### 7.8 Should Cancelled Payments Exist?

**No.** A cancelled Razorpay order should not create a ledger entry. If the student cancels before paying, there is no financial event to record.

### 7.9 Should Pending Offline Payments Exist?

**Yes.** As explained in 7.4. But they should have an expiry (e.g., 7 days). After expiry, they are automatically rejected by cron.

### 7.10 Should Verification Mutate Rows?

**Only status.** Verification changes `status` from `pending` to `completed` or `rejected`. This is an atomic, one-way transition. No other fields change.

### 7.11 Should Approval Create Rows?

**No.** Approval changes the status of an existing payment row. The row was created at payment submission time.

### 7.12 Should Rows Ever Be Updated?

**Only for status transitions.** The `updatedAt` field updates. `approvedBy` and `approvedAt` are set on approval. No other fields change after creation.

### 7.13 Should Ledger Rows Remain Append-Only?

**Yes.** This is the fundamental principle. Financial records are immutable except for status transitions. This ensures:
- Audit integrity
- Dispute resolution
- Regulatory compliance
- Consistent reporting

### 7.14 Payment-Application Relationship

```
Application ──────── 1:1 ──────── Payment
    │                                 │
    │  application.paymentId          │  payment.applicationId
    │  (stored on application)        │  (stored on payment)
    │                                 │
    └── Both created atomically ──────┘
```

When an application is created, its payment is created in the same transaction. They are inseparable.

---

## 8. Session Engine

### 8.1 Session Resolution Rules

A session is defined by `(startYear, endYear)` where `endYear = startYear + calendarDuration`.

**Given the current date and academic calendar:**

```
currentSessionStartYear = 
  if currentMonth > calendar.startMonth OR 
     (currentMonth == calendar.startMonth AND currentDay >= calendar.startDay):
    currentYear
  else:
    currentYear - 1

currentSessionEndYear = currentSessionStartYear + calendar.durationMonths/12
nextSessionStartYear = currentSessionStartYear + 1
```

**Student session resolution:**

```typescript
function resolveStudentSession(student, calendarConfig, now): SessionResolution {
  const currentSession = computeSessionDates(currentSessionStartYear, calendarConfig);

  // Case 1: Student has active enrollment for current session
  if (student.sessionStartYear == currentSessionStartYear && 
      student.status == 'active') {
    return { type: 'current', session: currentSession };
  }

  // Case 2: Student has enrollment for a future session
  if (student.sessionStartYear > currentSessionStartYear) {
    return { type: 'future', session: computeSessionDates(student.sessionStartYear, calendarConfig) };
  }

  // Case 3: Student's session has ended
  if (student.sessionEndYear <= currentSessionStartYear) {
    return { type: 'past', session: computeSessionDates(student.sessionStartYear, calendarConfig) };
  }

  // Case 4: Student has enrollment for current session but not active (e.g., soft-blocked)
  if (student.sessionStartYear == currentSessionStartYear) {
    return { type: 'current', session: currentSession, blocked: true };
  }

  // Default: no session
  return { type: 'none' };
}
```

### 8.2 What a Student Sees

| Student State | Current Session | Next Session | Future Registration |
|--------------|----------------|--------------|-------------------|
| Active, current session | ✓ (their session) | ✓ (next year) | ✓ (if window open) |
| Active, multi-year | ✓ (their session) | ✓ (continuing) | ✓ (if window open) |
| Soft-blocked | ✓ (expired session) | ✓ (next year) | ✓ (can apply) |
| Hard-blocked | ✗ | ✓ (next year) | ✓ (can apply) |
| No account | ✗ | ✓ (next year) | ✓ (can apply) |

### 8.3 Session as Source of Truth

Every entity references a session:

- `application.sessionStartYear` + `sessionEndYear`
- `payment.sessionStartYear` + `sessionEndYear`
- `student.sessionStartYear` + `sessionEndYear`
- `seatAssignment.sessionStartYear` + `sessionEndYear`

The session defines:
- When renewal opens/closes
- When soft block happens
- When hard block happens
- When future admission opens/closes
- What bus fee applies (fee can change per session)

### 8.4 No Duplicated Date Logic

**Before (current):**
- 5 different files compute session-related dates
- Dates stored on student docs, recomputed by cron, overridden by simulation

**After (redesign):**
- 1 function: `computeSessionDates(sessionStartYear, config)` returns all dates
- Called wherever dates are needed
- Never stored redundantly
- Student docs store `sessionStartYear` and `durationYears` only — everything else is derived

---

## 9. Renewal Engine

### 9.1 Renewal Is an Application

A renewal is not a separate flow. It is an application with `applicationType: 'renewal'`. It uses the same state machine, the same approval process, and the same payment recording.

**The only differences between fresh and renewal:**

| Aspect | Fresh Application | Renewal Application |
|--------|------------------|-------------------|
| Student existence | Creates new student | Updates existing student |
| Seat allocation | New seat from available pool | Reclaims released seat or keeps existing |
| Validity calculation | Starts from session start | Extends from current validity |
| Capacity check | Always checks | Only checks if seat was released |

### 9.2 Renewal Application Flow

```
1. Student visits /student/renew
2. Selects duration, reviews dates and fee
3. Chooses payment method
4. System creates:
   a. Payment record (pending or completed)
   b. Application record (type: 'renewal', state: 'submitted')
5. Admin reviews in application queue
6. On approval:
   a. Student status → 'active'
   b. Validity extended
   c. Seat reclaimed (if released)
   d. Payment → 'completed'
   e. Bus capacity updated
```

### 9.3 Renewal Rules by Scenario

#### Early Renewal (before expiry, within renewal window)

| Aspect | Value |
|--------|-------|
| Payment | Standard fee for duration |
| Application type | `renewal` |
| Seat | Retained (not released) |
| Student status | `active` → `active` (no change) |
| Validity | Extended from current `sessionEndYear` |
| Bus capacity | No change |
| Approval queue | Yes (normal queue) |
| Admin action | Standard approval |

#### Late Renewal (after expiry, before soft block)

| Aspect | Value |
|--------|-------|
| Payment | Standard fee for duration |
| Application type | `renewal` |
| Seat | Retained (within grace period) |
| Student status | `active` → `active` |
| Validity | Extended from current `sessionEndYear` |
| Bus capacity | No change |
| Approval queue | Yes (normal queue) |
| Admin action | Standard approval |

#### Soft-Blocked Renewal (after soft block)

| Aspect | Value |
|--------|-------|
| Payment | Standard fee for duration |
| Application type | `renewal` |
| Seat | Must be reclaimed (was released) |
| Student status | `soft_blocked` → `active` |
| Validity | Extended from current `sessionEndYear` |
| Bus capacity | Increment on approval |
| Approval queue | Yes (with capacity check) |
| Admin action | Approve + verify capacity available |

#### Expired Renewal (past hard block, within re-application window)

| Aspect | Value |
|--------|-------|
| Payment | Standard fee (new application) |
| Application type | `fresh` (not renewal — too much time passed) |
| Seat | New allocation from available pool |
| Student status | `hard_blocked` → `active` (new student record) |
| Validity | Starts from current session |
| Bus capacity | New allocation |
| Approval queue | Yes (full review) |
| Admin action | Full fresh application review |

#### Future Session Registration

| Aspect | Value |
|--------|-------|
| Payment | Standard fee for duration |
| Application type | `future` |
| Seat | Reserved for next session (not allocated yet) |
| Student status | No change (applicant is not yet active for next session) |
| Validity | Starts from next session start |
| Bus capacity | Not changed until next session approval |
| Approval queue | Yes (but gated until `eligibleApproval` date) |
| Admin action | Cannot approve until `eligibleApproval` date passes |

### 9.4 Validity Calculation Rules

```typescript
function calculateNewValidity(
  currentValidUntil: Date | null,
  currentSessionEnd: Date,
  newDurationYears: number,
  calendarConfig: AcademicCalendarConfig
): { newValidUntil: Date; baseYear: number } {
  
  // If current validity extends beyond session end, extend from there
  if (currentValidUntil && currentValidUntil > currentSessionEnd) {
    baseYear = currentValidUntil.getFullYear();
  } else {
    // Extend from current session end year
    baseYear = currentSessionEnd.getFullYear();
  }

  newValidUntil = new Date(
    baseYear + newDurationYears,
    calendarConfig.academicYear.startMonth,
    calendarConfig.academicYear.startDay
  );

  return { newValidUntil, baseYear };
}
```

### 9.5 No Duplicate Logic

**Before:** Renewal date calculation in `renewal-utils.ts`, `verify-payment/route.ts`, `webhook/route.ts`, and `approve-v2/route.ts`.

**After:** One function `calculateNewValidity()` called by all renewal paths. No duplication.

---

## 10. Seat Ownership Engine

### 10.1 Mathematical Definitions

**Seat Ownership Predicate:**

```
ownsSeat(student, bus, session) ⟺
  student.status = 'active' ∧
  student.assignedBusId = bus.id ∧
  student.sessionStartYear = session.startYear ∧
  student.seatReleasedAt = null
```

**Seat Available Predicate:**

```
seatAvailable(bus, shift, session) ⟺
  bus.currentLoad[shift] < bus.capacity[shift] ∧
  ¬∃ student : ownsSeat(student, bus, session)
```

**Seat Released Predicate:**

```
seatReleased(student) ⟺
  student.seatReleasedAt ≠ null
```

**Seat Can Be Reclaimed Predicate:**

```
canReclaimSeat(student, bus, session) ⟺
  seatReleased(student) ∧
  student.status ∈ {'soft_blocked', 'active'} ∧
  bus.availableSeats > 0
```

### 10.2 Seat Lifecycle Events

| Event | Trigger | Effect |
|-------|---------|--------|
| `seat_assigned` | Application approved | `bus.load[shift]++`, `student.assignedBusId = bus.id` |
| `seat_released` | Soft block cron executes | `bus.load[shift]--`, `student.seatReleasedAt = now` |
| `seat_reclaimed` | Renewal approved (soft-blocked student) | `bus.load[shift]++`, `student.seatReleasedAt = null` |
| `seat_lost` | Hard block cron executes | Student deleted, seat already released |
| `seat_transferred` | Admin reassigns student to different bus | `old_bus.load[shift]--`, `new_bus.load[shift]++` |

### 10.3 Atomic Capacity Operations

All seat mutations are Firestore transactions:

```typescript
function assignSeat(busId, studentUid, shift): Transaction {
  // Read bus + student inside transaction
  // Verify capacity available
  // Increment bus load
  // Set student.assignedBusId
  // Write audit
}

function releaseSeat(busId, studentUid): Transaction {
  // Read bus + student inside transaction
  // Verify student owns seat
  // Decrement bus load
  // Set student.seatReleasedAt = now
  // Write audit
}

function reclaimSeat(busId, studentUid): Transaction {
  // Read bus + student inside transaction
  // Verify seat was released
  // Verify capacity available
  // Increment bus load
  // Clear student.seatReleasedAt
  // Write audit
}
```

### 10.4 No Race Conditions

The transaction-based approach ensures:
1. Capacity check and mutation are atomic
2. Two concurrent approvals for the last seat will not over-allocate
3. The second transaction will fail with `CapacityFullError`

### 10.5 Self-Healing Reconciliation

`adminReconcileBusLoads()` runs periodically to detect and correct drift:
- Counts actual students per bus per shift
- Compares with stored `currentMembers`
- Corrects mismatches
- Alerts admins for large discrepancies

---

## 11. Permission Model

### 11.1 Granular Permissions

Each permission is independent. No permission implies another.

```typescript
interface ModeratorPermissions {
  // Application management
  applications: {
    canView: boolean;           // View application list and details
    canApprove: boolean;        // Approve applications
    canReject: boolean;         // Reject applications
    canEdit: boolean;           // Edit application data before approval
    canGenerateCode: boolean;   // Generate verification codes
  };

  // Payment management
  payments: {
    canView: boolean;           // View payment records
    canApprove: boolean;        // Approve offline payments (part of application approval)
    canReject: boolean;         // Reject offline payments
    canEditMetadata: boolean;   // Edit transaction ID, paid date
    canExport: boolean;         // Export payment data
    canViewAnalytics: boolean;  // View payment analytics
    canProcessRefund: boolean;  // Process refunds
  };

  // Student management
  students: {
    canView: boolean;
    canAdd: boolean;            // Manually create student records
    canEdit: boolean;           // Edit student profiles
    canDelete: boolean;         // Delete student records
    canReassign: boolean;       // Reassign to different bus
    canOverrideStatus: boolean; // Manually change student status
  };

  // Bus management
  buses: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;       // Reassign students between buses
  };

  // Route management
  routes: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };

  // Driver management
  drivers: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;
  };

  // System configuration
  configuration: {
    canEditCalendar: boolean;   // Edit academic calendar config
    canEditFees: boolean;       // Edit bus fee
    canEditDeadlines: boolean;  // Edit deadline config
    canSimulate: boolean;       // Run deadline simulations
    canRunCron: boolean;        // Trigger cron jobs manually
  };

  // Notifications
  notifications: {
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canBroadcast: boolean;      // Send to all users
  };
}
```

### 11.2 Permission Presets

```typescript
const VIEWER: ModeratorPermissions = {
  applications: { canView: true, canApprove: false, canReject: false, canEdit: false, canGenerateCode: false },
  payments: { canView: true, canApprove: false, canReject: false, canEditMetadata: false, canExport: false, canViewAnalytics: false, canProcessRefund: false },
  students: { canView: true, canAdd: false, canEdit: false, canDelete: false, canReassign: false, canOverrideStatus: false },
  // ... all others false
};

const MODERATOR: ModeratorPermissions = {
  applications: { canView: true, canApprove: true, canReject: true, canEdit: false, canGenerateCode: true },
  payments: { canView: true, canApprove: true, canReject: true, canEditMetadata: false, canExport: false, canViewAnalytics: true, canProcessRefund: false },
  students: { canView: true, canAdd: false, canEdit: true, canDelete: false, canReassign: true, canOverrideStatus: false },
  // ... others as needed
};

const ADMIN: ModeratorPermissions = {
  // Everything true
};
```

### 11.3 Server-Side Enforcement

Every API route uses:

```typescript
const auth = await verifyApiAuth(request);
if (!auth.authenticated) return auth.response;

if (auth.role === 'admin') {
  // Admins bypass all permission checks
} else if (auth.role === 'moderator') {
  const result = await requireModeratorPermission(auth.uid, 'payments', 'canApprove');
  if (result) return result; // 403
}
```

### 11.4 Client-Side Gating

```typescript
const { permissions } = useModeratorPermissions();

// Hide buttons user can't use
{permissions.payments.canApprove && <ApproveButton />}
{permissions.payments.canExport && <ExportButton />}
{permissions.configuration.canEditCalendar && <CalendarEditor />}
```

---

## 12. Migration Strategy

### 12.1 Principles

1. **Zero downtime.** Old and new systems run in parallel during migration.
2. **Backward compatible.** Existing data continues to work.
3. **Progressive migration.** Migrate one engine at a time.
4. **Rollback safe.** Each phase can be rolled back independently.

### 12.2 Data Migration

#### Academic Calendar

1. Create new `settings/academic_calendar` config doc
2. Populate from existing `settings/deadline` + hardcoded values
3. Existing students: their `sessionStartYear` and `sessionEndYear` remain valid
4. New computations use new config; old data is unaffected

#### Payments

1. Existing Supabase `payments` rows are already in the correct format
2. Add `applicationId` column (nullable initially)
3. Backfill: link existing payments to applications via `studentUid` + `sessionStartYear`
4. New payments always have `applicationId`
5. Legacy `payment_history` table: mark as deprecated, no new writes

#### Applications

1. Existing `applications` collection documents remain valid
2. Add `applicationType` field to documents that don't have it (default: `'fresh'`)
3. `renewal_requests` collection: migrate to `applications` collection as `applicationType: 'renewal'`
4. After migration, `renewal_requests` collection is deprecated

#### Students

1. Existing `students` documents remain valid
2. Add `assignedBusId` field if missing (backfill from current bus assignment)
3. Remove `seatReleasedAt` redundancy — derive from status
4. Status field: keep existing values, add new ones progressively

### 12.3 Dual-Write Period

During migration, both old and new codepaths write data:

1. **Phase 1-3:** New engines are read-only (compute but don't write)
2. **Phase 4:** New engines start writing alongside old code
3. **Phase 5:** Old codepaths are disabled (routes return 501)
4. **Phase 6:** Old code is removed

### 12.4 Rollback Plan

Each phase has a rollback:
- **Phase 1:** Delete `settings/academic_calendar`, revert to `deadline-config.json`
- **Phase 2:** Disable new payment routes, revert to old payment routes
- **Phase 3:** Disable new application routes, revert to old application routes
- **Phase 4:** Stop new writes, old writes continue
- **Phase 5:** Re-enable old routes
- **Phase 6:** Restore old code from git

---

## 13. Repository Impact

### 13.1 Files to Create

| File | Purpose |
|------|---------|
| `src/lib/engines/academic-calendar/index.ts` | Calendar engine: config, date computation |
| `src/lib/engines/academic-calendar/types.ts` | Calendar types |
| `src/lib/engines/session/index.ts` | Session resolution engine |
| `src/lib/engines/session/types.ts` | Session types |
| `src/lib/engines/payment/index.ts` | Payment ledger engine (append-only) |
| `src/lib/engines/payment/types.ts` | Payment types |
| `src/lib/engines/application/index.ts` | Application state machine |
| `src/lib/engines/application/types.ts` | Application types |
| `src/lib/engines/seat-ownership/index.ts` | Seat ownership engine |
| `src/lib/engines/seat-ownership/types.ts` | Seat types |
| `src/lib/engines/renewal/index.ts` | Renewal engine (wraps application) |
| `src/lib/engines/student-lifecycle/index.ts` | Student lifecycle engine |
| `src/lib/engines/student-lifecycle/types.ts` | Student lifecycle types |
| `src/lib/engines/coordinator.ts` | Cross-engine coordination |
| `src/lib/permissions/index.ts` | Permission definitions and checks |
| `src/lib/permissions/types.ts` | Permission types |

### 13.2 Files to Modify

| File | Change |
|------|--------|
| `src/lib/utils/session.ts` | Replace with session engine calls |
| `src/lib/utils/deadline-computation.ts` | Replace with calendar engine calls |
| `src/lib/utils/renewal-utils.ts` | Replace with renewal engine calls |
| `src/lib/utils/application-eligibility.ts` | Replace with session engine calls |
| `src/lib/deadline-config-service.ts` | Replace with calendar engine |
| `src/lib/system-config-service.ts` | Remove duplicated date fields |
| `src/lib/bus-fee-service.ts` | Keep, but fee comes from session config |
| `src/lib/busCapacityService.ts` | Replace with seat ownership engine |
| `src/lib/bus-capacity-checker.ts` | Replace with seat ownership engine |
| `src/lib/services/admin-reconcile-bus-loads.ts` | Use seat ownership engine |
| `src/lib/payment/payment.service.ts` | Replace with payment engine |
| `src/lib/payment/payment-transaction.service.ts` | Remove (replaced by payment engine) |
| `src/lib/payment/payment-history.service.ts` | Remove (replaced by payment engine) |
| `src/lib/payment/application-payment.service.ts` | Remove (client-side logic simplified) |
| `src/lib/entitlement/transport-entitlement.ts` | Use student lifecycle engine |
| `src/lib/security/moderator-permissions.ts` | Use new permission model |
| `src/lib/types/moderator-permissions.ts` | Extend with new permissions |
| `src/lib/types/payment.ts` | Replace with payment engine types |
| `src/lib/types/application.ts` | Replace with application engine types |
| `src/lib/types/deadline-config.ts` | Replace with calendar engine types |
| `src/config/deadline-config.json` | Remove (replaced by calendar config) |
| `src/config/system_config.json` | Remove duplicated date fields |

### 13.3 API Routes to Modify

| Route | Change |
|-------|--------|
| `src/app/api/applications/*` | Use application engine |
| `src/app/api/payment/*` | Use payment engine |
| `src/app/api/payments/*` | Use payment engine |
| `src/app/api/renewal-requests/*` | Replace with application engine (renewal type) |
| `src/app/api/renew-services/*` | Replace with renewal engine |
| `src/app/api/student/renew-service-v2/*` | Replace with renewal engine |
| `src/app/api/settings/deadline-config/*` | Use calendar engine |
| `src/app/api/settings/deadline-preview/*` | Use calendar engine |
| `src/app/api/admin/deadline-config/*` | Use calendar engine |
| `src/app/api/admin/simulate-deadlines/*` | Use calendar + student lifecycle engine |
| `src/app/api/cron/cleanup-expired-students/*` | Use student lifecycle engine |
| `src/app/api/admin/bus-fee/*` | Fee per session from calendar engine |

### 13.4 Components to Modify

| Component | Change |
|-----------|--------|
| `src/components/PaymentModeSelector.tsx` | Use payment engine |
| `src/components/payment/*` | Use payment engine |
| `src/components/student/SessionStatusBanner.tsx` | Use session engine |
| `src/components/transport/TransportEntitlementGuard.tsx` | Use student lifecycle engine |
| `src/components/StudentAccessBlockScreen.tsx` | Use calendar engine |
| `src/hooks/useTransportEntitlement.ts` | Use student lifecycle engine |
| `src/hooks/useModeratorPermissions.ts` | Use new permission model |
| `src/app/apply/form/*` | Use application + session engine |
| `src/app/student/renew/*` | Use renewal engine |
| `src/app/moderator/applications/*` | Use application engine |
| `src/app/moderator/renewal-service/*` | Remove (merged into applications) |

### 13.5 Files to Remove (Eventually)

| File | Reason |
|------|--------|
| `src/lib/payment/payment-transaction.service.ts` | Replaced by payment engine |
| `src/lib/payment/payment-history.service.ts` | Replaced by payment engine |
| `src/lib/payment/application-payment.service.ts` | Client-side simplification |
| `src/config/deadline-config.json` | Replaced by calendar config |
| `src/lib/types/deadline-config-defaults.ts` | Throwing proxy no longer needed |
| `src/app/api/renewal-requests/*` | Replaced by application engine |
| `src/app/api/renew-services/*` | Replaced by renewal engine |
| `src/app/moderator/renewal-service/*` | Merged into applications |
| `src/app/moderator/renew-services/*` | Merged into applications |
| `src/app/student/renew-services/*` | Simplified renewal page |

---

## 14. Implementation Phases

### Phase 1: Academic Calendar Engine + Session Engine

**Goal:** Replace hardcoded date logic with configurable calendar.

**Tasks:**
1. Create `src/lib/engines/academic-calendar/` with config schema, validation, date computation
2. Create `src/lib/engines/session/` with session resolution
3. Create API routes for calendar config CRUD
4. Create migration script to populate calendar config from existing deadline config
5. Update `deadline-computation.ts` to use calendar engine
6. Update `session.ts` to use session engine
7. Update `application-eligibility.ts` to use session engine
8. Update `renewal-utils.ts` to use calendar engine
9. Write tests for all date computations across multiple calendar configs
10. Deploy with feature flag (old code still runs)

**Verification:**
- All existing tests pass
- New tests verify July→July AND January→December AND custom calendars
- No behavior change for existing ADTU deployment

**Estimated effort:** 2-3 weeks

### Phase 2: Payment Ledger Engine

**Goal:** Replace mutable payment model with immutable ledger.

**Tasks:**
1. Create `src/lib/engines/payment/` with append-only CRUD
2. Add `applicationId` column to Supabase `payments` table
3. Create payment application linking
4. Remove `applyPaymentValidityToStudent()` from payment service
5. Replace `PaymentTransactionService` with payment engine
6. Replace `payment-history.service.ts` with payment engine
7. Add pending payment expiry cron (7-day TTL)
8. Update all API routes to use payment engine
9. Write tests for all payment state transitions
10. Deploy with feature flag

**Verification:**
- All payment operations work identically
- No payment writes to student state
- Audit trail is complete

**Estimated effort:** 2-3 weeks

### Phase 3: Application Engine + Unified Renewal

**Goal:** Unify fresh applications and renewals into one state machine.

**Tasks:**
1. Create `src/lib/engines/application/` with state machine
2. Create `src/lib/engines/renewal/` as application type handler
3. Migrate `renewal_requests` to `applications` collection
4. Update approval flow to handle all application types
5. Update submission flow to handle all application types
6. Remove separate renewal API routes
7. Update moderator UI to show all applications in one queue
8. Update student renewal page to create applications
9. Write tests for all application state transitions
10. Deploy with feature flag

**Verification:**
- Fresh applications work identically
- Renewals work identically (but through application engine)
- One approval queue for all request types

**Estimated effort:** 3-4 weeks

### Phase 4: Seat Ownership Engine

**Goal:** Centralize seat management with mathematical rules.

**Tasks:**
1. Create `src/lib/engines/seat-ownership/` with ownership predicates
2. Replace `busCapacityService.ts` with seat engine
3. Replace `bus-capacity-checker.ts` with seat engine
4. Update `admin-reconcile-bus-loads.ts` to use seat engine
5. Update application approval to use seat engine
6. Update renewal approval to use seat engine
7. Update soft block cron to use seat engine
8. Write tests for all seat state transitions
9. Deploy with feature flag

**Verification:**
- Seat allocation works identically
- Seat release works identically
- No over-allocation possible
- Reconciliation produces same results

**Estimated effort:** 2-3 weeks

### Phase 5: Student Lifecycle Engine + Permission Model

**Goal:** Define clear student states and granular permissions.

**Tasks:**
1. Create `src/lib/engines/student-lifecycle/` with state machine
2. Create `src/lib/permissions/` with granular permission model
3. Update student status transitions to use lifecycle engine
4. Update entitlement check to use lifecycle engine
5. Update moderator permissions to use new permission model
6. Update all API routes to use new permission checks
7. Update UI to respect new permissions
8. Add new permission presets (viewer, moderator, admin)
9. Write tests for all lifecycle transitions
10. Deploy with feature flag

**Verification:**
- All status transitions work identically
- All permission checks work identically
- New permissions are available for configuration

**Estimated effort:** 2-3 weeks

### Phase 6: Migration + Cleanup

**Goal:** Remove old code, complete data migration.

**Tasks:**
1. Backfill `applicationId` on existing payments
2. Migrate existing `renewal_requests` to `applications`
3. Remove old payment services
4. Remove old renewal routes
5. Remove old deadline config files
6. Remove duplicated configuration
7. Update documentation
8. Remove feature flags
9. Final regression testing
10. Deploy to production

**Verification:**
- All old code is removed
- No references to old services
- All tests pass
- Production deployment is clean

**Estimated effort:** 1-2 weeks

---

## Summary

### Total Estimated Effort: 12-18 weeks

### Key Outcomes

1. **Multi-university ready.** One config file defines the entire academic calendar. No code changes needed for different universities.
2. **Deterministic workflows.** Every state transition has exactly one codepath. No ambiguity.
3. **Immutable financial records.** Payment ledger is append-only. Audit integrity guaranteed.
4. **Unified application model.** Fresh, renewal, and future applications use one state machine.
5. **Mathematical seat ownership.** Precise predicates. No race conditions. Self-healing reconciliation.
6. **Granular permissions.** Every operation has an independent permission toggle.
7. **Composable engines.** Each engine is independent, testable, and replaceable.
8. **Zero-downtime migration.** Progressive rollout with feature flags and rollback capability.
