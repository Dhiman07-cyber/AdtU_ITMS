import { WebSocketServer as WsServer } from 'ws';
import type { Server } from 'http';
import { authenticateSocket } from './authenticator';
import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { subscriptionManager } from './subscription-manager';
import { heartbeatService } from './heartbeat-service';
import { connectionCleanupService } from './connection-cleanup-service';
import { routeMessage, sendToSocket } from './socket-router';
import { metricsService } from './metrics-service';
import { logger } from './structured-logger';
import { encode as encodeMsg } from './socket-encoder';
import { decode } from './socket-decoder';
import { checkRateLimit, clearRateLimitsFor } from './rate-limiter';
import { validatePayload, checkReplay } from './message-validator';
import { healthService } from './health-service';
import { enqueueOffline, drainQueue } from './offline-queue';
import crypto from 'crypto';

const MAX_BATCH_SIZE = parseInt(process.env.BROADCAST_BATCH_SIZE || '100', 10);

export class WebSocketServer {
  private wss: WsServer | null = null;
  private shuttingDown = false;

  start(server: Server): void {
    this.wss = new WsServer({ server, path: '/ws' });

    this.wss.on('connection', async (ws, request) => {
      if (healthService.isShuttingDown()) {
        ws.close(4003, 'Server shutting down');
        return;
      }

      const socketId = crypto.randomUUID();
      const ip = request.socket?.remoteAddress || 'unknown';

      const auth = await authenticateSocket(request);
      if (!auth.authenticated) {
        sendToSocket(ws, { type: 'auth_required', message: auth.error || 'Authentication required' });
        ws.close(4001, 'Authentication failed');
        metricsService.inc('connectionsRejected');
        metricsService.inc('authFailures');
        return;
      }

      metricsService.inc('authSuccesses');

      const isReconnect = request.url?.includes('reconnect_token=');
      let session;

      if (isReconnect) {
        const url = new URL(request.url || '/', 'http://localhost');
        const reconnectToken = url.searchParams.get('reconnect_token');
        if (reconnectToken) {
          const restored = sessionManager.restoreSession(reconnectToken, socketId);
          if (restored) {
            session = restored;
            metricsService.inc('reconnectsHandled');
            logger.info('session_restored', { uid: auth.uid, socketId });
          }
        }
      }

      if (!session) {
        session = sessionManager.create({ socketId, uid: auth.uid!, role: auth.role || 'unknown', ip });
      }

      connectionRegistry.register(socketId, ws, session);
      sendToSocket(ws, { type: 'auth_ok', data: { uid: auth.uid, role: auth.role } });

      logger.info('audit', { action: 'connected', uid: auth.uid!, role: auth.role || 'unknown', socketId, ip });

      drainQueue(socketId, (channel, event, payload) => {
        sendToSocket(ws, { type: 'message', channel, event, payload });
      });

      ws.on('message', (data) => {
        if (this.shuttingDown) {
          ws.close(4003, 'Server shutting down');
          return;
        }

        const raw = data.toString();

        const validation = validatePayload(raw);
        if (!validation.valid) {
          metricsService.inc('invalidMessages');
          sendToSocket(ws, { type: 'error', message: validation.error || 'Invalid message' });
          return;
        }

        if (!checkRateLimit(ip, auth.uid!, socketId)) {
          metricsService.inc('rateLimitBlocks');
          metricsService.inc('errors');
          sendToSocket(ws, { type: 'error', message: 'Rate limit exceeded' });
          return;
        }

        const decoded = decode(raw);
        if (!decoded) {
          metricsService.inc('invalidMessages');
          sendToSocket(ws, { type: 'error', message: 'Invalid message' });
          return;
        }

        if (decoded.type === 'broadcast' && session.role === 'server') {
          if (decoded.nonce && !checkReplay(decoded.nonce as string)) {
            metricsService.inc('replayDetected');
            sendToSocket(ws, { type: 'error', message: 'Replay detected' });
            return;
          }
        }

        metricsService.inc('messagesReceived');
        routeMessage(ws, session, raw);
      });

      ws.on('close', () => {
        connectionCleanupService.cleanup(socketId);
        clearRateLimitsFor(socketId);
        logger.info('audit', { action: 'disconnected', uid: auth.uid!, role: auth.role || 'unknown', socketId, ip });
      });

      ws.on('error', () => {
        connectionCleanupService.cleanup(socketId);
        clearRateLimitsFor(socketId);
        metricsService.inc('errors');
      });

      metricsService.inc('connectionsAccepted');
    });

    heartbeatService.start();
  }

  broadcastToChannel(channel: string, event: string, payload: Record<string, unknown>): void {
    const subscriberIds = subscriptionManager.getSubscribers(channel);
    const msg = encodeMsg({ type: 'message', channel, event, payload });
    let sent = 0;

    for (let i = 0; i < subscriberIds.length; i += MAX_BATCH_SIZE) {
      const batch = subscriberIds.slice(i, i + MAX_BATCH_SIZE);
      for (const socketId of batch) {
        const entry = connectionRegistry.get(socketId);
        if (entry && entry.ws.readyState === entry.ws.OPEN) {
          entry.ws.send(msg);
          sent++;
        } else if (entry) {
          enqueueOffline(socketId, channel, event, payload);
        }
      }
    }

    metricsService.inc('messagesSent', sent);
    metricsService.inc('broadcastsSent');
  }

  broadcastToChannels(channels: string[], event: string, payload: Record<string, unknown>): void {
    for (const channel of channels) {
      this.broadcastToChannel(channel, event, payload);
    }
  }

  shutdown(callback?: () => void): void {
    this.shuttingDown = true;
    heartbeatService.stop();

    if (this.wss) {
      this.wss.clients.forEach(client => {
        client.close(4003, 'Server shutting down');
      });
      this.wss.close(() => {
        connectionCleanupService.cleanupAll();
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  get wssInstance() { return this.wss; }
}

export const wsServer = new WebSocketServer();
