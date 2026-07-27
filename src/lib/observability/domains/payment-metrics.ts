/**
 * PROGRAM-004 / PHASE-03 Payment Domain & Financial Observability
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class PaymentDomainObservability {
  public recordPaymentInitiated(paymentId: string, studentId: string, amount: number, method: 'online' | 'offline'): void {
    metrics.counter('payments_initiated_total', 'Total payments initiated', { method });
    metrics.timer('payment_amount_initiated_inr', 'Payment amount initiated', amount, { method });

    const event = createCanonicalEvent(
      'PaymentInitiated',
      { paymentId, studentId, amount, method },
      { actor: { id: studentId, role: 'student' }, origin: 'payment' }
    );
    canonicalEventBus.publish(event);
  }

  public recordPaymentCompleted(paymentId: string, studentId: string, amount: number, method: 'online' | 'offline', gatewayDurationMs = 0): void {
    metrics.counter('payments_completed_total', 'Total payments completed', { method });
    metrics.counter('payment_revenue_total_inr', 'Total revenue generated in INR', { method }, amount);

    if (gatewayDurationMs > 0) {
      metrics.timer('payment_gateway_duration_seconds', 'Payment gateway duration', gatewayDurationMs, { method });
    }

    const event = createCanonicalEvent(
      'PaymentCompleted',
      { paymentId, studentId, amount, method },
      { actor: { id: studentId, role: 'student' }, origin: 'payment', reliabilityExpectation: 'EXACTLY_ONCE' }
    );
    canonicalEventBus.publish(event);
  }

  public recordPaymentFailed(paymentId: string, reason: string, errorClass: string): void {
    metrics.counter('payments_failed_total', 'Total failed payments', { reason, error_type: errorClass });
  }

  public recordWebhookReceived(event: string, success: boolean): void {
    metrics.counter('payment_webhooks_total', 'Total Razorpay webhooks received', {
      event,
      result: success ? 'success' : 'failure',
    });
  }

  public recordReceiptVerification(paymentId: string, success: boolean): void {
    metrics.counter('payment_receipt_verifications_total', 'Total receipt QR verifications', {
      result: success ? 'success' : 'failure',
    });
  }
}

export const paymentDomainObservability = new PaymentDomainObservability();
