/**
 * D2 Calendar — PostgreSQL Repository
 *
 * Canonical persistence layer for all Calendar data.
 * Reads and writes the `academic_calendar_config` singleton row
 * in Supabase PostgreSQL.
 *
 * PERSISTENCE ONLY — no business logic lives here.
 * Business computation (deriveAcademicLifecycle) remains in CalendarService.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * PostgreSQL column              → DeadlineConfig field
 * session_start_month            → academicSessionStart.month
 * session_start_day              → academicSessionStart.day
 * urgent_warning_days            → urgentWarningThreshold.days
 * soft_block_warning_text        → softBlock.warningText
 * hard_delete_critical_text      → hardDelete.criticalWarningText
 * contact_office_name / …        → contactInfo.*
 * landing_page (JSONB)           → landingPage
 * application_process (JSONB)    → applicationProcess
 * statistics (JSONB)             → statistics
 * config_version                 → version
 * description                    → description
 * updated_at                     → lastUpdated
 * updated_by                     → lastUpdatedBy
 *
 * Derived fields (academicYear, renewalNotification, renewalDeadline,
 * softBlock dates, hardDelete dates, timeline) are NOT stored —
 * they are computed in-memory by deriveAcademicLifecycle() on every read.
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';

// ─── Month name helpers ───────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const getOrdinal = (day: number): string => {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

const REFERENCE_YEAR = 2026;

// ─────────────────────────────────────────────────────────────────────────────
// Public API — mirrors the shape expected by calendar.repository.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the active calendar config from PostgreSQL and returns a fully
 * populated DeadlineConfig (including all derived lifecycle fields),
 * exactly matching the behaviour of the Firestore implementation.
 */
export async function pgFindActiveConfig(): Promise<DeadlineConfig> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('academic_calendar_config')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`CalendarRepository (PG) read failed: ${error.message}`);
  }

  let activeConfig = data;

  if (!activeConfig) {
    const defaultRecord = {
      is_active: true,
      session_start_month: 6,
      session_start_day: 1,
      urgent_warning_days: 15,
      soft_block_warning_text: 'Your bus service has expired. Please renew.',
      hard_delete_critical_text: 'Warning: Account will be permanently deleted.',
      config_version: '1.0.0',
      description: 'Default Academic Calendar Configuration',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: 'system'
    };

    const { data: inserted, error: insertError } = await db
      .from('academic_calendar_config')
      .insert(defaultRecord)
      .select('*')
      .single();

    if (insertError) {
      activeConfig = defaultRecord as any;
    } else {
      activeConfig = inserted;
    }
  }

  const startMonth: number = activeConfig.session_start_month ?? 6; // default July
  const startDay:   number = activeConfig.session_start_day   ?? 1;

  // Derive all lifecycle milestones (pure computation — no I/O)
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, REFERENCE_YEAR);

  const populated: DeadlineConfig = {
    description: activeConfig.description ?? '',
    version:     activeConfig.config_version ?? '1.0.0',
    lastUpdated: activeConfig.updated_at ?? new Date().toISOString(),
    lastUpdatedBy: activeConfig.updated_by ?? 'system',

    academicSessionStart: { month: startMonth, day: startDay },

    academicYear: {
      description:      'Academic year boundary',
      anchorMonth:      lifecycle.expiry.getUTCMonth(),
      anchorMonthName:  MONTH_NAMES[lifecycle.expiry.getUTCMonth()],
      anchorDay:        lifecycle.expiry.getUTCDate(),
      anchorDayOrdinal: getOrdinal(lifecycle.expiry.getUTCDate()),
    },

    renewalNotification: {
      description:       'Renewal notification start date',
      month:             lifecycle.reminder1.getUTCMonth(),
      monthName:         MONTH_NAMES[lifecycle.reminder1.getUTCMonth()],
      day:               lifecycle.reminder1.getUTCDate(),
      dayOrdinal:        getOrdinal(lifecycle.reminder1.getUTCDate()),
      hour:              0,
      minute:            5,
      daysBeforeDeadline: 90,
      displayText:       'Renewal notification period has started',
    },

    renewalDeadline: {
      description: 'Renewal deadline date',
      month:       lifecycle.deadline.getUTCMonth(),
      monthName:   MONTH_NAMES[lifecycle.deadline.getUTCMonth()],
      day:         lifecycle.deadline.getUTCDate(),
      dayOrdinal:  getOrdinal(lifecycle.deadline.getUTCDate()),
      hour:        23,
      minute:      59,
      displayText: 'Renewal deadline reached',
    },

    softBlock: {
      description:      'Account soft blocked and seat released',
      month:            lifecycle.softBlock.getUTCMonth(),
      monthName:        MONTH_NAMES[lifecycle.softBlock.getUTCMonth()],
      day:              lifecycle.softBlock.getUTCDate(),
      dayOrdinal:       getOrdinal(lifecycle.softBlock.getUTCDate()),
      hour:             0,
      minute:           5,
      daysAfterDeadline: 0,
      displayText:      'Account access blocked',
      warningText:      data.soft_block_warning_text ?? 'Your bus service has expired. Please renew.',
    },

    hardDelete: {
      description:          'Account permanently deleted (+2 Sessions)',
      month:                lifecycle.hardDelete.getUTCMonth(),
      monthName:            MONTH_NAMES[lifecycle.hardDelete.getUTCMonth()],
      day:                  lifecycle.hardDelete.getUTCDate(),
      dayOrdinal:           getOrdinal(lifecycle.hardDelete.getUTCDate()),
      hour:                 0,
      minute:               5,
      daysAfterDeadline:    365,
      daysAfterSoftBlock:   365,
      displayText:          'Account permanently deleted',
      criticalWarningText:  data.hard_delete_critical_text ?? 'Warning: Account will be permanently deleted.',
    },

    urgentWarningThreshold: {
      description: 'Days before hard delete for warning',
      days:        data.urgent_warning_days ?? 15,
      displayText: 'Critical warning period',
    },

    contactInfo: {
      description:       'Contact information',
      officeName:        data.contact_office_name        ?? '',
      phone:             data.contact_phone              ?? '',
      email:             data.contact_email              ?? '',
      officeHours:       data.contact_office_hours       ?? '',
      address:           data.contact_address            ?? '',
      visitInstructions: data.contact_visit_instructions ?? '',
    },

    timeline: {
      description: 'Lifecycle timeline milestones',
      events: [
        {
          id: 'notification_start',
          date: { month: lifecycle.reminder1.getUTCMonth(), day: lifecycle.reminder1.getUTCDate() },
          time: { hour: 0, minute: 5 },
          label: 'Renewal notification sent',
          color: 'green',
          icon:  'bell',
        },
        {
          id: 'renewal_deadline',
          date: { month: lifecycle.deadline.getUTCMonth(), day: lifecycle.deadline.getUTCDate() },
          time: { hour: 23, minute: 59 },
          label: 'Renewal deadline',
          color: 'orange',
          icon:  'calendar',
        },
        {
          id: 'soft_block',
          date: { month: lifecycle.softBlock.getUTCMonth(), day: lifecycle.softBlock.getUTCDate() },
          time: { hour: 0, minute: 5 },
          label: 'Account access blocked',
          color: 'red',
          icon:  'lock',
        },
        {
          id: 'hard_delete',
          date: { month: lifecycle.hardDelete.getUTCMonth(), day: lifecycle.hardDelete.getUTCDate() },
          time: { hour: 0, minute: 5 },
          label: 'Account permanently deleted',
          color: 'darkred',
          icon:  'trash',
          critical: true,
        },
      ],
    },

    // Optional blobs — passed through from JSONB columns as-is
    landingPage:        data.landing_page        ?? undefined,
    applicationProcess: data.application_process ?? undefined,
    statistics:         data.statistics          ?? undefined,
  };

  return populated;
}

/**
 * Writes (upserts) the active calendar config to PostgreSQL.
 * Stores ONLY the anchor values + mutable text/JSON fields.
 * Derived lifecycle dates are NOT stored (identical to Firestore behaviour).
 */
export async function pgSaveConfig(config: DeadlineConfig, updatedByUid?: string): Promise<void> {
  const db = getSupabaseServer();

  const payload = {
    is_active:                 true,
    session_start_month:       config.academicSessionStart.month,
    session_start_day:         config.academicSessionStart.day,
    urgent_warning_days:       config.urgentWarningThreshold?.days ?? 15,
    soft_block_warning_text:   config.softBlock?.warningText            ?? 'Your bus service has expired. Please renew.',
    hard_delete_critical_text: config.hardDelete?.criticalWarningText   ?? 'Warning: Account will be permanently deleted.',
    contact_office_name:       config.contactInfo?.officeName           ?? null,
    contact_phone:             config.contactInfo?.phone                ?? null,
    contact_email:             config.contactInfo?.email                ?? null,
    contact_office_hours:      config.contactInfo?.officeHours          ?? null,
    contact_address:           config.contactInfo?.address              ?? null,
    contact_visit_instructions: config.contactInfo?.visitInstructions   ?? null,
    landing_page:              config.landingPage        ?? null,
    application_process:       config.applicationProcess ?? null,
    statistics:                config.statistics          ?? null,
    config_version:            config.version             ?? '1.0.0',
    description:               config.description         ?? null,
    updated_by:                updatedByUid               ?? 'system',
    // updated_at is handled by the DB trigger
  };

  const { error } = await db
    .from('academic_calendar_config')
    .upsert(payload, { onConflict: 'is_active' });

  if (error) {
    throw new Error(`CalendarRepository (PG) write failed: ${error.message}`);
  }
}
