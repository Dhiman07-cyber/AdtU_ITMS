# Academic Lifecycle & Allocation: Database Schema, Tables, Indexes & PL/pgSQL RPC Reference

**Module:** Relational Architecture, Foreign Keys, Immutability Constraints, Check Triggers & Stored Procedures  
**File Authority:** `supabase/COMPLETE_SCHEMA.sql`, `supabase/migrations/`  
**Database Scope:** `student_applications`, `student_profiles`, `reassignment_logs`, `system_settings`, `buses`, `routes`  

---

# PART 1: Database Schema, Tables, Constraints, Indexes & PL/pgSQL RPCs for Academic Lifecycle, Applications, Profiles, Capacity & Reassignment

### 1.1 Sub-Domain Architecture & Exact Execution Pipeline

The Academic and Allocation Lifecycle in ADTU ITMS is anchored directly in PostgreSQL via Supabase. State transitions, seat counter updates, identity promotions, and rollback operations are enforced through row-level locking (`FOR UPDATE`), database check constraints, partial unique indexes, and atomic PL/pgSQL stored procedures (RPCs).

#### Global Lock Acquisition Hierarchy (Deadlock Prevention Invariant)
To eliminate PostgreSQL 40P01 deadlocks during concurrent multi-row mutations, all transactions and RPCs adhere strictly to the following acquisition order:
1. **Application Row Lock (`applications` WHERE application_id = ... FOR UPDATE)**
2. **Student Profile Row Lock (`student_profiles` WHERE uid = ... FOR UPDATE)**
3. **Bus Row Lock(s) (`buses` WHERE id IN (...) ORDER BY id ASC FOR UPDATE)**
4. **Child domain records (`users`, `notifications`, `waiting_flags`, `fcm_tokens`)**

#### End-to-End Database Lifecycle Pipeline (ASCII Trace)

```
[ Prospective Commuter / Fresh Applicant ]
       │
       ▼
 1. unauth_users (Pending student row before profile creation)
       │
       ▼
 2. applications (State machine: draft -> awaiting_verification -> verified -> submitted)
       │
       ├─── Future Academic Session? ───► state: verified_upcoming (No seat counter allocated yet)
       │
       ├─── Bus Capacity Full? ────────► state: pending_seat_allocation (Admin override/reroute needed)
       │
       ▼
 3. Approval Pipeline (Admin/Moderator Approval):
       │
       ├── a. RPC approve_application: Stamped processing_lock = approver_uid, lease = 5 mins
       │
       ├── b. Fresh Application:
       │      RPC identity_activate_student_with_capacity(p_bus_id, p_shift, p_uid, p_email, ...)
       │      ├─ FOR UPDATE lock on student_profiles
       │      ├─ FOR UPDATE lock on buses
       │      ├─ Guard: morning_load/evening_load < capacity
       │      ├─ Bus loads incremented (+1 shift load, +1 current_members)
       │      ├─ users table upserted (role: 'student')
       │      └─ student_profiles table upserted (status: 'active', seat_released_at: NULL)
       │
       ├── c. Renewal Application (Post-Soft-Block with Seat Released):
       │      RPC approve_renewal_with_seat(p_application_id, p_student_uid, p_bus_id, p_shift, ...)
       │      ├─ FOR UPDATE lock on student_profiles
       │      ├─ FOR UPDATE lock on buses
       │      ├─ Guard: shift capacity available
       │      ├─ Bus loads incremented (+1 shift load, +1 current_members)
       │      ├─ student_profiles updated (status: 'active', seat_released_at: NULL, valid_until extended)
       │      └─ applications updated (state: 'approved')
       │
       └── d. Finalize RPC finalize_application_approval:
              ├─ Fresh: DELETE FROM applications WHERE application_id = ...
              └─ Renewal: UPDATE applications SET state = 'approved'
       │
       ▼
 4. Active Transit Life (Commuter Active):
       │
       ├── Expiry Warning Cron (/api/cron/expiry-check):
       │   └─ RPC increment_expiry_reminder_count (Atomic CAS per UTC date to prevent spam)
       │
       ├── End-of-Session Soft-Block Cron (/api/cron/cleanup-expired-students):
       │   └─ RPC soft_block_student_with_seat_release:
       │      ├─ FOR UPDATE lock on student_profiles
       │      ├─ RPC bus_decrement_capacity (Decrements morning_load/evening_load/current_members)
       │      └─ student_profiles update: status = 'soft_blocked', seat_released_at = NOW()
       │
       ├── Hard Deletion Cron (/api/cron/cleanup-expired-students):
       │   └─ RPC delete_student_cascade_v1:
       │      ├─ FOR UPDATE lock on student_profiles (Checks renewal concurrency guard)
       │      ├─ Decrements bus capacity if seat_released_at IS NULL
       │      ├─ Purges: notifications, waiting_flags, fcm_tokens, applications, student_profiles, users
       │      └─ PRESERVES: payments ledger and audit_events (Financial & Legal Invariant)
       │
       └── Dynamic Fleet Smart Allocation / Reassignment:
           └─ RPC reassign_students_atomically:
              ├─ Pre-locks all affected buses in strict lexical order (ORDER BY id ASC FOR UPDATE)
              ├─ FOR UPDATE lock on student_profiles
              ├─ Decrements source bus loads using student's OLD shift
              ├─ Increments target bus loads using student's NEW shift
              ├─ Updates student_profiles (bus_id, route_id, shift, stop_name)
              └─ Deterministic recalculation of bus loads for all affected buses
```

---

### 1.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `supabase/COMPLETE_SCHEMA.sql` | Full Canonical DDL, Core Tables, Indexes, Triggers, RLS, RPCs | Supabase migrations engine, CI/CD, local test db | PostgreSQL Core engine, `pgcrypto` | Creates/mutates all 19 active public tables |
| `supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql` | Index `idx_applications_active_student_session`, RPC `soft_block_student_with_seat_release` | DB migration runner | `bus_decrement_capacity`, `bus_increment_capacity` | `public.applications`, `public.student_profiles`, `public.buses` |
| `supabase/migrations/20261016_fix_transition_application_state_guard.sql` | RPC `transition_application_state` | DB migration runner | Internal PL/pgSQL | `public.applications` |
| `supabase/migrations/20261018_consolidated_production_hardening.sql` | System settings, dwell logs, `cleanup_stale_locks`, `bus_increment_capacity`, `bus_decrement_capacity`, `approve_renewal_with_seat`, `reassign_students_atomically` | DB migration runner | Internal PL/pgSQL | `public.system_settings`, `public.stop_dwell_logs`, `public.buses`, `public.student_profiles`, `public.routes` |
| `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` | Shift Parity RPCs (`both` shift support), Lexical Bus Locking in `reassign_students_atomically` | DB migration runner | `bus_increment_capacity`, `bus_decrement_capacity` | `public.buses`, `public.student_profiles` |
| `supabase/migrations/20261019_payment_ledger_and_renewal_hardening.sql` | Reconciled `approve_renewal_with_seat`, `idx_payments_unique_offline_tx_id`, `process_payment_refund_atomic` | DB migration runner | `bus_decrement_capacity` | `public.student_profiles`, `public.buses`, `public.applications`, `public.payments` |

---

### 1.3 Method-by-Method Low-Level Walkthrough

#### 1. RPC `approve_application(p_application_id TEXT, p_approver_uid TEXT, p_lease_minutes INTEGER DEFAULT 5)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 1289–1301)
- **Signature:** `(p_application_id TEXT, p_approver_uid TEXT, p_lease_minutes INTEGER DEFAULT 5) RETURNS JSONB`
- **Internal Helper:** Calls `validate_application_for_approval` (Lines 1253–1268).
- **Control Flow & Branching:**
  1. Executes `UPDATE applications` setting `processing_lock = p_approver_uid`, `processing_started_at = NOW()`, `processing_lease_expires_at = NOW() + (p_lease_minutes || ' minutes')::INTERVAL` WHERE `application_id = p_application_id` AND `state = 'submitted'` AND (`processing_lock IS NULL` OR `processing_lease_expires_at < NOW()`).
  2. If no row returned (either application not in `state = 'submitted'` or currently leased by another active approver), returns `{ "success": false, "error": "Application not found or already being processed", "status": 409 }`.
  3. If row updated, returns `{ "success": true, "application": <application JSONB> }`.
- **Security:** `SECURITY DEFINER SET search_path = public`. Execution granted to `service_role`.

#### 2. RPC `finalize_application_approval(p_application_id TEXT, p_approver_uid TEXT, p_student_data JSONB DEFAULT NULL)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 1315–1385)
- **Signature:** `(p_application_id TEXT, p_approver_uid TEXT, p_student_data JSONB DEFAULT NULL) RETURNS JSONB`
- **Control Flow & Branching:**
  1. Queries `applications` checking `application_id = p_application_id`, `processing_lock = p_approver_uid`, and `processing_lease_expires_at > NOW()`.
  2. If not found: checks if application exists. If it exists in state `'approved'` for renewals, returns idempotent `{ "success": true, "finalized": false, "already_finalized": true }`. Otherwise returns 409 error `"Invalid or expired processing lease"`. If record was already deleted (fresh app approval finalized earlier), returns idempotent `{ "success": true, "finalized": false, "already_finalized": true }`.
  3. If `application_type IN ('renewal', 'renewal_after_soft_block')`:
     - If `p_student_data` provided, executes `UPDATE student_profiles` setting `valid_until`, `status`, `session_end_year`, `session_duration`, `soft_block`, `hard_block`, and `last_processed_application_id = p_application_id` WHERE `uid = v_app.applicant_uid`. Asserts row count == 1, raising an exception if not matched.
     - Updates `applications` setting `state = 'approved'`, `approved_at = NOW()`, `approved_by = p_approver_uid`, clearing lock fields.
     - Returns `{ "success": true, "finalized": true, "action": "state_updated_to_approved" }`.
  4. If `application_type` is fresh (`'fresh'`, `'new'`, `'future'`):
     - Executes `DELETE FROM applications WHERE application_id = p_application_id AND processing_lock = p_approver_uid`.
     - Asserts row count == 1. Returns `{ "success": true, "finalized": true, "action": "deleted" }`.

#### 3. RPC `reject_application(p_application_id TEXT, p_rejector_uid TEXT)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 1303–1313)
- **Signature:** `(p_application_id TEXT, p_rejector_uid TEXT) RETURNS JSONB`
- **Internal Helper:** Calls `validate_application_for_rejection` (Lines 1270–1286).
- **Control Flow:**
  - Locks application where `state IN ('submitted', 'verified_upcoming', 'pending_seat_allocation')` and lease is free/expired.
  - Returns `{ "success": true, "application": ... }` or 409 error.

#### 4. RPC `finalize_application_rejection(p_application_id TEXT, p_rejector_uid TEXT)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 1387–1402)
- **Signature:** `(p_application_id TEXT, p_rejector_uid TEXT) RETURNS JSONB`
- **Control Flow:**
  - Executes `DELETE FROM applications WHERE application_id = p_application_id AND processing_lock = p_rejector_uid AND processing_lease_expires_at > NOW()`.
  - If 1 row deleted, returns `{ "success": true, "finalized": true }`.
  - Idempotency guard: if row does not exist, returns `{ "success": true, "already_finalized": true }`.

#### 5. RPC `transition_application_state(p_application_id TEXT, p_new_state TEXT, p_actor_uid TEXT, p_actor_role TEXT DEFAULT NULL, p_reason TEXT DEFAULT NULL)`
- **File:** `supabase/migrations/20261016_fix_transition_application_state_guard.sql` / `supabase/COMPLETE_SCHEMA.sql` (Lines 1405–1461)
- **Signature:** `(p_application_id TEXT, p_new_state TEXT, p_actor_uid TEXT, p_actor_role TEXT DEFAULT NULL, p_reason TEXT DEFAULT NULL) RETURNS JSONB`
- **Control Flow:**
  1. Locks row: `SELECT state, applicant_uid, form_data INTO v_app FROM applications WHERE application_id = p_application_id FOR UPDATE`. Returns 404 if not found.
  2. Enforces State Transition Matrix (`v_valid_from`):
     - `awaiting_verification` from `['draft']`
     - `verified` from `['awaiting_verification']`
     - `submitted` from `['verified']`
     - `approved` from `['submitted', 'pending_seat_allocation']`
     - `rejected` from `['awaiting_verification', 'verified', 'submitted', 'pending_seat_allocation']`
     - `verified_upcoming` from `['verified']`
     - `pending_seat_allocation` from `['submitted', 'verified_upcoming']`
     - `expired` from `['verified_upcoming', 'pending_seat_allocation', 'submitted']`
  3. If current state is NOT in `v_valid_from`, returns `{ "success": false, "error": "Invalid transition: <from> to <to>", "status": 400 }`.
  4. IDOR Guard: If `p_new_state = 'submitted'` and `applicant_uid <> p_actor_uid`, returns 403 Forbidden.
  5. Updates `applications` state, appends to `state_history`, and timestamps relevant action column (`submitted_at`, `verified_at`, `approved_at`, `expired_at`).

#### 6. RPC `identity_activate_student(p_uid TEXT, p_email TEXT, p_full_name TEXT, p_student_data JSONB DEFAULT '{}'::jsonb)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 992–1111)
- **Signature:** `(p_uid TEXT, p_email TEXT, p_full_name TEXT, p_student_data JSONB DEFAULT '{}'::jsonb) RETURNS JSONB`
- **Control Flow:**
  1. Validates `p_uid` is non-empty.
  2. Normalizes input fields from `p_student_data` (`phone`, `parentName`, `parentPhone`, `faculty`, `department`, `enrollmentId`, `busId`, `routeId`, `stop_name`, `shift`, `sessionStartYear`, `sessionEndYear`, `validUntil`, `softBlock`, `hardBlock`).
  3. Upserts into `public.users` (`uid`, `email`, `name`, `role = 'student'`).
  4. Upserts into `public.student_profiles` (`uid`, `email`, `full_name`, ..., `status = 'active'`).
  5. On conflict on `uid`: updates all profile fields and sets `status = 'active'`, `updated_at = NOW()`.
  6. Returns `{ "success": true, "already_activated": <bool>, "uid": p_uid }`.

#### 7. RPC `identity_activate_student_with_capacity(...)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 1135–1243)
- **Signature:** `(p_bus_id TEXT, p_shift TEXT, p_uid TEXT, p_email TEXT, p_full_name TEXT, p_student_data JSONB DEFAULT '{}'::jsonb, p_enforce_capacity BOOLEAN DEFAULT true) RETURNS JSONB`
- **Control Flow:**
  1. Validates shift is `'morning'` or `'evening'`.
  2. **STUDENT -> BUS Lock Hierarchy:** Locks `student_profiles` WHERE `uid = p_uid FOR UPDATE`.
  3. Locks target bus: `SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1`. Returns 404 if bus not found.
  4. **Idempotent Retry Guard:** If student profile is already `status = 'active'`, `seat_released_at IS NULL`, assigned to this bus and shift, skips bus counter increment (prevents double-counting on retry).
  5. Otherwise: checks if `p_enforce_capacity` is true and shift load >= capacity. If full, returns error. Increments `morning_load` or `evening_load` and `current_members`, updating `buses`.
  6. Calls `identity_activate_student`. If activation fails, raises exception which rolls back the bus increment atomically.
  7. Explicitly updates `student_profiles SET seat_released_at = NULL, updated_at = NOW() WHERE uid = p_uid`.
  8. Returns `{ "success": true, "uid": p_uid, "busId": v_bus.id, "morningLoad": ..., "eveningLoad": ... }`.

#### 8. RPC `approve_renewal_with_seat(...)`
- **File:** `supabase/migrations/20261019_payment_ledger_and_renewal_hardening.sql` (Lines 23–183) & `20261018_fix_shift_parity_and_reassignment_deadlocks.sql`
- **Canonical Signature (Post-20261019 Migration):**
  `(p_application_id TEXT, p_student_uid TEXT, p_bus_id TEXT, p_shift TEXT, p_valid_until TIMESTAMPTZ, p_session_end_year INTEGER, p_session_duration TEXT, p_approver_uid TEXT DEFAULT NULL, p_approved_by TEXT DEFAULT NULL, p_soft_block TIMESTAMPTZ DEFAULT NULL, p_hard_block TIMESTAMPTZ DEFAULT NULL) RETURNS JSONB`
- **Control Flow:**
  1. Validates shift in `('morning', 'evening', 'both')`.
  2. Locks student row: `SELECT ... FROM student_profiles WHERE uid = p_student_uid FOR UPDATE`. Returns 404 if not found.
  3. Locks bus row: `SELECT ... FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1`. Returns 404 if not found.
  4. Capacity Check: Evaluates `morning_load >= capacity` (for morning/both) and `evening_load >= capacity` (for evening/both). If full, returns `{ "success": false, "error": "CAPACITY_FULL", "busId": p_bus_id, "shift": p_shift }`.
  5. Increments bus counters: `morning_load` (+1 if morning/both), `evening_load` (+1 if evening/both), `current_members = morning_load + evening_load`.
  6. Updates `student_profiles`: `status = 'active'`, `seat_released_at = NULL`, `valid_until = p_valid_until`, `soft_block = p_soft_block`, `hard_block = p_hard_block`, `last_processed_application_id = p_application_id`. If row count <> 1, rolls back bus counters and returns error.
  7. Updates `applications`: `state = 'approved'`, `approved_by = v_effective_actor`, clearing lock fields. If update fails, compensates student profile back to original locked snapshot and compensates bus counters back.
  8. Returns `{ "success": true, "studentUid": p_student_uid, "busId": v_bus.id, "newMorningLoad": ..., "newEveningLoad": ... }`.

#### 9. RPC `soft_block_student_with_seat_release(...)`
- **File:** `supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql` (Lines 16–100)
- **Signature:** `(p_student_uid TEXT, p_bus_id TEXT, p_shift TEXT, p_release_seat BOOLEAN, p_soft_blocked_at TIMESTAMPTZ, p_seat_released_at TIMESTAMPTZ) RETURNS JSONB`
- **Control Flow:**
  1. Locks student: `SELECT uid, status, bus_id, shift FROM student_profiles WHERE uid = p_student_uid FOR UPDATE`.
  2. If student not found, returns 404. If `status <> 'active'`, returns 409 (`"Student not active, already blocked or deleted"`).
  3. Normalizes shift. If `p_release_seat` and `p_bus_id` non-null, calls `bus_decrement_capacity(p_bus_id, v_normalized_shift)`. If bus not found (decommissioned/renamed), converts to non-fatal warning so student soft-block is not obstructed.
  4. Updates `student_profiles`: `status = 'soft_blocked'`, `seat_released_at = CASE WHEN p_release_seat THEN p_seat_released_at ELSE seat_released_at END`, `updated_at = NOW()`.
  5. Exception / Failure Compensation: If update fails or exception thrown, calls `bus_increment_capacity` to restore capacity before re-raising.
  6. Returns `{ "success": true, "student_uid": p_student_uid, "status": "soft_blocked", "seat_released": p_release_seat }`.

#### 10. RPC `delete_student_cascade_v1(p_student_uid TEXT)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 2395–2490)
- **Signature:** `(p_student_uid TEXT) RETURNS JSONB`
- **Control Flow:**
  1. Validates `p_student_uid`.
  2. Locks student profile: `SELECT bus_id, shift, seat_released_at, status, valid_until FROM student_profiles WHERE uid = p_student_uid FOR UPDATE`.
  3. If not found, returns `{ "success": true, "already_deleted": true }`.
  4. **Active Renewal / Concurrency Race Guard:**
     - If `status = 'active'` and `valid_until > NOW()`, aborts deletion returning `{ "success": false, "error": "ACTIVE_STUDENT_ABORT_DELETE" }`.
     - If active renewal application exists in `applications` (`state IN ('approved', 'submitted', 'verified')`), aborts deletion returning `{ "success": false, "error": "ACTIVE_RENEWAL_APP_ABORT_DELETE" }`.
  5. **Capacity Decrement Guard:** If `v_student_bus_id IS NOT NULL AND v_student_seat_released IS NULL`, decrements bus counters (`morning_load`, `evening_load`, `current_members`).
  6. **Cascade Deletions in Dependency Order:**
     - `DELETE FROM notifications WHERE sender_user_id = p_student_uid OR recipient_ids @> ARRAY[p_student_uid]`
     - `DELETE FROM waiting_flags WHERE student_uid = p_student_uid`
     - `DELETE FROM fcm_tokens WHERE user_id = p_student_uid`
     - `DELETE FROM applications WHERE applicant_uid = p_student_uid`
     - `DELETE FROM student_profiles WHERE uid = p_student_uid`
     - `DELETE FROM users WHERE uid = p_student_uid`
  7. **Financial & Audit Invariant:** `payments` and `audit_events` tables are NEVER touched by cascade deletion.
  8. Returns deletion metrics object.

#### 11. RPC `bus_increment_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning', p_enforce_capacity BOOLEAN DEFAULT true)`
- **File:** `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` (Lines 13–54)
- **Signature:** `(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning', p_enforce_capacity BOOLEAN DEFAULT true) RETURNS JSONB`
- **Control Flow:**
  - Validates shift in `('morning', 'evening', 'both')`.
  - Locks bus: `SELECT id, capacity, morning_load, evening_load FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1`.
  - If `p_enforce_capacity` is true, verifies load < capacity for target shift(s).
  - Updates: `morning_load += (1 if morning/both)`, `evening_load += (1 if evening/both)`, `current_members = morning_load + evening_load`.
  - Returns JSONB result with old and new loads.

#### 12. RPC `bus_decrement_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning')`
- **File:** `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` (Lines 57–81)
- **Signature:** `(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning') RETURNS JSONB`
- **Control Flow:**
  - Validates shift in `('morning', 'evening', 'both')`.
  - Locks bus: `SELECT ... FOR UPDATE LIMIT 1`.
  - Updates: `morning_load = GREATEST(0, morning_load - (1 if morning/both))`, `evening_load = GREATEST(0, evening_load - (1 if evening/both))`, `current_members = morning_load + evening_load`.
  - Returns JSONB result.

#### 13. RPC `reassign_students_atomically(p_plans JSONB)`
- **File:** `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql` (Lines 205–325)
- **Signature:** `(p_plans JSONB) RETURNS JSONB`
- **Control Flow:**
  1. **Lexical Global Lock Pre-Acquisition:** Collects all unique bus IDs from all plans and pre-locks them via:
     `SELECT ARRAY_AGG(id ORDER BY id ASC) FROM buses WHERE id IN (...) FOR UPDATE`.
     This single query guarantees a global deterministic lock hierarchy, mathematically eliminating 40P01 deadlocks.
  2. Iterates over plans:
     - Locks `student_profiles` FOR UPDATE.
     - Resolves old shift and new shift.
     - Decrements from-bus capacity using student's OLD shift.
     - Increments to-bus capacity using student's NEW shift (enforces capacity).
     - Updates `student_profiles`: `bus_id = to_bus_id`, `route_id = target_route_id`, `shift = INITCAP(new_shift)`, `stop_name = stop_name`, `seat_released_at = NULL`.
  3. Re-aggregates bus load counts across all affected buses from active student profiles (`seat_released_at IS NULL AND status IN ('active', 'soft_blocked', 'pending_deletion')`).
  4. Returns `{ "success": true, "processed": v_processed }`.

#### 14. RPC `execute_reassignment_rollback(p_operation_id TEXT, p_actor_id TEXT, p_actor_label TEXT, p_changes JSONB)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 2856–2993)
- **Signature:** `(p_operation_id TEXT, p_actor_id TEXT, p_actor_label TEXT, p_changes JSONB) RETURNS JSONB`
- **Control Flow:**
  1. Checks and locks `reassignment_logs` WHERE `operation_id = p_operation_id FOR UPDATE`. Returns error if status <> `'committed'` or already `'rolled_back'`.
  2. Precondition validation: iterates through changes; for each student, verifies row still exists and `bus_id` matches the post-operation state (`v_after->>'busId'`). If student moved again since the operation, aborts with `"Precondition failed: Student ... busId has changed since the reassignment"`.
  3. Reverts student records: restores `bus_id`, `route_id`, `shift`, `stop_name` to `v_before` values.
  4. Recalculates bus loads for all affected buses in deterministic order.
  5. Updates `reassignment_logs SET status = 'rolled_back'`, stamping `rolledBackAt`.

#### 15. RPC `increment_expiry_reminder_count(p_uid TEXT)`
- **File:** `supabase/COMPLETE_SCHEMA.sql` (Lines 2125–2161)
- **Signature:** `(p_uid TEXT) RETURNS BOOLEAN`
- **Control Flow:**
  1. Locks row: `SELECT last_expiry_reminder_sent_at FROM student_profiles WHERE uid = p_uid FOR UPDATE`.
  2. Returns `FALSE` if not found.
  3. Idempotent check: if `last_expiry_reminder_sent_at::DATE = CURRENT_DATE` (UTC), returns `FALSE` so caller skips sending notification.
  4. Updates `student_profiles SET expiry_reminder_count = COALESCE(expiry_reminder_count, 0) + 1, last_expiry_reminder_sent_at = NOW(), updated_at = NOW() WHERE uid = p_uid`.
  5. Returns `TRUE`.

---

### 1.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Execution Path | PostgreSQL Queries & RPC Calls | Redis Ops | External Calls | Total Ops |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Cold Execution: Fresh Student Approval via RPCs** | **4 DB Operations:**<br>1. RPC `approve_application` (Locks app)<br>2. RPC `identity_activate_student_with_capacity` (Locks student + bus, verifies capacity, increments bus loads, upserts users + student_profiles)<br>3. RPC `finalize_application_approval` (Deletes application row)<br>4. Insert `audit_events` | **1 Invalidation:**<br>`student:assign:<uid>` (Del key + pub/sub) | **2 Calls:**<br>1. Cloudinary `deleteAsset` (Proof)<br>2. Resend / SMTP Email API | **7 Operations** |
| **(b) Warm Execution: Renewal Approval with Seat Reclamation** | **4 DB Operations:**<br>1. RPC `approve_application` (Locks app)<br>2. RPC `approve_renewal_with_seat` (Locks student + bus, checks capacity, increments bus loads, updates profile, finalizes app)<br>3. Insert `audit_events`<br>4. Insert `payments` (if offline payment created) | **1 Invalidation:**<br>`student:assign:<uid>` | **2 Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Email Notification | **7 Operations** |
| **(c) Concurrency / Capacity Full Collision** | **2 DB Operations:**<br>1. RPC `approve_application` (Acquires lock)<br>2. RPC `approve_renewal_with_seat` or `identity_activate_student_with_capacity` (Detects `load >= capacity`, aborts, returns `CAPACITY_FULL`)<br>3. RPC `release_application_lock` | **0** | **0 External Calls** (Aborts before side effects) | **3 Operations** |
| **(d) Partial Failure / Rollback (e.g. Identity Fails after Bus Increment)** | **1 DB Operation (Atomic):**<br>PL/pgSQL implicitly aborts transaction on exception in `identity_activate_student_with_capacity`. Bus increment is rolled back by PostgreSQL WAL engine. | **0** | **0 External Calls** | **1 Operation** |
| **(e) Daily Expiry Check Cron (Per Expiring Student)** | **2 DB Operations:**<br>1. RPC `increment_expiry_reminder_count` (Row lock + CAS update)<br>2. Insert `public.notifications` | **0** | **1 Call:**<br>Firebase Cloud Messaging (FCM) | **3 Operations** |
| **(f) Daily Soft-Block Cron (Per Expired Student)** | **2 DB Operations:**<br>1. RPC `soft_block_student_with_seat_release` (Locks student, decrements bus loads, marks status `'soft_blocked'`)<br>2. Insert `public.audit_events` | **1 Invalidation:**<br>`student:assign:<uid>` | **0 External Calls** | **3 Operations** |
| **(g) Daily Hard-Delete Cron (Per Expired Student)** | **2 DB Operations:**<br>1. RPC `delete_student_cascade_v1` (Locks student, checks renewal guard, decrements bus if unreleased, cascades 6 tables)<br>2. Insert `public.audit_events` | **1 Invalidation:**<br>`role_cache:<uid>` | **2 Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Firebase Auth `deleteUser` | **5 Operations** |

---

### 1.5 Verbatim Source Code from Live Codebase

#### 1. Core Schema: `student_profiles`, `applications`, `users`, `unauth_users`, `buses`, `routes`, `temporary_assignments`, `processed_operations`, `reassignment_logs`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 78–213, 339–394, 574–595, 2821–2831)*

```sql
-- ── 3.1 Identity Domain ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    uid          TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    name         TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin', 'moderator', 'driver', 'student')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

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

CREATE TABLE IF NOT EXISTS unauth_users (
    uid          TEXT PRIMARY KEY,
    email        TEXT,
    name         TEXT,
    role         TEXT NOT NULL DEFAULT 'student',
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.2 Fleet Domain ──────────────────────────────────────────────────────────

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

CREATE TABLE IF NOT EXISTS temporary_assignments (
    id          TEXT PRIMARY KEY,
    student_id  TEXT NOT NULL,
    original_bus_id TEXT NOT NULL,
    temporary_bus_id TEXT NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.3 Route Domain ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS routes (
    id          TEXT PRIMARY KEY,
    route_name  TEXT NOT NULL UNIQUE,
    stops       JSONB NOT NULL DEFAULT '[]',
    buses       JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.4 Application Domain ────────────────────────────────────────────────────

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_active_student_session 
ON applications (applicant_uid, COALESCE(session_start_year, 0)) 
WHERE state NOT IN ('rejected', 'cancelled', 'expired');

-- ── 3.7 Operations & Rollback Logs ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reassignment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending',
  records_count INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_of TEXT,
  bus_id TEXT,
  driver_id TEXT,
  route_id TEXT,
  can_rollback BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.processed_operations (
    operation_key TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    actor_uid TEXT NOT NULL,
    renewal_count INTEGER,
    results JSONB,
    summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 2. RPC: `approve_application` & `finalize_application_approval`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 1289–1385)*

```sql
CREATE OR REPLACE FUNCTION approve_application(
    p_application_id TEXT, p_approver_uid TEXT, p_lease_minutes INTEGER DEFAULT 5
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app JSONB;
BEGIN
    v_app := validate_application_for_approval(p_application_id, p_approver_uid, p_lease_minutes);
    IF v_app IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application not found or already being processed', 'status', 409);
    END IF;
    RETURN jsonb_build_object('success', true, 'application', v_app);
END;
$$;

CREATE OR REPLACE FUNCTION finalize_application_approval(
    p_application_id TEXT, p_approver_uid TEXT, p_student_data JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_app RECORD;
    v_updated INTEGER;
    v_deleted INTEGER;
    v_student_updated INTEGER;
BEGIN
    SELECT application_id, application_type, applicant_uid,
           processing_lock, processing_lease_expires_at
    INTO v_app
    FROM applications
    WHERE application_id = p_application_id
      AND processing_lock = p_approver_uid
      AND processing_lease_expires_at > NOW();

    IF v_app IS NULL THEN
        IF EXISTS(SELECT 1 FROM applications WHERE application_id = p_application_id) THEN
            IF EXISTS(SELECT 1 FROM applications
                WHERE application_id = p_application_id AND state = 'approved'
                  AND application_type IN ('renewal', 'renewal_after_soft_block'))
            THEN
                RETURN jsonb_build_object('success', true, 'finalized', false, 'already_finalized', true, 'application_id', p_application_id);
            END IF;
            RETURN jsonb_build_object('success', false, 'status', 409, 'error', 'Invalid or expired processing lease');
        ELSE
            RETURN jsonb_build_object('success', true, 'finalized', false, 'already_finalized', true, 'application_id', p_application_id);
        END IF;
    END IF;

    IF v_app.application_type IN ('renewal', 'renewal_after_soft_block') THEN
        IF p_student_data IS NOT NULL AND v_app.applicant_uid IS NOT NULL THEN
            UPDATE student_profiles SET
                valid_until = COALESCE((p_student_data->>'valid_until')::TIMESTAMPTZ, valid_until),
                status = COALESCE(p_student_data->>'status', status),
                session_end_year = COALESCE((p_student_data->>'session_end_year')::INTEGER, session_end_year),
                session_duration = COALESCE(p_student_data->>'session_duration', session_duration),
                soft_block = COALESCE((p_student_data->>'soft_block')::TIMESTAMPTZ, soft_block),
                hard_block = COALESCE((p_student_data->>'hard_block')::TIMESTAMPTZ, hard_block),
                last_processed_application_id = p_application_id
            WHERE uid = v_app.applicant_uid;
            GET DIAGNOSTICS v_student_updated = ROW_COUNT;
            IF v_student_updated != 1 THEN
                RAISE EXCEPTION 'Expected to update exactly 1 student_profiles row for uid=%, got %', v_app.applicant_uid, v_student_updated;
            END IF;
        END IF;

        UPDATE applications SET state = 'approved', approved_at = NOW(), approved_by = p_approver_uid,
            processing_lock = NULL, processing_started_at = NULL, processing_lease_expires_at = NULL,
            processing_result = 'success', processing_completed_at = NOW()
        WHERE application_id = p_application_id AND processing_lock = p_approver_uid;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated != 1 THEN
            RAISE EXCEPTION 'Expected to update exactly 1 application row for id=%, got %', p_application_id, v_updated;
        END IF;

        RETURN jsonb_build_object('success', true, 'finalized', true, 'already_finalized', false,
            'application_id', p_application_id, 'student_updated', p_student_data IS NOT NULL, 'action', 'state_updated_to_approved');
    ELSE
        DELETE FROM applications WHERE application_id = p_application_id AND processing_lock = p_approver_uid;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        IF v_deleted = 1 THEN
            RETURN jsonb_build_object('success', true, 'finalized', true, 'already_finalized', false, 'application_id', p_application_id, 'action', 'deleted');
        ELSE
            RETURN jsonb_build_object('success', false, 'status', 409, 'error', 'Failed to delete application');
        END IF;
    END IF;
END;
$$;
```

#### 3. RPC: `identity_activate_student_with_capacity`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 1135–1243)*

```sql
CREATE OR REPLACE FUNCTION public.identity_activate_student_with_capacity(
    p_bus_id   TEXT,
    p_shift    TEXT,
    p_uid      TEXT,
    p_email    TEXT,
    p_full_name TEXT,
    p_student_data JSONB DEFAULT '{}'::jsonb,
    p_enforce_capacity BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized    TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus           RECORD;
    v_existing_student RECORD;
    v_new_morning   INTEGER;
    v_new_evening   INTEGER;
    v_target_load   INTEGER;
    v_capacity      INTEGER;
    v_activate_result JSONB;
BEGIN
    -- ── 1. Validate shift ───────────────────────────────────────────────────
    IF v_normalized NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invalid shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning or Evening)'
        );
    END IF;

    -- ── 2. Lock student row FOR UPDATE first: STUDENT -> BUS ──
    SELECT bus_id, shift, status, seat_released_at
    INTO v_existing_student
    FROM student_profiles
    WHERE uid = p_uid
    FOR UPDATE;

    -- ── 3. Lock bus row + capacity check ──
    SELECT id, capacity, morning_load, evening_load
    INTO v_bus
    FROM buses
    WHERE id = p_bus_id OR bus_number = p_bus_id
    FOR UPDATE
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus ' || p_bus_id || ' not found');
    END IF;

    v_target_load := CASE WHEN v_normalized = 'morning' THEN v_bus.morning_load ELSE v_bus.evening_load END;
    v_capacity    := COALESCE(v_bus.capacity, 0);

    -- ── 4. Idempotent retry guard ──
    IF v_existing_student.status = 'active'
       AND v_existing_student.seat_released_at IS NULL
       AND (v_existing_student.bus_id = v_bus.id OR v_existing_student.bus_id = p_bus_id)
       AND LOWER(TRIM(COALESCE(v_existing_student.shift, 'Morning'))) = v_normalized THEN
        v_new_morning := v_bus.morning_load;
        v_new_evening := v_bus.evening_load;
    ELSE
        IF p_enforce_capacity AND v_target_load >= v_capacity THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Bus ' || p_bus_id || ' is at full capacity for ' || v_normalized
                         || ' shift (' || v_target_load || '/' || v_capacity || ')'
            );
        END IF;

        -- ── 3. Increment bus load ───────────────────────────────────────────────
        v_new_morning := v_bus.morning_load + CASE WHEN v_normalized = 'morning' THEN 1 ELSE 0 END;
        v_new_evening := v_bus.evening_load + CASE WHEN v_normalized = 'evening' THEN 1 ELSE 0 END;

        UPDATE buses
        SET morning_load   = v_new_morning,
            evening_load   = v_new_evening,
            current_members = v_new_morning + v_new_evening,
            updated_at     = NOW()
        WHERE id = v_bus.id;
    END IF;

    -- ── 4. Activate student identity ──────
    SELECT public.identity_activate_student(p_uid, p_email, p_full_name, p_student_data)
    INTO v_activate_result;

    IF NOT (v_activate_result->>'success')::boolean THEN
        RAISE EXCEPTION 'identity_activate_student failed: %', v_activate_result->>'error';
    END IF;

    UPDATE student_profiles
    SET seat_released_at = NULL, updated_at = NOW()
    WHERE uid = p_uid;

    RETURN jsonb_build_object(
        'success',          true,
        'uid',              p_uid,
        'busId',            v_bus.id,
        'shift',            p_shift,
        'morningLoad',      v_new_morning,
        'eveningLoad',      v_new_evening,
        'currentMembers',   v_new_morning + v_new_evening,
        'already_activated', (v_activate_result->>'already_activated')::boolean
    );
END;
$$;
```

#### 4. RPC: `approve_renewal_with_seat` (Canonical Migration 20261019)
*(Source: `supabase/migrations/20261019_payment_ledger_and_renewal_hardening.sql`, lines 23–183)*

```sql
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_application_id    TEXT,
    p_student_uid       TEXT,
    p_bus_id            TEXT,
    p_shift             TEXT,
    p_valid_until       TIMESTAMPTZ,
    p_session_end_year  INTEGER,
    p_session_duration  TEXT,
    p_approver_uid      TEXT DEFAULT NULL,
    p_approved_by       TEXT DEFAULT NULL,
    p_soft_block        TIMESTAMPTZ DEFAULT NULL,
    p_hard_block        TIMESTAMPTZ DEFAULT NULL
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
    v_effective_actor  TEXT;
BEGIN
    v_effective_actor := COALESCE(p_approver_uid, p_approved_by, 'system');

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
    WHERE id = p_bus_id OR bus_number = p_bus_id
    FOR UPDATE
    LIMIT 1;

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
    SET morning_load = v_new_morning,
        evening_load = v_new_evening,
        current_members = v_new_morning + v_new_evening,
        updated_at = NOW()
    WHERE id = v_bus.id;

    -- 6. Update student profile (re-activate, extend validity, clear seat_released_at)
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
        -- Compensate bus capacity
        UPDATE buses
        SET morning_load = v_bus.morning_load,
            evening_load = v_bus.evening_load,
            current_members = v_bus.morning_load + v_bus.evening_load,
            updated_at = NOW()
        WHERE id = v_bus.id;
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found or not updated: ' || p_student_uid);
    END IF;

    -- 7. Finalize application → approved using the actual application schema
    UPDATE public.applications SET
        state                       = 'approved',
        approved_at                 = NOW(),
        approved_by                 = v_effective_actor,
        approved_by_id              = v_effective_actor,
        processing_lock             = NULL,
        processing_started_at       = NULL,
        processing_lease_expires_at = NULL,
        processing_result           = 'success',
        processing_completed_at     = NOW(),
        updated_at                  = NOW()
    WHERE application_id = p_application_id;
    GET DIAGNOSTICS v_app_updated = ROW_COUNT;

    IF v_app_updated <> 1 THEN
        -- Rollback compensation: restore exact previous values
        UPDATE student_profiles SET
            status                        = v_student.status,
            valid_until                   = v_student.valid_until,
            session_end_year              = v_student.session_end_year,
            session_duration              = v_student.session_duration,
            soft_block                    = v_student.soft_block,
            hard_block                    = v_student.hard_block,
            seat_released_at              = v_student.seat_released_at,
            last_processed_application_id = v_student.last_processed_application_id,
            updated_at                    = NOW()
        WHERE uid = p_student_uid;

        UPDATE buses
        SET morning_load = v_bus.morning_load,
            evening_load = v_bus.evening_load,
            current_members = v_bus.morning_load + v_bus.evening_load,
            updated_at = NOW()
        WHERE id = v_bus.id;

        RETURN jsonb_build_object('success', false, 'error', 'Application not found or update failed: ' || p_application_id);
    END IF;

    RETURN jsonb_build_object(
        'success',        true,
        'studentUid',     p_student_uid,
        'busId',          v_bus.id,
        'shift',          p_shift,
        'newMorningLoad', v_new_morning,
        'newEveningLoad', v_new_evening,
        'capacity',       v_bus.capacity
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
```

#### 5. RPC: `soft_block_student_with_seat_release`
*(Source: `supabase/migrations/20261016_fix_academic_lifecycle_inconsistencies.sql`, lines 16–100)*

```sql
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

#### 6. RPC: `delete_student_cascade_v1`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 2395–2490)*

```sql
CREATE OR REPLACE FUNCTION public.delete_student_cascade_v1(p_student_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_notifications_deleted  INTEGER := 0;
    v_waiting_flags_deleted  INTEGER := 0;
    v_fcm_deleted            INTEGER := 0;
    v_applications_deleted   INTEGER := 0;
    v_student_deleted        INTEGER := 0;
    v_user_deleted           INTEGER := 0;
    v_student_bus_id         TEXT;
    v_student_shift          TEXT;
    v_student_seat_released  TIMESTAMPTZ;
    v_student_status         TEXT;
    v_student_valid_until    TIMESTAMPTZ;
BEGIN
    IF p_student_uid IS NULL OR p_student_uid = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_student_uid is required');
    END IF;

    -- 1. Acquire row lock FOR UPDATE first to serialize against concurrent renewal transactions (CRON-02)
    SELECT bus_id, shift, seat_released_at, status, valid_until
    INTO v_student_bus_id, v_student_shift, v_student_seat_released, v_student_status, v_student_valid_until
    FROM public.student_profiles 
    WHERE uid = p_student_uid 
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'already_deleted', true);
    END IF;

    -- 2. Concurrency guard (CRON-02): Check the authoritative locked row state.
    -- If a renewal committed immediately before or during this RPC, abort to prevent account destruction.
    IF v_student_status = 'active' AND (v_student_valid_until IS NULL OR v_student_valid_until > NOW()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_STUDENT_ABORT_DELETE');
    END IF;

    -- 3. Also check if an active renewal application exists under row lock
    IF EXISTS (
        SELECT 1 FROM public.applications 
        WHERE applicant_uid = p_student_uid 
          AND application_type IN ('renewal', 'renewal_after_soft_block')
          AND state IN ('approved', 'submitted', 'verified')
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'ACTIVE_RENEWAL_APP_ABORT_DELETE');
    END IF;

    -- 4. Decrement bus capacity atomically if student held an unreleased seat (CRON-05)
    IF v_student_bus_id IS NOT NULL AND v_student_seat_released IS NULL THEN
        UPDATE public.buses
        SET morning_load   = GREATEST(0, morning_load - CASE WHEN LOWER(TRIM(COALESCE(v_student_shift, 'Morning'))) = 'morning' THEN 1 ELSE 0 END),
            evening_load   = GREATEST(0, evening_load - CASE WHEN LOWER(TRIM(COALESCE(v_student_shift, 'Morning'))) = 'evening' THEN 1 ELSE 0 END),
            current_members = GREATEST(0, current_members - 1),
            updated_at     = NOW()
        WHERE id = v_student_bus_id OR bus_number = v_student_bus_id;
    END IF;

    -- 1. Notifications (recipient or sender)
    DELETE FROM public.notifications
    WHERE sender_user_id = p_student_uid
       OR recipient_ids @> ARRAY[p_student_uid];
    GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

    -- 2. Waiting flags
    DELETE FROM public.waiting_flags WHERE student_uid = p_student_uid;
    GET DIAGNOSTICS v_waiting_flags_deleted = ROW_COUNT;

    -- 3. FCM tokens
    DELETE FROM public.fcm_tokens WHERE user_id = p_student_uid;
    GET DIAGNOSTICS v_fcm_deleted = ROW_COUNT;

    -- 4. Applications
    DELETE FROM public.applications WHERE applicant_uid = p_student_uid;
    GET DIAGNOSTICS v_applications_deleted = ROW_COUNT;

    -- 5. Student profile
    DELETE FROM public.student_profiles WHERE uid = p_student_uid;
    GET DIAGNOSTICS v_student_deleted = ROW_COUNT;

    -- 6. User record (last — FK target)
    DELETE FROM public.users WHERE uid = p_student_uid;
    GET DIAGNOSTICS v_user_deleted = ROW_COUNT;

    RETURN jsonb_build_object(
        'success',              true,
        'student_uid',          p_student_uid,
        'notifications_deleted', v_notifications_deleted,
        'waiting_flags_deleted', v_waiting_flags_deleted,
        'fcm_deleted',          v_fcm_deleted,
        'applications_deleted', v_applications_deleted,
        'student_deleted',      v_student_deleted,
        'user_deleted',         v_user_deleted
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
```

#### 7. RPC: `reassign_students_atomically` (Deadlock-Free Lexical Locking)
*(Source: `supabase/migrations/20261018_fix_shift_parity_and_reassignment_deadlocks.sql`, lines 205–325)*

```sql
CREATE OR REPLACE FUNCTION public.reassign_students_atomically(p_plans JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_plan           JSONB;
    v_student        RECORD;
    v_old_shift      TEXT;
    v_new_shift      TEXT;
    v_target_route_id TEXT;
    v_stop_name      TEXT;
    v_student_id     TEXT;
    v_from_bus_id    TEXT;
    v_to_bus_id      TEXT;
    v_processed      INTEGER := 0;
    v_cap_result     JSONB;
    v_affected_buses TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- 1. Pre-lock all affected buses in strict ascending order (ORDER BY id ASC FOR UPDATE)
    -- This guarantees a global lock acquisition hierarchy, mathematically eliminating PostgreSQL 40P01 deadlocks!
    SELECT ARRAY_AGG(id ORDER BY id ASC)
    INTO v_affected_buses
    FROM buses
    WHERE id IN (
        SELECT DISTINCT COALESCE(plan->>'fromBusId', plan->>'from_bus_id')
        FROM jsonb_array_elements(p_plans) AS plan
        WHERE COALESCE(plan->>'fromBusId', plan->>'from_bus_id') IS NOT NULL
          AND COALESCE(plan->>'fromBusId', plan->>'from_bus_id') <> ''
        UNION
        SELECT DISTINCT COALESCE(plan->>'toBusId', plan->>'to_bus_id')
        FROM jsonb_array_elements(p_plans) AS plan
        WHERE COALESCE(plan->>'toBusId', plan->>'to_bus_id') IS NOT NULL
          AND COALESCE(plan->>'toBusId', plan->>'to_bus_id') <> ''
    )
    FOR UPDATE;

    FOR v_plan IN SELECT * FROM jsonb_array_elements(p_plans) LOOP
        v_student_id  := COALESCE(v_plan->>'studentId', v_plan->>'student_id');
        v_from_bus_id := COALESCE(v_plan->>'fromBusId', v_plan->>'from_bus_id');
        v_to_bus_id   := COALESCE(v_plan->>'toBusId', v_plan->>'to_bus_id');

        IF v_student_id IS NULL OR v_student_id = '' THEN CONTINUE; END IF;

        -- Read student (lock row to prevent concurrent modification)
        SELECT uid, shift, bus_id, stop_name
        INTO v_student
        FROM student_profiles
        WHERE uid = v_student_id
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- Resolve old shift for decrement (student's current shift)
        v_old_shift := LOWER(TRIM(COALESCE(v_student.shift, 'Morning')));
        IF v_old_shift NOT IN ('morning', 'evening', 'both') THEN v_old_shift := 'morning'; END IF;

        -- Resolve new shift for increment (plan override > student record)
        v_new_shift := LOWER(TRIM(COALESCE(v_plan->>'studentShift', v_plan->>'shift', v_student.shift, 'Morning')));
        IF v_new_shift NOT IN ('morning', 'evening', 'both') THEN v_new_shift := 'morning'; END IF;

        -- Fetch target bus route_id
        SELECT route_id INTO v_target_route_id
        FROM buses
        WHERE id = v_to_bus_id OR bus_number = v_to_bus_id
        LIMIT 1;

        -- Decrement from-bus capacity using student's OLD shift
        IF v_from_bus_id IS NOT NULL AND v_from_bus_id <> '' THEN
            SELECT bus_decrement_capacity(v_from_bus_id, v_old_shift) INTO v_cap_result;
        END IF;

        -- Increment to-bus capacity using student's NEW shift and enforce capacity guard
        IF v_to_bus_id IS NOT NULL AND v_to_bus_id <> '' THEN
            SELECT bus_increment_capacity(v_to_bus_id, v_new_shift) INTO v_cap_result;
            IF v_cap_result->>'error' IS NOT NULL THEN
                RAISE EXCEPTION 'Capacity exceeded during reassignment for bus %: %', v_to_bus_id, v_cap_result->>'error';
            END IF;
        END IF;

        -- Resolve stop_name override if provided
        v_stop_name := COALESCE(v_plan->>'stopName', v_plan->>'stop_name', v_student.stop_name);

        -- Update student record (bus_id, route_id, shift, stop_name)
        UPDATE student_profiles SET
            bus_id          = v_to_bus_id,
            route_id        = COALESCE(v_target_route_id, route_id),
            shift           = INITCAP(v_new_shift),
            stop_name       = v_stop_name,
            seat_released_at = NULL,
            updated_at      = NOW()
        WHERE uid = v_student_id;

        v_processed := v_processed + 1;
    END LOOP;

    -- Recalculate bus load counts for all affected buses in deterministic ascending order
    IF v_affected_buses IS NOT NULL AND array_length(v_affected_buses, 1) > 0 THEN
        FOR v_to_bus_id IN SELECT DISTINCT x FROM unnest(v_affected_buses) AS x ORDER BY x ASC LOOP
            UPDATE buses b SET
                (morning_load, evening_load, current_members, updated_at) = (
                    SELECT 
                        COUNT(*) FILTER (WHERE LOWER(sp.shift) IN ('morning', 'both')),
                        COUNT(*) FILTER (WHERE LOWER(sp.shift) IN ('evening', 'both')),
                        COUNT(*),
                        NOW()
                    FROM student_profiles sp
                    WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number)
                      AND sp.seat_released_at IS NULL
                      AND sp.status IN ('active', 'soft_blocked', 'pending_deletion')
                )
            WHERE b.id = v_to_bus_id OR b.bus_number = v_to_bus_id;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success',   true,
        'processed', v_processed
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
```

#### 8. RPC: `execute_reassignment_rollback`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 2856–2993)*

```sql
CREATE OR REPLACE FUNCTION public.execute_reassignment_rollback(
    p_operation_id TEXT,
    p_actor_id TEXT,
    p_actor_label TEXT,
    p_changes JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_orig_status TEXT;
    v_orig_changes JSONB;
    v_changes_array JSONB;
    v_change JSONB;
    v_collection TEXT;
    v_doc_id TEXT;
    v_before JSONB;
    v_after JSONB;
    v_student_row RECORD;
    v_target_route_id TEXT;
    v_reverted_docs TEXT[] := ARRAY[]::TEXT[];
    v_affected_buses TEXT[] := ARRAY[]::TEXT[];
    v_bus_id_item TEXT;
    v_row_updated INTEGER;
BEGIN
    IF jsonb_typeof(p_changes) = 'string' THEN
        v_changes_array := (p_changes#>>'{}')::jsonb;
    ELSE
        v_changes_array := p_changes;
    END IF;

    -- 1. Check original log status and lock it
    SELECT status, changes INTO v_orig_status, v_orig_changes
    FROM public.reassignment_logs
    WHERE operation_id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Original reassignment log not found');
    END IF;

    IF v_orig_status = 'rolled_back' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Reassignment already rolled back', 'reverted_docs', '[]'::jsonb);
    END IF;

    IF v_orig_status <> 'committed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only committed reassignments can be rolled back');
    END IF;

    -- 2. Verify all entities exist and validate preconditions
    FOR v_change IN SELECT jsonb_array_elements(v_changes_array) LOOP
        v_collection := v_change->>'collection';
        v_doc_id := v_change->>'docId';
        v_after := v_change->'after';
        
        IF v_collection = 'students' THEN
            SELECT bus_id, shift INTO v_student_row 
            FROM public.student_profiles 
            WHERE uid = v_doc_id 
            FOR UPDATE;
            
            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'Precondition failed: Student ' || v_doc_id || ' no longer exists');
            END IF;
            
            IF (v_after ? 'busId' OR v_after ? 'bus_id') AND COALESCE(v_student_row.bus_id, '') <> COALESCE(v_after->>'busId', v_after->>'bus_id', '') THEN
                RETURN jsonb_build_object('success', false, 'error', 'Precondition failed: Student ' || v_doc_id || ' busId has changed since the reassignment');
            END IF;
        END IF;
    END LOOP;

    -- 3. Perform atomic rollback
    FOR v_change IN SELECT jsonb_array_elements(v_changes_array) LOOP
        v_collection := v_change->>'collection';
        v_doc_id := v_change->>'docId';
        v_before := v_change->'before';
        v_after := v_change->'after';
        
        IF v_collection = 'students' THEN
            v_target_route_id := NULL;
            IF (v_before ? 'busId' OR v_before ? 'bus_id') AND COALESCE(v_before->>'busId', v_before->>'bus_id') <> '' THEN
                SELECT route_id INTO v_target_route_id FROM buses WHERE id = COALESCE(v_before->>'busId', v_before->>'bus_id') OR bus_number = COALESCE(v_before->>'busId', v_before->>'bus_id') LIMIT 1;
            END IF;

            IF v_before ? 'busId' OR v_before ? 'bus_id' THEN
                v_affected_buses := array_append(v_affected_buses, COALESCE(v_before->>'busId', v_before->>'bus_id'));
            END IF;
            IF v_after ? 'busId' OR v_after ? 'bus_id' THEN
                v_affected_buses := array_append(v_affected_buses, COALESCE(v_after->>'busId', v_after->>'bus_id'));
            END IF;

            UPDATE public.student_profiles SET
                bus_id = CASE WHEN v_before ? 'busId' THEN v_before->>'busId' WHEN v_before ? 'bus_id' THEN v_before->>'bus_id' ELSE bus_id END,
                route_id = COALESCE(v_target_route_id, CASE WHEN v_before ? 'routeId' THEN v_before->>'routeId' WHEN v_before ? 'route_id' THEN v_before->>'route_id' ELSE route_id END),
                shift = CASE WHEN v_before ? 'shift' THEN INITCAP(v_before->>'shift') ELSE shift END,
                stop_name = CASE WHEN v_before ? 'stopName' THEN v_before->>'stopName' WHEN v_before ? 'stop_name' THEN v_before->>'stop_name' ELSE stop_name END,
                seat_released_at = NULL,
                updated_at = NOW()
            WHERE uid = v_doc_id;
            
            GET DIAGNOSTICS v_row_updated = ROW_COUNT;
            IF v_row_updated <> 1 THEN
                RAISE EXCEPTION 'Failed to update student profile %', v_doc_id;
            END IF;
            
            v_reverted_docs := array_append(v_reverted_docs, v_change->>'docPath');
        END IF;
    END LOOP;

    -- 4. Recalculate bus load counts for all affected buses in deterministic order
    FOR v_bus_id_item IN SELECT DISTINCT x FROM unnest(v_affected_buses) AS x ORDER BY x ASC LOOP
        UPDATE buses b SET
            (morning_load, evening_load, current_members, updated_at) = (
                SELECT 
                    COUNT(*) FILTER (WHERE LOWER(sp.shift) = 'morning'),
                    COUNT(*) FILTER (WHERE LOWER(sp.shift) = 'evening'),
                    COUNT(*),
                    NOW()
                FROM student_profiles sp
                WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number)
                  AND sp.seat_released_at IS NULL
                  AND sp.status IN ('active', 'soft_blocked', 'pending_deletion')
            )
        WHERE b.id = v_bus_id_item OR b.bus_number = v_bus_id_item;
    END LOOP;

    -- 5. Mark log as rolled back
    UPDATE public.reassignment_logs SET
        status = 'rolled_back',
        meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{rolledBackAt}', to_jsonb(NOW()))
    WHERE operation_id = p_operation_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Rollback executed successfully',
        'reverted_docs', to_jsonb(v_reverted_docs)
    );
END;
$$;
```

#### 9. RPC: `increment_expiry_reminder_count`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 2125–2161)*

```sql
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
    SELECT last_expiry_reminder_sent_at
      INTO v_last_sent
      FROM student_profiles
     WHERE uid = p_uid
       FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_last_sent IS NOT NULL AND v_last_sent::DATE = v_today THEN
        RETURN FALSE;
    END IF;

    UPDATE student_profiles
       SET expiry_reminder_count      = COALESCE(expiry_reminder_count, 0) + 1,
           last_expiry_reminder_sent_at = NOW(),
           updated_at                  = NOW()
     WHERE uid = p_uid;

    RETURN TRUE;
END;
$$;
```

#### 10. RPC: `assign_drivers_atomically` & `assign_routes_atomically`
*(Source: `supabase/COMPLETE_SCHEMA.sql`, lines 1715–1776)*

```sql
CREATE OR REPLACE FUNCTION assign_drivers_atomically(
    p_bus_updates JSONB, p_driver_updates JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bus_rec JSONB; v_driver_rec JSONB; v_is_reserved BOOLEAN;
    v_updated_buses TEXT[] := '{}'; v_updated_drivers TEXT[] := '{}';
BEGIN
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        PERFORM 1 FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
        END IF;
    END LOOP;

    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
    END LOOP;

    FOR v_driver_rec IN SELECT * FROM jsonb_array_elements(p_driver_updates) LOOP
        v_is_reserved := COALESCE((v_driver_rec->>'is_reserved')::boolean, false);
        UPDATE driver_profiles SET
            is_reserved = v_is_reserved,
            status = CASE WHEN v_is_reserved THEN 'reserved' ELSE 'active' END,
            updated_at = NOW()
        WHERE uid = v_driver_rec->>'driver_uid';
        v_updated_drivers := array_append(v_updated_drivers, v_driver_rec->>'driver_uid');
    END LOOP;

    RETURN jsonb_build_object('success', true, 'updatedBuses', to_jsonb(v_updated_buses), 'updatedDrivers', to_jsonb(v_updated_drivers));
END;
$$;

CREATE OR REPLACE FUNCTION assign_routes_atomically(p_bus_updates JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bus_rec JSONB; v_current TEXT; v_updated_buses TEXT[] := '{}';
BEGIN
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        SELECT route_id INTO v_current FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
        END IF;
        IF v_current IS DISTINCT FROM v_bus_rec->>'prev_route_id' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Conflict: ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' is now on route "' || COALESCE(v_current, 'none') || '" (expected: "' || COALESCE(v_bus_rec->>'prev_route_id', 'none') || '")', 'status', 409);
        END IF;
    END LOOP;

    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        UPDATE buses SET route_id = v_bus_rec->>'new_route_id', route_name = v_bus_rec->>'new_route_name', updated_at = NOW()
        WHERE id = v_bus_rec->>'bus_id';
        v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
    END LOOP;

    RETURN jsonb_build_object('success', true, 'updatedBuses', to_jsonb(v_updated_buses));
END;
$$;
```


