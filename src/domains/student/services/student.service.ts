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
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { getTransportEntitlement,hasTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import type { Student } from '../repositories/student.repository';
import * as studentRepository from '../repositories/student.repository';

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

  let softBlock: string | undefined;
  let hardBlock: string | undefined;

  if (finalValidUntil) {
    try {
      const deadlineConfig = await getDeadlineConfig();
      const blockDates = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);
      softBlock = (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as any)?.toISOString());
      hardBlock = (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as any)?.toISOString());
    } catch (e) {
      console.error('Failed to compute block dates in applyPaymentValidity:', e);
    }
  }

  await update(studentUid, {
    validUntil: finalValidUntil?.toISOString() || undefined,
    softBlock,
    hardBlock,
    sessionStartYear: payment.session_start_year || (student as any).sessionStartYear,
    sessionEndYear: finalSessionEndYear,
    status: 'active',
  } as any);
  return true;
}

export async function update(id: string, data: Partial<Student>): Promise<void> {
  await studentRepository.update(id, data);
}

export async function remove(id: string): Promise<void> {
  await studentRepository.remove(id);
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
export { getTransportEntitlement,hasTransportEntitlement };

	export type { Student };
