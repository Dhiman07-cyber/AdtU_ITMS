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
  private lastActivity = 0;

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
        this.lastActivity = Date.now();
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
      // Phase-04: Send auth as first message (preferred path).
      // The server also accepts the URL token (deprecated Path A) for backward
      // compatibility. When Phase-05 removes URL token support, remove the URL
      // param from connectInternal() and rely solely on this message.
      this.send({ type: 'auth', token: this.currentToken });
      // Resend ALL active channel subscriptions registered in handlers to ensure no dropped channels on reconnect
      for (const ch of this.handlers.keys()) {
        this.send({ type: 'subscribe', channel: ch });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        this.lastActivity = Date.now();
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
          // Re-affirm channel subscriptions on auth_ok
          for (const ch of this.handlers.keys()) {
            this.send({ type: 'subscribe', channel: ch });
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

    this.ws.onclose = (event: CloseEvent) => {
      this.stopPing();
      this.emitStatus('disconnected');
      if (event.code === 4001 || event.reason === 'Authentication failed') {
        this.handleAuthRequired();
      } else {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.emitStatus('error');
    };
  }

  private async handleAuthRequired(): Promise<void> {
    try {
      let newToken: string | null = null;
      if (this.config.getNewToken) {
        newToken = await this.config.getNewToken();
      } else {
        const { auth } = await import('@/lib/firebase');
        if (auth.currentUser) {
          newToken = await auth.currentUser.getIdToken(true);
        }
      }
      if (newToken) {
        this.currentToken = newToken;
        this.reconnectAttempts = 0;
        this.connectInternal();
      } else {
        this.emitStatus('error');
      }
    } catch {
      this.emitStatus('error');
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
    this.lastActivity = Date.now();
    // Watchdog: the server replies pong_ack to every app-level pong, so a
    // healthy connection sees a message at least once per ping cycle. If
    // nothing arrives for 3 cycles the server (or network path) is dead —
    // the browser would keep the socket OPEN forever without this. Force a
    // close; onclose triggers the normal reconnect path.
    const watchTimeout = Math.max(30000, (this.config.pingInterval || 25000) * 3);
    this.pingTimer = setInterval(() => {
      if (!this.isConnected()) return;
      if (Date.now() - this.lastActivity > watchTimeout) {
        console.warn('[WS Client] Server heartbeat timeout - reconnecting');
        this.ws?.close();
        return;
      }
      this.send({ type: 'pong' });
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
