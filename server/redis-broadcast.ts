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

/** Unique identifier for this WS server process. Never changes after startup. */
export const MY_NODE_ID = crypto.randomUUID();

/** Redis channel all WS nodes listen on for cross-node broadcasts. */
const REDIS_BROADCAST_CHANNEL = 'ws:broadcast';

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
 * Publish a broadcast to Redis so other nodes can relay it to their local
 * subscribers. Called AFTER the local broadcast has already completed.
 *
 * Fire-and-forget: errors are logged but never surface to callers.
 */
export function publishToRedis(
  channel: string,
  event: string,
  payload: Record<string, unknown>
): void {
  const envelope: BroadcastEnvelope = {
    channel,
    event,
    payload,
    originNodeId: MY_NODE_ID,
  };

  redisPubSub.publish(REDIS_BROADCAST_CHANNEL, JSON.stringify(envelope)).catch((err) => {
    logger.warn('redis_broadcast_publish_error', {
      channel,
      event,
      error: (err as Error).message,
    });
  });
}

/**
 * Subscribe this node to the Redis broadcast channel.
 * Call once at server startup (after wsServer.start()).
 *
 * Callbacks are injected to avoid circular module imports:
 *   - onBroadcast: called to relay the event to local WS subscribers
 *   - onLocationUpdate: called to keep the in-process live-location cache in sync
 */
export async function initRedisBroadcastRelay(
  onBroadcast: (channel: string, event: string, payload: Record<string, unknown>) => void,
  onLocationUpdate: (busId: string, payload: Record<string, unknown>) => void,
): Promise<void> {
  await redisPubSub.subscribe(REDIS_BROADCAST_CHANNEL, (raw) => {
    let envelope: BroadcastEnvelope;
    try {
      envelope = JSON.parse(raw) as BroadcastEnvelope;
    } catch {
      logger.warn('redis_broadcast_parse_error', { raw: raw.slice(0, 200) });
      return;
    }

    // Skip our own messages — we already broadcast locally before publishing.
    if (envelope.originNodeId === MY_NODE_ID) return;

    // Keep local live-location cache in sync across nodes.
    if (envelope.event === 'bus_location_update' && envelope.payload.busId) {
      onLocationUpdate(envelope.payload.busId as string, envelope.payload);
    }

    // Relay to local subscribers.
    onBroadcast(envelope.channel, envelope.event, envelope.payload);
  });

  logger.info('redis_broadcast_relay_initialized', {
    nodeId: MY_NODE_ID,
    channel: REDIS_BROADCAST_CHANNEL,
  });
}
