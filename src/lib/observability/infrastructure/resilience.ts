/**
 * PROGRAM-004 / PHASE-02 Resilience, Queue Depth, Security & Runtime Self-Diagnostics
 */

import { metrics } from '../metrics';
import { observabilityConfig } from '../config';
import { healthRegistry } from '../health';

export interface RuntimeSelfDiagnostics {
  service: string;
  version: string;
  environment: string;
  hostname: string;
  processId: number;
  uptimeSeconds: number;
  memoryRssMb: number;
  heapUsedMb: number;
  featureFlags: Record<string, boolean>;
  registeredMetricsCount: number;
}

class ResilienceCollector {
  public recordQueueDepth(queueName: string, depth: number, oldestAgeMs = 0): void {
    metrics.gauge('queue_depth', 'Queue depth gauge', { queue: queueName }, depth);
    metrics.gauge('queue_oldest_item_age_seconds', 'Age of oldest queue item in seconds', { queue: queueName }, oldestAgeMs / 1000.0);
  }

  public recordQueueDrop(queueName: string, droppedCount = 1, reason = 'overflow'): void {
    metrics.counter('queue_dropped_items_total', 'Total dropped queue items', { queue: queueName, reason }, droppedCount);
  }

  public recordSecurityEvent(eventType: 'rate_limit' | 'replay' | 'invalid_token' | 'malformed_payload' | 'auth_failure', sourceIp?: string): void {
    metrics.counter('security_events_total', 'Total security events detected', { type: eventType });
  }

  public getSelfDiagnostics(): RuntimeSelfDiagnostics {
    const mem = process.memoryUsage();
    return {
      service: observabilityConfig.serviceName,
      version: observabilityConfig.buildVersion,
      environment: observabilityConfig.environment,
      hostname: observabilityConfig.hostname,
      processId: observabilityConfig.processId,
      uptimeSeconds: process.uptime(),
      memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      featureFlags: {
        tracingEnabled: observabilityConfig.tracingEnabled,
        isProduction: observabilityConfig.environment === 'production',
      },
      registeredMetricsCount: metricsRegistryCount(),
    };
  }
}

function metricsRegistryCount(): number {
  try {
    const { metricsRegistry } = require('../metrics');
    return metricsRegistry.getMetricsJSON().length;
  } catch {
    return 0;
  }
}

export const resilienceCollector = new ResilienceCollector();
