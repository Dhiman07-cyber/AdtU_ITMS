-- =============================================================================
-- D4 Application — Migration
-- Version  : 1.0.0
-- Domain   : D4 Application
-- Migration: Firestore applications collection → PostgreSQL applications table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Application is a WORKFLOW domain. It orchestrates other domains (Identity,
-- Payment, Audit, Notification) but never writes to their tables directly.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime
-- owner for application lifecycle data.
--
-- Query-critical form_data sub-fields are promoted to typed columns.
-- Non-queried fields remain in form_data JSONB.
--
-- audit_logs is NOT stored here — Audit domain owns audit trail.
-- state_history IS stored here — it belongs to the workflow state machine.
--
-- Applications are DELETED after approval/rejection. The audit record
-- captures the application snapshot. This is an explicit architectural
-- decision (see D4 design freeze).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER TRIGGER (idempotent — safe if already defined by D1/D2/D3/D6/D7)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: applications
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
    -- ── Primary Key ──────────────────────────────────────────────────────
    application_id              TEXT PRIMARY KEY,

    -- ── Identity ─────────────────────────────────────────────────────────
    applicant_uid               TEXT NOT NULL,
    applicant_email             TEXT,
    email                       TEXT,

    -- ── Promoted Form Data (query-critical only) ────────────────────────
    route_id                    TEXT,
    bus_id                      TEXT,
    stop_id                     TEXT,
    shift                       TEXT CHECK (shift IN ('Morning', 'Evening', 'Both')),
    session_start_year          INTEGER,
    session_end_year            INTEGER,
    application_type            TEXT CHECK (application_type IN (
                                    'fresh', 'renewal', 'renewal_after_soft_block', 'future'
                                )),
    eligible_approval           TIMESTAMPTZ,

    -- ── Full Form Data (JSONB — backward compat + non-queried fields) ───
    form_data                   JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- ── State Machine ────────────────────────────────────────────────────
    state                       TEXT NOT NULL DEFAULT 'draft'
                                    CHECK (state IN (
                                        'draft', 'awaiting_verification', 'verified',
                                        'submitted', 'verified_upcoming',
                                        'pending_seat_allocation', 'approved',
                                        'rejected', 'cancelled', 'expired'
                                    )),
    state_history               JSONB DEFAULT '[]'::jsonb,

    -- ── Verification ─────────────────────────────────────────────────────
    pending_verifier            TEXT,
    verification_attempts       INTEGER NOT NULL DEFAULT 0,
    verified_at                 TIMESTAMPTZ,
    verified_by                 TEXT,
    verified_by_id              TEXT,

    -- ── Submission ───────────────────────────────────────────────────────
    submitted_at                TIMESTAMPTZ,
    submitted_by                TEXT,

    -- ── Approval / Rejection ─────────────────────────────────────────────
    approved_at                 TIMESTAMPTZ,
    approved_by                 TEXT,
    approved_by_id              TEXT,

    -- ── Metadata ─────────────────────────────────────────────────────────
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by                  TEXT NOT NULL,

    -- ── Version ──────────────────────────────────────────────────────────
    application_version         INTEGER,

    -- ── Capacity / Reassignment ──────────────────────────────────────────
    needs_capacity_review       BOOLEAN DEFAULT FALSE,
    reassignment_reason         TEXT CHECK (reassignment_reason IN (
                                    'bus_full_only_option', 'bus_full_alternatives_exist', 'no_issue'
                                )),
    has_alternative_buses       BOOLEAN,

    -- ── Supabase Ledger Tracking ─────────────────────────────────────────
    payment_id                  TEXT,

    -- ── Phase 2: Categorisation ─────────────────────────────────────────
    target_session              JSONB,
    linked_student_uid          TEXT,

    -- ── Approval extras (future-session path) ────────────────────────────
    verified_upcoming_at        TIMESTAMPTZ,
    verified_upcoming_by        TEXT,
    verified_upcoming_by_id     TEXT,
    pending_seat_allocation_at  TIMESTAMPTZ,

    -- ── Submission extras (submit-final path) ────────────────────────────
    assigned_driver_id          TEXT,
    assigned_driver_name        TEXT,

    -- ── Expiry (cron path) ──────────────────────────────────────────────
    expired_at                  TIMESTAMPTZ,
    expiry_reason               TEXT,
    eligible_reminder_sent_at   TIMESTAMPTZ,

    -- ── Idempotency / Processing Lock (lease-based) ─────────────────────
    processing_lock             TEXT,
    processing_started_at       TIMESTAMPTZ,
    processing_lease_expires_at TIMESTAMPTZ,
    processing_completed_at     TIMESTAMPTZ,
    processing_result           TEXT CHECK (processing_result IN ('success', 'failed', 'conflict')),

    -- ── Backward Compatibility ───────────────────────────────────────────
    extras                      JSONB DEFAULT '{}'::jsonb
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
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

-- Composite index for cron upcoming pass
CREATE INDEX IF NOT EXISTS idx_applications_upcoming_pass
  ON applications(state, application_type, eligible_approval)
  WHERE state = 'submitted' AND application_type = 'future';

-- Lock recovery index
CREATE INDEX IF NOT EXISTS idx_applications_lock_expiry
  ON applications(processing_lease_expires_at)
  WHERE processing_lock IS NOT NULL AND processing_completed_at IS NULL;

-- GIN for JSONB queries
CREATE INDEX IF NOT EXISTS idx_applications_form_data ON applications USING GIN (form_data);
CREATE INDEX IF NOT EXISTS idx_applications_target_session ON applications USING GIN (target_session);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_applications_updated_at ON applications;
CREATE TRIGGER set_applications_updated_at
    BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
