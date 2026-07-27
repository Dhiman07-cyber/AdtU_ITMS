import { sessionManager } from './session-manager';
import { subscriptionManager } from './subscription-manager';
import { connectionRegistry } from './connection-registry';

export type MetricKey =
  | 'messagesSent' | 'messagesReceived'
  | 'connectionsAccepted' | 'connectionsRejected'
  | 'authSuccesses' | 'authFailures'
  | 'broadcastsSent'
  | 'errors'
  | 'rateLimitBlocks' | 'invalidMessages' | 'payloadTooLarge' | 'replayDetected'
  | 'slowHandlers' | 'queueDropped'
  | 'heartbeatTimeouts' | 'reconnectsHandled'
  // GPS pipeline
  | 'gpsAccepted' | 'gpsRejected'
  // Trip lifecycle
  | 'tripsStarted' | 'tripsEnded' | 'heartbeatsSent'
  // Notifications
  | 'notificationsSent' | 'notificationsFailed' | 'notificationsDeduplicated';

export class MetricsService {
  private startTime = Date.now();
  private state: Record<MetricKey, number> = {
    messagesSent: 0, messagesReceived: 0,
    connectionsAccepted: 0, connectionsRejected: 0,
    authSuccesses: 0, authFailures: 0,
    broadcastsSent: 0, errors: 0,
    rateLimitBlocks: 0, invalidMessages: 0, payloadTooLarge: 0, replayDetected: 0,
    slowHandlers: 0, queueDropped: 0,
    heartbeatTimeouts: 0, reconnectsHandled: 0,
    gpsAccepted: 0, gpsRejected: 0,
    tripsStarted: 0, tripsEnded: 0, heartbeatsSent: 0,
    notificationsSent: 0, notificationsFailed: 0, notificationsDeduplicated: 0,
  };

  inc(k: MetricKey, n = 1): void { this.state[k] += n; }

  get uptime() { return Date.now() - this.startTime; }

  snapshot() {
    const s = this.state;
    return {
      uptime: this.uptime,
      startTime: this.startTime,
      connections: {
        active: connectionRegistry.size,
        accepted: s.connectionsAccepted,
        rejected: s.connectionsRejected,
      },
      messages: { sent: s.messagesSent, received: s.messagesReceived },
      auth: { successes: s.authSuccesses, failures: s.authFailures },
      broadcasts: { sent: s.broadcastsSent, channels: subscriptionManager.getChannelCount() },
      subscriptions: { active: sessionManager.size, channels: subscriptionManager.getChannelCount() },
      security: {
        rateLimitBlocks: s.rateLimitBlocks,
        invalidMessages: s.invalidMessages,
        payloadTooLarge: s.payloadTooLarge,
        replayDetected: s.replayDetected,
      },
      performance: { slowHandlers: s.slowHandlers, queueDropped: s.queueDropped },
      errors: s.errors,
      heartbeatTimeouts: s.heartbeatTimeouts,
      reconnectsHandled: s.reconnectsHandled,
      gps: { accepted: s.gpsAccepted, rejected: s.gpsRejected },
      trips: { started: s.tripsStarted, ended: s.tripsEnded, heartbeatsSent: s.heartbeatsSent },
      notifications: { sent: s.notificationsSent, failed: s.notificationsFailed, deduplicated: s.notificationsDeduplicated },
    };
  }

  prometheus(): string {
    const s = this.snapshot();
    return [
      '# HELP itms_ws_connections_active Active WebSocket connections',
      '# TYPE itms_ws_connections_active gauge',
      `itms_ws_connections_active ${s.connections.active}`,
      '# HELP itms_ws_connections_total Total connections accepted',
      '# TYPE itms_ws_connections_total counter',
      `itms_ws_connections_total ${s.connections.accepted}`,
      '# HELP itms_ws_connections_rejected Total connections rejected',
      '# TYPE itms_ws_connections_rejected counter',
      `itms_ws_connections_rejected ${s.connections.rejected}`,
      '# HELP itms_ws_messages_sent Total messages sent',
      '# TYPE itms_ws_messages_sent counter',
      `itms_ws_messages_sent ${s.messages.sent}`,
      '# HELP itms_ws_messages_received Total messages received',
      '# TYPE itms_ws_messages_received counter',
      `itms_ws_messages_received ${s.messages.received}`,
      '# HELP itms_ws_auth_successes Total auth successes',
      '# TYPE itms_ws_auth_successes counter',
      `itms_ws_auth_successes ${s.auth.successes}`,
      '# HELP itms_ws_auth_failures Total auth failures',
      '# TYPE itms_ws_auth_failures counter',
      `itms_ws_auth_failures ${s.auth.failures}`,
      '# HELP itms_ws_broadcasts_sent Total broadcasts sent',
      '# TYPE itms_ws_broadcasts_sent counter',
      `itms_ws_broadcasts_sent ${s.broadcasts.sent}`,
      '# HELP itms_ws_rate_limit_blocks Total rate limit blocks',
      '# TYPE itms_ws_rate_limit_blocks counter',
      `itms_ws_rate_limit_blocks ${s.security.rateLimitBlocks}`,
      '# HELP itms_ws_errors_total Total errors',
      '# TYPE itms_ws_errors_total counter',
      `itms_ws_errors_total ${s.errors}`,
      '# HELP itms_ws_uptime_seconds Server uptime in seconds',
      '# TYPE itms_ws_uptime_seconds gauge',
      `itms_ws_uptime_seconds ${Math.floor(s.uptime / 1000)}`,
      '# HELP itms_ws_heartbeat_timeouts Total heartbeat timeouts',
      '# TYPE itms_ws_heartbeat_timeouts counter',
      `itms_ws_heartbeat_timeouts ${s.heartbeatTimeouts}`,
      '# HELP itms_ws_reconnects Total session reconnects handled',
      '# TYPE itms_ws_reconnects counter',
      `itms_ws_reconnects ${s.reconnectsHandled}`,
      '# HELP itms_gps_accepted Total GPS updates accepted',
      '# TYPE itms_gps_accepted counter',
      `itms_gps_accepted ${s.gps.accepted}`,
      '# HELP itms_gps_rejected Total GPS updates rejected',
      '# TYPE itms_gps_rejected counter',
      `itms_gps_rejected ${s.gps.rejected}`,
      '# HELP itms_trips_started Total trips started',
      '# TYPE itms_trips_started counter',
      `itms_trips_started ${s.trips.started}`,
      '# HELP itms_trips_ended Total trips ended',
      '# TYPE itms_trips_ended counter',
      `itms_trips_ended ${s.trips.ended}`,
      '# HELP itms_notifications_sent Total FCM notifications sent',
      '# TYPE itms_notifications_sent counter',
      `itms_notifications_sent ${s.notifications.sent}`,
      '# HELP itms_notifications_failed Total FCM notifications failed',
      '# TYPE itms_notifications_failed counter',
      `itms_notifications_failed ${s.notifications.failed}`,
    ].join('\n');
  }
}

export const metricsService = new MetricsService();
