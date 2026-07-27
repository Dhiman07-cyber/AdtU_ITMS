/**
 * PROGRAM-004 / PHASE-03 Notification & Waiting Flag Observability
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class NotificationDomainObservability {
  public recordNotificationSent(type: string, recipientRole: string): void {
    metrics.counter('notifications_sent_total', 'Total notifications sent', { type, recipient_role: recipientRole });

    const event = createCanonicalEvent(
      'NotificationSent',
      { type, recipientRole },
      { origin: 'notification' }
    );
    canonicalEventBus.publish(event);
  }

  public recordWaitingFlagRaised(flagId: string, studentId: string, busId: string, stopId?: string): void {
    metrics.counter('waiting_flags_raised_total', 'Total student waiting flags raised');

    const event = createCanonicalEvent(
      'WaitingFlagRaised',
      { flagId, studentId, busId, stopId },
      { actor: { id: studentId, role: 'student' }, target: { id: busId, type: 'bus' }, origin: 'waiting_flag' }
    );
    canonicalEventBus.publish(event);
  }

  public recordWaitingFlagAcknowledged(flagId: string, driverId: string, responseDurationMs: number): void {
    metrics.counter('waiting_flags_acknowledged_total', 'Total waiting flags acknowledged by driver');
    metrics.timer('waiting_flag_driver_response_duration_seconds', 'Driver waiting flag response time', responseDurationMs);
  }

  public recordStudentBoarded(flagId: string, studentId: string, busId: string, boardingDurationMs = 0): void {
    metrics.counter('waiting_flags_boarded_total', 'Total student boardings completed');
    if (boardingDurationMs > 0) {
      metrics.timer('waiting_flag_boarding_duration_seconds', 'Student boarding duration', boardingDurationMs);
    }

    const event = createCanonicalEvent(
      'StudentBoarded',
      { flagId, studentId, busId },
      { actor: { id: studentId, role: 'student' }, target: { id: busId, type: 'bus' }, origin: 'waiting_flag' }
    );
    canonicalEventBus.publish(event);
  }

  public recordWaitingFlagExpired(flagId: string): void {
    metrics.counter('waiting_flags_expired_total', 'Total waiting flags timed out / expired');
  }
}

export const notificationDomainObservability = new NotificationDomainObservability();
