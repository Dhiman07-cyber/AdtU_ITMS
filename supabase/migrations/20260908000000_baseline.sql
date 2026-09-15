-- =============================================================================
-- CANONICAL DATABASE SCHEMA — ADTU ITMS (Institute Transportation Management System)
-- =============================================================================
-- This is the single, authoritative, consolidated schema for the ADTU ITMS platform.
-- It merges all historical migrations, complete domain tables, triggers, RPC functions,
-- row-level security (RLS) policies, and performance indexes into a single source of truth.
--
-- SECTIONS:
--   1. Extensions & Schema Configuration
--   2. Utility & Timestamp Triggers
--   3. Core Tables (19 Active Public Tables)
--   4. Views
--   5. Triggers
--   6. Production Indexes
--   7. Stored Procedures & Atomic RPCs
--   8. Row Level Security (RLS) Policies
--   9. Function Execution Grants & Access Control
--  10. Realtime Publication Setup
-- =============================================================================

-- =============================================================================
-- 1. EXTENSIONS & SCHEMA CONFIGURATION
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Restrict default execution privileges on new functions in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- =============================================================================
-- 2. UTILITY & TIMESTAMP TRIGGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_reassignment_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Authorization helper used inside RLS policies
CREATE OR REPLACE FUNCTION public.user_has_role(p_uid TEXT, p_role TEXT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM users WHERE uid = p_uid AND role = p_role
    );
$$;

-- =============================================================================
-- 3. CORE TABLES (19 Active Domain Tables)
-- =============================================================================

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
    status             TEXT CHECK (status IN ('active', 'inactive', 'suspended', 'reserved')),
    is_reserved        BOOLEAN DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderator_profiles (
    uid          TEXT PRIMARY KEY,
    email        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_profiles (
    uid          TEXT PRIMARY KEY,
    email        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    current_members INTEGER NOT NULL DEFAULT 0,
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

-- ── 3.5 Financial Domain (Payments Ledger) ─────────────────────────────────────

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

-- ── 3.6 Realtime & Operations Domain ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.active_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE,
  bus_id TEXT NOT NULL UNIQUE,
  driver_id TEXT NOT NULL UNIQUE,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'interrupted')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bus_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id TEXT NOT NULL UNIQUE,
  trip_id UUID,
  driver_id TEXT,
  route_id TEXT,
  shift TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'gps',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.driver_trip_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE,
  bus_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL,
  status TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,
  distance_km DOUBLE PRECISION,
  average_speed_kmh DOUBLE PRECISION,
  max_speed_kmh DOUBLE PRECISION,
  stop_events JSONB DEFAULT '[]',
  ended_reason TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_location_updates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id     UUID,
    driver_id   TEXT NOT NULL,
    bus_id      TEXT NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    accuracy    DOUBLE PRECISION,
    speed       DOUBLE PRECISION,
    heading     DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3.7 SRE, Security & Notification Domain ───────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
    id          TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    actor_id    TEXT NOT NULL,
    actor_email TEXT,
    actor_role  TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    details     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  app_version TEXT,
  UNIQUE(user_id, device_id)
);

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
  bus_id TEXT,
  driver_id TEXT,
  route_id TEXT,
  can_rollback BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL,
    device_type TEXT NOT NULL,
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

-- =============================================================================
-- 4. VIEWS
-- =============================================================================
CREATE OR REPLACE VIEW public.bus_stop_counts_view AS
SELECT 
    b.id as bus_id,
    b.bus_number,
    r.id as route_id,
    r.route_name,
    s.stop_name,
    s.shift,
    COUNT(s.uid) as student_count
FROM public.buses b
JOIN public.routes r ON r.buses @> jsonb_build_array(b.id) OR r.buses @> jsonb_build_array(b.bus_number)
LEFT JOIN public.student_profiles s ON s.bus_id = b.id AND s.status = 'active'
WHERE s.stop_name IS NOT NULL
GROUP BY b.id, b.bus_number, r.id, r.route_name, s.stop_name, s.shift;

-- =============================================================================
-- 5. TRIGGERS (Auto updated_at)
-- =============================================================================
DO $$
DECLARE
    tbl TEXT;
    tbls TEXT[] := ARRAY[
        'users', 'student_profiles', 'driver_profiles', 'moderator_profiles',
        'admin_profiles', 'unauth_users', 'buses', 'temporary_assignments',
        'routes', 'applications', 'fcm_tokens', 'notifications', 'active_trips', 'bus_locations'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl AND table_schema = 'public') THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', tbl, tbl);
            EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', tbl, tbl);
        END IF;
    END LOOP;
END $$;

DROP TRIGGER IF EXISTS update_payments_updated_at_trigger ON public.payments;
CREATE TRIGGER update_payments_updated_at_trigger
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION update_payments_updated_at();

DROP TRIGGER IF EXISTS trigger_update_reassignment_logs_updated_at ON public.reassignment_logs;
CREATE TRIGGER trigger_update_reassignment_logs_updated_at
  BEFORE UPDATE ON public.reassignment_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_reassignment_logs_updated_at();

-- =============================================================================
-- 6. PRODUCTION INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_student_profiles_bus_id ON student_profiles(bus_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_route_id ON student_profiles(route_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_status ON student_profiles(status);
CREATE INDEX IF NOT EXISTS idx_student_profiles_shift ON student_profiles(shift);
CREATE INDEX IF NOT EXISTS idx_student_profiles_enrollment_id ON student_profiles(enrollment_id);

CREATE INDEX IF NOT EXISTS idx_driver_profiles_status ON driver_profiles(status);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_is_reserved ON driver_profiles(is_reserved);

CREATE INDEX IF NOT EXISTS idx_applications_applicant_uid ON applications(applicant_uid);
CREATE INDEX IF NOT EXISTS idx_applications_state ON applications(state);
CREATE INDEX IF NOT EXISTS idx_applications_state_type ON applications(state, application_type);
CREATE INDEX IF NOT EXISTS idx_applications_bus_id ON applications(bus_id);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_student_uid ON payments(student_uid);
CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment_id ON payments(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order_id ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

-- Redundant active_trips indexes dropped (covered by UNIQUE(bus_id) and UNIQUE(driver_id))
CREATE INDEX IF NOT EXISTS idx_active_trips_status ON active_trips(status);

CREATE INDEX IF NOT EXISTS idx_bus_locations_bus_id ON bus_locations(bus_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_trip_id ON bus_locations(trip_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_updated_at ON bus_locations(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_waiting_flags_student_uid ON waiting_flags(student_uid);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_bus_id ON waiting_flags(bus_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_route_id ON waiting_flags(route_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_status ON waiting_flags(status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_trip ON waiting_flags(trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_flags_one_active ON waiting_flags(student_uid, bus_id) WHERE status IN ('raised', 'acknowledged', 'waiting');

CREATE INDEX IF NOT EXISTS idx_driver_trip_history_bus_id ON driver_trip_history(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_trip_history_driver_id ON driver_trip_history(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_trip_history_created_at ON driver_trip_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id ON device_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_expires_at ON device_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_reassignment_logs_operation_id ON reassignment_logs(operation_id);
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_logged_at ON reassignment_logs(logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id ON fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_ids ON notifications USING gin(recipient_ids);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- =============================================================================
-- 7. STORED PROCEDURES & ATOMIC RPC FUNCTIONS
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
    v_bus_id TEXT;
    v_route_id TEXT;
    v_stop_name TEXT;
    v_shift TEXT;
    v_full_name TEXT;
    v_email TEXT;
    v_enrollment_id TEXT;
    v_session_duration TEXT;
    v_last_processed_app_id TEXT;
    v_valid_until TIMESTAMPTZ;
    v_soft_block TIMESTAMPTZ;
    v_hard_block TIMESTAMPTZ;
BEGIN
    IF p_uid IS NULL OR p_uid = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_uid is required');
    END IF;

    v_email := COALESCE(NULLIF(p_email, ''), NULLIF(p_student_data->>'email', ''), '');
    v_full_name := COALESCE(NULLIF(p_full_name, ''), NULLIF(p_student_data->>'fullName', ''), NULLIF(p_student_data->>'full_name', ''), '');
    v_enrollment_id := COALESCE(
        NULLIF(p_student_data->>'enrollmentId', ''),
        NULLIF(p_student_data->>'enrollment_id', ''),
        ''
    );

    v_bus_id := COALESCE(p_student_data->>'busId', p_student_data->>'bus_id');
    v_route_id := COALESCE(p_student_data->>'routeId', p_student_data->>'route_id');
    v_stop_name := COALESCE(p_student_data->>'stop_name', p_student_data->>'selectedStop');
    v_shift := COALESCE(p_student_data->>'shift', 'Morning');

    v_session_duration := COALESCE(
        NULLIF(p_student_data->>'sessionDuration', ''),
        NULLIF(p_student_data->>'durationYears', ''),
        (COALESCE((p_student_data->>'sessionEndYear')::INTEGER, 2027) - COALESCE((p_student_data->>'sessionStartYear')::INTEGER, 2026))::TEXT
    );
    v_last_processed_app_id := COALESCE(
        NULLIF(p_student_data->>'applicationId', ''),
        NULLIF(p_student_data->>'lastProcessedApplicationId', ''),
        NULLIF(p_student_data->>'application_id', '')
    );

    v_valid_until := CASE WHEN p_student_data->>'validUntil' IS NOT NULL AND p_student_data->>'validUntil' <> '' THEN (p_student_data->>'validUntil')::TIMESTAMPTZ ELSE NULL END;
    v_soft_block  := CASE WHEN p_student_data->>'softBlock' IS NOT NULL AND p_student_data->>'softBlock' <> '' THEN (p_student_data->>'softBlock')::TIMESTAMPTZ ELSE NULL END;
    v_hard_block  := CASE WHEN p_student_data->>'hardBlock' IS NOT NULL AND p_student_data->>'hardBlock' <> '' THEN (p_student_data->>'hardBlock')::TIMESTAMPTZ ELSE NULL END;

    SELECT EXISTS(SELECT 1 FROM users WHERE uid = p_uid) INTO v_already_existed;

    INSERT INTO users (uid, email, name, role, created_at, updated_at)
    VALUES (p_uid, v_email, v_full_name, 'student', NOW(), NOW())
    ON CONFLICT (uid) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        role = CASE WHEN users.role IS NULL OR users.role = '' THEN 'student' ELSE users.role END,
        updated_at = NOW();

    INSERT INTO student_profiles (
        uid, email, full_name, phone, alt_phone, parent_name, parent_phone,
        faculty, department, gender, dob, enrollment_id, blood_group, address,
        profile_photo_url, bus_id, route_id,
        stop_name, shift, status, session_duration, session_start_year, session_end_year, semester,
        valid_until, soft_block, hard_block, last_processed_application_id, approved_by, approved_at, created_at, updated_at
    ) VALUES (
        p_uid, v_email, v_full_name,
        p_student_data->>'phone', p_student_data->>'altPhone',
        p_student_data->>'parentName', p_student_data->>'parentPhone',
        p_student_data->>'faculty', p_student_data->>'department',
        p_student_data->>'gender', p_student_data->>'dob',
        v_enrollment_id, p_student_data->>'bloodGroup',
        p_student_data->>'address', p_student_data->>'profilePhotoUrl',
        v_bus_id, v_route_id,
        v_stop_name, v_shift, 'active',
        v_session_duration,
        (p_student_data->>'sessionStartYear')::INTEGER,
        (p_student_data->>'sessionEndYear')::INTEGER,
        p_student_data->>'semester',
        v_valid_until, v_soft_block, v_hard_block,
        v_last_processed_app_id,
        p_student_data->>'approvedBy', NOW(), NOW(), NOW()
    )
    ON CONFLICT (uid) DO UPDATE SET
        email = COALESCE(NULLIF(EXCLUDED.email, ''), student_profiles.email),
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), student_profiles.full_name),
        phone = COALESCE(EXCLUDED.phone, student_profiles.phone),
        alt_phone = COALESCE(EXCLUDED.alt_phone, student_profiles.alt_phone),
        parent_name = COALESCE(EXCLUDED.parent_name, student_profiles.parent_name),
        parent_phone = COALESCE(EXCLUDED.parent_phone, student_profiles.parent_phone),
        faculty = COALESCE(EXCLUDED.faculty, student_profiles.faculty),
        department = COALESCE(EXCLUDED.department, student_profiles.department),
        gender = COALESCE(EXCLUDED.gender, student_profiles.gender),
        dob = COALESCE(EXCLUDED.dob, student_profiles.dob),
        enrollment_id = COALESCE(NULLIF(EXCLUDED.enrollment_id, ''), student_profiles.enrollment_id),
        blood_group = COALESCE(EXCLUDED.blood_group, student_profiles.blood_group),
        address = COALESCE(EXCLUDED.address, student_profiles.address),
        profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, student_profiles.profile_photo_url),
        bus_id = COALESCE(EXCLUDED.bus_id, student_profiles.bus_id),
        route_id = COALESCE(EXCLUDED.route_id, student_profiles.route_id),
        stop_name = COALESCE(EXCLUDED.stop_name, student_profiles.stop_name),
        shift = COALESCE(EXCLUDED.shift, student_profiles.shift),
        status = 'active',
        session_duration = COALESCE(EXCLUDED.session_duration, student_profiles.session_duration),
        session_start_year = COALESCE(EXCLUDED.session_start_year, student_profiles.session_start_year),
        session_end_year = COALESCE(EXCLUDED.session_end_year, student_profiles.session_end_year),
        semester = COALESCE(EXCLUDED.semester, student_profiles.semester),
        valid_until = COALESCE(EXCLUDED.valid_until, student_profiles.valid_until),
        soft_block = COALESCE(EXCLUDED.soft_block, student_profiles.soft_block),
        hard_block = COALESCE(EXCLUDED.hard_block, student_profiles.hard_block),
        last_processed_application_id = COALESCE(EXCLUDED.last_processed_application_id, student_profiles.last_processed_application_id),
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
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION reject_application(p_application_id TEXT, p_rejector_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION finalize_application_rejection(p_application_id TEXT, p_rejector_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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

DROP FUNCTION IF EXISTS bus_increment_capacity(TEXT, TEXT);
CREATE OR REPLACE FUNCTION bus_increment_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning', p_enforce_capacity BOOLEAN DEFAULT true)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
    v_capacity INTEGER; v_target_load INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning or Evening)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    -- Capacity guard (matches COMPLETE_SCHEMA.sql): atomic under the FOR UPDATE
    -- row lock above, so concurrent approvals cannot overbook. Callers that
    -- intentionally over-fill (admin create) must handle the error object.
    -- p_enforce_capacity=false is the explicit admin over-fill override.
    v_target_load := CASE WHEN v_normalized = 'morning' THEN v_bus.morning_load ELSE v_bus.evening_load END;
    v_capacity := COALESCE(v_bus.capacity, 0);
    IF p_enforce_capacity AND v_target_load >= v_capacity THEN
        RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' is at full capacity for ' || v_normalized || ' shift (' || v_target_load || '/' || v_capacity || ')');
    END IF;
    v_new_morning := v_bus.morning_load + CASE WHEN v_normalized = 'morning' THEN 1 ELSE 0 END;
    v_new_evening := v_bus.evening_load + CASE WHEN v_normalized = 'evening' THEN 1 ELSE 0 END;
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;
    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

CREATE OR REPLACE FUNCTION bus_decrement_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning or Evening)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    v_new_morning := GREATEST(0, v_bus.morning_load - CASE WHEN v_normalized = 'morning' THEN 1 ELSE 0 END);
    v_new_evening := GREATEST(0, v_bus.evening_load - CASE WHEN v_normalized = 'evening' THEN 1 ELSE 0 END);
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;
    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;
-- ── 4.5 Trip / Lock RPCs ────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.check_bus_lock(TEXT);

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

-- ── 4.6 Assignment RPCs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assign_drivers_atomically(
    p_bus_updates JSONB, p_driver_updates JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bus_rec JSONB; v_driver_rec JSONB; v_is_reserved BOOLEAN;
    v_updated_buses TEXT[] := '{}'; v_updated_drivers TEXT[] := '{}';
BEGIN
    -- NOTE (2026-09): static bus↔driver binding columns (buses.driver_uid,
    -- driver_profiles.bus_id/route_id) were dropped by design — driver↔bus
    -- binding is dynamic via active_trips (QR scan + trip lock). This RPC now
    -- commits the reservation side (is_reserved/status) atomically and
    -- validates that referenced buses still exist. Bus-side driver_uid intent
    -- is preserved in reassignment_logs audit only.
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

-- =============================================================================

-- ── 7.5 Operational Trip & Session Lifecycle Functions ─────────────────────────

-- end_trip_atomically: deletes active_trips and bus_locations in a single atomic transaction
-- with short-trip discard guard (p_min_duration_seconds).
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

  -- Remove the active lock and bus location atomically within the single transaction
  DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;
  DELETE FROM bus_locations WHERE bus_id = p_bus_id;

  IF v_dur_sec < p_min_duration_seconds THEN
    RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyEnded', false, 'shortTripDiscarded', true);
  END IF;

  INSERT INTO driver_trip_history (
    trip_id, bus_id, driver_id, route_id, shift,
    status, ended_reason, start_time, end_time, duration_seconds
  ) VALUES (
    v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
    'completed', 'completed', v_trip.start_time, v_now, v_dur_sec
  )
  ON CONFLICT (trip_id) DO NOTHING;

  RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyEnded', false);
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_old_trip_history(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.driver_trip_history
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_stale_device_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.device_sessions
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION expire_waiting_flags()
RETURNS VOID AS $$
BEGIN
  UPDATE waiting_flags
  SET status = 'expired'
  WHERE status = 'raised'
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_stale_locks(p_threshold_seconds INTEGER DEFAULT 300)
RETURNS TABLE (
  bus_id TEXT,
  driver_id TEXT,
  trip_id UUID,
  last_heartbeat TIMESTAMPTZ,
  age_seconds DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.bus_id,
    t.driver_id,
    t.trip_id,
    t.last_heartbeat,
    ROUND(EXTRACT(EPOCH FROM (NOW() - t.last_heartbeat))::NUMERIC, 2)::DOUBLE PRECISION AS age_seconds
  FROM public.active_trips t
  WHERE t.status = 'active'
    AND t.last_heartbeat < NOW() - (p_threshold_seconds || ' seconds')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_reassignment_logs(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_type TEXT DEFAULT NULL,
  p_bus_id TEXT DEFAULT NULL,
  p_driver_id TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS TABLE (
  operation_id TEXT,
  type TEXT,
  actor_id TEXT,
  actor_label TEXT,
  logged_at TIMESTAMPTZ,
  status TEXT,
  records_count INTEGER,
  details JSONB,
  bus_id TEXT,
  driver_id TEXT,
  route_id TEXT,
  can_rollback BOOLEAN,
  total_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT l.*
    FROM public.reassignment_logs l
    WHERE (p_type IS NULL OR l.type = p_type)
      AND (p_bus_id IS NULL OR l.bus_id = p_bus_id)
      AND (p_driver_id IS NULL OR l.driver_id = p_driver_id)
      AND (p_status IS NULL OR l.status = p_status)
  ),
  counted AS (
    SELECT COUNT(*) AS cnt FROM filtered
  )
  SELECT 
    f.operation_id,
    f.type,
    f.actor_id,
    f.actor_label,
    f.logged_at,
    f.status,
    f.records_count,
    f.details,
    f.bus_id,
    f.driver_id,
    f.route_id,
    f.can_rollback,
    c.cnt AS total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.logged_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================================
-- 7.1 ADDITIONAL ADMINISTRATIVE & LIFECYCLE RPCs
-- =============================================================================

-- 8.5 MISSING RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 8.5.1 soft_block_student_with_seat_release ──────────────────────────────
-- Source: supabase/migrations/soft_block_rpc.sql (merged here for single-file deploy)
-- Caller: soft-block cron service (lib/services/soft-block.service.ts)
-- Atomically: locks student row → validates active → decrements bus capacity
--             if releasing seat → updates status to soft_blocked.
-- Fixes race condition: double capacity decrement when cron runs concurrently.
CREATE OR REPLACE FUNCTION public.soft_block_student_with_seat_release(
    p_student_uid      TEXT,
    p_bus_id           TEXT,
    p_shift            TEXT,
    p_release_seat     BOOLEAN,
    p_soft_blocked_at  TIMESTAMPTZ,
    p_seat_released_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
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
            RETURN jsonb_build_object('success', false, 'error', v_capacity_result->>'error');
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
        IF p_release_seat AND p_bus_id IS NOT NULL THEN
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
    IF p_release_seat AND p_bus_id IS NOT NULL THEN
        PERFORM bus_increment_capacity(p_bus_id, v_normalized_shift);
    END IF;
    RAISE;
END;
$;

REVOKE EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) FROM public;
REVOKE EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;


-- ── 8.5.2 approve_renewal_with_seat ─────────────────────────────────────────
-- Caller: application.service.ts:279 (approve renewal_after_soft_block path)
-- Atomic: capacity check → increment → student update → application state → approved
-- Args: p_application_id, p_approver_uid, p_student_uid, p_bus_id, p_shift,
--       p_valid_until, p_session_end_year, p_session_duration, p_soft_block, p_hard_block
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_application_id  TEXT,
    p_approver_uid    TEXT,
    p_student_uid     TEXT,
    p_bus_id          TEXT,
    p_shift           TEXT,
    p_valid_until     TIMESTAMPTZ,
    p_session_end_year INTEGER,
    p_session_duration TEXT,
    p_soft_block      TIMESTAMPTZ DEFAULT NULL,
    p_hard_block      TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
DECLARE
    v_normalized_shift TEXT;
    v_bus              RECORD;
    v_new_morning      INTEGER;
    v_new_evening      INTEGER;
    v_student_updated  INTEGER;
    v_app_updated      INTEGER;
BEGIN
    -- 1. Validate shift
    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid shift: ' || COALESCE(p_shift, 'NULL'));
    END IF;

    -- 2. Lock bus row and check capacity atomically
    SELECT id, capacity, morning_load, evening_load
    INTO v_bus
    FROM buses
    WHERE id = p_bus_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus ' || p_bus_id || ' not found');
    END IF;

    -- 3. Verify capacity has room
    IF v_normalized_shift = 'morning' THEN
        IF v_bus.morning_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load + 1;
        v_new_evening := v_bus.evening_load;
    ELSE
        IF v_bus.evening_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load;
        v_new_evening := v_bus.evening_load + 1;
    END IF;

    -- 4. Increment bus capacity
    UPDATE buses
    SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = p_bus_id;

    -- 5. Update student profile (re-activate, extend validity)
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
        SET morning_load = v_bus.morning_load, evening_load = v_bus.evening_load, current_members = v_bus.morning_load + v_bus.evening_load, updated_at = NOW()
        WHERE id = p_bus_id;
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found or not updated: ' || p_student_uid);
    END IF;

    -- 6. Finalize application → approved (preserve for audit trail)
    UPDATE applications SET
        state                       = 'approved',
        approved_at                 = NOW(),
        approved_by                 = p_approver_uid,
        approved_by_id              = p_approver_uid,
        processing_lock             = NULL,
        processing_started_at       = NULL,
        processing_lease_expires_at = NULL,
        processing_result           = 'success',
        processing_completed_at     = NOW(),
        updated_at                  = NOW()
    WHERE application_id = p_application_id
      AND processing_lock = p_approver_uid;
    GET DIAGNOSTICS v_app_updated = ROW_COUNT;

    IF v_app_updated <> 1 THEN
        -- Compensate both student and bus
        UPDATE student_profiles SET status = 'soft_blocked', seat_released_at = NOW(), updated_at = NOW()
        WHERE uid = p_student_uid;
        UPDATE buses
        SET morning_load = v_bus.morning_load, evening_load = v_bus.evening_load, current_members = v_bus.morning_load + v_bus.evening_load, updated_at = NOW()
        WHERE id = p_bus_id;
        RETURN jsonb_build_object('success', false, 'error', 'Application lock expired or not found: ' || p_application_id);
    END IF;

    RETURN jsonb_build_object(
        'success',     true,
        'studentUid',  p_student_uid,
        'busId',       p_bus_id,
        'shift',       p_shift,
        'newMorningLoad', v_new_morning,
        'newEveningLoad', v_new_evening,
        'capacity',    v_bus.capacity
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$;

REVOKE EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM public;
REVOKE EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;


-- ── 8.5.3 get_student_profile_counts ────────────────────────────────────────
-- Caller: analytics.repository.ts:111
-- Returns: [{ total_students, active_students, morning_students, evening_students, expired_students }]
-- Single aggregation replacing 5 separate COUNT() queries.
CREATE OR REPLACE FUNCTION public.get_student_profile_counts()
RETURNS TABLE(
    total_students   BIGINT,
    active_students  BIGINT,
    morning_students BIGINT,
    evening_students BIGINT,
    expired_students BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $
    SELECT
        COUNT(*)                                                        AS total_students,
        COUNT(*) FILTER (WHERE status = 'active')                       AS active_students,
        COUNT(*) FILTER (WHERE LOWER(shift) = 'morning')                AS morning_students,
        COUNT(*) FILTER (WHERE LOWER(shift) = 'evening')                AS evening_students,
        COUNT(*) FILTER (WHERE status IN ('soft_blocked', 'expired'))   AS expired_students
    FROM public.student_profiles;
$;

REVOKE EXECUTE ON FUNCTION public.get_student_profile_counts() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_student_profile_counts() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_student_profile_counts() TO service_role;


-- ── 8.5.4 get_application_counts ────────────────────────────────────────────
-- Caller: analytics.repository.ts:114
-- Returns: [{ pending_apps, verification_apps, renewal_apps }]
CREATE OR REPLACE FUNCTION public.get_application_counts()
RETURNS TABLE(
    pending_apps      BIGINT,
    verification_apps BIGINT,
    renewal_apps      BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $
    SELECT
        COUNT(*) FILTER (WHERE state IN ('draft', 'submitted'))                               AS pending_apps,
        COUNT(*) FILTER (WHERE state IN ('awaiting_verification', 'verified'))                AS verification_apps,
        COUNT(*) FILTER (WHERE application_type IN ('renewal', 'renewal_after_soft_block')
                           AND state NOT IN ('approved', 'rejected'))                         AS renewal_apps
    FROM public.applications;
$;

REVOKE EXECUTE ON FUNCTION public.get_application_counts() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_application_counts() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_application_counts() TO service_role;


-- ── 8.5.5 delete_student_cascade_v1 ─────────────────────────────────────────
-- Caller: cleanup-helpers.ts:81
-- Atomically deletes: users, student_profiles, applications, notifications,
--                     waiting_flags, fcm_tokens for a given student UID.
-- The single-transaction boundary prevents partial deletion states.
CREATE OR REPLACE FUNCTION public.delete_student_cascade_v1(p_student_uid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
DECLARE
    v_notifications_deleted  INTEGER := 0;
    v_waiting_flags_deleted  INTEGER := 0;
    v_fcm_deleted            INTEGER := 0;
    v_applications_deleted   INTEGER := 0;
    v_student_deleted        INTEGER := 0;
    v_user_deleted           INTEGER := 0;
BEGIN
    IF p_student_uid IS NULL OR p_student_uid = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_student_uid is required');
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
$;

REVOKE EXECUTE ON FUNCTION public.delete_student_cascade_v1(TEXT) FROM public;
REVOKE EXECUTE ON FUNCTION public.delete_student_cascade_v1(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_student_cascade_v1(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_student_cascade_v1(TEXT) TO service_role;


-- ── 8.5.6 delete_route_cascade_v1 ───────────────────────────────────────────
-- Caller: cleanup-helpers.ts:295
-- Returns: { success, busesCleaned, studentsCleaned }
-- Atomically: clears route from buses → clears route/bus from students → deletes route.
CREATE OR REPLACE FUNCTION public.delete_route_cascade_v1(p_route_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
DECLARE
    v_buses_cleaned    INTEGER := 0;
    v_students_cleaned INTEGER := 0;
    v_route_deleted    INTEGER := 0;
BEGIN
    IF p_route_id IS NULL OR p_route_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_route_id is required');
    END IF;

    -- 1. Clear route assignment from buses
    UPDATE public.buses
    SET route_id   = NULL,
        route_name = NULL,
        updated_at = NOW()
    WHERE route_id = p_route_id;
    GET DIAGNOSTICS v_buses_cleaned = ROW_COUNT;

    -- 2. Clear route/bus/stop from students assigned to this route
    UPDATE public.student_profiles
    SET route_id          = NULL,
        bus_id            = NULL,
        stop_name         = NULL,
        updated_at        = NOW()
    WHERE route_id = p_route_id;
    GET DIAGNOSTICS v_students_cleaned = ROW_COUNT;

    -- 3. Delete route
    DELETE FROM public.routes WHERE id = p_route_id;
    GET DIAGNOSTICS v_route_deleted = ROW_COUNT;

    IF v_route_deleted = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Route not found: ' || p_route_id);
    END IF;

    RETURN jsonb_build_object(
        'success',          true,
        'routeId',          p_route_id,
        'busesCleaned',     v_buses_cleaned,
        'studentsCleaned',  v_students_cleaned
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$;

REVOKE EXECUTE ON FUNCTION public.delete_route_cascade_v1(TEXT) FROM public;
REVOKE EXECUTE ON FUNCTION public.delete_route_cascade_v1(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_route_cascade_v1(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_route_cascade_v1(TEXT) TO service_role;


-- ── 8.5.7 activate_session_batch ────────────────────────────────────────────
-- Caller: session-activation.service.ts:141
-- Args: p_session_year INTEGER (the academic year to activate)
-- Returns: { success, processed, pending, failed, errors[] }
-- Bulk-activates verified_upcoming applications for the given session year.
-- This is a best-effort batch: each application is processed independently
-- so one failure does not block others.
-- NOTE: The full session-activation business logic (capacity check, student
-- creation, bus-pass, notifications) is orchestrated by TypeScript. This RPC
-- handles the database-level state transitions atomically.
CREATE OR REPLACE FUNCTION public.activate_session_batch(p_session_year INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
DECLARE
    v_app            RECORD;
    v_processed      INTEGER := 0;
    v_pending        INTEGER := 0;
    v_failed         INTEGER := 0;
    v_errors         JSONB   := '[]'::jsonb;
    v_locked         INTEGER;
BEGIN
    -- Iterate all verified_upcoming applications for this session year.
    -- Each is locked for update to prevent concurrent processing.
    FOR v_app IN
        SELECT application_id, applicant_uid, state, target_session, form_data, application_type
        FROM public.applications
        WHERE state = 'verified_upcoming'
          AND (
              target_session IS NULL
              OR target_session->>'startYear' IS NULL
              OR (target_session->>'startYear')::INTEGER = p_session_year
          )
        FOR UPDATE SKIP LOCKED   -- skip any already being processed
    LOOP
        BEGIN
            -- Attempt to lock the application for processing
            UPDATE public.applications
            SET processing_lock             = 'session_activation',
                processing_started_at       = NOW(),
                processing_lease_expires_at = NOW() + INTERVAL '10 minutes'
            WHERE application_id = v_app.application_id
              AND state = 'verified_upcoming'
              AND (processing_lock IS NULL OR processing_lease_expires_at < NOW());
            GET DIAGNOSTICS v_locked = ROW_COUNT;

            IF v_locked = 1 THEN
                -- Application locked — TypeScript service will pick it up
                -- and call finalize_application_approval when done.
                -- We count it as "will be processed" here.
                v_processed := v_processed + 1;
            ELSE
                -- Already locked by another process (concurrent activation)
                v_pending := v_pending + 1;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_failed  := v_failed + 1;
            v_errors  := v_errors || jsonb_build_object(
                'applicationId', v_app.application_id,
                'error',         SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   true,
        'processed', v_processed,
        'pending',   v_pending,
        'failed',    v_failed,
        'errors',    v_errors
    );
END;
$;

REVOKE EXECUTE ON FUNCTION public.activate_session_batch(INTEGER) FROM public;
REVOKE EXECUTE ON FUNCTION public.activate_session_batch(INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.activate_session_batch(INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.activate_session_batch(INTEGER) TO service_role;


-- ── 8.5.8 reassign_students_atomically ──────────────────────────────────────
-- Caller: fleet.repository.pg.ts:285
-- Args: p_plans JSONB — array of { studentId, fromBusId, toBusId, studentShift? }
-- Returns: { success, processed }
-- Atomically reassigns a batch of students from one bus to another,
-- decrementing source and incrementing destination capacity per student
-- and recalculating bus capacity counts for 100% precision.
CREATE OR REPLACE FUNCTION public.reassign_students_atomically(p_plans JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
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
    FOR v_plan IN SELECT * FROM jsonb_array_elements(p_plans) LOOP
        v_student_id  := COALESCE(v_plan->>'studentId', v_plan->>'student_id');
        v_from_bus_id := COALESCE(v_plan->>'fromBusId', v_plan->>'from_bus_id');
        v_to_bus_id   := COALESCE(v_plan->>'toBusId', v_plan->>'to_bus_id');

        IF v_student_id IS NULL OR v_student_id = '' THEN CONTINUE; END IF;

        IF v_from_bus_id IS NOT NULL AND v_from_bus_id <> '' THEN
            v_affected_buses := array_append(v_affected_buses, v_from_bus_id);
        END IF;
        IF v_to_bus_id IS NOT NULL AND v_to_bus_id <> '' THEN
            v_affected_buses := array_append(v_affected_buses, v_to_bus_id);
        END IF;

        -- Read student (lock row to prevent concurrent modification)
        SELECT uid, shift, bus_id, stop_name
        INTO v_student
        FROM student_profiles
        WHERE uid = v_student_id
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- Resolve old shift for decrement (student's current shift)
        v_old_shift := LOWER(TRIM(COALESCE(v_student.shift, 'Morning')));
        IF v_old_shift NOT IN ('morning', 'evening') THEN v_old_shift := 'morning'; END IF;

        -- Resolve new shift for increment (plan override > student record)
        v_new_shift := LOWER(TRIM(COALESCE(v_plan->>'studentShift', v_plan->>'shift', v_student.shift, 'Morning')));
        IF v_new_shift NOT IN ('morning', 'evening') THEN v_new_shift := 'morning'; END IF;

        -- Fetch target bus route_id
        SELECT route_id INTO v_target_route_id
        FROM buses
        WHERE id = v_to_bus_id OR bus_number = v_to_bus_id
        LIMIT 1;

        -- Decrement from-bus capacity using student's OLD shift
        IF v_from_bus_id IS NOT NULL AND v_from_bus_id <> '' THEN
            SELECT bus_decrement_capacity(v_from_bus_id, v_old_shift) INTO v_cap_result;
        END IF;

        -- Increment to-bus capacity using student's NEW shift
        IF v_to_bus_id IS NOT NULL AND v_to_bus_id <> '' THEN
            SELECT bus_increment_capacity(v_to_bus_id, v_new_shift) INTO v_cap_result;
        END IF;

        -- Resolve stop_name override if provided
        v_stop_name := COALESCE(v_plan->>'stopName', v_plan->>'stop_name', v_student.stop_name);

        -- Update student record (bus_id, route_id, shift, stop_name)
        UPDATE student_profiles SET
            bus_id          = v_to_bus_id,
            route_id        = COALESCE(v_target_route_id, route_id),
            shift           = INITCAP(v_new_shift),
            stop_name       = v_stop_name,
            updated_at      = NOW()
        WHERE uid = v_student_id;

        v_processed := v_processed + 1;
    END LOOP;

    -- Recalculate bus load counts for all affected buses to ensure 100% precision
    FOR v_to_bus_id IN SELECT DISTINCT unnest(v_affected_buses) LOOP
        UPDATE buses b SET
            morning_load = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND LOWER(sp.shift) = 'morning' AND sp.status = 'active'),
            evening_load = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND LOWER(sp.shift) = 'evening' AND sp.status = 'active'),
            current_members = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND sp.status = 'active'),
            updated_at = NOW()
        WHERE b.id = v_to_bus_id OR b.bus_number = v_to_bus_id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'processed', v_processed);
END;
$;

REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM public;
REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) TO service_role;


-- ── 8.5.9 processed_operations & execute_reassignment_rollback ──────────────
-- ┌─ processed_operations Table ────────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_processed_operations_created_at ON public.processed_operations (created_at DESC);

ALTER TABLE public.processed_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "processed_operations_select_service" ON public.processed_operations;
CREATE POLICY "processed_operations_select_service" ON public.processed_operations
    FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "processed_operations_insert_service" ON public.processed_operations;
CREATE POLICY "processed_operations_insert_service" ON public.processed_operations
    FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "processed_operations_update_service" ON public.processed_operations;
CREATE POLICY "processed_operations_update_service" ON public.processed_operations
    FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "processed_operations_delete_service" ON public.processed_operations;
CREATE POLICY "processed_operations_delete_service" ON public.processed_operations
    FOR DELETE TO service_role USING (true);


-- ┌─ execute_reassignment_rollback RPC ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.execute_reassignment_rollback(TEXT, TEXT, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.execute_reassignment_rollback(
    p_operation_id TEXT,
    p_actor_id TEXT,
    p_actor_label TEXT,
    p_changes JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
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
    -- Handle case where p_changes might be passed as JSON string or JSON array
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
                updated_at = NOW()
            WHERE uid = v_doc_id;
            
            GET DIAGNOSTICS v_row_updated = ROW_COUNT;
            IF v_row_updated <> 1 THEN
                RAISE EXCEPTION 'Failed to update student profile %', v_doc_id;
            END IF;
            
            v_reverted_docs := array_append(v_reverted_docs, v_change->>'docPath');
        END IF;
    END LOOP;

    -- 4. Recalculate bus load counts for all affected buses
    FOR v_bus_id_item IN SELECT DISTINCT unnest(v_affected_buses) LOOP
        UPDATE buses b SET
            morning_load = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND LOWER(sp.shift) = 'morning' AND sp.status = 'active'),
            evening_load = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND LOWER(sp.shift) = 'evening' AND sp.status = 'active'),
            current_members = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND sp.status = 'active'),
            updated_at = NOW()
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
$;

REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM public;
REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.execute_reassignment_rollback(TEXT, TEXT, TEXT, JSONB) FROM public;
REVOKE EXECUTE ON FUNCTION public.execute_reassignment_rollback(TEXT, TEXT, TEXT, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_reassignment_rollback(TEXT, TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_reassignment_rollback(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- =============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS across all active public tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unauth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temporary_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bus_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiting_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_trip_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_location_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reassignment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ── 8.1 Identity Domain Policies ──────────────────────────────────────────────

DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "student_profiles_select" ON public.student_profiles;
CREATE POLICY "student_profiles_select" ON public.student_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "driver_profiles_select" ON public.driver_profiles;
CREATE POLICY "driver_profiles_select" ON public.driver_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "moderator_profiles_select" ON public.moderator_profiles;
CREATE POLICY "moderator_profiles_select" ON public.moderator_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "admin_profiles_select" ON public.admin_profiles;
CREATE POLICY "admin_profiles_select" ON public.admin_profiles FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "unauth_users_select" ON public.unauth_users;
CREATE POLICY "unauth_users_select" ON public.unauth_users FOR SELECT TO authenticated
USING (uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- ── 8.2 Fleet & Route Policies ────────────────────────────────────────────────

DROP POLICY IF EXISTS "buses_select" ON public.buses;
CREATE POLICY "buses_select" ON public.buses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "temporary_assignments_select" ON public.temporary_assignments;
CREATE POLICY "temporary_assignments_select" ON public.temporary_assignments FOR SELECT TO authenticated
USING (student_id = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

DROP POLICY IF EXISTS "routes_select" ON public.routes;
CREATE POLICY "routes_select" ON public.routes FOR SELECT TO authenticated USING (true);

-- ── 8.3 Applications Policies ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "applications_select" ON public.applications;
CREATE POLICY "applications_select" ON public.applications FOR SELECT TO authenticated
USING (applicant_uid = auth.uid()::text OR user_has_role(auth.uid()::text, 'moderator') OR user_has_role(auth.uid()::text, 'admin'));

-- ── 8.4 Financial Domain Policies (Immutable Ledger) ──────────────────────────

DROP POLICY IF EXISTS "payments_no_delete" ON public.payments;
CREATE POLICY "payments_no_delete" ON public.payments FOR DELETE TO PUBLIC USING (false);

DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated
USING (student_uid = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "payments_insert_service" ON public.payments;
CREATE POLICY "payments_insert_service" ON public.payments FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "payments_update_service" ON public.payments;
CREATE POLICY "payments_update_service" ON public.payments FOR UPDATE TO service_role USING (true);

-- ── 8.5 Operations & Realtime Policies ────────────────────────────────────────

DROP POLICY IF EXISTS "active_trips_select_anon" ON public.active_trips;
CREATE POLICY "active_trips_select_anon" ON public.active_trips FOR SELECT TO anon, authenticated
USING (status = 'active');

DROP POLICY IF EXISTS "active_trips_service_role" ON public.active_trips;
CREATE POLICY "active_trips_service_role" ON public.active_trips FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bus_locations_select_anon" ON public.bus_locations;
CREATE POLICY "bus_locations_select_anon" ON public.bus_locations FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "bus_locations_insert_service" ON public.bus_locations;
CREATE POLICY "bus_locations_insert_service" ON public.bus_locations FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "bus_locations_update_service" ON public.bus_locations;
CREATE POLICY "bus_locations_update_service" ON public.bus_locations FOR UPDATE TO service_role USING (true);

DROP POLICY IF EXISTS "bus_locations_delete_service" ON public.bus_locations;
CREATE POLICY "bus_locations_delete_service" ON public.bus_locations FOR DELETE TO service_role USING (true);

DROP POLICY IF EXISTS "waiting_flags_select_anon" ON public.waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_select_authenticated" ON public.waiting_flags;
CREATE POLICY "waiting_flags_select_authenticated" ON public.waiting_flags FOR SELECT TO authenticated
USING (status IN ('raised', 'acknowledged') OR student_uid = auth.uid()::text);

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

DROP POLICY IF EXISTS "driver_trip_history_select_authenticated" ON public.driver_trip_history;
CREATE POLICY "driver_trip_history_select_authenticated" ON public.driver_trip_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "driver_trip_history_insert_service" ON public.driver_trip_history;
CREATE POLICY "driver_trip_history_insert_service" ON public.driver_trip_history FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "driver_trip_history_delete_service" ON public.driver_trip_history;
CREATE POLICY "driver_trip_history_delete_service" ON public.driver_trip_history FOR DELETE TO service_role USING (true);

-- ── 8.6 SRE & Security Policies ───────────────────────────────────────────────

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

DROP POLICY IF EXISTS "reassignment_logs_select_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_select_service" ON public.reassignment_logs FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "reassignment_logs_insert_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_insert_service" ON public.reassignment_logs FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "reassignment_logs_update_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_update_service" ON public.reassignment_logs FOR UPDATE TO service_role USING (true);

DROP POLICY IF EXISTS "reassignment_logs_delete_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_delete_service" ON public.reassignment_logs FOR DELETE TO service_role USING (true);

DROP POLICY IF EXISTS "fcm_tokens_select_own" ON public.fcm_tokens;
CREATE POLICY "fcm_tokens_select_own" ON public.fcm_tokens FOR SELECT TO authenticated
USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "fcm_tokens_service_role" ON public.fcm_tokens;
CREATE POLICY "fcm_tokens_service_role" ON public.fcm_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT TO authenticated
USING (sender_user_id = auth.uid()::text OR recipient_ids @> ARRAY[auth.uid()::text] OR user_has_role(auth.uid()::text, 'admin') OR user_has_role(auth.uid()::text, 'moderator'));

-- Bypass policies for service_role across all domains
DO $$
DECLARE
    tbl TEXT;
    tbls TEXT[] := ARRAY[
        'users', 'student_profiles', 'driver_profiles', 'moderator_profiles',
        'admin_profiles', 'unauth_users', 'buses', 'temporary_assignments',
        'routes', 'applications', 'notifications', 'audit_events', 'processed_operations'
    ];
BEGIN
    FOREACH tbl IN ARRAY tbls LOOP
        EXECUTE format('DROP POLICY IF EXISTS service_role_bypass_%I ON %I', tbl, tbl);
        EXECUTE format('CREATE POLICY service_role_bypass_%I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;

-- =============================================================================
-- 9. FUNCTION EXECUTION GRANTS & ACCESS CONTROL
-- =============================================================================
DO $
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT p.oid::regprocedure AS proc_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'acquire_trip_lock',
        'extend_trip_lock',
        'release_trip_lock',
        'acquire_fcm_lock',
        'end_trip_atomically',
        'bus_increment_capacity',
        'bus_decrement_capacity',
        'assign_drivers_atomically',
        'assign_routes_atomically',
        'reassign_students_atomically',
        'execute_reassignment_rollback',
        'approve_application',
        'approve_renewal_with_seat',
        'reject_application',
        'finalize_application_approval',
        'finalize_application_rejection',
        'validate_application_for_approval',
        'validate_application_for_rejection',
        'delete_student_cascade_v1',
        'delete_route_cascade_v1',
        'activate_session_batch',
        'soft_block_student_with_seat_release',
        'identity_activate_student',
        'mark_fcm_notification_sent',
        'user_has_role'
      )
  ) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.proc_name);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.proc_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.proc_name);
  END LOOP;
END $;

-- Read-only inspection and analytics functions: grant to authenticated & service_role
GRANT EXECUTE ON FUNCTION public.bus_check_capacity(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_bus_lock(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_profile_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_application_counts() TO authenticated, service_role;

-- =============================================================================
-- 10. REALTIME PUBLICATION SETUP
-- =============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.active_trips;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.bus_locations;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.waiting_flags;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

-- =============================================================================
-- 11. FINANCIAL LEDGER & SECURITY DOCUMENTATION
-- =============================================================================
COMMENT ON TABLE public.payments IS 'IMMUTABLE FINANCIAL LEDGER - Payment records are permanent and cannot be deleted. Single source of truth for all payments.';
COMMENT ON COLUMN public.payments.student_name IS 'Student name - stores AES-256-GCM encrypted data for new records. Legacy plain-text data is handled transparently by decryptData() in the application.';
COMMENT ON COLUMN public.payments.student_id IS 'Enrollment ID - stores AES-256-GCM encrypted data for new records. Legacy plain-text data is handled transparently.';
COMMENT ON COLUMN public.payments.offline_transaction_id IS 'Offline transaction ID - stores AES-256-GCM encrypted data for new records. Legacy plain-text data is handled transparently.';
COMMENT ON COLUMN public.payments.document_signature IS 'RSA-2048 digital signature for tamper-proof receipt verification. Generated during receipt creation and verified during QR scan.';
COMMENT ON TABLE public.bus_locations IS 'Real-time GPS coordinates of buses during active trips';
COMMENT ON TABLE public.waiting_flags IS 'Student waiting signals at bus stops';
COMMENT ON TABLE public.active_trips IS 'Multi-driver lock system - Live trip records with heartbeat for exclusive bus operation';
