-- =============================================================================
-- C3 — Add last_processed_application_id to student_profiles
--
-- Purpose: Audit trail. Records which application last updated the student
-- profile. Written atomically with application finalization in
-- finalize_application_approval RPC for traceability and debugging.
-- =============================================================================

ALTER TABLE student_profiles
    ADD COLUMN IF NOT EXISTS last_processed_application_id TEXT;

COMMENT ON COLUMN student_profiles.last_processed_application_id
    IS 'Application ID that most recently updated this student profile. Audit metadata for traceability — written atomically with application finalization.';
