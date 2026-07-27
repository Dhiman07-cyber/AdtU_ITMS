/**
 * Correlation ID & Request Context Framework
 * Uses AsyncLocalStorage to propagate context across asynchronous operations.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { RequestContext, TraceContext } from './types';
import { observabilityConfig } from './config';

const contextStorage = new AsyncLocalStorage<RequestContext>();

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return randomUUID();
}

export function generateTraceId(): string {
  return generateUUID().replace(/-/g, '');
}

export function generateSpanId(): string {
  return generateUUID().replace(/-/g, '').slice(0, 16);
}

export function createInitialContext(overrides?: Partial<RequestContext>): RequestContext {
  const correlationId = overrides?.correlationId || generateUUID();
  const requestId = overrides?.requestId || generateUUID();
  const traceId = overrides?.traceContext?.traceId || generateTraceId();
  const spanId = overrides?.traceContext?.spanId || generateSpanId();

  const traceContext: TraceContext = {
    traceId,
    spanId,
    parentSpanId: overrides?.traceContext?.parentSpanId,
    sampled: overrides?.traceContext?.sampled ?? true,
    baggage: overrides?.traceContext?.baggage || {},
  };

  return {
    correlationId,
    requestId,
    traceContext,
    service: overrides?.service || observabilityConfig.serviceName,
    component: overrides?.component || 'core',
    operation: overrides?.operation || 'unknown',
    userId: overrides?.userId,
    userRole: overrides?.userRole,
    driverId: overrides?.driverId,
    studentId: overrides?.studentId,
    tripId: overrides?.tripId,
    busId: overrides?.busId,
    routeId: overrides?.routeId,
    applicationId: overrides?.applicationId,
    paymentId: overrides?.paymentId,
    notificationId: overrides?.notificationId,
    startTime: overrides?.startTime || Date.now(),
    environment: observabilityConfig.environment,
    buildVersion: observabilityConfig.buildVersion,
    hostname: observabilityConfig.hostname,
    processId: observabilityConfig.processId,
  };
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return contextStorage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return contextStorage.getStore();
}

export function updateRequestContext(updates: Partial<RequestContext>): void {
  const current = contextStorage.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}
