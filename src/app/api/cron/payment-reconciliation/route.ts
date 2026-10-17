import { verifyCronAuth } from '@/lib/security/cron-auth';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { fetchOrderPayments } from '@/lib/payment/razorpay.service';
import { processCapturedPayment, recoverPaymentEntitlement } from '@/lib/payment/payment.service';
import { createAuditEvent } from '@/domains/audit';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Concurrency guard for background reconciliation sweep.
 * Prevents overlapping cron executions while providing automatic expiry if an execution hangs.
 */
let isSweepRunning = false;
let sweepStartedAt = 0;
const SWEEP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max runtime

/**
 * Automated Payment Reconciliation Sweep & Entitlement Durability Worker (Cron Job)
 *
 * Operational Realities & Guarantees:
 * 1. Concurrency Lock: Prevents simultaneous overlapping cron executions.
 * 2. Recent Rolling Sweep: Inspects Pending orders created within the last 48 hours for provider capture.
 * 3. Stale Pending Sweep: Inspects Pending orders older than 48 hours so un-reconciled captures are not abandoned.
 * 4. Entitlement Durability Sweep: Inspects Completed payments where transit entitlement remains pending or failed,
 *    and idempotently retries student validity extension.
 * 5. Authentication: Fail-closed using crypto.timingSafeEqual via verifyCronAuth.
 * 6. Audit Observability: Emits immutable structured audit logs for reconciled payments and recovered entitlements.
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized: Invalid cron authentication' }, { status: 401 });
    }

    const now = Date.now();
    if (isSweepRunning && now - sweepStartedAt < SWEEP_TIMEOUT_MS) {
      console.warn('[PaymentReconciliationCron] Sweep already running in this instance, skipping concurrent trigger.');
      return NextResponse.json({
        success: true,
        message: 'Reconciliation sweep is already in progress',
        skipped: true,
        startedAt: new Date(sweepStartedAt).toISOString(),
      });
    }

    isSweepRunning = true;
    sweepStartedAt = now;

    let recoveredCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let staleRecoveredCount = 0;
    let staleAbandonedCount = 0;
    let entitlementsRecoveredCount = 0;
    let entitlementsFailedCount = 0;
    const queryErrors: string[] = [];

    try {
      // ----------------------------------------------------------------------
      // PHASE 1: Recent Rolling Window (0 - 48 Hours) Pending Orders
      // ----------------------------------------------------------------------
      const { data: recentPending, error: recentErr } = await paymentsSupabaseService.getRecentPendingOrders(48);
      if (recentErr) {
        console.error('[PaymentReconciliationCron] Failed to fetch recent pending orders:', recentErr);
        queryErrors.push(`Phase 1 recent query error: ${recentErr?.message || String(recentErr)}`);
      }

      const recentOrders = recentPending || [];
      for (const record of recentOrders) {
        const orderId = record.razorpay_order_id;
        if (!orderId) {
          skippedCount++;
          continue;
        }

        try {
          const providerPayments = await fetchOrderPayments(orderId);
          const captured = providerPayments.find((p: any) => p.status === 'captured');

          if (captured) {
            console.log(`[PaymentReconciliationCron] Reconciling recent captured payment ${captured.id} for order ${orderId}...`);
            const result = await processCapturedPayment({
              paymentId: captured.id,
              orderId: orderId,
              amount: captured.amount / 100,
              method: 'Online',
              notes: {
                ...(captured.notes || {}),
                userId: record.student_uid || (captured.notes?.userId),
                studentId: record.student_id || (captured.notes?.studentId),
                source: 'automated_cron_reconciliation_sweep',
              },
            });

            if (result.status === 'success') {
              recoveredCount++;
              void createAuditEvent({
                action: 'payment_reconciled_via_cron_sweep',
                actor_id: 'cron:payment-reconciliation',
                actor_name: 'System Cron',
                actor_role: 'system',
                target_id: captured.id,
                target_type: 'payment',
                target_name: orderId || captured.id,
                category: 'financial',
                summary: `Captured payment ${captured.id} for order ${orderId} reconciled via automated rolling sweep.`,
                severity: 'medium',
                metadata: { orderId, paymentId: captured.id, amount: captured.amount / 100, phase: 'recent_48h' },
              });
            } else if (result.status === 'already_processed') {
              skippedCount++;
            } else {
              failedCount++;
            }
          } else {
            skippedCount++;
          }
        } catch (checkErr: any) {
          console.warn(`[PaymentReconciliationCron] Error checking recent order ${orderId}:`, checkErr?.message);
          failedCount++;
        }
      }

      // ----------------------------------------------------------------------
      // PHASE 2: Stale Pending Orders (> 48 Hours) Bounded Sweep
      // ----------------------------------------------------------------------
      const { data: stalePending, error: staleErr } = await paymentsSupabaseService.getStalePendingOrders(48, 50);
      if (staleErr) {
        console.warn('[PaymentReconciliationCron] Failed to fetch stale pending orders:', staleErr);
        queryErrors.push(`Phase 2 stale query error: ${staleErr?.message || String(staleErr)}`);
      }

      const staleOrders = stalePending || [];
      for (const record of staleOrders) {
        const orderId = record.razorpay_order_id;
        if (!orderId) continue;

        try {
          const providerPayments = await fetchOrderPayments(orderId);
          const captured = providerPayments.find((p: any) => p.status === 'captured');

          if (captured) {
            console.log(`[PaymentReconciliationCron] Reconciling STALE captured payment ${captured.id} for order ${orderId}...`);
            const result = await processCapturedPayment({
              paymentId: captured.id,
              orderId: orderId,
              amount: captured.amount / 100,
              method: 'Online',
              notes: {
                ...(captured.notes || {}),
                userId: record.student_uid || (captured.notes?.userId),
                studentId: record.student_id || (captured.notes?.studentId),
                source: 'automated_cron_reconciliation_sweep_stale',
              },
            });

            if (result.status === 'success') {
              staleRecoveredCount++;
              void createAuditEvent({
                action: 'payment_reconciled_via_cron_sweep',
                actor_id: 'cron:payment-reconciliation',
                actor_name: 'System Cron',
                actor_role: 'system',
                target_id: captured.id,
                target_type: 'payment',
                target_name: orderId || captured.id,
                category: 'financial',
                summary: `Stale captured payment ${captured.id} for order ${orderId} reconciled via background sweep.`,
                severity: 'high',
                metadata: { orderId, paymentId: captured.id, amount: captured.amount / 100, phase: 'stale_queue' },
              });
            } else if (result.status === 'already_processed') {
              skippedCount++;
            } else {
              failedCount++;
            }
          } else {
            staleAbandonedCount++;
          }
        } catch (staleCheckErr: any) {
          console.warn(`[PaymentReconciliationCron] Error checking stale order ${orderId}:`, staleCheckErr?.message);
        }
      }

      // ----------------------------------------------------------------------
      // PHASE 3: Entitlement Durability Recovery (Completed Payment with Incomplete Entitlement)
      // ----------------------------------------------------------------------
      const { data: incompleteEntitlements, error: entErr } = await paymentsSupabaseService.getCompletedPaymentsWithPendingEntitlements(72);
      if (entErr) {
        console.warn('[PaymentReconciliationCron] Failed to fetch incomplete entitlements:', entErr);
        queryErrors.push(`Phase 3 entitlement query error: ${entErr?.message || String(entErr)}`);
      }

      let prolongedUnresolvedCount = 0;
      let awaitingSubmissionCount = 0;
      const pendingEntitlements = incompleteEntitlements || [];
      for (const payment of pendingEntitlements) {
        try {
          const recoveryRes = await recoverPaymentEntitlement(payment);
          if (recoveryRes.alreadyClaimed) {
            skippedCount++;
          } else if (recoveryRes.pendingSubmission) {
            // Student has not yet submitted application form.
            // Safe no-op; lease was cleared. Do not falsely increment entitlementsRecoveredCount.
            awaitingSubmissionCount++;
            skippedCount++;
          } else if (recoveryRes.success) {
            entitlementsRecoveredCount++;
          } else {
            entitlementsFailedCount++;
            if (recoveryRes.prolonged) {
              prolongedUnresolvedCount++;
            }
          }
        } catch (entRecErr: any) {
          console.warn(`[PaymentReconciliationCron] Error recovering entitlement for payment ${payment.payment_id}:`, entRecErr?.message);
          entitlementsFailedCount++;
        }
      }

      const hasQueryErrors = queryErrors.length > 0;
      return NextResponse.json({
        success: !hasQueryErrors,
        ...(hasQueryErrors && { queryErrors }),
        sweepWindowHours: 48,
        scannedOrders: recentOrders.length,
        recoveredCount,
        failedCount,
        skippedCount,
        staleOrdersScanned: staleOrders.length,
        staleRecoveredCount,
        staleAbandonedCount,
        entitlementsScanned: pendingEntitlements.length,
        entitlementsRecoveredCount,
        entitlementsFailedCount,
        awaitingSubmissionCount,
        prolongedUnresolvedCount,
        timestamp: new Date().toISOString(),
      }, {
        status: hasQueryErrors ? 502 : 200,
      });
    } finally {
      isSweepRunning = false;
    }
  } catch (err: any) {
    console.error('[PaymentReconciliationCron] Unhandled error during reconciliation sweep:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal reconciliation sweep error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
