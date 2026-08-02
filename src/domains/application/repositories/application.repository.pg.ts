/**
 * D4 Application — PostgreSQL Repository
 *
 * Canonical persistence layer for all Application data.
 * Reads and writes the `applications` table in Supabase PostgreSQL.
 *
 * PERSISTENCE ONLY — no business logic lives here.
 * Business logic (workflow, approval, rejection) remains in ApplicationService.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * PostgreSQL column              → Application field
 * application_id                 → applicationId
 * applicant_uid                  → applicantUid
 * applicant_email                → applicantEmail
 * email                          → email
 * form_data                      → formData (JSONB blob)
 * state                          → state
 * state_history                  → stateHistory (JSONB array)
 * pending_verifier               → pendingVerifier
 * verification_attempts          → verificationAttempts
 * verified_at                    → verifiedAt (ISO string)
 * verified_by                    → verifiedBy
 * verified_by_id                 → verifiedById
 * submitted_at                   → submittedAt (ISO string)
 * submitted_by                   → submittedBy
 * approved_at                    → approvedAt (ISO string)
 * approved_by                    → approvedBy
 * approved_by_id                 → approvedById
 * created_at                     → createdAt (ISO string)
 * updated_at                     → updatedAt (ISO string)
 * created_by                     → createdBy
 * application_version            → applicationVersion
 * needs_capacity_review          → needsCapacityReview
 * reassignment_reason            → reassignmentReason
 * has_alternative_buses          → hasAlternativeBuses
 * payment_id                     → paymentId
 * application_type               → applicationType
 * target_session                 → targetSession (JSONB)
 * eligible_approval              → eligibleApproval (ISO string)
 * linked_student_uid             → linkedStudentUid
 * verified_upcoming_at           → verifiedUpcomingAt (ISO string)
 * verified_upcoming_by           → verifiedUpcomingBy
 * verified_upcoming_by_id        → verifiedUpcomingById
 * pending_seat_allocation_at     → pendingSeatAllocationAt (ISO string)
 * assigned_driver_id             → assignedDriverId
 * assigned_driver_name           → assignedDriverName
 * expired_at                     → expiredAt (ISO string)
 * expiry_reason                  → expiryReason
 * eligible_reminder_sent_at      → eligibleReminderSentAt (ISO string)
 *
 * Promoted form_data sub-fields (typed columns):
 *   route_id, bus_id, stop_name, shift, session_start_year, session_end_year,
 *   application_type, eligible_approval
 *
 * audit_logs is NOT stored here — Audit domain owns audit trail.
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import { normalizeShift } from '@/lib/utils/shift-utils';
import type { Application,ApplicationState,ApplicationType } from '@/lib/types/application';

// ─── Field Map ───────────────────────────────────────────────────────────────

/** Firestore/camelCase field → PostgreSQL snake_case column */
const APPLICATION_FIELD_MAP: Record<string, string> = {
  applicationId: 'application_id',
  applicantUid: 'applicant_uid',
  applicantEmail: 'applicant_email',
  email: 'email',
  state: 'state',
  pendingVerifier: 'pending_verifier',
  verificationAttempts: 'verification_attempts',
  verifiedAt: 'verified_at',
  verifiedBy: 'verified_by',
  verifiedById: 'verified_by_id',
  submittedAt: 'submitted_at',
  submittedBy: 'submitted_by',
  approvedAt: 'approved_at',
  approvedBy: 'approved_by',
  approvedById: 'approved_by_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  createdBy: 'created_by',
  applicationVersion: 'application_version',
  needsCapacityReview: 'needs_capacity_review',
  reassignmentReason: 'reassignment_reason',
  hasAlternativeBuses: 'has_alternative_buses',
  paymentId: 'payment_id',
  applicationType: 'application_type',
  eligibleApproval: 'eligible_approval',
  linkedStudentUid: 'linked_student_uid',
  verifiedUpcomingAt: 'verified_upcoming_at',
  verifiedUpcomingBy: 'verified_upcoming_by',
  verifiedUpcomingById: 'verified_upcoming_by_id',
  pendingSeatAllocationAt: 'pending_seat_allocation_at',
  assignedDriverId: 'assigned_driver_id',
  assignedDriverName: 'assigned_driver_name',
  expiredAt: 'expired_at',
  expiryReason: 'expiry_reason',
  eligibleReminderSentAt: 'eligible_reminder_sent_at',
  busId: 'bus_id',
  routeId: 'route_id',
  stop_name: 'stop_name',
  shift: 'shift',
  sessionStartYear: 'session_start_year',
  sessionEndYear: 'session_end_year',
};

/** Known fields that map to typed PostgreSQL columns */
const KNOWN_APPLICATION_FIELDS = new Set(Object.keys(APPLICATION_FIELD_MAP));

/** Fields stored as JSONB (not in FIELD_MAP) */
const JSONB_FIELDS = new Set(['formData', 'stateHistory', 'targetSession']);

/** Fields that are TIMESTAMP in PG but ISO string in domain */
const TIMESTAMP_FIELDS = new Set([
  'verified_at', 'submitted_at', 'approved_at', 'created_at', 'updated_at',
  'eligible_approval', 'verified_upcoming_at', 'pending_seat_allocation_at',
  'expired_at', 'eligible_reminder_sent_at',
]);

// ─── Mappers ─────────────────────────────────────────────────────────────────

/** Convert domain application data to PostgreSQL row */
function pgApplicationToRow(data: Partial<Application>): Record<string, any> {
  const row: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue; // 'id' maps to application_id

    const pgCol = APPLICATION_FIELD_MAP[key];
    if (pgCol) {
      row[pgCol] = value;
    } else if (JSONB_FIELDS.has(key)) {
      // JSONB fields: formData → form_data, stateHistory → state_history, etc.
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      row[snakeKey] = value;
    }
  }

  return row;
}

/** Convert PostgreSQL row to Application domain object */
function pgRowToApplication(row: Record<string, any>): Application {
  const fd = row.form_data || {};
  const app: Application = {
    applicationId: row.application_id,
    applicantUid: row.applicant_uid,
    applicantEmail: row.applicant_email,
    email: row.email,
    formData: fd,
    state: row.state as ApplicationState,
    stateHistory: row.state_history || [],
    pendingVerifier: row.pending_verifier,
    verificationAttempts: row.verification_attempts || 0,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    verifiedById: row.verified_by_id,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    approvedById: row.approved_by_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    applicationVersion: row.application_version,
    needsCapacityReview: row.needs_capacity_review,
    reassignmentReason: row.reassignment_reason,
    hasAlternativeBuses: row.has_alternative_buses,
    paymentId: row.payment_id,
    applicationType: row.application_type as ApplicationType | undefined,
    targetSession: row.target_session,
    eligibleApproval: row.eligible_approval,
    linkedStudentUid: row.linked_student_uid,
    bus_id: row.bus_id || fd.busId || fd.bus_id || fd.selectedBus,
    route_id: row.route_id || fd.routeId || fd.route_id || fd.selectedRoute,
    stop_name: row.stop_name || fd.stop_name || fd.stop_name || fd.selected_stop_name || fd.selectedStop || fd.stop_name || fd.stop_name,
    shift: normalizeShift(row.shift || fd.shift || fd.selectedShift) || (row.shift || fd.shift || fd.selectedShift || null),
    busId: row.bus_id || fd.busId || fd.bus_id || fd.selectedBus,
    routeId: row.route_id || fd.routeId || fd.route_id || fd.selectedRoute,
    sessionStartYear: row.session_start_year || fd.sessionStartYear || fd.startYear,
    sessionEndYear: row.session_end_year || fd.sessionEndYear || fd.endYear,
  } as Application;

  return app;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find an application by ID. Returns null if not found.
 */
export async function pgFindByApplicationId(applicationId: string): Promise<Application | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('applications')
    .select('*')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (error) {
    throw new Error(`ApplicationRepository (PG) findByApplicationId failed: ${error.message}`);
  }

  if (!data) return null;
  return pgRowToApplication(data);
}

/**
 * Find an application by applicant UID. Returns null if not found.
 */
export async function pgFindByApplicantUid(applicantUid: string): Promise<Application | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('applications')
    .select('*')
    .eq('applicant_uid', applicantUid)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`ApplicationRepository (PG) findByApplicantUid failed: ${error.message}`);
  }

  if (!data) return null;
  return pgRowToApplication(data);
}

/**
 * Find all applications.
 */
export async function pgFindAll(): Promise<Application[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('applications')
    .select('*');

  if (error) {
    throw new Error(`ApplicationRepository (PG) findAll failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToApplication(row));
}

/**
 * Find all applications with database-level pagination.
 */
export async function pgFindAllPaginated(limit: number, offset: number): Promise<Application[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`ApplicationRepository (PG) findAllPaginated failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToApplication(row));
}

/**
 * Find all applications by state.
 */
export async function pgFindAllByState(state: ApplicationState): Promise<Application[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('applications')
    .select('*')
    .eq('state', state);

  if (error) {
    throw new Error(`ApplicationRepository (PG) findAllByState failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToApplication(row));
}

/**
 * Find all applications by state and type.
 */
export async function pgFindAllByStateAndType(
  state: ApplicationState,
  applicationType: ApplicationType
): Promise<Application[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('applications')
    .select('*')
    .eq('state', state)
    .eq('application_type', applicationType);

  if (error) {
    throw new Error(`ApplicationRepository (PG) findAllByStateAndType failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToApplication(row));
}

/**
 * Insert a new application.
 */
export async function pgInsert(application: Partial<Application>): Promise<void> {
  const db = getSupabaseServer();
  const row = pgApplicationToRow(application);

  if (!row.application_id) throw new Error('ApplicationRepository (PG) insert requires applicationId');
  if (!row.created_at) row.created_at = new Date().toISOString();
  if (!row.created_by) row.created_by = application.applicantUid || 'system';
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('applications')
    .insert(row);

  if (error) {
    throw new Error(`ApplicationRepository (PG) insert failed: ${error.message}`);
  }
}

/**
 * Update an application (partial update).
 */
export async function pgUpdate(applicationId: string, data: Partial<Application>): Promise<void> {
  const db = getSupabaseServer();
  const row = pgApplicationToRow(data);

  // Remove application_id from update data (can't change PK)
  delete row.application_id;
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('applications')
    .update(row)
    .eq('application_id', applicationId);

  if (error) {
    throw new Error(`ApplicationRepository (PG) update failed: ${error.message}`);
  }
}

/**
 * Delete an application by ID.
 */
export async function pgRemove(applicationId: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('applications')
    .delete()
    .eq('application_id', applicationId);

  if (error) {
    throw new Error(`ApplicationRepository (PG) delete failed: ${error.message}`);
  }
}

/**
 * Upsert an application (insert or update on conflict).
 */
export async function pgUpsert(application: Partial<Application>): Promise<void> {
  const db = getSupabaseServer();
  const row = pgApplicationToRow(application);

  if (!row.application_id) throw new Error('ApplicationRepository (PG) upsert requires applicationId');
  if (!row.created_at) row.created_at = new Date().toISOString();
  if (!row.created_by) row.created_by = application.applicantUid || 'system';
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('applications')
    .upsert(row, { onConflict: 'application_id' });

  if (error) {
    throw new Error(`ApplicationRepository (PG) upsert failed: ${error.message}`);
  }
}

/**
 * Count all applications.
 */
export async function pgCount(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('applications')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`ApplicationRepository (PG) count failed: ${error.message}`);
  }

  return count || 0;
}
