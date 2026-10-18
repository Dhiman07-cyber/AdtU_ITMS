/**
 * Redis Broadcast Bridge
 *
 * Wires Redis Pub/Sub into the WebSocket broadcast path for multi-node support.
 *
 * Architecture:
 *   - All WS nodes subscribe to REDIS_BROADCAST_CHANNEL on startup.
 *   - When any node originates a broadcast (from a driver's GPS update or
 *     a server-side event), it:
 *       1. Broadcasts locally to its own in-process subscribers immediately.
 *       2. Publishes to Redis so every OTHER node can relay it.
 *   - Receiving nodes check originNodeId and skip their own echoes.
 *
 * No circular imports:
 *   - This module does NOT import websocket-server or socket-router at module
 *     level. Callbacks are injected at init time (inversion of control).
 *
 * No-loop guarantee:
 *   - Each message carries originNodeId (crypto UUID assigned once at startup).
 *   - Receiving nodes skip messages where originNodeId === MY_NODE_ID.
 *
 * Graceful degradation:
 *   - If Redis is not configured, redisPubSub calls are no-ops.
 *   - Single-node in-process broadcast continues unchanged.
 */

import crypto from 'crypto';
import { redisPubSub } from './redis-pubsub';
import { logger } from './structured-logger';
import { invalidateTokenAuthCache } from './authenticator';
import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { metricsService } from './metrics-service';

/** Unique identifier for this WS server process. Never changes after startup. */
export const MY_NODE_ID = crypto.randomUUID();

/** Redis channel all WS nodes listen on for cross-node broadcasts. */
const REDIS_BROADCAST_CHANNEL = 'ws:broadcast';
const ROLE_INVALIDATE_CHANNEL = 'role_invalidate';
const ROLE_INVALIDATE_CHANNEL_ALT = 'itms:roles:invalidate';

interface BroadcastEnvelope {
  /** The WS channel to broadcast on (e.g. 'bus:ABC', 'trip-status-BUS123') */
  channel: string;
  /** The event name (e.g. 'bus_location_update', 'trip_ended') */
  event: string;
  /** Arbitrary payload */
  payload: Record<string, unknown>;
  /** Node that originated this message — receivers skip if it matches MY_NODE_ID */
  originNodeId: string;
}

/**
 * In the simplified single-process WebSocket architecture, all client subscribers
 * connect to this single WS runtime instance. Local in-process broadcast is already
 * completed synchronously before calling publishToRedis.
 *
 * Cross-node relay via Redis Pub/Sub (ws:broadcast) is bypassed to eliminate
 * redundant network roundtrips, serialization, and Redis pub/sub load.
 */
export function publishToRedis(
  _channel: string,
  _event: string,
  _payload: Record<string, unknown>
): void {
  // Bypassed: single-process WS runtime does not require cross-node relay.
  // Preserved as zero-overhead no-op.
}

/**
 * Initializes Redis listeners required for system security and state coordination.
 * In single-process WS mode, cross-node broadcast relay is bypassed, while
 * cross-process role invalidation (`role_invalidate`) is strictly preserved
 * to evict demoted or revoked users across application boundaries.
 */
export async function initRedisBroadcastRelay(
  _onBroadcast?: (channel: string, event: string, payload: Record<string, unknown>) => void,
  _onLocationUpdate?: (busId: string, payload: Record<string, unknown>) => void,
  _onTripEnded?: (busId: string) => void,
): Promise<void> {
  // Cross-node role invalidation listener: purges cached JWT auth and terminates
  // active sessions in this WS instance whenever an admin updates user permissions or roles.
  const handleRoleInvalidation = (rawUid: string) => {
    const uid = rawUid ? rawUid.trim() : undefined;
    invalidateTokenAuthCache(uid);

    // Evict cached student presence to reflect reassignment or privilege change immediately
    import('./socket-router')
      .then((m) => m.clearStudentPresenceCache(uid))
      .catch(() => {});

    if (uid) {
      const activeSessions = sessionManager.getByUid(uid);
      for (const session of activeSessions) {
        const conn = connectionRegistry.get(session.socketId);
        if (conn) {
          try {
            conn.ws.close(4401, 'Role revoked or permissions modified - please re-authenticate');
          } catch (err) {
            logger.warn('ws_close_on_revoke_error', { socketId: session.socketId, error: (err as Error).message });
          }
          connectionRegistry.unregister(session.socketId);
        }
        sessionManager.delete(session.socketId);
      }
      logger.info('ws_active_sessions_revoked', { uid, count: activeSessions.length });
    } else {
      for (const [socketId, conn] of connectionRegistry.getAll().entries()) {
        try {
          conn.ws.close(4401, 'Global permissions modified - please re-authenticate');
        } catch { /* ignore */ }
        connectionRegistry.unregister(socketId);
        sessionManager.delete(socketId);
      }
      logger.info('ws_all_sessions_revoked');
    }

    logger.info('ws_role_cache_invalidated', { uid: uid || 'all' });
  };

  const handleStudentAssignInvalidation = (rawUid: string) => {
    const uid = rawUid ? rawUid.trim() : undefined;
    import('./socket-router')
      .then((m) => m.clearStudentPresenceCache(uid === '*' ? undefined : uid))
      .catch(() => {});
    logger.info('ws_student_presence_cache_invalidated', { uid: uid || 'all' });
  };

  await redisPubSub.subscribe(ROLE_INVALIDATE_CHANNEL, handleRoleInvalidation);
  await redisPubSub.subscribe(ROLE_INVALIDATE_CHANNEL_ALT, handleRoleInvalidation);
  await redisPubSub.subscribe('student_assign_invalidate', handleStudentAssignInvalidation);

  logger.info('redis_security_listeners_initialized', {
    nodeId: MY_NODE_ID,
    roleInvalidateChannel: ROLE_INVALIDATE_CHANNEL,
    roleInvalidateChannelAlt: ROLE_INVALIDATE_CHANNEL_ALT,
    studentAssignInvalidateChannel: 'student_assign_invalidate',
    broadcastRelay: 'bypassed_single_node',
  });
}
