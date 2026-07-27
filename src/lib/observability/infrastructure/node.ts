/**
 * PROGRAM-004 / PHASE-02 Node.js Process & Runtime Collector
 * Measures CPU, Memory (RSS, Heap, Fragmentation), Event Loop Delay, Handles, Timers, Uptime, Signals.
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';
import { metrics } from '../metrics';
import { logger } from '../logger';

export interface NodeProcessMetrics {
  cpuUserUs: number;
  cpuSystemUs: number;
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  heapFragmentationRatio: number;
  eventLoopDelayMinMs: number;
  eventLoopDelayMaxMs: number;
  eventLoopDelayMeanMs: number;
  eventLoopDelayP95Ms: number;
  eventLoopDelayP99Ms: number;
  activeHandlesCount: number;
  activeRequestsCount: number;
  uptimeSeconds: number;
}

class NodeRuntimeCollector {
  private histogramDelay = monitorEventLoopDelay({ resolution: 20 });
  private intervalTimer: NodeJS.Timeout | null = null;
  private startTime = Date.now();
  private lastHeapUsed = 0;
  private heapGrowthRate = 0;

  constructor() {
    this.histogramDelay.enable();
  }

  public collect(): NodeProcessMetrics {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptime = process.uptime();

    const heapUsed = mem.heapUsed;
    const heapTotal = mem.heapTotal;
    const heapFragmentationRatio = heapTotal > 0 ? (heapTotal - heapUsed) / heapTotal : 0;

    // Track heap growth
    if (this.lastHeapUsed > 0) {
      this.heapGrowthRate = heapUsed - this.lastHeapUsed;
    }
    this.lastHeapUsed = heapUsed;

    // Event loop delays in milliseconds
    const minDelay = this.histogramDelay.min / 1e6;
    const maxDelay = this.histogramDelay.max / 1e6;
    const meanDelay = this.histogramDelay.mean / 1e6;
    const p95Delay = this.histogramDelay.percentile(95) / 1e6;
    const p99Delay = this.histogramDelay.percentile(99) / 1e6;

    // Active handles and requests
    const activeHandles = (process as any)._getActiveHandles ? (process as any)._getActiveHandles().length : 0;
    const activeRequests = (process as any)._getActiveRequests ? (process as any)._getActiveRequests().length : 0;

    // Record to metricsRegistry
    metrics.gauge('nodejs_process_cpu_user_seconds', 'Node.js user CPU time in seconds', {}, cpu.user / 1e6);
    metrics.gauge('nodejs_process_cpu_system_seconds', 'Node.js system CPU time in seconds', {}, cpu.system / 1e6);
    metrics.gauge('nodejs_process_resident_memory_bytes', 'Node.js resident set size in bytes', {}, mem.rss);
    metrics.gauge('nodejs_process_heap_total_bytes', 'Node.js heap total in bytes', {}, mem.heapTotal);
    metrics.gauge('nodejs_process_heap_used_bytes', 'Node.js heap used in bytes', {}, mem.heapUsed);
    metrics.gauge('nodejs_process_external_memory_bytes', 'Node.js external memory in bytes', {}, mem.external);
    metrics.gauge('nodejs_process_heap_fragmentation_ratio', 'Node.js heap fragmentation ratio', {}, heapFragmentationRatio);
    metrics.gauge('nodejs_process_heap_growth_bytes', 'Node.js heap growth since last sample', {}, this.heapGrowthRate);

    metrics.gauge('nodejs_event_loop_delay_min_seconds', 'Event loop delay min in seconds', {}, minDelay / 1000.0);
    metrics.gauge('nodejs_event_loop_delay_max_seconds', 'Event loop delay max in seconds', {}, maxDelay / 1000.0);
    metrics.gauge('nodejs_event_loop_delay_mean_seconds', 'Event loop delay mean in seconds', {}, meanDelay / 1000.0);
    metrics.gauge('nodejs_event_loop_delay_p95_seconds', 'Event loop delay P95 in seconds', {}, p95Delay / 1000.0);
    metrics.gauge('nodejs_event_loop_delay_p99_seconds', 'Event loop delay P99 in seconds', {}, p99Delay / 1000.0);

    metrics.gauge('nodejs_active_handles_total', 'Total active handles', {}, activeHandles);
    metrics.gauge('nodejs_active_requests_total', 'Total active requests', {}, activeRequests);
    metrics.gauge('nodejs_process_uptime_seconds', 'Node.js process uptime in seconds', {}, uptime);

    return {
      cpuUserUs: cpu.user,
      cpuSystemUs: cpu.system,
      rssBytes: mem.rss,
      heapTotalBytes: mem.heapTotal,
      heapUsedBytes: mem.heapUsed,
      externalBytes: mem.external,
      heapFragmentationRatio,
      eventLoopDelayMinMs: minDelay,
      eventLoopDelayMaxMs: maxDelay,
      eventLoopDelayMeanMs: meanDelay,
      eventLoopDelayP95Ms: p95Delay,
      eventLoopDelayP99Ms: p99Delay,
      activeHandlesCount: activeHandles,
      activeRequestsCount: activeRequests,
      uptimeSeconds: uptime,
    };
  }

  public startPeriodicCollection(intervalMs = 15000): void {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => {
      try {
        this.collect();
      } catch (err) {
        logger.error('observability', 'node_metrics_collection_failed', { error: String(err) });
      }
    }, intervalMs);
    // Unref so process exit is not blocked
    this.intervalTimer.unref();
  }

  public stopPeriodicCollection(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}

export const nodeRuntimeCollector = new NodeRuntimeCollector();
