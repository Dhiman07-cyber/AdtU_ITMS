import { getByUid } from '@/domains/student';
import { NextResponse } from 'next/server';
import { EntitlementResult,getTransportEntitlement } from './transport-entitlement';

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
 * Firestore (students collection) is no longer accessed.
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
    student = await getByUid(uid) as Record<string, any> | null;
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
