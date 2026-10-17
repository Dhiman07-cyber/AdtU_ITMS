import { reconcileUnresolvedCapture, confirmManualRefund, denyManualRefund } from '@/lib/payment/payment.service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ReconcilePaymentSchema = z.object({
  action: z.enum(['reconcile', 'confirm_refund', 'deny_refund']).default('reconcile'),
  paymentId: z.string().min(1, 'Payment ID is required'),
  // Fields for action: 'reconcile'
  sessionStartYear: z.number().int().min(2000).max(2100).optional(),
  sessionEndYear: z.number().int().min(2001).max(2101).optional(),
  evidence: z.string().min(5, 'Reconciliation evidence must be at least 5 characters').max(1000).optional(),
  // Fields for action: 'confirm_refund'
  refundReference: z.string().min(3).optional(),
  refundedAmount: z.number().positive().optional(),
  // Fields for action: 'deny_refund'
  reason: z.string().min(5).max(1000).optional(),
});

/**
 * Administrative Payment Reconciliation & Refund State Machine API
 *
 * Operational Governance:
 * 1. Requires verified administrator role.
 * 2. Controlled transition of Captured_Pending_Review to Completed.
 * 3. Controlled transition of Duplicate_Pending_Refund / Captured_Pending_Review to Refunded or Refund_Denied.
 * 4. All transitions enforce durable database persistence before activating entitlements or completing.
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    try {
      const { action, paymentId } = body;

      if (action === 'reconcile') {
        if (!body.sessionStartYear || !body.sessionEndYear) {
          return NextResponse.json(
            { error: 'sessionStartYear and sessionEndYear are required for reconciliation.' },
            { status: 400 }
          );
        }
        if (body.sessionStartYear >= body.sessionEndYear) {
          return NextResponse.json(
            { error: 'sessionStartYear must be strictly less than sessionEndYear.' },
            { status: 400 }
          );
        }
        if (!body.evidence || !body.evidence.trim()) {
          return NextResponse.json(
            { error: 'Explicit audit evidence is required for reconciliation.' },
            { status: 400 }
          );
        }

        const result = await reconcileUnresolvedCapture({
          paymentId,
          sessionStartYear: body.sessionStartYear,
          sessionEndYear: body.sessionEndYear,
          reconcilerUserId: auth.uid,
          reconcilerName: auth.name || auth.email || 'Admin',
          reconcilerRole: auth.role,
          evidence: body.evidence.trim(),
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          action: 'reconcile',
          payment: result.payment,
          message: `Payment ${paymentId} successfully reconciled to Completed for session ${body.sessionStartYear}–${body.sessionEndYear}.`,
        });
      }

      if (action === 'confirm_refund') {
        if (!body.refundReference || !body.refundReference.trim()) {
          return NextResponse.json(
            { error: 'External refund reference (e.g. Razorpay refund ID or bank UTR) is required.' },
            { status: 400 }
          );
        }
        if (!body.refundedAmount || body.refundedAmount <= 0) {
          return NextResponse.json(
            { error: 'Valid refunded amount is required.' },
            { status: 400 }
          );
        }

        const result = await confirmManualRefund({
          paymentId,
          refundReference: body.refundReference.trim(),
          refundedAmount: body.refundedAmount,
          authorizerUserId: auth.uid,
          authorizerName: auth.name || auth.email || 'Admin',
          authorizerRole: auth.role,
          empId: (auth as any).empId,
          reason: body.reason?.trim() || 'Manual refund confirmed by university finance officer',
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          action: 'confirm_refund',
          isPartial: result.isPartial,
          cumulativeRefunded: result.cumulativeRefunded,
          message: result.isPartial
            ? `Partial refund of Rs. ${body.refundedAmount} recorded for payment ${paymentId} (Cumulative: Rs. ${result.cumulativeRefunded}, Reference: ${body.refundReference}). Payment remains in review until fully refunded.`
            : `Payment ${paymentId} confirmed as Refunded with reference ${body.refundReference}.`,
        });
      }

      if (action === 'deny_refund') {
        if (!body.reason || !body.reason.trim()) {
          return NextResponse.json(
            { error: 'Explicit reason is required to deny refund request.' },
            { status: 400 }
          );
        }

        const result = await denyManualRefund({
          paymentId,
          denierUserId: auth.uid,
          denierName: auth.name || auth.email || 'Admin',
          denierRole: auth.role,
          reason: body.reason.trim(),
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          action: 'deny_refund',
          message: `Refund for payment ${paymentId} denied. Amount retained in university accounts as Refund_Denied.`,
        });
      }

      return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
    } catch (err: any) {
      console.error('[AdminPaymentReconcileAPI] Error:', err);
      return NextResponse.json(
        { error: err?.message || 'Internal error processing payment reconciliation' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin'],
    rateLimit: RateLimits.ADMIN,
    schema: ReconcilePaymentSchema,
  }
);
