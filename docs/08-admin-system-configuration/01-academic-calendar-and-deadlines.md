# Academic Calendar, Deadlines & Lifecycle Automation

## 1. Domain Overview & Configuration Model

The **Academic Calendar System** governs transit pass lifecycles, service expiration dates, renewal notification schedules, access revocation (soft block), and data retention policies (hard delete) across Assam down town University (AdtU).

### The Per-Student Dynamic Year Rule
To maintain continuous multi-year academic operations without requiring annual manual database rewrites, the calendar enforces a strict configuration invariant:
- **Configuration stores Month and Day ONLY (no static calendar year):**  
  The system calendar in PostgreSQL (`settings/deadline` via the Calendar domain) stores the reference start date as `{ month: 6, day: 1 }` (July 1st in 0-indexed month format).
- **Year is dynamically derived per student:**  
  All lifecycle milestones are computed relative to each student's individual `sessionEndYear` (e.g., Class of 2026, 2027, etc.).
- **Zero Static Year Drift:** As new academic years commence, existing students' expiration schedules remain anchored to their graduation terms, while incoming intakes automatically inherit the upcoming cycle.

```
                  ┌──────────────────────────────────────────────┐
                  │          ACADEMIC CALENDAR CONFIG            │
                  │   academicSessionStart: { month: 6, day: 1 } │
                  │            (Month / Day ONLY)                │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       STUDENT SESSION END YEAR (e.g. 2026)   │
                  │         Stored in `student_profiles`         │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │     deriveAcademicLifecycle(month, day, yr)  │
                  └──────────────────────┬───────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         │                               │                               │
         ▼                               ▼                               ▼
┌─────────────────┐             ┌─────────────────┐             ┌─────────────────┐
│ SERVICE EXPIRY  │             │   SOFT BLOCK    │             │   HARD DELETE   │
│ June 30, 23:59  │             │  July 1, 00:00  │             │  July 1, +2 Yrs │
│ Passes Expire   │             │ Seat Released   │             │ Profile Purged  │
└─────────────────┘             └─────────────────┘             └─────────────────┘
```

---

## 2. Programmatic Lifecycle Derivation (`deriveAcademicLifecycle`)

The core mathematical engine (`src/lib/utils/deadline-computation.ts`) derives nine exact dates from the configured session start date and the student's `effectiveYear` (`sessionEndYear`):

| Lifecycle Milestone | Offset / Derivation Formula | Example (Session End 2026, Start July 1) | Operational Significance |
| :--- | :--- | :--- | :--- |
| **`sessionStart`** | `effectiveYear - 1`, Start Month/Day | July 1, 2025 (00:00:00 UTC) | Academic term commencement. |
| **`reminder1`** | Expiry minus 3 months (1st of month) | April 1, 2026 (00:00:00 UTC) | First renewal notification dispatched. |
| **`reminder2`** | Expiry minus 2 months (1st of month) | May 1, 2026 (00:00:00 UTC) | Second renewal notification dispatched. |
| **`finalReminder`**| Expiry minus 15 days | June 15, 2026 (00:00:00 UTC) | Urgent warning notification with countdown. |
| **`expiry`** | 1 day before next session start (23:59:59) | June 30, 2026 (23:59:59 UTC) | Transport pass validity expires. |
| **`deadline`** | Equal to `expiry` | June 30, 2026 (23:59:59 UTC) | Standard renewal window closes. |
| **`softBlock`** | Exactly when next session starts | July 1, 2026 (00:00:00 UTC) | Access revoked; bus seat quota released. |
| **`activation`** | Equal to `softBlock` | July 1, 2026 (00:00:00 UTC) | Gated `verified_upcoming` passes activate. |
| **`hardDelete`** | 2 sessions after expiry | July 1, 2028 (00:00:00 UTC) | Stale unrenewed profile permanently purged.|

### 2.1 Leap Year Normalization (`normalizeLeapYearDate`)
When configuring calendar dates or calculating milestones across February:
- If a date resolves to February 29 during a non-leap year, `normalizeLeapYearDate` automatically clamps the timestamp to February 28:
  ```typescript
  if (month === 1 && day === 29) {
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      if (!isLeapYear) return new Date(year, 1, 28);
  }
  ```
- Prevents JavaScript `Date` overflow into March 1st.

---

## 3. Administrative Simulation Mode

To verify date arithmetic, notification schedules, and blocking logic without modifying live production records, the administrator console provides a **Simulation Mode**:
- **Configuration Payload:**
  ```json
  {
    "simulationMode": {
      "enabled": true,
      "customYear": 2025
    }
  }
  ```
- **Execution Effect:**
  - Evaluates `computeDatesForStudent` using `effectiveYear = simulationMode.customYear`.
  - Renders a live preview matrix showing when reminders, soft blocks, and deletions would fire for real student profiles.
  - Leaves persistent database timestamps untouched (`isSimulated: true`).

---

## 4. Scheduled Background Crons

The academic calendar coordinates with four automated background cron endpoints:

### 4.1 Daily Student Expiration & Cleanup (`cron/cleanup-expired-students`)
Scheduled daily via external runner or Vercel Cron. Guarded by `verifyCronAuth`:
1. **Pre-Stored Date Evaluation:** Checks each student's pre-computed `softBlock` and `hardBlock` timestamps. Migrates legacy profiles missing these fields on the fly using `computeBlockDatesFromValidUntil`.
2. **Soft Block Execution:**
   - Evaluates `today >= softBlock` for students with `status = 'active'`.
   - Invokes atomic PostgreSQL RPC `soft_block_student_with_seat_release(p_student_uid, p_bus_id, p_shift, p_release_seat, ...)`.
   - Transitions student status to `'soft_blocked'`.
   - **Seat Quota Release:** Atomically decrements the vehicle's `morning_load` or `evening_load` and sets `student_profiles.seat_released_at = NOW()`. The freed seat immediately returns to the university pool for new student enrollment.
   - Emits an audit event: `action: 'student_soft_blocked_seat_released'`.
3. **Hard Delete Execution (Data Minimization):**
   - Evaluates `today >= hardDelete` for long-dormant unrenewed accounts.
   - **Fail-Closed Safety Rails:**
     - Skips accounts with missing or future `validUntil`.
     - Skips students active within the last 30 days (`lastActiveAt` or `lastLoginAt`).
     - Skips accounts without `sessionEndYear`.
   - Invokes `deleteUserAndData(uid, 'student')`: purges student profiles, uploaded ID card images from Cloudinary, and associated records.
   - Emits an audit event: `action: 'student_hard_deleted'`.
4. **Tail Bus Load Reconciliation:** Runs `adminReconcileBusLoads` to audit and resynchronize all vehicle capacity counters with active database profiles.

### 4.2 Session Activation Engine (`cron/session-activation`)
Scheduled daily. Activates future-session student passes:
1. Compares `today >= academicSessionStart`. If current date precedes session start, terminates immediately.
2. Scans all applications where `state = 'verified_upcoming'` and `targetSession.startYear == currentSessionStartYear`.
3. Checks bus capacity on target shift.
   - If available: Creates `student_profiles` row, increments bus load under row lock, issues digital QR pass, and transitions application to `approved`.
   - If capacity is exhausted: Transitions application to `pending_seat_allocation` and notifies student and administrators.

### 4.3 Expiry Warning Notifications (`cron/expiry-check`)
Scheduled daily. Scans active passes approaching their validity limits:
- Dispatches Stage 1 Reminder at 90 days before expiry.
- Dispatches Stage 2 Reminder at 60 days before expiry.
- Dispatches Final Warning at 15 days before expiry with renewal instructions.
