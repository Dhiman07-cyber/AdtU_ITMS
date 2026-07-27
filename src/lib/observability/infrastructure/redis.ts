/**
 * PROGRAM-004 / PHASE-02 Redis Infrastructure Collector
 * Instrumenting connections, command latency, cache hit/miss ratio, memory, evictions, pub/sub.
 */

import { metrics } from '../metrics';

class RedisInfrastructureCollector {
  public recordCommand(command: string, durationMs: number, success: boolean): void {
    metrics.counter('redis_operations_total', 'Total Redis operations', {
      command,
      result: success ? 'success' : 'failure',
    });

    metrics.timer('redis_operation_duration_seconds', 'Redis operation duration', durationMs, {
      command,
    });
  }

  public recordCacheHit(cacheName: string): void {
    metrics.counter('redis_cache_hits_total', 'Total Redis cache hits', { cache: cacheName });
  }

  public recordCacheMiss(cacheName: string): void {
    metrics.counter('redis_cache_misses_total', 'Total Redis cache misses', { cache: cacheName });
  }

  public recordConnectionEvent(event: 'connect' | 'disconnect' | 'reconnect' | 'error', detail?: string): void {
    metrics.counter('redis_connection_events_total', 'Total Redis connection events', {
      event,
      detail: detail || 'none',
    });
  }

  public recordPubSubMessage(channel: string): void {
    metrics.counter('redis_pubsub_messages_total', 'Total Redis Pub/Sub messages dispatched', { channel });
  }

  public recordMemoryUsage(usedBytes: number, peakBytes?: number): void {
    metrics.gauge('redis_memory_used_bytes', 'Redis used memory in bytes', {}, usedBytes);
    if (peakBytes) {
      metrics.gauge('redis_memory_peak_bytes', 'Redis peak memory in bytes', {}, peakBytes);
    }
  }

  public recordEviction(count = 1): void {
    metrics.counter('redis_evicted_keys_total', 'Total Redis evicted keys', {}, count);
  }
}

export const redisInfrastructureCollector = new RedisInfrastructureCollector();
