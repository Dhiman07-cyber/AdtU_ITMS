# WebSocket Cluster Architecture, Presence Protocol & FCM Notification Fan-Out (Forensic Truth)

**Module:** WS1 Cluster, HTTP Handshake Upgrade, Room Isolation, Heartbeats & FCM Push Fan-Out  
**File Authority:** `server/src/websocket/server.ts`, `server/src/services/fcm.service.ts`, `src/hooks/useTripWebSocket.ts`  
**Network Protocols:** RFC 6455 WebSockets, Redis Pub/Sub Backplane, Firebase Cloud Messaging v1  

---

## PART 7: WebSocket Server Cluster (`ws1`), Next.js-to-WS Bridge, Auth/Presence & Shift/Role Isolation

### 7.1 Sub-Domain Architecture & Exact Execution Pipeline

The Realtime Broadcast infrastructure consists of the Next.js internal event emitter bridge and the standalone Node.js WebSocket cluster (`ws1`). It guarantees sub-second updates while enforcing strict role boundaries, student bus entitlements, and permanent academic shift isolation.

```
       [ Next.js API Routes (e.g. /api/location/update) ]
                               │
                               │ emitEvent(channel, event, payload)
                               ▼
       ┌────────────────────────────────────────────────────────┐
       │ WebSocketTransport (Next.js-to-WS Internal Bridge)     │
       │ - Dual-lane backpressure queue:                        │
       │   * gpsLatest (Map): 1 coalesced slot per bus channel  │
       │   * sendQueue (Array): FIFO for lifecycle & flags      │
       │ - Backpressure gate: 16KB bufferedAmount limit         │
       │ - Internal auth via WS_PRIVILEGED_TOKEN (First Frame)  │
       └───────────────────────┬────────────────────────────────┘
                               │
                               │ ws.send(JSON)
                               ▼
       ┌────────────────────────────────────────────────────────┐
       │ Standalone WebSocket Server (ws1 - server/index.ts)    │
       │ Connection Handshake:                                  │
       │ 1. Path A (URL ?token=): REJECTED in prod (close 4001) │
       │ 2. Path B (First Frame): { type: 'auth', token }       │
       │    within AUTH_TIMEOUT_MS (5,000ms)                    │
       │ 3. Buffer pre-auth frames in preAuthBuffer (max 32)   │
       │ 4. Authenticate JWT -> PostgreSQL users.role           │
       │ 5. Session restore if reconnect_token matches uid      │
       │ 6. Send { type: 'auth_ok', reconnect_token }           │
       └───────────────────────┬────────────────────────────────┘
                               │
                               │ Replay pre-auth & live frames
                               ▼
       ┌────────────────────────────────────────────────────────┐
       │ Per-Socket Sequential Promise Chain (messageQueue)     │
       │ Eliminates race conditions:                            │
       │ messageQueue = messageQueue.then(() => processMessage) │
       │ Guarantees 'presence' resolves DB before 'subscribe'   │
       └───────────────────────┬────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────────────┐
       │ Message Routing & Security Enforcement (socket-router) │
       │                                                        │
       │ 1. 'presence' Handshake:                               │
       │    - Student: verify student_profiles (active status,   │
       │      soft_block, valid_until). 5-min LRU cache.        │
       │    - PERMANENT SHIFT ISOLATION:                        │
       │      Check student_profiles.shift vs active_trips.shift│
       │      If incompatible -> CLOSE 4403 SHIFT_MISMATCH      │
       │    - Driver: verify active_trips or driver_profiles    │
       │                                                        │
       │ 2. 'subscribe' Handshake:                              │
       │    - Admins/Mods FORBIDDEN from waiting_flags_* and    │
       │      driver_wait_request_* (Zero PII access)           │
       │    - Students FORBIDDEN from driver_wait_request_*     │
       │    - Channel busId MUST match verified session.busId   │
       │    - Immediate snapshot push: getLiveBusLocation()     │
       │      delivered with payload source: 'snapshot'         │
       │                                                        │
       │ 3. 'broadcast' Handshake:                              │
       │    - Role MUST be 'server' (WS_PRIVILEGED_TOKEN)       │
       │    - Updates liveBusLocations cache                    │
       │    - Local broadcast to channel subscribers            │
       └───────────────────────┬────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────────────┐
       │ Cross-Process Security Eviction (redis-broadcast.ts)   │
       │ Listens on Redis 'role_invalidate' & 'student_assign'  │
       │ When role modified or student reassigned:              │
       │ - Invalidate local tokenAuthCache & presence cache     │
       │ - Immediately CLOSE active sockets with code 4401      │
       └────────────────────────────────────────────────────────┘
```

---

### 7.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/domains/realtime/event-emitter.ts` | `emitEvent`, `ensureTransport` | All domain services (`location/update`, `trip-orchestrator`, `stop-dwell`, etc.) | `getActiveTransport`, `initializeTransport` | None |
| `src/domains/realtime/transport/websocket.ts` | `WebSocketTransport` | `event-emitter.ts` via `transport-manager.ts` | Node `ws` client, `getServerWsUrl`, `getPrivilegedToken` | Mutates internal `gpsLatest` Map, `sendQueue` array |
| `src/domains/realtime/ws-config.ts` | `getClientWsUrl`, `getServerWsUrl` | `WebSocketTransport`, frontend hooks (`useWebSocket`) | None | None |
| `server/index.ts` | Main entrypoint | Node.js process startup (`npm run start:ws`) | `wsServer.start`, `redisClient.connect`, `initRedisBroadcastRelay`, `healthService`, `metricsService` | Process runtime state |
| `server/websocket-server.ts` | `WebSocketServer`, `wsServer` | `server/index.ts`, `socket-router.ts` | `authenticateSocket`, `sessionManager`, `connectionRegistry`, `subscriptionManager`, `routeMessage` | Sockets registry, connection pool |
| `server/socket-router.ts` | `routeMessage`, `handle`, `sendToSocket`, `updateLiveBusLocation`, `clearLiveBusLocation`, `getLiveBusLocation`, `clearStudentPresenceCache` | `websocket-server.ts` | `sessionManager`, `subscriptionManager`, `areShiftsCompatible`, `getSupabaseServer`, `publishToRedis` | Mutates `liveBusLocations` Map, `studentPresenceCache` Map |
| `server/authenticator.ts` | `authenticateSocket`, `invalidateTokenAuthCache`, `assertPrivilegedTokenSafe`, `getPrivilegedAuthConfig` | `websocket-server.ts`, `redis-broadcast.ts` | `verifyToken` (Firebase Admin), `supabase.from('users')` | Mutates `tokenAuthCache` Map (90s TTL) |
| `server/session-manager.ts` | `SessionManager`, `sessionManager` | `websocket-server.ts`, `socket-router.ts`, `redis-broadcast.ts` | None | Mutates `sessions`, `reconnectTokens`, `disconnectedSessions`, and secondary index Maps |
| `server/subscription-manager.ts` | `SubscriptionManager`, `subscriptionManager` | `websocket-server.ts`, `socket-router.ts` | None | Mutates channel subscription sets |
| `server/connection-registry.ts` | `ConnectionRegistry`, `connectionRegistry` | `websocket-server.ts`, `redis-broadcast.ts` | None | Maps `socketId` to WebSocket instances |
| `server/redis-broadcast.ts` | `publishToRedis`, `initRedisBroadcastRelay`, `MY_NODE_ID` | `server/index.ts`, `socket-router.ts` | `redisPubSub`, `invalidateTokenAuthCache`, `sessionManager` | Subscribes to Redis `role_invalidate` |
| `src/lib/security/role-cache.ts` | `getCachedRole`, `resolveUserRole` | API security middleware | `getUserById`, `initRoleCacheRedis` | Mutates `_roleCache` Map (5-min TTL) |

---

### 7.3 Method-by-Method Low-Level Walkthrough

#### 7.3.1 Next.js-to-WS Bridge (`src/domains/realtime/transport/websocket.ts`)
1. **Connection & Privileged Authentication**:
   - Next.js API workers establish an internal WebSocket connection to `ws1` via `getServerWsUrl()`.
   - On connection open, Path B authentication transmits `{ type: 'auth', token: WS_PRIVILEGED_TOKEN }` as the first frame over the wire (never exposed in URL query string).
   - Followed by presence announcement: `{ type: 'presence', role: 'server' }`.
2. **Dual-Lane Backpressure Queue**:
   - When socket is disconnected or saturated (`bufferedAmount > 16KB`):
     - **GPS Telemetry Lane (`gpsLatest`)**: Dedicated Map keyed by channel name. Keeps **only the latest location packet per bus** (`event === 'bus_location_update'`). Capped at 500 channels. Stale positions are overwritten so a temporary bridge disconnect never fills the buffer with obsolete coordinates.
     - **Lifecycle & Event Lane (`sendQueue`)**: FIFO array for non-GPS events (`trip_started`, `trip_ended`, `waiting_flag_raised`, etc.). Bounded at 500 frames; drops oldest only if saturated.
3. **Batched Drainage on Reconnect**:
   - `drainQueueSync()`: Immediately flushes up to 10 urgent non-GPS frames synchronously.
   - `drainQueue()`: Batches remaining frames in groups of 20 per `setImmediate` tick, yielding to the Node.js event loop to prevent server lockup.

---

#### 7.3.2 WebSocket Server Bootstrap & Connection Handshake (`server/websocket-server.ts`)
1. **Connection Admission & Pre-Auth Buffering**:
   - Client establishes WebSocket connection to `/ws`.
   - A unique `socketId` is generated via `crypto.randomUUID()`.
   - Client messages arriving during authentication are queued in `preAuthBuffer` (max 32 frames; exceeding terminates with code `1009`).
2. **Authentication Flow (Path B Enforcement)**:
   - **Production URL Query Protection**: If request contains `?token=...` in `NODE_ENV === 'production'`, the connection is **immediately rejected and closed with code 4001** (`URL query token authentication is disabled in production`).
   - **First-Message Auth**: Server sets an `AUTH_TIMEOUT_MS = 5000ms` timer. Client must send `{ type: 'auth', token: '<jwt>' }`.
   - Authenticated against Firebase Admin SDK, followed by PostgreSQL `users.role` lookup (authoritative over stale Firebase claims).
   - Results cached in `tokenAuthCache` for 90 seconds.
3. **Session Reconnection (`reconnect_token`)**:
   - If `reconnect_token` is provided:
     - Validates that `oldSession.uid === auth.uid` (prevents token hijacking).
     - Restores session subscriptions and metadata.
   - Sends confirmation frame: `{ type: 'auth_ok', data: { uid, role, reconnect_token } }`.
4. **Per-Socket Sequential Execution Queue (`messageQueue`)**:
   - Every socket maintains an isolated Promise queue:
     `messageQueue = messageQueue.then(() => this.processMessage(ws, session, ip, data))`.
   - Guarantees that asynchronous database calls in `presence` fully resolve before subsequent `subscribe` frames are evaluated for that socket.

---

#### 7.3.3 Presence, Subscription & Shift Isolation (`server/socket-router.ts`)
1. **Presence Processing (`presence`)**:
   - **Student Role**:
     - Resolves `studentPresenceCache` (5-minute TTL). If miss, queries PostgreSQL `student_profiles` for `bus_id, status, soft_block, valid_until, shift`.
     - Validates canonical entitlement: status must be `'active'`, and current timestamp must not exceed `soft_block` or `valid_until` dates.
     - **Permanent Shift Isolation**: Compares student's assigned shift against active trip's shift in PostgreSQL `active_trips`. Calls `areShiftsCompatible(studentShift, trip.shift)`. If incompatible, logs `security_audit_shift_mismatch` and **closes the socket with code 4403 (`SHIFT_MISMATCH`)**.
   - **Driver Role**:
     - Verifies driver ownership of claimed bus against PostgreSQL `active_trips` or `driver_profiles`.
   - **Admin / Moderator**:
     - Granted unrestricted presence binding.
2. **Subscription Processing (`subscribe`)**:
   - **Role Isolation Rule 1**: Admins and Moderators are **strictly forbidden** from subscribing to `waiting_flags_*` or `driver_wait_request_*` channels (enforcing zero administrative access to student roadside locations).
   - **Role Isolation Rule 2**: Students are **strictly forbidden** from subscribing to `driver_wait_request_*` (which contains private commuter names and stop coordinates).
   - **Bus Channel Authorization**: For channels matching `bus:*`, `bus_location_*`, `trip-status-*`, `waiting_flags_*`, student/driver `session.busId` MUST be present and MUST match the channel bus ID.
   - **Default-Deny Rule**: All unrecognized channels are rejected unless matching private channel `student_${session.uid}`.
   - **Immediate Snapshot Delivery**: When a client subscribes to a bus location stream, the server immediately sends the latest cached fix from `liveBusLocations` with payload attribute `source: 'snapshot'`.
3. **Broadcast Processing (`broadcast`)**:
   - Reserved strictly for `session.role === 'server'`.
   - Updates `liveBusLocations` on `bus_location_update`.
   - Clears `liveBusLocations` on `trip_ended`.
   - Relays to local channel subscribers and broadcasts across nodes.

---

#### 7.3.4 Cross-Process Security Eviction (`server/redis-broadcast.ts`)
- Subscribes to Redis channels: `role_invalidate`, `itms:roles:invalidate`, and `student_assign_invalidate`.
- When an admin demotes a user or revokes transport privileges:
  1. Purges local in-memory `tokenAuthCache` and `studentPresenceCache`.
  2. Resolves all active WebSocket connections for that UID via `sessionManager.getByUid(uid)`.
  3. Closes each connection immediately with WebSocket code **`4401`** (`Role revoked or permissions modified - please re-authenticate`).

---

### 7.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Scenario A: Student Connects, Sends Auth, Presence & Subscribes (Cold Presence Cache)
- **PostgreSQL Queries**: **2**
  1. `SELECT role FROM users WHERE uid = $1` (if token not cached in `tokenAuthCache`).
  2. `SELECT bus_id, status, soft_block, valid_until, shift FROM student_profiles WHERE uid = $1` (presence entitlement verification).
  3. (Optional query to `active_trips` if verifying active trip shift).
- **Redis Commands**: **0** (All presence operations handled via in-process memory cache).
- **WebSocket Frames Emitted**: **3**
  1. `{ type: 'auth_ok', data: { reconnect_token } }`
  2. `{ type: 'presence_ok' }`
  3. `{ type: 'subscribed', channel }` + (`bus_location_update` snapshot if bus active).
- **External Calls**: **1** (Firebase Admin `verifyToken` on initial JWT validation; 0 on reconnect).

#### Scenario B: Student Reconnects within 5 Minutes (Warm Presence Cache & Token Cache)
- **PostgreSQL Queries**: **0** (Token valid in `tokenAuthCache`; student profile valid in `studentPresenceCache`).
- **Redis Commands**: **0**.
- **WebSocket Frames Emitted**: **3** (`auth_ok`, `presence_ok`, `subscribed`).
- **External Calls**: **0**.

#### Scenario C: Driver Emits GPS Telemetry via Next.js to WS Bridge (Cruising Tick)
- **PostgreSQL Queries**: **0**.
- **Redis Commands**: **0** (Local in-process WebSocket fanout).
- **WebSocket Frames Emitted**: **N** (1 frame delivered to each connected student subscribed to `bus_location_<busId>`).
- **External Calls**: **0**.

#### Scenario D: Administrator Modifies Student Role or Transport Privileges in Admin Portal
- **Redis Commands**: **1** (`PUBLISH role_invalidate <uid>`).
- **WebSocket Cluster Action**: Every WS node receives pub/sub message, terminates matching client sockets with code `4401`, and evicts presence caches.
- **PostgreSQL Queries**: **0**.

---

### 7.5 Verbatim Source Code from Live Codebase

#### 7.5.1 `src/domains/realtime/event-emitter.ts`
```typescript
// Lines 1 - 17 of src/domains/realtime/event-emitter.ts
import { getActiveTransport, initializeTransport } from './transport-manager';

let initialized = false;

export async function ensureTransport(): Promise<void> {
  if (!initialized) {
    await initializeTransport();
    initialized = true;
  }
}

export async function emitEvent(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
  await ensureTransport();
  const transport = getActiveTransport();
  await transport.broadcast(channel, event, payload);
}
```

---

#### 7.5.2 `src/domains/realtime/transport/websocket.ts`
```typescript
// Lines 1 - 197 of src/domains/realtime/transport/websocket.ts
import { getServerWsUrl } from '../ws-config';

function getPrivilegedToken(): string {
  const token = process.env.WS_PRIVILEGED_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';
  return token || (isProd ? '' : '__server__');
}

function isPrivilegedAuthEnabled(): boolean {
  const token = process.env.WS_PRIVILEGED_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';
  return isProd
    ? Boolean(token && token.trim() !== '' && token !== '__server__')
    : Boolean(token || true);
}

const MAX_QUEUE = 500;
/** GPS coalescing cap (one slot per channel). Fleet scale is ~50 buses. */
const MAX_GPS_CHANNELS = 500;
/** Cap for the client-side ws buffer before we queue instead of send. At ~200
 *  bytes/msg, 16KB = ~80 buffered broadcasts — well above a single tick's
 *  volume, so this only engages under real backpressure. */
const BACKPRESSURE_BYTES = 16 * 1024;

export class WebSocketTransport {
  readonly name = 'websocket';

  private ws: any | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sendQueue: string[] = [];
  // GPS coalescing lane: only the latest bus_location_update frame per channel
  // is kept. A stale position is worthless once a newer one exists, and without
  // this, 0.5Hz/bus GPS traffic evicts lifecycle (trip_started/ended) frames
  // from the shared 500-frame FIFO during bridge outages. Other event types —
  // including per-student waiting-flag events that share a channel — are never
  // merged and always go through the FIFO lane.
  private gpsLatest = new Map<string, string>();

  async connect(): Promise<void> {
    if (!isPrivilegedAuthEnabled()) {
      console.warn('[WebSocketTransport] WS_PRIVILEGED_TOKEN is missing or insecure in production; server bridge disabled. Events will queue.');
      return;
    }
    if (this.connected) return;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    try {
      const endpoint = getServerWsUrl();
      const { default: WebSocket } = await import('ws');
      this.ws = new WebSocket(endpoint);

      this.ws.on('open', () => {
        // Path B: authenticate as first frame over the wire — never expose secret in URL
        const token = getPrivilegedToken();
        if (token) {
          this.unsafeSend(JSON.stringify({ type: 'auth', token }));
        }
        this.connected = true;
        this.sendPresence();
        // Drain synchronously first so callers see an empty queue immediately.
        // The batched path handles any messages queued during the drain itself.
        this.drainQueueSync();
        this.drainQueue();
      });

      this.ws.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_required' || (msg.type === 'error' && String(msg.message).toLowerCase().includes('auth'))) {
            console.warn('[WebSocketTransport] Server rejected internal auth:', msg.message);
          }
        } catch {}
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
        this.ws!.on('open', () => { clearTimeout(timeout); resolve(); });
        this.ws!.on('error', (err: any) => { clearTimeout(timeout); reject(err); });
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.warn(`[WebSocketTransport] Connect failed: ${msg}. Events will queue.`);
      this.scheduleReconnect();
    }
  }

  async broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
    const msg = JSON.stringify({ type: 'broadcast', channel, event, payload });
    // Queue unless the socket is genuinely OPEN. Critical: when the socket is
    // CONNECTING or CLOSING, `connected` is still true but unsafeSend() would
    // silently drop the frame (readyState !== OPEN). Queuing here gives the
    // message a retry path on reconnect (drainQueueSync on 'open').
    const socketOpen = this.ws?.readyState === 1;
    const saturated = this.ws?.bufferedAmount !== undefined && this.ws.bufferedAmount > BACKPRESSURE_BYTES;
    if (!this.connected || !this.ws || !socketOpen || saturated) {
      if (event === 'bus_location_update') {
        // Coalesce: one slot per channel, newest wins. Bounded by channel
        // count, not message rate — a long outage can no longer evict
        // lifecycle frames or flood the reconnect with stale positions.
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

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.sendQueue = [];
    this.gpsLatest.clear();
  }

  private sendPresence(): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'presence', role: 'server' }));
    }
  }

  private unsafeSend(msg: string): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(msg, (err: Error | undefined) => {
        if (err) {
          console.warn('[WebSocketTransport] send error:', err.message);
        }
      });
    }
  }

  private drainQueueSync(): void {
    let n = 0;
    while (this.sendQueue.length > 0 && n < 10) {
      const msg = this.sendQueue.shift();
      if (msg) {
        this.unsafeSend(msg);
        n++;
      }
    }
  }

  private drainQueue(): void {
    const sendBatch = () => {
      let n = 0;
      while (this.sendQueue.length > 0 && n < 20) {
        const msg = this.sendQueue.shift();
        if (msg) { this.unsafeSend(msg); n++; }
      }
      for (const [channel, msg] of this.gpsLatest) {
        if (n >= 20) break;
        if (this.gpsLatest.get(channel) !== msg) continue;
        this.gpsLatest.delete(channel);
        this.unsafeSend(msg);
        n++;
      }
      if (this.sendQueue.length > 0 || this.gpsLatest.size > 0) setImmediate(sendBatch);
    };
    if (this.sendQueue.length > 0 || this.gpsLatest.size > 0) setImmediate(sendBatch);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}
```

---

#### 7.5.3 `server/websocket-server.ts` (Handshake & Per-Socket Promise Queue)
```typescript
// Excerpt from server/websocket-server.ts
const AUTH_TIMEOUT_MS = 5000;
const urlHasToken = (() => {
  try { return !!request.url && new URL(request.url, 'http://localhost').searchParams.has('token'); }
  catch { return false; }
})();

const preAuthBuffer: any[] = [];
const bufferMessage = (data: any) => {
  if (preAuthBuffer.length >= PRE_AUTH_BUFFER_LIMIT) {
    ws.close(1009, 'Pre-auth message limit exceeded');
    return;
  }
  preAuthBuffer.push(data);
};
ws.on('message', bufferMessage);

let auth;

if (urlHasToken) {
  if (process.env.NODE_ENV === 'production') {
    logger.warn('ws_url_token_rejected_prod', { ip });
    ws.close(4001, 'URL query token authentication is disabled in production. Use first-message auth.');
    return;
  }
  auth = await authenticateSocket(request);
} else {
  auth = await new Promise<Awaited<ReturnType<typeof authenticateSocket>>>((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.removeListener('close', onCloseEarly);
      ws.removeListener('message', onMessage);
      resolve({ authenticated: false, error: 'Authentication timeout: send { type: "auth", token: "..." } within 5 seconds of connecting' });
    }, AUTH_TIMEOUT_MS);

    const onCloseEarly = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      ws.removeListener('close', onCloseEarly);
      ws.removeListener('message', onMessage);
      resolve({ authenticated: false, error: 'Connection closed before authentication completed' });
    };
    ws.once('close', onCloseEarly);

    const onMessage = async (data: Buffer | ArrayBuffer | Buffer[]) => {
      let parsed: any;
      try { parsed = JSON.parse(data.toString()); } catch { return; }
      if (parsed?.type !== 'auth' || !parsed?.token) return;

      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      ws.removeListener('close', onCloseEarly);
      ws.removeListener('message', onMessage);

      const syntheticRequest = {
        ...request,
        url: '/',
        headers: { ...request.headers, authorization: `Bearer ${parsed.token}` },
      } as any;
      const result = await authenticateSocket(syntheticRequest);
      resolve(result);
    };

    ws.on('message', onMessage);
  });
}

if (!auth.authenticated) {
  ws.removeListener('message', bufferMessage);
  if (ws.readyState === ws.OPEN) {
    sendToSocket(ws, { type: 'auth_required', message: auth.error || 'Authentication required' });
    ws.close(4001, 'Authentication failed');
  }
  metricsService.inc('connectionsRejected');
  metricsService.inc('authFailures');
  return;
}

// Per-Socket Sequential Execution Queue:
let messageQueue: Promise<void> = Promise.resolve();
ws.removeListener('message', bufferMessage);
ws.on('message', (data) => {
  if (this.shuttingDown) {
    ws.close(4003, 'Server shutting down');
    return;
  }
  messageQueue = messageQueue.then(() => this.processMessage(ws, session, ip, data));
});

for (const buffered of preAuthBuffer) {
  if (this.isAuthMessage(buffered)) continue;
  messageQueue = messageQueue.then(() => this.processMessage(ws, session, ip, buffered));
}
```

---

#### 7.5.4 `server/socket-router.ts` (Presence, Subscription & Shift Isolation)
```typescript
// Excerpt from server/socket-router.ts
handle('subscribe', async (ws, session, payload) => {
  const channel = payload.channel as string | undefined;
  if (!channel) { send(ws, { type: 'error', message: 'subscribe requires "channel"' }); return; }

  // 1. Only drivers (for their active trip bus) and students (for their assigned bus) have access to waiting flags.
  //    Administrators and moderators have ZERO access to student waiting flags or driver wait requests.
  if ((channel.startsWith('waiting_flags_') || channel.startsWith('driver_wait_request_')) && (session.role === 'admin' || session.role === 'moderator')) {
    send(ws, { type: 'error', message: 'Not authorized: Admin and Moderator roles have no access to student waiting flags' });
    metricsService.inc('errors');
    logger.warn('subscribe_unauthorized_admin_mod_waiting_channel', { uid: session.uid, role: session.role, channel });
    return;
  }

  // 2. driver_wait_request_* is strictly driver-only: carries student names and stops.
  if (channel.startsWith('driver_wait_request_') && session.role === 'student') {
    send(ws, { type: 'error', message: 'Not authorized to subscribe to this channel' });
    metricsService.inc('errors');
    logger.warn('subscribe_unauthorized_student_wait_channel', { uid: session.uid, channel });
    return;
  }

  if (session.role === 'student' || session.role === 'driver') {
    const busIdMatch = channel.match(/^(?:bus:|bus_location_|trip-status-|waiting_flags_|driver_wait_request_)(.+)$/);
    if (busIdMatch) {
      const channelBusId = busIdMatch[1];
      if (!session.busId) {
        send(ws, { type: 'error', message: 'Must send presence with busId before subscribing to bus channels' });
        metricsService.inc('errors');
        logger.warn('subscribe_unauthorized_no_presence', { uid: session.uid, role: session.role, channel });
        return;
      }
      if (channelBusId !== session.busId) {
        send(ws, { type: 'error', message: 'Not authorized to subscribe to this bus channel' });
        metricsService.inc('errors');
        logger.warn('subscribe_unauthorized', { uid: session.uid, role: session.role, channel, sessionBusId: session.busId, channelBusId });
        return;
      }

      // PERMANENT SHIFT ISOLATION: Validate student shift against active trip shift
      if (session.role === 'student') {
        let studentShift = session.shift || studentPresenceCache.get(session.uid)?.data.shift;
        const supabase = getSupabaseServer();
        if (!studentShift) {
          const { data: profile } = await supabase
            .from('student_profiles')
            .select('shift')
            .eq('uid', session.uid)
            .maybeSingle();
          if (profile?.shift) {
            studentShift = profile.shift;
            session.shift = profile.shift;
          }
        }

        if (studentShift) {
          const { data: activeTrip } = await supabase
            .from('active_trips')
            .select('id, shift')
            .eq('bus_id', channelBusId)
            .eq('status', 'active')
            .maybeSingle();

          if (activeTrip?.shift && !areShiftsCompatible(studentShift, activeTrip.shift)) {
            logger.warn('security_audit_shift_mismatch', {
              event: 'SHIFT_MISMATCH',
              uid: session.uid,
              role: session.role,
              busId: channelBusId,
              studentShift,
              tripShift: activeTrip.shift,
              tripId: activeTrip.id,
              channel,
            });
            metricsService.inc('errors');
            metricsService.inc('securityAuditShiftMismatch');
            ws.close(4403, 'SHIFT_MISMATCH');
            return;
          }
        }
      }
    } else {
      const privateStudentChannel = `student_${session.uid}`;
      if (channel !== privateStudentChannel) {
        send(ws, { type: 'error', message: 'Not authorized to subscribe to this channel' });
        metricsService.inc('errors');
        logger.warn('subscribe_unauthorized_channel_pattern', { uid: session.uid, role: session.role, channel });
        return;
      }
    }
  }

  subscriptionManager.subscribe(session.socketId, channel, ws, session);
  send(ws, { type: 'subscribed', channel });

  // Immediate initial location push for newly subscribed clients
  const busIdMatch = channel.match(/^(?:bus:|bus_location_)(.+)$/);
  if (busIdMatch) {
    const busId = busIdMatch[1];
    const cachedLoc = getLiveBusLocation(busId);
    if (cachedLoc) {
      send(ws, { type: 'message', channel, event: 'bus_location_update', payload: { ...cachedLoc, source: 'snapshot' } });
    }
  }
});
```

---

#### 7.5.5 `server/redis-broadcast.ts` (Cross-Process Security Eviction)
```typescript
// Lines 77 - 141 of server/redis-broadcast.ts
export async function initRedisBroadcastRelay(
  _onBroadcast?: (channel: string, event: string, payload: Record<string, unknown>) => void,
  _onLocationUpdate?: (busId: string, payload: Record<string, unknown>) => void,
  _onTripEnded?: (busId: string) => void,
): Promise<void> {
  const handleRoleInvalidation = (rawUid: string) => {
    const uid = rawUid ? rawUid.trim() : undefined;
    invalidateTokenAuthCache(uid);

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
}
```

---



---

# PART 3: Push Notification Fan-Out (FCM) & Student Trip-Start Alerting

### 3.1 Sub-Domain Architecture & Exact Execution Pipeline

The Push Notification pipeline alerts university commuters when their assigned route vehicle begins its transit run. To guarantee zero-loss under serverless edge lifecycles while shielding trip-start latency from FCM network delays, the architecture couples an idempotent database deduplication lock with a bounded asynchronous race.

#### Notification Fan-Out & Multi-Stage Fallback Pipeline
```
[ trip-orchestrator.ts: startTrip() ]
                  |
                  | Awaited Bounded Wrapper (5,000ms max ceiling)
                  v
       dispatchFcmBounded(promise, 'trip start')
                  |
                  +-------------------------------------------------+
                  | Promise.race([ dispatchTripNotification, 5s ])  |
                  +-------------------------------------------------+
                                    |
                                    v
                     dispatchTripNotification()
                                    |
                                    v
                            notifyRoute(params)
                                    |
      +-----------------------------+-----------------------------+
      | 1. Idempotency Lock Gate                                  |
      | acquireNotificationLock(busId, tripId, 'TRIP_STARTED')     |
      | -> RPC acquire_fcm_lock('start')                          |
      +-----------------------------+-----------------------------+
                                    |
                        [ result.acquired == true? ]
                       /                            \
                     YES                             NO (Already sent)
                      |                               \
                      v                                v
     [ 2. Resolve Student Tokens ]                Return immediately
      getValidTokensForBusAndShift(busId, shift)  { success: true, error: 'already_sent' }
      - busVariations: [busId, 'bus_'+id, id]
      - Query: student_profiles WHERE bus_id IN (...)
      - Filter: isShiftCompatible(s.shift, shift)
      - Query: fcm_tokens WHERE user_id IN (...) AND valid = true (chunked in 200s)
                      |
                      v
             [ Tokens found > 0? ]
            /                     \
          YES                      NO (Fallback 1)
           |                        \
           |                         v
           |             getValidTokensForRoute(routeId)
           |             - Query: student_profiles WHERE route_id = routeId
           |             - Query: fcm_tokens for those userIds
           |                        |
           |                        v
           |              [ Tokens found > 0? ]
           |             /                     \
           |           YES                      NO
           |            |                        |
           v            v                        v
     +----------------------------------+   +----------------------------------+
     | DIRECT MULTICAST DISPATCH        |   | TOPIC PUSH FALLBACK (Fallback 2) |
     | Slices tokens into batches <= 500|   | Target: route_<routeId>_<shift>  |
     | messaging.sendEachForMulticast() |   | messaging.send({ topic: ... })   |
     | Payload:                         |   |                                  |
     | - Title: "Bus Journey Started!"  |   |                                  |
     | - Body: "Your bus for ... has    |   |                                  |
     |   started... Track it live now!" |   |                                  |
     | - link: "/student/track-bus"     |   |                                  |
     +----------------------------------+   +----------------------------------+
                      |                                      |
                      +------------------+-------------------+
                                         |
                                         v
                     [ Client Reception & Service Worker ]
                      - Foreground: onMessage() callback (Toast / UI state)
                      - Background: /firebase-messaging-sw.js
                        showNotification('Bus Journey Started!', {
                          tag: tripId,
                          click_action: '/student/track-bus',
                          actions: [{ action: 'open', title: 'Track Bus' }]
                        })
```

---

### 3.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/domains/trip/services/trip-orchestrator.ts` | `dispatchFcmBounded` | `startTrip`, `endTrip` | `Promise.race`, `dispatchTripNotification` | None |
| `src/domains/trip/services/trip-notification.service.ts` | `dispatchTripNotification` | `trip-orchestrator.ts` | `notifyRoute` | None |
| `src/lib/services/fcm-notification-service.ts` | `notifyRoute`, `notifyRouteTopic`, `verifyDriverRouteBinding`, `notifyAllUsers` | `trip-notification.service.ts` | `acquireNotificationLock` (`acquire_fcm_lock` RPC), `getValidTokensForBusAndShift`, `getValidTokensForRoute`, `messaging.sendEachForMulticast`, `messaging.send` | PostgreSQL `active_trips.fcm_start_sent` |
| `src/lib/services/fcm-token-service.ts` | `getValidTokensForBusAndShift`, `getValidTokensForRoute`, `getValidTokensForBus`, `saveToken`, `invalidateToken`, `deleteTokenByPath`, `cleanupStaleTokens` | `fcm-notification-service.ts` | `getStudentsByBusIds`, `getStudentsByRouteIds`, `isShiftCompatible`, `getValidFcmTokensForUsers` | None |
| `src/domains/identity/services/identity.service.ts` | `getValidFcmTokensForUsers`, `getStudentsByBusIds`, `getStudentsByRouteIds`, `deleteFcmToken`, `cleanupStaleFcmTokens` | `fcm-token-service.ts` | `repoGetValidTokensForUsers`, `repoFindStudentsByBusIds`, `repoFindStudentsByRouteIds` | None |
| `src/domains/identity/repositories/fcm-token.repository.pg.ts` | `getValidTokensForUsers`, `upsertToken`, `deleteToken`, `cleanupStaleTokens` | `identity.service.ts` | `supabase.from('fcm_tokens')` | PostgreSQL `public.fcm_tokens` |
| `src/domains/student/repositories/student.repository.pg.ts` | `pgFindByBusIds`, `pgFindByRouteIds` | `identity.repository.pg.ts` | `supabase.from('student_profiles')` | None |
| `src/contexts/NotificationContext.tsx` | `NotificationProvider`, `useNotifications` | Root Layout (`src/app/layout.tsx`) | `authApiFetch('/api/notifications')` | React state: `notifications`, `unreadCount` |
| `src/lib/fcm-service.ts` | `requestNotificationPermission`, `getFCMToken`, `saveFCMToken`, `onForegroundMessage` | Student client layouts/components | Firebase Messaging client SDK (`getToken`, `onMessage`) | Browser Service Worker Registration, Local Notification State |
| `public/firebase-messaging-sw.js` | Background Service Worker | Browser OS Push Engine | `messaging.onBackgroundMessage`, `registration.showNotification`, `clients.openWindow` | Native OS Notification Center |

---

### 3.3 Method-by-Method Low-Level Walkthrough

#### 1. `src/domains/trip/services/trip-orchestrator.ts` -> `dispatchFcmBounded(promise, label)`
- **Signature**: `function dispatchFcmBounded(promise: Promise<unknown>, label: string): Promise<void>`
- **Execution Logic**:
  ```typescript
  function dispatchFcmBounded(promise: Promise<unknown>, label: string): Promise<void> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('FCM dispatch timeout (5s)')), 5000)
    );
    return Promise.race([promise, timeout]).then(
      () => undefined,
      (e) => {
        console.warn(`${label} FCM dispatch failed or timed out (non-critical):`, (e as Error)?.message || e);
      }
    );
  }
  ```
- **Operational Guarantees**:
  - The promise is `await`ed inside `startTrip` prior to returning the HTTP response to the driver client.
  - In serverless runtime environments (Vercel), background promises launched without `await` can be killed when the CPU freezes on response flush. Awaiting with a strict 5,000ms boundary guarantees execution time while ensuring the driver never waits more than 5 seconds even if Firebase APIs stall.
  - If FCM times out or throws, the catch handler swallows the error, logs a warning, and allows the trip to start successfully.

---

#### 2. `src/lib/services/fcm-notification-service.ts` -> `notifyRoute(params)`
- **Input Parameters**:
  - `routeId`: Route identifier string.
  - `tripId`: Unique trip UUID.
  - `routeName`: Human-readable route name.
  - `busId`: Vehicle ID.
  - `shift`: Shift string (`'Morning'`, `'Evening'`, `'both'`).
  - `eventType`: Optional `'TRIP_STARTED' | 'TRIP_ENDED'` (defaults to `'TRIP_STARTED'`).
  - `skipIdempotencyCheck`: Optional boolean.
- **Return Type**: `Promise<NotifyRouteResult>`
- **Execution Control Flow**:
  1. Idempotency Check:
     - Unless `skipIdempotencyCheck` is true, calls `acquireNotificationLock(busId, tripId, eventType)`.
     - Executes RPC `acquire_fcm_lock`. If `result.acquired === false`, throws `'NOTIFICATION_ALREADY_SENT'`.
     - Caught by error block, which immediately aborts with `{ success: true, successCount: 0, failureCount: 0, totalTokens: 0, error: 'NOTIFICATION_ALREADY_SENT' }`.
  2. Student Token Discovery:
     - Calls `getValidTokensForBusAndShift(busId, shift)`.
     - If returned array length is 0, executes Fallback 1: `getValidTokensForRoute(routeId)`.
  3. Direct Multicast Push:
     - If tokens exist (`tokensWithMeta.length > 0`):
       - Extracts unique tokens: `Array.from(new Set(tokensWithMeta.map(t => t.token)))`.
       - Prepares payload:
         - Title: `'Bus Journey Started!'`
         - Body: ``Your bus for ${displayRouteName} has started its journey. Track it live now!``
         - Data: `{ type: eventType, routeId, busId, tripId, timestamp: new Date().toISOString() }`
         - Link: `'/student/track-bus'`
         - Android channel: `'bus_alerts'`, priority: `'high'`.
       - Loops in chunks of 500:
         `await messaging.sendEachForMulticast({ tokens: batch, notification: { title, body }, data, android, webpush });`
       - Sets `directTokensCount = tokens.length`.
  4. Topic Push Fallback (Fallback 2):
     - If `directTokensCount === 0`:
       - Invokes `notifyRouteTopic({ routeId, tripId, routeName, busId, shift, eventType })`.
       - Target topic: ``route_${routeId}_${shift.toLowerCase()}`` (or ``route_${routeId}`` if shift is both/unspecified).
       - Sends via `messaging.send({ topic: targetTopic, ... })`.
  5. Pruning Behavior in Live Code:
     - Forensic inspection of `notifyRoute` confirms that failed token responses (`batchResponse.responses.filter(r => !r.success)`) are logged to console.
     - `invalidTokensRemoved` is returned as `0`. In-flight token deletion is not performed during the trip-start path; token pruning is relegated to `cleanupStaleTokens` and explicit invalidation endpoints.

---

#### 3. `src/lib/services/fcm-token-service.ts` -> `getValidTokensForBusAndShift(busId, shift)`
- **Execution Flow**:
  1. Generates bus identifier variations to handle prefix inconsistencies:
     ```typescript
     const busVariations = [busId];
     if (busId.startsWith('bus_')) {
       busVariations.push(busId.replace('bus_', ''));
     } else {
       busVariations.push(`bus_${busId}`);
     }
     ```
  2. Queries `student_profiles` in PostgreSQL via `getStudentsByBusIds(busVariations)` (`pgFindByBusIds`):
     `SELECT ... FROM student_profiles WHERE bus_id IN (...)`.
  3. Filters students by shift compatibility:
     `isShiftCompatible(student.shift, shift)` checks whether a student's enrolled shift matches the active trip's shift (e.g. students enrolled in `'Both'` match both `'Morning'` and `'Evening'`).
  4. Collects `userIds = filteredStudents.map(s => s.uid)`.
  5. Queries `fcm_tokens` in PostgreSQL via `getValidFcmTokensForUsers(userIds)`:
     - Chunks user IDs into blocks of 200.
     - Executes `SELECT token, platform, user_id FROM fcm_tokens WHERE user_id IN (...) AND valid = true`.
     - Deduplicates tokens using a `Set<string>` and returns `TokenWithMeta[]`.

---

#### 4. `public/firebase-messaging-sw.js` -> Background Notification Handler
- **Event**: `messaging.onBackgroundMessage((payload) => { ... })`
- **Execution**:
  1. If payload contains native `notification` property, browser FCM SDK displays it automatically; SW skips manual display to avoid duplicate popups.
  2. If data-only payload:
     - Inspects `data.type`. If `'TRIP_STARTED'`:
       - Title: `'Bus Journey Started!'`
       - Body: ``Your bus for ${data.routeName} has started its journey. Track it live now!``
       - `clickUrl`: `'/student/track-bus'`
       - Action button: `[{ action: 'open', title: 'Track Bus' }]`
       - `tag`: `data.tripId` (ensures subsequent updates replace the existing alert rather than cluttering the notification drawer).
       - `requireInteraction`: `true` (keeps banner on screen until commuter interacts).
  3. Notification Click Listener (`self.addEventListener('notificationclick')`):
     - Closes notification via `event.notification.close()`.
     - Iterates through existing browser windows via `clients.matchAll({ type: 'window', includeUncontrolled: true })`.
     - If an existing tab is open, focuses tab and calls `client.navigate(clickUrl)`.
     - If no tab open, calls `clients.openWindow(clickUrl)`.

---

### 3.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Case A: Normal Fan-Out (Direct Student Tokens Found)
| System / Component | Operation | Exact Target / Key / Channel | Count |
| :--- | :--- | :--- | :--- |
| **PostgreSQL (FCM Lock)** | RPC `acquire_fcm_lock` | Row update `active_trips.fcm_start_sent` | 1 |
| **PostgreSQL (Student Lookup)** | SELECT (`in`) | `student_profiles` WHERE `bus_id IN (...)` | 1 |
| **PostgreSQL (Token Lookup)** | SELECT (`in`) | `fcm_tokens` WHERE `user_id IN (...)` (1 query per 200 users) | $lceil N_{students}/200 
ceil$ (Typically 1) |
| **External Calls (FCM)** | HTTPS (Firebase Admin) | Multicast FCM HTTP/v1 API (1 call per 500 tokens) | $lceil N_{tokens}/500 
ceil$ (Typically 1) |
| **Total Cold Operations** | | **3 PG Queries, 0 Redis Commands, 0 WS Frames, 1 FCM Multicast Call** | |

---

#### Case B: Fallback Fan-Out (0 Bus Tokens -> Route Topic Push)
| System / Component | Operation | Exact Target / Key / Channel | Count |
| :--- | :--- | :--- | :--- |
| **PostgreSQL (FCM Lock)** | RPC `acquire_fcm_lock` | Row update `active_trips.fcm_start_sent` | 1 |
| **PostgreSQL (Bus Students)** | SELECT (`in`) | `student_profiles` WHERE `bus_id IN (...)` (yields 0) | 1 |
| **PostgreSQL (Route Students)** | SELECT (`in`) | `student_profiles` WHERE `route_id IN (...)` (yields 0) | 1 |
| **External Calls (FCM Topic)** | HTTPS (Firebase Admin) | `messaging.send({ topic: 'route_<id>_<shift>' })` | 1 |
| **Total Fallback Operations** | | **3 PG Queries, 0 Redis Commands, 0 WS Frames, 1 FCM Topic Call** | |

---

#### Case C: Idempotent Re-start (FCM Already Sent)
| System / Component | Operation | Exact Target / Key / Channel | Count |
| :--- | :--- | :--- | :--- |
| **PostgreSQL (FCM Lock)** | RPC `acquire_fcm_lock` | Returns `acquired: false` | 1 |
| **External Calls (FCM)** | None | Bypassed completely | 0 |
| **Total Operations** | | **1 PG Query, 0 Network Calls** | |

---

### 3.5 Verbatim Source Code from Live Codebase

#### 1. Push Notification Service: `notifyRoute` & `notifyRouteTopic`
*Source: `src/lib/services/fcm-notification-service.ts` (Lines 29–294)*
```typescript
async function acquireNotificationLock(busId: string, tripId: string, eventType: TripEventType): Promise<void> {
  // D9: Use PostgreSQL RPC instead of Firestore transaction
  const supabase = getSupabaseServer();
  const lockType = eventType === 'TRIP_ENDED' ? 'end' : 'start';

  const { data: result, error } = await supabase
    .rpc('acquire_fcm_lock', {
      p_trip_id: tripId,
      p_bus_id: busId,
      p_lock_type: lockType,
    });

  if (error) {
    console.error('FCM lock RPC error:', error);
    throw new Error('FCM_LOCK_ERROR');
  }

  // acquired=false means already sent (idempotent)
  if (result && !result.acquired) {
    throw new Error('NOTIFICATION_ALREADY_SENT');
  }
}

export async function notifyRoute(params: {
  routeId: string;
  tripId: string;
  routeName: string;
  busId: string;
  shift?: string;
  eventType?: TripEventType;
  skipIdempotencyCheck?: boolean;
}): Promise<NotifyRouteResult> {
  const { routeId, tripId, routeName, busId, shift, skipIdempotencyCheck } = params;
  const eventType: TripEventType = params.eventType || 'TRIP_STARTED';
  const logCtx = { routeId, tripId, busId, shift, eventType };

  if (!skipIdempotencyCheck) {
    try {
      await acquireNotificationLock(busId, tripId, eventType);
    } catch (error) {
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        batchCount: 0,
        invalidTokensRemoved: 0,
        error: error instanceof Error ? error.message : 'already_sent',
      };
    }
  }

  // Dispatch strategy: Direct token multicast targets registered student tokens in fcm_tokens.
  // If direct tokens exist, we notify them directly to prevent duplicate sends.
  // If 0 direct tokens exist, we fall back to topic push (route/bus topics).
  let directTokensCount = 0;
  let topicResult: { success: boolean; messageId?: string; error?: string } = { success: false };

  if (messaging) {
    try {
      let tokensWithMeta = busId
        ? await getValidTokensForBusAndShift(busId, shift)
        : await getValidTokensForRoute(routeId);

      // Fallback: If busId lookup yielded 0 tokens, search by routeId
      if (tokensWithMeta.length === 0 && routeId && busId) {
        console.log(`[notifyRoute] 0 tokens found for bus ${busId}, falling back to route ${routeId} tokens`);
        tokensWithMeta = await getValidTokensForRoute(routeId);
      }

      if (tokensWithMeta.length > 0) {
        const tokens = Array.from(new Set(tokensWithMeta.map(t => t.token)));
        console.log(`[notifyRoute] Direct multicast: sending to ${tokens.length} token(s)`, logCtx);

        const displayRouteName = routeName || routeId;
        const isStart = eventType === 'TRIP_STARTED';
        const title = isStart ? 'Bus Journey Started!' : 'Trip Ended';
        const body = isStart
          ? `Your bus for ${displayRouteName} has started its journey. Track it live now!`
          : `Your bus trip for ${displayRouteName} has ended.`;
        const link = isStart ? '/student/track-bus' : '/student';

        let totalInvalid = 0;
        for (let i = 0; i < tokens.length; i += 500) {
          const batch = tokens.slice(i, i + 500);
          const batchResponse = await messaging.sendEachForMulticast({
            tokens: batch,
            notification: { title, body },
            data: { type: eventType, routeId, busId, tripId, timestamp: new Date().toISOString() },
            android: { priority: 'high', notification: { channelId: 'bus_alerts', sound: 'default' } },
            webpush: {
              headers: { Urgency: 'high' },
              notification: {
                title,
                body,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
              },
              fcmOptions: { link },
            },
          });
          const batchInvalid = batchResponse.responses.filter(r => !r.success).length;
          totalInvalid += batchInvalid;
          console.log(`[notifyRoute] Batch ${Math.floor(i / 500) + 1}: ${batchResponse.successCount} sent, ${batchInvalid} failed`);
        }

        directTokensCount = tokens.length;
        console.log(`[notifyRoute] Direct multicast complete: ${tokens.length} tokens, ${totalInvalid} invalid`, logCtx);
      }
    } catch (directErr) {
      console.error('[notifyRoute] Direct token multicast threw an error:', directErr, logCtx);
    }
  }

  // Fallback to topic push ONLY if direct token multicast was not sent / yielded 0 tokens
  if (directTokensCount === 0) {
    console.log('[notifyRoute] 0 direct tokens notified — executing topic push fallback', logCtx);
    topicResult = await notifyRouteTopic({ routeId, tripId, routeName, busId, shift, eventType });
  }

  const totalSuccess = (topicResult.success ? 1 : 0) + directTokensCount;
  const batchCount = (topicResult.success ? 1 : 0) + (directTokensCount > 0 ? 1 : 0);

  console.log(`[notifyRoute] Dispatch complete for trip ${tripId} (${eventType}): topic=${topicResult.success}, directTokens=${directTokensCount}`, logCtx);

  return {
    success: totalSuccess > 0,
    successCount: totalSuccess,
    failureCount: topicResult.success || directTokensCount > 0 ? 0 : 1,
    totalTokens: directTokensCount,
    batchCount,
    invalidTokensRemoved: 0,
    error: topicResult.error,
  };
}

export async function notifyRouteTopic(params: {
  routeId: string;
  tripId?: string;
  routeName?: string;
  busId?: string;
  shift?: string;
  eventType?: RouteTopicEventType;
  title?: string;
  body?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  link?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!messaging) return { success: false, error: 'Firebase Admin Messaging not initialized' };

  const { routeId, tripId, routeName, busId, shift } = params;
  const eventType: RouteTopicEventType = params.eventType || 'TRIP_STARTED';
  const isStart = eventType === 'TRIP_STARTED';
  const displayRouteName = routeName || routeId;
  const defaultTitle =
    eventType === 'BUS_CHANGED'
      ? 'Bus Changed'
      : isStart
        ? 'Bus Journey Started!'
        : 'Trip Ended';
  const defaultBody =
    eventType === 'BUS_CHANGED'
      ? 'Your route bus assignment has changed.'
      : isStart
        ? `Your bus for ${displayRouteName} has started its journey. Track it live now!`
        : `Your bus trip for ${displayRouteName} has ended.`;
  const link = params.link || (isStart ? '/student/track-bus' : '/student');

  const data: Record<string, string> = {
    type: eventType,
    routeId,
    timestamp: new Date().toISOString(),
  };

  if (tripId) data.tripId = tripId;
  if (busId) data.busId = busId;
  if (routeName) data.routeName = routeName;
  if (shift) data.shift = shift;

  for (const [key, value] of Object.entries(params.data || {})) {
    if (value !== undefined && value !== null) {
      data[key] = String(value);
    }
  }

  const targetTopic = (shift && shift.toLowerCase() !== 'both')
    ? `route_${routeId}_${shift.toLowerCase()}`
    : `route_${routeId}`;

  try {
    const messageId = await messaging.send({
      topic: targetTopic,
      notification: {
        title: params.title || defaultTitle,
        body: params.body || defaultBody,
      },
      data,
      android: {
        priority: 'high',
        notification: { channelId: 'bus_alerts', sound: 'default' },
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: params.title || defaultTitle,
          body: params.body || defaultBody,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
        },
        fcmOptions: { link },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: { title: params.title || defaultTitle, body: params.body || defaultBody },
            sound: 'default',
          },
        },
      },
    });

    return { success: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Topic notification failed';
    console.error(`Topic notification failed for route_${routeId}:`, message);
    return { success: false, error: message };
  }
}
```

#### 2. Student Token Resolver: `getValidTokensForBusAndShift`
*Source: `src/lib/services/fcm-token-service.ts` (Lines 163–189)*
```typescript
export async function getValidTokensForBusAndShift(busId: string, shift?: string): Promise<TokenWithMeta[]> {
  const { isShiftCompatible } = await import('@/lib/utils');
  const busVariations = [busId];
  if (busId.startsWith('bus_')) {
    busVariations.push(busId.replace('bus_', ''));
  } else {
    busVariations.push(`bus_${busId}`);
  }

  const students = await getStudentsByBusIds(busVariations);
  if (students.length === 0) {
    return [];
  }

  const filteredStudents = shift
    ? students.filter(s => isShiftCompatible(s.shift, shift))
    : students;

  if (filteredStudents.length === 0) {
    return [];
  }

  const userIds = filteredStudents.map(s => s.uid);
  return getValidFcmTokensForUsers(userIds);
}
```

#### 3. PostgreSQL FCM Token Repository: `getValidTokensForUsers`
*Source: `src/domains/identity/repositories/fcm-token.repository.pg.ts` (Lines 93–132)*
```typescript
export async function getValidTokensForUsers(userIds: string[]): Promise<FcmTokenWithMeta[]> {
  if (!userIds || userIds.length === 0) return [];

  const db = getSupabaseServer();
  const chunkSize = 200;
  const allRows: Array<{ token: string; platform: string; user_id: string }> = [];

  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const { data, error } = await db
      .from('fcm_tokens')
      .select('token, platform, user_id')
      .in('user_id', chunk)
      .eq('valid', true);

    if (error) {
      console.error('FCM token read failed for chunk:', error.message);
      continue;
    }

    if (data) {
      allRows.push(...data);
    }
  }

  // Deduplicate by token value
  const seen = new Set<string>();
  const unique: FcmTokenWithMeta[] = [];
  for (const row of allRows) {
    if (!seen.has(row.token)) {
      seen.add(row.token);
      unique.push({
        token: row.token,
        platform: row.platform || 'web',
        studentId: row.user_id,
      });
    }
  }
  return unique;
}
```

#### 4. Browser Background Service Worker
*Source: `public/firebase-messaging-sw.js` (Lines 52–99)*
```javascript
// When the app is not in focus, FCM delivers data-only messages here.
if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    try {
      const data = payload.data || {};

      // If FCM SDK will auto-show a notification payload, skip manual display.
      if (payload.notification) {
        return;
      }

      let title = 'Bus Notification';
      let body = 'You have a new notification';
      let clickUrl = '/';

      if (data.type === 'TRIP_STARTED' || data.type === 'trip_started') {
        title = 'Bus Journey Started!';
        body = data.routeName
          ? `Your bus for ${data.routeName} has started its journey. Track it live now!`
          : 'Your bus has started its journey. Track it live now!';
        clickUrl = '/student/track-bus';
      } else if (data.type === 'TRIP_ENDED' || data.type === 'trip_ended') {
        title = 'Trip Ended';
        body = data.routeName
          ? `Your bus trip for ${data.routeName} has ended.`
          : 'Your bus trip has ended.';
        clickUrl = '/student';
      }

      const options = {
        body,
        icon: data.icon || '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: String(data.tripId || `bus-${data.type || 'notification'}`).slice(0, 80),
        requireInteraction: data.type === 'TRIP_STARTED',
        data: { ...data, click_action: toSafeAppPath(clickUrl) },
      };

      if (data.type === 'TRIP_STARTED' || data.type === 'trip_started') {
        options.actions = [{ action: 'open', title: 'Track Bus' }];
      }

      return self.registration.showNotification(title, options);
    } catch {
      console.error('Error showing notification.');
    }
  });
}
```


---

