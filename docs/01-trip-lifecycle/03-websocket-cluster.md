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

---

### 4.4 Client & Server Endpoint Resolution Architecture (`src/domains/realtime/ws-config.ts`)

Earlier, client components and server transports relied on static environment configurations (`NEXT_PUBLIC_WS_URL=ws://localhost:3001` and `WS_HOST=127.0.0.1`). When testing across local LAN devices, separate mobile carrier networks (such as Airtel on a student phone and Jio on a driver phone), or in cross-cloud topologies (Next.js on Vercel connecting to a dedicated WebSocket cluster on Render), the client bundles attempted to connect to `localhost:3001` on the mobile phones themselves, leading to immediate handshake failures.

After the new patch, centralized endpoint resolution via `getClientWsUrl()` and `getServerWsUrl()` was ensured. This means:
- **Dynamic LAN Host Rewriting**: When a student or driver accesses the application from a smartphone on the local network (e.g., `http://192.168.1.5:3000`), the browser dynamically inspects `window.location.hostname`. If the configured URL targets `localhost`, it automatically translates the hostname to `192.168.1.5:3001`, enabling immediate multi-device connectivity without modifying environment files.
- **Protocol Auto-Upgrade**: On HTTPS production pages, `ws://` endpoints are automatically upgraded to `wss://` to eliminate browser mixed-content security blocks.
- **Path & Query Normalization**: Trailing slashes and repeated `/ws` segments are normalized to avoid invalid routing, and query parameters are stripped at the boundary.

---

### 4.5 Privileged Internal Server Transport & First-Frame Authentication

Earlier, the internal server-to-server WebSocket transport appended privileged credentials directly into the URL query parameters (`ws://127.0.0.1:3001/ws?token=SECRET`). This presented serious security risks because secrets embedded in URL strings leak through reverse proxy access logs, monitoring spans, and network telemetry. Furthermore, the hardcoded loopback host prevented serverless API functions on Vercel from routing GPS events to a remote WebSocket server.

After the new patch, the internal bridge was updated to use dedicated `WS_SERVER_URL` resolution and first-frame wire authentication (`{ type: 'auth', token: PRIVILEGED_TOKEN }`). This means:
1. The Next.js API server connects to the dedicated WebSocket server using a clean URL path (`/ws`) with zero credentials in the address bar or HTTP request line.
2. Upon connection `open`, the internal transport transmits an encrypted JSON authentication envelope over the established socket.
3. The WebSocket server verifies the secret, assigns `{ authenticated: true, uid: 'server', role: 'server' }`, and grants unthrottled broadcast privileges to publish driver location telemetry across subscriber channels.

