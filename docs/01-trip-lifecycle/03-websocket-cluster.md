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
   │                                                       │ Generate reconnect_token
   │◄── Frame: { type: 'auth_ok', data: {                  │
   │      uid: '...', role: 'driver',                      │
   │      reconnect_token: '<HMAC_TOKEN>'                  │
   │    }} ────────────────────────────────────────────────┤
   │                                                       │
   ├── Frame: { type: 'subscribe', channel: 'bus_ABC' } ──►│ Register subscription in
   │                                                       │ SubscriptionManager
   │◄── Frame: { type: 'subscribed', channel: 'bus_ABC' } ─┤
   │                                                       │
   ├── Frame: { type: 'presence', busId: 'ABC' } ─────────►│ Register in SocketRouter
   │◄── Frame: { type: 'presence_ok' } ────────────────────┤
```

---

## 3. Protocol Message Specifications

### 3.1 Authentication Handshake

Every connection begins in an unauthenticated state. The client must transmit an `auth` message within 15 seconds, or the socket is forcefully closed.

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
    "reconnect_token": "8f3b...12a9"
  }
}
```

### 3.2 Reconnection via Token

When a client experiences transient network loss, they can reconnect without re-issuing a Firebase ID token exchange by supplying their `reconnect_token`:

```
GET /ws?reconnect_token=8f3b...12a9 HTTP/1.1
Host: itms.example.com
Upgrade: websocket
Connection: Upgrade
```

On connection, `SessionManager` restores the client's previous channel subscriptions automatically.

### 3.3 Channel Subscription

Clients join channels to receive real-time updates for specific buses or personal student notifications.

**Client Request:**
```json
{
  "type": "subscribe",
  "channel": "bus_location_STAGING-BUS-001"
}
```

**Server Response:**
```json
{
  "type": "subscribed",
  "channel": "bus_location_STAGING-BUS-001"
}
```

### 3.4 Driver Presence Announcement

Drivers announce their active trip context to establish channel routing:

**Client Request:**
```json
{
  "type": "presence",
  "busId": "STAGING-BUS-001",
  "tripId": "trip_9204128",
  "routeId": "STAGING-ROUTE-001"
}
```

**Server Response:**
```json
{
  "type": "presence_ok"
}
```

---

## 4. Implementation Details & Code Highlights

### 4.1 Connection Lifecycle & Auth Routing (`server/websocket-server.ts`)

```typescript
// server/websocket-server.ts
ws.on('message', async (raw: WebSocket.RawData) => {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Malformed JSON' }));
    return;
  }

  // 1. Pre-auth processing
  if (!authenticated) {
    if (msg.type === 'auth') {
      try {
        const decoded = await authenticator.verifyToken(msg.token);
        authenticated = true;
        uid = decoded.uid;
        role = decoded.role;

        // Register session and mint reconnect token
        const reconnectToken = sessionManager.createSession(uid, role, ws);
        
        ws.send(JSON.stringify({
          type: 'auth_ok',
          data: { uid, role, reconnect_token: reconnectToken }
        }));
      } catch (authErr) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
        ws.close(4001, 'Auth failed');
      }
      return;
    }
    ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
    return;
  }

  // 2. Authenticated message routing
  socketRouter.handleMessage(ws, uid, role, msg);
});
```

### 4.2 Rate Limiting & Abuse Prevention (`server/rate-limiter.ts`)

To protect the cluster from misbehaving or buggy clients streaming infinite telemetry, three rate limit tiers are enforced simultaneously:

1. **Per-Socket Limit**: 60 messages / 10s window (prevents single-tab runaway loops).
2. **Per-User Limit**: 200 messages / 10s window across all client devices.
3. **Per-IP Limit**: 100 messages / 10s window for unauthenticated IP sources.

```typescript
// server/rate-limiter.ts
export function checkRateLimit(socketId: string, uid?: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  
  if (!socketLimiter.consume(socketId, 1)) {
    return { allowed: false, reason: 'Socket message rate exceeded' };
  }
  
  if (uid && !userLimiter.consume(uid, 1)) {
    return { allowed: false, reason: 'User account message rate exceeded' };
  }

  return { allowed: true };
}
```

### 4.3 Heartbeats & Connection Eviction (`server/heartbeat-service.ts`)

- **Server Pings**: The server issues standard WebSocket `ping` frames every 25 seconds.
- **Client Pongs**: The client must reply with `pong` or any valid message.
- **Eviction**: If two consecutive ping intervals elapse without client traffic, the socket is terminated, in-memory subscriptions are cleaned up, and metrics are adjusted.
