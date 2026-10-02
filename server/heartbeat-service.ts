import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { metricsService } from './metrics-service';
import { logger } from './structured-logger';
import { getSupabaseServer } from '@/lib/supabase-server';

const PING_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10);
const TIMEOUT_GRACE = parseInt(process.env.HEARTBEAT_TIMEOUT_GRACE_MS || '5000', 10);
const ENTITLEMENT_INTERVAL = parseInt(process.env.ENTITLEMENT_REVALIDATE_INTERVAL_MS || '15000', 10);
const MAX_MISSED_BEFORE_WARN = 2;

export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private entitlementTimer: ReturnType<typeof setInterval> | null = null;
  private missedCount = new Map<string, number>();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), PING_INTERVAL);

    // Bounded authoritative entitlement revalidation (runs even during Redis outage)
    this.entitlementTimer = setInterval(() => {
      this.revalidateEntitlements().catch((err) => {
        logger.warn('entitlement_revalidation_error', { error: (err as Error).message });
      });
    }, ENTITLEMENT_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.missedCount.clear();
    }
    if (this.entitlementTimer) {
      clearInterval(this.entitlementTimer);
      this.entitlementTimer = null;
    }
  }

  cleanup(socketId: string): void {
    this.missedCount.delete(socketId);
  }

  /**
   * Authoritative bounded entitlement revalidation directly against PostgreSQL.
   * Ensures that if Redis pub/sub is down or disconnected, any revoked role,
   * soft-blocked student, or expired entitlement will still be terminated
   * within ENTITLEMENT_INTERVAL.
   */
  async revalidateEntitlements(): Promise<void> {
    const activeSockets = Array.from(sessionManager.getActiveSockets());
    if (activeSockets.length === 0) return;

    const studentSessions = activeSockets.filter((s) => s.role === 'student' && s.busId);
    const nonStudentSessions = activeSockets.filter((s) => s.role !== 'student' && s.role !== 'server');

    const supabase = getSupabaseServer();
    const now = new Date();

    // 1. Revalidate active student sessions
    if (studentSessions.length > 0) {
      const uids = Array.from(new Set(studentSessions.map((s) => s.uid)));
      const { data: profiles, error } = await supabase
        .from('student_profiles')
        .select('uid, bus_id, status, soft_block, valid_until')
        .in('uid', uids);

      if (!error && profiles) {
        const profileMap = new Map(profiles.map((p) => [p.uid, p]));
        for (const session of studentSessions) {
          const profile = profileMap.get(session.uid);
          let revokeReason: string | null = null;

          if (!profile) {
            revokeReason = 'Student profile not found';
          } else if (profile.status !== 'active') {
            revokeReason = `Student status changed to ${profile.status}`;
          } else if (session.busId && profile.bus_id !== session.busId) {
            revokeReason = `Assigned bus changed from ${session.busId} to ${profile.bus_id}`;
          } else if (profile.soft_block && new Date(profile.soft_block) <= now) {
            revokeReason = 'Student soft-block period reached';
          } else if (profile.valid_until && new Date(profile.valid_until) <= now) {
            revokeReason = 'Student pass validity expired';
          }

          if (revokeReason) {
            const entry = connectionRegistry.get(session.socketId);
            if (entry) {
              logger.warn('ws_entitlement_revoked_by_revalidation', {
                uid: session.uid,
                socketId: session.socketId,
                reason: revokeReason,
              });
              try {
                entry.ws.close(4401, `Entitlement revoked: ${revokeReason}`);
              } catch {}
              connectionRegistry.unregister(session.socketId);
            }
            sessionManager.delete(session.socketId);
          }
        }
      }
    }

    // 2. Revalidate non-student roles (moderator, driver, admin) against users table
    if (nonStudentSessions.length > 0) {
      const uids = Array.from(new Set(nonStudentSessions.map((s) => s.uid)));
      const { data: users, error } = await supabase
        .from('users')
        .select('uid, role')
        .in('uid', uids);

      if (!error && users) {
        const userMap = new Map(users.map((u) => [u.uid, u.role]));
        for (const session of nonStudentSessions) {
          const currentRole = userMap.get(session.uid);
          if (!currentRole || currentRole !== session.role) {
            const entry = connectionRegistry.get(session.socketId);
            if (entry) {
              logger.warn('ws_role_revoked_by_revalidation', {
                uid: session.uid,
                socketId: session.socketId,
                oldRole: session.role,
                newRole: currentRole || 'deleted',
              });
              try {
                entry.ws.close(4401, 'Role revoked or modified - please re-authenticate');
              } catch {}
              connectionRegistry.unregister(session.socketId);
            }
            sessionManager.delete(session.socketId);
          }
        }
      }
    }
  }

  private check(): void {
    const now = Date.now();
    const threshold = PING_INTERVAL + TIMEOUT_GRACE;
    for (const session of sessionManager.getActiveSockets()) {
      const entry = connectionRegistry.get(session.socketId);

      if (entry && entry.ws.readyState === entry.ws.OPEN) {
        entry.ws.ping();
      }

      const elapsed = now - session.lastHeartbeat;
      if (elapsed > threshold) {
        const missed = (this.missedCount.get(session.socketId) || 0) + 1;
        this.missedCount.set(session.socketId, missed);

        if (missed >= MAX_MISSED_BEFORE_WARN) {
          if (entry) {
            logger.warn('heartbeat_timeout', { uid: session.uid, socketId: session.socketId, elapsedMs: elapsed, missed });
            entry.ws.close(4002, 'Heartbeat timeout');
            metricsService.inc('heartbeatTimeouts');
          }
        }
      } else {
        this.missedCount.delete(session.socketId);
      }
    }
  }
}

export const heartbeatService = new HeartbeatService();

