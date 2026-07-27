/**
 * PROGRAM-004 / PHASE-03 Student Application Funnel & Moderator Observability
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class ApplicationDomainObservability {
  private pendingQueueLength = 0;

  public recordDraftSaved(applicationId?: string): void {
    metrics.counter('applications_draft_saved_total', 'Total application drafts saved');
  }

  public recordSubmitted(applicationId: string, studentId: string): void {
    this.pendingQueueLength++;
    metrics.counter('applications_submitted_total', 'Total student applications submitted');
    metrics.gauge('applications_pending_queue_length', 'Current pending applications queue', {}, this.pendingQueueLength);

    const event = createCanonicalEvent(
      'ApplicationSubmitted',
      { applicationId, studentId },
      { actor: { id: studentId, role: 'student' }, target: { id: applicationId, type: 'application' }, origin: 'application' }
    );
    canonicalEventBus.publish(event);
  }

  public recordApproved(applicationId: string, moderatorId: string, reviewDurationMs: number): void {
    this.pendingQueueLength = Math.max(0, this.pendingQueueLength - 1);
    metrics.counter('applications_approved_total', 'Total student applications approved');
    metrics.gauge('applications_pending_queue_length', 'Current pending applications queue', {}, this.pendingQueueLength);
    metrics.timer('application_review_duration_seconds', 'Moderator review duration', reviewDurationMs);

    const event = createCanonicalEvent(
      'ApplicationApproved',
      { applicationId, moderatorId, reviewDurationMs },
      { actor: { id: moderatorId, role: 'moderator' }, target: { id: applicationId, type: 'application' }, origin: 'application' }
    );
    canonicalEventBus.publish(event);
  }

  public recordRejected(applicationId: string, moderatorId: string, reason: string): void {
    this.pendingQueueLength = Math.max(0, this.pendingQueueLength - 1);
    metrics.counter('applications_rejected_total', 'Total student applications rejected', { reason });
    metrics.gauge('applications_pending_queue_length', 'Current pending applications queue', {}, this.pendingQueueLength);

    const event = createCanonicalEvent(
      'ApplicationRejected',
      { applicationId, moderatorId, reason },
      { actor: { id: moderatorId, role: 'moderator' }, target: { id: applicationId, type: 'application' }, origin: 'application' }
    );
    canonicalEventBus.publish(event);
  }
}

export const applicationDomainObservability = new ApplicationDomainObservability();
