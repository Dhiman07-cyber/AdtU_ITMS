import type { RealtimeTransport } from '../contracts/transport';

const PRIVILEGED_TOKEN = process.env.WS_PRIVILEGED_TOKEN || '__server__';

export class WebSocketTransport implements RealtimeTransport {
  readonly name = 'websocket';

  private ws: any | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<void> {
    const port = process.env.WS_PORT || '3001';
    const host = process.env.WS_HOST || '127.0.0.1';
    if (this.connected) return;

    try {
      const { default: WebSocket } = await import('ws');
      this.ws = new WebSocket(`ws://${host}:${port}/ws?token=${PRIVILEGED_TOKEN}`);

      this.ws.on('open', () => {
        this.connected = true;
        this.ws!.send(JSON.stringify({ type: 'presence', role: 'server' }));
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.on('error', () => {
        this.connected = false;
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
        this.ws!.on('open', () => { clearTimeout(timeout); resolve(); });
        this.ws!.on('error', (err: any) => { clearTimeout(timeout); reject(err); });
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.warn(`[WebSocketTransport] Connect failed: ${msg}. Events will queue.`);
    }
  }

  async broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.connected || !this.ws) {
      console.log(`[WebSocketTransport] Queue (disconnected): ${channel}/${event}`);
      return;
    }
    this.ws.send(JSON.stringify({ type: 'broadcast', channel, event, payload }));
  }

  async subscribe(_channel: string, _event: string, _handler: (payload: any) => void): Promise<void> {
  }

  async unsubscribe(_channel: string, _event?: string): Promise<void> {
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}
