type EventHandler = (payload: any) => void;
type StatusHandler = (status: 'connected' | 'disconnected' | 'reconnecting' | 'error') => void;

const STORAGE_KEY = 'ws_reconnect_token';
const MAX_RECONNECT_JITTER_MS = 1000;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return localStorage;
}

function getConnectCount(): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(sessionStorage.getItem('ws_connect_count') || '0', 10);
}

function incConnectCount(): number {
  if (typeof window === 'undefined') return 0;
  const next = getConnectCount() + 1;
  sessionStorage.setItem('ws_connect_count', String(next));
  return next;
}

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
  private paused = false;
  private pendingSubscriptions = new Set<string>();
  private currentToken: string;
  private visibilityHandler: (() => void) | null = null;

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
    this.watchVisibility();
  }

  private watchVisibility(): void {
    if (this.visibilityHandler) return;
    const handler = () => {
      if (document.hidden) {
        this.paused = true;
        this.stopPing();
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      } else {
        this.paused = false;
        if (this.isConnected()) {
          this.startPing();
        } else if (!this.destroyed) {
          this.reconnectAttempts = 0;
          this.connectInternal();
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    this.visibilityHandler = () => document.removeEventListener('visibilitychange', handler);
  }

  private cleanupVisibility(): void {
    if (this.visibilityHandler) {
      this.visibilityHandler();
      this.visibilityHandler = null;
    }
  }

  private connectInternal(): void {
    if (this.destroyed || this.paused) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) this.close();
    const params = new URLSearchParams({ token: this.currentToken });
    const store = getStorage();
    const storedReconnectToken = store?.getItem(STORAGE_KEY);
    if (storedReconnectToken) params.set('reconnect_token', storedReconnectToken);

    let baseUrl = this.config.url.trim();
    const queryIndex = baseUrl.indexOf('?');
    if (queryIndex !== -1) {
      baseUrl = baseUrl.substring(0, queryIndex);
    }
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/ws')) {
      baseUrl = `${baseUrl}/ws`;
    }
    const url = `${baseUrl}?${params.toString()}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      if (this.destroyed) { this.close(); return; }
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
          const store = getStorage();
          if (msg.data?.reconnect_token && store) {
            store.setItem(STORAGE_KEY, msg.data.reconnect_token);
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
    this.cleanupVisibility();
    this.handlers.clear();
    this.statusHandlers.clear();
    this.pendingSubscriptions.clear();
    this.close();
  }

  private close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.paused) return;
    if (this.reconnectAttempts >= (this.config.reconnectMaxRetries || 10)) {
      this.emitStatus('error');
      return;
    }
    this.emitStatus('reconnecting');
    const baseDelay = this.config.reconnectBaseDelay || 1000;
    const jitter = Math.floor(Math.random() * MAX_RECONNECT_JITTER_MS);
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts) + jitter, 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connectInternal(), delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.isConnected()) this.send({ type: 'pong' });
    }, this.config.pingInterval || 25000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private emitStatus(status: 'connected' | 'disconnected' | 'reconnecting' | 'error'): void {
    for (const h of this.statusHandlers) h(status);
  }
}
