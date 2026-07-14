-- =============================================================================
-- D11 Administration & System Configuration — PostgreSQL schema
-- Version  : 1.0.0
-- Domain   : D11 Administration & System Configuration
--
-- DESIGN RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. D11 owns configuration data and operational markers.
-- 2. Entity data (students, buses, routes, etc.) belongs to their domains.
-- 3. configuration: flexible JSONB documents keyed by config_key.
-- 4. markers: operational gates keyed by marker_key, support upsert.
-- 5. updated_by_uid is metadata only — no foreign key constraint.
-- 6. settings/deadline is ALREADY in academic_calendar_config (D2).
-- =============================================================================
-- OWNERSHIP BOUNDARY
-- ─────────────────────────────────────────────────────────────────────────────
-- D11 is the canonical owner of system_config and system_markers.
-- Other domains MUST access configuration through the Admin domain API
-- (getSystemConfig, findMarker, upsertMarker, etc.).
-- No domain may query these tables directly except D11's repository.
-- =============================================================================
-- ─────────────────────────────────────────────────────────────────────────────
-- Table: system_config
--
-- MIGRATION SOURCE: Firestore 'settings' collection (config, landing, ui,
--   privacy, terms documents)
-- KEY PATTERN: config_key is the document ID from Firestore.
--
-- PRODUCTION QUERY PATTERNS:
-- 1. config: WHERE config_key = 'config' (getSystemConfig)
-- 2. landing: WHERE config_key = 'landing' (getLandingConfig)
-- 3. ui: WHERE config_key = 'ui' (getUiConfig)
-- 4. privacy: WHERE config_key = 'privacy' (getLegalConfig)
-- 5. terms: WHERE config_key = 'terms' (getLegalConfig)
-- =============================================================================
CREATE TABLE public.system_config (
  config_key     TEXT PRIMARY KEY,
  config_data    JSONB NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_uid TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: system_markers
--
-- MIGRATION SOURCE: Firestore 'settings/activation_{year}' and
--   'settings/soft_block_completed_{year}' documents.
-- KEY PATTERN: 'activation_{year}' or 'soft_block_completed_{year}'.
--
-- PRODUCTION QUERY PATTERNS:
-- 1. activation: WHERE marker_key = 'activation_{year}' (existence check)
-- 2. soft_block: WHERE marker_key = 'soft_block_completed_{year}' (gate check)
-- Both support upsert (INSERT ... ON CONFLICT DO UPDATE).
-- =============================================================================
CREATE TABLE public.system_markers (
  marker_key  TEXT PRIMARY KEY,
  marker_data JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
--
-- Server-side access only via service_role key.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role bypass" ON public.system_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.system_markers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role bypass" ON public.system_markers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers: auto-set updated_at on every UPDATE
-- Reuse the project's canonical trg_set_updated_at() function already used
-- across existing PostgreSQL domains.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_system_config_updated_at
  BEFORE UPDATE ON public.system_config
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_system_markers_updated_at
  BEFORE UPDATE ON public.system_markers
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
--
-- GIN index on config_data for JSONB queries (future flexibility).
-- No special index needed on markers — PK lookup is sufficient for
-- existence checks and upserts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_system_config_data ON public.system_config USING GIN (config_data);
