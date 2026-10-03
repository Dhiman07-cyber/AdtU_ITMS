/**
 * CalendarService
 *
 * Responsibilities: read/update academic calendar config, derive
 * per-student lifecycle dates (AcademicSession).
 */
import type { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle,type DerivedLifecycle } from '@/lib/utils/deadline-computation';
import * as calendarRepository from '../repositories/calendar.repository';

export async function getActiveConfig(): Promise<DeadlineConfig> {
  return calendarRepository.findActiveConfig();
}

export async function updateConfig(config: DeadlineConfig, updatedByUid?: string): Promise<void> {
  return calendarRepository.saveConfig(config, updatedByUid);
}

/**
 * Computes the derived AcademicSession lifecycle (expiry, reminders,
 * soft block, hard delete) for a given session end year, using the
 * active config's academicSessionStart month/day.
 */
export async function computeSession(sessionEndYear: number): Promise<DerivedLifecycle> {
  const config = await getActiveConfig();
  const { month, day } = config.academicSessionStart;
  return deriveAcademicLifecycle(month, day, sessionEndYear);
}
