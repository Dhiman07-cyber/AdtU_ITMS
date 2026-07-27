import type WebSocket from 'ws';
import type { Session } from './session-manager';
import { sessionManager } from './session-manager';
import { subscriptionManager } from './subscription-manager';
import { runMiddlewareChain } from './socket-middleware';
import { metricsService } from './metrics-service';
import { logger } from './structured-logger';
import { perfMonitor } from './performance-monitor';
import { wsServer } from './websocket-server';

type MessageHandler = (ws: WebSocket, session: Session, payload: any) => void;

const handlers = new Map<string, MessageHandler>();

export function handle(type: string, handler: MessageHandler): void {
  handlers.set(type, handler);
}

export function routeMessage(ws: WebSocket, session: Session, raw: string): void {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    send(ws, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  const { type, ...payload } = parsed;
  if (!type || typeof type !== 'string') {
    send(ws, { type: 'error', message: 'Message must have a "type" field' });
    return;
  }

  const proceed = runMiddlewareChain(ws, session, parsed);
  if (!proceed) return;

  const handler = handlers.get(type);
  if (!handler) {
    send(ws, { type: 'error', message: `Unknown message type: ${type}` });
    return;
  }

  const done = perfMonitor.start(`handler:${type}`);
  try {
    handler(ws, session, payload);
  } catch (err) {
    metricsService.inc('errors');
    logger.error('handler_error', { type, uid: session.uid, error: (err as Error).message });
    send(ws, { type: 'error', message: 'Internal error' });
  }
  done();
}

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
    metricsService.inc('messagesSent');
  }
}

handle('subscribe', (ws, session, payload) => {
  const channel = payload.channel as string | undefined;
  if (!channel) { send(ws, { type: 'error', message: 'subscribe requires "channel"' }); return; }
  subscriptionManager.subscribe(session.socketId, channel, ws, session);
  logger.debug('subscribe', { uid: session.uid, socketId: session.socketId, channel });
  send(ws, { type: 'subscribed', channel });
});

handle('unsubscribe', (ws, session, payload) => {
  const channel = payload.channel as string | undefined;
  if (!channel) { send(ws, { type: 'error', message: 'unsubscribe requires "channel"' }); return; }
  subscriptionManager.unsubscribe(session.socketId, channel, session);
  logger.debug('unsubscribe', { uid: session.uid, socketId: session.socketId, channel });
  send(ws, { type: 'unsubscribed', channel });
});

handle('pong', (ws, session) => {
  sessionManager.updateHeartbeat(session.socketId);
});

handle('presence', (ws, session, payload) => {
  if (payload.busId && typeof payload.busId === 'string' && payload.busId.trim()) sessionManager.setBusId(session.socketId, payload.busId.trim());
  if (payload.tripId && typeof payload.tripId === 'string' && payload.tripId.trim()) sessionManager.setTripId(session.socketId, payload.tripId.trim());
  if (payload.routeId && typeof payload.routeId === 'string' && payload.routeId.trim()) sessionManager.setRouteId(session.socketId, payload.routeId.trim());
  logger.debug('presence', { uid: session.uid, socketId: session.socketId, busId: payload.busId, tripId: payload.tripId, routeId: payload.routeId });
  send(ws, { type: 'presence_ok' });
});

handle('broadcast', (ws, session, payload) => {
  if (session.role !== 'server') {
    send(ws, { type: 'error', message: 'Only server can broadcast' });
    return;
  }
  const channel = payload.channel as string;
  const event = payload.event as string;
  if (!channel || !event) {
    send(ws, { type: 'error', message: 'broadcast requires "channel" and "event"' });
    return;
  }
  wsServer.broadcastToChannel(channel, event, (payload.payload || {}) as Record<string, unknown>);
});

export { send as sendToSocket };
