type EventHandler = (payload: any) => void;
type StatusHandler = (status: 'connected' | 'disconnected' | 'reconnecting' | 'error') => void;

export interface WsClientConfig {
  url: string;
  token: string;
  reconnectMaxRetries?: number;
  reconnectBaseDelay?: number;
  pingInterval?: number;
  getNewToken?: () => Promise<string>;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WsClientConfig;
  private handlers = new Map<string, Set<EventHandler>>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private pendingSubscriptions = new Set<string>();
  private currentToken: string;

  constructor(config: WsClientConfig) {
    this.config = {
      reconnectMaxRetries: 10,
      reconnectBaseDelay: 1000,
      pingInterval: 25000,
      ...config,
    };
    this.currentToken = config.token;
  }

  getToken(): string { return this.currentToken; }

  setToken(token: string): void {
    this.currentToken = token;
  }

  connect(): void {
    if (this.destroyed) return;
    this.connectInternal();
  }

  private connectInternal(): void {
    if (this.ws) this.close();
    const params = new URLSearchParams({ token: this.currentToken });
    const storedReconnectToken = sessionStorage?.getItem('ws_reconnect_token');
    if (storedReconnectToken) params.set('reconnect_token', storedReconnectToken);
    const url = `${this.config.url}?${params.toString()}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emitStatus('connected');
      this.startPing();
      for (const ch of this.pendingSubscriptions) this.send({ type: 'subscribe', channel: ch });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message' && msg.channel) {
          const channelHandlers = this.handlers.get(msg.channel);
          if (channelHandlers) {
            for (const h of channelHandlers) h(msg.payload || msg);
          }
        } else if (msg.type === 'subscribed') {
          this.pendingSubscriptions.delete(msg.channel);
        } else if (msg.type === 'auth_ok') {
          if (msg.data?.reconnect_token && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('ws_reconnect_token', msg.data.reconnect_token);
          }
        } else if (msg.type === 'auth_required') {
          this.handleAuthRequired();
        } else if (msg.type === 'error') {
          console.warn('[WS Client] Server error:', msg.message);
        } else if (msg.type === 'ping') {
          this.send({ type: 'pong' });
        }
      } catch { }
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.emitStatus('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.emitStatus('error');
    };
  }

  private async handleAuthRequired(): Promise<void> {
    if (this.config.getNewToken) {
      try {
        const newToken = await this.config.getNewToken();
        this.currentToken = newToken;
        this.reconnectAttempts = 0;
        this.connectInternal();
      } catch {
        this.emitStatus('error');
      }
    }
  }

  subscribe(channel: string, handler: EventHandler): () => void {
    if (!this.handlers.has(channel)) this.handlers.set(channel, new Set());
    this.handlers.get(channel)!.add(handler);
    if (!this.isConnected()) {
      this.pendingSubscriptions.add(channel);
    } else {
      this.send({ type: 'subscribe', channel });
    }
    return () => {
      this.handlers.get(channel)?.delete(handler);
      if (this.handlers.get(channel)?.size === 0) {
        this.handlers.delete(channel);
        if (this.isConnected()) this.send({ type: 'unsubscribe', channel });
      }
    };
  }

  unsubscribe(channel: string): void {
    this.handlers.delete(channel);
    this.pendingSubscriptions.delete(channel);
    if (this.isConnected()) this.send({ type: 'unsubscribe', channel });
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.destroyed = true;
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('ws_reconnect_token');
    this.close();
  }

  private close(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= (this.config.reconnectMaxRetries || 10)) {
      this.emitStatus('error');
      return;
    }
    this.emitStatus('reconnecting');
    const delay = (this.config.reconnectBaseDelay || 1000) * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connectInternal(), delay);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) this.send({ type: 'pong' });
    }, this.config.pingInterval || 25000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private emitStatus(status: 'connected' | 'disconnected' | 'reconnecting' | 'error'): void {
    for (const h of this.statusHandlers) h(status);
  }
}
