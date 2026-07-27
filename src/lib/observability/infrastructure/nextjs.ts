/**
 * PROGRAM-004 / PHASE-02 Next.js Runtime Collector
 * Measures Next.js server startup, cold start, route execution, SSR/ISR timing, cache hit/miss ratio.
 */

import { metrics } from '../metrics';
import { observabilityConfig } from '../config';

class NextJSRuntimeCollector {
  private startupTime = Date.now();
  private isColdStart = true;

  constructor() {
    this.recordStartupInfo();
  }

  private recordStartupInfo(): void {
    metrics.gauge('nextjs_server_startup_timestamp', 'Next.js server boot timestamp', {}, this.startupTime);
    metrics.gauge('nextjs_build_version_info', 'Next.js build version info', {
      version: observabilityConfig.buildVersion,
      environment: observabilityConfig.environment,
    }, 1);
  }

  public recordColdStart(): boolean {
    if (this.isColdStart) {
      this.isColdStart = false;
      metrics.counter('nextjs_cold_starts_total', 'Total Next.js cold starts', {
        environment: observabilityConfig.environment,
      });
      return true;
    }
    return false;
  }

  public recordSsrDuration(route: string, durationMs: number): void {
    metrics.timer('nextjs_ssr_duration_seconds', 'Next.js SSR render duration', durationMs, { route });
  }

  public recordMiddlewareDuration(durationMs: number): void {
    metrics.timer('nextjs_middleware_duration_seconds', 'Next.js middleware duration', durationMs);
  }

  public recordCacheHit(cacheType: 'isr' | 'data' | 'static'): void {
    metrics.counter('nextjs_cache_hits_total', 'Total Next.js cache hits', { cache_type: cacheType });
  }

  public recordCacheMiss(cacheType: 'isr' | 'data' | 'static'): void {
    metrics.counter('nextjs_cache_misses_total', 'Total Next.js cache misses', { cache_type: cacheType });
  }

  public recordIsrRevalidation(route: string, success: boolean): void {
    metrics.counter('nextjs_isr_revalidations_total', 'Total ISR revalidations', {
      route,
      result: success ? 'success' : 'failure',
    });
  }
}

export const nextjsRuntimeCollector = new NextJSRuntimeCollector();
