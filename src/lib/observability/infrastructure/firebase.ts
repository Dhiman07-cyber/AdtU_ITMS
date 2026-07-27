/**
 * PROGRAM-004 / PHASE-02 Firebase Auth & FCM Infrastructure Collector
 * Instrumenting token verification latency, auth success/failure, FCM push latency & invalid tokens.
 */

import { metrics } from '../metrics';

class FirebaseInfrastructureCollector {
  public recordTokenVerification(durationMs: number, success: boolean, reason?: string): void {
    metrics.counter('firebase_token_verifications_total', 'Total Firebase token verifications', {
      result: success ? 'success' : 'failure',
    });

    metrics.timer('firebase_token_verification_duration_seconds', 'Firebase token verification duration', durationMs);

    if (!success) {
      metrics.counter('firebase_token_verification_errors_total', 'Total token verification errors', {
        reason: reason || 'invalid_signature',
      });
    }
  }

  public recordFcmDispatch(notificationType: string, recipientCount: number, durationMs: number, success: boolean): void {
    metrics.counter('firebase_fcm_dispatches_total', 'Total FCM push notification dispatches', {
      type: notificationType,
      result: success ? 'success' : 'failure',
    }, recipientCount);

    metrics.timer('firebase_fcm_dispatch_duration_seconds', 'FCM dispatch duration', durationMs, {
      type: notificationType,
    });
  }

  public recordInvalidFcmToken(count = 1): void {
    metrics.counter('firebase_fcm_invalid_tokens_total', 'Total invalid FCM tokens pruned', {}, count);
  }
}

export const firebaseInfrastructureCollector = new FirebaseInfrastructureCollector();
