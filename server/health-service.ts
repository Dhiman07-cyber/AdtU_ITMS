import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { subscriptionManager } from './subscription-manager';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  connections: number;
  subscriptions: number;
  channels: number;
  memory: Record<string, unknown>;
  dependencies?: {
    firebase: 'ok' | 'missing_credentials';
    supabase: 'ok' | 'missing_credentials';
  };
}

let startTime = Date.now();

export class HealthService {
  private _shuttingDown = false;
  private draining = false;
  private drainStart = 0;

  private deps() {
    return {
      firebase: (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) ? 'ok' as const : 'missing_credentials' as const,
      supabase: (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) ? 'ok' as const : 'missing_credentials' as const,
    };
  }

  liveness(): HealthStatus {
    return {
      status: 'ok',
      uptime: Date.now() - startTime,
      connections: connectionRegistry.size,
      subscriptions: sessionManager.size,
      channels: subscriptionManager.getChannelCount(),
      memory: process.memoryUsage ? {
        rss: process.memoryUsage().rss,
        heapTotal: process.memoryUsage().heapTotal,
        heapUsed: process.memoryUsage().heapUsed,
      } : {},
    };
  }

  readiness(): HealthStatus {
    const base = this.liveness();
    if (this._shuttingDown || this.draining) {
      return { ...base, status: 'down', dependencies: this.deps() };
    }
    const d = this.deps();
    const status = d.firebase === 'ok' && d.supabase === 'ok' ? 'ok' : 'degraded';
    return { ...base, status, dependencies: d };
  }

  isShuttingDown(): boolean { return this._shuttingDown; }

  startShutdown(): void {
    this._shuttingDown = true;
  }

  startDraining(): void {
    this.draining = true;
    this.drainStart = Date.now();
  }

  stopDraining(): void {
    this.draining = false;
  }

  isDraining(): boolean { return this.draining; }

  getDrainElapsed(): number {
    return this.draining ? Date.now() - this.drainStart : 0;
  }
}

export const healthService = new HealthService();
