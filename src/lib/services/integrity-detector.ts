import { getAllStudents } from '@/domains/identity';
import { getAllBuses } from '@/domains/fleet';
import * as applicationService from '@/domains/application';
import { wasSeatReleased } from '@/lib/config/capacity-flags';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — Cross-Collection Integrity Detector
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Detection-FIRST scanner for the referential / lifecycle invariants that the
 * count-based reconciler (admin-reconcile-bus-loads) does NOT cover. It answers
 * the operational question: "is any data corrupt right now, and where?"
 *
 * It NEVER mutates business state — corruption here usually needs a human decision
 * (which duplicate to keep, whether an orphan is safe to delete). It produces a
 * structured, severity-ranked report that the scheduled sweep surfaces as a Tier B
 * operational event and the admin route returns on demand.
 *
 * Invariants checked (gaps identified in the Phase 4 inventory):
 *  1. orphan_bus_reference        — student.busId points to a non-existent bus
 *  2. active_without_seat         — active entitlement but no bus assignment
 *  3. seat_marker_inconsistent    — seatReleasedAt set while status is still 'active'
 *  4. duplicate_pending_renewal   — >1 pending renewal_request for one student
 *  5. orphan_renewal_request      — renewal_request.studentId has no student doc
 *  6. duplicate_live_application  — >1 live application for one (applicant, session)
 */

export type IntegritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface IntegrityFinding {
  type: string;
  severity: IntegritySeverity;
  entity: string;
  detail: string;
  data?: Record<string, unknown>;
}

export interface IntegrityReport {
  scannedAt: string;
  counts: { students: number; buses: number; renewalRequests: number; applications: number };
  totalFindings: number;
  bySeverity: Record<IntegritySeverity, number>;
  byType: Record<string, number>;
  findings: IntegrityFinding[];
}

const LIVE_APPLICATION_STATES = new Set(['draft', 'awaiting_verification', 'verified', 'submitted']);

function busIdOf(studentData: Record<string, any>): string | null {
  return studentData.busId || studentData.currentBusId || studentData.busId || null;
}

function sessionKey(targetSession: any): string {
  if (!targetSession) return 'none';
  if (typeof targetSession === 'string') return targetSession;
  return `${targetSession.startYear ?? '?'}-${targetSession.endYear ?? '?'}`;
}

/**
 * Run a full cross-collection integrity scan. Read-only. Designed for the Phase 4
 * scale target (≈1000 students) — a handful of full-collection reads.
 */
export async function runIntegrityScan(): Promise<IntegrityReport> {
  const [students, buses, allApps] = await Promise.all([
    getAllStudents(),
    getAllBuses(),
    applicationService.getAll(),
  ]);

  const busIds = new Set<string>(buses.map((d: any) => d.busId || d.id));
  const studentIds = new Set<string>(students.map((d: any) => d.uid));
  const findings: IntegrityFinding[] = [];

  // 1–3. Student-level invariants.
  for (const s of students) {
    const uid = s.uid;
    const busId = busIdOf(s);
    const status = s.status;

    if (busId && !busIds.has(busId)) {
      findings.push({
        type: 'orphan_bus_reference',
        severity: 'high',
        entity: `students/${uid}`,
        detail: `Student references bus '${busId}' which does not exist`,
        data: { uid, busId, status, name: s.fullName || s.name || null },
      });
    }

    if (status === 'active' && !busId) {
      findings.push({
        type: 'active_without_seat',
        severity: 'high',
        entity: `students/${uid}`,
        detail: 'Active student has no bus assignment (entitlement without seat ownership)',
        data: { uid, status, name: s.fullName || s.name || null },
      });
    }

    if (wasSeatReleased(s) && status === 'active') {
      findings.push({
        type: 'seat_marker_inconsistent',
        severity: 'medium',
        entity: `students/${uid}`,
        detail: "seatReleasedAt is set but status is 'active' — seat was released yet the student is active (reclaim likely missed)",
        data: { uid, status, seatReleasedAt: s.seatReleasedAt, busId },
      });
    }
  }

  // 4–5. Renewal-request invariants (D8: now from PostgreSQL applications table).
  const renewalsRows = allApps.filter(
    (a) => a.applicationType === 'renewal' || a.applicationType === 'renewal_after_soft_block'
  );
  const pendingByStudent = new Map<string, string[]>();

  for (const r of renewalsRows) {
    const studentId = r.applicantUid;
    const status = r.state;
    if (studentId && !studentIds.has(studentId)) {
      findings.push({
        type: 'orphan_renewal_request',
        severity: 'medium',
        entity: `applications/${r.applicationId}`,
        detail: `Renewal application references student '${studentId}' which does not exist`,
        data: { requestId: r.applicationId, studentId, status },
      });
    }
    if (studentId && status === 'submitted') {
      const arr = pendingByStudent.get(studentId) || [];
      arr.push(r.applicationId);
      pendingByStudent.set(studentId, arr);
    }
  }
  for (const [studentId, ids] of pendingByStudent.entries()) {
    if (ids.length > 1) {
      findings.push({
        type: 'duplicate_pending_renewal',
        severity: 'high',
        entity: `students/${studentId}`,
        detail: `${ids.length} pending renewal requests exist for the same student`,
        data: { studentId, requestIds: ids },
      });
    }
  }

  // 6. Duplicate live applications for the same applicant + target session.
  const liveByKey = new Map<string, string[]>();
  for (const a of allApps) {
    if (!LIVE_APPLICATION_STATES.has(a.state)) continue;
    const applicant = a.applicantUid || a.applicationId;
    const key = `${applicant}::${sessionKey(a.targetSession)}`;
    const arr = liveByKey.get(key) || [];
    arr.push(a.applicationId);
    liveByKey.set(key, arr);
  }
  for (const [key, ids] of liveByKey.entries()) {
    if (ids.length > 1) {
      const [applicant, session] = key.split('::');
      findings.push({
        type: 'duplicate_live_application',
        severity: 'medium',
        entity: `applicant/${applicant}`,
        detail: `${ids.length} live applications exist for the same applicant and target session (${session})`,
        data: { applicantUid: applicant, targetSession: session, applicationIds: ids },
      });
    }
  }

  const bySeverity: Record<IntegritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byType: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byType[f.type] = (byType[f.type] || 0) + 1;
  }

  return {
    scannedAt: new Date().toISOString(),
    counts: {
      students: students.length,
      buses: buses.length,
      renewalRequests: renewalsRows.length,
      applications: allApps.length,
    },
    totalFindings: findings.length,
    bySeverity,
    byType,
    findings,
  };
}
