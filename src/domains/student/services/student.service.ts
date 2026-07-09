/**
 * D3 StudentService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: student lookup, profile, CRUD, transport entitlement
 * (lifecycle status derivation).
 *
 * ponytail: delegates entirely to PostgreSQL persistence
 * (student.repository.pg.ts) — zero behavior change from caller perspective.
 * Approval/rejection/renewal/reassignment stay in dataService and the
 * D4 Application flow; this service does not touch them (they're D4's
 * job per the frozen domain boundary, not D3's).
 */
import * as studentRepository from '../repositories/student.repository';
import { getTransportEntitlement, hasTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import type { Student } from '../repositories/student.repository';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';

export async function getByUid(uid: string): Promise<Student | null> {
  return studentRepository.findByUid(uid);
}

export async function getById(id: string): Promise<Student | null> {
  return studentRepository.findById(id);
}

export async function getAll(): Promise<Student[]> {
  return studentRepository.findAll();
}

export async function getByBusId(busId: string): Promise<Student[]> {
  return studentRepository.findByBusId(busId);
}

export async function getByEnrollmentId(enrollmentId: string): Promise<Student | null> {
  return studentRepository.findByEnrollmentId(enrollmentId);
}

/**
 * Apply payment validity to a student profile.
 * Encapsulates the business rule: older payment cannot overwrite newer validity.
 * This is a domain capability — Payment calls this, not update() directly.
 */
export async function applyPaymentValidity(
  studentUid: string,
  payment: {
    valid_until?: string | null;
    session_start_year?: number | null;
    session_end_year?: number | null;
  }
): Promise<boolean> {
  const student = await getByUid(studentUid);
  if (!student) return false;

  const newValidUntil = payment.valid_until ? new Date(payment.valid_until) : null;
  const existingValidUntil = (student as any).validUntil
    ? new Date((student as any).validUntil)
    : null;

  // Invariant: older payment cannot overwrite newer validity
  const finalValidUntil = (existingValidUntil && newValidUntil && existingValidUntil > newValidUntil)
    ? existingValidUntil
    : newValidUntil;
  const finalSessionEndYear = ((student as any).sessionEndYear && payment.session_end_year && (student as any).sessionEndYear > payment.session_end_year)
    ? (student as any).sessionEndYear
    : payment.session_end_year;

  return update(studentUid, {
    validUntil: finalValidUntil?.toISOString() || undefined,
    sessionStartYear: payment.session_start_year || (student as any).sessionStartYear,
    sessionEndYear: finalSessionEndYear,
    status: 'active',
  } as any);
}

export async function update(id: string, data: Partial<Student>): Promise<boolean> {
  try {
    await studentRepository.update(id, data);
    return true;
  } catch {
    return false;
  }
}

export async function remove(id: string): Promise<boolean> {
  try {
    await studentRepository.remove(id);
    return true;
  } catch {
    return false;
  }
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  return studentRepository.unassignRoute(routeId);
}


export async function getPaymentHistory(uid: string, enrollmentId?: string) {
  return paymentsSupabaseService.getPaymentsByStudentUid(uid);
}

export async function getProfile(uid: string): Promise<Student | null> {
  return getByUid(uid);
}

// Canonical entitlement decision — re-exported as-is (see
// src/lib/entitlement/transport-entitlement.ts for the locked business rule).
export { getTransportEntitlement, hasTransportEntitlement };

export type { Student };
