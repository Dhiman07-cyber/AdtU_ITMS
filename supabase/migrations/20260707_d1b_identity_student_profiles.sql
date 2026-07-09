-- =============================================================================
-- D1 Identity — Student Profiles Migration
-- Version  : 1.0.0
-- Domain   : D1 Identity (Slice 2: student_profiles)
-- Migration: Firestore students collection → PostgreSQL student_profiles table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per student at students/{uid} with 37+ fields.
--
-- PostgreSQL schema captures the most query-critical fields as typed columns.
-- extras JSONB captures unmapped Firestore fields for migration compatibility.
-- extras is NOT a permanent dumping ground — fields get promoted to typed columns.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: student_profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_profiles (
    uid               TEXT PRIMARY KEY,                 -- Firebase Auth UID (FK to users.uid)
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
    shift             TEXT CHECK (shift IN ('Morning', 'Evening', 'Both')),
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
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extras            JSONB DEFAULT '{}'::jsonb          -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_student_profiles_email ON student_profiles(email);
CREATE INDEX IF NOT EXISTS idx_student_profiles_bus_id ON student_profiles(bus_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_route_id ON student_profiles(route_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_assigned_route_id ON student_profiles(assigned_route_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_assigned_bus_id ON student_profiles(assigned_bus_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_shift ON student_profiles(shift);
CREATE INDEX IF NOT EXISTS idx_student_profiles_status ON student_profiles(status);
CREATE INDEX IF NOT EXISTS idx_student_profiles_enrollment_id ON student_profiles(enrollment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_student_profiles_updated_at ON student_profiles;
CREATE TRIGGER set_student_profiles_updated_at
    BEFORE UPDATE ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
