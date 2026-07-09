/**
 * D2 Calendar Repository
 *
 * Persistence only — delegates to the PostgreSQL implementation in
 * calendar.repository.pg.ts.  Business computation (deriveAcademicLifecycle)
 * stays in CalendarService; this layer is infrastructure only.
 *
 * Migration status: COMPLETED — D2 Calendar reads and writes from
 * PostgreSQL (Supabase academic_calendar_config table).
 * Firestore (settings/deadline) is no longer used by this domain.
 *
 * ponytail: thin delegation wrapper. Public function signatures are
 * unchanged so CalendarService requires zero modification.
 */
import type { DeadlineConfig } from '@/lib/types/deadline-config';
import { pgFindActiveConfig, pgSaveConfig } from './calendar.repository.pg';

export async function findActiveConfig(): Promise<DeadlineConfig> {
  return pgFindActiveConfig();
}

export async function saveConfig(config: DeadlineConfig, updatedByUid?: string): Promise<void> {
  return pgSaveConfig(config, updatedByUid);
}
