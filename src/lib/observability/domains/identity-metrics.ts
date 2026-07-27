/**
 * PROGRAM-004 / PHASE-03 Identity, Auth & Session Observability
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class IdentityDomainObservability {
  public recordLogin(userId: string, role: string, durationMs: number): void {
    metrics.counter('auth_logins_total', 'Total user logins', { role });
    metrics.timer('auth_login_duration_seconds', 'User login duration', durationMs, { role });

    const event = createCanonicalEvent(
      'SessionStarted',
      { userId, role },
      { actor: { id: userId, role }, origin: 'identity' }
    );
    canonicalEventBus.publish(event);
  }

  public recordLogout(userId: string, role: string): void {
    metrics.counter('auth_logouts_total', 'Total user logouts', { role });

    const event = createCanonicalEvent(
      'SessionEnded',
      { userId, role },
      { actor: { id: userId, role }, origin: 'identity' }
    );
    canonicalEventBus.publish(event);
  }

  public recordAuthFailure(reason: string, role?: string): void {
    metrics.counter('auth_failures_total', 'Total authentication failures', { reason, role: role || 'unknown' });
  }

  public recordPermissionDenied(userId: string, role: string, resource: string): void {
    metrics.counter('auth_permission_denied_total', 'Total authorization permission denials', { role, resource });
  }

  public recordRoleChanged(userId: string, oldRole: string, newRole: string, adminId: string): void {
    metrics.counter('auth_role_changes_total', 'Total role change events', { new_role: newRole });

    const event = createCanonicalEvent(
      'RoleChanged',
      { userId, oldRole, newRole, adminId },
      { actor: { id: adminId, role: 'admin' }, target: { id: userId, type: 'user' }, origin: 'identity' }
    );
    canonicalEventBus.publish(event);
  }
}

export const identityDomainObservability = new IdentityDomainObservability();
