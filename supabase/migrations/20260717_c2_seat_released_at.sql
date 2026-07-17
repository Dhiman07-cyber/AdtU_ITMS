-- =============================================================================
-- C2 Critical Fix — Add seat_released_at to student_profiles
-- Version  : 1.0.0
-- Category : Schema Correctness (Bucket 3)
-- Priority : CRITICAL (P0)
--
-- PROBLEM
-- ─────────────────────────────────────────────────────────────────────────────
-- bus_occupancy_counts_view and bus_stop_counts_view (20260715_d1b) reference
-- seat_released_at but the column was never added to student_profiles.
-- Both views throw:  column "seat_released_at" does not exist
-- at runtime, breaking all capacity queries and bus load reconciliation.
--
-- EVIDENCE
-- ─────────────────────────────────────────────────────────────────────────────
-- identity.repository.pg.ts:502 — reads seatReleasedAt from row
-- admin-reconcile-bus-loads.ts:70 — filters on s.seatReleasedAt
-- capacity-flags.ts:57 — reads studentData.seatReleasedAt
-- cleanup-expired-students/route.ts:307, 365 — writes seatReleasedAt
-- delete-student/route.ts:78 — writes seatReleasedAt
-- renew-services/route.ts:265 — writes seatReleasedAt
-- application.service.ts:354 — reads seatReleasedAt
-- integrity-detector.ts:106 — reads seatReleasedAt
--
-- SOLUTION
-- ─────────────────────────────────────────────────────────────────────────────
-- Add the column and backfill from extras JSONB (migration compatibility).
-- Recreate both views so they are authoritative against the typed column.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- ADD COLUMN
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS seat_released_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL from extras JSONB (if seatReleasedAt was written there before)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.student_profiles
SET seat_released_at = (extras->>'seatReleasedAt')::TIMESTAMPTZ
WHERE seat_released_at IS NULL
  AND extras ? 'seatReleasedAt'
  AND (extras->>'seatReleasedAt') IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEX: status + seat_released_at is the join condition for both views
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_student_profiles_seat_released_at
  ON public.student_profiles (seat_released_at)
  WHERE seat_released_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RECREATE VIEWS (now column exists — was referencing a ghost column before)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.bus_occupancy_counts_view AS
SELECT
  assigned_bus_id AS bus_id,
  COUNT(*)        AS total_count,
  SUM(CASE WHEN (shift = 'Morning' OR shift = 'Both') THEN 1 ELSE 0 END) AS morning_count,
  SUM(CASE WHEN (shift = 'Evening' OR shift = 'Both') THEN 1 ELSE 0 END) AS evening_count
FROM public.student_profiles
WHERE (status = 'active')
   OR (status IN ('soft_blocked', 'pending_deletion') AND seat_released_at IS NULL)
GROUP BY assigned_bus_id;

CREATE OR REPLACE VIEW public.bus_stop_counts_view AS
SELECT
  assigned_bus_id AS bus_id,
  stop_id,
  COUNT(*) AS stop_count
FROM public.student_profiles
WHERE ((status = 'active')
   OR (status IN ('soft_blocked', 'pending_deletion') AND seat_released_at IS NULL))
  AND stop_id IS NOT NULL
GROUP BY assigned_bus_id, stop_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- ADD seat_released_at to STUDENT_FIELD_MAP in identity.repository.pg.ts
-- NOTE: Application code must update student.seatReleasedAt → typed column.
--       The identity repo already reads it at line 502; backfill ensures no data loss.
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.student_profiles.seat_released_at IS
  'Timestamp when the student''s bus seat was released (soft_blocked or pending_deletion). '
  'NULL means seat is still occupied. Used by occupancy views and capacity reconciliation.';
