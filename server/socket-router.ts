import type WebSocket from 'ws';
import type { Session } from './session-manager';
import { sessionManager } from './session-manager';
import { subscriptionManager } from './subscription-manager';
import { runMiddlewareChain } from './socket-middleware';
import { metricsService } from './metrics-service';
import { logger } from './structured-logger';
import { perfMonitor } from './performance-monitor';
import { wsServer } from './websocket-server';
import { publishToRedis } from './redis-broadcast';

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

const liveBusLocations = new Map<string, Record<string, unknown>>();

export function updateLiveBusLocation(busId: string, location: Record<string, unknown>): void {
  if (busId) liveBusLocations.set(busId, location);
}

export function clearLiveBusLocation(busId: string): void {
  if (busId) liveBusLocations.delete(busId);
}

export function getLiveBusLocation(busId: string): Record<string, unknown> | undefined {
  return liveBusLocations.get(busId);
}

handle('subscribe', (ws, session, payload) => {
  const channel = payload.channel as string | undefined;
  if (!channel) { send(ws, { type: 'error', message: 'subscribe requires "channel"' }); return; }
  subscriptionManager.subscribe(session.socketId, channel, ws, session);
  logger.debug('subscribe', { uid: session.uid, socketId: session.socketId, channel });
  send(ws, { type: 'subscribed', channel });

  // Immediate initial location push for newly subscribed clients
  const busIdMatch = channel.match(/^(?:bus:|bus_location_)(.+)$/);
  if (busIdMatch) {
    const busId = busIdMatch[1];
    const cachedLoc = getLiveBusLocation(busId);
    if (cachedLoc) {
      send(ws, { type: 'message', channel, event: 'bus_location_update', payload: cachedLoc });
    }
  }
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

handle('location_update', (ws, session, payload) => {
  // SECURITY: Only drivers may publish GPS location updates.
  // Students, moderators and other roles are rejected immediately.
  if (session.role !== 'driver') {
    send(ws, { type: 'error', message: 'Only drivers may publish location updates' });
    metricsService.inc('errors');
    logger.warn('location_update_unauthorized', {
      uid: session.uid,
      role: session.role,
      socketId: session.socketId,
    });
    return;
  }

  const claimedBusId = (payload.busId || payload.bus_id) as string | undefined;
  // Resolve busId: prefer session.busId (set during presence handshake and
  // validated by the HTTP trip-start flow) over the payload value.
  // If payload supplies a busId that differs from session.busId the driver
  // declared, reject — this prevents a driver from spoofing another bus's GPS.
  const busId = session.busId || claimedBusId;

  if (!busId) {
    send(ws, { type: 'error', message: 'location_update requires a busId. Send a presence message first.' });
    return;
  }

  // Auto-bind busId to session on first location update if not already bound via presence message
  if (!session.busId && claimedBusId) {
    sessionManager.setBusId(session.socketId, claimedBusId);
  }

  if (claimedBusId && session.busId && claimedBusId !== session.busId) {
    send(ws, { type: 'error', message: 'busId mismatch: claimed bus does not match your active trip bus' });
    metricsService.inc('errors');
    logger.warn('location_update_bus_mismatch', {
      uid: session.uid,
      sessionBusId: session.busId,
      claimedBusId,
      socketId: session.socketId,
    });
    return;
  }

  const locPayload = {
    busId,
    driverUid: session.uid,
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    speed: Number(payload.speed || 0),
    heading: Number(payload.heading || 0),
    accuracy: payload.accuracy ? Number(payload.accuracy) : undefined,
    timestamp: payload.timestamp || new Date().toISOString(),
  };

  updateLiveBusLocation(busId, locPayload);
  wsServer.broadcastToChannel(`bus:${busId}`, 'bus_location_update', locPayload);
  wsServer.broadcastToChannel(`bus_location_${busId}`, 'bus_location_update', locPayload);
  // Cross-node relay: publish to Redis so other WS nodes broadcast to their local subscribers.
  // publishToRedis is fire-and-forget; gracefully no-ops when Redis is not configured.
  publishToRedis(`bus:${busId}`, 'bus_location_update', locPayload);
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
  const eventPayload = (payload.payload || {}) as Record<string, unknown>;
  const busIdMatch = channel.match(/^(?:bus:|bus_location_)(.+)$/);
  if (busIdMatch && event === 'bus_location_update') {
    updateLiveBusLocation(busIdMatch[1], eventPayload);
  }
  wsServer.broadcastToChannel(channel, event, eventPayload);
  // Cross-node relay: server-originated events (trip_started, trip_ended, etc.)
  // must also reach subscribers on other WS nodes.
  publishToRedis(channel, event, eventPayload);
});

export { send as sendToSocket };

