-- =============================================================================
-- CANONICAL SCHEMA — ITMS Production Schema (Single Migration)
-- =============================================================================
-- This is the authoritative schema for fresh deployments.
-- Applying ONLY this migration produces the exact same schema as applying
-- all 29 historical migrations sequentially.
--
-- Historical migrations (20260706_d0 through 20260718_c5) are preserved
-- untouched for history. This file is the production source of truth.
--
-- Sections:
--   1. Extensions
--   2. Tables (28 tables, ordered by domain)
--   3. Triggers (auto updated_at)
--   4. Functions (RPCs, cleanup, helpers)
--   5. Views
--   6. Indexes
--   7. RLS Policies & Grants
--   8. Realtime Publication
-- =============================================================================

-- ── 1.1 MIGRATION PRE-CHECKS ──────────────────────────────────────────────────
DO $$
DECLARE
    v_invalid_count INTEGER;
BEGIN
    -- Check for applications with invalid shift = 'Both'
    SELECT COUNT(*) INTO v_invalid_count 
    FROM public.applications 
    WHERE shift = 'Both';
    
    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'Migration pre-check failed: Found % applications with invalid shift = ''Both''. Silently mapping business data is prohibited. Please inspect and clean up the applications table before running this migration.', v_invalid_count;
    END IF;
END $$;

-- ── 1. EXTENSIONS ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- ── 2.1 Identity Domain ─────────────────────────────────────────────────────

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
    assigned_route_id TEXT,
    assigned_bus_id   TEXT,
    stop_id           TEXT,
    stop_name         TEXT,
    shift             TEXT CHECK (shift IN ('Morning', 'Evening')),
    -- ↑ BUSINESS RULE: Students may ONLY be Morning or Evening. 'Both' is a bus/driver capability, NOT a student one.
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
    assigned_bus_id    TEXT,
    assigned_route_id  TEXT,
    bus_id             TEXT,
    route_id           TEXT,
    bus_assigned       TEXT,
    driver_id          TEXT,
    joining_date       TEXT,
    shift              TEXT CHECK (shift IN ('Morning', 'Evening', 'Both')),
    status             TEXT CHECK (status IN ('active', 'inactive', 'suspended', 'reserved')),
    trip_active        BOOLEAN DEFAULT FALSE,
    active_trip_id     TEXT,
    is_reserved        BOOLEAN DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderator_profiles (
    uid                    TEXT PRIMARY KEY,
    email                  TEXT,
    full_name              TEXT,
    name                   TEXT,
    phone                  TEXT,
    employee_id            TEXT,
    staff_id               TEXT,
    managing_team          TEXT,
    team_name              TEXT,
    status                 TEXT CHECK (status IN ('active', 'inactive', 'suspended')),
    profile_photo_url      TEXT,
    role                   TEXT DEFAULT 'moderator',
    created_by             TEXT,
    faculty                TEXT,
    assigned_faculty       TEXT,
    permissions            JSONB DEFAULT '{}'::jsonb,
    permissions_updated_at TIMESTAMPTZ,
    permissions_updated_by TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_profiles (
    uid                TEXT PRIMARY KEY,
    email              TEXT,
    full_name          TEXT,
    name               TEXT,
    phone              TEXT,
    employee_id        TEXT,
    role               TEXT DEFAULT 'admin',
    assigned_faculty   TEXT,
    years_of_service   TEXT,
    alt_phone          TEXT,
    dob                TEXT,
    profile_photo_url  TEXT,
    username           TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unauth_users (
    uid                TEXT PRIMARY KEY,
    email              TEXT NOT NULL,
    display_name       TEXT,
    photo_url          TEXT,
    status             TEXT DEFAULT 'pending_application',
    needs_application  BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2.2 Calendar Domain ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academic_calendar_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    session_start_month SMALLINT NOT NULL
        CONSTRAINT chk_session_start_month CHECK (session_start_month BETWEEN 0 AND 11),
    session_start_day   SMALLINT NOT NULL
        CONSTRAINT chk_session_start_day   CHECK (session_start_day   BETWEEN 1 AND 31),
    urgent_warning_days SMALLINT NOT NULL DEFAULT 15
        CONSTRAINT chk_urgent_warning_days CHECK (urgent_warning_days > 0),
    soft_block_warning_text     TEXT NOT NULL DEFAULT 'Your bus service has expired. Please renew.',
    hard_delete_critical_text   TEXT NOT NULL DEFAULT 'Warning: Account will be permanently deleted.',
    contact_office_name         TEXT,
    contact_phone               TEXT,
    contact_email               TEXT,
    contact_office_hours        TEXT,
    contact_address             TEXT,
    contact_visit_instructions  TEXT,
    landing_page        JSONB,
    application_process JSONB,
    statistics          JSONB,
    config_version      TEXT NOT NULL DEFAULT '1.0.0',
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          TEXT
);

CREATE TABLE IF NOT EXISTS migration_log (
    id           TEXT        PRIMARY KEY,
    version      TEXT        NOT NULL,
    domain_id    TEXT        NOT NULL,
    status       TEXT        NOT NULL
        CONSTRAINT chk_migration_status
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2.3 Application Domain ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applications (
    application_id              TEXT PRIMARY KEY,
    applicant_uid               TEXT NOT NULL,
    applicant_email             TEXT,
    email                       TEXT,
    route_id                    TEXT,
    bus_id                      TEXT,
    stop_id                     TEXT,
    shift                       TEXT CHECK (shift IN ('Morning', 'Evening')),
    session_start_year          INTEGER,
    session_end_year            INTEGER,
    application_type            TEXT CHECK (application_type IN (
                                    'fresh', 'renewal', 'renewal_after_soft_block', 'future'
                                )),
    eligible_approval           TIMESTAMPTZ,
    form_data                   JSONB NOT NULL DEFAULT '{}'::jsonb,
    state                       TEXT NOT NULL DEFAULT 'draft'
                                    CHECK (state IN (
                                        'draft', 'awaiting_verification', 'verified',
                                        'submitted', 'verified_upcoming',
                                        'pending_seat_allocation', 'approved',
                                        'rejected', 'cancelled', 'expired'
                                    )),
    state_history               JSONB DEFAULT '[]'::jsonb,
    pending_verifier            TEXT,
    verification_attempts       INTEGER NOT NULL DEFAULT 0,
    verified_at                 TIMESTAMPTZ,
    verified_by                 TEXT,
    verified_by_id              TEXT,
    submitted_at                TIMESTAMPTZ,
    submitted_by                TEXT,
    approved_at                 TIMESTAMPTZ,
    approved_by                 TEXT,
    approved_by_id              TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by                  TEXT NOT NULL,
    application_version         INTEGER,
    needs_capacity_review       BOOLEAN DEFAULT FALSE,
    reassignment_reason         TEXT CHECK (reassignment_reason IN (
                                    'bus_full_only_option', 'bus_full_alternatives_exist', 'no_issue'
                                )),
    has_alternative_buses       BOOLEAN,
    payment_id                  TEXT,
    target_session              JSONB,
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
    processing_lock             TEXT,
    processing_started_at       TIMESTAMPTZ,
    processing_lease_expires_at TIMESTAMPTZ,
    processing_completed_at     TIMESTAMPTZ,
    processing_result           TEXT CHECK (processing_result IN ('success', 'failed', 'conflict'))
);

-- ── 2.4 Payment Domain ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS processed_payments (
    payment_id TEXT PRIMARY KEY,
    order_id TEXT,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    amount NUMERIC(12,2),
    enrollment_id TEXT,
    user_id TEXT,
    source TEXT DEFAULT 'system'
);

-- ── 2.5 Fleet Domain ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS buses (
    id               TEXT PRIMARY KEY,
    bus_number       TEXT NOT NULL,
    model            TEXT,
    year             TEXT,
    capacity         INTEGER NOT NULL DEFAULT 0,
    driver_uid       TEXT,
    driver_name      TEXT,
    route_id         TEXT,
    route_name       TEXT,
    status           TEXT NOT NULL DEFAULT 'inactive'
                         CHECK (status IN ('active', 'inactive', 'maintenance', 'enroute', 'idle')),
    -- current_passenger_count removed: was always identical to current_members (written simultaneously in every RPC)
    morning_load     INTEGER NOT NULL DEFAULT 0,
    evening_load     INTEGER NOT NULL DEFAULT 0,
    -- current_members is a GENERATED column: always equals morning_load + evening_load.
    -- This eliminates the drift that admin-reconcile-bus-loads.ts was created to correct.
    -- The RPCs no longer need to write this column explicitly.
    current_members  INTEGER GENERATED ALWAYS AS (morning_load + evening_load) STORED,
    last_started_at  TIMESTAMPTZ,
    last_ended_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_buses_loads_non_negative
        CHECK (morning_load >= 0 AND evening_load >= 0)
);

-- ── 2.6 Route Domain ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS routes (
    id             TEXT PRIMARY KEY,
    -- route_id removed: was always identical to id (legacy Firestore alias, never queried separately)
    route_name     TEXT NOT NULL,
    stops          JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_stops    INTEGER NOT NULL DEFAULT 0,
    estimated_time TEXT,
    status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'inactive')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trip, Tracking, Swaps, Reassignment, and Payments domains are defined in COMPLETE_SCHEMA.sql.
-- Only student_profiles, buses, routes, etc. are created in this migration.

CREATE TABLE IF NOT EXISTS audit_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action         TEXT NOT NULL,
    category       TEXT NOT NULL,
    severity       TEXT NOT NULL DEFAULT 'medium',
    summary        TEXT,
    actor_id       TEXT NOT NULL,
    actor_name     TEXT,
    actor_role     TEXT NOT NULL DEFAULT 'admin',
    target_type    TEXT,
    target_id      TEXT,
    target_name    TEXT,
    metadata       JSONB DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2.10 Notification Domain ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(500) NOT NULL,
    content             TEXT NOT NULL,
    type                TEXT NOT NULL DEFAULT 'notice'
                        CHECK (type <> '' AND length(type) > 0),
    sender              JSONB NOT NULL,
    sender_user_id      TEXT GENERATED ALWAYS AS (sender->>'userId') STORED,
    target              JSONB NOT NULL,
    recipient_ids       TEXT[] NOT NULL DEFAULT '{}',
    auto_injected_recipient_ids TEXT[] NOT NULL DEFAULT '{}',
    read_by_user_ids    TEXT[] NOT NULL DEFAULT '{}',
    hidden_for_user_ids TEXT[] NOT NULL DEFAULT '{}',
    is_edited           BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted_globally BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_by_user_id  TEXT,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    edit_history        JSONB DEFAULT '[]'::jsonb,
    metadata            JSONB DEFAULT '{}'::jsonb
);

-- ── 2.11 Config Domain ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_config (
    config_key     TEXT PRIMARY KEY,
    config_data    JSONB NOT NULL DEFAULT '{}',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_uid TEXT
);

CREATE TABLE IF NOT EXISTS system_markers (
    marker_key  TEXT PRIMARY KEY,
    marker_data JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3. TRIGGERS (auto updated_at)
-- =============================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Config
DROP TRIGGER IF EXISTS trg_system_config_updated_at ON system_config;
CREATE TRIGGER trg_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_system_markers_updated_at ON system_markers;
CREATE TRIGGER trg_system_markers_updated_at BEFORE UPDATE ON system_markers
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Identity tables — defense-in-depth so every UPDATE path is covered
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_student_profiles_updated_at ON student_profiles;
CREATE TRIGGER trg_student_profiles_updated_at BEFORE UPDATE ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_driver_profiles_updated_at ON driver_profiles;
CREATE TRIGGER trg_driver_profiles_updated_at BEFORE UPDATE ON driver_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_moderator_profiles_updated_at ON moderator_profiles;
CREATE TRIGGER trg_moderator_profiles_updated_at BEFORE UPDATE ON moderator_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_admin_profiles_updated_at ON admin_profiles;
CREATE TRIGGER trg_admin_profiles_updated_at BEFORE UPDATE ON admin_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_unauth_users_updated_at ON unauth_users;
CREATE TRIGGER trg_unauth_users_updated_at BEFORE UPDATE ON unauth_users
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- =============================================================================
-- 4. FUNCTIONS (RPCs, Cleanup, Helpers)
-- =============================================================================

-- ── 4.1 Identity RPCs ───────────────────────────────────────────────────────


CREATE OR REPLACE FUNCTION public.identity_activate_student(
    p_uid TEXT, p_email TEXT, p_full_name TEXT, p_student_data JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_already_existed BOOLEAN;
BEGIN
    IF p_uid IS NULL OR p_uid = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_uid is required');
    END IF;

    SELECT EXISTS(SELECT 1 FROM users WHERE uid = p_uid) INTO v_already_existed;

    INSERT INTO users (uid, email, name, role, created_at, updated_at)
    VALUES (p_uid, COALESCE(p_email, ''), COALESCE(p_full_name, ''), 'student', NOW(), NOW())
    ON CONFLICT (uid) DO UPDATE SET
        email = EXCLUDED.email, name = EXCLUDED.name,
        role = CASE WHEN users.role IS NULL OR users.role = '' THEN 'student' ELSE users.role END,
        updated_at = NOW();

    INSERT INTO student_profiles (
        uid, email, full_name, phone, alt_phone, parent_name, parent_phone,
        faculty, department, gender, dob, enrollment_id, blood_group, address,
        profile_photo_url, bus_id, route_id, assigned_route_id, assigned_bus_id,
        stop_id, shift, status, session_start_year, session_end_year, semester,
        valid_until, approved_by, approved_at, created_at, updated_at
    ) VALUES (
        p_uid, COALESCE(p_email, p_student_data->>'email'),
        COALESCE(p_full_name, p_student_data->>'fullName'),
        p_student_data->>'phone', p_student_data->>'altPhone',
        p_student_data->>'parentName', p_student_data->>'parentPhone',
        p_student_data->>'faculty', p_student_data->>'department',
        p_student_data->>'gender', p_student_data->>'dob',
        p_student_data->>'enrollmentId', p_student_data->>'bloodGroup',
        p_student_data->>'address', p_student_data->>'profilePhotoUrl',
        p_student_data->>'busId', p_student_data->>'routeId',
        p_student_data->>'routeId', p_student_data->>'busId',
        p_student_data->>'stopId', p_student_data->>'shift', 'active',
        (p_student_data->>'sessionStartYear')::INTEGER,
        (p_student_data->>'sessionEndYear')::INTEGER,
        p_student_data->>'semester',
        CASE WHEN p_student_data->>'validUntil' IS NOT NULL
             THEN (p_student_data->>'validUntil')::TIMESTAMPTZ ELSE NULL END,
        p_student_data->>'approvedBy', NOW(), NOW(), NOW()
    )
    ON CONFLICT (uid) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, student_profiles.email),
        full_name = COALESCE(EXCLUDED.full_name, student_profiles.full_name),
        phone = COALESCE(EXCLUDED.phone, student_profiles.phone),
        alt_phone = COALESCE(EXCLUDED.alt_phone, student_profiles.alt_phone),
        parent_name = COALESCE(EXCLUDED.parent_name, student_profiles.parent_name),
        parent_phone = COALESCE(EXCLUDED.parent_phone, student_profiles.parent_phone),
        faculty = COALESCE(EXCLUDED.faculty, student_profiles.faculty),
        department = COALESCE(EXCLUDED.department, student_profiles.department),
        gender = COALESCE(EXCLUDED.gender, student_profiles.gender),
        dob = COALESCE(EXCLUDED.dob, student_profiles.dob),
        enrollment_id = COALESCE(EXCLUDED.enrollment_id, student_profiles.enrollment_id),
        blood_group = COALESCE(EXCLUDED.blood_group, student_profiles.blood_group),
        address = COALESCE(EXCLUDED.address, student_profiles.address),
        profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, student_profiles.profile_photo_url),
        bus_id = COALESCE(EXCLUDED.bus_id, student_profiles.bus_id),
        route_id = COALESCE(EXCLUDED.route_id, student_profiles.route_id),
        assigned_route_id = COALESCE(EXCLUDED.assigned_route_id, student_profiles.assigned_route_id),
        assigned_bus_id = COALESCE(EXCLUDED.assigned_bus_id, student_profiles.assigned_bus_id),
        stop_id = COALESCE(EXCLUDED.stop_id, student_profiles.stop_id),
        shift = COALESCE(EXCLUDED.shift, student_profiles.shift),
        status = 'active',
        session_start_year = COALESCE(EXCLUDED.session_start_year, student_profiles.session_start_year),
        session_end_year = COALESCE(EXCLUDED.session_end_year, student_profiles.session_end_year),
        semester = COALESCE(EXCLUDED.semester, student_profiles.semester),
        valid_until = COALESCE(EXCLUDED.valid_until, student_profiles.valid_until),
        approved_by = COALESCE(EXCLUDED.approved_by, student_profiles.approved_by),
        approved_at = COALESCE(EXCLUDED.approved_at, student_profiles.approved_at),
        updated_at = NOW();

    RETURN jsonb_build_object('success', true, 'already_activated', v_already_existed, 'uid', p_uid);
END;
$$;

-- ── 4.2 Application RPCs ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION validate_application_for_approval(
    p_application_id TEXT, p_approver_uid TEXT, p_lease_minutes INTEGER DEFAULT 5
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_app JSONB;
BEGIN
    UPDATE applications
    SET processing_lock = p_approver_uid, processing_started_at = NOW(),
        processing_lease_expires_at = NOW() + (p_lease_minutes || ' minutes')::INTERVAL,
        processing_result = NULL, processing_completed_at = NULL
    WHERE application_id = p_application_id AND state = 'submitted'
      AND (processing_lock IS NULL OR processing_lease_expires_at < NOW())
    RETURNING to_jsonb(applications.*) INTO v_app;
    RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION validate_application_for_rejection(
    p_application_id TEXT, p_rejector_uid TEXT
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_app JSONB;
    v_rejectable_states TEXT[] := ARRAY['submitted','verified_upcoming','pending_seat_allocation'];
BEGIN
    UPDATE applications
    SET processing_lock = p_rejector_uid, processing_started_at = NOW(),
        processing_lease_expires_at = NOW() + INTERVAL '5 minutes',
        processing_result = NULL, processing_completed_at = NULL
    WHERE application_id = p_application_id AND state = ANY(v_rejectable_states)
      AND (processing_lock IS NULL OR processing_lease_expires_at < NOW())
    RETURNING to_jsonb(applications.*) INTO v_app;
    RETURN v_app;
END;
$$;

CREATE OR REPLACE FUNCTION approve_application(
    p_application_id TEXT, p_approver_uid TEXT, p_lease_minutes INTEGER DEFAULT 5
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_app JSONB;
BEGIN
    v_app := validate_application_for_approval(p_application_id, p_approver_uid, p_lease_minutes);
    IF v_app IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application not found or already being processed', 'status', 409);
    END IF;
    RETURN jsonb_build_object('success', true, 'application', v_app);
END;
$$;

CREATE OR REPLACE FUNCTION reject_application(p_application_id TEXT, p_rejector_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_app JSONB;
BEGIN
    v_app := validate_application_for_rejection(p_application_id, p_rejector_uid);
    IF v_app IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application not found or not in rejectable state', 'status', 409);
    END IF;
    RETURN jsonb_build_object('success', true, 'application', v_app);
END;
$$;

CREATE OR REPLACE FUNCTION finalize_application_approval(
    p_application_id TEXT, p_approver_uid TEXT, p_student_data JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION finalize_application_rejection(p_application_id TEXT, p_rejector_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_deleted INTEGER; v_exists BOOLEAN;
BEGIN
    DELETE FROM applications WHERE application_id = p_application_id AND processing_lock = p_rejector_uid AND processing_lease_expires_at > NOW();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 1 THEN
        RETURN jsonb_build_object('success', true, 'finalized', true, 'already_finalized', false, 'application_id', p_application_id);
    END IF;
    SELECT EXISTS(SELECT 1 FROM applications WHERE application_id = p_application_id) INTO v_exists;
    IF NOT v_exists THEN
        RETURN jsonb_build_object('success', true, 'finalized', false, 'already_finalized', true, 'application_id', p_application_id);
    END IF;
    RETURN jsonb_build_object('success', false, 'status', 409, 'error', 'Invalid or expired processing lease');
END;
$$;

CREATE OR REPLACE FUNCTION transition_application_state(
    p_application_id TEXT, p_new_state TEXT, p_actor_uid TEXT, p_additional_data JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_app RECORD;
    v_valid_transitions JSONB := '{
        "draft": ["awaiting_verification"],
        "awaiting_verification": ["verified"],
        "verified": ["submitted"],
        "submitted": ["verified_upcoming", "rejected"],
        "verified_upcoming": ["pending_seat_allocation", "rejected"],
        "pending_seat_allocation": ["rejected"]
    }'::jsonb;
    v_valid_from TEXT[];
BEGIN
    SELECT * INTO v_app FROM applications WHERE application_id = p_application_id;
    IF v_app IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application not found', 'status', 404);
    END IF;
    v_valid_from := ARRAY(SELECT jsonb_array_elements_text(v_valid_transitions->v_app.state));
    IF NOT (p_new_state = ANY(v_valid_from)) THEN
        RETURN jsonb_build_object('success', false, 'error', format('Invalid transition: %s to %s', v_app.state, p_new_state), 'status', 400);
    END IF;
    UPDATE applications SET
        state = p_new_state, updated_at = NOW(),
        state_history = COALESCE(state_history, '[]'::jsonb) || jsonb_build_object('state', p_new_state, 'timestamp', NOW()::text, 'actor', p_actor_uid),
        verified_upcoming_at = CASE WHEN p_new_state = 'verified_upcoming' THEN NOW() ELSE verified_upcoming_at END,
        verified_upcoming_by = CASE WHEN p_new_state = 'verified_upcoming' THEN (p_additional_data->>'verified_upcoming_by') ELSE verified_upcoming_by END,
        verified_upcoming_by_id = CASE WHEN p_new_state = 'verified_upcoming' THEN p_actor_uid ELSE verified_upcoming_by_id END,
        pending_seat_allocation_at = CASE WHEN p_new_state = 'pending_seat_allocation' THEN NOW() ELSE pending_seat_allocation_at END,
        submitted_at = CASE WHEN p_new_state = 'submitted' THEN NOW() ELSE submitted_at END,
        submitted_by = CASE WHEN p_new_state = 'submitted' THEN p_actor_uid ELSE submitted_by END
    WHERE application_id = p_application_id;
    RETURN jsonb_build_object('success', true, 'application_id', p_application_id, 'new_state', p_new_state);
END;
$$;

CREATE OR REPLACE FUNCTION release_application_lock(p_application_id TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
    UPDATE applications SET processing_lock = NULL, processing_started_at = NULL,
        processing_lease_expires_at = NULL, processing_result = NULL, processing_completed_at = NULL
    WHERE application_id = p_application_id;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_abandoned_application_locks()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_cleaned INTEGER;
BEGIN
    UPDATE applications SET processing_lock = NULL, processing_started_at = NULL,
        processing_lease_expires_at = NULL, processing_result = 'expired', processing_completed_at = NOW()
    WHERE processing_lock IS NOT NULL AND processing_lease_expires_at < NOW() AND processing_completed_at IS NULL;
    GET DIAGNOSTICS v_cleaned = ROW_COUNT;
    RETURN jsonb_build_object('cleaned', v_cleaned);
END;
$$;

-- ── 4.3 Payment RPCs ────────────────────────────────────────────────────────

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

-- ── 4.4 Fleet / Capacity RPCs ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION bus_check_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning')
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'busId', b.id, 'capacity', b.capacity, 'morningLoad', b.morning_load,
    'eveningLoad', b.evening_load, 'currentMembers', b.current_members,
    'shiftLoad', CASE
        WHEN LOWER(p_shift) = 'evening' THEN b.evening_load
        ELSE b.morning_load END,
    'available', CASE
        WHEN LOWER(p_shift) = 'evening' THEN b.evening_load < b.capacity
        ELSE b.morning_load < b.capacity END
  ) FROM buses b WHERE b.id = p_bus_id;
$$;

CREATE OR REPLACE FUNCTION bus_increment_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning')
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning or Evening)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    v_new_morning := v_bus.morning_load + CASE WHEN v_normalized = 'morning' THEN 1 ELSE 0 END;
    v_new_evening := v_bus.evening_load + CASE WHEN v_normalized = 'evening' THEN 1 ELSE 0 END;
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, updated_at = NOW()
    WHERE id = p_bus_id;
    RETURN jsonb_build_object('busId', p_bus_id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

CREATE OR REPLACE FUNCTION bus_decrement_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning')
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning or Evening)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    v_new_morning := GREATEST(0, v_bus.morning_load - CASE WHEN v_normalized = 'morning' THEN 1 ELSE 0 END);
    v_new_evening := GREATEST(0, v_bus.evening_load - CASE WHEN v_normalized = 'evening' THEN 1 ELSE 0 END);
    -- current_members is now GENERATED ALWAYS AS (morning_load + evening_load) STORED.
    -- Do NOT write it explicitly. PostgreSQL computes it atomically on this UPDATE.
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, updated_at = NOW()
    WHERE id = p_bus_id;
    RETURN jsonb_build_object('busId', p_bus_id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

-- ── 4.5 Trip / Lock RPCs ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_bus_lock(p_bus_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
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

CREATE OR REPLACE FUNCTION public.acquire_trip_lock(
    p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT, p_route_id TEXT, p_shift TEXT, p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_existing RECORD;
BEGIN
    SELECT trip_id INTO v_existing FROM active_trips
    WHERE bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';
    IF FOUND THEN RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id, 'alreadyActive', true); END IF;

    UPDATE active_trips SET status = 'ended', end_time = v_now
    WHERE status = 'active' AND (bus_id = p_bus_id OR driver_id = p_driver_id)
      AND last_heartbeat < v_now - INTERVAL '600 seconds';

    BEGIN
        INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at)
        VALUES (p_trip_id, p_bus_id, p_driver_id, p_route_id, p_shift, 'active', v_now, v_now, v_expires_at);
        RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyActive', false);
    EXCEPTION WHEN unique_violation THEN
        SELECT trip_id, driver_id INTO v_existing FROM active_trips WHERE bus_id = p_bus_id AND status = 'active' LIMIT 1;
        IF FOUND AND v_existing.driver_id = p_driver_id THEN
            RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id, 'alreadyActive', true);
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'LOCKED_BY_OTHER', 'activeDriverId', COALESCE(v_existing.driver_id, 'unknown'));
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.extend_trip_lock(
    p_trip_id TEXT, p_driver_id TEXT, p_bus_id TEXT, p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL; v_updated INTEGER;
BEGIN
    UPDATE active_trips SET last_heartbeat = NOW(), expires_at = v_expires_at
    WHERE trip_id = p_trip_id AND driver_id = p_driver_id AND bus_id = p_bus_id AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN jsonb_build_object('success', true);
    ELSE RETURN jsonb_build_object('success', false, 'error', 'Active trip not found'); END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_trip_lock(p_trip_id TEXT, p_bus_id TEXT, p_driver_id TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_updated INTEGER;
BEGIN
    UPDATE active_trips SET status = 'ended', end_time = NOW()
    WHERE trip_id = p_trip_id AND bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'released', v_updated > 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_fcm_lock(p_trip_id TEXT, p_bus_id TEXT, p_lock_type TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_column TEXT; v_updated INTEGER;
BEGIN
    IF p_lock_type = 'start' THEN v_column := 'fcm_start_sent';
    ELSIF p_lock_type = 'end' THEN v_column := 'fcm_end_sent';
    ELSE RETURN jsonb_build_object('success', false, 'error', 'Invalid lock_type'); END IF;

    IF v_column = 'fcm_start_sent' THEN
        UPDATE active_trips SET fcm_start_sent = true
        WHERE trip_id = p_trip_id AND bus_id = p_bus_id AND status = 'active' AND fcm_start_sent = false;
    ELSE
        UPDATE active_trips SET fcm_end_sent = true
        WHERE trip_id = p_trip_id AND bus_id = p_bus_id AND status = 'active' AND fcm_end_sent = false;
    END IF;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN RETURN jsonb_build_object('success', true, 'acquired', true);
    ELSE RETURN jsonb_build_object('success', true, 'acquired', false); END IF;
END;
$$;

-- ── 4.6 Assignment RPCs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assign_drivers_atomically(
    p_bus_updates JSONB, p_driver_updates JSONB
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_bus_rec JSONB; v_driver_rec JSONB; v_current TEXT; v_is_reserved BOOLEAN;
    v_updated_buses TEXT[] := '{}'; v_updated_drivers TEXT[] := '{}';
BEGIN
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        SELECT driver_uid INTO v_current FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
        END IF;
        IF v_current IS DISTINCT FROM v_bus_rec->>'prev_driver_uid' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Conflict: ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' is now assigned to ' || COALESCE(v_current, 'no driver') || ' (expected: ' || COALESCE(v_bus_rec->>'prev_driver_uid', 'no driver') || ')', 'status', 409);
        END IF;
    END LOOP;

    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        UPDATE buses SET driver_uid = v_bus_rec->>'new_driver_uid', updated_at = NOW() WHERE id = v_bus_rec->>'bus_id';
        v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
    END LOOP;

    FOR v_driver_rec IN SELECT * FROM jsonb_array_elements(p_driver_updates) LOOP
        v_is_reserved := (v_driver_rec->>'is_reserved')::boolean;
        UPDATE driver_profiles SET
            assigned_bus_id = v_driver_rec->>'new_bus_id', bus_id = v_driver_rec->>'new_bus_id',
            assigned_route_id = v_driver_rec->>'new_route_id', route_id = v_driver_rec->>'new_route_id',
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
RETURNS JSONB LANGUAGE plpgsql AS $$
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
-- Restored missing RPC functions to satisfy TypeScript contract
CREATE OR REPLACE FUNCTION cleanup_old_reassignment_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  WITH ranked AS (
    SELECT id, operation_id, type, created_at,
           ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at DESC) AS rn
    FROM public.reassignment_logs
  )
  DELETE FROM public.reassignment_logs 
  WHERE id IN (SELECT id FROM ranked WHERE rn > 3);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 60)
RETURNS TABLE(
  cleaned_trip_id UUID,
  cleaned_bus_id TEXT,
  cleaned_driver_id TEXT
) AS $$
DECLARE
  v_trip RECORD;
BEGIN
  FOR v_trip IN
    SELECT at.trip_id, at.bus_id, at.driver_id
    FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL
  LOOP
    UPDATE public.active_trips
    SET status = 'ended', end_time = NOW()
    WHERE active_trips.trip_id = v_trip.trip_id;
    
    RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================================================
-- 5. VIEWS
-- =============================================================================

CREATE OR REPLACE VIEW public.bus_occupancy_counts_view AS
SELECT
    assigned_bus_id AS bus_id,
    COUNT(*) AS total_count,
    SUM(CASE WHEN (shift = 'Morning' OR shift = 'Both') THEN 1 ELSE 0 END) AS morning_count,
    SUM(CASE WHEN (shift = 'Evening' OR shift = 'Both') THEN 1 ELSE 0 END) AS evening_count
FROM public.student_profiles
WHERE (status = 'active')
   OR (status IN ('soft_blocked', 'pending_deletion') AND seat_released_at IS NULL)
GROUP BY assigned_bus_id;

CREATE OR REPLACE VIEW public.bus_stop_counts_view AS
SELECT
    assigned_bus_id AS bus_id,
    stop_id,
    COUNT(*) AS stop_count
FROM public.student_profiles
WHERE ((status = 'active')
   OR (status IN ('soft_blocked', 'pending_deletion') AND seat_released_at IS NULL))
  AND stop_id IS NOT NULL
GROUP BY assigned_bus_id, stop_id;

-- =============================================================================
-- 6. INDEXES
-- =============================================================================

-- Identity
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_student_profiles_email ON student_profiles(email);
CREATE INDEX IF NOT EXISTS idx_student_profiles_bus_id ON student_profiles(bus_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_route_id ON student_profiles(route_id) WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_profiles_assigned_route_id ON student_profiles(assigned_route_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_assigned_bus_id ON student_profiles(assigned_bus_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_shift ON student_profiles(shift);
CREATE INDEX IF NOT EXISTS idx_student_profiles_status ON student_profiles(status);
CREATE INDEX IF NOT EXISTS idx_student_profiles_enrollment_id ON student_profiles(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_status_valid_until ON student_profiles(status, valid_until);
CREATE INDEX IF NOT EXISTS idx_student_profiles_assigned_bus_shift ON student_profiles(assigned_bus_id, shift) WHERE assigned_bus_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_profiles_seat_released_at ON student_profiles(seat_released_at) WHERE seat_released_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_profiles_email ON driver_profiles(email);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_assigned_bus_id ON driver_profiles(assigned_bus_id) WHERE assigned_bus_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_profiles_assigned_route_id ON driver_profiles(assigned_route_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_bus_id ON driver_profiles(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_route_id ON driver_profiles(route_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_shift ON driver_profiles(shift);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_status ON driver_profiles(status);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_driver_id ON driver_profiles(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_is_reserved ON driver_profiles(is_reserved);

CREATE INDEX IF NOT EXISTS idx_moderator_profiles_email ON moderator_profiles(email);
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_status ON moderator_profiles(status);
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_employee_id ON moderator_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_managing_team ON moderator_profiles(managing_team);

CREATE INDEX IF NOT EXISTS idx_admin_profiles_email ON admin_profiles(email);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_employee_id ON admin_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_role ON admin_profiles(role);

CREATE INDEX IF NOT EXISTS idx_unauth_users_email ON unauth_users(email);
CREATE INDEX IF NOT EXISTS idx_unauth_users_status ON unauth_users(status);
CREATE INDEX IF NOT EXISTS idx_unauth_users_last_login_at ON unauth_users(last_login_at);

-- Calendar
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_calendar_config_singleton ON academic_calendar_config(is_active) WHERE (is_active = TRUE);
CREATE INDEX IF NOT EXISTS idx_academic_calendar_config_updated_at ON academic_calendar_config(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_migration_log_domain_id ON migration_log(domain_id);
CREATE INDEX IF NOT EXISTS idx_migration_log_status ON migration_log(status);

-- Applications
CREATE INDEX IF NOT EXISTS idx_applications_applicant_uid ON applications(applicant_uid);
CREATE INDEX IF NOT EXISTS idx_applications_state ON applications(state);
CREATE INDEX IF NOT EXISTS idx_applications_application_type ON applications(application_type);
CREATE INDEX IF NOT EXISTS idx_applications_submitted_at ON applications(submitted_at);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_eligible_approval ON applications(eligible_approval);
CREATE INDEX IF NOT EXISTS idx_applications_route_id ON applications(route_id);
CREATE INDEX IF NOT EXISTS idx_applications_bus_id ON applications(bus_id);
CREATE INDEX IF NOT EXISTS idx_applications_shift ON applications(shift);
CREATE INDEX IF NOT EXISTS idx_applications_session_start_year ON applications(session_start_year);
CREATE INDEX IF NOT EXISTS idx_applications_upcoming_pass ON applications(state, application_type, eligible_approval) WHERE state = 'submitted' AND application_type = 'future';
CREATE INDEX IF NOT EXISTS idx_applications_lock_expiry ON applications(processing_lease_expires_at) WHERE processing_lock IS NOT NULL AND processing_completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_applications_form_data ON applications USING GIN (form_data);
CREATE INDEX IF NOT EXISTS idx_applications_target_session ON applications USING GIN (target_session);

-- Fleet
-- idx_buses_bus_id removed: bus_id column dropped (was always identical to id).
-- idx_buses_current_members removed: current_members is now a GENERATED column;
--   PostgreSQL does not permit functional indexes on GENERATED ALWAYS AS STORED without expression syntax.
--   Queries that need this sort by morning_load or evening_load individually instead.
CREATE INDEX IF NOT EXISTS idx_buses_bus_number ON buses(bus_number);
CREATE INDEX IF NOT EXISTS idx_buses_route_id ON buses(route_id);
CREATE INDEX IF NOT EXISTS idx_buses_driver_uid ON buses(driver_uid);
CREATE INDEX IF NOT EXISTS idx_buses_status ON buses(status);
CREATE INDEX IF NOT EXISTS idx_buses_morning_load ON buses(morning_load);
CREATE INDEX IF NOT EXISTS idx_buses_evening_load ON buses(evening_load);

-- Routes
-- idx_routes_route_id removed: route_id column dropped (was always identical to id).
CREATE INDEX IF NOT EXISTS idx_routes_status ON routes(status);

-- Indexes for active_trips, bus_locations, driver_status, waiting_flags, driver_location_updates, route_cache, driver_swap_requests, temporary_assignments, missed_bus_requests, device_sessions, reassignment_logs, and payments are defined in COMPLETE_SCHEMA.sql.

-- Processed payments
CREATE INDEX IF NOT EXISTS idx_processed_payments_expires_at ON processed_payments(expires_at);
CREATE INDEX IF NOT EXISTS idx_processed_payments_user_id ON processed_payments(user_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_ids ON notifications USING GIN (recipient_ids);
CREATE INDEX IF NOT EXISTS idx_notifications_sender_user_id ON notifications(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at ON notifications(expires_at) WHERE expires_at IS NOT NULL;

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_events_category_ts ON audit_events(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_severity_ts ON audit_events(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_role_ts ON audit_events(actor_role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);

-- Config
CREATE INDEX IF NOT EXISTS idx_system_config_data ON system_config USING GIN (config_data);

-- =============================================================================
-- 7. RLS POLICIES & GRANTS
-- =============================================================================

-- ── 7.1 Authorization helper ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_has_role(p_uid TEXT, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE uid = p_uid AND role = p_role
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_role(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_role(TEXT, TEXT) TO authenticated;

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unauth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_calendar_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- ── 7.2 SELECT Policies (Zero-Trust Write: Writes are service-role only) ──────

-- users SELECT policy
CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- student_profiles SELECT policy
CREATE POLICY "student_profiles_select" ON public.student_profiles FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- driver_profiles SELECT policy
CREATE POLICY "driver_profiles_select" ON public.driver_profiles FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- moderator_profiles SELECT policy
CREATE POLICY "moderator_profiles_select" ON public.moderator_profiles FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'admin'));

-- admin_profiles SELECT policy
CREATE POLICY "admin_profiles_select" ON public.admin_profiles FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'admin'));

-- unauth_users SELECT policy
CREATE POLICY "unauth_users_select" ON public.unauth_users FOR SELECT TO authenticated
  USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- applications SELECT policy
CREATE POLICY "applications_select" ON public.applications FOR SELECT TO authenticated
  USING (applicant_uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- buses SELECT policy
CREATE POLICY "buses_select" ON public.buses FOR SELECT TO authenticated
  USING (true);

-- routes SELECT policy
CREATE POLICY "routes_select" ON public.routes FOR SELECT TO authenticated
  USING (true);

-- Service-role bypass policies (necessary so service role can do anything on all tables)
CREATE POLICY "service_role_bypass_users" ON public.users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_student_profiles" ON public.student_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_driver_profiles" ON public.driver_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_moderator_profiles" ON public.moderator_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_admin_profiles" ON public.admin_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_unauth_users" ON public.unauth_users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_applications" ON public.applications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_buses" ON public.buses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_routes" ON public.routes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_notifications" ON public.notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_system_config" ON public.system_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_system_markers" ON public.system_markers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_processed_payments" ON public.processed_payments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_audit_events" ON public.audit_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_academic_calendar" ON public.academic_calendar_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_bypass_migration_log" ON public.migration_log FOR ALL TO service_role USING (true) WITH CHECK (true);
