/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CANONICAL SHIFT UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for ALL shift-related logic in the repository.
 *
 * Business Rules (FINAL):
 *   - Students: 'Morning' | 'Evening' ONLY
 *   - Buses:    'Morning' | 'Evening' | 'Both'
 *   - Drivers:  'Morning' | 'Evening' | 'Both'
 *
 * Every comparison, normalization, validation, and delta calculation
 * MUST go through this module. No inline comparisons allowed.
 */

// ─── Canonical Shift Types ────────────────────────────────────────────────

/** Allowed shift values for students. Students may ONLY have Morning or Evening. */
export type StudentShift = 'Morning' | 'Evening';

/** Allowed shift values for buses. Buses may have Morning, Evening, or Both. */
export type BusShift = 'Morning' | 'Evening' | 'Both';

/** Allowed shift values for drivers. Drivers may have Morning, Evening, or Both. */
export type DriverShift = 'Morning' | 'Evening' | 'Both';

/** Union of all allowed shift values. */
export type CanonicalShift = 'Morning' | 'Evening' | 'Both';

// ─── Normalization ────────────────────────────────────────────────────────

/**
 * Normalize a raw shift string to canonical PascalCase format.
 *
 * This is the SINGLE normalization function for the entire repository.
 * All other implementations MUST be removed and replaced with this.
 *
 * @param shift - Raw shift string (any casing, any format)
 * @returns Normalized canonical shift value
 *
 * @example
 * normalizeShift('morning')       // 'Morning'
 * normalizeShift('EVENING')       // 'Evening'
 * normalizeShift('both')          // 'Both'
 * normalizeShift('morning shift') // 'Morning'
 * normalizeShift('eve')           // 'Evening'
 * normalizeShift(undefined)       // 'Morning'
 * normalizeShift('')              // 'Morning'
 */
export function normalizeShift(shift: string | undefined | null): CanonicalShift {
  if (!shift) return 'Morning';
  const n = shift.toLowerCase().trim();

  // Check for 'Both' variants first
  if (n === 'both') return 'Both';
  if (n.includes('morning') && n.includes('evening')) return 'Both';
  if (n === 'morning & evening' || n === 'morning and evening') return 'Both';

  // Check for 'Evening' (broader match to catch 'eve', 'even', 'evening')
  if (n.includes('even')) return 'Evening';

  // Check for 'Morning' (broader match to catch 'morn', 'morning')
  if (n.includes('morn')) return 'Morning';

  // Default fallback
  return 'Morning';
}

// ─── Validation ───────────────────────────────────────────────────────────

/**
 * Check if a value is a valid student shift.
 * Students may ONLY have 'Morning' or 'Evening'.
 *
 * @param shift - Shift string to validate
 * @returns True if the shift is a valid student shift
 */
export function isValidStudentShift(shift: string | undefined | null): boolean {
  const normalized = normalizeShift(shift);
  return normalized === 'Morning' || normalized === 'Evening';
}

/**
 * Check if a value is a valid bus shift.
 * Buses may have 'Morning', 'Evening', or 'Both'.
 *
 * @param shift - Shift string to validate
 * @returns True if the shift is a valid bus shift
 */
export function isValidBusShift(shift: string | undefined | null): boolean {
  const normalized = normalizeShift(shift);
  return normalized === 'Morning' || normalized === 'Evening' || normalized === 'Both';
}

/**
 * Check if a value is a valid driver shift.
 * Drivers may have 'Morning', 'Evening', or 'Both'.
 *
 * @param shift - Shift string to validate
 * @returns True if the shift is a valid driver shift
 */
export function isValidDriverShift(shift: string | undefined | null): boolean {
  return isValidBusShift(shift);
}

// ─── Compatibility ────────────────────────────────────────────────────────

/**
 * Check if two shifts are compatible.
 *
 * Compatibility rules:
 * - 'Both' is compatible with everything
 * - Same shift values are compatible
 * - 'Morning' and 'Evening' are NOT compatible
 *
 * @param shift1 - First shift (canonical format)
 * @param shift2 - Second shift (canonical format)
 * @returns True if shifts are compatible
 *
 * @example
 * areShiftsCompatible('Both', 'Morning')  // true
 * areShiftsCompatible('Morning', 'Both')  // true
 * areShiftsCompatible('Morning', 'Morning') // true
 * areShiftsCompatible('Morning', 'Evening') // false
 */
export function areShiftsCompatible(shift1: string | undefined | null, shift2: string | undefined | null): boolean {
  const s1 = normalizeShift(shift1);
  const s2 = normalizeShift(shift2);

  if (s1 === 'Both') return true;
  if (s2 === 'Both') return true;
  return s1 === s2;
}

/**
 * Check if a bus shift is compatible with a student shift.
 *
 * A student with 'Morning' can ride a bus with 'Morning' or 'Both'.
 * A student with 'Evening' can ride a bus with 'Evening' or 'Both'.
 *
 * @param studentShift - Student's shift (Morning or Evening)
 * @param busShift - Bus's shift (Morning, Evening, or Both)
 * @returns True if the student can ride this bus
 */
export function isStudentBusShiftCompatible(
  studentShift: string | undefined | null,
  busShift: string | undefined | null
): boolean {
  const student = normalizeShift(studentShift);
  const bus = normalizeShift(busShift);

  // Students are always Morning or Evening (normalizeShift guarantees this)
  // Buses can be Morning, Evening, or Both
  if (bus === 'Both') return true;
  return student === bus;
}

// ─── Capacity Deltas ──────────────────────────────────────────────────────

/**
 * Read the per-shift load counter that a student of the given shift consumes.
 *
 * CANONICAL CAPACITY MODEL (per-shift): Morning and Evening are independent trips
 * sharing the same physical seats. A student is gated ONLY against their own
 * shift's counter, never against morningCount + eveningCount.
 *
 *   - Morning student → load.morningCount
 *   - Evening student → load.eveningCount
 *
 * `currentMembers` (morningCount + eveningCount) is a derived statistic and MUST
 * NOT be used as a capacity constraint.
 *
 * @param busData - Current bus document data
 * @param shift - Student's shift (Morning or Evening)
 * @returns The current occupancy of the relevant shift trip
 */
export function getShiftLoad(busData: Record<string, any> | undefined, shift: string | undefined | null): number {
  const load = busData?.load || { morningCount: 0, eveningCount: 0 };
  const morning = load.morningCount || 0;
  const evening = load.eveningCount || 0;
  const normalized = normalizeShift(shift);

  if (normalized === 'Evening') return evening;
  if (normalized === 'Both') return Math.max(morning, evening);
  // Default: Morning
  return morning;
}

/**
 * Calculate shift deltas for capacity updates.
 *
 * Returns which shift buckets are affected by a student with the given shift.
 * Used for computing morningCount/eveningCount changes on bus documents.
 *
 * @param shift - Student's shift
 * @returns Object indicating which shifts are affected
 */
export function getShiftDeltas(shift: string | undefined | null): { affectsMorning: boolean; affectsEvening: boolean } {
  const normalized = normalizeShift(shift);

  // Students are only Morning or Evening, but handle Both for bus/driver contexts
  if (normalized === 'Both') {
    return { affectsMorning: true, affectsEvening: true };
  }
  if (normalized === 'Evening') {
    return { affectsMorning: false, affectsEvening: true };
  }
  // Default: Morning
  return { affectsMorning: true, affectsEvening: false };
}

/**
 * Calculate capacity delta for adding or removing ONE student from a bus.
 *
 * This is the SINGLE capacity calculation function. Every capacity mutation
 * in the repository MUST use this function.
 *
 * CANONICAL CAPACITY MODEL (per-shift): capacity is the seat count of ONE trip.
 * A student is gated against their own shift's counter only:
 *   - Morning student → load.morningCount <= capacity
 *   - Evening student → load.eveningCount <= capacity
 * `currentMembers` (morningCount + eveningCount) is a DERIVED statistic, kept in
 * sync here, but NEVER used as a capacity constraint. Callers must gate on
 * `oldShiftLoad`/`newShiftLoad` against `capacity`, NOT on `newMembers`.
 *
 * Invariant maintained: currentMembers === morningCount + eveningCount
 *
 * @param busData - Current bus document data
 * @param shift - Student's shift
 * @param sign - 1 to add student, -1 to remove student
 * @returns Field updates plus derived total (newMembers) and per-shift occupancy
 *          (oldShiftLoad/newShiftLoad) for the affected trip.
 */
export function calculateCapacityDelta(
  busData: Record<string, any> | undefined,
  shift: string | undefined,
  sign: 1 | -1
): { updates: Record<string, unknown>; newMembers: number; capacity: number; oldShiftLoad: number; newShiftLoad: number } {
  const oldMembers = busData?.currentMembers || 0;
  const capacity = busData?.capacity || 55;
  const newMembers = sign === 1 ? oldMembers + 1 : Math.max(0, oldMembers - 1);

  const updates: Record<string, unknown> = {
    currentMembers: newMembers,
  };

  // Per-shift occupancy of the trip this student belongs to (before/after).
  const oldShiftLoad = getShiftLoad(busData, shift);
  let newShiftLoad = oldShiftLoad;

  if (shift) {
    const deltas = getShiftDeltas(shift);
    const currentLoad = busData?.load || { morningCount: 0, eveningCount: 0 };

    if (deltas.affectsMorning) {
      const morning = currentLoad.morningCount || 0;
      updates['load.morningCount'] = sign === 1 ? morning + 1 : Math.max(0, morning - 1);
    }
    if (deltas.affectsEvening) {
      const evening = currentLoad.eveningCount || 0;
      updates['load.eveningCount'] = sign === 1 ? evening + 1 : Math.max(0, evening - 1);
    }

    newShiftLoad = sign === 1 ? oldShiftLoad + 1 : Math.max(0, oldShiftLoad - 1);
  }

  return { updates, newMembers, capacity, oldShiftLoad, newShiftLoad };
}

// ─── Display ──────────────────────────────────────────────────────────────

/**
 * Get display name for a shift value.
 *
 * @param shift - Shift value
 * @returns Human-readable display name
 */
export function getShiftDisplayName(shift: string | undefined | null): string {
  const normalized = normalizeShift(shift);
  if (normalized === 'Both') return 'Both Shifts';
  return `${normalized} Shift`;
}
