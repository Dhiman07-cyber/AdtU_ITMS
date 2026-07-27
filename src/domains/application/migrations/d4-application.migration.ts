import { pgCount,pgFindByApplicationId,pgUpsert } from '@/domains/application/repositories/application.repository.pg';
import type { MigrationDefinition,MigrationResult,ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';

const APPLICATIONS_COLLECTION = 'applications';

const CORE_FIELDS = new Set([
  'applicationId', 'applicantUid', 'email', 'state', 'formData',
  'stateHistory', 'verificationAttempts', 'verifiedAt', 'verifiedBy',
  'verifiedById', 'pendingVerifier', 'submittedAt', 'submittedBy',
  'approvedAt', 'approvedBy', 'approvedById', 'createdAt', 'updatedAt',
  'createdBy', 'applicationVersion', 'needsCapacityReview', 'reassignmentReason',
  'hasAlternativeBuses', 'paymentId', 'applicationType', 'targetSession',
  'eligibleApproval', 'linkedStudentUid', 'routeId', 'busId', 'stop_name',
  'shift', 'semester', 'faculty', 'department', 'fullName',
]);

const FIELD_MAP: Record<string, string> = {
  applicationId: 'application_id',
  applicantUid: 'applicant_uid',
  stateHistory: 'state_history',
  verificationAttempts: 'verification_attempts',
  verifiedAt: 'verified_at',
  verifiedBy: 'verified_by',
  verifiedById: 'verified_by_id',
  pendingVerifier: 'pending_verifier',
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
  targetSession: 'target_session',
  eligibleApproval: 'eligible_approval',
  linkedStudentUid: 'linked_student_uid',
  routeId: 'route_id',
  busId: 'bus_id',
  stop_name: 'stop_name',
  shift: 'shift',
  semester: 'semester',
  fullName: 'full_name',
};

function toISOString(value: any): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

async function up(): Promise<MigrationResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  let firestoreDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(APPLICATIONS_COLLECTION).get();
    snapshot.forEach(doc => {
      firestoreDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore ${APPLICATIONS_COLLECTION}: ${err.message}`],
    };
  }

  if (firestoreDocs.length === 0) {
    return { success: true, recordsProcessed: 0, errors: [] };
  }

  for (const doc of firestoreDocs) {
    try {
      const fsData = doc.data;
      const applicationId = fsData.applicationId || doc.id;

      const record: Record<string, any> = { application_id: applicationId };

      for (const [key, value] of Object.entries(fsData)) {
        if (key === 'id') continue;
        const pgCol = FIELD_MAP[key];
        if (pgCol) {
          if (['verified_at', 'submitted_at', 'approved_at', 'created_at', 'updated_at'].includes(pgCol)) {
            record[pgCol] = toISOString(value);
          } else {
            record[pgCol] = value;
          }
        } else if (!CORE_FIELDS.has(key)) {
          record[key] = value;
        }
      }

      if (!record.created_at) record.created_at = new Date().toISOString();
      if (!record.updated_at) record.updated_at = new Date().toISOString();

      await pgUpsert(record);
      recordsProcessed++;
    } catch (err: any) {
      errors.push(`Failed to migrate application ${doc.id}: ${err.message}`);
    }
  }

  return { success: errors.length === 0, recordsProcessed, errors };
}

async function validate(): Promise<ValidationResult> {
  const errors: string[] = [];

  let firestoreCount = 0;
  let firestoreIds: Set<string> = new Set();
  try {
    const snapshot = await adminDb.collection(APPLICATIONS_COLLECTION).get();
    firestoreCount = snapshot.size;
    snapshot.forEach(doc => {
      const data = doc.data();
      firestoreIds.add(data.applicationId || doc.id);
    });
  } catch (err: any) {
    errors.push(`Cannot read Firestore for validation: ${err.message}`);
  }

  let pgCountResult = 0;
  try {
    pgCountResult = await pgCount();
  } catch (err: any) {
    errors.push(`PostgreSQL count failed: ${err.message}`);
  }

  if (firestoreCount > 0 && pgCountResult !== firestoreCount) {
    errors.push(
      `Row count mismatch — Firestore: ${firestoreCount}, PostgreSQL: ${pgCountResult}`
    );
  }

  if (firestoreIds.size > 0) {
    const sampleIds = Array.from(firestoreIds).slice(0, Math.min(5, firestoreIds.size));
    for (const id of sampleIds) {
      try {
        const pgApp = await pgFindByApplicationId(id);
        if (!pgApp) {
          errors.push(`Application ${id} exists in Firestore but NOT in PostgreSQL`);
        }
      } catch (err: any) {
        errors.push(`Spot-check failed for applicationId ${id}: ${err.message}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

async function down(): Promise<MigrationResult> {
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();
    const { error } = await db.from('applications').delete().neq('application_id', '');
    if (error) {
      return { success: false, recordsProcessed: 0, errors: [`Rollback failed: ${error.message}`] };
    }
    return { success: true, recordsProcessed: 0, errors: [] };
  } catch (err: any) {
    return { success: false, recordsProcessed: 0, errors: [`Rollback failed: ${err.message}`] };
  }
}

export const applicationMigration: MigrationDefinition = {
  id: 'd4-application-v1.0.0',
  version: '1.0.0',
  domainId: 'D4',
  description: 'Migrate D4 Application data from Firestore (applications collection) to PostgreSQL (applications table)',
  up,
  down,
  validate,
};
