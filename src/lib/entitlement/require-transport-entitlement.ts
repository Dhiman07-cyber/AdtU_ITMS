import { getByUid } from '@/domains/student';
import { getCachedStudentAssignment } from '@/domains/student/services/student-assignment-cache';
import { NextResponse } from 'next/server';
import { EntitlementResult, getTransportEntitlement } from './transport-entitlement';

/**
 * Server-side guard for student transport API routes (Phase 3).
 *
 * Loads the student document from PostgreSQL and applies the CANONICAL
 * entitlement rule. Use this at the top of any API that delivers transport
 * data or actions (tracking, trip status, waiting flags,
 * driver notifications). Returns the student data on success, or a
 * ready-to-return 403 NextResponse when the caller does not currently
 * own transport access.
 *
 * Migration status: COMPLETED — reads from PostgreSQL (student_profiles).
 * Uses L1 memory + L2 Redis caching via getCachedStudentAssignment to
 * eliminate redundant student_profiles queries.
 *
 * Usage:
 *   const gate = await requireTransportEntitlement(auth.uid);
 *   if (!gate.ok) return gate.response;
 *   // ...gate.student is entitled
 */
export async function requireTransportEntitlement(
  uid: string
): Promise<
  | { ok: true; student: Record<string, any>; entitlement: EntitlementResult }
  | { ok: false; response: NextResponse }
> {
  let student: Record<string, any> | null = null;
  try {
    const cached = await getCachedStudentAssignment(uid);
    if (cached) {
      student = {
        uid: cached.uid,
        id: cached.uid,
        fullName: cached.fullName,
        busId: cached.busId,
        routeId: cached.routeId,
        shift: cached.shift,
        stopName: cached.stopName,
        status: cached.status,
        softBlock: cached.softBlock,
        validUntil: cached.validUntil,
        hardBlock: cached.hardBlock,
      };
    } else {
      student = await getByUid(uid) as Record<string, any> | null;
    }
  } catch {
    student = null;
  }

  const entitlement = getTransportEntitlement(student);
  if (!entitlement.entitled) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Transport access is not active for this account.',
          entitled: false,
          reason: entitlement.reason,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, student: student as Record<string, any>, entitlement };
}
