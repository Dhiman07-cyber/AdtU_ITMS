-- =============================================================================
-- D2 Calendar — PostgreSQL Migration
-- Version  : 1.0.0
-- Domain   : D2 Calendar
-- Migration: Firestore settings/deadline → PostgreSQL academic_calendar_config
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document (settings/deadline) containing:
--   • academicSessionStart { month, day }  ← the ONLY persistent anchor
--   • urgentWarningThreshold { days }
--   • softBlock.warningText
--   • hardDelete.criticalWarningText
--   • contactInfo { officeName, phone, email, officeHours, address,
--                   visitInstructions }
--   • landingPage, applicationProcess, statistics (JSON blobs)
--   • version, description, lastUpdated, lastUpdatedBy
--
-- All lifecycle dates (expiry, softBlock, hardDelete, reminders…) are
-- DERIVED at runtime by deriveAcademicLifecycle() and are NOT persisted.
-- PostgreSQL schema follows the same rule: no computed date columns.
--
-- SINGLE-ROW TABLE — the system always has exactly one active config.
-- A singleton is enforced by a partial unique index on the constant literal.
-- =============================================================================

-- Ensure pgcrypto is available (already enabled by COMPLETE_SCHEMA.sql)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: academic_calendar_config
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academic_calendar_config (
    -- Surrogate PK — kept as UUID for uniform PK strategy across all tables
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Singleton guard: only one row may exist where is_active = TRUE
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    -- ── Core calendar anchor (the ONLY values Firestore actually stored) ──────
    -- month: 0-indexed (0 = January, 6 = July, 11 = December)
    session_start_month SMALLINT NOT NULL
        CONSTRAINT chk_session_start_month CHECK (session_start_month BETWEEN 0 AND 11),
    -- day: 1-indexed day of month
    session_start_day   SMALLINT NOT NULL
        CONSTRAINT chk_session_start_day   CHECK (session_start_day   BETWEEN 1 AND 31),

    -- ── Threshold ─────────────────────────────────────────────────────────────
    urgent_warning_days SMALLINT NOT NULL DEFAULT 15
        CONSTRAINT chk_urgent_warning_days CHECK (urgent_warning_days > 0),

    -- ── Human-readable warning text (admin-configurable) ─────────────────────
    soft_block_warning_text     TEXT NOT NULL DEFAULT 'Your bus service has expired. Please renew.',
    hard_delete_critical_text   TEXT NOT NULL DEFAULT 'Warning: Account will be permanently deleted.',

    -- ── Contact information ───────────────────────────────────────────────────
    contact_office_name         TEXT,
    contact_phone               TEXT,
    contact_email               TEXT,
    contact_office_hours        TEXT,
    contact_address             TEXT,
    contact_visit_instructions  TEXT,

    -- ── Flexible JSON blobs for UI content ───────────────────────────────────
    -- These mirror Firestore fields that carry landing page / application
    -- process / statistics content edited by admins.
    landing_page        JSONB,
    application_process JSONB,
    statistics          JSONB,

    -- ── Versioning & audit ────────────────────────────────────────────────────
    config_version      TEXT NOT NULL DEFAULT '1.0.0',
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          TEXT         -- Firebase UID of the last admin who saved

);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
-- Singleton constraint: at most one row with is_active = TRUE
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_calendar_config_singleton
    ON academic_calendar_config (is_active)
    WHERE (is_active = TRUE);

-- Audit queries: find the most recently updated config
CREATE INDEX IF NOT EXISTS idx_academic_calendar_config_updated_at
    ON academic_calendar_config (updated_at DESC);

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

DROP TRIGGER IF EXISTS set_academic_calendar_config_updated_at
    ON academic_calendar_config;

CREATE TRIGGER set_academic_calendar_config_updated_at
    BEFORE UPDATE ON academic_calendar_config
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: migration_log
-- Tracks domain-level migrations executed by MigrationRunner.
-- One row per migration run; used by the MigrationStore contract.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS migration_log (
    id           TEXT        PRIMARY KEY,   -- matches MigrationDefinition.id
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

CREATE INDEX IF NOT EXISTS idx_migration_log_domain_id
    ON migration_log (domain_id);

CREATE INDEX IF NOT EXISTS idx_migration_log_status
    ON migration_log (status);

DROP TRIGGER IF EXISTS set_migration_log_updated_at ON migration_log;

CREATE TRIGGER set_migration_log_updated_at
    BEFORE UPDATE ON migration_log
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
-- Both tables are server-side only (accessed via service-role key).
-- RLS is enabled but all access is via BYPASSRLS service role — no policies
-- needed for anon/authenticated roles.
ALTER TABLE academic_calendar_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_log            ENABLE ROW LEVEL SECURITY;

-- Service-role bypass is implicit in Supabase. No anon policy = no anon access.

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE  academic_calendar_config IS
    'D2 Calendar domain — singleton configuration. Exactly one row with is_active = TRUE at all times. '
    'Stores only the academic session anchor (month/day); all lifecycle dates are derived at runtime.';

COMMENT ON COLUMN academic_calendar_config.session_start_month IS
    '0-indexed month of academic session start (0=Jan … 11=Dec). Default 6 = July.';
COMMENT ON COLUMN academic_calendar_config.session_start_day IS
    'Day of month (1-31) of academic session start.';
COMMENT ON COLUMN academic_calendar_config.urgent_warning_days IS
    'Days before hard-delete date when critical deletion warnings begin.';
COMMENT ON COLUMN academic_calendar_config.landing_page IS
    'Opaque JSON blob containing UI landing page copy (heroTitle, heroSubtitle, etc.).';
COMMENT ON COLUMN academic_calendar_config.application_process IS
    'Opaque JSON blob containing application process steps shown on landing page.';
COMMENT ON COLUMN academic_calendar_config.statistics IS
    'Opaque JSON blob containing statistics displayed on landing page.';

COMMENT ON TABLE  migration_log IS
    'Infrastructure — tracks MigrationRunner executions. One row per migration run.';
