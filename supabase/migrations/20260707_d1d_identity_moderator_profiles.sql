-- =============================================================================
-- D1 Identity — Moderator Profiles Migration
-- Version  : 1.0.0
-- Domain   : D1 Identity (Slice 4: moderator_profiles)
-- Migration: Firestore moderators collection → PostgreSQL moderator_profiles table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per moderator at moderators/{uid} with:
--   id, uid, name, fullName, email, phone, employeeId, staffId,
--   managingTeam, teamName, status, profilePhotoUrl, permissions (embedded),
--   permissionsUpdatedAt, permissionsUpdatedBy, createdAt, updatedAt, + extras
--
-- Permissions are EMBEDDED as a JSONB object in the moderator document.
-- They are NOT a separate subcollection. The 27 boolean permission fields
-- are stored as a nested JSONB object matching the ModeratorPermissions interface.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: moderator_profiles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderator_profiles (
    uid                    TEXT PRIMARY KEY,              -- Firebase Auth UID (FK to users.uid)
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
    permissions            JSONB DEFAULT '{}'::jsonb,     -- embedded ModeratorPermissions object
    permissions_updated_at TIMESTAMPTZ,
    permissions_updated_by TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extras                 JSONB DEFAULT '{}'::jsonb      -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_email ON moderator_profiles(email);
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_status ON moderator_profiles(status);
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_employee_id ON moderator_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_moderator_profiles_managing_team ON moderator_profiles(managing_team);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_moderator_profiles_updated_at ON moderator_profiles;
CREATE TRIGGER set_moderator_profiles_updated_at
    BEFORE UPDATE ON moderator_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
