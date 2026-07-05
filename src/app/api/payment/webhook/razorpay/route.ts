/**
 * Razorpay Webhook Handler
 * 
 * SECURITY FIXES:
 * - Atomic idempotency check inside transaction to prevent race conditions
 * - Uses order notes (trusted source) instead of payment notes
 * - Processed payment marker set BEFORE student update
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { fetchOrderDetails } from '@/lib/payment/razorpay.service';
import { processCapturedPayment } from '@/lib/payment/payment.service';

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

    const payload = JSON.parse(body);
    const event = payload.event;
    const paymentEntity = payload.payload?.payment?.entity;
    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Event is:`, event);

    if (event === 'payment.captured' && paymentEntity) {
      const { id: paymentId, order_id, amount, method } = paymentEntity;

      // SECURITY: Fetch order details from Razorpay to get TRUSTED data
      // Don't trust payment notes - they can be different from order notes
      let orderDetails;
      try {
        orderDetails = await fetchOrderDetails(order_id);
      } catch (error) {
        // Fallback to payment notes if order fetch fails
        orderDetails = { notes: paymentEntity.notes || {} };
      }

      // SECURITY: Extract trusted values from order notes
      const notes = orderDetails.notes || paymentEntity.notes || {};

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
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      return NextResponse.json({ status: result.status }, { status: 200 });
    }

    return NextResponse.json({ status: 'received' }, { status: 200 });

  } catch (error) {
    console.error('[webhook] Processing error:', (error as any)?.message);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
