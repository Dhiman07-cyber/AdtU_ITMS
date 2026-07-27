/**
 * Middleware Foundation for Observability
 * Wraps HTTP API Routes, WebSocket events, Cron Jobs, and Background Workers
 * to automatically assign correlation IDs, start timers, capture errors, and emit diagnostics.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createInitialContext, runWithContext } from './context';
import { logger } from './logger';
import { metrics } from './metrics';
import { observabilityConfig } from './config';
import { classifyError } from './errors';

export function withObservability<T extends (...args: any[]) => Promise<NextResponse | Response>>(
  handler: T,
  options?: { component?: string; operation?: string }
): T {
  return (async (req: NextRequest, ...args: any[]) => {
    const correlationId =
      req.headers.get(observabilityConfig.correlationHeader) ||
      req.headers.get('x-request-id') ||
      undefined;

    const traceHeader = req.headers.get(observabilityConfig.traceHeader) || undefined;

    const ctx = createInitialContext({
      correlationId,
      component: options?.component || 'api',
      operation: options?.operation || req.nextUrl?.pathname || 'http_request',
      service: observabilityConfig.serviceName,
      traceContext: traceHeader
        ? {
            traceId: traceHeader.split('-')[1] || '',
            spanId: traceHeader.split('-')[2] || '',
            sampled: true,
          }
        : undefined,
    });

    return runWithContext(ctx, async () => {
      const startTime = Date.now();
      logger.info(ctx.component, `${ctx.operation}_started`, {
        method: req.method,
        path: req.nextUrl?.pathname,
      });

      try {
        const response = await handler(req, ...args);
        const durationMs = Date.now() - startTime;
        const status = response.status || 200;

        metrics.recordApiRequest(req.method, req.nextUrl?.pathname || 'unknown', status, durationMs);

        logger.info(ctx.component, `${ctx.operation}_completed`, {
          method: req.method,
          path: req.nextUrl?.pathname,
          status,
          durationMs,
          result: status < 400 ? 'SUCCESS' : 'FAILURE',
        });

        // Set response headers for correlation propagation
        response.headers.set(observabilityConfig.correlationHeader, ctx.correlationId);
        response.headers.set(observabilityConfig.requestIdHeader, ctx.requestId);

        return response;
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const classified = classifyError(err);

        metrics.recordApiRequest(req.method, req.nextUrl?.pathname || 'unknown', 500, durationMs);
        metrics.counter('api_errors_total', 'Total HTTP API errors', {
          method: req.method,
          route: req.nextUrl?.pathname || 'unknown',
          error_type: classified.errorClass,
        });

        logger.error(ctx.component, `${ctx.operation}_failed`, {
          method: req.method,
          path: req.nextUrl?.pathname,
          durationMs,
          result: 'FAILURE',
          errorType: classified.errorClass,
          errorMessage: classified.message,
          stack: classified.stack,
        });

        throw err;
      }
    });
  }) as T;
}

export function wrapCronJob<T>(jobName: string, jobFn: () => Promise<T>): Promise<T> {
  const ctx = createInitialContext({
    component: 'cron',
    operation: jobName,
  });

  return runWithContext(ctx, async () => {
    const startTime = Date.now();
    logger.info('cron', 'job_started', { jobName });
    metrics.counter('cron_execution_total', 'Total cron job executions', { job_name: jobName });

    try {
      const result = await jobFn();
      const durationMs = Date.now() - startTime;

      metrics.timer('cron_execution_duration_seconds', 'Cron execution duration', durationMs, { job_name: jobName });
      logger.info('cron', 'job_completed', { jobName, durationMs, result: 'SUCCESS' });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const classified = classifyError(err);

      metrics.counter('cron_failures_total', 'Total cron job failures', { job_name: jobName });
      logger.error('cron', 'job_failed', {
        jobName,
        durationMs,
        result: 'FAILURE',
        errorType: classified.errorClass,
        errorMessage: classified.message,
      });
      throw err;
    }
  });
}
