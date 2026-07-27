import { logger as canonicalLogger } from '../src/lib/observability/logger';

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => canonicalLogger.debug('websocket', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => canonicalLogger.info('websocket', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => canonicalLogger.warn('websocket', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => canonicalLogger.error('websocket', msg, meta),
};

