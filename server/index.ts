import 'dotenv/config';
import { createServer } from 'http';
import { wsServer } from './websocket-server';
import { logger } from './structured-logger';
import { healthService } from './health-service';
import { metricsService } from './metrics-service';
import { stopOfflineQueue } from './offline-queue';
import { stopRateLimiter } from './rate-limiter';
import { stopMessageValidator } from './message-validator';
import { validateEnvironment } from '../src/lib/env-validator';
import { redisClient } from './redis-client';
import { initRedisBroadcastRelay } from './redis-broadcast';
import { updateLiveBusLocation } from './socket-router';

import { assertPrivilegedTokenSafe } from './authenticator';

const WS_PORT = parseInt(process.env.PORT || process.env.WS_PORT || '3001', 10);
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '9090', 10);

async function main() {
  if (process.env.NODE_ENV === 'production') {
    try {
      assertPrivilegedTokenSafe();
    } catch (err: any) {
      logger.error('startup_blocked_insecure_token', { error: err.message });
      process.exit(1);
    }
  }

  const envCheck = validateEnvironment({ isWebSocketServer: true });
  if (!envCheck.valid && process.env.NODE_ENV === 'production') {
    logger.error('startup_blocked_invalid_environment', { missing: envCheck.missing });
    process.exit(1);
  }
  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    logger.warn('Firebase Admin credentials not found; auth will reject all connections', { port: WS_PORT });
  }

  const server = createServer((req, res) => {
    // Health probe responder on main server port (for Render, Railway, and external keep-alive crons)
    const rawUrl = req.url?.split('?')[0];
    if (rawUrl === '/health' || rawUrl === '/health/live' || rawUrl === '/') {
      const status = healthService.liveness();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(status.status === 'ok' ? 200 : 503);
      res.end(JSON.stringify({ status: status.status, service: 'itms-ws-server', uptime: status.uptime }));
      return;
    }
    if (rawUrl === '/health/ready') {
      const status = healthService.readiness();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(status.status === 'ok' ? 200 : 503);
      res.end(JSON.stringify(status));
      return;
    }
  });
  wsServer.start(server);

  // Connect Redis and initialize cross-node broadcast relay.
  // Graceful: if REDIS_URL is absent, redisClient.connect() returns false
  // and redisPubSub calls become no-ops — single-node mode continues.
  redisClient.connect().then((connected) => {
    if (connected) {
      initRedisBroadcastRelay(
        // onBroadcast: relay received cross-node events to local WS subscribers
        (channel, event, payload) => wsServer.broadcastToChannel(channel, event, payload),
        // onLocationUpdate: keep the in-process live-location cache in sync
        (busId, payload) => updateLiveBusLocation(busId, payload),
      ).catch((err) => {
        logger.warn('redis_broadcast_relay_init_failed', { error: (err as Error).message });
      });
    } else {
      logger.info('redis_not_configured_running_single_node');
    }
  });

  server.listen(WS_PORT, () => {
    logger.info('websocket_runtime_started', { port: WS_PORT });
  });

  const healthServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/health/live') {
      const status = healthService.liveness();
      res.writeHead(status.status === 'ok' ? 200 : 503);
      res.end(JSON.stringify({ status: status.status, uptime: status.uptime }));
    } else if (req.url === '/health/ready') {
      const status = healthService.readiness();
      res.writeHead(status.status === 'ok' ? 200 : 503);
      res.end(JSON.stringify(status));
    } else if (req.url === '/health/startup') {
      healthService.startup().then((status) => {
        res.writeHead(status.status === 'ok' ? 200 : 503);
        res.end(JSON.stringify(status));
      }).catch(() => {
        res.writeHead(503);
        res.end(JSON.stringify({ status: 'error' }));
      });
      return;
    } else if (req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify(healthService.liveness()));
    } else if (req.url === '/metrics') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(200);
      res.end(metricsService.prometheus());
    } else if (req.url === '/metrics/json') {
      res.writeHead(200);
      res.end(JSON.stringify(metricsService.snapshot()));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not_found' }));
    }
  });

  if (HEALTH_PORT !== WS_PORT) {
    healthServer.listen(HEALTH_PORT, () => {
      logger.info('health_server_started', { port: HEALTH_PORT });
    });
  }

  const shutdown = async (signal: string) => {
    logger.info('shutdown_started', { signal, drainTimeout: 30000 });

    healthService.startShutdown();
    healthService.startDraining();

    const drainTimer = setTimeout(() => {
      logger.warn('drain_timeout_reached', { elapsed: healthService.getDrainElapsed() });
      forceExit();
    }, 30000);

    wsServer.shutdown(() => {
      clearTimeout(drainTimer);
      healthService.stopDraining();
      stopOfflineQueue();
      stopRateLimiter();
      stopMessageValidator();
      forceExit();
    });
  };

  const forceExit = () => {
    logger.info('shutdown_complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', { reason: String(reason) });
  });
}

main().catch(err => {
  logger.error('fatal_error', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
