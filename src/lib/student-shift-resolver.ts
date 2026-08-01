import { getByUid } from '@/domains/student';
import { CanonicalShift, normalizeShift } from '@/lib/utils/shift-utils';

export interface ResolvedStudentProfile {
  uid: string;
  busId: string | null;
  routeId: string | null;
  shift: CanonicalShift | null;
  rawProfile: Record<string, any> | null;
}

/**
 * Resolves a student's profile, busId, routeId, and shift directly from student_profiles.
 */
export async function getStudentProfileAndShift(uid: string): Promise<ResolvedStudentProfile> {
  try {
    const student = await getByUid(uid) as Record<string, any> | null;
    if (student) {
      return {
        uid,
        busId: student.busId || student.bus_id || null,
        routeId: student.routeId || student.route_id || null,
        shift: normalizeShift(student.shift),
        rawProfile: student,
      };
    }
  } catch (err) {
    console.warn(`[getStudentProfileAndShift] student_profiles lookup error for ${uid}:`, err);
  }

  return {
    uid,
    busId: null,
    routeId: null,
    shift: null,
    rawProfile: null,
  };
}
