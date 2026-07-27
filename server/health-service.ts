import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { subscriptionManager } from './subscription-manager';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  connections: number;
  subscriptions: number;
  channels: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  eventLoopLagMs?: number;
  dependencies?: {
    firebase: 'ok' | 'missing_credentials';
    supabase: 'ok' | 'missing_credentials';
    redis: 'ok' | 'not_configured';
  };
  draining?: boolean;
  drainElapsedMs?: number;
}

let startTime = Date.now();

/** Samples event loop lag using a setImmediate round-trip. */
function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const t = Date.now();
    setImmediate(() => resolve(Date.now() - t));
  });
}

export class HealthService {
  private _shuttingDown = false;
  private draining = false;
  private drainStart = 0;

  private deps() {
    return {
      firebase: (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
        ? 'ok' as const
        : 'missing_credentials' as const,
      supabase: (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
        ? 'ok' as const
        : 'missing_credentials' as const,
      redis: process.env.REDIS_URL
        ? 'ok' as const
        : 'not_configured' as const,
    };
  }

  private memSnapshot() {
    const m = process.memoryUsage();
    return { rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed };
  }

  /**
   * /health/live — Process is alive and the main loop is responsive.
   * Never returns 'down' during normal operation (even shutdown/drain).
   * Only fails if the process is so overloaded it cannot serve this probe.
   */
  liveness(): HealthStatus {
    return {
      status: 'ok',
      uptime: Date.now() - startTime,
      connections: connectionRegistry.size,
      subscriptions: sessionManager.size,
      channels: subscriptionManager.getChannelCount(),
      memory: this.memSnapshot(),
    };
  }

  /**
   * /health/ready — Safe to route new connections.
   * Returns 'down' when draining or shutting down.
   * Returns 'degraded' when dependency credentials are missing.
   */
  readiness(): HealthStatus {
    const base = this.liveness();
    if (this._shuttingDown || this.draining) {
      return {
        ...base,
        status: 'down',
        draining: this.draining,
        drainElapsedMs: this.getDrainElapsed(),
        dependencies: this.deps(),
      };
    }
    const d = this.deps();
    const credsMissing = d.firebase === 'missing_credentials' || d.supabase === 'missing_credentials';
    return {
      ...base,
      status: credsMissing ? 'degraded' : 'ok',
      dependencies: d,
    };
  }

  /**
   * /health/startup — Extended probe used once during startup only.
   * Measures event loop lag and reports dependency credential status with detail.
   * Useful for CI/CD startup gates and operational dashboards.
   */
  async startup(): Promise<HealthStatus & { eventLoopLagMs: number }> {
    const base = this.readiness();
    const lag = await measureEventLoopLag();
    return { ...base, eventLoopLagMs: lag };
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
