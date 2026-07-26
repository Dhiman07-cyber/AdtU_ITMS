import { metricsService } from './metrics-service';
import { logger } from './structured-logger';

const SLOW_THRESHOLD = parseInt(process.env.SLOW_HANDLER_MS || '100', 10);

export class PerformanceMonitor {
  start(name: string): () => void {
    const start = Date.now();
    return () => {
      const elapsed = Date.now() - start;
      if (elapsed > SLOW_THRESHOLD) {
        metricsService.inc('slowHandlers');
        logger.warn('slow_handler', { handler: name, elapsedMs: elapsed });
      }
    };
  }
}

export const perfMonitor = new PerformanceMonitor();
