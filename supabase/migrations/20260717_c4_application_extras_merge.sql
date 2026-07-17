-- =============================================================================
-- C4 Critical Fix — Atomic JSONB Extras Merge for Applications
-- Version  : 1.0.0
-- Category : Transaction Safety (Bucket 6)
-- Priority : CRITICAL (P0)
--
-- PROBLEM
-- ─────────────────────────────────────────────────────────────────────────────
-- application.repository.pg.ts::pgUpdate (lines 317-328) uses a read-before-write
-- to merge extras JSONB:
--   1. Read current extras (SELECT extras FROM applications)
--   2. Merge in JS
--   3. Write back (UPDATE applications SET extras = merged)
--
-- This is a TOCTOU race: two concurrent state transitions can overwrite each
-- other's extras fields between steps 1 and 3.
--
-- All other domains (student, driver, moderator, admin, bus, user) were fixed
-- in 20260717_c1_atomic_extras_merge.sql. Applications was missed.
--
-- EVIDENCE
-- ─────────────────────────────────────────────────────────────────────────────
-- application.repository.pg.ts:317-328
--   if (row.extras) {
--     const { data: current } = await db.from('applications')
--       .select('extras').eq('application_id', applicationId).maybeSingle();
--     if (!readError && current) {
--       row.extras = { ...(current.extras || {}), ...row.extras };  // ← TOCTOU
--     }
--   }
--
-- SOLUTION
-- ─────────────────────────────────────────────────────────────────────────────
-- Create merge_application_extras RPC.
-- application.repository.pg.ts::pgUpdate will be updated to use it.
-- =============================================================================

CREATE OR REPLACE FUNCTION merge_application_extras(
  p_application_id TEXT,
  p_extras         JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE applications
  SET extras     = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE application_id = p_application_id;
END;
$$;

COMMENT ON FUNCTION merge_application_extras IS
  'Atomically merges JSONB data into applications.extras. Replaces unsafe read-before-write pattern.';
