/**
 * Trace Context & Span Context Framework (OpenTelemetry Ready)
 */

import { TraceContext } from './types';
import { generateSpanId, generateTraceId, getRequestContext } from './context';

export interface Span {
  name: string;
  context: TraceContext;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
  status: 'OK' | 'ERROR' | 'UNSET';
  error?: Error;
}

export function startSpan(name: string, parentContext?: TraceContext): Span {
  const activeCtx = getRequestContext();
  const baseTraceContext = parentContext || activeCtx?.traceContext;

  const traceId = baseTraceContext?.traceId || generateTraceId();
  const parentSpanId = baseTraceContext?.spanId;
  const spanId = generateSpanId();

  const context: TraceContext = {
    traceId,
    spanId,
    parentSpanId,
    sampled: baseTraceContext?.sampled ?? true,
    baggage: { ...(baseTraceContext?.baggage || {}) },
  };

  return {
    name,
    context,
    startTime: Date.now(),
    attributes: {},
    events: [],
    status: 'UNSET',
  };
}

export function finishSpan(span: Span, status: 'OK' | 'ERROR' = 'OK', error?: Error): void {
  span.endTime = Date.now();
  span.status = status;
  if (error) {
    span.error = error;
    span.attributes.errorName = error.name;
    span.attributes.errorMessage = error.message;
  }
}

export function formatW3CTraceparent(context: TraceContext): string {
  const version = '00';
  const traceId = context.traceId.padStart(32, '0');
  const spanId = context.spanId.padStart(16, '0');
  const flags = context.sampled ? '01' : '00';
  return `${version}-${traceId}-${spanId}-${flags}`;
}

export function parseW3CTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length < 4) return null;
  const [, traceId, spanId, flagsStr] = parts;
  const flags = parseInt(flagsStr, 16);
  return {
    traceId,
    spanId,
    sampled: (flags & 1) === 1,
  };
}
