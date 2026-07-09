-- =============================================================================
-- D1 Identity — Unauth Users Migration
-- Version  : 1.0.0
-- Domain   : D1 Identity (Slice 7: unauth_users)
-- Migration: Firestore unauthUsers collection → PostgreSQL unauth_users table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per unregistered user at unauthUsers/{uid}.
-- These are transient records — created on first Google sign-in, deleted after
-- 45 days of inactivity, or when application is approved/rejected.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: unauth_users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unauth_users (
    uid                TEXT PRIMARY KEY,                 -- Firebase Auth UID
    email              TEXT NOT NULL,
    display_name       TEXT,
    photo_url          TEXT,
    status             TEXT DEFAULT 'pending_application',
    needs_application  BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extras             JSONB DEFAULT '{}'::jsonb          -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_unauth_users_email ON unauth_users(email);
CREATE INDEX IF NOT EXISTS idx_unauth_users_status ON unauth_users(status);
CREATE INDEX IF NOT EXISTS idx_unauth_users_last_login_at ON unauth_users(last_login_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_unauth_users_updated_at ON unauth_users;
CREATE TRIGGER set_unauth_users_updated_at
    BEFORE UPDATE ON unauth_users
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
