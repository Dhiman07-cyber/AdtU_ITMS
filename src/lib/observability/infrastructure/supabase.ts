/**
 * PROGRAM-004 / PHASE-02 PostgreSQL / Supabase Infrastructure Collector
 * Measures query duration, P50/P95/P99 latency, slow queries, RPC calls, pool exhaustion, connection errors.
 */

import { metrics } from '../metrics';
import { logger } from '../logger';

class SupabaseInfrastructureCollector {
  public recordQuery(table: string, operation: string, durationMs: number, success: boolean, error?: string): void {
    const durationSec = durationMs / 1000.0;
    metrics.counter('database_queries_total', 'Total Supabase database queries', {
      table,
      operation,
      result: success ? 'success' : 'failure',
    });

    metrics.timer('database_query_duration_seconds', 'Supabase query duration in seconds', durationMs, {
      table,
      operation,
    });

    // Detect slow query (>200ms threshold)
    if (durationMs > 200) {
      metrics.counter('database_slow_queries_total', 'Total slow database queries (>200ms)', {
        table,
        operation,
      });
      logger.warn('database', 'slow_query_detected', {
        table,
        operation,
        durationMs,
      });
    }

    if (!success) {
      metrics.counter('database_query_errors_total', 'Total database query errors', {
        table,
        operation,
        error_type: error || 'unknown',
      });
    }
  }

  public recordRpc(rpcName: string, durationMs: number, success: boolean): void {
    metrics.counter('database_rpc_calls_total', 'Total RPC procedure calls', {
      rpc: rpcName,
      result: success ? 'success' : 'failure',
    });

    metrics.timer('database_rpc_duration_seconds', 'RPC procedure duration in seconds', durationMs, {
      rpc: rpcName,
    });
  }

  public recordPoolExhaustion(): void {
    metrics.counter('database_pool_exhaustions_total', 'Total database connection pool exhaustions');
    logger.error('database', 'pool_exhaustion_detected');
  }

  public recordConnectionError(reason: string): void {
    metrics.counter('database_connection_errors_total', 'Total database connection errors', { reason });
  }
}

export const supabaseInfrastructureCollector = new SupabaseInfrastructureCollector();

/**
 * Higher-order helper to wrap Supabase queries with infrastructure observability safely.
 */
export async function observeSupabaseQuery<T>(
  table: string,
  operation: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await queryFn();
    const durationMs = Date.now() - start;
    supabaseInfrastructureCollector.recordQuery(table, operation, durationMs, true);
    return result;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    supabaseInfrastructureCollector.recordQuery(table, operation, durationMs, false, err.message || String(err));
    throw err;
  }
}
