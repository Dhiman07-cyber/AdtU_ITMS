/**
 * D12 Audit Repository — PG persistence only.
 *
 * ── CONTRACT ──────────────────────────────────────────────────────────────────
 *
 * audit_events is IMMUTABLE.
 *
 * Repository exposes:
 *   ✓ INSERT  (pgInsertAuditEvent)
 *   ✓ SELECT  (pgQueryAuditEvents)
 *
 * It intentionally exposes NO:
 *   ✗ get by id
 *   ✗ update
 *   ✗ delete
 *   ✗ upsert
 *
 * Persistence only — no business logic, no validation, no retries.
 * Validation belongs in the service layer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { getSupabaseServer } from '@/lib/supabase-server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditEventInsert {
  action: string;
  category: string;
  severity: string;
  summary: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  target_type: string;
  target_id: string;
  target_name: string;
  metadata: Record<string, unknown>;
}

export interface AuditEventRow {
  id: string;
  action: string;
  category: string;
  severity: string;
  summary: string | null;
  actor_id: string;
  actor_name: string | null;
  actor_role: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditEventFilters {
  category?: string;
  severity?: string;
  actor_role?: string;
  from_date?: string;
  to_date?: string;
}

export interface AuditEventPagination {
  page: number;
  per_page: number;
}

export interface AuditEventQueryResult {
  data: AuditEventRow[];
  total: number;
  page: number;
  per_page: number;
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function mapRowToEvent(row: Record<string, unknown>): AuditEventRow {
  return {
    id: row.id as string,
    action: row.action as string,
    category: row.category as string,
    severity: row.severity as string,
    summary: (row.summary as string) ?? null,
    actor_id: row.actor_id as string,
    actor_name: (row.actor_name as string) ?? null,
    actor_role: row.actor_role as string,
    target_type: (row.target_type as string) ?? null,
    target_id: (row.target_id as string) ?? null,
    target_name: (row.target_name as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.created_at as string,
  };
}

// ─── Insert ──────────────────────────────────────────────────────────────────

export async function pgInsertAuditEvent(
  input: AuditEventInsert
): Promise<string> {
  const db = getSupabaseServer();

  const row = {
    action: input.action,
    category: input.category,
    severity: input.severity,
    summary: input.summary || null,
    actor_id: input.actor_id,
    actor_name: input.actor_name || null,
    actor_role: input.actor_role,
    target_type: input.target_type || null,
    target_id: input.target_id || null,
    target_name: input.target_name || null,
    metadata: input.metadata || {},
  };

  const { data, error } = await db
    .from('audit_events')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    throw new Error(`AuditRepository (PG) insert failed: ${error.message}`);
  }

  return data.id as string;
}

// ─── Query with filters + pagination ─────────────────────────────────────────

export async function pgQueryAuditEvents(
  filters: AuditEventFilters,
  pagination: AuditEventPagination
): Promise<AuditEventQueryResult> {
  const db = getSupabaseServer();

  let query = db
    .from('audit_events')
    .select('*', { count: 'exact' });

  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.severity) {
    query = query.eq('severity', filters.severity);
  }
  if (filters.actor_role) {
    query = query.eq('actor_role', filters.actor_role);
  }
  if (filters.from_date) {
    query = query.gte('created_at', filters.from_date);
  }
  if (filters.to_date) {
    query = query.lte('created_at', filters.to_date);
  }

  const offset = (pagination.page - 1) * pagination.per_page;

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + pagination.per_page - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`AuditRepository (PG) query failed: ${error.message}`);
  }

  return {
    data: (data ?? []).map(mapRowToEvent),
    total: count || 0,
    page: pagination.page,
    per_page: pagination.per_page,
  };
}
