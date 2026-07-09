-- =============================================================================
-- D1 Identity — Driver Profiles Migration
-- Version  : 1.0.0
-- Domain   : D1 Identity (Slice 3: driver_profiles)
-- Migration: Firestore drivers collection → PostgreSQL driver_profiles table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per driver at drivers/{uid} with 22+ fields.
--
-- PostgreSQL schema captures the most query-critical fields as typed columns.
-- extras JSONB captures unmapped Firestore fields for migration compatibility.
-- extras is NOT a permanent dumping ground — fields get promoted to typed columns.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: driver_profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS driver_profiles (
    uid                TEXT PRIMARY KEY,                 -- Firebase Auth UID (FK to users.uid)
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
    status             TEXT CHECK (status IN ('active', 'inactive', 'suspended')),
    trip_active        BOOLEAN DEFAULT FALSE,
    active_trip_id     TEXT,
    is_reserved        BOOLEAN DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extras             JSONB DEFAULT '{}'::jsonb          -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_driver_profiles_email ON driver_profiles(email);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_assigned_bus_id ON driver_profiles(assigned_bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_assigned_route_id ON driver_profiles(assigned_route_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_bus_id ON driver_profiles(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_route_id ON driver_profiles(route_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_shift ON driver_profiles(shift);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_status ON driver_profiles(status);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_driver_id ON driver_profiles(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_profiles_is_reserved ON driver_profiles(is_reserved);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_driver_profiles_updated_at ON driver_profiles;
CREATE TRIGGER set_driver_profiles_updated_at
    BEFORE UPDATE ON driver_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
