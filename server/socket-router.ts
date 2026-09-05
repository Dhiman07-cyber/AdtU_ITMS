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
import { getSupabaseServer } from '@/lib/supabase-server';

type MessageHandler = (ws: WebSocket, session: Session, payload: any) => void | Promise<void>;

const handlers = new Map<string, MessageHandler>();

export function handle(type: string, handler: MessageHandler): void {
  handlers.set(type, handler);
}

/**
 * Route a single parsed WS message to its registered handler.
 *
 * DESIGN: returns a Promise so callers can await it, preserving per-socket
 * message ordering.  The 'presence' handler is async (DB query) — if the
 * caller does NOT await this function the next message (e.g. 'subscribe')
 * may execute before the DB query resolves and before session.busId is set,
 * producing the observed race:
 *
 *   presence → DB query starts → subscribe runs → session.busId unset → REJECTED
 *
 * By awaiting routeMessage inside processMessage's per-socket queue, each
 * socket processes one message at a time.  Cross-socket concurrency is
 * unaffected: the per-socket queue is independent per WebSocket instance.
 */
export async function routeMessage(ws: WebSocket, session: Session, parsed: any): Promise<void> {
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
    await handler(ws, session, payload);
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
  const loc = liveBusLocations.get(busId);
  if (!loc) return undefined;
  const ts = new Date(loc.timestamp as string || 0).getTime();
  if (ts > 0 && Date.now() - ts > 60000) {
    liveBusLocations.delete(busId);
    return undefined;
  }
  return loc;
}

handle('subscribe', (ws, session, payload) => {
  const channel = payload.channel as string | undefined;
  if (!channel) { send(ws, { type: 'error', message: 'subscribe requires "channel"' }); return; }

  // SECURITY: Students may only subscribe to channels for their assigned bus.
  // Drivers may only subscribe to channels for their active trip's bus.
  // Admins/moderators/server have unrestricted access.
  if (session.role === 'student' || session.role === 'driver') {
    const busIdMatch = channel.match(/^(?:bus:|bus_location_|trip-status-|waiting_flags_)(.+)$/);
    if (busIdMatch) {
      const channelBusId = busIdMatch[1];
      // REJECT if session.busId is not set (presence not sent yet)
      if (!session.busId) {
        send(ws, { type: 'error', message: 'Must send presence with busId before subscribing to bus channels' });
        metricsService.inc('errors');
        logger.warn('subscribe_unauthorized_no_presence', { uid: session.uid, role: session.role, channel });
        return;
      }
      if (channelBusId !== session.busId) {
        send(ws, { type: 'error', message: 'Not authorized to subscribe to this bus channel' });
        metricsService.inc('errors');
        logger.warn('subscribe_unauthorized', { uid: session.uid, role: session.role, channel, sessionBusId: session.busId, channelBusId });
        return;
      }
    }
  }

  subscriptionManager.subscribe(session.socketId, channel, ws, session);
  logger.debug('subscribe', { uid: session.uid, socketId: session.socketId, channel });
  send(ws, { type: 'subscribed', channel });

  // Immediate initial location push for newly subscribed clients
  const busIdMatch = channel.match(/^(?:bus:|bus_location_)(.+)$/);
  if (busIdMatch) {
    const busId = busIdMatch[1];
    const cachedLoc = getLiveBusLocation(busId);
    if (cachedLoc) {
      // Observability marker: lets clients/tests distinguish this subscribe-time
      // cache snapshot from a live bus_location_update broadcast (which carries
      // no 'source' field). Purely additive — no behavioural change.
      send(ws, { type: 'message', channel, event: 'bus_location_update', payload: { ...cachedLoc, source: 'snapshot' } });
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
  metricsService.inc('heartbeatsSent');
  // Reply so the client can detect a silently-dead server: the client closes
  // and reconnects when no message (incl. this ack) arrives for >3 ping cycles.
  send(ws, { type: 'pong_ack' });
});

handle('presence', async (ws, session, payload) => {
  const claimedBusId = payload.busId && typeof payload.busId === 'string' && payload.busId.trim()
    ? payload.busId.trim()
    : null;

  if (claimedBusId) {
    const supabase = getSupabaseServer();
    let authorized = false;

    if (session.role === 'student') {
      const { data } = await supabase
        .from('student_profiles')
        .select('bus_id')
        .eq('uid', session.uid)
        .maybeSingle();
      if (data?.bus_id === claimedBusId) authorized = true;
    } else if (session.role === 'driver') {
      const { data: trip } = await supabase
        .from('active_trips')
        .select('bus_id')
        .eq('driver_id', session.uid)
        .eq('status', 'active')
        .maybeSingle();
      if (trip?.bus_id === claimedBusId) {
        authorized = true;
      } else {
        const { data: profile } = await supabase
          .from('driver_profiles')
          .select('bus_id')
          .eq('uid', session.uid)
          .maybeSingle();
        if (profile?.bus_id === claimedBusId) authorized = true;
      }
    } else if (session.role === 'admin' || session.role === 'moderator') {
      authorized = true;
    }

    if (!authorized) {
      send(ws, { type: 'error', message: 'Unauthorized: you do not own this bus' });
      metricsService.inc('errors');
      logger.warn('presence_unauthorized_bus', { uid: session.uid, role: session.role, claimedBusId });
      return;
    }

    sessionManager.setBusId(session.socketId, claimedBusId);
  }

  if (payload.tripId && typeof payload.tripId === 'string' && payload.tripId.trim()) {
    sessionManager.setTripId(session.socketId, payload.tripId.trim());
  }
  if (payload.routeId && typeof payload.routeId === 'string' && payload.routeId.trim()) {
    sessionManager.setRouteId(session.socketId, payload.routeId.trim());
  }

  logger.debug('presence', { uid: session.uid, socketId: session.socketId, busId: claimedBusId, tripId: payload.tripId, routeId: payload.routeId });
  send(ws, { type: 'presence_ok' });
});

handle('location_update', (ws, session, payload) => {
  // SECURITY: Only drivers may publish GPS location updates.
  // Students, moderators and other roles are rejected immediately.
  if (session.role !== 'driver') {
    send(ws, { type: 'error', message: 'Only drivers may publish location updates' });
    metricsService.inc('gpsRejected');
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
    metricsService.inc('gpsRejected');
    return;
  }

  // Auto-bind busId to session on first location update if not already bound via presence message
  if (!session.busId && claimedBusId) {
    sessionManager.setBusId(session.socketId, claimedBusId);
  }

  if (claimedBusId && session.busId && claimedBusId !== session.busId) {
    send(ws, { type: 'error', message: 'busId mismatch: claimed bus does not match your active trip bus' });
    metricsService.inc('gpsRejected');
    metricsService.inc('errors');
    logger.warn('location_update_bus_mismatch', {
      uid: session.uid,
      sessionBusId: session.busId,
      claimedBusId,
      socketId: session.socketId,
    });
    return;
  }

  // DEPRECATED: Direct WS location updates bypass the robust validation pipeline
  // (Kalman filters, spoofing detection) and drop trip metadata.
  // The authoritative path is now the HTTP API which emits via Redis.
  // We no longer broadcast or cache from this handler to prevent duplicate packets.
  // We just increment the metric to track if any legacy clients are still sending this.
  metricsService.inc('gpsAccepted');
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
  if (busIdMatch) {
    if (event === 'bus_location_update') {
      updateLiveBusLocation(busIdMatch[1], eventPayload);
    } else if (event === 'trip_ended') {
      clearLiveBusLocation(busIdMatch[1]);
    }
  }
  wsServer.broadcastToChannel(channel, event, eventPayload);
  // Cross-node relay: server-originated events (trip_started, trip_ended, etc.)
  // must also reach subscribers on other WS nodes.
  publishToRedis(channel, event, eventPayload);
  if (event === 'trip_started') metricsService.inc('tripsStarted');
  if (event === 'trip_ended') metricsService.inc('tripsEnded');
});

export { send as sendToSocket };

