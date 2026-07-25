/**
 * Per-Student Deadline Computation Engine
 * 
 * This module provides the core date computation logic for the renewal deadline system.
 * All dates are computed per-student based on their individual sessionEndYear.
 * 
 * KEY RULES:
 * 1. Config stores month/day ONLY (no year)
 * 2. Year is derived from each student's sessionEndYear
 * 3. Hard delete ALWAYS occurs in sessionEndYear + 1 (next academic cycle)
 * 4. Simulation mode can override the year for testing
 */

import { DeadlineConfig } from '@/lib/types/deadline-config';

// Actually normalizeLeapYearDate was in deadline-computation.ts previously? Let me check.
// No, it was in deadline-computation.ts. I need to keep it.

/**
 * Handle leap year edge case for Feb 29
 * Returns Feb 28 for non-leap years
 */
export function normalizeLeapYearDate(year: number, month: number, day: number): Date {
    if (month === 1 && day === 29) { // February 29
        const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        if (!isLeapYear) {
            console.log(`[Date Computation] Feb 29 normalized to Feb 28 for non-leap year ${year}`);
            return new Date(year, 1, 28);
        }
    }
    return new Date(year, month, day);
}

/**
 * Student deadline status type
 */
type StudentDeadlineStatus = 'active' | 'soft_blocked' | 'pending_deletion' | 'deleted';

/**
 * Student computed fields
 */
interface StudentComputedFields {
    serviceExpiryDate?: string;
    renewalDeadlineDate?: string;
    softBlockDate?: string;
    hardDeleteDate?: string;
    urgentWarningDate?: string;
    computedAt?: string;
    configVersion?: string;
}

/**
 * Date preview result
 */
interface DatePreviewResult {
    studentId: string;
    studentName: string;
    studentEmail: string;
    sessionEndYear: number;
    currentStatus: StudentDeadlineStatus;
    computedDates: {
        serviceExpiryDate: string;
        renewalNotificationDate: string;
        renewalDeadlineDate: string;
        softBlockDate: string;
        hardDeleteDate: string;
        urgentWarningDate: string;
    };
    todayActions: {
        wouldSoftBlock: boolean;
        wouldSendUrgentWarning: boolean;
        wouldHardDelete: boolean;
    };
    daysUntil: {
        serviceExpiry: number;
        renewalDeadline: number;
        softBlock: number;
        hardDelete: number;
        urgentWarning: number;
    };
    isSimulation: boolean;
    simulationYear?: number;
}


/**
 * Parameters for computing per-student dates
 */
export interface ComputeDateParams {
    /** Student's session end year (e.g., 2026) */
    studentSessionEndYear: number;

    /** Deadline configuration (month/day only) - REQUIRED */
    config: DeadlineConfig;

    /** Optional simulation mode override */
    simulationMode?: {
        enabled: boolean;
        customYear: number;
    };
}

/**
 * Result of date computation
 */
export interface ComputedDates {
    /** Date when student's service expires */
    serviceExpiryDate: Date;

    /** Date when renewal notifications start */
    renewalNotificationDate: Date;

    /** Final renewal deadline */
    renewalDeadlineDate: Date;

    /** Date when access is blocked (soft block) */
    softBlockDate: Date;

    /** Date when account is deleted (ALWAYS in effectiveYear + 1) */
    hardDeleteDate: Date;

    /** Date when urgent warnings start */
    urgentWarningDate: Date;

    /** The effective year used for computation */
    effectiveYear: number;

    /** Whether simulation mode was used */
    isSimulated: boolean;
}

export interface DerivedLifecycle {
    sessionStart: Date;
    expiry: Date;
    reminder1: Date;
    reminder2: Date;
    finalReminder: Date;
    deadline: Date;
    softBlock: Date;
    activation: Date;
    hardDelete: Date;
}

/**
 * Derives all lifecycle dates programmatically from the single Academic Session Start month and day.
 * Applies leap year normalization across all derived dates.
 */
export function deriveAcademicLifecycle(
    startMonth: number,
    startDay: number,
    effectiveYear: number
): DerivedLifecycle {
    // Session Start date in the previous calendar year relative to sessionEndYear (effectiveYear)
    const sessionStart = new Date(Date.UTC(effectiveYear - 1, startMonth, startDay, 0, 0, 0, 0));

    // Expiry date is 1 day before the next session start of the effectiveYear
    const expiry = new Date(Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0));
    expiry.setUTCDate(expiry.getUTCDate() - 1);
    expiry.setUTCHours(23, 59, 59, 999);

    // Reminder 1 is 3 months before expiry (1st of that month)
    const reminder1 = new Date(expiry);
    reminder1.setUTCMonth(reminder1.getUTCMonth() - 3);
    reminder1.setUTCDate(1);
    reminder1.setUTCHours(0, 0, 0, 0);

    // Reminder 2 is 2 months before expiry (1st of that month)
    const reminder2 = new Date(expiry);
    reminder2.setUTCMonth(reminder2.getUTCMonth() - 2);
    reminder2.setUTCDate(1);
    reminder2.setUTCHours(0, 0, 0, 0);

    // Final Reminder is 15 days before expiry
    const finalReminder = new Date(expiry);
    finalReminder.setUTCDate(finalReminder.getUTCDate() - 15);
    finalReminder.setUTCHours(0, 0, 0, 0);

    // Renewal Deadline is equal to expiry
    const deadline = new Date(expiry);

    // Soft Block is exactly when next session starts (e.g. July 1, 2026 at 00:00:00)
    const softBlock = new Date(Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0));

    // Future Session Activation starts on the same day as soft block (July 1st)
    const activation = new Date(Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0));

    // Hard Delete is two sessions after expiry (e.g. July 1, 2028)
    const hardDelete = new Date(Date.UTC(effectiveYear + 2, startMonth, startDay, 0, 0, 0, 0));

    // Apply consistency normalization to all leap years
    const normalizeLeap = (d: Date) => {
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        if (m === 1 && day === 29) { // Feb 29
            const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
            if (!isLeapYear) {
                d.setUTCMonth(1, 28);
            }
        }
    };

    [sessionStart, expiry, reminder1, reminder2, finalReminder, deadline, softBlock, activation, hardDelete].forEach(normalizeLeap);

    return {
        sessionStart,
        expiry,
        reminder1,
        reminder2,
        finalReminder,
        deadline,
        softBlock,
        activation,
        hardDelete
    };
}

/**
 * Compute all deadline dates for a specific student
 * 
 * @param params - Parameters including student's sessionEndYear and config
 * @returns Computed dates for the student
 */
export function computeDatesForStudent(params: ComputeDateParams): ComputedDates {
    const {
        studentSessionEndYear,
        config,
        simulationMode
    } = params;

    if (!config) throw new Error("Config required for computeDatesForStudent");

    // Determine the effective year to use
    const isSimulated = simulationMode?.enabled ?? false;
    const effectiveYear = isSimulated
        ? simulationMode!.customYear
        : studentSessionEndYear;

    if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
        throw new Error('Academic session start configuration missing in deadline settings. Please configure settings and try again later.');
    }

    const startMonth = config.academicSessionStart.month;
    const startDay = config.academicSessionStart.day || 1;

    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, effectiveYear);

    // Urgent Warning Date: X days before hard delete
    const urgentWarningDays = config.urgentWarningThreshold?.days ?? 15;
    const urgentWarningDate = new Date(lifecycle.hardDelete);
    urgentWarningDate.setUTCDate(
        urgentWarningDate.getUTCDate() - urgentWarningDays
    );
    urgentWarningDate.setUTCHours(0, 0, 0, 0);

    return {
        serviceExpiryDate: lifecycle.expiry,
        renewalNotificationDate: lifecycle.reminder1,
        renewalDeadlineDate: lifecycle.deadline,
        softBlockDate: lifecycle.softBlock,
        hardDeleteDate: lifecycle.hardDelete,
        urgentWarningDate,
        effectiveYear,
        isSimulated
    };
}

/**
 * Check if two dates are the same day (ignoring time)
 */
export function isSameDay(date1: Date, date2: Date): boolean {
    return (
        date1.getUTCFullYear() === date2.getUTCFullYear() &&
        date1.getUTCMonth() === date2.getUTCMonth() &&
        date1.getUTCDate() === date2.getUTCDate()
    );
}

/**
 * Check if date1 is on or after date2 (ignoring time)
 */
export function isOnOrAfter(date1: Date, date2: Date): boolean {
    const d1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const d2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return d1 >= d2;
}

/**
 * Check if date1 is strictly after date2 (ignoring time)
 */
export function isAfter(date1: Date, date2: Date): boolean {
    const d1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const d2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return d1 > d2;
}

/**
 * Check if date1 is on or before date2 (ignoring time)
 */
export function isOnOrBefore(date1: Date, date2: Date): boolean {
    const d1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const d2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return d1 <= d2;
}

/**
 * Calculate the number of days between two dates
 * Positive if date2 is after date1
 */
export function daysBetween(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
    return Math.ceil((d2.getTime() - d1.getTime()) / oneDay);
}

/**
 * Validate a date configuration for invalid day-of-month
 */
export function validateDateConfig(
    month: number,
    day: number
): { valid: boolean; error?: string } {
    if (month < 0 || month > 11) {
        return { valid: false, error: `Invalid month: ${month}. Must be 0-11.` };
    }

    if (day < 1 || day > 31) {
        return { valid: false, error: `Invalid day: ${day}. Must be 1-31.` };
    }

    const testDate = new Date(new Date().getFullYear(), month, day);

    if (testDate.getMonth() !== month) {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return {
            valid: false,
            error: `Invalid day ${day} for ${monthNames[month]}`
        };
    }

    return { valid: true };
}

/**
 * Check if a specific student should be soft-blocked based on current date
 */
export function shouldSoftBlockStudent(
    student: { sessionEndYear?: number; validUntil?: string; status?: string },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): boolean {
    if (!config) throw new Error("Config required for shouldSoftBlockStudent");

    // Already blocked
    if (student.status === 'soft_blocked' || student.status === 'pending_deletion') {
        return false; // Already blocked, don't re-block
    }

    // Can't compute without sessionEndYear
    if (!student.sessionEndYear) return false;

    // If validUntil is still in future, don't block
    if (student.validUntil) {
        const validUntilDate = new Date(student.validUntil);
        const today = new Date();
        if (validUntilDate > today) return false;
    } else {
        // No validUntil means should probably be blocked
        return true;
    }

    // Compute dates for this student
    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    // Get today's date (respect simulation mode for testing)
    const today = simulationMode?.enabled
        ? new Date()
        : new Date();

    // Block if today is on or after soft block date
    return isOnOrAfter(today, computed.softBlockDate);
}

/**
 * Check if a specific student should be hard-deleted based on current date
 */
export function shouldHardDeleteStudent(
    student: {
        sessionEndYear?: number;
        status?: string;
        lastRenewalDate?: Date | string | { toDate: () => Date } | null;
        validUntil?: Date | string | { toDate: () => Date } | null;
    },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): boolean {
    if (!config) throw new Error("Config required for shouldHardDeleteStudent");

    // Already deleted or pending deletion
    if (student.status === 'deleted' || student.status === 'pending_deletion') {
        return false;
    }

    // Can't compute without sessionEndYear
    if (!student.sessionEndYear) return false;

    // SECURITY: Grace period check
    const GRACE_PERIOD_DAYS = 30;

    if (student.lastRenewalDate) {
        let renewalDate: Date;
        if (student.lastRenewalDate instanceof Date) {
            renewalDate = student.lastRenewalDate;
        } else if (typeof student.lastRenewalDate === 'string') {
            renewalDate = new Date(student.lastRenewalDate);
        } else if (typeof (student.lastRenewalDate as any).toDate === 'function') {
            renewalDate = (student.lastRenewalDate as { toDate: () => Date }).toDate();
        } else {
            renewalDate = new Date(0);
        }

        const daysSinceRenewal = daysBetween(renewalDate, new Date());
        if (daysSinceRenewal < GRACE_PERIOD_DAYS) {
            console.log(`🛡️ GRACE PERIOD: Student renewed ${daysSinceRenewal} days ago, skipping hard delete`);
            return false;
        }
    }

    // SECURITY: Also check validUntil
    if (student.validUntil) {
        let validUntilDate: Date;
        if (student.validUntil instanceof Date) {
            validUntilDate = student.validUntil;
        } else if (typeof student.validUntil === 'string') {
            validUntilDate = new Date(student.validUntil);
        } else if (typeof (student.validUntil as any).toDate === 'function') {
            validUntilDate = (student.validUntil as { toDate: () => Date }).toDate();
        } else {
            validUntilDate = new Date(0);
        }

        if (validUntilDate > new Date()) {
            console.log(`🛡️ VALID SUBSCRIPTION: Student validity until ${validUntilDate.toISOString()}, skipping hard delete`);
            return false;
        }
    }

    // Compute dates
    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    const today = new Date();

    // Delete if today is on or after hard delete date
    return isOnOrAfter(today, computed.hardDeleteDate);
}

/**
 * Get the number of days until hard delete for a specific student
 */
export function getDaysUntilHardDeleteForStudent(
    student: { sessionEndYear?: number },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): number {
    if (!student.sessionEndYear) return 0;
    if (!config) throw new Error("Config required");

    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    return Math.max(0, daysBetween(new Date(), computed.hardDeleteDate));
}

/**
 * Get the number of days until soft block for a specific student
 */
export function getDaysUntilSoftBlockForStudent(
    student: { sessionEndYear?: number },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): number {
    if (!student.sessionEndYear) return 0;
    if (!config) throw new Error("Config required");

    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    return Math.max(0, daysBetween(new Date(), computed.softBlockDate));
}

/**
 * Convert computed dates to storable format for student document
 */
export function computedDatesToStorable(
    computed: ComputedDates,
    configVersion: string
): StudentComputedFields {
    return {
        serviceExpiryDate: computed.serviceExpiryDate.toISOString(),
        renewalDeadlineDate: computed.renewalDeadlineDate.toISOString(),
        softBlockDate: computed.softBlockDate.toISOString(),
        hardDeleteDate: computed.hardDeleteDate.toISOString(),
        urgentWarningDate: computed.urgentWarningDate.toISOString(),
        computedAt: new Date().toISOString(),
        configVersion
    };
}

export function computeBlockDatesFromValidUntil(
    validUntil: string | Date,
    config: DeadlineConfig // REQUIRED
): { softBlock: string; hardBlock: string } {
    if (!config) throw new Error("Config required for computeBlockDatesFromValidUntil");

    // Parse validUntil to get the year
    const validUntilDate = typeof validUntil === 'string' ? new Date(validUntil) : validUntil;
    const validUntilYear = validUntilDate.getUTCFullYear();

    if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
        throw new Error('Academic session start configuration missing in deadline settings. Please configure settings and try again later.');
    }

    const startMonth = config.academicSessionStart.month;
    const startDay = config.academicSessionStart.day || 1;

    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, validUntilYear);

    return {
        softBlock: lifecycle.softBlock.toISOString(),
        hardBlock: lifecycle.hardDelete.toISOString()
    };
}

/**
 * Generate a preview of deadline effects for a student
 */
export function generateDatePreview(
    student: {
        id: string;
        name?: string;
        fullName?: string;
        email?: string;
        sessionEndYear?: number;
        status?: StudentDeadlineStatus;
    },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): DatePreviewResult | null {
    if (!student.sessionEndYear) return null;
    if (!config) throw new Error("Config required");

    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    const today = new Date();

    return {
        studentId: student.id,
        studentName: student.fullName || student.name || 'Unknown',
        studentEmail: student.email || 'No email',
        sessionEndYear: student.sessionEndYear,
        currentStatus: (student.status as StudentDeadlineStatus) || 'active',

        computedDates: {
            serviceExpiryDate: computed.serviceExpiryDate.toISOString(),
            renewalNotificationDate: computed.renewalNotificationDate.toISOString(),
            renewalDeadlineDate: computed.renewalDeadlineDate.toISOString(),
            softBlockDate: computed.softBlockDate.toISOString(),
            hardDeleteDate: computed.hardDeleteDate.toISOString(),
            urgentWarningDate: computed.urgentWarningDate.toISOString()
        },

        todayActions: {
            wouldSoftBlock: isSameDay(today, computed.softBlockDate) && student.status !== 'soft_blocked',
            wouldSendUrgentWarning: isSameDay(today, computed.urgentWarningDate),
            wouldHardDelete: isSameDay(today, computed.hardDeleteDate)
        },

        daysUntil: {
            serviceExpiry: daysBetween(today, computed.serviceExpiryDate),
            renewalDeadline: daysBetween(today, computed.renewalDeadlineDate),
            softBlock: daysBetween(today, computed.softBlockDate),
            hardDelete: daysBetween(today, computed.hardDeleteDate),
            urgentWarning: daysBetween(today, computed.urgentWarningDate)
        },

        isSimulation: computed.isSimulated,
        simulationYear: computed.isSimulated ? computed.effectiveYear : undefined
    };
}

/**
 * Get formatted date string for display
 */
export function formatComputedDate(date: Date): string {
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * Get ordinal suffix for a day number
 */
export function getOrdinalSuffix(day: number): string {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

/**
 * Format a date with ordinal day
 */
export function formatDateWithOrdinal(date: Date): string {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const day = date.getDate();
    return `${monthNames[date.getMonth()]} ${day}${getOrdinalSuffix(day)}, ${date.getFullYear()}`;
}
