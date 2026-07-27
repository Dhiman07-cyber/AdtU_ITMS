/**
 * AUTOMATED CRON — Integrity Sweep
 *
 * Scheduled production-integrity heartbeat. Combines three Phase 4 mechanisms in
 * one scheduled pass and surfaces the result as a durable, admin-visible audit
 * event (Tier B) instead of leaving it in server logs:
 *
 *   1. Cross-collection integrity scan (detection-only) — orphans, duplicates,
 *      lifecycle/marker inconsistencies the count reconciler does not cover.
 *   2. Bus-load reconciliation (self-healing) — recount & repair seat counters.
 *      GATED on the seat-release flag for the SAME reason as the cleanup cron:
 *      an active-only recount is authoritative only under seat-release semantics;
 *      running it in legacy (flag-off) mode would wrongly drop soft-blocked owners.
 *
 * Detection ≠ repair: the scan never mutates business state. Whatever it finds is
 * reported (and emitted as an operational event) for an administrator to action.
 */

import { createAuditEvent,SYSTEM_ACTOR } from '@/domains/audit';
import { isSeatReleaseAtSoftBlockEnabled } from '@/lib/config/capacity-flags';
import { adminReconcileBusLoads } from '@/lib/services/admin-reconcile-bus-loads';
import { runIntegrityScan } from '@/lib/services/integrity-detector';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Authorization — strictly enforce CRON_SECRET (parity with cleanup cron).
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('🚫 CRON_SECRET not configured — blocking integrity sweep');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    const providedToken = request.headers.get('Authorization')?.startsWith('Bearer ')
      ? request.headers.get('Authorization')!.substring(7) : '';
    const secretsMatch = providedToken.length === cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(cronSecret));
    if (!secretsMatch) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Detection (always safe — read-only).
    const integrity = await runIntegrityScan();

    // 2. Reconciliation (self-healing) — gated, as above.
    let reconciliation: unknown;
    if (isSeatReleaseAtSoftBlockEnabled()) {
      try {
        const summary = await adminReconcileBusLoads({ dryRun: false, alertOnLargeDelta: true });
        reconciliation = {
          busesWithDiscrepancies: summary.busesWithDiscrepancies,
          busesCorrected: summary.busesCorrected,
          largeDeltaBuses: summary.largeDeltaBuses,
          invalidShiftStudents: summary.invalidShiftStudents,
        };
      } catch (reconErr: any) {
        reconciliation = { error: reconErr?.message || 'reconciliation failed' };
      }
    } else {
      reconciliation = { skipped: true, reason: 'seat-release flag disabled' };
    }

    const report = {
      integrity: {
        scannedAt: integrity.scannedAt,
        counts: integrity.counts,
        totalFindings: integrity.totalFindings,
        bySeverity: integrity.bySeverity,
        byType: integrity.byType,
        findings: integrity.findings.slice(0, 50),
        truncated: integrity.totalFindings > 50,
      },
      reconciliation,
    };

    // Durable, admin-visible summary of the whole sweep.
    await createAuditEvent({
      category: 'system',
      action: 'integrity_sweep_completed',
      summary: 'Integrity sweep completed',
      severity: 'medium',
      actor_id: SYSTEM_ACTOR.id,
      actor_name: SYSTEM_ACTOR.name,
      actor_role: SYSTEM_ACTOR.role,
      target_type: 'cron',
      target_id: 'cron:integrity-sweep',
      target_name: '',
      metadata: report,
    });

    return NextResponse.json({ success: true, ...report });
  } catch (error: any) {
    console.error('❌ Integrity sweep fatal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
