# Redis Pub/Sub & Inter-Node Broadcast Architecture

## 1. Role & Architectural Purpose

In the ITMS deployment topology, client connections are distributed across multiple WebSocket server instances (e.g., `ws1` on port 3001, `ws2` on port 3001 mapped to host 3003 behind NGINX).

A driver transmitting live GPS telemetry may be connected to **Node 1**, while a student waiting for that bus is connected to **Node 2**. 

```
                                  REDIS BROADCAST TOPOLOGY
                                  
    [ Driver Web App ]                                                [ Student Web App ]
        │                                                                  ▲
        ▼ (Port 3001)                                                      │ (Port 3003)
+──────────────────────+       PUBLISH ws:broadcast       +──────────────────────+
| WebSocket Node 1     |─────────────────────────────────►| WebSocket Node 2     |
| (MY_NODE_ID = nodeA) |                                  | (MY_NODE_ID = nodeB) |
+──────────────────────+                                  +──────────────────────+
           │                                                         ▲
           │                     +─────────────────+                 │
           └────────────────────►| Redis 7.2 Broker|─────────────────┘
                                 | Channels:       |
                                 | 'ws:broadcast'  |
                                 |'role_invalidate'|
                                 +─────────────────+
```

### Why PostgreSQL Cannot Replace Redis for This Role
1. **Sub-50ms Telemetry Cadence**: GPS telemetry arrives at 1Hz per active bus. PostgreSQL `LISTEN/NOTIFY` holds transaction queue overhead, bloats WAL files, and imposes database connection pool contention.
2. **Transient vs Durable Separation**: Real-time position coordinates are ephemeral stream packets. If a packet is lost in flight, the next second's update supersedes it. Redis handles this in-memory with zero disk-write amplification.
3. **Dedicated Fan-Out Broker**: Redis pub/sub delivers `O(N)` distribution to subscribed application nodes without touching database read-replicas.

---

## 2. Channel Design & Wire Protocol

Rather than creating unbounded Redis channels per bus (which complicates subscription tracking across clusters), ITMS multiplexes all inter-node events through two dedicated Redis channels:

```typescript
const REDIS_BROADCAST_CHANNEL = 'ws:broadcast';
const ROLE_INVALIDATE_CHANNEL = 'role_invalidate';
```

### Message Envelope Structure (`BroadcastEnvelope`)
Located in [`server/redis-broadcast.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/redis-broadcast.ts):
```typescript
interface BroadcastEnvelope {
  /** The application-level WebSocket channel (e.g., 'bus_location_STAGING-BUS-001', 'trip-status-BUS-1') */
  channel: string;
  /** Event identifier (e.g., 'bus_location_update', 'trip_started', 'trip_ended', 'waiting_flag_created') */
  event: string;
  /** Arbitrary payload including coordinates, status flags, timestamps */
  payload: Record<string, unknown>;
  /** Unique UUID of the originating node to prevent echo storms */
  originNodeId: string;
}
```

---

## 3. Implementation Deep Dive

### 3.1 Node Identity & Echo Suppression ([`server/redis-broadcast.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/redis-broadcast.ts))

Every WebSocket node generates a permanent cryptographically secure UUID at boot time (`MY_NODE_ID = crypto.randomUUID()`). When a node publishes a message to Redis, it tags the envelope with its `originNodeId`. Receiving nodes inspect the ID and discard messages that originated from themselves:

```typescript
// server/redis-broadcast.ts
import crypto from 'crypto';
import { redisPubSub } from './redis-pubsub';
import { logger } from './structured-logger';
import { metricsService } from './metrics-service';

/** Unique identifier for this WS server process. Never changes after startup. */
export const MY_NODE_ID = crypto.randomUUID();

/** Redis channel all WS nodes listen on for cross-node broadcasts. */
const REDIS_BROADCAST_CHANNEL = 'ws:broadcast';
const ROLE_INVALIDATE_CHANNEL = 'role_invalidate';

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

  metricsService.inc('redisPubSubMessages');
  redisPubSub.publish(REDIS_BROADCAST_CHANNEL, JSON.stringify(envelope)).catch((err) => {
    logger.warn('redis_broadcast_publish_error', {
      channel,
      event,
      error: (err as Error).message,
    });
  });
}
```

### 3.2 Relay & In-Process Cache & Metric Synchronization

When a message arrives over Redis from a peer node, three operations occur:
1. **Cache Synchronization**: If the event is `bus_location_update`, the local in-process `liveBusLocations` map is updated so newly connected clients on this node get instant initial positions.
2. **Prometheus Metric Synchronization**: Relay nodes increment matching counters (`tripsStarted`, `tripsEnded`, `waitingFlagsCreated`, `waitingFlagsCancelled`, `gpsAccepted`), ensuring Prometheus scrapers observe identical metrics regardless of which node handles the primary event.
3. **Local Relay**: The event is pushed directly to all local clients subscribed to `envelope.channel`.

```typescript
// server/redis-broadcast.ts
export async function initRedisBroadcastRelay(
  onBroadcast: (channel: string, event: string, payload: Record<string, unknown>) => void,
  onLocationUpdate: (busId: string, payload: Record<string, unknown>) => void,
  onTripEnded?: (busId: string) => void,
): Promise<void> {
  await redisPubSub.subscribe(REDIS_BROADCAST_CHANNEL, (raw) => {
    metricsService.inc('redisPubSubMessages');
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
    const busIdMatch = envelope.channel.match(/^(?:bus:|bus_location_|trip-status-)(.+)$/);
    const busId = (envelope.payload.busId as string) || busIdMatch?.[1];

    if (envelope.event === 'bus_location_update' && busId) {
      metricsService.inc('gpsAccepted');
      onLocationUpdate(busId, envelope.payload);
    } else if (envelope.event === 'trip_ended' && busId) {
      onTripEnded?.(busId);
    }

    // Synchronize cluster-wide Prometheus counters on relay nodes
    if (envelope.event === 'trip_started') metricsService.inc('tripsStarted');
    if (envelope.event === 'trip_ended') metricsService.inc('tripsEnded');
    if (envelope.event === 'waiting_flag_raised' || envelope.event === 'waiting_flag_created') metricsService.inc('waitingFlagsCreated');
    if (envelope.event === 'waiting_flag_cancelled' || envelope.event === 'waiting_flag_resolved' || envelope.event === 'waiting_flag_removed' || envelope.event === 'waiting_flag_boarded') {
      metricsService.inc('waitingFlagsCancelled');
    }

    // Relay to local subscribers.
    onBroadcast(envelope.channel, envelope.event, envelope.payload);
  });
}
```

### 3.3 Cross-Node Active Session Invalidation & Role Revocation (`role_invalidate`)

When administrators modify permissions, demote roles, or suspend user accounts in the database:
1. The administrative API publishes the modified `uid` to the Redis channel `role_invalidate`.
2. All WebSocket server instances in the cluster listen on `role_invalidate`:
   - Purge handshake cache entries (`invalidateTokenAuthCache(uid)`).
   - Query `sessionManager.getByUid(uid)` to locate all active sessions for that user on the current node.
   - Forcefully close each active socket with code `4401` (`Role revoked or permissions modified - please re-authenticate`).
   - Unregister connections from `connectionRegistry` and delete session state from `sessionManager`.

```typescript
// server/redis-broadcast.ts
await redisPubSub.subscribe(ROLE_INVALIDATE_CHANNEL, (rawUid) => {
  const uid = rawUid ? rawUid.trim() : undefined;
  invalidateTokenAuthCache(uid);

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
});
```

### 3.4 Raw TCP Resilient Redis Client ([`server/redis-client.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/redis-client.ts))

The server implements a zero-dependency dual-socket TCP RESP client (`ResilientRedisClient`):
- **Command Socket (`clientSocket`)**: Handles `AUTH`, `PUBLISH`, and query commands.
- **Subscription Socket (`subSocket`)**: Dedicated exclusively to long-running `SUBSCRIBE` streams, preventing command/response head-of-line blocking.
- **Generation Tracking (`this.generation`, `this.subGeneration`)**: Reconnection attempts invalidate prior callback closures, preventing zombie socket listeners from corrupting active connection state.

---

## 4. Resilience & Degradation Guarantees

1. **Graceful Fallback to In-Process Routing**:
   - If `REDIS_URL` is omitted, or if the Redis container crashes, `redisClient.isReady()` evaluates to `false`.
   - The WebSocket cluster automatically falls back to single-node in-process delivery. Local clients connected to the same node as the driver experience zero interruption.
2. **Non-Blocking Fire-and-Forget**:
   - `publishToRedis` catches and logs errors asynchronously. A transient Redis timeout or packet drop will never block the driver's WebSocket connection or fail an HTTP response.
3. **Deduplication Invariant**:
   - Because `publishToRedis` is called *after* local broadcast, and `envelope.originNodeId === MY_NODE_ID` is strictly ignored by the publisher node, no client ever receives duplicate packets from Redis reflection.
4. **Instant Multi-Node Role Invalidation**:
   - Publication to `role_invalidate` triggers instant cross-node socket termination with code `4401`, guaranteeing revoked users cannot maintain stale administrative access across cluster instances.
