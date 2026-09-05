/**
 * Real WS client for the staging harness. Speaks the exact production
 * protocol (server/websocket-server.ts + server/socket-router.ts):
 *   connect -> {type:'auth',token} -> auth_ok{reconnect_token}
 *   -> {type:'subscribe',channel} / {type:'presence',...} / {type:'location_update',...}
 *
 * Every received message is timestamped on arrival for latency correlation.
 */
import WebSocket from 'ws';

export interface ReceivedMessage { msg: any; receivedAtMs: number; }

export class WsAgent {
  readonly nodeUrl: string;
  private ws: WebSocket | null = null;
  private handlers = new Map<string, (m: ReceivedMessage) => void>();
  private anyHandlers: ((m: ReceivedMessage) => void)[] = [];
  reconnectToken: string | null = null;
  uid: string | null = null;
  role: string | null = null;
  stats = { connectedAt: 0, connects: 0, sent: 0, received: 0, errors: 0, reconnects: 0, authFailures: 0 };
  readonly serverErrors: string[] = [];
  private pongTimer: ReturnType<typeof setInterval> | null = null;
  presenceOkHandlers: (() => void)[] = [];
  subscribeOkHandlers: ((channel: string) => void)[] = [];
  connectedAt: number | null = null;
  disconnectedAt: number | null = null;
  /** Closed connection intervals on this socket (start=open, end=close). Used
   *  by the harness to compute per-user connection windows for event-time
   *  eligibility. */
  readonly connectionIntervals: { start: number; end: number }[] = [];
  /** Per-channel subscription intervals. Each entry = [start=subscribed,
   *  end=unsubscribed/connection-lost]. */
  readonly subscriptionIntervals = new Map<string, { start: number; end: number }[]>();

  constructor(nodeUrl: string) { this.nodeUrl = nodeUrl; }

  /** Connect and authenticate with a Firebase ID token. Resolves on auth_ok.
   * 15s default: a fresh WS server must fetch Firebase JWKS on first auth —
   * cold-start verification can exceed short timeouts. */
  connect(idToken: string, reconnectToken?: string, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve, reject) => {
      const q = reconnectToken ? `?reconnect_token=${encodeURIComponent(reconnectToken)}` : '';
      const ws = new WebSocket(`${this.nodeUrl}/ws${q}`, { handshakeTimeout: timeoutMs, perMessageDeflate: false });
      this.ws = ws;
      const timer = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('auth timeout')); }, timeoutMs);

      ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.type === 'auth_ok') {
          clearTimeout(timer);
          this.uid = msg.data?.uid ?? null;
          this.role = msg.data?.role ?? null;
          if (msg.data?.reconnect_token) this.reconnectToken = msg.data.reconnect_token;
          this.stats.connectedAt = Date.now();
          this.connectedAt = Date.now();
          this.connectionIntervals.push({ start: Date.now(), end: Infinity });
          this.stats.connects++;
          this.startPongs();
          resolve();
          return;
        }
        if (msg.type === 'error' && this.stats.connects === 0) {
          clearTimeout(timer);
          this.stats.authFailures++;
          reject(new Error(`ws auth error: ${msg.message}`));
          return;
        }
        if (msg.type === 'presence_ok') {
          for (const h of this.presenceOkHandlers) h();
        }
        if (msg.type === 'subscribed') {
          const now = Date.now();
          const intervals = this.subscriptionIntervals.get(msg.channel) || [];
          intervals.push({ start: now, end: Infinity });
          this.subscriptionIntervals.set(msg.channel, intervals);
          for (const h of this.subscribeOkHandlers) h(msg.channel);
        }
        this.dispatch(msg);
      });
      ws.on('open', () => {
        this.send({ type: 'auth', token: idToken });
      });
      ws.on('error', (e) => { this.stats.errors++; clearTimeout(timer); reject(e); });
      ws.on('close', () => {
        this.disconnectedAt = Date.now();
        const cur = this.connectionIntervals[this.connectionIntervals.length - 1];
        if (cur && cur.end === Infinity) cur.end = Date.now();
        // Close any still-open subscription intervals: connection loss tears
        // down all subscriptions (server does the same).
        for (const intervals of this.subscriptionIntervals.values()) {
          const open = intervals.find((i) => i.end === Infinity);
          if (open) open.end = Date.now();
        }
        this.stopPongs();
      });
    });
  }

  private startPongs() {
    this.stopPongs();
    this.pongTimer = setInterval(() => { try { this.send({ type: 'pong' }); } catch {} }, 25000);
  }
  private stopPongs() { if (this.pongTimer) { clearInterval(this.pongTimer); this.pongTimer = null; } }

  onChannel(channel: string, handler: (m: ReceivedMessage) => void): void {
    this.handlers.set(channel, handler);
    this.send({ type: 'subscribe', channel });
  }

  onAny(handler: (m: ReceivedMessage) => void): void { this.anyHandlers.push(handler); }

  onPresenceOk(handler: () => void): void { this.presenceOkHandlers.push(handler); }

  onSubscribeOk(handler: (channel: string) => void): void { this.subscribeOkHandlers.push(handler); }

  presence(busId: string, tripId?: string, routeId?: string): void {
    this.send({ type: 'presence', busId, tripId, routeId });
  }

  send(obj: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      this.stats.sent++;
    }
  }

  /** Abruptly kill the socket (no close frame) — simulates network loss. */
  kill(): void {
    try { this.ws?.terminate(); } catch { /* ignore */ }
    this.ws = null;
    this.stopPongs();
  }

  /** Graceful close. */
  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.stopPongs();
  }

  get isOpen(): boolean { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  private dispatch(msg: any): void {
    this.stats.received++;
    if (msg.type === 'error') this.serverErrors.push(String(msg.message || JSON.stringify(msg)));
    const rm: ReceivedMessage = { msg, receivedAtMs: Date.now() };
    if (msg.type === 'message' && typeof msg.channel === 'string') {
      this.handlers.get(msg.channel)?.(rm);
    }
    for (const h of this.anyHandlers) { try { h(rm); } catch { /* isolate */ } }
  }
}
