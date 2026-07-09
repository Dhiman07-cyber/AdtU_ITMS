/**
 * D2 Calendar — Data Migration
 *
 * Reads the active calendar config from Firestore (settings/deadline)
 * and inserts it into PostgreSQL (academic_calendar_config).
 *
 * IDEMPOTENT: safe to run multiple times — uses upsert with onConflict.
 *
 * Infrastructure only.  No business logic.  No service calls.
 */
import type { MigrationDefinition, MigrationResult, ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';
import { pgSaveConfig } from '@/domains/calendar/repositories/calendar.repository.pg';
import { pgFindActiveConfig } from '@/domains/calendar/repositories/calendar.repository.pg';
import type { DeadlineConfig } from '@/lib/types/deadline-config';

// ─── Firestore collection constants ──────────────────────────────────────────
const SETTINGS_COLLECTION = 'settings';
const DEADLINE_DOC_ID     = 'deadline';

// ─────────────────────────────────────────────────────────────────────────────
// Step UP: Firestore → PostgreSQL
// ─────────────────────────────────────────────────────────────────────────────
async function up(): Promise<MigrationResult> {
  const errors: string[] = [];

  // 1. Read from Firestore
  let firestoreData: Record<string, any> | null = null;
  try {
    const doc = await adminDb
      .collection(SETTINGS_COLLECTION)
      .doc(DEADLINE_DOC_ID)
      .get();

    if (!doc.exists) {
      return {
        success: false,
        recordsProcessed: 0,
        errors: ['Firestore settings/deadline document does not exist — nothing to migrate.'],
      };
    }
    firestoreData = doc.data() as Record<string, any>;
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore settings/deadline: ${err.message}`],
    };
  }

  // 2. Transform Firestore data → DeadlineConfig shape
  //    We only map the STORED (non-derived) fields that Firestore persisted.
  const transformed: Partial<DeadlineConfig> = {
    description:  firestoreData.description ?? '',
    version:      firestoreData.version     ?? '1.0.0',
    lastUpdated:  firestoreData.lastUpdated ?? new Date().toISOString(),
    lastUpdatedBy: firestoreData.lastUpdatedBy ?? 'migration',

    academicSessionStart: {
      month: firestoreData.academicSessionStart?.month ?? 6,
      day:   firestoreData.academicSessionStart?.day   ?? 1,
    },

    urgentWarningThreshold: {
      description: 'Days before hard delete for warning',
      days:        firestoreData.urgentWarningThreshold?.days ?? 15,
      displayText: 'Critical warning period',
    },

    // Soft block: only warningText is persisted; dates are derived
    softBlock: {
      description:      '',
      month:             0,
      monthName:         '',
      day:               1,
      dayOrdinal:        '',
      daysAfterDeadline: 0,
      displayText:       '',
      warningText: firestoreData.softBlock?.warningText
        ?? 'Your bus service has expired. Please renew.',
    },

    // Hard delete: only criticalWarningText is persisted
    hardDelete: {
      description:         '',
      month:               0,
      monthName:           '',
      day:                 1,
      dayOrdinal:          '',
      daysAfterDeadline:   365,
      daysAfterSoftBlock:  365,
      displayText:         '',
      criticalWarningText: firestoreData.hardDelete?.criticalWarningText
        ?? 'Warning: Account will be permanently deleted.',
    },

    contactInfo: firestoreData.contactInfo ?? {
      description:       '',
      officeName:        '',
      phone:             '',
      email:             '',
      officeHours:       '',
      address:           '',
      visitInstructions: '',
    },

    landingPage:        firestoreData.landingPage        ?? undefined,
    applicationProcess: firestoreData.applicationProcess ?? undefined,
    statistics:         firestoreData.statistics         ?? undefined,

    // Derived fields (academicYear, renewalNotification, renewalDeadline,
    // timeline) are intentionally NOT included — pgSaveConfig ignores them.
  };

  // 3. Write to PostgreSQL
  try {
    await pgSaveConfig(transformed as DeadlineConfig, 'migration/d2-calendar/v1.0.0');
  } catch (err: any) {
    errors.push(`PostgreSQL write failed: ${err.message}`);
    return { success: false, recordsProcessed: 0, errors };
  }

  return { success: true, recordsProcessed: 1, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate: compare Firestore source vs PostgreSQL target
// ─────────────────────────────────────────────────────────────────────────────
async function validate(): Promise<ValidationResult> {
  const errors: string[] = [];

  // Read PG config
  let pgConfig: DeadlineConfig;
  try {
    pgConfig = await pgFindActiveConfig();
  } catch (err: any) {
    return { valid: false, errors: [`PG read failed: ${err.message}`] };
  }

  // Read Firestore config for comparison
  let firestoreData: Record<string, any> | null = null;
  try {
    const doc = await adminDb
      .collection(SETTINGS_COLLECTION)
      .doc(DEADLINE_DOC_ID)
      .get();
    firestoreData = doc.exists ? (doc.data() as Record<string, any>) : null;
  } catch (err: any) {
    // If Firestore is unreachable, only validate PG has a valid row
    console.warn('[calendar-migration] Could not reach Firestore for cross-validation:', err.message);
  }

  // PG must have a valid academicSessionStart
  if (pgConfig.academicSessionStart.month < 0 || pgConfig.academicSessionStart.month > 11) {
    errors.push(`PG session_start_month out of range: ${pgConfig.academicSessionStart.month}`);
  }
  if (pgConfig.academicSessionStart.day < 1 || pgConfig.academicSessionStart.day > 31) {
    errors.push(`PG session_start_day out of range: ${pgConfig.academicSessionStart.day}`);
  }

  // Cross-validate against Firestore if available
  if (firestoreData) {
    const fsMonth = firestoreData.academicSessionStart?.month ?? 6;
    const fsDay   = firestoreData.academicSessionStart?.day   ?? 1;

    if (pgConfig.academicSessionStart.month !== fsMonth) {
      errors.push(
        `session_start_month mismatch — Firestore: ${fsMonth}, PG: ${pgConfig.academicSessionStart.month}`
      );
    }
    if (pgConfig.academicSessionStart.day !== fsDay) {
      errors.push(
        `session_start_day mismatch — Firestore: ${fsDay}, PG: ${pgConfig.academicSessionStart.day}`
      );
    }

    const fsWarningDays = firestoreData.urgentWarningThreshold?.days ?? 15;
    if (pgConfig.urgentWarningThreshold.days !== fsWarningDays) {
      errors.push(
        `urgent_warning_days mismatch — Firestore: ${fsWarningDays}, PG: ${pgConfig.urgentWarningThreshold.days}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step DOWN: remove the PG row (rollback)
// Calendar domain falls back to whichever repository is wired at runtime.
// NOTE: Firestore data is never deleted — rollback only removes PG data.
// ─────────────────────────────────────────────────────────────────────────────
async function down(): Promise<MigrationResult> {
  // Import lazily to avoid circular deps in tests
  const { getSupabaseServer } = await import('@/lib/supabase-server');
  const db = getSupabaseServer();

  const { error } = await db
    .from('academic_calendar_config')
    .delete()
    .eq('is_active', true);

  if (error) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Rollback failed: ${error.message}`],
    };
  }

  return { success: true, recordsProcessed: 1, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// MigrationDefinition export
// ─────────────────────────────────────────────────────────────────────────────
export const calendarMigration: MigrationDefinition = {
  id:          'd2-calendar-v1.0.0',
  version:     '1.0.0',
  domainId:    'D2',
  description: 'Migrate D2 Calendar config from Firestore (settings/deadline) to PostgreSQL (academic_calendar_config)',
  up,
  down,
  validate,
};
