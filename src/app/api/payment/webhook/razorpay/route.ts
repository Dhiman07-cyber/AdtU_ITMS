/**
 * Razorpay Webhook Handler
 * 
 * SECURITY FIXES:
 * - Atomic idempotency check inside transaction to prevent race conditions
 * - Uses order notes (trusted source) instead of payment notes
 * - Processed payment marker set BEFORE student update
 */

import { processCapturedPayment } from '@/lib/payment/payment.service';
import { fetchOrderDetails } from '@/lib/payment/razorpay.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('X-Razorpay-Signature');
    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook received. signature:`, signature);

    if (!signature) {
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: No signature provided`);
      return NextResponse.json({ error: 'No signature provided' }, { status: 400 });
    }

    // Verify webhook signature
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Webhook secret not configured`);
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    if (!signature || signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      )) {
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Invalid signature`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Signature verified successfully`);

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      console.warn('[webhook] Webhook received invalid JSON payload');
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const event = payload?.event;
    const paymentEntity = payload?.payload?.payment?.entity;
    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Event is:`, event);

    if (event === 'payment.captured') {
      if (!paymentEntity) {
        console.error('[webhook] payment.captured event missing payment entity');
        return NextResponse.json({ error: 'Missing payment entity' }, { status: 400 });
      }
      const { id: paymentId, order_id, amount, method } = paymentEntity;

      // SECURITY: Fetch order details from Razorpay to get TRUSTED data.
      // Don't trust payment notes - they can differ from order notes.
      // On fetch failure return 502 (NOT 200): Razorpay retries webhooks on
      // non-2xx, so the payment is processed on retry instead of being
      // processed now from untrusted payment-entity notes.
      let orderDetails;
      try {
        orderDetails = await fetchOrderDetails(order_id);
      } catch (error) {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: order fetch failed, returning 502 for retry`);
        return NextResponse.json({ error: 'Order verification unavailable, retrying' }, { status: 502 });
      }

      // SECURITY: Extract trusted values from order notes only.
      const notes = orderDetails.notes || {};

      // Amount binding (mirrors verify-payment): the captured amount must
      // match the trusted order amount before any ledger write. A mismatch is
      // deterministic (integer paise), so 400 stops Razorpay retries.
      if (Number(orderDetails.amount || 0) !== Number(paymentEntity.amount || 0)) {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: amount mismatch, rejecting`);
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
      }

      // Currency invariant: compare provider payment details to trusted order data.
      // Must both explicitly be 'INR' and match each other. Fail-closed: reject absent, empty, invalid or mismatched currencies.
      const rawOrderCurrency = orderDetails.currency;
      const rawPaymentCurrency = paymentEntity.currency;
      const isOrderCurrencyValid = typeof rawOrderCurrency === 'string' && rawOrderCurrency.trim().toUpperCase() === 'INR';
      const isPaymentCurrencyValid = typeof rawPaymentCurrency === 'string' && rawPaymentCurrency.trim().toUpperCase() === 'INR';

      if (!isOrderCurrencyValid || !isPaymentCurrencyValid) {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: currency invalid or mismatch (order: ${String(rawOrderCurrency)}, payment: ${String(rawPaymentCurrency)}), rejecting`);
        return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Calling processCapturedPayment for:`, paymentId, `orderId:`, order_id);
      const result = await processCapturedPayment({
        paymentId,
        orderId: order_id,
        amount: amount / 100, // convert to rupees
        method: method || 'Online',
        notes,
        source: 'webhook'
      });
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: processCapturedPayment returned:`, JSON.stringify(result));

      if (result.status === 'error') {
        // Log the internal error detail server-side only — never expose it to
        // Razorpay (external caller). The generic response still triggers a
        // Razorpay retry on 5xx so the payment is retried safely.
        console.error('[webhook] processCapturedPayment error (internal):', result.error);
        return NextResponse.json({ error: 'Payment processing failed' }, { status: 500 });
      }

      return NextResponse.json({ status: result.status }, { status: 200 });
    }

    if (event === 'refund.processed') {
      const refundEntity = payload.payload?.refund?.entity;
      if (!refundEntity?.payment_id || !refundEntity?.id) {
        console.warn('[webhook] refund.processed received without payment_id or refund id');
        return NextResponse.json({ error: 'Missing refund entity identifiers' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: refund.processed received for payment ${refundEntity.payment_id}, refund ${refundEntity.id}, amount ${refundEntity.amount}`);
      
      const paymentRec = await paymentsSupabaseService.getPaymentByRazorpayId(refundEntity.payment_id)
        || await paymentsSupabaseService.getPaymentById(refundEntity.payment_id);
      
      if (!paymentRec) {
        console.error(`[webhook] refund.processed: Payment ${refundEntity.payment_id} not found in database`);
        return NextResponse.json({ error: 'Payment record not found for refund' }, { status: 404 });
      }

      const refundAmountRupees = (Number(refundEntity.amount) || 0) / 100;
      if (refundAmountRupees <= 0) {
        console.warn(`[webhook] refund.processed: invalid refund amount ${refundEntity.amount}`);
        return NextResponse.json({ error: 'Invalid refund amount' }, { status: 400 });
      }

      // Execute atomic refund recording across Completed, Duplicate_Pending_Refund, and Captured_Pending_Review
      const refundResult = await paymentsSupabaseService.confirmManualRefundRecord({
        paymentId: paymentRec.payment_id,
        refundReference: refundEntity.id,
        refundedAmount: refundAmountRupees,
        authorizedBy: {
          userId: 'system:razorpay_webhook',
          name: 'Razorpay Gateway Webhook',
          role: 'system',
          type: 'system',
        },
        reason: `Automated gateway refund processed event received from Razorpay (${refundEntity.id})`,
      });

      if (!refundResult.success) {
        console.error('[webhook] confirmManualRefundRecord failed:', refundResult.error);
        return NextResponse.json({ error: refundResult.error || 'Failed to record refund' }, { status: 500 });
      }

      return NextResponse.json({ 
        status: 'refund_processed',
        isPartial: refundResult.isPartial,
        cumulativeRefunded: refundResult.cumulativeRefunded 
      }, { status: 200 });
    }

    if (event === 'payment.failed') {
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: payment.failed received for order ${orderId}, payment ${paymentId}, code: ${paymentEntity?.error_code}`);
      
      if (orderId || paymentId) {
        // getPaymentByRazorpayOrderId queries by razorpay_order_id (set at order creation).
        // getPaymentByRazorpayId queries by razorpay_payment_id (set at capture, may not exist yet).
        // getPaymentById queries by internal payment_id; never by Razorpay IDs — do NOT use for orderId lookup.
        const pendingRec = (orderId ? await paymentsSupabaseService.getPaymentByRazorpayOrderId(orderId) : null)
          || (paymentId ? await paymentsSupabaseService.getPaymentByRazorpayId(paymentId) : null);
        
        if (pendingRec && pendingRec.status === 'Pending') {
          const ok = await paymentsSupabaseService.updatePaymentMetadata(pendingRec.payment_id, {
            gateway_payment_failed_at: new Date().toISOString(),
            gateway_error_code: paymentEntity.error_code || 'unknown_failure',
            gateway_error_description: paymentEntity.error_description || 'Gateway reported payment failure',
            gateway_error_reason: paymentEntity.error_reason || 'payment_failed',
            gateway_failed_payment_id: paymentEntity.id,
            requires_student_retry: true,
          });

          if (!ok) {
            console.error('[webhook] Error updating payment.failed metadata: database write failed');
            return NextResponse.json({ error: 'Failed to record payment failure' }, { status: 500 });
          }
        }
      }
      return NextResponse.json({ status: 'payment_failed_logged' }, { status: 200 });
    }

    if (event === 'refund.created') {
      const refundEntity = payload.payload?.refund?.entity;
      if (!refundEntity?.payment_id || !refundEntity?.id) {
        return NextResponse.json({ error: 'Missing refund entity identifiers' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: refund.created received for payment ${refundEntity.payment_id}, refund ${refundEntity.id}`);

      const paymentRec = await paymentsSupabaseService.getPaymentByRazorpayId(refundEntity.payment_id)
        || await paymentsSupabaseService.getPaymentById(refundEntity.payment_id);

      if (paymentRec) {
        const refundAmountRupees = (Number(refundEntity.amount) || 0) / 100;
        const currentRefunds = Array.isArray(paymentRec.metadata?.refund_history) ? [...paymentRec.metadata.refund_history] : [];
        const trimmedRef = refundEntity.id.trim();
        const existingIdx = currentRefunds.findIndex((r: any) => r.refund_id === trimmedRef);
        const now = new Date().toISOString();

        if (existingIdx >= 0) {
          currentRefunds[existingIdx] = {
            ...currentRefunds[existingIdx],
            status: refundEntity.status || 'created',
            updated_at: now,
          };
        } else {
          currentRefunds.push({
            refund_id: trimmedRef,
            amount: refundAmountRupees,
            status: refundEntity.status || 'created',
            created_at: now,
            source: 'webhook:refund.created',
          });
        }

        const ok = await paymentsSupabaseService.updatePaymentMetadata(paymentRec.payment_id, {
          last_refund_event: 'refund.created',
          last_refund_event_at: now,
          refund_history: currentRefunds,
          latest_refund_id: trimmedRef,
          latest_refund_status: refundEntity.status || 'created',
        });

        if (!ok) {
          console.error('[webhook] Failed to record refund.created event in metadata');
          return NextResponse.json({ error: 'Failed to record refund.created event' }, { status: 500 });
        }
      }

      return NextResponse.json({ status: 'refund_created_logged' }, { status: 200 });
    }

    if (event === 'refund.failed') {
      const refundEntity = payload.payload?.refund?.entity;
      if (!refundEntity?.payment_id || !refundEntity?.id) {
        return NextResponse.json({ error: 'Missing refund entity identifiers' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: refund.failed received for payment ${refundEntity.payment_id}, refund ${refundEntity.id}`);

      const paymentRec = await paymentsSupabaseService.getPaymentByRazorpayId(refundEntity.payment_id)
        || await paymentsSupabaseService.getPaymentById(refundEntity.payment_id);

      if (paymentRec) {
        const currentRefunds = Array.isArray(paymentRec.metadata?.refund_history) ? [...paymentRec.metadata.refund_history] : [];
        const trimmedRef = refundEntity.id.trim();
        const existingIdx = currentRefunds.findIndex((r: any) => r.refund_id === trimmedRef);
        const now = new Date().toISOString();
        const errorInfo = {
          code: refundEntity.error_code || 'gateway_refund_failed',
          description: refundEntity.error_description || 'Gateway reported refund failure',
          reason: refundEntity.error_reason || 'unknown',
        };

        if (existingIdx >= 0) {
          currentRefunds[existingIdx] = {
            ...currentRefunds[existingIdx],
            status: 'failed',
            error: errorInfo,
            failed_at: now,
          };
        } else {
          currentRefunds.push({
            refund_id: trimmedRef,
            amount: (Number(refundEntity.amount) || 0) / 100,
            status: 'failed',
            error: errorInfo,
            failed_at: now,
            source: 'webhook:refund.failed',
          });
        }

        const ok = await paymentsSupabaseService.updatePaymentMetadata(paymentRec.payment_id, {
          last_refund_event: 'refund.failed',
          last_refund_event_at: now,
          refund_history: currentRefunds,
          refund_failed_alert: true,
          latest_refund_error: errorInfo,
          requires_refund_review: true, // Actionable flag for university finance staff
        });

        if (!ok) {
          console.error('[webhook] Failed to record refund.failed event in metadata');
          return NextResponse.json({ error: 'Failed to record refund failure' }, { status: 500 });
        }
      }

      return NextResponse.json({ status: 'refund_failed_logged' }, { status: 200 });
    }

    return NextResponse.json({ status: 'received' }, { status: 200 });

  } catch (error) {
    console.error('[webhook] Processing error:', (error as any)?.message);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
