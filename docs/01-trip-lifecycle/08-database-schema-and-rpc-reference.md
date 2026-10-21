# Trip Lifecycle Database Schema, Active Trip Locks & PL/pgSQL RPC Reference (Forensic Truth)

**Module:** Active Trips, Breadcrumbs, Three-Way Locks (`bus_id`, `driver_id`, `route_id`), Indexes & Triggers  
**File Authority:** `supabase/COMPLETE_SCHEMA.sql`, `supabase/migrations/`  
**Database Scope:** `active_trips`, `trip_history`, `stop_dwell_logs`, `student_waiting_flags`  

---

# PART 1: Database Schema, Tables, Constraints, Indexes & PL/pgSQL RPCs (The Persistence Spine)

### 1.1 Sub-Domain Architecture & Exact Execution Pipeline

The persistence spine of the ADTU ITMS Trip Lifecycle is implemented directly in PostgreSQL (Supabase). It enforces physical concurrency invariants, mutual exclusion of drivers and vehicles, authoritative dwell audit proof, and state lifecycle transitions.

#### Relational State Flow & Concurrency Pipeline
```
+---------------------------------------------------------------------------------------------------+
|                                      POSTGRESQL PERSISTENCE SPINE                                  |
+---------------------------------------------------------------------------------------------------+
                                                  |
           [ Driver Starts Trip ]                 |             [ Telemetry Tick / Dwell Check ]
                      |                           |                            |
                      v                           |                            v
         acquire_trip_lock(p_trip_id, ...)        |             stop_dwell_logs (Insert / Update)
                      |                           |                            |
       +--------------+--------------+            |             +--------------+--------------+
       | Check for active trip:      |            |             | arrived_at, departed_at,    |
       | bus_id & driver_id match?   |            |             | dwell_seconds, stop_id      |
       +--------------+--------------+            |             +-----------------------------+
              |               |                   |                            |
       YES (Resume)       NO (New)                |                            v
              |               |                   |             waiting_flags (Status Mutation)
              v               v                   |             - 'raised' -> 'acknowledged'
         Return JSON     Lock Bus FOR UPDATE      |             - 'acknowledged' -> 'boarded'
       alreadyActive:    Check: inactive?         |             - Partial Unique Indexes Enforce
            true              |                   |               At Most 1 Active Flag/Student
                              v                   |                            |
                         Delete Stale             |                            |
                         (Heartbeat > 600s)       |                            |
                              |                   |                            |
                              v                   |                            |
                        Atomic INSERT into        |                            |
                        public.active_trips       |                            |
                              |                   |                            |
                      [ Unique Violation? ]       |                            |
                     /                     \      |                            |
                    v                       v     |                            |
              Driver matches?         Locked by   |                            |
              Return resume           other driver|                            |
                                      LOCKED_BY_  |                            |
                                      OTHER       |                            |
                                                  |                            |
                                                  |                            |
             [ Driver Finishes Journey ]          |             [ Stale Lock Sweeper Cron ]
                      |                           |                            |
                      v                           |                            v
         end_trip_atomically(p_trip_id, ...)      |             cleanup_stale_locks(600)
                      |                           |                            |
             Row Lock: active_trips               |             FOR EACH active_trips WHERE
                 FOR UPDATE                       |             last_heartbeat < NOW() - 600s
                      |                           |                            |
             DELETE FROM active_trips             |             INSERT INTO driver_trip_history
                      |                           |             (status: completed,
             Calculate duration_seconds           |              ended_reason: completed_stale)
                      |                           |                            |
             INSERT INTO driver_trip_history      |             DELETE FROM active_trips
             (status: completed/terminated_early, |                            |
              ended_reason: completed/short_trip) |             RETURN (trip_id, bus_id, driver_id)
```

---

### 1.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Tables / Types | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `supabase/COMPLETE_SCHEMA.sql` | `public.active_trips`, `public.driver_trip_history`, `public.stop_dwell_logs`, `public.waiting_flags`, `public.device_sessions`, `public.buses`, `public.routes`, `public.system_settings`, `acquire_trip_lock`, `end_trip_atomically`, `release_trip_lock`, `cleanup_stale_locks`, `check_bus_lock`, `extend_trip_lock`, `acquire_fcm_lock`, `trg_active_trips_updated_at` | Supabase Client / Database Engine / Serverless RPC Callers (`TripLockService`, Cron) | PostgreSQL Native Engine | `active_trips`, `driver_trip_history`, `stop_dwell_logs`, `waiting_flags`, `device_sessions`, `buses`, `routes` |
| `supabase/migrations/20261017_unify_trip_locks_and_stop_dwell.sql` | `public.system_settings`, `public.stop_dwell_logs`, `cleanup_stale_locks(600)`, Guwahati Route Coordinates Seeding | Supabase Migration Runner | PostgreSQL Native Engine | `system_settings`, `stop_dwell_logs`, `routes` |
| `supabase/migrations/20261018_consolidated_production_hardening.sql` | `public.system_settings`, `public.stop_dwell_logs`, `cleanup_stale_locks(600)`, `bus_increment_capacity`, `bus_decrement_capacity` | Supabase Migration Runner | PostgreSQL Native Engine | `system_settings`, `stop_dwell_logs`, `buses` |
| `supabase/migrations/20261019_payment_ledger_and_renewal_hardening.sql` | `public.approve_renewal_with_seat` canonical RPC, `process_payment_refund_atomic`, `idx_payments_unique_offline_tx_id` | Supabase Migration Runner / Renewal Service | PostgreSQL Native Engine | `payments`, `bus_seats`, `students` |
| `supabase/migrations/20261012_remove_bus_locations_table.sql` | Removal of `public.bus_locations`, Updated `end_trip_atomically` RPC without references to `bus_locations` | Supabase Migration Runner | PostgreSQL Native Engine | Drops `public.bus_locations` |

---

### 1.3 Method-by-Method Low-Level Walkthrough

#### 1. `public.acquire_trip_lock(p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT, p_route_id TEXT, p_shift TEXT, p_ttl_seconds INTEGER DEFAULT 600)`
- **Signature & Language**: PL/pgSQL, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**:
  - `p_trip_id`: UUID formatted as string representing the generated trip ID.
  - `p_bus_id`: String identifying the bus (e.g. `'bus_01'`).
  - `p_driver_id`: String identifying the driver's Auth UID.
  - `p_route_id`: String identifying the route (e.g. `'route_1'`).
  - `p_shift`: Shift label (`'Morning'`, `'Evening'`, `'Special'`).
  - `p_ttl_seconds`: Integer lock validity window, defaults to 600 seconds.
- **Return Type**: `JSONB` with keys:
  - Success path: `{"success": true, "tripId": "...", "alreadyActive": false|true}`
  - Conflict path: `{"success": false, "error": "LOCKED_BY_OTHER", "activeDriverId": "..."}`
  - Validation error path: `{"success": false, "error": "Bus not found"|"Bus is inactive"}`
- **Exact Step-by-Step Execution**:
  1. Computes `v_now := NOW()` and `v_expires_at := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL`.
  2. Queries `active_trips` for an existing row matching both `bus_id = p_bus_id` AND `driver_id = p_driver_id` AND `status = 'active'`. If found, immediately returns `{"success": true, "tripId": v_existing.trip_id::text, "alreadyActive": true}` (idempotent resume).
  3. Executes `SELECT status INTO v_bus_status FROM buses WHERE id = p_bus_id FOR UPDATE;` to lock the bus record row-level against concurrent state changes (TOCTOU guard). If bus record is missing, returns `{"success": false, "error": "Bus not found"}`. If `v_bus_status = 'inactive'`, returns `{"success": false, "error": "Bus is inactive"}`.
  4. Deletes stale active trips older than 600 seconds:
     ```sql
     DELETE FROM active_trips
     WHERE status = 'active' AND (bus_id = p_bus_id OR driver_id = p_driver_id)
       AND last_heartbeat < v_now - INTERVAL '600 seconds';
     ```
  5. Attempts atomic insertion:
     ```sql
     INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at)
     VALUES (p_trip_id::uuid, p_bus_id, p_driver_id, p_route_id, p_shift, 'active', v_now, v_now, v_expires_at);
     ```
     Returns `{"success": true, "tripId": p_trip_id, "alreadyActive": false}`.
  6. **Exception Handling**: Traps `unique_violation`:
     - Checks if the existing active trip on `p_bus_id` belongs to the requesting driver (`v_existing.driver_id = p_driver_id`). If yes, returns `{"success": true, "tripId": v_existing.trip_id::text, "alreadyActive": true}`.
     - Otherwise, extracts active driver ID and returns `{"success": false, "error": "LOCKED_BY_OTHER", "activeDriverId": COALESCE(v_existing.driver_id, 'unknown')}`.

---

#### 2. `public.end_trip_atomically(p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT, p_min_duration_seconds INTEGER DEFAULT 0)`
- **Signature & Language**: PL/pgSQL, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**:
  - `p_trip_id`: UUID of the trip.
  - `p_bus_id`: ID of the vehicle.
  - `p_driver_id`: Auth UID of the operator.
  - `p_min_duration_seconds`: Integer threshold (e.g. 600) below which trips are flagged as short trips.
- **Return Type**: `JSONB` with keys:
  - If trip already gone: `{"success": true, "alreadyEnded": true}`
  - Normal finish: `{"success": true, "tripId": "...", "alreadyEnded": false, "status": "completed", "ended_reason": "completed"}`
  - Early termination: `{"success": true, "tripId": "...", "alreadyEnded": false, "status": "terminated_early", "ended_reason": "short_trip"}`
- **Exact Step-by-Step Execution**:
  1. Queries and locks `active_trips` row:
     ```sql
     SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
     INTO v_trip
     FROM active_trips
     WHERE trip_id = p_trip_id::uuid
       AND bus_id = p_bus_id
       AND driver_id = p_driver_id
       AND status = 'active'
     FOR UPDATE;
     ```
  2. If row `NOT FOUND`, returns `{"success": true, "alreadyEnded": true}`.
  3. Computes duration: `v_dur_sec := EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER;`.
  4. Deletes active lock: `DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;`.
  5. Short-trip evaluation: If `p_min_duration_seconds > 0 AND v_dur_sec < p_min_duration_seconds`, sets `v_status := 'terminated_early'` and `v_reason := 'short_trip'`.
  6. Inserts into historical ledger:
     ```sql
     INSERT INTO driver_trip_history (
       trip_id, bus_id, driver_id, route_id, shift,
       status, ended_reason, start_time, end_time, duration_seconds
     ) VALUES (
       v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
       v_status, v_reason, v_trip.start_time, v_now, v_dur_sec
     )
     ON CONFLICT (trip_id) DO NOTHING;
     ```
  7. Returns JSON status payload.

---

#### 3. `public.release_trip_lock(p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT)`
- **Signature & Language**: PL/pgSQL, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**: `p_trip_id`, `p_bus_id`, `p_driver_id`.
- **Return Type**: `JSONB` (`{"success": true, "released": boolean}`).
- **Execution**: Directly deletes from `active_trips` where `trip_id = p_trip_id::uuid AND bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active'`.
- **Forensic Status in Live Codebase**: This function is defined in `COMPLETE_SCHEMA.sql` line 1655. However, forensic inspection of all TypeScript source files confirms that **zero application code calls `release_trip_lock`**. All operational trip termination in the system routes exclusively through `end_trip_atomically` so that trip history is atomically guaranteed.

---

#### 4. `public.cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 600)`
- **Signature & Language**: PL/pgSQL, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**: `p_heartbeat_timeout_seconds INTEGER DEFAULT 600`.
- **Return Type**: `TABLE(cleaned_trip_id UUID, cleaned_bus_id TEXT, cleaned_driver_id TEXT)`.
- **Execution**:
  1. Loops through all `active_trips` where `status = 'active'` and `last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL`.
  2. For each stale trip, inserts into `public.driver_trip_history` with `status = 'completed'`, `ended_reason = 'completed_stale'`, `end_time = NOW()`, and `duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_trip.start_time))::INTEGER)` with `ON CONFLICT (trip_id) DO NOTHING`.
  3. Deletes the row from `public.active_trips`.
  4. Returns each cleaned trip record (`cleaned_trip_id`, `cleaned_bus_id`, `cleaned_driver_id`) via `RETURN QUERY`.

---

#### 5. `public.check_bus_lock(p_bus_id TEXT)`
- **Signature & Language**: PL/pgSQL, `STABLE`, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**: `p_bus_id TEXT`.
- **Return Type**: `JSONB`.
- **Execution**: Selects `trip_id, driver_id, shift, status, start_time, last_heartbeat, expires_at, fcm_start_sent, fcm_end_sent` from `active_trips` where `bus_id = p_bus_id AND status = 'active' LIMIT 1`. Returns `{"active": false}` if not found, or full trip metadata object if active.

---

#### 6. `public.extend_trip_lock(p_trip_id TEXT, p_driver_id TEXT, p_bus_id TEXT, p_ttl_seconds INTEGER DEFAULT 600)`
- **Signature & Language**: PL/pgSQL, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**: `p_trip_id TEXT, p_driver_id TEXT, p_bus_id TEXT, p_ttl_seconds INTEGER DEFAULT 600`.
- **Return Type**: `JSONB`.
- **Execution**: Updates `last_heartbeat = NOW()` and `expires_at = NOW() + INTERVAL '...'` on `active_trips` matching all three identifiers. Returns `{"success": true}` if 1 row updated, else `{"success": false, "error": "Active trip not found"}`.

---

#### 7. `public.acquire_fcm_lock(p_trip_id TEXT, p_bus_id TEXT, p_lock_type TEXT)`
- **Signature & Language**: PL/pgSQL, `SECURITY DEFINER`, `SET search_path = public`.
- **Parameters**: `p_trip_id TEXT, p_bus_id TEXT, p_lock_type TEXT` (`'start'` or `'end'`).
- **Return Type**: `JSONB` (`{"success": true, "acquired": boolean}`).
- **Execution**: Atomically updates `fcm_start_sent = true` (or `fcm_end_sent = true`) on `active_trips` where the target column is currently `false`. Uses `GET DIAGNOSTICS v_updated = ROW_COUNT` to grant exactly one caller acquisition rights (`acquired: true`).

---

### 1.4 Exact I/O, Database Query & Redis Command Count Matrix

The operations in Part 1 represent the PostgreSQL database substrate. The mathematical I/O cost per invocation of these database routines is:

| Flow / Routine | Cold Cache Scenario | Warm Cache Scenario | PostgreSQL Connection / Pool Failure |
| :--- | :--- | :--- | :--- |
| **`acquire_trip_lock` (New Trip)** | • 1 PK/Unique Index Lookup (`active_trips`)<br>• 1 Row-Lock SELECT (`buses FOR UPDATE`)<br>• 1 Stale Deletion Query (`active_trips`)<br>• 1 Atomic INSERT (`active_trips`)<br>**Total: 4 DB Operations** | • Same (enforced in single ACID transaction):<br>**Total: 4 DB Operations** | • Transaction rollback<br>• Client receives HTTP 500 / PG connection error |
| **`acquire_trip_lock` (Idempotent Resume)** | • 1 PK/Unique Index Lookup (`active_trips`)<br>**Total: 1 DB Operation** | • 1 PK/Unique Index Lookup (`active_trips`)<br>**Total: 1 DB Operation** | • Transaction rollback |
| **`end_trip_atomically`** | • 1 Row-Lock SELECT (`active_trips FOR UPDATE`)<br>• 1 DELETE (`active_trips`)<br>• 1 INSERT (`driver_trip_history`)<br>**Total: 3 DB Operations** | • Same: 3 DB Operations within 1 transaction | • Transaction rollback; trip remains active in PostgreSQL |
| **`cleanup_stale_locks` (Per stale trip)** | • 1 Cursor Scan (`active_trips` index on status)<br>• 1 INSERT (`driver_trip_history`) per row<br>• 1 DELETE (`active_trips`) per row<br>**Total: 1 + 2*N DB Operations** | • Same: 1 + 2*N DB Operations | • Error logged by caller, locks remain intact |

*Redis Commands Executed in Part 1:* **0** (Part 1 covers the pure PostgreSQL engine and schema definitions).  
*WebSocket Frames Emitted in Part 1:* **0** (Emissions occur at application layer).

---

### 1.5 Verbatim Source Code from Live Codebase

#### 1. DDL: `public.active_trips`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 461–474)*
```sql
CREATE TABLE IF NOT EXISTS public.active_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE,
  bus_id TEXT NOT NULL UNIQUE,
  driver_id TEXT NOT NULL UNIQUE,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status = 'active'),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 2. DDL: `public.driver_trip_history`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 497–514)*
```sql
CREATE TABLE IF NOT EXISTS public.driver_trip_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE,
  bus_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL,
  status TEXT NOT NULL CONSTRAINT driver_trip_history_status_check CHECK (status = ANY (ARRAY['completed'::text, 'cancelled'::text, 'terminated_early'::text])),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,
  distance_km DOUBLE PRECISION,
  average_speed_kmh DOUBLE PRECISION,
  max_speed_kmh DOUBLE PRECISION,
  stop_events JSONB DEFAULT '[]',
  ended_reason TEXT DEFAULT 'completed' CONSTRAINT driver_trip_history_ended_reason_check CHECK (ended_reason = ANY (ARRAY['completed'::text, 'completed_stale'::text, 'cancelled'::text, 'force_ended'::text, 'short_trip'::text])),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 3. DDL: `public.stop_dwell_logs`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 624–641) & `supabase/migrations/20261017_unify_trip_locks_and_stop_dwell.sql` (Lines 44–76)*
```sql
CREATE TABLE IF NOT EXISTS public.stop_dwell_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id       TEXT NOT NULL,
    bus_id        TEXT NOT NULL,
    driver_id     TEXT NOT NULL,
    route_id      TEXT NOT NULL,
    stop_id       TEXT NOT NULL,
    stop_name     TEXT NOT NULL,
    arrived_at    TIMESTAMPTZ NOT NULL,
    departed_at   TIMESTAMPTZ,
    dwell_seconds INTEGER NOT NULL DEFAULT 0 CHECK (dwell_seconds >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_trip_id ON public.stop_dwell_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_bus_time ON public.stop_dwell_logs(bus_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_route_stop ON public.stop_dwell_logs(route_id, stop_name);

ALTER TABLE public.stop_dwell_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read stop_dwell_logs" ON public.stop_dwell_logs;
CREATE POLICY "Public read stop_dwell_logs"
    ON public.stop_dwell_logs FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role manage stop_dwell_logs" ON public.stop_dwell_logs;
CREATE POLICY "Service role manage stop_dwell_logs"
    ON public.stop_dwell_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
```

#### 4. DDL: `public.waiting_flags`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 480–495, 948–954, 3075–3096)*
```sql
CREATE TABLE IF NOT EXISTS waiting_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uid TEXT NOT NULL,
  student_name TEXT NOT NULL,
  bus_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  stop_name TEXT,
  stop_lat DOUBLE PRECISION,
  stop_lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'raised' CHECK (status IN ('raised', 'acknowledged', 'waiting', 'boarded', 'expired', 'cancelled', 'removed')),
  message TEXT,
  trip_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  ack_by_driver_uid TEXT
);

CREATE INDEX IF NOT EXISTS idx_waiting_flags_student_uid ON waiting_flags(student_uid);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_bus_id ON waiting_flags(bus_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_route_id ON waiting_flags(route_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_status ON waiting_flags(status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_trip ON waiting_flags(trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_flags_one_active ON waiting_flags(student_uid, bus_id) WHERE status IN ('raised', 'acknowledged', 'waiting');
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_flags_one_active_student ON waiting_flags(student_uid) WHERE status IN ('raised', 'acknowledged', 'waiting');

ALTER TABLE public.waiting_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waiting_flags_select_anon" ON public.waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_select_authenticated" ON public.waiting_flags;
CREATE POLICY "waiting_flags_select_authenticated" ON public.waiting_flags FOR SELECT TO authenticated
USING (student_uid = auth.uid()::text OR EXISTS (
  SELECT 1 FROM active_trips WHERE active_trips.driver_id = auth.uid()::text AND active_trips.bus_id = waiting_flags.bus_id AND active_trips.status = 'active'
) OR public.user_has_role(auth.uid()::text, 'admin') OR public.user_has_role(auth.uid()::text, 'moderator'));

DROP POLICY IF EXISTS "Students can create their own waiting flags" ON public.waiting_flags;
CREATE POLICY "Students can create their own waiting flags" ON public.waiting_flags FOR INSERT TO authenticated
WITH CHECK (student_uid = auth.uid()::text);

DROP POLICY IF EXISTS "waiting_flags_update_authenticated" ON public.waiting_flags;
CREATE POLICY "waiting_flags_update_authenticated" ON public.waiting_flags FOR UPDATE TO authenticated
USING (student_uid = auth.uid()::text OR EXISTS (
  SELECT 1 FROM active_trips WHERE active_trips.driver_id = auth.uid()::text AND active_trips.bus_id = waiting_flags.bus_id AND active_trips.status = 'active'
));

DROP POLICY IF EXISTS "waiting_flags_delete_authenticated" ON public.waiting_flags;
CREATE POLICY "waiting_flags_delete_authenticated" ON public.waiting_flags FOR DELETE TO authenticated
USING (student_uid = auth.uid()::text OR EXISTS (
  SELECT 1 FROM active_trips WHERE active_trips.driver_id = auth.uid()::text AND active_trips.bus_id = waiting_flags.bus_id AND active_trips.status = 'active'
));
```

#### 5. DDL: `public.device_sessions`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 553–567, 960–962, 3120–3135)*
```sql
CREATE TABLE IF NOT EXISTS public.device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  app_version TEXT,
  CONSTRAINT unique_user_feature UNIQUE(user_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id ON device_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_feature ON device_sessions(user_id, feature);
CREATE INDEX IF NOT EXISTS idx_device_sessions_expires_at ON device_sessions(expires_at);

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_sessions_select_own" ON public.device_sessions;
CREATE POLICY "device_sessions_select_own" ON public.device_sessions FOR SELECT TO authenticated
USING (user_id = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "device_sessions_insert_own" ON public.device_sessions;
CREATE POLICY "device_sessions_insert_own" ON public.device_sessions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "device_sessions_update_own" ON public.device_sessions;
CREATE POLICY "device_sessions_update_own" ON public.device_sessions FOR UPDATE TO authenticated
USING (user_id = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "device_sessions_delete_own" ON public.device_sessions;
CREATE POLICY "device_sessions_delete_own" ON public.device_sessions FOR DELETE TO authenticated
USING (user_id = auth.uid()::text OR auth.role() = 'service_role');
```

#### 6. DDL: `public.buses`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 173–189, 906, 3033–3035)*
```sql
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

CREATE INDEX IF NOT EXISTS idx_buses_route_id ON buses(route_id);

ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "buses_select" ON public.buses;
CREATE POLICY "buses_select" ON public.buses FOR SELECT TO authenticated USING (true);
```

#### 7. DDL: `public.routes`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 205–212, 3040–3042)*
```sql
CREATE TABLE IF NOT EXISTS routes (
    id          TEXT PRIMARY KEY,
    route_name  TEXT NOT NULL UNIQUE,
    stops       JSONB NOT NULL DEFAULT '[]',
    buses       JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "routes_select" ON public.routes;
CREATE POLICY "routes_select" ON public.routes FOR SELECT TO authenticated USING (true);
```

#### 8. Verbatim PL/pgSQL Function: `acquire_trip_lock`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 1602–1639)*
```sql
CREATE OR REPLACE FUNCTION public.acquire_trip_lock(
    p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT, p_route_id TEXT, p_shift TEXT, p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_existing RECORD;
    v_bus_status TEXT;
BEGIN
    SELECT trip_id INTO v_existing FROM active_trips
    WHERE bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';
    IF FOUND THEN RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id::text, 'alreadyActive', true); END IF;

    -- Authority for bus validity (mirrors tripStartPreflight): the bus must
    -- exist and not be inactive. Locked FOR UPDATE so a deactivation racing
    -- the start cannot slip between preflight and insert (TOCTOU).
    SELECT status INTO v_bus_status FROM buses WHERE id = p_bus_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Bus not found'); END IF;
    IF v_bus_status = 'inactive' THEN RETURN jsonb_build_object('success', false, 'error', 'Bus is inactive'); END IF;

    DELETE FROM active_trips
    WHERE status = 'active' AND (bus_id = p_bus_id OR driver_id = p_driver_id)
      AND last_heartbeat < v_now - INTERVAL '600 seconds';

    BEGIN
        INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at)
        VALUES (p_trip_id::uuid, p_bus_id, p_driver_id, p_route_id, p_shift, 'active', v_now, v_now, v_expires_at);
        RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyActive', false);
    EXCEPTION WHEN unique_violation THEN
        SELECT trip_id, driver_id INTO v_existing FROM active_trips WHERE bus_id = p_bus_id AND status = 'active' LIMIT 1;
        IF FOUND AND v_existing.driver_id = p_driver_id THEN
            RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id::text, 'alreadyActive', true);
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'LOCKED_BY_OTHER', 'activeDriverId', COALESCE(v_existing.driver_id, 'unknown'));
    END;
END;
$$;
```

#### 9. Verbatim PL/pgSQL Function: `end_trip_atomically`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 1823–1878) & `supabase/migrations/20261012_remove_bus_locations_table.sql` (Lines 35–90)*
```sql
DROP FUNCTION IF EXISTS public.end_trip_atomically(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
  p_trip_id TEXT,
  p_bus_id  TEXT,
  p_driver_id TEXT,
  p_min_duration_seconds INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_dur_sec INTEGER;
  v_status  TEXT := 'completed';
  v_reason  TEXT := 'completed';
BEGIN
  SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
    INTO v_trip
    FROM active_trips
   WHERE trip_id    = p_trip_id::uuid
     AND bus_id     = p_bus_id
     AND driver_id  = p_driver_id
     AND status     = 'active'
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'alreadyEnded', true);
  END IF;

  v_dur_sec := EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER;

  -- Remove the active lock atomically within the single transaction
  DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;

  -- Represent short trips as terminated_early / short_trip rather than deleting historical fact
  IF p_min_duration_seconds > 0 AND v_dur_sec < p_min_duration_seconds THEN
    v_status := 'terminated_early';
    v_reason := 'short_trip';
  END IF;

  INSERT INTO driver_trip_history (
    trip_id, bus_id, driver_id, route_id, shift,
    status, ended_reason, start_time, end_time, duration_seconds
  ) VALUES (
    v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
    v_status, v_reason, v_trip.start_time, v_now, v_dur_sec
  )
  ON CONFLICT (trip_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'tripId', p_trip_id,
    'alreadyEnded', false,
    'status', v_status,
    'ended_reason', v_reason
  );
END;
$$;
```

#### 10. Verbatim PL/pgSQL Function: `release_trip_lock`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 1655–1665)*
```sql
CREATE OR REPLACE FUNCTION public.release_trip_lock(p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_updated INTEGER;
BEGIN
    -- DELETE (not status='ended'): active_trips has CHECK (status IN ('active')).
    DELETE FROM active_trips
    WHERE trip_id = p_trip_id::uuid AND bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'released', v_updated > 0);
END;
$$;
```

#### 11. Verbatim PL/pgSQL Function: `cleanup_stale_locks`
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 1788–1814) & `supabase/migrations/20261018_consolidated_production_hardening.sql` (Lines 86–116)*
```sql
CREATE OR REPLACE FUNCTION public.cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 600)
RETURNS TABLE(
  cleaned_trip_id UUID,
  cleaned_bus_id TEXT,
  cleaned_driver_id TEXT
) AS $$
DECLARE
  v_trip RECORD;
BEGIN
  FOR v_trip IN
    SELECT at.trip_id, at.bus_id, at.driver_id, at.route_id, at.shift, at.start_time
    FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL
  LOOP
    INSERT INTO public.driver_trip_history (
      trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
    ) VALUES (
      v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
      'completed', 'completed_stale', v_trip.start_time, NOW(),
      GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_trip.start_time))::INTEGER)
    )
    ON CONFLICT (trip_id) DO NOTHING;

    DELETE FROM public.active_trips
    WHERE active_trips.trip_id = v_trip.trip_id;
    
    RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

#### 12. Helper Functions & Triggers
*Source: `supabase/COMPLETE_SCHEMA.sql` (Lines 32–38, 663–678, 1588–1600, 1641–1653, 1667–1699)*
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger assignment
CREATE TRIGGER trg_active_trips_updated_at BEFORE UPDATE ON public.active_trips FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.check_bus_lock(p_bus_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trip RECORD;
BEGIN
    SELECT trip_id, driver_id, shift, status, start_time, last_heartbeat, expires_at,
           fcm_start_sent, fcm_end_sent INTO v_trip
    FROM active_trips WHERE bus_id = p_bus_id AND status = 'active' LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
    RETURN jsonb_build_object('active', true, 'tripId', v_trip.trip_id, 'driverId', v_trip.driver_id,
        'shift', v_trip.shift, 'startTime', v_trip.start_time, 'lastHeartbeat', v_trip.last_heartbeat,
        'expiresAt', v_trip.expires_at, 'fcmStartSent', v_trip.fcm_start_sent, 'fcmEndSent', v_trip.fcm_end_sent);
END;
$$;

CREATE OR REPLACE FUNCTION public.extend_trip_lock(
    p_trip_id TEXT, p_driver_id TEXT, p_bus_id TEXT, p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL; v_updated INTEGER;
BEGIN
    UPDATE active_trips SET last_heartbeat = NOW(), expires_at = v_expires_at
    WHERE trip_id = p_trip_id::uuid AND driver_id = p_driver_id AND bus_id = p_bus_id AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN jsonb_build_object('success', true);
    ELSE RETURN jsonb_build_object('success', false, 'error', 'Active trip not found'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_fcm_lock(p_trip_id TEXT, p_bus_id TEXT, p_lock_type TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE 
    v_column TEXT; 
    v_updated INTEGER := 0;
    v_trip_uuid UUID;
BEGIN
    IF p_lock_type = 'start' THEN v_column := 'fcm_start_sent';
    ELSIF p_lock_type = 'end' THEN v_column := 'fcm_end_sent';
    ELSE RETURN jsonb_build_object('success', false, 'error', 'Invalid lock_type'); END IF;

    BEGIN
        v_trip_uuid := p_trip_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', true, 'acquired', true);
    END;

    IF v_column = 'fcm_start_sent' THEN
        UPDATE active_trips SET fcm_start_sent = true
        WHERE trip_id = v_trip_uuid AND bus_id = p_bus_id AND fcm_start_sent = false;
    ELSE
        UPDATE active_trips SET fcm_end_sent = true
        WHERE trip_id = v_trip_uuid AND bus_id = p_bus_id AND fcm_end_sent = false;
    END IF;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated >= 1 THEN 
        RETURN jsonb_build_object('success', true, 'acquired', true);
    ELSE 
        RETURN jsonb_build_object('success', true, 'acquired', false);
    END IF;
END;
$$;
```


---

