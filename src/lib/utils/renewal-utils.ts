/**
 * Bus Service Renewal Utilities
 * Handles date calculations for July-aligned academic year renewals
 * Uses dynamic configuration passed from service layer
 */

import { DeadlineConfig } from '@/lib/types/deadline-config';
import { SimulationConfig } from '@/lib/types/simulation-config';
import { Timestamp } from 'firebase/firestore';
import { deriveAcademicLifecycle } from './deadline-computation';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Calculate new validUntil date for renewal
 * Follows July-aligned academic cycle rules
 * 
 * @param currentValidUntil - Current validUntil date (or null/expired)
 * @param durationYears - Number of years to add (1-4)
 * @param config - DEADLINE CONFIGURATION IS REQUIRED
 * @returns New validUntil date as ISO string
 */
export function calculateRenewalDate(
  currentValidUntil: string | null | undefined,
  durationYears: number,
  config: DeadlineConfig | { academicYear: { anchorMonth: number; anchorDay: number } }
): { newValidUntil: string; oldValidUntil: string | null } {
  if (!config) throw new Error("Configuration required for calculateRenewalDate");

  const today = new Date();
  const currentYear = today.getUTCFullYear();

  const anchorMonth = config.academicYear.anchorMonth;
  const anchorDay = config.academicYear.anchorDay;

  let baseYear: number;
  let oldValidUntil: string | null = currentValidUntil || null;

  if (currentValidUntil) {
    const validUntilDate = new Date(currentValidUntil);

    if (validUntilDate > today) {
      baseYear = validUntilDate.getUTCFullYear();
    } else {
      oldValidUntil = null;
      baseYear = currentYear;
    }
  } else {
    baseYear = currentYear;
  }

  const newYear = baseYear + durationYears;
  const newValidUntil = new Date(Date.UTC(newYear, anchorMonth, anchorDay, 23, 59, 59, 999));

  return {
    newValidUntil: newValidUntil.toISOString(),
    oldValidUntil
  };
}

/**
 * Format date as human-readable string
 */
export function formatRenewalDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/**
 * Convert ISO string to Firestore Timestamp
 */
export function toFirestoreTimestamp(isoString: string): Timestamp {
  return Timestamp.fromDate(new Date(isoString));
}

/**
 * Check if student should be soft-blocked (after soft block date, not renewed)
 * Used internally by shouldBlockAccessFromStoredDates
 */
function shouldBlockAccess(
  validUntil: string | null,
  lastRenewalDate?: string | null,
  simulationConfig?: SimulationConfig | null,
  status?: string,
  config?: any
): boolean {
  if (!config) throw new Error("Config required for shouldBlockAccess");

  if (status === 'soft_blocked' || status === 'hard_blocked' || status === 'pending_deletion') {
    return true;
  }

  if (!validUntil) return true;

  let currentDate = new Date();
  if (simulationConfig?.enabled) {
    currentDate = new Date(Date.UTC(
      simulationConfig.customYear,
      simulationConfig.customMonth,
      simulationConfig.customDay
    ));
  }

  const validDate = new Date(validUntil);
  let sessionEndYear = validDate.getUTCFullYear();
  if (simulationConfig?.enabled && (simulationConfig.syncSessionWithSimulatedDate || true)) {
    sessionEndYear = simulationConfig.customYear;
  }

  const isExpired = (simulationConfig?.enabled)
    ? true
    : validDate < currentDate;

  if (!isExpired) {
    return false;
  }

  if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
    throw new Error('Academic session start configuration missing in settings. Please configure settings and try again later.');
  }

  const startMonth = config.academicSessionStart.month;
  const startDay = config.academicSessionStart.day || 1;
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);
  const softBlockDate = lifecycle.softBlock;

  if (currentDate >= softBlockDate) {
    if (lastRenewalDate) {
      const renewalDate = new Date(lastRenewalDate);
      if (renewalDate > validDate) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Check if student should be hard-deleted (after hard delete date, not renewed)
 * Used internally by shouldHardDeleteFromStoredDates
 */
function shouldHardDelete(
  validUntil: string | null,
  lastRenewalDate?: string | null,
  simulationConfig?: SimulationConfig | null,
  config?: any
): boolean {
  if (!config) throw new Error("Config required for shouldHardDelete");

  if (!validUntil) {
    return true;
  }

  let currentDate = new Date();
  if (simulationConfig?.enabled) {
    currentDate = new Date(Date.UTC(
      simulationConfig.customYear,
      simulationConfig.customMonth,
      simulationConfig.customDay
    ));
  }

  const validDate = new Date(validUntil);
  let sessionEndYear = validDate.getUTCFullYear();

  if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
    throw new Error('Academic session start configuration missing in settings. Please configure settings and try again later.');
  }

  const startMonth = config.academicSessionStart.month;
  const startDay = config.academicSessionStart.day || 1;
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);
  const hardDeleteDate = lifecycle.hardDelete;

  if (currentDate >= hardDeleteDate) {
    if (lastRenewalDate) {
      const renewalDate = new Date(lastRenewalDate);
      if (renewalDate > validDate) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Get blocking message for student
 */
export function getBlockingMessage(
  validUntil: string | null,
  simulationConfig?: SimulationConfig | null,
  config?: any
): string {
  if (!config) throw new Error("Config required for getBlockingMessage");

  const referenceYear = (simulationConfig?.enabled)
    ? simulationConfig.customYear
    : (validUntil ? new Date(validUntil).getUTCFullYear() : new Date().getUTCFullYear());

  const nextYear = referenceYear + 1;

  const renewalMonthName = config.renewalDeadline?.monthName || MONTH_NAMES[config.renewalDeadline?.month || 0];
  const hardDeleteMonthName = config.hardDelete?.monthName || MONTH_NAMES[config.hardDelete?.month || 0];

  const renewalDeadlineText = `${renewalMonthName} ${config.renewalDeadline.day}, ${referenceYear}`;
  const nextDeadlineText = `${hardDeleteMonthName} ${config.hardDelete.day}, ${nextYear}`;

  return `Your bus service has expired. The renewal deadline was ${renewalDeadlineText}. Please contact the admin office immediately to renew your service. If not renewed by ${nextDeadlineText}, your account will be permanently deactivated.`;
}

/**
 * Check if student should be soft-blocked using PRE-STORED softBlock date from student document.
 */
export function shouldBlockAccessFromStoredDates(
  studentData: {
    softBlock?: string | null;
    validUntil?: string | null;
    lastRenewalDate?: string | null;
    status?: string;
    sessionEndYear?: number;
  },
  simulationConfig?: SimulationConfig | null,
  config?: any
): boolean {
  if (!config) throw new Error("Config required for shouldBlockAccessFromStoredDates");

  if (studentData.status === 'soft_blocked' || studentData.status === 'hard_blocked' || studentData.status === 'pending_deletion') {
    return true;
  }

  if (!studentData.validUntil) return true;

  let currentDate = new Date();
  if (simulationConfig?.enabled) {
    currentDate = new Date(Date.UTC(
      simulationConfig.customYear,
      simulationConfig.customMonth,
      simulationConfig.customDay
    ));
  }

  const validDate = new Date(studentData.validUntil);

  if (validDate > currentDate && !simulationConfig?.enabled) {
    return false;
  }

  if (studentData.softBlock) {
    const softBlockDate = new Date(studentData.softBlock);

    if (currentDate >= softBlockDate) {
      if (studentData.lastRenewalDate) {
        const renewalDate = new Date(studentData.lastRenewalDate);
        if (renewalDate > validDate) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  return shouldBlockAccess(
    studentData.validUntil,
    studentData.lastRenewalDate,
    simulationConfig,
    studentData.status,
    config
  );
}

/**
 * Check if student should be hard-deleted using PRE-STORED hardBlock date from student document.
 */
export function shouldHardDeleteFromStoredDates(
  studentData: {
    hardBlock?: string | null;
    validUntil?: string | null;
    lastRenewalDate?: string | null;
    sessionEndYear?: number;
  },
  simulationConfig?: SimulationConfig | null,
  config?: any
): boolean {
  if (!config) throw new Error("Config required for shouldHardDeleteFromStoredDates");

  if (!studentData.validUntil) {
    console.warn(`⚠️ Student ${studentData.sessionEndYear || 'unknown'} has no validUntil date - incomplete profile, skipping auto-deletion`);
    return false;
  }

  let currentDate = new Date();
  if (simulationConfig?.enabled) {
    currentDate = new Date(Date.UTC(
      simulationConfig.customYear,
      simulationConfig.customMonth,
      simulationConfig.customDay
    ));
  }

  const validDate = new Date(studentData.validUntil);

  if (studentData.hardBlock) {
    const hardBlockDate = new Date(studentData.hardBlock);

    if (currentDate >= hardBlockDate) {
      if (studentData.lastRenewalDate) {
        const renewalDate = new Date(studentData.lastRenewalDate);
        if (renewalDate > validDate) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  return shouldHardDelete(
    studentData.validUntil,
    studentData.lastRenewalDate,
    simulationConfig,
    config
  );
}

/**
 * Calculate days until hard delete
 */
export function getDaysUntilHardDelete(
  validUntil: string | null,
  simulationConfig?: SimulationConfig | null,
  config?: any
): number {
  if (!config) throw new Error("Config required for getDaysUntilHardDelete");

  const today = simulationConfig?.enabled
    ? new Date(Date.UTC(simulationConfig.customYear, simulationConfig.customMonth, simulationConfig.customDay))
    : new Date();

  let sessionEndYear = today.getUTCFullYear();

  if (validUntil) {
    sessionEndYear = new Date(validUntil).getUTCFullYear();
  }

  if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
    throw new Error('Academic session start configuration missing in settings. Please configure settings and try again later.');
  }

  const startMonth = config.academicSessionStart.month;
  const startDay = config.academicSessionStart.day || 1;
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);
  const hardDeleteDate = lifecycle.hardDelete;

  const diffTime = hardDeleteDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Get hard delete date for a specific student
 */
export function getHardDeleteDate(
  validUntil: string | null,
  simulationConfig?: SimulationConfig | null,
  config?: any
): Date {
  if (!config) throw new Error("Config required for getHardDeleteDate");

  const today = simulationConfig?.enabled
    ? new Date(Date.UTC(simulationConfig.customYear, simulationConfig.customMonth, simulationConfig.customDay))
    : new Date();

  let sessionEndYear = today.getUTCFullYear();
  if (validUntil) {
    sessionEndYear = new Date(validUntil).getUTCFullYear();
  }

  if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
    throw new Error('Academic session start configuration missing in settings. Please configure settings and try again later.');
  }

  const startMonth = config.academicSessionStart.month;
  const startDay = config.academicSessionStart.day || 1;
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);
  return lifecycle.hardDelete;
}

/**
 * Get contact information
 */
export function getContactInfo(config: any) {
  if (!config) throw new Error("Config required for getContactInfo");
  return config.contactInfo;
}
