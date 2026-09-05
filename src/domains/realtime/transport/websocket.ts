const privilegedToken = process.env.WS_PRIVILEGED_TOKEN;
const isProd = process.env.NODE_ENV === 'production';
const privilegedAuthEnabled = isProd
  ? Boolean(privilegedToken && privilegedToken.trim() !== '' && privilegedToken !== '__server__')
  : Boolean(privilegedToken || true);
const PRIVILEGED_TOKEN = privilegedToken || (isProd ? '' : '__server__');

const MAX_QUEUE = 500;
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

  async connect(): Promise<void> {
    if (!privilegedAuthEnabled) {
      console.warn('[WebSocketTransport] WS_PRIVILEGED_TOKEN is missing or insecure in production; server bridge disabled. Events will queue.');
      return;
    }
    const port = process.env.WS_PORT || '3001';
    const host = process.env.WS_HOST || '127.0.0.1';
    if (this.connected) return;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    try {
      const { default: WebSocket } = await import('ws');
      this.ws = new WebSocket(`ws://${host}:${port}/ws?token=${PRIVILEGED_TOKEN}`);

      this.ws.on('open', () => {
        this.connected = true;
        this.sendPresence();
        // Drain synchronously first so callers see an empty queue immediately.
        // The batched path handles any messages queued during the drain itself.
        this.drainQueueSync();
        this.drainQueue();
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
    while (this.sendQueue.length > 0) {
      const msg = this.sendQueue.shift();
      if (msg) this.unsafeSend(msg);
    }
  }

  private drainQueue(): void {
    // ponytail: batch drain — 20 frames per tick avoids saturating server on reconnect
    const sendBatch = () => {
      let n = 0;
      while (this.sendQueue.length > 0 && n < 20) {
        const msg = this.sendQueue.shift();
        if (msg) { this.unsafeSend(msg); n++; }
      }
      if (this.sendQueue.length > 0) setImmediate(sendBatch);
    };
    if (this.sendQueue.length > 0) setImmediate(sendBatch);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}