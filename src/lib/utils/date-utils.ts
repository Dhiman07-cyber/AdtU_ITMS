import { deriveAcademicLifecycle } from './deadline-computation';

/**
 * Safely parse a date from various formats
 * Handles: ISO strings, Firestore Timestamps, Date objects, seconds/milliseconds
 */
export function parseFirestoreDate(dateValue: any): Date | null {
  if (!dateValue) return null;

  try {
    // Already a Date object
    if (dateValue instanceof Date) {
      return isNaN(dateValue.getTime()) ? null : dateValue;
    }

    // Firestore Timestamp object (has toDate method)
    if (typeof dateValue === 'object' && typeof dateValue.toDate === 'function') {
      return dateValue.toDate();
    }

    // Firestore Timestamp serialized format (has seconds)
    if (typeof dateValue === 'object' && (dateValue.seconds || dateValue._seconds)) {
      const seconds = dateValue.seconds || dateValue._seconds;
      const nanoseconds = dateValue.nanoseconds || dateValue._nanoseconds || 0;
      return new Date(seconds * 1000 + nanoseconds / 1000000);
    }

    // String ISO format
    if (typeof dateValue === 'string') {
      const parsed = new Date(dateValue);
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    // Unix timestamp (seconds)
    if (typeof dateValue === 'number') {
      // If number is too large, it's milliseconds; otherwise seconds
      const timestamp = dateValue > 10000000000 ? dateValue : dateValue * 1000;
      const parsed = new Date(timestamp);
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  } catch (error) {
    console.error('Error parsing date:', error, dateValue);
    return null;
  }
}

/**
 * Format a date for display
 */
export function formatDate(date: Date | null, fallback: string = 'Not Set'): string {
  if (!date) return fallback;

  try {
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    return fallback;
  }
}

/**
 * Format a Firestore-compatible date value (ISO string, Timestamp, or Date) for display.
 * Handles Firestore Timestamp objects with seconds/nanoseconds, ISO strings, and Date objects.
 */
export function formatDateFlexible(dateValue: any, fallback: string = 'Not provided'): string {
  if (!dateValue) return fallback;
  try {
    let date: Date;
    if (dateValue instanceof Date) {
      date = dateValue;
    } else if (typeof dateValue === 'object' && typeof dateValue.toDate === 'function') {
      date = dateValue.toDate();
    } else if (typeof dateValue === 'object' && ('seconds' in dateValue || '_seconds' in dateValue)) {
      const seconds = dateValue.seconds || dateValue._seconds;
      const nanoseconds = dateValue.nanoseconds || dateValue._nanoseconds || 0;
      date = new Date(seconds * 1000 + nanoseconds / 1000000);
    } else if (typeof dateValue === 'string') {
      date = new Date(dateValue);
    } else if (typeof dateValue === 'number') {
      const ts = dateValue > 10000000000 ? dateValue : dateValue * 1000;
      date = new Date(ts);
    } else {
      return fallback;
    }
    if (isNaN(date.getTime())) return fallback;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return fallback;
  }
}

/**
 * Format a date for short display (month + day + hour + minute).
 * Used in feedback pages, transaction cards, etc.
 */
export function formatDateTimeShort(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  if (isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Format a date as DD-MM-YYYY.
 * Used in driver/moderator pages and exports.
 */
export function formatDateDDMMYYYY(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'N/A';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Calculate days until a date
 */
export function daysUntil(date: Date | null): number {
  if (!date) return 0;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);

    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  } catch (error) {
    return 0;
  }
}

/**
 * Check if a date is expired
 */
export function isDateExpired(date: Date | null): boolean {
  if (!date) return true;

  try {
    return date < new Date();
  } catch (error) {
    return true;
  }
}

/**
 * Format date for Firestore storage (ISO string)
 */
export function toFirestoreDate(date: Date): string {
  return date.toISOString();
}

/**
 * Calculate validity end date based on duration and academic year deadline
 * 
 * @param startYear - Starting year
 * @param durationYears - Number of years (1-4)
 * @param deadline - Deadline config object OR full DeadlineConfig - REQUIRED
 * @returns Date object set to the deadline of the final year
 */
export function calculateValidUntilDate(
  startYear: number,
  durationYears: number,
  deadline: any
): Date {
  if (!deadline) throw new Error("Deadline config required for calculateValidUntilDate");

  const endYear = startYear + durationYears;

  // If deadline has academicSessionStart, use the canonical deriveAcademicLifecycle engine
  if (deadline.academicSessionStart) {
    const startMonth = deadline.academicSessionStart.month;
    const startDay = deadline.academicSessionStart.day;
    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, endYear);
    return lifecycle.expiry;
  }

  // Extract month/day from DeadlineConfig (anchor) if provided, else use directly
  const month = deadline.academicYear ? deadline.academicYear.anchorMonth : deadline.month;
  const day = deadline.academicYear ? deadline.academicYear.anchorDay : deadline.day;

  if (month === undefined || day === undefined) {
    throw new Error("Invalid deadline configuration: month or day missing");
  }

  // Create date with deadline from config in UTC to prevent timezone leaks
  return new Date(Date.UTC(endYear, month, day, 23, 59, 59, 999));
}

/**
 * Resolves a date from various validUntil representations (toDate, Date, string).
 */
export function getValidUntilDate(validUntil: unknown): Date | null {
  if (!validUntil) return null;

  try {
    if (
      typeof validUntil === 'object' &&
      validUntil !== null &&
      'toDate' in validUntil &&
      typeof (validUntil as any).toDate === 'function'
    ) {
      return (validUntil as any).toDate();
    }
    if (validUntil instanceof Date) return validUntil;

    const date = new Date(String(validUntil));
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
