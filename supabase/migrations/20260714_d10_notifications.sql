-- =============================================================================
-- D10 Notifications — PostgreSQL schema for notification/communication domain
-- Version  : 1.1.0
-- Domain   : D10 Notification & Communication
--
-- DESIGN RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. D10 owns only notification business data.
-- 2. D10 reads other domains' data through public APIs, not Firestore.
-- 3. D10 does NOT write to other domains' Firestore collections.
-- 4. Firestore remains the active runtime source until D10.3 cutover.
-- 5. Repository is persistence-only; business logic lives in services.
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────────
-- Schema: notifications
--
-- MIGRATION SOURCE: Firestore 'notifications' collection
-- ACTIVE RUNTIME: Firestore (until D10.3 cutover)
--
-- PRODUCTION QUERY PATTERNS (validated in D10.1A):
-- 1. NotificationContext: WHERE recipient_ids @> '{uid}' OR sender_user_id = uid
--    ORDER BY created_at DESC LIMIT 50
-- 2. cleanup-helpers: WHERE recipient_ids @> '{userId}' (batch delete)
-- 3. cleanup-helpers: WHERE sender_user_id = userId (batch delete)
-- 4. notification-expiry: Full table scan, filter by expires_at
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Notifications table
--
-- DENormalization decisions (all intentional):
--   - sender JSONB: always read together, never queried by sub-fields
--   - target JSONB: never queried, only used in visibility logic
--   - recipient_ids TEXT[]: queried with array-contains (@>), never joined
--   - read_by_user_ids TEXT[]: queried with array-contains (@>), never joined
--   - hidden_for_user_ids TEXT[]: never queried, only read/written as whole array
--   - auto_injected_recipient_ids TEXT[]: never queried, only read as whole array
--   - edit_history JSONB[]: only read when viewing single notification
--   - metadata JSONB: flexible schema, never queried by sub-fields
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ─── Content ───────────────────────────────────────────────────────────────
  title               VARCHAR(500) NOT NULL,
  content             TEXT NOT NULL,

  -- ─── Type ──────────────────────────────────────────────────────────────────
  -- TEXT with sanity constraint: prevents empty/garbage values but does not
  -- enumerate allowed types. New types (warning, success, trip, renewal,
  -- payment) can be added without a migration. Service layer enforces
  -- semantic validation; this constraint is a safety net only.
  type                TEXT NOT NULL DEFAULT 'notice'
                      CHECK (type <> '' AND length(type) > 0),

  -- ─── Sender ────────────────────────────────────────────────────────────────
  -- JSONB because sender is always read as a unit, never queried by sub-fields
  -- except sender_user_id which we extract for the indexed query pattern:
  --   WHERE sender_user_id = uid
  sender              JSONB NOT NULL,

  -- Stored generated column for the one indexed query pattern.
  -- Supports: WHERE sender_user_id = uid (NotificationContext, cleanup-helpers)
  sender_user_id      TEXT GENERATED ALWAYS AS (sender->>'userId') STORED,

  -- NOTE: sender.userRole may be 'system' (reassignment-service writes this).
  -- We preserve 'system' as-is during migration; it is semantically distinct
  -- from 'admin' and must NOT be mapped to 'admin'. Audit history depends on
  -- this distinction. The CHECK on userRole is application-level, not schema.

  -- ─── Target ────────────────────────────────────────────────────────────────
  -- JSONB because target is never queried, only used in visibility logic.
  -- Shape varies by target.type:
  --   all_users: {}
  --   all_role: { roleFilter: 'student' }
  --   shift_based: { shift: 'morning' }
  --   bus_based: { busIds: ['bus_1', 'bus_2'] }
  --   route_based: { routeIds: ['route_1'] }
  --   specific_users: { specificUserIds: ['uid1', 'uid2'] }
  target              JSONB NOT NULL,

  -- ─── Recipient Arrays ─────────────────────────────────────────────────────
  -- All arrays stored as TEXT[] because production queries use array-contains
  -- (@> operator), never joins. GIN index supports this pattern.
  --
  -- recipient_ids: All intended recipients (resolved at write time).
  --   Query: WHERE recipient_ids @> '{uid}' (NotificationContext, cleanup-helpers)
  recipient_ids       TEXT[] NOT NULL DEFAULT '{}',

  -- auto_injected_recipient_ids: Admin/moderator auto-receives copies.
  --   Never queried; only read as whole array for visibility checks.
  auto_injected_recipient_ids TEXT[] NOT NULL DEFAULT '{}',

  -- read_by_user_ids: Users who have read this notification.
  --   Never queried; only checked with .includes() in application code.
  --   Typically small (1-5 users per notification).
  read_by_user_ids    TEXT[] NOT NULL DEFAULT '{}',

  -- hidden_for_user_ids: Users who hid this notification.
  --   Never queried; only read/written as whole array.
  hidden_for_user_ids TEXT[] NOT NULL DEFAULT '{}',

  -- ─── Flags ─────────────────────────────────────────────────────────────────
  is_edited           BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted_globally BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_user_id  TEXT,
  deleted_at          TIMESTAMPTZ,

  -- ─── Timestamps ───────────────────────────────────────────────────────────
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ,

  -- expires_at: Unified field. Firestore writers used both 'expiryAt' and
  -- 'expiresAt'. Migration normalizes to 'expires_at'. The notification-expiry
  -- cleanup code checks both; PG cleanup will use this single field.
  expires_at          TIMESTAMPTZ,

  -- ─── Edit History ─────────────────────────────────────────────────────────
  -- JSONB array because edit history is only read when viewing a single
  -- notification, never queried across the collection.
  -- Shape: [{ editedAt: ISO8601, previousContent: string, editedBy: string }]
  edit_history        JSONB DEFAULT '[]'::jsonb,

  -- ─── Metadata ─────────────────────────────────────────────────────────────
  -- Flexible JSONB for additional data (messageId, actionUrl, priority, etc.)
  -- Never queried by sub-fields; only read as whole object.
  metadata            JSONB DEFAULT '{}'::jsonb
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
--
-- Each index maps to a validated production query pattern.
-- No speculative indexes; add when query pattern is proven.
-- ─────────────────────────────────────────────────────────────────────────────

-- Query: WHERE recipient_ids @> '{uid}' ORDER BY created_at DESC LIMIT 50
-- Supports: NotificationContext one-shot and realtime queries
CREATE INDEX idx_notifications_recipient_ids
  ON public.notifications USING GIN (recipient_ids);

-- Query: WHERE sender_user_id = uid ORDER BY created_at DESC
-- Supports: NotificationContext sender filter, cleanup-helpers sender delete
CREATE INDEX idx_notifications_sender_user_id
  ON public.notifications (sender_user_id);

-- Query: ORDER BY created_at DESC (already used by LIMIT queries)
-- Supports: NotificationContext ordering
CREATE INDEX idx_notifications_created_at
  ON public.notifications (created_at DESC);

-- Query: WHERE expires_at IS NOT NULL AND expires_at <= now()
-- Supports: notification-expiry cleanup (every 3 days)
CREATE INDEX idx_notifications_expires_at
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
--
-- RLS is enabled with a service-role bypass for server-side operations.
-- Per-user policies will be introduced in D10.5 when write paths are
-- redirected to PostgreSQL. Until then, all access is server-side only
-- via the service-role key, which bypasses RLS through this policy.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role bypass" ON public.notifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: auto-set updated_at on every UPDATE
--
-- PostgreSQL owns the clock. Application code never needs to set updated_at;
-- this trigger ensures a single source of truth for timestamps regardless of
-- application/server clock drift.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_notifications_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_notifications_updated_at();
