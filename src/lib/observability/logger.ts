/**
 * Standardized Logger Framework
 * Emits structured JSON logs with PII redaction and automatic context correlation.
 */

import { SeverityLevel, StructuredLogEntry } from './types';
import { observabilityConfig } from './config';
import { getRequestContext } from './context';

const SEVERITY_WEIGHTS: Record<SeverityLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

function redactMetadata(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Redact JWT patterns
    if (obj.startsWith('eyJ') && obj.includes('.')) {
      return '[REDACTED_JWT]';
    }
    return obj;
  }
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactMetadata(item, depth + 1));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = observabilityConfig.piiRedactionKeys.some((sensitive) =>
      lowerKey.includes(sensitive)
    );

    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactMetadata(value, depth + 1);
    }
  }
  return redacted;
}

function emitLog(
  severity: SeverityLevel,
  component: string,
  operation: string,
  meta?: Record<string, unknown>
): void {
  const currentWeight = SEVERITY_WEIGHTS[observabilityConfig.logLevel];
  const targetWeight = SEVERITY_WEIGHTS[severity];

  if (targetWeight < currentWeight) return;

  const ctx = getRequestContext();
  const safeMeta = (meta ? redactMetadata(meta) : {}) as Record<string, unknown>;

  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    severity,
    service: ctx?.service || observabilityConfig.serviceName,
    component: component || ctx?.component || 'core',
    operation: operation || ctx?.operation || 'unknown',
    correlation_id: ctx?.correlationId || (safeMeta.correlationId as string) || 'none',
    request_id: ctx?.requestId || (safeMeta.requestId as string) || 'none',
    trace_id: ctx?.traceContext?.traceId || (safeMeta.traceId as string) || 'none',
    span_id: ctx?.traceContext?.spanId || (safeMeta.spanId as string) || 'none',
    user_role: ctx?.userRole || (safeMeta.userRole as string),
    user_id: ctx?.userId || (safeMeta.userId as string),
    driver_id: ctx?.driverId || (safeMeta.driverId as string),
    student_id: ctx?.studentId || (safeMeta.studentId as string),
    trip_id: ctx?.tripId || (safeMeta.tripId as string),
    bus_id: ctx?.busId || (safeMeta.busId as string),
    route_id: ctx?.routeId || (safeMeta.routeId as string),
    application_id: ctx?.applicationId || (safeMeta.applicationId as string),
    payment_id: ctx?.paymentId || (safeMeta.paymentId as string),
    notification_id: ctx?.notificationId || (safeMeta.notificationId as string),
    duration_ms: (safeMeta.durationMs as number) ?? (ctx ? Date.now() - ctx.startTime : undefined),
    result: safeMeta.result as StructuredLogEntry['result'],
    error_type: (safeMeta.errorClass as string) || (safeMeta.errorType as string),
    environment: observabilityConfig.environment,
    build_version: observabilityConfig.buildVersion,
    hostname: observabilityConfig.hostname,
    process_id: observabilityConfig.processId,
    thread: 'main',
    ...safeMeta,
  };

  const jsonLine = JSON.stringify(entry);

  if (severity === 'ERROR' || severity === 'FATAL') {
    console.error(jsonLine);
  } else if (severity === 'WARN') {
    console.warn(jsonLine);
  } else {
    console.log(jsonLine);
  }
}

export const logger = {
  trace: (component: string, operation: string, meta?: Record<string, unknown>) =>
    emitLog('TRACE', component, operation, meta),
  debug: (component: string, operation: string, meta?: Record<string, unknown>) =>
    emitLog('DEBUG', component, operation, meta),
  info: (component: string, operation: string, meta?: Record<string, unknown>) =>
    emitLog('INFO', component, operation, meta),
  warn: (component: string, operation: string, meta?: Record<string, unknown>) =>
    emitLog('WARN', component, operation, meta),
  error: (component: string, operation: string, meta?: Record<string, unknown>) =>
    emitLog('ERROR', component, operation, meta),
  fatal: (component: string, operation: string, meta?: Record<string, unknown>) =>
    emitLog('FATAL', component, operation, meta),
};
