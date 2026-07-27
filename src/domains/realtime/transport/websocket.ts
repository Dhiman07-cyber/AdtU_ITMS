const PRIVILEGED_TOKEN = process.env.WS_PRIVILEGED_TOKEN || '__server__';

const MAX_QUEUE = 500;

export class WebSocketTransport {
  readonly name = 'websocket';

  private ws: any | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sendQueue: string[] = [];

  async connect(): Promise<void> {
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
    if (!this.connected || !this.ws) {
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
      this.ws.send(msg);
    }
  }

  private drainQueue(): void {
    while (this.sendQueue.length > 0) {
      const msg = this.sendQueue.shift();
      if (msg) this.unsafeSend(msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}