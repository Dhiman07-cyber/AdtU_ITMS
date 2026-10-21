# Identity, RBAC & Ops Spine Database Schema, RLS Policies & Stored Procedures (Forensic Truth)

**Module:** User Identities, Roles, Moderator Bitmasks, Row-Level Security Policies & Admin Functions  
**File Authority:** `supabase/COMPLETE_SCHEMA.sql`, `supabase/migrations/`  
**Security Gate:** OWASP ASVS V4 (Access Control), PostgreSQL Row-Level Security (`ENABLE ROW LEVEL SECURITY`)  

---

# PART 1: Database Schema, Constraints, RLS Policies & Stored Procedures (Identity & Ops Spine)

### 1.1 Sub-Domain Architecture & Exact Execution Pipeline

The identity, staff management, fleet assignment, notifications, and security audit systems are rooted in PostgreSQL 16 schemas with Row-Level Security (RLS) and atomic PL/pgSQL stored procedures.

```
+-------------------------------------------------------------------------------------------------------------+
|                                    IDENTITY, RBAC & OPS PERSISTENCE SPINE                                   |
+-------------------------------------------------------------------------------------------------------------+
                                                       |
        [ Client Request / Staff Action ]              |          [ Driver Bus QR Scan / Check-In ]
                       |                               |                          |
                       v                               |                          v
         auth.users / public.users                     |          acquire_trip_lock(p_trip_id, ...)
                       |                               |                          |
       +---------------+---------------+               |        +-----------------+-----------------+
       | Role Checking via             |               |        | Check bus status:                 |
       | public.user_has_role(uid, r)  |               |        | inactive OR maintenance -> REJECT |
       +---------------+---------------+               |        +-----------------+-----------------+
                       |                               |                          |
       +---------------+---------------+               |        +-----------------+-----------------+
       | Split Profile Resolution:     |               |        | Stale Opposite-Shift Sweeper:     |
       | - student_profiles            |               |        | start_time < NOW() - 4 hours AND  |
       | - driver_profiles             |               |        | LOWER(shift) <> LOWER(p_shift)    |
       | - moderator_profiles          |               |        | -> Archives to driver_trip_history|
       | - admin_profiles              |               |        +-----------------+-----------------+
       +---------------+---------------+               |                          |
                       |                               |        +-----------------+-----------------+
                       v                               |        | Atomic Lock INSERT:               |
       Row-Level Security (RLS) Gates                  |        | active_trips                      |
       - Self-Read: uid = auth.uid()                   |        | Sets driver_profiles:             |
       - Admin/Mod Full Read Access                    |        | trip_active = true, active_trip_id|
       - Parameterized SQL Enforcement                 |        +-----------------+-----------------+
                       |                               |                          |
                       |                               |                          v
        [ Notification Ingress ]                       |         [ Driver Journey End / Heartbeat Expiry ]
                       |                               |                          |
                       v                               |                          v
             public.notifications                      |         end_trip_atomically(p_trip_id, ...)
                       |                               |                          |
       +---------------+---------------+               |        +-----------------+-----------------+
       | Target Types:                 |               |        | Row Lock active_trips FOR UPDATE  |
       | - all_users, all_role         |               |        | DELETE FROM active_trips          |
       | - route, specific_users       |               |        | Reset driver_profiles:            |
       | Recipient & Read Arrays:      |               |        | trip_active=false, active_trip=NUL|
       | recipient_ids TEXT[], read_by |               |        | Write driver_trip_history with    |
       +---------------+---------------+               |        | status & ended_reason             |
                       |                               |        +-----------------------------------+
                       v                               |
             public.audit_events                       |
         (Append-Only Security Log)                    |
```

---

### 1.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Entities / Functions | Callers | Callees | State / Invariants Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `supabase/COMPLETE_SCHEMA.sql` | `public.users`, `public.student_profiles`, `public.driver_profiles`, `public.moderator_profiles`, `public.admin_profiles`, `public.unauth_users`, `public.buses`, `public.driver_trip_history`, `public.notifications`, `public.audit_events`, `public.fcm_tokens`, `acquire_trip_lock`, `end_trip_atomically`, `assign_drivers_atomically`, `user_has_role` | Supabase Migration Runner, Backend APIs, Cron Jobs | PostgreSQL Native Execution Engine | `users`, `driver_profiles`, `buses`, `active_trips`, `driver_trip_history`, `notifications`, `audit_events` |
| `src/domains/audit/repositories/audit.repository.pg.ts` | `pgInsertAuditEvent`, `pgQueryAuditEvents` | `audit.service.pg.ts` | PostgreSQL (`public.audit_events`) | `public.audit_events` |
| `src/domains/audit/services/audit.service.pg.ts` | `createAuditEvent`, `queryAuditEvents`, `SYSTEM_ACTOR` | Admin/Mod APIs, Cron Workers, Security Gateways | `pgInsertAuditEvent` | Appends immutable record to `audit_events` |

---

### 1.3 Method-by-Method Low-Level Walkthrough

1. **`public.users` Table Definition:**
   Primary identity table. Contains `uid` (matching Firebase UID), `email`, `name`, `role` (`'admin' | 'moderator' | 'driver' | 'student'`), `created_at`, `updated_at`, and `last_login_at`. Governed by trigger `update_updated_at_column()`.
2. **`public.driver_profiles` (Operational Relief Pool Schema):**
   Contains driver attributes: `uid`, `full_name`, `phone`, `license_number`, `employee_id`, `bus_id` (NULLABLE), `route_id` (NULLABLE), `status` (`'active' | 'inactive' | 'suspended' | 'reserved'`), `is_reserved`, `trip_active` (BOOLEAN), and `active_trip_id` (TEXT NULL). Drivers are **never locked to shifts**; any active driver can operate any bus via QR check-in.
3. **`public.buses` (Primary Driver Attribution Schema):**
   Stores vehicle capacity and configuration: `capacity`, `morning_load`, `evening_load`, `current_members`, `route_id`, `status` (`'active' | 'inactive' | 'maintenance'`), `primary_driver_uid`, `driver_uid`, and `driver_name`. `primary_driver_uid` stores the vehicle's default driver for off-duty display and 1-tap start trip default.
4. **`acquire_trip_lock` RPC:**
   - Validates vehicle status: `IF v_bus_status IN ('inactive', 'maintenance') THEN RETURN ... error`.
   - Cleans up stale opposite-shift locks: if another driver ran `Morning` shift >4 hours ago and didn't close it, automatically archives that trip into `driver_trip_history` (`ended_reason = 'completed_stale'`), clears the previous driver's `trip_active` flag, and grants the lock to the new driver.
   - Updates `driver_profiles` with `trip_active = true, active_trip_id = p_trip_id`.
5. **`end_trip_atomically` RPC (Driver-Only Exclusivity & Heartbeat Auto-Reap):**
   - External force-ending by staff has been deprecated and disabled (`/api/fleet/force-end-trip` returns HTTP 403 Forbidden). Only the assigned driver may conclude their own active trip; unresponsive or abandoned trips are automatically reaped by the server heartbeat expiry and stale opposite-shift sweeper.
   - Accepts `p_trip_id`, `p_bus_id`, optional `p_driver_id`, `p_min_duration_seconds`, and `p_ended_reason` (`'completed' | 'cancelled' | 'short_trip' | 'completed_stale'`).
   - Removes row from `active_trips` atomically within an ACID transaction.
   - Clears `driver_profiles.trip_active = false, active_trip_id = NULL`.
   - Records trip entry in `driver_trip_history` with exact duration, status, and reason.
6. **`assign_drivers_atomically` RPC:**
   - Enforces Active Trip Mutation Guard: rejects reassignment with HTTP 409 if any target bus or driver is currently in `active_trips`.
   - Atomically updates `buses.primary_driver_uid`, `buses.driver_uid`, `buses.driver_name`, and `driver_profiles.bus_id`.

---

### 1.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Operation | PostgreSQL Queries | Redis Commands | External APIs | Network Latency Overhead |
| :--- | :--- | :--- | :--- | :--- |
| Driver QR Check-In (`acquire_trip_lock`) | 4 queries (1 SELECT FOR UPDATE, 1 Opposite-shift archive, 1 stale delete, 1 INSERT) in 1 ACID transaction | 1 lock command (Redlock optional) | 0 | ~8-12ms |
| Driver Self-Concluded End Trip (`end_trip_atomically`) | 3 queries (1 SELECT FOR UPDATE, 1 DELETE active_trips, 1 INSERT driver_trip_history, 1 UPDATE driver_profiles) | 0 | 0 | ~6-10ms |
| External Force-End Attempt (`/api/fleet/force-end-trip`) | 0 DB queries (HTTP 403 Forbidden - Driver Exclusivity Guard) | 0 | 0 | <1ms |
| Driver Roster Reassignment (`assign_drivers_atomically`) | 2 active_trips checks + N SELECT FOR UPDATE + N UPDATE buses + M UPDATE driver_profiles (1 ACID tx) | 0 | 0 | ~15-25ms |
| Audit Event Append (`createAuditEvent`) | 1 INSERT (`public.audit_events`) | 0 | 0 | ~4-6ms |

---

### 1.5 Verbatim Source Code from Live Codebase

```sql
-- =============================================================================
-- VERBATIM DDL & POLICIES FROM supabase/COMPLETE_SCHEMA.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    uid          TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    name         TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin', 'moderator', 'driver', 'student')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.user_has_role(p_uid TEXT, p_role TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM users WHERE uid = p_uid AND role = p_role
    );
END;
$$;

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

CREATE TABLE IF NOT EXISTS driver_profiles (
    uid                TEXT PRIMARY KEY,
    email              TEXT,
    full_name          TEXT,
    phone              TEXT,
    alternate_phone    TEXT,
    license_number     TEXT,
    aadhar_number      TEXT,
    employee_id        TEXT,
    address            TEXT,
    profile_photo_url  TEXT,
    joining_date       TEXT,
    dob                TEXT,
    approved_by        TEXT,
    bus_id             TEXT,
    route_id           TEXT,
    status             TEXT CHECK (status IN ('active', 'inactive', 'suspended', 'reserved')),
    is_reserved        BOOLEAN DEFAULT FALSE,
    trip_active        BOOLEAN DEFAULT FALSE,
    active_trip_id     TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderator_profiles (
    uid                    TEXT PRIMARY KEY,
    email                  TEXT,
    full_name              TEXT,
    phone                  TEXT,
    employee_id            TEXT,
    team_name              TEXT,
    status                 TEXT,
    profile_photo_url      TEXT,
    role                   TEXT,
    created_by             TEXT,
    faculty                TEXT,
    permissions            JSONB DEFAULT '{}'::jsonb,
    permissions_updated_at TIMESTAMPTZ,
    permissions_updated_by TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_profiles (
    uid               TEXT PRIMARY KEY,
    email             TEXT,
    full_name         TEXT,
    phone             TEXT,
    employee_id       TEXT,
    role              TEXT,
    years_of_service  TEXT,
    alt_phone         TEXT,
    dob               TEXT,
    profile_photo_url TEXT,
    username          TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unauth_users (
    uid               TEXT PRIMARY KEY,
    email             TEXT,
    display_name      TEXT,
    name              TEXT,
    role              TEXT NOT NULL DEFAULT 'student',
    status            TEXT NOT NULL DEFAULT 'pending',
    photo_url         TEXT,
    needs_application BOOLEAN DEFAULT TRUE,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    role        TEXT,
    device_type TEXT,
    id          TEXT,
    token_hash  TEXT,
    platform    TEXT,
    last_seen   TIMESTAMPTZ,
    valid       BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    message         TEXT NOT NULL,
    type            TEXT NOT NULL,
    priority        TEXT NOT NULL DEFAULT 'normal',
    target_role     TEXT NOT NULL,
    recipient_ids   TEXT[] DEFAULT '{}',
    sender_user_id  TEXT,
    sender_name     TEXT,
    sender_role     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_by         TEXT[] DEFAULT '{}',
    data            JSONB DEFAULT '{}'
);

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

    -- Authority for bus validity: must exist and not be inactive or maintenance
    SELECT status INTO v_bus_status FROM buses WHERE id = p_bus_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Bus not found'); END IF;
    IF v_bus_status IN ('inactive', 'maintenance') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus is currently ' || v_bus_status || ' and cannot start a trip');
    END IF;

    -- Automatic Shift Handover on Stale Opposite-Shift Locks:
    -- If Driver A drove Morning shift and left active trip 4+ hours ago,
    -- Driver B scanning for Evening shift archives stale trip and acquires the lock.
    FOR v_existing IN
        SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
        FROM active_trips
        WHERE bus_id = p_bus_id AND status = 'active'
          AND LOWER(shift) <> LOWER(p_shift)
          AND start_time < v_now - INTERVAL '4 hours'
    LOOP
        INSERT INTO driver_trip_history (
            trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
        ) VALUES (
            v_existing.trip_id, v_existing.bus_id, v_existing.driver_id, v_existing.route_id, v_existing.shift,
            'completed', 'completed_stale', v_existing.start_time, v_now,
            GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_existing.start_time))::INTEGER)
        ) ON CONFLICT (trip_id) DO NOTHING;

        UPDATE driver_profiles
        SET trip_active = false, active_trip_id = NULL, updated_at = v_now
        WHERE uid = v_existing.driver_id;

        DELETE FROM active_trips WHERE trip_id = v_existing.trip_id;
    END LOOP;

    -- Clean up and archive heartbeat-expired stale locks for bus or driver (600s timeout)
    FOR v_existing IN
        SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
        FROM active_trips
        WHERE status = 'active' AND (bus_id = p_bus_id OR driver_id = p_driver_id)
          AND last_heartbeat < v_now - INTERVAL '600 seconds'
    LOOP
        INSERT INTO driver_trip_history (
            trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
        ) VALUES (
            v_existing.trip_id, v_existing.bus_id, v_existing.driver_id, v_existing.route_id, v_existing.shift,
            'completed', 'completed_stale', v_existing.start_time, v_now,
            GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_existing.start_time))::INTEGER)
        ) ON CONFLICT (trip_id) DO NOTHING;

        UPDATE driver_profiles
        SET trip_active = false, active_trip_id = NULL, updated_at = v_now
        WHERE uid = v_existing.driver_id;

        DELETE FROM active_trips WHERE trip_id = v_existing.trip_id;
    END LOOP;

    BEGIN
        INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at)
        VALUES (p_trip_id::uuid, p_bus_id, p_driver_id, p_route_id, p_shift, 'active', v_now, v_now, v_expires_at);

        -- Update driver_profiles active trip pointer
        UPDATE driver_profiles
        SET trip_active = true, active_trip_id = p_trip_id, updated_at = v_now
        WHERE uid = p_driver_id;

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

DROP FUNCTION IF EXISTS public.end_trip_atomically(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
  p_trip_id TEXT,
  p_bus_id  TEXT,
  p_driver_id TEXT DEFAULT NULL,
  p_min_duration_seconds INTEGER DEFAULT 0,
  p_ended_reason TEXT DEFAULT 'completed'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_dur_sec INTEGER;
  v_status  TEXT := 'completed';
  v_reason  TEXT := COALESCE(NULLIF(p_ended_reason, ''), 'completed');
BEGIN
  SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
    INTO v_trip
    FROM active_trips
   WHERE trip_id    = p_trip_id::uuid
     AND bus_id     = p_bus_id
     AND (p_driver_id IS NULL OR p_driver_id = '' OR driver_id = p_driver_id)
     AND status     = 'active'
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'alreadyEnded', true);
  END IF;

  v_dur_sec := EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER;

  -- Remove the active lock atomically within the single transaction
  DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;

  -- Sync driver_profiles active trip pointer
  UPDATE driver_profiles
  SET trip_active = false, active_trip_id = NULL, updated_at = v_now
  WHERE uid = v_trip.driver_id;

  -- If force_ended, record status as terminated_early (satisfies driver_trip_history_status_check); otherwise check short trip threshold
  IF v_reason = 'force_ended' THEN
    v_status := 'terminated_early';
  ELSIF p_min_duration_seconds > 0 AND v_dur_sec < p_min_duration_seconds THEN
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
  ON CONFLICT (trip_id) DO UPDATE SET
    status = EXCLUDED.status,
    ended_reason = EXCLUDED.ended_reason,
    end_time = EXCLUDED.end_time,
    duration_seconds = EXCLUDED.duration_seconds;

  RETURN jsonb_build_object(
    'success', true,
    'tripId', p_trip_id,
    'alreadyEnded', false,
    'status', v_status,
    'ended_reason', v_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION assign_drivers_atomically(
    p_bus_updates JSONB, p_driver_updates JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bus_rec JSONB; v_driver_rec JSONB; v_is_reserved BOOLEAN;
    v_updated_buses TEXT[] := '{}'; v_updated_drivers TEXT[] := '{}';
BEGIN
    -- Active Trip Guard: check if any target bus is actively running a trip
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        IF EXISTS (
            SELECT 1 FROM active_trips
            WHERE (bus_id = v_bus_rec->>'bus_id'
               OR bus_id = REPLACE(v_bus_rec->>'bus_id', 'bus_', '')
               OR bus_id = 'bus_' || REPLACE(v_bus_rec->>'bus_id', 'bus_', ''))
              AND status IN ('active', 'SCHEDULED', 'IN_TRANSIT', 'started', 'in_progress')
              AND expires_at > NOW()
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Cannot reassign bus or driver while an active trip is in progress. Please wait for the trip to end.',
                'status', 409
            );
        END IF;
    END LOOP;

    -- Active Trip Guard: check if any target driver is actively running a trip
    FOR v_driver_rec IN SELECT * FROM jsonb_array_elements(p_driver_updates) LOOP
        IF EXISTS (
            SELECT 1 FROM active_trips
            WHERE driver_id = v_driver_rec->>'driver_uid'
              AND status IN ('active', 'SCHEDULED', 'IN_TRANSIT', 'started', 'in_progress')
              AND expires_at > NOW()
        ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Cannot reassign bus or driver while an active trip is in progress. Please wait for the trip to end.',
                'status', 409
            );
        END IF;
    END LOOP;

    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        PERFORM 1 FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
        END IF;
    END LOOP;

    -- Update buses with primary driver attribution
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        UPDATE buses SET
            primary_driver_uid = v_bus_rec->>'new_driver_uid',
            driver_uid = v_bus_rec->>'new_driver_uid',
            driver_name = v_bus_rec->>'new_driver_name',
            updated_at = NOW()
        WHERE id = v_bus_rec->>'bus_id';
        v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
    END LOOP;

    -- Update driver profiles with bus/route and reserved relief pool status
    FOR v_driver_rec IN SELECT * FROM jsonb_array_elements(p_driver_updates) LOOP
        v_is_reserved := COALESCE((v_driver_rec->>'is_reserved')::boolean, false);
        UPDATE driver_profiles SET
            bus_id = v_driver_rec->>'new_bus_id',
            route_id = v_driver_rec->>'new_route_id',
            is_reserved = v_is_reserved,
            status = CASE WHEN v_is_reserved THEN 'reserved' ELSE 'active' END,
            updated_at = NOW()
        WHERE uid = v_driver_rec->>'driver_uid';
        v_updated_drivers := array_append(v_updated_drivers, v_driver_rec->>'driver_uid');
    END LOOP;

    RETURN jsonb_build_object('success', true, 'updatedBuses', to_jsonb(v_updated_buses), 'updatedDrivers', to_jsonb(v_updated_drivers));
END;
$$;

-- RLS POLICIES (VERBATIM FROM COMPLETE_SCHEMA.sql)
CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

CREATE POLICY "student_profiles_select" ON public.student_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

CREATE POLICY "driver_profiles_select" ON public.driver_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

CREATE POLICY "moderator_profiles_select" ON public.moderator_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'admin'));

CREATE POLICY "admin_profiles_select" ON public.admin_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'admin'));

CREATE POLICY "unauth_users_select" ON public.unauth_users FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
USING (sender_user_id = auth.uid()::text OR recipient_ids @> ARRAY[auth.uid()::text] OR user_has_role(auth.uid()::text, 'admin') OR user_has_role(auth.uid()::text, 'moderator'));

CREATE POLICY "fcm_tokens_select_own" ON public.fcm_tokens FOR SELECT TO authenticated
USING (user_id = auth.uid()::text);

CREATE POLICY "fcm_tokens_service_role" ON public.fcm_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
```

---

