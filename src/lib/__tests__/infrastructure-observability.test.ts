/**
 * PROGRAM-004 / PHASE-02 Infrastructure Observability Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { nodeRuntimeCollector } from '../observability/infrastructure/node';
import { nextjsRuntimeCollector } from '../observability/infrastructure/nextjs';
import { webSocketRuntimeCollector } from '../observability/infrastructure/websocket';
import { supabaseInfrastructureCollector, observeSupabaseQuery } from '../observability/infrastructure/supabase';
import { redisInfrastructureCollector } from '../observability/infrastructure/redis';
import { firebaseInfrastructureCollector } from '../observability/infrastructure/firebase';
import { resilienceCollector } from '../observability/infrastructure/resilience';
import { metricsRegistry } from '../observability/metrics';

describe('Infrastructure Observability Framework', () => {
  it('nodeRuntimeCollector emits process metrics', () => {
    const stats = nodeRuntimeCollector.collect();
    expect(stats.rssBytes).toBeGreaterThan(0);
    expect(stats.heapTotalBytes).toBeGreaterThan(0);
    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('nextjsRuntimeCollector records cold start and cache hits', () => {
    const firstCall = nextjsRuntimeCollector.recordColdStart();
    const secondCall = nextjsRuntimeCollector.recordColdStart();
    expect(firstCall).toBe(true);
    expect(secondCall).toBe(false);

    expect(() => nextjsRuntimeCollector.recordCacheHit('isr')).not.toThrow();
  });

  it('webSocketRuntimeCollector tracks connection lifecycle and broadcast fanout', () => {
    webSocketRuntimeCollector.recordConnectionOpen('driver');
    webSocketRuntimeCollector.recordBroadcast('bus_location_1', 15, 12);
    webSocketRuntimeCollector.recordHeartbeat(15);
    webSocketRuntimeCollector.recordConnectionClose(1000);

    const prometheusText = metricsRegistry.toPrometheusFormat();
    expect(prometheusText).toContain('itms_websocket_connections_opened_total');
    expect(prometheusText).toContain('itms_websocket_broadcasts_total');
  });

  it('observeSupabaseQuery wraps query execution and records duration', async () => {
    const data = await observeSupabaseQuery('buses', 'select', async () => {
      return [{ id: 'b1' }];
    });
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('b1');
  });

  it('redisInfrastructureCollector records command latency and cache hits', () => {
    redisInfrastructureCollector.recordCommand('get', 4, true);
    redisInfrastructureCollector.recordCacheHit('session_cache');

    const json = metricsRegistry.getMetricsJSON();
    const redisMetric = json.find((m) => m.name === 'itms_redis_operations_total');
    expect(redisMetric).toBeDefined();
  });

  it('firebaseInfrastructureCollector records token verification latency', () => {
    firebaseInfrastructureCollector.recordTokenVerification(25, true);
    firebaseInfrastructureCollector.recordFcmDispatch('TRIP_STARTED', 50, 120, true);

    const text = metricsRegistry.toPrometheusFormat();
    expect(text).toContain('itms_firebase_token_verifications_total');
    expect(text).toContain('itms_firebase_fcm_dispatches_total');
  });

  it('resilienceCollector generates valid self-diagnostics', () => {
    const diag = resilienceCollector.getSelfDiagnostics();
    expect(diag.service).toBeTruthy();
    expect(diag.version).toBeTruthy();
    expect(diag.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
