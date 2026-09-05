# Redis Pub/Sub & Inter-Node Broadcast Architecture

## 1. Role & Architectural Purpose

In the ITMS deployment topology, client connections are distributed across multiple WebSocket server instances (e.g., `ws1` on port 3001, `ws2` on port 3003 behind NGINX).

A driver transmitting live GPS telemetry may be connected to **Node 1**, while a student waiting for that bus is connected to **Node 2**. 

```
                                  REDIS BROADCAST TOPOLOGY
                                  
    [ Driver ]                                                        [ Student ]
        │                                                                  ▲
        ▼ (Port 3001)                                                      │ (Port 3003)
+──────────────────────+       PUBLISH ws:broadcast       +──────────────────────+
| WebSocket Node 1     |─────────────────────────────────►| WebSocket Node 2     |
| (MY_NODE_ID = nodeA) |                                  | (MY_NODE_ID = nodeB) |
+──────────────────────+                                  +──────────────────────+
           │                                                         ▲
           │                     +─────────────────+                 │
           └────────────────────►| Redis 7.2 Broker|─────────────────┘
                                 | Channel:        |
                                 | 'ws:broadcast'  |
                                 +─────────────────+
```

### Why PostgreSQL Cannot Replace Redis for This Role
1. **Sub-50ms Telemetry Cadence**: GPS telemetry arrives at 1Hz per active bus. PostgreSQL `LISTEN/NOTIFY` holds transaction queue overhead, bloats WAL files, and imposes database connection pool contention.
2. **Transient vs Durable Separation**: Real-time position coordinates are ephemeral stream packets. If a packet is lost in flight, the next second's update supersedes it. Redis handles this in-memory with zero disk-write amplification.
3. **Dedicated Fan-Out Broker**: Redis pub/sub delivers `O(N)` distribution to subscribed application nodes without touching database read-replicas.

---

## 2. Channel Design & Wire Protocol

Rather than creating unbounded Redis channels per bus (which complicates subscription tracking across clusters), ITMS multiplexes all inter-node events through a single Redis broadcast bus:

```typescript
const REDIS_BROADCAST_CHANNEL = 'ws:broadcast';
```

### Message Envelope Structure (`BroadcastEnvelope`)

Every inter-node broadcast is serialized into a standard JSON envelope:

```typescript
interface BroadcastEnvelope {
  /** The application-level WebSocket channel (e.g., 'bus_location_STAGING-BUS-001') */
  channel: string;
  /** Event identifier (e.g., 'bus_location_update', 'trip_ended') */
  event: string;
  /** Arbitrary payload including coordinates or status flags */
  payload: Record<string, unknown>;
  /** Unique UUID of the originating node to prevent echo storms */
  originNodeId: string;
}
```

---

## 3. Implementation Deep Dive

### 3.1 Node Identity & Echo Suppression (`server/redis-broadcast.ts`)

Every WebSocket node generates a permanent cryptographically secure UUID at boot time. When a node publishes a message to Redis, it tags the envelope with its `MY_NODE_ID`. Receiving nodes inspect the ID and discard messages that originated from themselves:

```typescript
// server/redis-broadcast.ts
import crypto from 'crypto';
import { redisPubSub } from './redis-pubsub';
import { logger } from './structured-logger';

/** Unique identifier for this WS server process. Never changes after startup. */
export const MY_NODE_ID = crypto.randomUUID();

/** Redis channel all WS nodes listen on for cross-node broadcasts. */
const REDIS_BROADCAST_CHANNEL = 'ws:broadcast';

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
```

### 3.2 Relay & In-Process Cache Synchronization

When a message arrives over Redis from a peer node, two operations occur:
1. **Cache Synchronization**: If the event is `bus_location_update`, the local in-process `liveBusLocations` map is updated so newly connected clients on this node get instant initial positions.
2. **Local Relay**: The event is pushed directly to all local clients subscribed to `envelope.channel`.

```typescript
// server/redis-broadcast.ts
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
}
```

### 3.3 The Redis Client Abstraction (`server/redis-pubsub.ts`)

The pub/sub adapter implements a clean interface decoupler:

```typescript
// server/redis-pubsub.ts
import type { PubSubAdapter } from '../src/domains/realtime/pubsub';
import { redisClient } from './redis-client';

export class RedisPubSub implements PubSubAdapter {
  async publish(channel: string, message: string): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.publish(channel, message);
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.subscribe(channel, handler);
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.unsubscribe(channel);
    }
  }
}

export const redisPubSub = new RedisPubSub();
```

---

## 4. Resilience & Degradation Guarantees

1. **Graceful Fallback to In-Process Routing**:
   - If `REDIS_URL` is omitted, or if the Redis container crashes, `redisClient.isReady()` evaluates to `false`.
   - The WebSocket cluster automatically falls back to single-node in-process delivery. Local clients connected to the same node as the driver experience zero interruption.
2. **Non-Blocking Fire-and-Forget**:
   - `publishToRedis` catches and logs errors asynchronously. A transient Redis timeout or packet drop will never block the driver's WebSocket connection or fail an HTTP response.
3. **Deduplication Invariant**:
   - Because `publishToRedis` is called *after* local broadcast, and `envelope.originNodeId === MY_NODE_ID` is strictly ignored by the publisher node, no client ever receives duplicate packets from Redis reflection.
