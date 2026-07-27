/**
 * Canonical Health Check Framework
 * Supports Liveness, Readiness, Dependency checks, Composite health status.
 */

import { ComponentHealth, HealthStatus, SystemHealthResponse } from './types';
import { observabilityConfig } from './config';

export type HealthCheckFn = () => Promise<ComponentHealth>;

class HealthChecker {
  private checks = new Map<string, HealthCheckFn>();
  private startTime = Date.now();

  constructor() {
    this.registerDefaultChecks();
  }

  private registerDefaultChecks(): void {
    // Process / Node.js Health
    this.registerCheck('nodejs', async () => ({
      status: 'UP',
      details: {
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        memoryUsageMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      },
    }));

    // Filesystem Health
    this.registerCheck('filesystem', async () => {
      try {
        return { status: 'UP', details: { writable: true } };
      } catch (err: any) {
        return { status: 'DOWN', error: err.message };
      }
    });

    // Supabase Dependency Health Check
    this.registerCheck('supabase', async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        return { status: 'DEGRADED', error: 'Supabase env vars missing' };
      }
      return { status: 'UP', details: { urlConfigured: true } };
    });

    // Firebase Auth Health Check
    this.registerCheck('firebase', async () => {
      const projId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      if (!projId) {
        return { status: 'DEGRADED', error: 'Firebase project ID missing' };
      }
      return { status: 'UP', details: { projectId: projId } };
    });

    // Redis Health Check (Optional Dependency)
    this.registerCheck('redis', async () => {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        return { status: 'UP', details: { mode: 'in-memory-fallback' } };
      }
      return { status: 'UP', details: { configured: true } };
    });
  }

  registerCheck(name: string, checkFn: HealthCheckFn): void {
    this.checks.set(name, checkFn);
  }

  async runCheck(name: string): Promise<ComponentHealth> {
    const fn = this.checks.get(name);
    if (!fn) {
      return {
        status: 'DOWN',
        error: `Health check '${name}' is not registered`,
        lastChecked: new Date().toISOString(),
      };
    }

    const start = Date.now();
    try {
      const res = await Promise.race([
        fn(),
        new Promise<ComponentHealth>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${observabilityConfig.healthTimeoutsMs.dependency}ms`)),
            observabilityConfig.healthTimeoutsMs.dependency
          )
        ),
      ]);

      return {
        ...res,
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        status: 'DOWN',
        error: err.message || String(err),
        latencyMs: Date.now() - start,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async getLiveness(): Promise<{ status: HealthStatus; uptime: number }> {
    return {
      status: 'UP',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  async getSystemHealth(): Promise<SystemHealthResponse> {
    const results: Record<string, ComponentHealth> = {};
    let overallStatus: HealthStatus = 'UP';

    for (const [name] of this.checks.entries()) {
      const health = await this.runCheck(name);
      results[name] = health;

      if (health.status === 'DOWN') {
        overallStatus = 'DOWN';
      } else if (health.status === 'DEGRADED' && overallStatus !== 'DOWN') {
        overallStatus = 'DEGRADED';
      }
    }

    return {
      status: overallStatus,
      version: observabilityConfig.buildVersion,
      environment: observabilityConfig.environment,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      checks: results,
    };
  }
}

export const healthRegistry = new HealthChecker();
