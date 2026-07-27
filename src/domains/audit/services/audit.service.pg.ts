/**
 * D12 Audit Service — business layer for PostgreSQL audit events.
 *
 * ONE canonical audit capability: create immutable audit events.
 * Never throws. Returns AuditResult with success flag and error string.
 *
 * No Firestore fallback. No outbox. No recovery.
 * PG is the single source of truth.
 */
import type {
	AuditEventFilters,
	AuditEventInsert,
	AuditEventPagination,
	AuditEventQueryResult,
	AuditEventRow,
} from '../repositories/audit.repository.pg';
import {
	pgInsertAuditEvent,
	pgQueryAuditEvents,
} from '../repositories/audit.repository.pg';

// ─── Re-exports ──────────────────────────────────────────────────────────────

export type {
	AuditEventFilters,AuditEventInsert,AuditEventPagination,
	AuditEventQueryResult,AuditEventRow
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditActorRole = 'admin' | 'moderator' | 'system';

// ─── Result type ─────────────────────────────────────────────────────────────

export interface AuditResult {
  success: boolean;
  id?: string;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Canonical actor for automated / cron operations. */
export const SYSTEM_ACTOR = {
  id: 'system',
  name: 'System (automated)',
  role: 'system',
} as const;

const VALID_CATEGORIES = [
  'applications',
  'renewals',
  'reassignments',
  'additions',
  'refinements',
  'system',
] as const;

const VALID_SEVERITIES = ['low', 'medium', 'high'] as const;

const VALID_ACTOR_ROLES = ['admin', 'moderator', 'system'] as const;

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Append an immutable audit event to the trail.
 *
 * Best-effort: never throws. Returns AuditResult with success/error.
 * Callers should NOT block on this result — audit is informational.
 */
export async function createAuditEvent(
  input: AuditEventInsert
): Promise<AuditResult> {
  // ── Validate ──
  if (!(VALID_CATEGORIES as readonly string[]).includes(input.category)) {
    return {
      success: false,
      error: `Invalid audit category: ${input.category}`,
    };
  }

  if (!(VALID_SEVERITIES as readonly string[]).includes(input.severity)) {
    return {
      success: false,
      error: `Invalid audit severity: ${input.severity}`,
    };
  }

  if (!(VALID_ACTOR_ROLES as readonly string[]).includes(input.actor_role)) {
    return {
      success: false,
      error: `Invalid audit actor_role: ${input.actor_role}`,
    };
  }

  // ── Persist ──
  try {
    const id = await pgInsertAuditEvent(input);
    return { success: true, id };
  } catch (e) {
    console.error('[Audit] createAuditEvent failed:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Database insert failed',
    };
  }
}

/**
 * Query audit events with filters and pagination.
 */
export async function queryAuditEvents(
  filters: AuditEventFilters,
  pagination: AuditEventPagination
): Promise<AuditEventQueryResult> {
  return pgQueryAuditEvents(filters, pagination);
}
