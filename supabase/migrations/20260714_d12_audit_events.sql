-- D12: Audit Events — immutable business audit trail
-- Append-only. No UPDATE. No DELETE. No TTL.
-- Every row is an immutable historical fact.

CREATE TABLE IF NOT EXISTS public.audit_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action         TEXT NOT NULL,
  category       TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'medium',
  summary        TEXT,
  actor_id       TEXT NOT NULL,
  actor_name     TEXT,
  actor_role     TEXT NOT NULL DEFAULT 'admin',
  target_type    TEXT,
  target_id      TEXT,
  target_name    TEXT,
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Query: UI tab filter (category) + time sort
-- Evidence: route.ts:41,38 — where('category').orderBy('createdAt','desc')
CREATE INDEX idx_audit_events_category_ts
  ON public.audit_events (category, created_at DESC);

-- Query: severity dropdown filter + time sort
-- Evidence: route.ts:44,38 — where('severity').orderBy('createdAt','desc')
CREATE INDEX idx_audit_events_severity_ts
  ON public.audit_events (severity, created_at DESC);

-- Query: actor role filter + time sort
-- Evidence: route.ts:47,38 — where('performedByRole').orderBy('createdAt','desc')
CREATE INDEX idx_audit_events_actor_role_ts
  ON public.audit_events (actor_role, created_at DESC);

-- Query: default sort (no filter applied)
-- Evidence: route.ts:38 — orderBy('createdAt','desc') always applied
CREATE INDEX idx_audit_events_created_at
  ON public.audit_events (created_at DESC);

-- RLS: service-role only (server writes, no client access)
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_service_role_all"
  ON public.audit_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.audit_events IS 'Immutable business audit trail — append-only, no UPDATE/DELETE';
