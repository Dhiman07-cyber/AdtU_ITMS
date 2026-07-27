/**
 * Application Logger — delegated to canonical Observability Foundation.
 */

import { logger } from './observability/logger';

export const appLogger = {
  debug: (component: string, op: string, meta?: Record<string, unknown>) =>
    logger.debug(component, op, meta),
  info: (component: string, op: string, meta?: Record<string, unknown>) =>
    logger.info(component, op, meta),
  warn: (component: string, op: string, meta?: Record<string, unknown>) =>
    logger.warn(component, op, meta),
  error: (component: string, op: string, meta?: Record<string, unknown>) =>
    logger.error(component, op, meta),
};

export { logger };

