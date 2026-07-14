/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL BUS-LOAD RECONCILIATION (admin SDK, server-safe)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The single authoritative reconciliation for bus capacity counters. Recounts the
 * actual seat-owning students per bus and rewrites ALL FOUR counters consistently:
 *   currentMembers, load.morningCount, load.eveningCount.
 *
 * WHY THIS EXISTS (vs. the older `reconcile-bus-loads.ts`):
 *   - That file uses the CLIENT SDK (`@/lib/firebase`) and cannot run inside a
 *     server cron / admin route. This one uses the admin SDK (`adminDb`).
 *   - It also matched shift with exact case (`=== 'Morning'`), dropping any
 *     lowercase / non-canonical shift. This module normalizes shift IDENTICALLY to
 *     the writer (`buildCapacityDelta`): `shift.toLowerCase().includes('morning'|'evening')`,
 *     so the recount can never disagree with the live increment/decrement math.
 *
 * SEAT-OWNERSHIP DEFINITION (marker-aware, mode-independent):
 *   A student occupies a seat iff their seat has NOT been released:
 *     - status 'active'                                   → always occupies
 *     - status 'soft_blocked'/'pending_deletion' WITHOUT
 *       a `seatReleasedAt` marker (legacy / flag-off)     → still occupies
 *     - anything with a `seatReleasedAt` marker           → released, does NOT occupy
 *   This matches the live counters in BOTH flag modes because the marker is the
 *   single source of "seat was released" (see capacity-flags.ts).
 *
 * CORRECTION POLICY:
 *   The recount IS the source of truth. We ALWAYS correct to the recounted value;
 *   correctness does not depend on the size of the delta. A LARGE delta is a signal
 *   of a systemic bug — so we additionally ALERT loudly — but we never withhold the
 *   correction (the architecture's "only auto-correct if delta ≤ 5" rule is rejected).
 */

import { adminDb } from '../firebase-admin';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getShiftDeltas } from '@/lib/utils/shift-utils';

export interface BusCounterSnapshot {
  currentMembers: number;
  morningCount: number;
  eveningCount: number;
}

export interface BusReconcileReport {
  busId: string;
  busNumber: string;
  before: BusCounterSnapshot;
  after: BusCounterSnapshot;
  /** |before.currentMembers − after.currentMembers| */
  delta: number;
  hadDiscrepancy: boolean;
  corrected: boolean;
  /** Occupying students whose shift matches neither bucket (data-quality signal). */
  invalidShiftStudents: number;
  error?: string;
}

export interface ReconcileOptions {
  /** Limit to specific bus doc ids. Omit/empty ⇒ all buses. */
  busIds?: string[];
  /** Report only, write nothing. */
  dryRun?: boolean;
  /** Emit an admin notification when any bus delta ≥ largeDeltaThreshold. */
  alertOnLargeDelta?: boolean;
  /** Threshold for a "large" (systemic) delta. Default 5. */
  largeDeltaThreshold?: number;
}

export interface ReconcileSummary {
  totalBuses: number;
  busesWithDiscrepancies: number;
  busesCorrected: number;
  totalSeatsCounted: number;
  invalidShiftStudents: number;
  largeDeltaBuses: string[];
  reports: BusReconcileReport[];
  dryRun: boolean;
  executionTimeMs: number;
}

/** Marker-aware seat-ownership predicate. Mirrors the live counter semantics. */
function occupiesSeat(s: Record<string, any>): boolean {
  if (s.seatReleasedAt) return false; // seat released — never occupies
  const status = s.status;
  if (status === 'active') return true;
  if (status === 'soft_blocked' || status === 'pending_deletion') return true; // legacy, not yet released
  return false;
}

/**
 * Shift contribution — uses canonical getShiftDeltas from shift-utils.
 * Normalizes EXACTLY like `buildCapacityDelta`: uses canonical normalization.
 */
function shiftContribution(shift: unknown): { morning: boolean; evening: boolean; valid: boolean } {
  if (!shift || typeof shift !== 'string') return { morning: false, evening: false, valid: false };
  const deltas = getShiftDeltas(shift);
  return { morning: deltas.affectsMorning, evening: deltas.affectsEvening, valid: deltas.affectsMorning || deltas.affectsEvening };
}

export async function adminReconcileBusLoads(options: ReconcileOptions = {}): Promise<ReconcileSummary> {
  const startedAtMs = Date.now();
  const { busIds, dryRun = false, alertOnLargeDelta = false, largeDeltaThreshold = 5 } = options;

  // 1. Resolve target buses.
  let busDocs: FirebaseFirestore.QueryDocumentSnapshot[] | FirebaseFirestore.DocumentSnapshot[];
  if (busIds && busIds.length > 0) {
    busDocs = await Promise.all(busIds.map((id) => adminDb.collection('buses').doc(id).get()));
    busDocs = busDocs.filter((d) => d.exists);
  } else {
    const snap = await adminDb.collection('buses').get();
    busDocs = snap.docs;
  }
  const targetBusIds = new Set(busDocs.map((d) => d.id));

  // 2. Recount seat-owning students per bus (single read of candidate statuses).
  //    `in` covers every status that can own a seat; released/expired/suspended are
  //    excluded up front (and occupiesSeat double-checks the marker).
  const studentsSnap = await adminDb
    .collection('students')
    .where('status', 'in', ['active', 'soft_blocked', 'pending_deletion'])
    .get();

  type Counts = { currentMembers: number; morningCount: number; eveningCount: number; invalidShift: number };
  const counts = new Map<string, Counts>();
  for (const id of targetBusIds) counts.set(id, { currentMembers: 0, morningCount: 0, eveningCount: 0, invalidShift: 0 });

  studentsSnap.forEach((doc) => {
    const s = doc.data();
    if (!occupiesSeat(s)) return;
    const busId = s.busId || s.currentBusId || s.assignedBusId;
    if (!busId || !targetBusIds.has(busId)) return; // orphan / other bus — not in scope of this run
    const c = counts.get(busId)!;
    c.currentMembers += 1; // every occupying student counts toward the canonical total
    const contrib = shiftContribution(s.shift);
    if (contrib.morning) c.morningCount += 1;
    if (contrib.evening) c.eveningCount += 1;
    if (!contrib.valid) c.invalidShift += 1;
  });

  // 3. Per-bus transactional correction.
  const reports: BusReconcileReport[] = [];
  const largeDeltaBuses: string[] = [];
  let totalSeatsCounted = 0;
  let invalidShiftTotal = 0;

  for (const busDoc of busDocs) {
    const busId = busDoc.id;
    const busData = busDoc.data() || {};
    const c = counts.get(busId) || { currentMembers: 0, morningCount: 0, eveningCount: 0, invalidShift: 0 };
    totalSeatsCounted += c.currentMembers;
    invalidShiftTotal += c.invalidShift;

    const before: BusCounterSnapshot = {
      currentMembers: busData.currentMembers || 0,
      morningCount: busData.load?.morningCount || 0,
      eveningCount: busData.load?.eveningCount || 0,
    };
    const after: BusCounterSnapshot = {
      currentMembers: c.currentMembers,
      morningCount: c.morningCount,
      eveningCount: c.eveningCount,
    };

    const hadDiscrepancy =
      before.currentMembers !== after.currentMembers ||
      before.morningCount !== after.morningCount ||
      before.eveningCount !== after.eveningCount;
    const delta = Math.abs(before.currentMembers - after.currentMembers);

    let corrected = false;
    let error: string | undefined;
    if (hadDiscrepancy && !dryRun) {
      try {
        const busRef = adminDb.collection('buses').doc(busId);
        await adminDb.runTransaction(async (txn) => {
          const busSnap = await txn.get(busRef);
          if (!busSnap.exists) return;
          txn.update(busRef, {
            currentMembers: after.currentMembers,
            'load.morningCount': after.morningCount,
            'load.eveningCount': after.eveningCount,
            updatedAt: new Date().toISOString(),
          });
        });
        corrected = true;
      } catch (e: any) {
        error = e?.message || String(e);
      }
    }

    if (delta >= largeDeltaThreshold && hadDiscrepancy) largeDeltaBuses.push(busId);

    reports.push({
      busId,
      busNumber: busData.busNumber || busId,
      before,
      after,
      delta,
      hadDiscrepancy,
      corrected,
      invalidShiftStudents: c.invalidShift,
      error,
    });
  }

  // 4. Alert loudly on large (systemic) deltas — correction already applied above.
  if (alertOnLargeDelta && largeDeltaBuses.length > 0 && !dryRun) {
    try {
      const adminsSnap = await adminDb.collection('admins').get();
      const content = `Bus load reconciliation found large discrepancies on ${largeDeltaBuses.length} bus(es): ${largeDeltaBuses.join(', ')}. Counts were corrected to the recounted values; investigate the systemic cause.`;
      for (const adminDoc of adminsSnap.docs) {
        await pgInsertNotification({
          title: 'Bus Load Reconciliation — Large Delta',
          content,
          type: 'emergency',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [adminDoc.id]
          },
          recipientIds: [adminDoc.id],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          metadata: {
            priority: 'high'
          }
        });
      }
    } catch (e) {
      console.error('Reconciliation large-delta alert failed:', e);
    }
  }

  return {
    totalBuses: busDocs.length,
    busesWithDiscrepancies: reports.filter((r) => r.hadDiscrepancy).length,
    busesCorrected: reports.filter((r) => r.corrected).length,
    totalSeatsCounted,
    invalidShiftStudents: invalidShiftTotal,
    largeDeltaBuses,
    reports,
    dryRun,
    executionTimeMs: Date.now() - startedAtMs,
  };
}

export default adminReconcileBusLoads;
