/**
 * PROGRAM-004 / PHASE-03 Domain Service Observer
 * Higher-order wrapper to instrument domain service calls with execution timing,
 * success/failure metrics, error classification, and correlation ID propagation.
 */

import { metrics } from '../metrics';
import { logger } from '../logger';
import { classifyError } from '../errors';
import { getRequestContext } from '../context';

export async function observeDomainService<T>(
  domain: string,
  operation: string,
  serviceFn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  const ctx = getRequestContext();

  metrics.counter('domain_service_calls_total', 'Total domain service calls', { domain, operation });

  try {
    const result = await serviceFn();
    const durationMs = Date.now() - start;

    metrics.timer('domain_service_duration_seconds', 'Domain service duration', durationMs, { domain, operation });
    metrics.counter('domain_service_success_total', 'Total successful domain service calls', { domain, operation });

    logger.info(domain, `${operation}_completed`, {
      durationMs,
      result: 'SUCCESS',
      correlationId: ctx?.correlationId,
      ...meta,
    });

    return result;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const classified = classifyError(err);

    metrics.timer('domain_service_duration_seconds', 'Domain service duration', durationMs, { domain, operation });
    metrics.counter('domain_service_failures_total', 'Total failed domain service calls', {
      domain,
      operation,
      error_type: classified.errorClass,
    });

    logger.error(domain, `${operation}_failed`, {
      durationMs,
      result: 'FAILURE',
      errorClass: classified.errorClass,
      errorMessage: classified.message,
      correlationId: ctx?.correlationId,
      ...meta,
    });

    throw err;
  }
}
