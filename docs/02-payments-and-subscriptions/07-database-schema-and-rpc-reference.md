# Payment & Financial Ledger Database Schema, Triggers & PL/pgSQL RPC Reference (Forensic Truth)

**Module:** Immutable Financial Ledger, `payments`, `payment_orders`, Check Constraints, Triggers & ACID RPCs  
**File Authority:** `supabase/COMPLETE_SCHEMA.sql`, `supabase/migrations/`  
**Security Gate:** OWASP ASVS V10 (Financial Integrity), Immutable Rows, Row-Level Security  

---

# PART 1: Database Schema, Financial Ledger Tables, Constraints, Immutability Triggers & Atomic PL/pgSQL RPCs

### 1.1 Sub-Domain Architecture & Exact Execution Pipeline

The financial ledger, seat allocation, and student lifecycle subsystem is built upon PostgreSQL 16 (hosted via Supabase) with strict database-level immutability triggers, partial unique indexes, row-level locks, and security-definer stored procedures (RPCs).

#### System Execution Pipeline & State Machine

```
                   [Client / External Gateway / Cron Worker]
                                      │
                                      ▼
               ┌──────────────────────────────────────────────┐
               │         Database Row-Level Security          │
               │  - payments_select_own (student/service)     │
               │  - payments_insert_service (service_role)    │
               │  - payments_no_delete (BLOCKED TO PUBLIC)    │
               └──────────────────────┬───────────────────────┘
                                      │
            ┌─────────────────────────┴────────────────────────┐
            │                                                  │
            ▼                                                  ▼
┌───────────────────────────────┐              ┌───────────────────────────────┐
│     public.applications       │              │        public.payments        │
│  - Partial Unique Index:      │              │  - Immutability Trigger:      │
│    idx_applications_active_   │              │    protect_completed_payments │
│    student_session            │              │  - Partial Unique Indexes:    │
│  - State Machine Transition:  │              │    idx_payments_unique_rzp    │
│    transition_application_    │              │    idx_payments_one_completed │
│    state()                    │              │  - Statuses: Pending,         │
│  - States: draft ->           │              │    Completed, Refunded,       │
│    awaiting_verification ->   │              │    Captured_Pending_Review,   │
│    verified -> submitted ->   │              │    Duplicate_Pending_Refund   │
│    approved / rejected /      │              └───────────────┬───────────────┘
│    pending_seat_allocation    │                              │
└───────────────┬───────────────┘                              │
                │                                              │
                └──────────────────────┬───────────────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │     Atomic PL/pgSQL RPC Layer     │
                     ├───────────────────────────────────┤
                     │ - approve_renewal_with_seat()     │
                     │ - bus_increment_capacity()        │
                     │ - bus_decrement_capacity()        │
                     │ - soft_block_student_with_seat... │
                     │ - process_payment_refund_atomic() │
                     │ - increment_expiry_reminder_...   │
                     └─────────────────┬─────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     │                                   │
                     ▼                                   ▼
      ┌─────────────────────────────┐     ┌─────────────────────────────┐
      │   public.student_profiles   │     │        public.buses         │
      │ - Row locked FOR UPDATE     │     │ - Row locked FOR UPDATE     │
      │ - Status: active,           │     │ - Check: morning_load < cap │
      │   soft_blocked, expired     │     │ - Check: evening_load < cap │
      │ - valid_until, soft_block,  │     │ - Increments / decrements   │
      │   seat_released_at          │     │   shift load atomically     │
      └─────────────────────────────┘     └─────────────────────────────┘
```

#### Chronological Execution Trace & Lock Boundaries

1. **Application Submission / Lock Phase:**
   - A row is inserted or acquired in `public.applications`.
   - `idx_applications_active_student_session` evaluates `(applicant_uid, COALESCE(session_start_year, 0))` for non-terminal states (`WHERE state NOT IN ('rejected', 'cancelled', 'expired')`). Any duplicate submission raises error code `23505` (unique_violation).
   - If an application lock is acquired, `processing_lock` (UUID/worker-id) and `processing_lease_expires_at` (NOW() + lease) are stamped. Abandoned locks are cleaned via `cleanup_abandoned_application_locks()`.

2. **Payment Ingestion & Immutability Enforcement:**
   - Inserter issues `INSERT INTO public.payments`.
   - Before insertion or transition to `'Completed'`, `chk_payments_completed_session` ensures `session_start_year IS NOT NULL AND session_end_year IS NOT NULL AND session_start_year < session_end_year`.
   - `idx_payments_unique_razorpay_payment_id` prevents duplicate capture records for the same provider payment ID.
   - `idx_payments_one_completed_per_session` enforces that a student can have at most ONE `'Completed'` row per session.
   - `protect_completed_payments_trigger` executes `BEFORE UPDATE OR DELETE ON public.payments`:
     - Blocks any `DELETE` on finalized/audit records (`Completed`, `Duplicate_Pending_Refund`, `Captured_Pending_Review`, `Refunded`, `Refund_Denied`, `Rejected`).
     - Blocks mutation of financial identity fields (`amount`, `currency`, `method`, `student_uid`, `student_id`, `payment_id`, `razorpay_payment_id`, `razorpay_order_id`, `session_start_year`, `session_end_year`).
     - Restricts lifecycle transitions: `Completed` may **ONLY** transition to `Refunded` when accompanied by `approved_by`, `approved_at`, external refund reference, and cumulative `refunded_amount >= amount - 0.01`.

3. **Atomic Renewal Approval & Seat Acquisition (`approve_renewal_with_seat`):**
   - Step 1: Takes exclusive row lock on `public.student_profiles` via `SELECT ... FOR UPDATE` by `p_student_uid`.
   - Step 2: Takes exclusive row lock on `public.buses` via `SELECT ... FOR UPDATE` by `p_bus_id`.
   - Step 3: Evaluates normalized shift (`morning`, `evening`, or `both`). If `morning_load >= capacity` (for morning/both) or `evening_load >= capacity` (for evening/both), immediately returns `{'success': false, 'error': 'CAPACITY_FULL'}` without mutating any table.
   - Step 4: Updates `buses` with `morning_load = v_new_morning`, `evening_load = v_new_evening`, `current_members = v_new_morning + v_new_evening`.
   - Step 5: Updates `student_profiles` to `status = 'active'`, `valid_until = p_valid_until`, `session_end_year = p_session_end_year`, `seat_released_at = NULL`.
   - Step 6: Updates `applications` to `state = 'approved'`, `reviewed_by = p_approved_by`, `reviewed_at = NOW()`.
   - Both rows release locks upon transaction commit.

4. **Lifecycle Expiry & Soft-Block (`soft_block_student_with_seat_release`):**
   - Step 1: Takes exclusive lock on `student_profiles` row `FOR UPDATE`. Verifies status is `'active'`.
   - Step 2: If `p_release_seat` is TRUE and `p_bus_id` is present, calls `bus_decrement_capacity(p_bus_id, v_normalized_shift)`.
   - Step 3: Updates `student_profiles` to `status = 'soft_blocked'` and sets `seat_released_at = p_seat_released_at`.
   - Step 4: If student update fails, executes compensating call to `bus_increment_capacity` to prevent seat drift.

---

### 1.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Tables / Triggers | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `supabase/COMPLETE_SCHEMA.sql` | `public.payments`, `public.processed_payments`, `public.applications`, `public.student_profiles`, `public.buses`, `public.system_settings`, `public.audit_events` | Supabase CLI, DB Migrations, Migration Runners | PostgreSQL Engine | All core ITMS tables, triggers, indexes, RLS policies |
| `supabase/migrations/20261009_payment_immutability_and_preflight.sql` | `protect_completed_payments()`, `get_payment_analytics_aggregates()`, `process_payment_refund_atomic()` | Postgres trigger on `payments`, `PaymentRepository.getAnalytics()`, `/api/payment/refund/route.ts` | `public.payments`, `public.audit_events` | Mutates `public.payments`, acquires row lock `FOR UPDATE` |
| `supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql` | `soft_block_student_with_seat_release()`, `idx_applications_active_student_session` | `/api/cron/cleanup-expired-students/route.ts` | `bus_decrement_capacity()`, `bus_increment_capacity()` | Mutates `student_profiles`, `buses` |
| `supabase/migrations/20261016_fix_transition_application_state_guard.sql` | `transition_application_state()` | Application API routes (`/api/applications/[id]/*`) | Internal state validation matrix | Mutates `public.applications` (state, state_history) |
| `supabase/migrations/20261018_consolidated_production_hardening.sql` | Hardened RPC definitions | Superseded by 20261018 shift parity migration | Core tables | `buses`, `student_profiles`, `applications` |
| `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` | `bus_increment_capacity()`, `bus_decrement_capacity()`, `approve_renewal_with_seat()`, `reassign_students_atomically()` | `/api/student/renew-service-v2/route.ts`, `/api/admin/renewal-service/route.ts`, Seat Allocation Services | Row locks `FOR UPDATE` on `buses`, `student_profiles`, `applications` | Mutates `buses`, `student_profiles`, `applications` |

---

### 1.3 Method-by-Method Low-Level Walkthrough

#### 1. `protect_completed_payments()` (Trigger Function on `public.payments`)
- **Signature:** `RETURNS TRIGGER AS $$`
- **Execution Event:** `BEFORE UPDATE OR DELETE ON public.payments FOR EACH ROW`
- **Control Flow & Branching:**
  1. `IF TG_OP = 'DELETE'`:
     - Checks if `OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected')`.
     - If true, raises exception: `'Cannot delete finalized or audit payment record %'`.
     - Otherwise permits deletion (only allowed for transient `Pending` or `Failed` payments not yet finalized).
  2. `IF TG_OP = 'UPDATE'`:
     - **Identity & Financial Field Immutability:** For statuses in `('Completed', 'Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied', 'Rejected')`, evaluates if any of the following fields are distinct using `IS DISTINCT FROM`:
       `amount`, `currency`, `method`, `student_uid`, `student_id`, `payment_id`, `razorpay_payment_id`, `razorpay_order_id`, `session_start_year`, `session_end_year`.
       If any field is changed, raises exception: `'Cannot mutate financial or identity fields of finalized/audit payment record % (current status: %)'`.
     - **`Captured_Pending_Review` Protection:** Prevents changes to financial/provider fields. Session years cannot be mutated unless transitioning away from `Captured_Pending_Review`.
     - **Completed Transition Rules:** `Completed` status may **ONLY** transition to `'Refunded'`. Any other target status raises exception. When transitioning to `'Refunded'`:
       - `NEW.approved_by` MUST NOT BE NULL.
       - `NEW.approved_at` MUST NOT BE NULL.
       - `NEW.metadata` MUST contain at least one of `refund_id`, `external_refund_ref`, or `razorpay_refund_id`.
       - `(NEW.metadata->>'refunded_amount')::NUMERIC >= (OLD.amount - 0.01)` (full refund required).
     - **`Duplicate_Pending_Refund` Transition Rules:** May only transition to `'Refunded'` or `'Refund_Denied'`.
     - **Terminal Status Immutability:** `Refunded`, `Refund_Denied`, and `Rejected` are strictly terminal. Any status change raises exception `'Cannot mutate status of terminal payment record %'`.
  3. Returns `NEW`.

#### 2. `approve_renewal_with_seat(...)` (PL/pgSQL RPC)
- **Signature:**
  ```sql
  public.approve_renewal_with_seat(
      p_student_uid       TEXT,
      p_bus_id            TEXT,
      p_shift             TEXT,
      p_valid_until       TIMESTAMPTZ,
      p_session_end_year  INTEGER,
      p_session_duration  INTEGER,
      p_application_id    TEXT,
      p_approved_by       TEXT,
      p_soft_block        BOOLEAN DEFAULT FALSE,
      p_hard_block        BOOLEAN DEFAULT FALSE
  ) RETURNS JSONB
  ```
- **Control Flow & Branching:**
  1. Validates shift: normalizes to lowercase `morning`, `evening`, or `both`. If invalid, returns `{'success': false, 'error': 'Invalid shift: ...'}`.
  2. Takes row lock: `SELECT ... FROM student_profiles WHERE uid = p_student_uid FOR UPDATE`. If missing, returns 404 error object.
  3. Takes row lock: `SELECT ... FROM buses WHERE id = p_bus_id FOR UPDATE`. If missing, returns 404 error object.
  4. Capacity check against `v_bus.capacity`:
     - If shift is `morning` and `morning_load >= capacity` -> returns `{'success': false, 'error': 'CAPACITY_FULL', 'busId': p_bus_id, 'shift': p_shift}`.
     - If shift is `evening` and `evening_load >= capacity` -> returns `{'success': false, 'error': 'CAPACITY_FULL', ...}`.
     - If shift is `both` and either load `>= capacity` -> returns `{'success': false, 'error': 'CAPACITY_FULL', ...}`.
  5. Computes `v_new_morning` and `v_new_evening`. Updates `buses` row with new loads and `current_members = v_new_morning + v_new_evening`.
  6. Updates `student_profiles`: sets `status = 'active'`, `valid_until = p_valid_until`, `session_end_year = p_session_end_year`, `session_duration = p_session_duration`, `soft_block = p_soft_block`, `hard_block = p_hard_block`, `seat_released_at = NULL`, `last_processed_application_id = p_application_id`.
  7. Asserts row count: `GET DIAGNOSTICS v_student_updated = ROW_COUNT`. If not 1, raises exception.
  8. Updates `applications`: sets `state = 'approved'`, `reviewed_by = p_approved_by`, `reviewed_at = NOW()`.
  9. Asserts row count: `GET DIAGNOSTICS v_app_updated = ROW_COUNT`. If not 1, raises exception.
  10. Returns JSON object with `success: true`, loads, and `valid_until`.

#### 3. `bus_increment_capacity(...)` and `bus_decrement_capacity(...)`
- **Signatures:**
  ```sql
  public.bus_increment_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning', p_enforce_capacity BOOLEAN DEFAULT true) RETURNS JSONB
  public.bus_decrement_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning') RETURNS JSONB
  ```
- **Control Flow:**
  - Shift validation accepts `'morning'`, `'evening'`, `'both'`.
  - Finds bus row by `id = p_bus_id OR bus_number = p_bus_id` with `FOR UPDATE LIMIT 1`.
  - For increment: checks capacity limits when `p_enforce_capacity = true`. Increments `morning_load` (if morning/both) and `evening_load` (if evening/both).
  - For decrement: uses `GREATEST(0, load - 1)` to prevent negative loads.
  - Updates `current_members = morning_load + evening_load`.
  - Returns JSON object with updated loads and success flag.

#### 4. `soft_block_student_with_seat_release(...)`
- **Signature:**
  ```sql
  public.soft_block_student_with_seat_release(
      p_student_uid      TEXT,
      p_bus_id           TEXT,
      p_shift            TEXT,
      p_release_seat     BOOLEAN,
      p_soft_blocked_at  TIMESTAMPTZ,
      p_seat_released_at TIMESTAMPTZ
  ) RETURNS JSONB
  ```
- **Control Flow:**
  - Locks student record: `SELECT ... FROM student_profiles WHERE uid = p_student_uid FOR UPDATE`.
  - If status != `'active'`, aborts with status 409 (`'Student not active, already blocked or deleted'`).
  - If `p_release_seat = TRUE` and `p_bus_id IS NOT NULL`, executes `bus_decrement_capacity(p_bus_id, v_normalized_shift)`.
    - If bus is missing/decommissioned (`error LIKE '%not found%'`), logs non-fatal warning and continues.
  - Updates `student_profiles`: `status = 'soft_blocked'`, `seat_released_at = p_seat_released_at`.
  - Diagnostics check: if updated rows != 1, executes compensating rollback by calling `bus_increment_capacity` and raises exception.

#### 5. `process_payment_refund_atomic(...)`
- **Signature:**
  ```sql
  public.process_payment_refund_atomic(
      p_payment_id TEXT,
      p_refund_id TEXT,
      p_amount_paise BIGINT,
      p_authorized_by JSONB,
      p_reason TEXT DEFAULT 'Processed refund'
  ) RETURNS JSONB
  ```
- **Control Flow:**
  - Validates `p_refund_id` (mandatory external reference), `p_amount_paise > 0`, and `p_authorized_by->>'userId'`.
  - Takes exclusive row lock: `SELECT * FROM public.payments WHERE payment_id = p_payment_id FOR UPDATE`.
  - Checks status: permitted from `Completed`, `Duplicate_Pending_Refund`, `Captured_Pending_Review`. If already `Refunded`, checks `metadata->'refund_history'` for idempotent replay of `p_refund_id`.
  - Computes `v_original_paise = ROUND(amount * 100)`.
  - Scans `refund_history` in metadata. If `p_refund_id` is already recorded as processed, returns idempotently without re-refunding.
  - Computes new cumulative refunded paise: `v_new_cumulative_paise = v_other_refunded_paise + p_amount_paise`.
  - Invariant check: `v_new_cumulative_paise > v_original_paise` returns error `'Cumulative refunded amount cannot exceed original payment amount'`.
  - Appends current refund entry to `refund_history` JSONB array.
  - If `v_new_cumulative_paise >= v_original_paise` (fully refunded):
    - Updates `payments`: `status = 'Refunded'`, `approved_by = v_actor`, `approved_at = v_now`, and writes complete metadata.
  - If partially refunded:
    - Retains existing status and updates `metadata` with partial refund accounting.

#### 6. `increment_expiry_reminder_count(...)`
- **Signature:** `public.increment_expiry_reminder_count(p_uid TEXT) RETURNS BOOLEAN`
- **Control Flow:**
  - Locks student profile: `SELECT last_expiry_reminder_sent_at FROM student_profiles WHERE uid = p_uid FOR UPDATE`.
  - If `last_expiry_reminder_sent_at::DATE = CURRENT_DATE` (UTC), returns `FALSE` immediately (same-day duplicate suppression).
  - Otherwise, increments `expiry_reminder_count = expiry_reminder_count + 1`, sets `last_expiry_reminder_sent_at = NOW()`, and returns `TRUE`.

#### 7. `cleanup_abandoned_application_locks()`
- **Signature:** `cleanup_abandoned_application_locks() RETURNS JSONB`
- **Control Flow:**
  - Scans `applications` where `processing_lock IS NOT NULL AND processing_lease_expires_at < NOW() AND processing_completed_at IS NULL`.
  - Resets `processing_lock = NULL`, `processing_started_at = NULL`, `processing_lease_expires_at = NULL`, `processing_result = 'expired'`, `processing_completed_at = NOW()`.
  - Returns `{'cleaned': count}`.

#### 8. `processed_payments_acquire(...)`, `release`, and `cleanup`
- **Signatures:**
  ```sql
  public.processed_payments_acquire(p_payment_id TEXT, p_order_id TEXT, p_amount NUMERIC, p_enrollment_id TEXT, p_user_id TEXT, p_source TEXT) RETURNS BOOLEAN
  public.processed_payments_release(p_payment_id TEXT) RETURNS VOID
  public.processed_payments_cleanup() RETURNS INTEGER
  ```
- **Control Flow:**
  - `acquire`: Attempts `INSERT INTO public.processed_payments (payment_id, order_id, processed_at, expires_at, amount, enrollment_id, user_id, source) VALUES (..., NOW() + INTERVAL '7 days')`. On `unique_violation`, catches exception and returns `FALSE`. Returns `TRUE` if acquired.
  - `release`: `DELETE FROM public.processed_payments WHERE payment_id = p_payment_id`.
  - `cleanup`: Deletes rows where `expires_at < NOW()` and returns count.

---

### 1.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario / Flow | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls |
| :--- | :--- | :--- | :--- |
| **(a) Cold Execution (Initial Renewal Approval via `approve_renewal_with_seat`)** | 1 RPC call executing: <br>1x `SELECT student_profiles FOR UPDATE`<br>1x `SELECT buses FOR UPDATE`<br>1x `UPDATE buses`<br>1x `UPDATE student_profiles`<br>1x `UPDATE applications` | 0 | 0 |
| **(b) Warm Execution (Subsequent Lookup & Idempotent Refund via `process_payment_refund_atomic`)** | 1 RPC call executing: <br>1x `SELECT payments FOR UPDATE`<br>0 Updates (idempotent branch taken) | 0 | 0 |
| **(c) Concurrent Duplicate / Race Collision (Two simultaneous `approve_renewal_with_seat` for last remaining seat)** | 2 RPCs competing for lock: <br>- 1st transaction acquires `buses FOR UPDATE`, succeeds, decrements remaining capacity to 0.<br>- 2nd transaction blocks on `buses FOR UPDATE`; once unblocked, reads updated load, evaluates `load >= capacity`, returns `CAPACITY_FULL` without mutating tables. | 0 | 0 |
| **(d) DB Failure / Rollback during `soft_block_student_with_seat_release`** | 1x `SELECT student_profiles FOR UPDATE`<br>1x `bus_decrement_capacity`<br>1x `UPDATE student_profiles` (fails)<br>1x compensating `bus_increment_capacity`<br>Transaction rollback. | 0 | 0 |

---

### 1.5 Verbatim Source Code from Live Codebase

#### Table: `public.payments` (from `supabase/COMPLETE_SCHEMA.sql` lines 397–445 and `supabase/migrations/20261009_payment_immutability_and_preflight.sql` lines 46–75)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 397-445)
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uid TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_method TEXT,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  order_id TEXT,
  payment_id TEXT UNIQUE,
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  receipt_id TEXT,
  academic_year TEXT,
  session_start_year INTEGER,
  session_end_year INTEGER,
  duration_years INTEGER,
  transaction_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  student_name TEXT,
  student_id TEXT,
  offline_transaction_id TEXT,
  document_signature TEXT,
  approved_by JSONB,
  approved_at TIMESTAMPTZ,
  fee_tier TEXT,
  bus_id TEXT,
  route_id TEXT,
  stop_name TEXT,
  shift TEXT,
  application_id TEXT,
  renewal_id TEXT,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  metadata JSONB
);

-- Ensure optional columns exist if table already exists in older schema
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS session_start_year INTEGER;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS duration_years INTEGER;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transaction_date TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approved_by JSONB;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Constraints and Partial Unique Indexes from supabase/migrations/20261009_payment_immutability_and_preflight.sql (Lines 57-75)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payments_completed_session'
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT chk_payments_completed_session
      CHECK (status <> 'Completed' OR (session_start_year IS NOT NULL AND session_end_year IS NOT NULL AND session_start_year < session_end_year));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_razorpay_payment_id
ON public.payments(razorpay_payment_id)
WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_completed_per_session
ON public.payments(student_uid, session_start_year, session_end_year)
WHERE status = 'Completed';
```

#### Table: `public.processed_payments` (from `supabase/COMPLETE_SCHEMA.sql` lines 449–459)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 449-459)
CREATE TABLE IF NOT EXISTS public.processed_payments (
    payment_id TEXT PRIMARY KEY,
    order_id TEXT,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    amount NUMERIC,
    enrollment_id TEXT,
    user_id TEXT,
    source TEXT DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Table: `public.applications` (from `supabase/COMPLETE_SCHEMA.sql` lines 339–393 and `supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql` lines 11–13)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 339-389)
CREATE TABLE IF NOT EXISTS applications (
    application_id              TEXT PRIMARY KEY,
    applicant_uid               TEXT NOT NULL,
    applicant_email             TEXT,
    email                       TEXT,
    state                       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'awaiting_verification', 'verified', 'submitted', 'verified_upcoming', 'pending_seat_allocation', 'approved', 'rejected', 'expired')),
    application_type            TEXT NOT NULL DEFAULT 'fresh' CHECK (application_type IN ('fresh', 'future', 'renewal', 'renewal_after_soft_block', 'new')),
    form_data                   JSONB DEFAULT '{}',
    state_history               JSONB DEFAULT '[]',
    target_session              JSONB,
    pending_verifier            TEXT,
    verification_attempts       INTEGER DEFAULT 0,
    verified_at                 TIMESTAMPTZ,
    verified_by                 TEXT,
    verified_by_id              TEXT,
    submitted_at                TIMESTAMPTZ,
    submitted_by                TEXT,
    approved_at                 TIMESTAMPTZ,
    approved_by                 TEXT,
    approved_by_id              TEXT,
    application_version         TEXT,
    needs_capacity_review       BOOLEAN DEFAULT FALSE,
    reassignment_reason         TEXT,
    has_alternative_buses       BOOLEAN DEFAULT FALSE,
    payment_id                  TEXT,
    eligible_approval           TIMESTAMPTZ,
    linked_student_uid          TEXT,
    verified_upcoming_at        TIMESTAMPTZ,
    verified_upcoming_by        TEXT,
    verified_upcoming_by_id     TEXT,
    pending_seat_allocation_at  TIMESTAMPTZ,
    assigned_driver_id          TEXT,
    assigned_driver_name        TEXT,
    expired_at                  TIMESTAMPTZ,
    expiry_reason               TEXT,
    eligible_reminder_sent_at   TIMESTAMPTZ,
    bus_id                      TEXT,
    route_id                    TEXT,
    stop_name                   TEXT,
    shift                       TEXT,
    session_start_year          INTEGER,
    session_end_year            INTEGER,
    processing_lock             TEXT,
    processing_lease_expires_at TIMESTAMPTZ,
    processing_started_at       TIMESTAMPTZ,
    processing_result           JSONB,
    processing_completed_at     TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by                  TEXT
);

-- File: supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql (Lines 11-13)
CREATE UNIQUE INDEX idx_applications_active_student_session 
ON public.applications (applicant_uid, COALESCE(session_start_year, 0)) 
WHERE state NOT IN ('rejected', 'cancelled', 'expired');
```

#### Table: `public.student_profiles` (from `supabase/COMPLETE_SCHEMA.sql` lines 88–125)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 88-125)
CREATE TABLE IF NOT EXISTS student_profiles (
    uid               TEXT PRIMARY KEY,
    email             TEXT,
    full_name         TEXT,
    phone             TEXT,
    alt_phone         TEXT,
    parent_name       TEXT,
    parent_phone      TEXT,
    faculty           TEXT,
    department        TEXT,
    gender            TEXT,
    dob               TEXT,
    enrollment_id     TEXT,
    blood_group       TEXT,
    address           TEXT,
    profile_photo_url TEXT,
    bus_id            TEXT,
    route_id          TEXT,
    stop_name         TEXT,
    shift             TEXT CHECK (shift IN ('Morning', 'Evening')),
    status            TEXT CHECK (status IN ('active', 'inactive', 'suspended', 'soft_blocked', 'pending_deletion', 'expired')),
    session_duration  TEXT,
    session_start_year INTEGER,
    session_end_year  INTEGER,
    semester          TEXT,
    valid_until       TIMESTAMPTZ,
    soft_block        TIMESTAMPTZ,
    hard_block        TIMESTAMPTZ,
    approved_by       TEXT,
    approved_at       TIMESTAMPTZ,
    last_processed_application_id TEXT,
    seat_released_at  TIMESTAMPTZ,
    pending_profile_update TEXT,
    expiry_reminder_count INTEGER DEFAULT 0,
    last_expiry_reminder_sent_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Table: `public.buses` (from `supabase/COMPLETE_SCHEMA.sql` lines 173–189)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 173-189)
CREATE TABLE IF NOT EXISTS buses (
    id              TEXT PRIMARY KEY,
    bus_number      TEXT NOT NULL UNIQUE,
    capacity        INTEGER NOT NULL CHECK (capacity > 0),
    morning_load    INTEGER NOT NULL DEFAULT 0 CHECK (morning_load >= 0),
    evening_load    INTEGER NOT NULL DEFAULT 0 CHECK (evening_load >= 0),
    current_members INTEGER NOT NULL DEFAULT 0 CHECK (current_members >= 0),
    model           TEXT,
    year            INTEGER,
    route_id        TEXT,
    route_name      TEXT,
    last_started_at TIMESTAMPTZ,
    last_ended_at   TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Table: `public.system_settings` (from `supabase/COMPLETE_SCHEMA.sql` lines 622–627)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 622-627)
CREATE TABLE IF NOT EXISTS public.system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);
```

#### Table: `public.audit_events` (from `supabase/COMPLETE_SCHEMA.sql` lines 536–556)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 536-556)
CREATE TABLE IF NOT EXISTS public.audit_events (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    action      TEXT NOT NULL,
    category    TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'low',
    summary     TEXT,
    actor_id    TEXT NOT NULL,
    actor_name  TEXT,
    actor_role  TEXT NOT NULL DEFAULT 'system',
    target_type TEXT,
    target_id   TEXT,
    target_name TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON public.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_category ON public.audit_events (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON public.audit_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON public.audit_events (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_metadata_opid ON public.audit_events ((metadata->>'operationId')) WHERE (metadata->>'operationId') IS NOT NULL;
```

#### Trigger & Function: `protect_completed_payments()` (from `supabase/migrations/20261009_payment_immutability_and_preflight.sql` lines 78–230)
```sql
-- File: supabase/migrations/20261009_payment_immutability_and_preflight.sql (Lines 78-230)
CREATE OR REPLACE FUNCTION public.protect_completed_payments()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. DELETE PROTECTION: Forbid deleting any finalized, duplicate, unresolved, refunded, refund-denied, or rejected payment record
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected') THEN
            RAISE EXCEPTION 'Cannot delete finalized or audit payment record %', OLD.payment_id;
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 2. IMMUTABILITY OF IDENTITY & FINANCIAL FIELDS FOR FINALIZED / AUDIT RECORDS
        -- Uses NULL-safe IS DISTINCT FROM comparison for all fields including nullable provider identifiers
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied', 'Rejected') AND (
            NEW.amount IS DISTINCT FROM OLD.amount OR
            NEW.currency IS DISTINCT FROM OLD.currency OR
            NEW.method IS DISTINCT FROM OLD.method OR
            NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
            NEW.student_id IS DISTINCT FROM OLD.student_id OR
            NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
            NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
            NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id OR
            NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
            NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
        ) THEN
            RAISE EXCEPTION 'Cannot mutate financial or identity fields of finalized/audit payment record % (current status: %)', OLD.payment_id, OLD.status;
        ELSIF OLD.status = 'Captured_Pending_Review' THEN
            -- Financial, method, and transaction identifiers are strictly immutable on Captured_Pending_Review
            IF (
                NEW.amount IS DISTINCT FROM OLD.amount OR
                NEW.currency IS DISTINCT FROM OLD.currency OR
                NEW.method IS DISTINCT FROM OLD.method OR
                NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
                NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
                NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
                NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id
            ) THEN
                RAISE EXCEPTION 'Cannot mutate financial or provider identity fields of Captured_Pending_Review payment record %', OLD.payment_id;
            END IF;

            -- If remaining in Captured_Pending_Review, session years cannot be mutated without a formal status transition
            IF NEW.status = 'Captured_Pending_Review' AND (
                NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
                NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
            ) THEN
                RAISE EXCEPTION 'Cannot alter session fields of Captured_Pending_Review record % without reconciling to Completed', OLD.payment_id;
            END IF;
        END IF;

        -- 3. LIFECYCLE TRANSITION CONSTRAINTS
        -- A. Completed transition constraints:
        -- Completed may ONLY transition to 'Refunded' when a verified full refund is recorded with complete audit evidence.
        -- Any other status change is strictly forbidden.
        IF OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Refunded' THEN
                -- Explicit safe refund transition requirements:
                -- 1. Authorized actor recorded
                IF NEW.approved_by IS NULL THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without authorized actor (approved_by)', OLD.payment_id;
                END IF;
                -- 2. Timestamp recorded
                IF NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without refund timestamp (approved_at)', OLD.payment_id;
                END IF;
                -- 3. External refund reference in metadata
                IF NEW.metadata IS NULL OR (
                    (NEW.metadata->>'refund_id' IS NULL OR TRIM(NEW.metadata->>'refund_id') = '') AND
                    (NEW.metadata->>'external_refund_ref' IS NULL OR TRIM(NEW.metadata->>'external_refund_ref') = '') AND
                    (NEW.metadata->>'razorpay_refund_id' IS NULL OR TRIM(NEW.metadata->>'razorpay_refund_id') = '')
                ) THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without external refund reference in metadata', OLD.payment_id;
                END IF;
                -- 4. Cumulative refunded amount must equal or exceed original captured amount
                IF NEW.metadata IS NULL OR NEW.metadata->>'refunded_amount' IS NULL OR
                   (NEW.metadata->>'refunded_amount')::NUMERIC < (OLD.amount - 0.01) THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded: cumulative refunded amount (%) must equal or exceed original captured amount (%)',
                        OLD.payment_id, COALESCE(NEW.metadata->>'refunded_amount', '0'), OLD.amount;
                END IF;
            ELSE
                RAISE EXCEPTION 'Cannot mutate status of Completed payment record %: permitted transition is only to Refunded upon verified full refund (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- B. Duplicate_Pending_Refund may only transition to 'Refunded' or 'Refund_Denied' (manual audit outcomes)
        IF OLD.status = 'Duplicate_Pending_Refund' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status NOT IN ('Refunded', 'Refund_Denied') THEN
                RAISE EXCEPTION 'Invalid status transition for Duplicate_Pending_Refund record %: permitted transitions are only Refunded or Refund_Denied (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- C. Captured_Pending_Review reconciliation transition:
        -- Permitted transitions are only: Completed, Duplicate_Pending_Refund, Refunded, or Refund_Denied
        IF OLD.status = 'Captured_Pending_Review' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Completed' THEN
                -- Explicit safe reconciliation operation requirements:
                -- 1. Valid session bounds: start < end
                IF NEW.session_start_year IS NULL OR NEW.session_end_year IS NULL OR NEW.session_start_year >= NEW.session_end_year THEN
                    RAISE EXCEPTION 'Cannot resolve Captured_Pending_Review % to Completed without valid session boundaries (start < end)', OLD.payment_id;
                END IF;
                -- 2. Authorized actor recorded
                IF NEW.approved_by IS NULL THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without authorized actor (approved_by)', OLD.payment_id;
                END IF;
                -- 3. Timestamp recorded
                IF NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without reconciliation timestamp (approved_at)', OLD.payment_id;
                END IF;
                -- 4. Audit evidence documented in metadata
                IF NEW.metadata IS NULL OR NEW.metadata->>'reconciliation_evidence' IS NULL OR TRIM(NEW.metadata->>'reconciliation_evidence') = '' THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without documented reconciliation_evidence in metadata', OLD.payment_id;
                END IF;
            ELSIF NEW.status NOT IN ('Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied') THEN
                RAISE EXCEPTION 'Invalid status transition for Captured_Pending_Review record %: permitted transitions are Completed (with valid session and audit evidence), Duplicate_Pending_Refund, Refunded, or Refund_Denied (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- D. External refund verification requirement: transition to Refunded requires external refund reference and authorized actor
        IF NEW.status = 'Refunded' AND OLD.status <> 'Refunded' THEN
            IF NEW.approved_by IS NULL THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refunded without authorized actor (approved_by)', OLD.payment_id;
            END IF;
            IF NEW.metadata IS NULL OR (
                (NEW.metadata->>'refund_id' IS NULL OR TRIM(NEW.metadata->>'refund_id') = '') AND
                (NEW.metadata->>'external_refund_ref' IS NULL OR TRIM(NEW.metadata->>'external_refund_ref') = '') AND
                (NEW.metadata->>'razorpay_refund_id' IS NULL OR TRIM(NEW.metadata->>'razorpay_refund_id') = '')
            ) THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refunded without external refund reference in metadata (refund_id, external_refund_ref, or razorpay_refund_id)', OLD.payment_id;
            END IF;
        END IF;

        -- E. Refund denial audit requirement: transition to Refund_Denied requires denial reason and authorized actor
        IF NEW.status = 'Refund_Denied' AND OLD.status <> 'Refund_Denied' THEN
            IF NEW.approved_by IS NULL THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refund_Denied without authorized actor (approved_by)', OLD.payment_id;
            END IF;
            IF NEW.metadata IS NULL OR (NEW.metadata->>'denial_reason' IS NULL OR TRIM(NEW.metadata->>'denial_reason') = '') THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refund_Denied without documented denial_reason in metadata', OLD.payment_id;
            END IF;
        END IF;

        -- F. Refunded, Refund_Denied and Rejected are terminal: once marked, status cannot change
        IF OLD.status IN ('Refunded', 'Refund_Denied', 'Rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Cannot mutate status of terminal payment record % (status: %)', OLD.payment_id, OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_completed_payments_trigger ON public.payments;
CREATE TRIGGER protect_completed_payments_trigger
    BEFORE UPDATE OR DELETE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_completed_payments();
```

#### RPC: `approve_renewal_with_seat(...)` (from `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` lines 84–200)
```sql
-- File: supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql (Lines 84-200)
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_student_uid       TEXT,
    p_bus_id            TEXT,
    p_shift             TEXT,
    p_valid_until       TIMESTAMPTZ,
    p_session_end_year  INTEGER,
    p_session_duration  INTEGER,
    p_application_id    TEXT,
    p_approved_by       TEXT,
    p_soft_block        BOOLEAN DEFAULT FALSE,
    p_hard_block        BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized_shift TEXT;
    v_bus              RECORD;
    v_student          RECORD;
    v_new_morning      INTEGER;
    v_new_evening      INTEGER;
    v_student_updated  INTEGER;
    v_app_updated      INTEGER;
BEGIN
    -- 1. Validate shift
    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid shift: ' || COALESCE(p_shift, 'NULL'));
    END IF;

    -- 2. Lock student profile row to preserve exact original state for rollback compensation
    SELECT uid, status, valid_until, session_end_year, session_duration, soft_block, hard_block, seat_released_at, last_processed_application_id
    INTO v_student
    FROM student_profiles
    WHERE uid = p_student_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found: ' || p_student_uid);
    END IF;

    -- 3. Lock bus row and check capacity atomically
    SELECT id, capacity, morning_load, evening_load
    INTO v_bus
    FROM buses
    WHERE id = p_bus_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus ' || p_bus_id || ' not found');
    END IF;

    -- 4. Verify capacity has room
    IF v_normalized_shift = 'morning' THEN
        IF v_bus.morning_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load + 1;
        v_new_evening := v_bus.evening_load;
    ELSIF v_normalized_shift = 'evening' THEN
        IF v_bus.evening_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load;
        v_new_evening := v_bus.evening_load + 1;
    ELSE -- 'both'
        IF v_bus.morning_load >= v_bus.capacity OR v_bus.evening_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load + 1;
        v_new_evening := v_bus.evening_load + 1;
    END IF;

    -- 5. Increment bus capacity
    UPDATE buses
    SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = p_bus_id;

    -- 6. Update student profile (re-activate, extend validity)
    UPDATE student_profiles SET
        status           = 'active',
        valid_until      = p_valid_until,
        session_end_year = p_session_end_year,
        session_duration = p_session_duration,
        soft_block       = p_soft_block,
        hard_block       = p_hard_block,
        seat_released_at = NULL,
        last_processed_application_id = p_application_id,
        updated_at       = NOW()
    WHERE uid = p_student_uid;

    GET DIAGNOSTICS v_student_updated = ROW_COUNT;
    IF v_student_updated <> 1 THEN
        RAISE EXCEPTION 'Failed to update student profile % during renewal approval', p_student_uid;
    END IF;

    -- 7. Update application state to approved
    UPDATE applications SET
        state       = 'approved',
        reviewed_by = p_approved_by,
        reviewed_at = NOW(),
        updated_at  = NOW()
    WHERE id = p_application_id;

    GET DIAGNOSTICS v_app_updated = ROW_COUNT;
    IF v_app_updated <> 1 THEN
        RAISE EXCEPTION 'Failed to update application % to approved', p_application_id;
    END IF;

    RETURN jsonb_build_object(
        'success',          true,
        'student_uid',      p_student_uid,
        'bus_id',           p_bus_id,
        'new_morning_load', v_new_morning,
        'new_evening_load', v_new_evening,
        'valid_until',      p_valid_until
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
```

#### RPCs: `bus_increment_capacity` & `bus_decrement_capacity` (from `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` lines 12–81)
```sql
-- File: supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql (Lines 12-81)
DROP FUNCTION IF EXISTS public.bus_increment_capacity(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.bus_increment_capacity(
    p_bus_id TEXT, 
    p_shift TEXT DEFAULT 'Morning', 
    p_enforce_capacity BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
    v_capacity INTEGER; v_morning_load INTEGER; v_evening_load INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning, Evening, or Both)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    
    v_capacity := COALESCE(v_bus.capacity, 0);
    v_morning_load := COALESCE(v_bus.morning_load, 0);
    v_evening_load := COALESCE(v_bus.evening_load, 0);

    IF p_enforce_capacity THEN
        IF v_normalized IN ('morning', 'both') AND v_morning_load >= v_capacity THEN
            RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' is at full capacity for morning shift (' || v_morning_load || '/' || v_capacity || ')');
        END IF;
        IF v_normalized IN ('evening', 'both') AND v_evening_load >= v_capacity THEN
            RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' is at full capacity for evening shift (' || v_evening_load || '/' || v_capacity || ')');
        END IF;
    END IF;

    v_new_morning := v_morning_load + CASE WHEN v_normalized IN ('morning', 'both') THEN 1 ELSE 0 END;
    v_new_evening := v_evening_load + CASE WHEN v_normalized IN ('evening', 'both') THEN 1 ELSE 0 END;
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;

    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bus_decrement_capacity(
    p_bus_id TEXT, 
    p_shift TEXT DEFAULT 'Morning'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning, Evening, or Both)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    v_new_morning := GREATEST(0, COALESCE(v_bus.morning_load, 0) - CASE WHEN v_normalized IN ('morning', 'both') THEN 1 ELSE 0 END);
    v_new_evening := GREATEST(0, COALESCE(v_bus.evening_load, 0) - CASE WHEN v_normalized IN ('evening', 'both') THEN 1 ELSE 0 END);
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;
    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;
```

#### RPC: `soft_block_student_with_seat_release` (from `supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql` lines 16–100)
```sql
-- File: supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql (Lines 16-100)
CREATE OR REPLACE FUNCTION public.soft_block_student_with_seat_release(
    p_student_uid      TEXT,
    p_bus_id           TEXT,
    p_shift            TEXT,
    p_release_seat     BOOLEAN,
    p_soft_blocked_at  TIMESTAMPTZ,
    p_seat_released_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_student         RECORD;
    v_normalized_shift TEXT;
    v_capacity_result  JSONB;
    v_student_updated  INTEGER;
BEGIN
    -- 1. Lock and validate student (FOR UPDATE prevents concurrent soft-blocks)
    SELECT uid, status, bus_id, shift
    INTO v_student
    FROM student_profiles
    WHERE uid = p_student_uid
    FOR UPDATE;

    IF v_student IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Student not found');
    END IF;

    IF v_student.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false, 'status', 409,
            'error', 'Student not active, already blocked or deleted',
            'current_status', v_student.status
        );
    END IF;

    -- 2. Normalise shift
    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening') THEN
        v_normalized_shift := 'morning';
    END IF;

    -- 3. Atomic capacity decrement (if releasing seat)
    IF p_release_seat AND p_bus_id IS NOT NULL THEN
        SELECT * FROM bus_decrement_capacity(p_bus_id, v_normalized_shift) INTO v_capacity_result;
        IF v_capacity_result->>'error' IS NOT NULL THEN
            IF v_capacity_result->>'error' LIKE '%not found%' THEN
                -- Bus was removed or renamed; proceed with soft-block without blocking student lifecycle
                v_capacity_result := jsonb_build_object('warning', v_capacity_result->>'error');
            ELSE
                RETURN jsonb_build_object('success', false, 'error', v_capacity_result->>'error');
            END IF;
        END IF;
    END IF;

    -- 4. Update student to soft_blocked
    UPDATE student_profiles SET
        status          = 'soft_blocked',
        seat_released_at = CASE WHEN p_release_seat THEN p_seat_released_at ELSE seat_released_at END,
        updated_at      = NOW()
    WHERE uid = p_student_uid;
    GET DIAGNOSTICS v_student_updated = ROW_COUNT;

    IF v_student_updated <> 1 THEN
        -- Compensating rollback of capacity if student update failed
        IF p_release_seat AND p_bus_id IS NOT NULL AND v_capacity_result->>'warning' IS NULL THEN
            PERFORM bus_increment_capacity(p_bus_id, v_normalized_shift);
        END IF;
        RAISE EXCEPTION 'Expected 1 row updated for student uid=%, got %', p_student_uid, v_student_updated;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'student_uid',   p_student_uid,
        'status',        'soft_blocked',
        'seat_released', p_release_seat,
        'bus_id',        p_bus_id,
        'capacity',      v_capacity_result
    );
EXCEPTION WHEN OTHERS THEN
    -- Compensating rollback on any exception
    IF p_release_seat AND p_bus_id IS NOT NULL AND v_capacity_result->>'warning' IS NULL THEN
        PERFORM bus_increment_capacity(p_bus_id, v_normalized_shift);
    END IF;
    RAISE;
END;
$$;
```

#### RPC: `process_payment_refund_atomic` (from `supabase/migrations/20261009_payment_immutability_and_preflight.sql` lines 267–453)
```sql
-- File: supabase/migrations/20261009_payment_immutability_and_preflight.sql (Lines 267-453)
CREATE OR REPLACE FUNCTION public.process_payment_refund_atomic(
    p_payment_id TEXT,
    p_refund_id TEXT,
    p_amount_paise BIGINT,
    p_authorized_by JSONB,
    p_reason TEXT DEFAULT 'Processed refund'
)
RETURNS JSONB AS $$
DECLARE
    v_payment RECORD;
    v_original_paise BIGINT;
    v_existing_history JSONB;
    v_trimmed_ref TEXT;
    v_already_processed BOOLEAN := FALSE;
    v_other_refunded_paise BIGINT := 0;
    v_new_cumulative_paise BIGINT;
    v_is_fully_refunded BOOLEAN;
    v_elem JSONB;
    v_updated_history JSONB := '[]'::JSONB;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_now_iso TEXT := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_updated_metadata JSONB;
    v_actor JSONB;
BEGIN
    -- Input sanitation
    v_trimmed_ref := TRIM(COALESCE(p_refund_id, ''));
    IF v_trimmed_ref = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'External refund reference is mandatory');
    END IF;

    IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Refund amount in paise must be greater than zero');
    END IF;

    IF p_authorized_by IS NULL OR p_authorized_by->>'userId' IS NULL OR TRIM(p_authorized_by->>'userId') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authorized officer identifier is required');
    END IF;

    -- Concurrency control: Exclusive row-level lock on payments table
    SELECT * INTO v_payment
    FROM public.payments
    WHERE payment_id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', format('Payment record %s not found', p_payment_id));
    END IF;

    -- Status validation: refunds permitted from Completed, Duplicate_Pending_Refund, or Captured_Pending_Review
    IF v_payment.status NOT IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review') THEN
        -- If already Refunded, check for idempotent replay of this specific refund
        IF v_payment.status = 'Refunded' THEN
            v_existing_history := COALESCE(v_payment.metadata->'refund_history', '[]'::JSONB);
            FOR v_elem IN SELECT * FROM jsonb_array_elements(v_existing_history)
            LOOP
                IF v_elem->>'refund_id' = v_trimmed_ref AND v_elem->>'status' = 'processed' THEN
                    RETURN jsonb_build_object(
                        'success', true,
                        'is_partial', false,
                        'cumulative_refunded', COALESCE((v_payment.metadata->>'refunded_amount')::NUMERIC, v_payment.amount),
                        'already_processed', true
                    );
                END IF;
            END LOOP;
        END IF;

        RETURN jsonb_build_object(
            'success', false,
            'error', format('Payment %s has status ''%s''. Refunds can only be processed from Completed, Duplicate_Pending_Refund, or Captured_Pending_Review.', p_payment_id, v_payment.status)
        );
    END IF;

    v_original_paise := ROUND(COALESCE(v_payment.amount, 0) * 100)::BIGINT;
    IF v_original_paise <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', format('Payment %s has invalid or zero captured amount (%s)', p_payment_id, v_payment.amount));
    END IF;

    -- Format actor
    v_actor := jsonb_build_object(
        'type', COALESCE(p_authorized_by->>'type', CASE WHEN (p_authorized_by->>'userId') LIKE 'system:%' THEN 'system' ELSE 'admin' END),
        'userId', p_authorized_by->>'userId',
        'name', COALESCE(p_authorized_by->>'name', 'System'),
        'role', COALESCE(p_authorized_by->>'role', 'system')
    );
    IF p_authorized_by ? 'empId' THEN
        v_actor := v_actor || jsonb_build_object('empId', p_authorized_by->>'empId');
    END IF;

    -- Extract existing refund history
    v_existing_history := COALESCE(v_payment.metadata->'refund_history', '[]'::JSONB);

    -- Check for idempotent replay and accumulate other processed refunds
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_existing_history)
    LOOP
        IF v_elem->>'refund_id' = v_trimmed_ref AND v_elem->>'status' = 'processed' THEN
            v_already_processed := TRUE;
        ELSE
            -- Add to updated history preserving non-matching items
            v_updated_history := v_updated_history || jsonb_build_array(v_elem);
            IF v_elem->>'status' = 'processed' THEN
                IF v_elem ? 'amount_paise' AND (v_elem->>'amount_paise') IS NOT NULL THEN
                    v_other_refunded_paise := v_other_refunded_paise + (v_elem->>'amount_paise')::BIGINT;
                ELSE
                    v_other_refunded_paise := v_other_refunded_paise + ROUND(COALESCE((v_elem->>'amount')::NUMERIC, 0) * 100)::BIGINT;
                END IF;
            END IF;
        END IF;
    END LOOP;

    IF v_already_processed THEN
        RETURN jsonb_build_object(
            'success', true,
            'is_partial', (COALESCE((v_payment.metadata->>'refunded_amount')::NUMERIC, 0) < v_payment.amount),
            'cumulative_refunded', COALESCE((v_payment.metadata->>'refunded_amount')::NUMERIC, v_payment.amount),
            'already_processed', true
        );
    END IF;

    -- Calculate new cumulative refund in paise
    v_new_cumulative_paise := v_other_refunded_paise + p_amount_paise;

    -- Invariant: cumulative refunded amount cannot exceed original captured amount
    IF v_new_cumulative_paise > v_original_paise THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cumulative refunded amount (%s) cannot exceed original payment amount (%s).', (v_new_cumulative_paise::NUMERIC / 100), (v_original_paise::NUMERIC / 100))
        );
    END IF;

    v_is_fully_refunded := (v_new_cumulative_paise >= v_original_paise);

    -- Append current refund record
    v_updated_history := v_updated_history || jsonb_build_array(jsonb_build_object(
        'refund_id', v_trimmed_ref,
        'amount', (p_amount_paise::NUMERIC / 100),
        'amount_paise', p_amount_paise,
        'status', 'processed',
        'authorized_by', v_actor,
        'reason', COALESCE(p_reason, 'Approved refund'),
        'processed_at', v_now_iso
    ));

    -- Construct metadata
    v_updated_metadata := COALESCE(v_payment.metadata, '{}'::JSONB) || jsonb_build_object(
        'prior_status', v_payment.status,
        'razorpay_refund_id', v_trimmed_ref,
        'external_refund_ref', v_trimmed_ref,
        'refund_id', v_trimmed_ref,
        'refund_authorized_by', v_actor,
        'refund_processed_at', v_now_iso,
        'refunded_amount', (v_new_cumulative_paise::NUMERIC / 100),
        'refunded_amount_paise', v_new_cumulative_paise,
        'remaining_amount', ((v_original_paise - v_new_cumulative_paise)::NUMERIC / 100),
        'remaining_amount_paise', (v_original_paise - v_new_cumulative_paise),
        'refund_status', CASE WHEN v_is_fully_refunded THEN 'fully_refunded' ELSE 'partial' END,
        'is_partially_refunded', NOT v_is_fully_refunded,
        'refund_history', v_updated_history,
        'refund_reason', COALESCE(p_reason, 'Approved refund')
    );

    IF v_is_fully_refunded THEN
        v_updated_metadata := v_updated_metadata || jsonb_build_object(
            'requires_refund_review', false,
            'requires_manual_review', false
        );

        UPDATE public.payments
        SET status = 'Refunded',
            approved_by = v_actor,
            approved_at = v_now,
            metadata = v_updated_metadata
        WHERE payment_id = p_payment_id;
    ELSE
        -- Partial refund: retain existing status
        UPDATE public.payments
        SET metadata = v_updated_metadata
        WHERE payment_id = p_payment_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'is_partial', NOT v_is_fully_refunded,
        'cumulative_refunded', (v_new_cumulative_paise::NUMERIC / 100),
        'cumulative_refunded_paise', v_new_cumulative_paise
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

#### RPC: `increment_expiry_reminder_count` (from `supabase/COMPLETE_SCHEMA.sql` lines 2118–2154)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 2118-2154)
CREATE OR REPLACE FUNCTION public.increment_expiry_reminder_count(p_uid TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_last_sent TIMESTAMPTZ;
    v_today     DATE := CURRENT_DATE;  -- UTC date
BEGIN
    -- Lock the target row for the duration of this transaction.
    SELECT last_expiry_reminder_sent_at
      INTO v_last_sent
      FROM student_profiles
     WHERE uid = p_uid
       FOR UPDATE;

    -- If no row found, nothing to do.
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Already reminded today -- idempotent, return FALSE so caller skips notification
    IF v_last_sent IS NOT NULL AND v_last_sent::DATE = v_today THEN
        RETURN FALSE;
    END IF;

    -- First reminder for today -- increment counter and stamp timestamp.
    UPDATE student_profiles
       SET expiry_reminder_count      = COALESCE(expiry_reminder_count, 0) + 1,
           last_expiry_reminder_sent_at = NOW(),
           updated_at                  = NOW()
     WHERE uid = p_uid;

    RETURN TRUE;
END;
$$;
```

#### RPCs: `cleanup_abandoned_application_locks` & `release_application_lock` (from `supabase/COMPLETE_SCHEMA.sql` lines 1456–1476)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 1456-1476)
CREATE OR REPLACE FUNCTION release_application_lock(p_application_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE applications SET processing_lock = NULL, processing_started_at = NULL,
        processing_lease_expires_at = NULL, processing_result = NULL, processing_completed_at = NULL
    WHERE application_id = p_application_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_abandoned_application_locks()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cleaned INTEGER;
BEGIN
    UPDATE applications SET processing_lock = NULL, processing_started_at = NULL,
        processing_lease_expires_at = NULL, processing_result = 'expired', processing_completed_at = NOW()
    WHERE processing_lock IS NOT NULL AND processing_lease_expires_at < NOW() AND processing_completed_at IS NULL;
    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
    RETURN jsonb_build_object('cleaned', v_cleaned);
END;
$$;
```

#### RPCs: `processed_payments_acquire`, `processed_payments_release`, `processed_payments_cleanup` (from `supabase/COMPLETE_SCHEMA.sql` lines 1480–1509)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql (Lines 1480-1509)
CREATE OR REPLACE FUNCTION public.processed_payments_acquire(
    p_payment_id TEXT, p_order_id TEXT DEFAULT NULL, p_amount NUMERIC DEFAULT NULL,
    p_enrollment_id TEXT DEFAULT NULL, p_user_id TEXT DEFAULT NULL, p_source TEXT DEFAULT 'system'
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.processed_payments (payment_id, order_id, processed_at, expires_at, amount, enrollment_id, user_id, source)
    VALUES (p_payment_id, p_order_id, NOW(), NOW() + INTERVAL '7 days', p_amount, p_enrollment_id, p_user_id, p_source);
    RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.processed_payments_release(p_payment_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM public.processed_payments WHERE payment_id = p_payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.processed_payments_cleanup()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM public.processed_payments WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
```

#### RPC: `transition_application_state` (from `supabase/migrations/20261016_fix_transition_application_state_guard.sql` lines 4–60)
```sql
-- File: supabase/migrations/20261016_fix_transition_application_state_guard.sql (Lines 4-60)
CREATE OR REPLACE FUNCTION transition_application_state(
    p_application_id TEXT,
    p_new_state      TEXT,
    p_actor_uid      TEXT,
    p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_app RECORD;
    v_valid_from TEXT[];
BEGIN
    SELECT state, applicant_uid, form_data INTO v_app FROM applications WHERE application_id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application not found', 'status', 404);
    END IF;

    -- Define valid transition matrix
    v_valid_from := CASE p_new_state
        WHEN 'awaiting_verification' THEN ARRAY['draft']
        WHEN 'verified'             THEN ARRAY['awaiting_verification']
        WHEN 'submitted'            THEN ARRAY['verified']
        WHEN 'approved'             THEN ARRAY['submitted', 'pending_seat_allocation']
        WHEN 'rejected'             THEN ARRAY['awaiting_verification', 'verified', 'submitted', 'pending_seat_allocation']
        WHEN 'verified_upcoming'    THEN ARRAY['verified']
        WHEN 'pending_seat_allocation' THEN ARRAY['submitted', 'verified_upcoming']
        WHEN 'expired'              THEN ARRAY['verified_upcoming', 'pending_seat_allocation', 'submitted']
        ELSE ARRAY[]::TEXT[]
    END;

    -- Authoritative transition guard: verify that current state (v_app.state) is in valid source states
    IF NOT (v_app.state = ANY(v_valid_from)) THEN
        RETURN jsonb_build_object('success', false, 'error', format('Invalid transition: %s to %s', v_app.state, p_new_state), 'status', 400);
    END IF;

    -- IDOR prevention: submitting a verified application requires the actor to be the applicant
    IF p_new_state = 'submitted' AND v_app.applicant_uid IS NOT NULL AND v_app.applicant_uid <> p_actor_uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: applicant UID does not match actor', 'status', 403);
    END IF;

    UPDATE applications SET
        state = p_new_state, updated_at = NOW(),
        state_history = COALESCE(state_history, '[]'::jsonb) || jsonb_build_object('state', p_new_state, 'timestamp', NOW()::text, 'actor', p_actor_uid),
        submitted_at = CASE WHEN p_new_state = 'submitted' THEN NOW() ELSE submitted_at END,
        submitted_by = CASE WHEN p_new_state = 'submitted' THEN p_actor_uid ELSE submitted_by END,
        verified_at  = CASE WHEN p_new_state = 'verified' THEN NOW() ELSE verified_at END,
        verified_by  = CASE WHEN p_new_state = 'verified' THEN p_actor_uid ELSE verified_by END,
        verified_by_id = CASE WHEN p_new_state = 'verified' THEN p_actor_uid ELSE verified_by_id END,
        approved_at  = CASE WHEN p_new_state = 'approved' THEN NOW() ELSE approved_at END,
        approved_by  = CASE WHEN p_new_state = 'approved' THEN p_actor_uid ELSE approved_by END,
        approved_by_id = CASE WHEN p_new_state = 'approved' THEN p_actor_uid ELSE approved_by_id END,
        expired_at   = CASE WHEN p_new_state = 'expired' THEN NOW() ELSE expired_at END,
        expiry_reason = CASE WHEN p_new_state = 'expired' THEN COALESCE(p_reason, 'Automated expiration') ELSE expiry_reason END
    WHERE application_id = p_application_id;

    RETURN jsonb_build_object('success', true, 'application_id', p_application_id, 'new_state', p_new_state);
END;
$$;
```

#### Row Level Security (RLS) Policies (from `supabase/COMPLETE_SCHEMA.sql` lines 3016–3067, 3154–3165, 3181–3196)
```sql
-- File: supabase/COMPLETE_SCHEMA.sql
-- 1. public.student_profiles RLS
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "student_profiles_select" ON public.student_profiles;
CREATE POLICY "student_profiles_select" ON public.student_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- 2. public.buses RLS
ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buses_select" ON public.buses;
CREATE POLICY "buses_select" ON public.buses FOR SELECT TO authenticated USING (true);

-- 3. public.applications RLS
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "applications_select" ON public.applications;
CREATE POLICY "applications_select" ON public.applications FOR SELECT TO authenticated
USING (applicant_uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- 4. public.payments RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_no_delete" ON public.payments;
CREATE POLICY "payments_no_delete" ON public.payments FOR DELETE TO PUBLIC USING (false);

DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated
USING (student_uid = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "payments_insert_service" ON public.payments;
CREATE POLICY "payments_insert_service" ON public.payments FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "payments_update_service" ON public.payments;
CREATE POLICY "payments_update_service" ON public.payments FOR UPDATE TO service_role USING (true);

-- 5. public.processed_payments RLS
ALTER TABLE public.processed_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "processed_payments_service_role" ON public.processed_payments;
CREATE POLICY "processed_payments_service_role" ON public.processed_payments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. public.system_settings RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "system_settings_read_all" ON public.system_settings;
CREATE POLICY "system_settings_read_all" ON public.system_settings FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "system_settings_service_role" ON public.system_settings;
CREATE POLICY "system_settings_service_role" ON public.system_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. public.audit_events RLS & Global Service Role Bypass
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    tbl TEXT;
    tbls TEXT[] := ARRAY[
        'users', 'student_profiles', 'driver_profiles', 'moderator_profiles',
        'admin_profiles', 'unauth_users', 'buses', 'temporary_assignments',
        'routes', 'applications', 'notifications', 'audit_events', 'processed_operations',
        'driver_location_updates', 'processed_payments'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        EXECUTE format('DROP POLICY IF EXISTS service_role_bypass_%I ON %I', tbl, tbl);
        EXECUTE format('CREATE POLICY service_role_bypass_%I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;
```

---

