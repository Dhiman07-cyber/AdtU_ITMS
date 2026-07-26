import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { metricsService } from './metrics-service';
import { logger } from './structured-logger';

const PING_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10);
const TIMEOUT_GRACE = parseInt(process.env.HEARTBEAT_TIMEOUT_GRACE_MS || '5000', 10);
const MAX_MISSED_BEFORE_WARN = 2;

export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private missedCount = new Map<string, number>();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), PING_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.missedCount.clear();
    }
  }

  private check(): void {
    const now = Date.now();
    const threshold = PING_INTERVAL + TIMEOUT_GRACE;
    for (const session of sessionManager.getActiveSockets()) {
      const elapsed = now - session.lastHeartbeat;
      if (elapsed > threshold) {
        const missed = (this.missedCount.get(session.socketId) || 0) + 1;
        this.missedCount.set(session.socketId, missed);

        if (missed >= MAX_MISSED_BEFORE_WARN) {
          const entry = connectionRegistry.get(session.socketId);
          if (entry) {
            logger.warn('heartbeat_timeout', { uid: session.uid, socketId: session.socketId, elapsedMs: elapsed, missed });
            entry.ws.close(4002, 'Heartbeat timeout');
            sessionManager.delete(session.socketId);
            connectionRegistry.unregister(session.socketId);
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
