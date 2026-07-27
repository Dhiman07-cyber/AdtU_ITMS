/**
 * PROGRAM-004 / PHASE-03 Admin, Moderator & Audit Correlation Observability
 */

import { metrics } from '../metrics';
import { logger } from '../logger';
import { canonicalEventBus, createCanonicalEvent } from '../events';
import { getRequestContext } from '../context';

class AdminAuditObservability {
  public recordAdminOperation(operation: string, targetType: string, adminId: string, durationMs: number, success: boolean): void {
    metrics.counter('admin_operations_total', 'Total administrative operations executed', {
      operation,
      target_type: targetType,
      result: success ? 'success' : 'failure',
    });

    metrics.timer('admin_operation_duration_seconds', 'Administrative operation duration', durationMs, {
      operation,
    });

    const ctx = getRequestContext();
    logger.info('admin', `${operation}_executed`, {
      operation,
      targetType,
      adminId,
      durationMs,
      result: success ? 'SUCCESS' : 'FAILURE',
      correlationId: ctx?.correlationId,
      traceId: ctx?.traceContext?.traceId,
    });
  }

  public recordConfigurationChanged(key: string, adminId: string, category?: string): void {
    metrics.counter('admin_config_changes_total', 'Total system configuration changes', { key, category: category || 'general' });

    const event = createCanonicalEvent(
      'ConfigurationUpdated',
      { key, category },
      { actor: { id: adminId, role: 'admin' }, origin: 'admin' }
    );
    canonicalEventBus.publish(event);
  }

  public recordReassignmentOperation(operation: 'reassign' | 'rollback', affectedCount: number, adminId: string): void {
    metrics.counter('admin_reassignments_total', 'Total student reassignment operations', { operation });
    metrics.gauge('admin_reassigned_students_count', 'Count of students affected in last reassignment', {}, affectedCount);
  }
}

export const adminAuditObservability = new AdminAuditObservability();
