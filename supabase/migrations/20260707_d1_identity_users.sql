-- =============================================================================
-- D1 Identity — Users Migration
-- Version  : 1.0.0
-- Domain   : D1 Identity (Slice 1: users)
-- Migration: Firestore users collection → PostgreSQL users table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per user at users/{uid} with:
--   uid, email, name, role, createdAt, lastLoginAt, [key: string]: any
--
-- Every Firestore write path writes exactly: { uid, email, name, role, createdAt }
-- Only create-first-admin adds extra fields: firstAdmin, busFee, busFeeUpdatedAt, busFeeVersion
-- Only unauth-users/cleanup adds: lastLoginAt, profilePhotoUrl
--
-- PostgreSQL schema captures the universal 5-field identity record.
-- extras JSONB captures unmapped Firestore fields for migration compatibility.
-- extras is NOT a permanent dumping ground — fields get promoted to typed columns.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    uid          TEXT PRIMARY KEY,                    -- Firebase Auth UID
    email        TEXT NOT NULL,
    name         TEXT NOT NULL,                       -- canonical display name
    role         TEXT NOT NULL
                 CHECK (role IN ('admin', 'moderator', 'driver', 'student')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    extras       JSONB DEFAULT '{}'::jsonb            -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
-- Server-side only (accessed via service-role key).
-- RLS enabled but all access is via BYPASSRLS service role.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE users IS
    'D1 Identity domain — canonical user record. Single source of truth for uid, email, name, role. '
    'Firebase Auth remains the authentication provider; this table stores identity metadata only.';

COMMENT ON COLUMN users.extras IS
    'Migration compatibility JSONB. Captures unmapped Firestore fields (firstAdmin, busFee, profilePhotoUrl, etc.). '
    'Any field that becomes business-critical must be promoted to a typed column and removed from extras.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_user_extras — atomic JSONB merge for extras column
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_user_extras(p_uid TEXT, p_extras JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    UPDATE users
    SET extras = COALESCE(extras, '{}'::jsonb) || p_extras
    WHERE uid = p_uid;
END;
$$;
