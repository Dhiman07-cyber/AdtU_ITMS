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
import { encode } from './socket-encoder';
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
    ws.send(encode(data));
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

  // SECURITY:
  // 1. Only drivers (for their active trip bus) and students (for their assigned bus) have access to waiting flags.
  //    Administrators and moderators have ZERO access to student waiting flags or driver wait requests.
  //    Admins/mods may ONLY subscribe to fleet GPS location streams (bus_location_*, bus:*, etc.).
  if ((channel.startsWith('waiting_flags_') || channel.startsWith('driver_wait_request_')) && (session.role === 'admin' || session.role === 'moderator')) {
    send(ws, { type: 'error', message: 'Not authorized: Admin and Moderator roles have no access to student waiting flags' });
    metricsService.inc('errors');
    logger.warn('subscribe_unauthorized_admin_mod_waiting_channel', { uid: session.uid, role: session.role, channel });
    return;
  }

  // 2. driver_wait_request_* is strictly driver-only: carries student names and stops.
  if (channel.startsWith('driver_wait_request_') && session.role === 'student') {
    send(ws, { type: 'error', message: 'Not authorized to subscribe to this channel' });
    metricsService.inc('errors');
    logger.warn('subscribe_unauthorized_student_wait_channel', { uid: session.uid, channel });
    return;
  }
  if (session.role === 'student' || session.role === 'driver') {
    const busIdMatch = channel.match(/^(?:bus:|bus_location_|trip-status-|waiting_flags_|driver_wait_request_)(.+)$/);
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
    } else {
      // FIX-02 (WS-01): Default-deny for all non-bus-prefixed channels.
      // A student_${uid} private channel is ONLY accessible to the owning socket.
      // Any other unrecognized channel pattern is denied outright.
      const privateStudentChannel = `student_${session.uid}`;
      if (channel !== privateStudentChannel) {
        send(ws, { type: 'error', message: 'Not authorized to subscribe to this channel' });
        metricsService.inc('errors');
        logger.warn('subscribe_unauthorized_channel_pattern', { uid: session.uid, role: session.role, channel });
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
        // Enforce canonical entitlement: status must be active AND not past soft_block / valid_until boundary
        .select('bus_id, status, soft_block, valid_until')
        .eq('uid', session.uid)
        .maybeSingle();
      if (data?.bus_id === claimedBusId) {
        const st = data.status || 'active';
        if (st === 'active') {
          const now = new Date();
          let pastBoundary = false;
          if (data.soft_block) {
            pastBoundary = new Date(data.soft_block) <= now;
          } else if (data.valid_until) {
            pastBoundary = new Date(data.valid_until) <= now;
          }
          if (!pastBoundary) {
            authorized = true;
          }
        }
      }
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

  // FIX-03 (WS-02/A-01): Removed the auto-bind that allowed a driver to skip
  // the authenticated `presence` handshake and bind any arbitrary busId to their
  // session by sending location_update{busId:'BUS-X'}. The subscribe handler
  // relies on session.busId for bus-channel authorization; auto-binding without
  // DB validation bypasses the ownership check and enables cross-bus PII leakage.
  // Drivers MUST send a `presence` message first (which validates ownership via PG).
  if (!session.busId) {
    send(ws, { type: 'error', message: 'location_update requires an active presence. Send a presence message with your busId first.' });
    metricsService.inc('gpsRejected');
    return;
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

  // DEPRECATED: Direct WS location updates bypass the HTTP validation pipeline
  // (bounds, speed/heading limits, accuracy cap, active-trip check, jump and
  // replay-ordering guards in gps-pipeline.service) and drop trip metadata.
  // The authoritative path is now the HTTP API which emits via Redis.
  // We no longer broadcast or cache from this handler to prevent duplicate packets.
  // We just increment the metric to track if any legacy clients are still sending this.
  // FIX-09 (A-12): This handler is DEPRECATED. Frames that arrive here are dropped
  // (no broadcast, no persistence). Incrementing 'gpsAccepted' was misleading;
  // 'gpsLegacyDropped' correctly reflects that these packets are discarded.
  metricsService.inc('gpsLegacyDropped');
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
  // Lifecycle events ship on trip-status-{busId} (see trip-broadcast.service),
  // so the live-location snapshot must be cleared for that channel shape too —
  // otherwise new subscribers get a stale position for up to 60s after end.
  const busIdMatch = channel.match(/^(?:bus:|bus_location_|trip-status-)(.+)$/);
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
  if (event === 'waiting_flag_raised' || event === 'waiting_flag_created') metricsService.inc('waitingFlagsCreated');
  if (event === 'waiting_flag_cancelled' || event === 'waiting_flag_resolved' || event === 'waiting_flag_removed' || event === 'waiting_flag_boarded') metricsService.inc('waitingFlagsCancelled');
});

export { send as sendToSocket };

