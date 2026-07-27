/**
 * PROGRAM-004 / PHASE-06: Distributed Tracing & OpenTelemetry Engine
 */

import { Span, startSpan, finishSpan, formatW3CTraceparent, parseW3CTraceparent } from '../tracing';
import { TraceContext } from '../types';
import { traceSampler } from './sampler';
import { logger } from '../logger';

export interface RecordedTrace {
  traceId: string;
  rootSpanName: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  spans: Span[];
  hasError: boolean;
  attributes: Record<string, unknown>;
}

export class TraceStore {
  private traces: Map<string, RecordedTrace> = new Map();
  private maxTraces = 1000;

  public recordSpan(span: Span): void {
    const traceId = span.context.traceId;
    let trace = this.traces.get(traceId);

    if (!trace) {
      trace = {
        traceId,
        rootSpanName: span.name,
        startTime: span.startTime,
        spans: [],
        hasError: false,
        attributes: { ...span.attributes }
      };
      this.traces.set(traceId, trace);
      
      // Evict oldest if capacity reached
      if (this.traces.size > this.maxTraces) {
        const oldestKey = this.traces.keys().next().value;
        if (oldestKey) this.traces.delete(oldestKey);
      }
    }

    trace.spans.push(span);
    if (span.status === 'ERROR') {
      trace.hasError = true;
    }

    if (span.endTime) {
      trace.endTime = Math.max(trace.endTime || 0, span.endTime);
      trace.durationMs = trace.endTime - trace.startTime;
    }
  }

  public getTrace(traceId: string): RecordedTrace | undefined {
    return this.traces.get(traceId);
  }

  public searchTraces(query: {
    traceId?: string;
    correlationId?: string;
    hasError?: boolean;
    minDurationMs?: number;
    limit?: number;
  }): RecordedTrace[] {
    let results = Array.from(this.traces.values());

    if (query.traceId) {
      results = results.filter(t => t.traceId === query.traceId);
    }
    if (query.hasError !== undefined) {
      results = results.filter(t => t.hasError === query.hasError);
    }
    if (query.minDurationMs !== undefined) {
      results = results.filter(t => (t.durationMs || 0) >= query.minDurationMs!);
    }

    return results.slice(0, query.limit || 50);
  }

  public getAllTraces(): RecordedTrace[] {
    return Array.from(this.traces.values());
  }
}

export const traceStore = new TraceStore();

export class DistributedTracer {
  /**
   * Traces an async operation, wrapping execution in parent-child spans
   */
  public async traceSpan<T>(
    spanName: string,
    operation: () => Promise<T>,
    parentContext?: TraceContext,
    attributes?: Record<string, unknown>
  ): Promise<T> {
    const span = startSpan(spanName, parentContext);
    if (attributes) {
      span.attributes = { ...span.attributes, ...attributes };
    }

    try {
      const result = await operation();
      finishSpan(span, 'OK');
      if (span.context.sampled) {
        traceStore.recordSpan(span);
      }
      return result;
    } catch (err: any) {
      finishSpan(span, 'ERROR', err instanceof Error ? err : new Error(String(err)));
      if (span.context.sampled || traceSampler.shouldSample(spanName, true)) {
        traceStore.recordSpan(span);
      }
      logger.error('distributed_tracing', 'span_failed', {
        spanName,
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        error: err.message || String(err)
      });
      throw err;
    }
  }

  /**
   * Formats trace spans into OpenTelemetry OTLP JSON payload format for exports
   */
  public exportOTLPJSON(traceId: string): object | null {
    const trace = traceStore.getTrace(traceId);
    if (!trace) return null;

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'itms-platform' } },
              { key: 'telemetry.sdk.language', value: { stringValue: 'typescript' } }
            ]
          },
          scopeSpans: [
            {
              scope: { name: 'itms-tracer', version: '1.0.0' },
              spans: trace.spans.map(s => ({
                traceId: s.context.traceId,
                spanId: s.context.spanId,
                parentSpanId: s.context.parentSpanId || '',
                name: s.name,
                startTimeUnixNano: s.startTime * 1000000,
                endTimeUnixNano: (s.endTime || s.startTime) * 1000000,
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: String(v) }
                })),
                status: { code: s.status === 'ERROR' ? 2 : 1 }
              }))
            }
          ]
        }
      ]
    };
  }
}

export const distributedTracer = new DistributedTracer();
