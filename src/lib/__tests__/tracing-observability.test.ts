import { describe, it, expect } from 'vitest';
import { distributedTracer, traceStore } from '../observability/tracing/tracer';
import { diagnosticsEngine } from '../observability/tracing/root-cause';
import { startSpan } from '../observability/tracing';

describe('Distributed Tracing & Diagnostics Platform', () => {
  it('should wrap async operations in trace spans', async () => {
    const result = await distributedTracer.traceSpan('test-operation', async () => {
      return 42;
    }, undefined, { userId: 'user-123' });

    expect(result).toBe(42);
    const traces = traceStore.getAllTraces();
    expect(traces.length).toBeGreaterThan(0);
  });

  it('should record trace spans and compute latency breakdown', async () => {
    const parentSpan = startSpan('http.api.trip.start');
    const parentCtx = parentSpan.context;

    await distributedTracer.traceSpan('db.query.trip_lock', async () => {
      return true;
    }, parentCtx);

    const breakdown = diagnosticsEngine.analyzeLatency(parentCtx.traceId);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.spansBreakdown.length).toBeGreaterThan(0);
  });

  it('should perform root cause diagnosis on failing traces', async () => {
    const rootSpan = startSpan('http.api.payment.verify');
    const parentCtx = rootSpan.context;

    try {
      await distributedTracer.traceSpan('razorpay.api.verify', async () => {
        throw new Error('Razorpay Signature Verification Mismatch');
      }, parentCtx);
    } catch (err) {
      // Expected exception
    }

    const diagnosis = diagnosticsEngine.diagnoseRootCause(parentCtx.traceId);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis?.rootCauseSpan).toBe('razorpay.api.verify');
    expect(diagnosis?.errorMessage).toContain('Signature Verification Mismatch');
  });

  it('should generate live Service Map graph', () => {
    const serviceMap = diagnosticsEngine.generateServiceMap();

    expect(serviceMap.nodes.length).toBeGreaterThan(0);
    expect(serviceMap.edges.length).toBeGreaterThan(0);
    expect(serviceMap.nodes.some(n => n.id === 'supabase-db')).toBe(true);
  });

  it('should format OpenTelemetry OTLP JSON payload for exports', async () => {
    const rootSpan = startSpan('http.api.test');
    const parentCtx = rootSpan.context;

    await distributedTracer.traceSpan('service.sub_operation', async () => {
      return true;
    }, parentCtx);

    const otlp = distributedTracer.exportOTLPJSON(parentCtx.traceId);
    expect(otlp).not.toBeNull();
    expect(otlp).toHaveProperty('resourceSpans');
  });
});
