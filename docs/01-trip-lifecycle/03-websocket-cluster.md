# WebSocket Cluster & Wire Protocol Specification

## 1. Cluster Architecture & Port Topology

The ITMS WebSocket tier is implemented as a standalone high-performance Node.js service using the `ws` engine (RFC 6455).

```
                      INTERNET / CLIENT TRAFFIC
                                  │
                                  ▼
                         NGINX Reverse Proxy
                         Port 443 (SSL/TLS)
                                  │
                      proxy_pass /ws (ip_hash)
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
      WebSocket Node 1 (ws1)          WebSocket Node 2 (ws2)
      WS Port: 3001                   WS Port: 3001 (Host: 3003)
      Metrics / Health: 9090          Metrics / Health: 9090
```

- **Sticky Sessions via `ip_hash`**: NGINX maps client IP addresses consistently to the same WS node during standard operation, allowing in-memory session tracking and instant presence caches.
- **Port Mapping**:
  - `ws1`: Listens internally on port `3001`, with Prometheus `/metrics` and `/health/live` on port `9090`.
  - `ws2`: Runs identically on internal port `3001` (mapped externally to `3003` for multi-node testing).

---

## 2. Wire Protocol Handshake Lifecycle

Communication over the WebSocket connection adheres to a strict framing protocol where all payloads are structured JSON envelopes.

```
 Client                                              WebSocket Node
   │                                                       │
   ├── TCP Connect ───────────────────────────────────────►│
   │                                                       │
   ├── Frame: { type: 'auth', token: '<Firebase_JWT>' } ──►│ Authenticate with Firebase Admin
   │                                                       │ Verify UID and resolve Role
   │                                                       │ Mint session & reconnect_token
   │◄── Frame: { type: 'auth_ok', data: {                  │
   │      uid: '...', role: 'driver',                      │
   │      reconnect_token: '<UUID_TOKEN>'                  │
   │    }} ────────────────────────────────────────────────┤
   │                                                       │
   ├── Frame: { type: 'presence', busId: 'BUS-1' } ───────►│ Validate ownership in DB
   │◄── Frame: { type: 'presence_ok' } ────────────────────┤ Sets session.busId
   │                                                       │
   ├── Frame: { type: 'subscribe', channel: 'bus_loc...' }►│ Register subscription
   │◄── Frame: { type: 'subscribed', channel: '...' } ─────┤ Pushes initial location snapshot
   │◄── Frame: { type: 'message', payload: { ... } } ──────┤ (source: 'snapshot')
```

---

## 3. Protocol Message Specifications

### 3.1 Authentication Handshake

Every connection begins in an unauthenticated state. The client must transmit an `auth` message within 5 seconds (`AUTH_TIMEOUT_MS = 5000`), or the socket is forcefully closed with code 4001. URL query parameters (`?token=...`) are strictly rejected in production.

**Client Request:**
```json
{
  "type": "auth",
  "token": "<FIREBASE_ID_TOKEN>"
}
```

**Server Response (Success):**
```json
{
  "type": "auth_ok",
  "data": {
    "uid": "usr_941028401",
    "role": "driver",
    "reconnect_token": "8f3b4a12-68b2-4d22-8e1c-5d29940128fa"
  }
}
```

### 3.2 Reconnection via Token

When a client experiences transient network loss, they can reconnect without re-issuing a Firebase ID token exchange by supplying their `reconnect_token` in query parameters:

```
GET /ws?reconnect_token=8f3b4a12-68b2-4d22-8e1c-5d29940128fa HTTP/1.1
Host: itms.example.com
Upgrade: websocket
Connection: Upgrade
```

**Security Check in [`server/websocket-server.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/websocket-server.ts):**
```typescript
const oldSession = sessionManager.findByReconnectToken(reconnectToken);
if (oldSession && oldSession.uid === auth.uid) {
  const savedChannels = new Set(oldSession.subscriptions);
  subscriptionManager.unsubscribeAll(oldSession.socketId, oldSession);
  const restored = sessionManager.restoreSession(reconnectToken, socketId);
  if (restored) {
    session = restored;
    for (const ch of savedChannels) {
      subscriptionManager.subscribe(socketId, ch, ws, session);
    }
  }
}
```
Only when the token matches the authenticated `uid` will channels be restored, eliminating token hijacking across users.

### 3.3 Presence Announcement

Before subscribing to any bus-scoped channels, students and drivers must declare presence to establish verified `session.busId`:

**Client Request:**
```json
{
  "type": "presence",
  "busId": "STAGING-BUS-001",
  "tripId": "f78d91a0-1284-4821-9923-b1c8f12a34bc",
  "routeId": "ROUTE-01"
}
```

**Server Verification ([`server/socket-router.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/socket-router.ts)):**
- **Student**: Queries `student_profiles` to verify `bus_id === claimedBusId`, `status === 'active'`, and that current time is not past `soft_block` or `valid_until`.
- **Driver**: Queries `active_trips` to verify active lock ownership (`driver_id = session.uid, bus_id = claimedBusId, status = 'active'`) or `driver_profiles.bus_id`.
- **Admin/Moderator**: Authorized for fleet monitoring.
- **Server Response**: `{ type: "presence_ok" }`.

### 3.4 Channel Subscription & Role Isolation

Clients join channels to receive real-time updates:
- **Fleet GPS Channels (`bus_location_{busId}`, `fleet_locations`)**: Students may only subscribe to their assigned bus. Admins and moderators may subscribe to all fleet buses to observe live positions on the fleet map.
- **Trip Status Channels (`trip-status-{busId}`)**: Authoritative lifecycle events (`trip_started`, `trip_ended`).
- **Waiting Flag Channels (`waiting_flags_{busId}`)**: Communicated exclusively between students and the active trip driver. Administrators and moderators are **strictly forbidden** and receive an error frame if they attempt to subscribe.
- **Driver Dispatch Channels (`driver_wait_request_{busId}`)**: Strictly driver-only. Students, administrators, and moderators are rejected.
- **Private Student Channels (`student_{uid}`)**: Restricted strictly to the authenticated student.

**Immediate Snapshot Push**: Upon subscribing to `bus_location_{busId}`, the server checks `getLiveBusLocation(busId)`. If a recent position exists (<60s old), it pushes an immediate message:
```json
{
  "type": "message",
  "channel": "bus_location_STAGING-BUS-001",
  "event": "bus_location_update",
  "payload": {
    "lat": 26.1445,
    "lng": 91.7362,
    "speed": 34.5,
    "heading": 180,
    "source": "snapshot"
  }
}
```

---

## 4. Implementation Details & Code Highlights

### 4.1 Connection Lifecycle & Per-Socket Async Queue ([`server/websocket-server.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/websocket-server.ts))

To eliminate race conditions where a client transmits `presence` followed immediately by `subscribe` while the database query for presence is still resolving in the event loop:
```typescript
// server/websocket-server.ts
let messageQueue: Promise<void> = Promise.resolve();
ws.removeListener('message', bufferMessage);
ws.on('message', (data) => {
  if (this.shuttingDown) {
    ws.close(4003, 'Server shutting down');
    return;
  }
  // Chain onto the per-socket queue to preserve strict arrival ordering
  messageQueue = messageQueue.then(() => this.processMessage(ws, session, ip, data));
});
```

### 4.2 Rate Limiting & Abuse Prevention ([`server/rate-limiter.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/rate-limiter.ts))

To protect the cluster from misbehaving clients, three rate limit tiers are enforced simultaneously:
1. **Per-Socket Limit**: 60 messages / 10s window.
2. **Per-User Limit**: 200 messages / 10s window across all client devices.
3. **Per-IP Limit**: 100 messages / 10s window for unauthenticated IP sources.
4. **Privileged Server Exemption**: Sockets authenticated with `role: 'server'` are strictly exempt from rate limiting to guarantee internal broadcast relays are never throttled.

```typescript
// server/rate-limiter.ts
export function checkRateLimit(socketId: string, uid?: string, role?: string): { allowed: boolean; reason?: string } {
  if (role === 'server') {
    return { allowed: true };
  }
  if (!socketLimiter.consume(socketId, 1)) {
    return { allowed: false, reason: 'Socket message rate exceeded' };
  }
  if (uid && !userLimiter.consume(uid, 1)) {
    return { allowed: false, reason: 'User account message rate exceeded' };
  }
  return { allowed: true };
}
```

### 4.3 Heartbeats & Connection Eviction ([`server/heartbeat-service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/server/heartbeat-service.ts))

- **Server Pings**: The server issues standard WebSocket `ping` frames every 25 seconds.
- **Client Pongs**: The client must reply with `pong` or any valid message.
- **Eviction**: If two consecutive ping intervals elapse without client traffic, the socket is terminated, in-memory subscriptions are cleaned up, and metrics are adjusted.

---

## 5. Dual-Lane Realtime Transport ([`src/domains/realtime/transport/websocket.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/realtime/transport/websocket.ts))

In the Next.js process, `WebSocketTransport` establishes the server-to-server bridge to publish events to the standalone WebSocket cluster. It implements a **Dual-Queue Architecture**:

1. **GPS Coalescing Lane (`gpsLatest` Map)**:
   - Only the latest `bus_location_update` frame per channel is retained.
   - Bounded by `MAX_GPS_CHANNELS = 500`.
   - Prevents high-frequency (0.5Hz–1Hz) GPS telemetry from flooding the queue or evicting lifecycle events during network hiccups.
2. **Lifecycle FIFO Lane (`sendQueue` Array)**:
   - Holds up to 500 critical lifecycle frames (`trip_started`, `trip_ended`, `waiting_flag_created`, `waiting_flag_removed`).
   - Frames are never dropped or coalesced.
3. **Backpressure Protection (`BACKPRESSURE_BYTES = 16 * 1024`)**:
   - If `ws.bufferedAmount > 16KB`, outgoing messages are queued in memory rather than overwhelming the socket buffer.
4. **Batched Drainage on Reconnect**:
   - Drains up to 10 urgent lifecycle frames synchronously on `open`.
   - Batches remaining queued messages and GPS snapshots at 20 frames per tick to avoid saturating the event loop.

```typescript
// src/domains/realtime/transport/websocket.ts
async broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const msg = JSON.stringify({ type: 'broadcast', channel, event, payload });
  const socketOpen = this.ws?.readyState === 1;
  const saturated = this.ws?.bufferedAmount !== undefined && this.ws.bufferedAmount > BACKPRESSURE_BYTES;

  if (!this.connected || !this.ws || !socketOpen || saturated) {
    if (event === 'bus_location_update') {
      if (!this.gpsLatest.has(channel) && this.gpsLatest.size >= MAX_GPS_CHANNELS) {
        const oldest = this.gpsLatest.keys().next().value;
        if (oldest) this.gpsLatest.delete(oldest);
      }
      this.gpsLatest.set(channel, msg);
      return;
    }
    if (this.sendQueue.length >= MAX_QUEUE) this.sendQueue.shift();
    this.sendQueue.push(msg);
    return;
  }
  this.unsafeSend(msg);
}
```

---

## 6. Client Endpoint Resolution & LAN Discovery ([`src/domains/realtime/ws-config.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/realtime/ws-config.ts))

- **Dynamic LAN Host Rewriting**: When a student or driver accesses the application from a smartphone on the local network (e.g., `http://192.168.1.5:3000`), the browser dynamically inspects `window.location.hostname`. If the configured URL targets `localhost`, it automatically translates the hostname to `192.168.1.5:3001`, enabling immediate multi-device connectivity without modifying environment files.
- **Protocol Auto-Upgrade**: On HTTPS production pages, `ws://` endpoints are automatically upgraded to `wss://` to eliminate browser mixed-content security blocks.
- **Path & Query Normalization**: Trailing slashes and repeated `/ws` segments are normalized to avoid invalid routing, and query parameters are stripped at the boundary.
