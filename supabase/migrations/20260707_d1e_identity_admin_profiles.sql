-- =============================================================================
-- D1 Identity — Admin Profiles Migration
-- Version  : 1.0.0
-- Domain   : D1 Identity (Slice 5: admin_profiles)
-- Migration: Firestore admins collection → PostgreSQL admin_profiles table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per admin at admins/{uid} with:
--   uid, email, name, fullName, role, employeeId, createdAt, updatedAt, + extras
--
-- The admins collection is write-once: documents are created via seed script
-- or setup-admin-document API and never updated or deleted through application code.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: admin_profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_profiles (
    uid                TEXT PRIMARY KEY,                 -- Firebase Auth UID (FK to users.uid)
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
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extras             JSONB DEFAULT '{}'::jsonb          -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_admin_profiles_email ON admin_profiles(email);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_employee_id ON admin_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_role ON admin_profiles(role);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_admin_profiles_updated_at ON admin_profiles;
CREATE TRIGGER set_admin_profiles_updated_at
    BEFORE UPDATE ON admin_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
