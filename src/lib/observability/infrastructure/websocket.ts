/**
 * PROGRAM-004 / PHASE-02 WebSocket Runtime Infrastructure Collector
 * Instrumenting connection lifecycle, auth, queues, heartbeats, broadcast latency, reconnect storms.
 */

import { metrics } from '../metrics';

export interface WebSocketRuntimeStats {
  activeConnections: number;
  activeSessions: number;
  activeSubscriptions: number;
  channelsCount: number;
  offlineQueueDepth: number;
  reconnectStormsDetected: number;
}

class WebSocketRuntimeCollector {
  private activeConnections = 0;
  private activeSessions = 0;
  private offlineQueueDepth = 0;
  private reconnectWindow: number[] = [];

  public recordConnectionOpen(role?: string): void {
    this.activeConnections++;
    metrics.gauge('websocket_connections_active', 'Active WebSocket connections', { role: role || 'unknown' }, this.activeConnections);
    metrics.counter('websocket_connections_opened_total', 'Total WebSocket connections opened', { role: role || 'unknown' });

    // Track reconnect storm threshold (e.g., >50 connections in 5 seconds)
    const now = Date.now();
    this.reconnectWindow.push(now);
    this.reconnectWindow = this.reconnectWindow.filter((t) => now - t <= 5000);
    if (this.reconnectWindow.length > 50) {
      metrics.counter('websocket_reconnect_storms_total', 'Total reconnect storms detected');
    }
  }

  public recordConnectionClose(code: number, reason?: string): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    metrics.gauge('websocket_connections_active', 'Active WebSocket connections', {}, this.activeConnections);
    metrics.counter('websocket_connections_closed_total', 'Total WebSocket connections closed', { code: String(code) });
  }

  public recordAuthResult(success: boolean, reason?: string): void {
    if (success) {
      metrics.counter('websocket_auth_success_total', 'Total WebSocket authentication successes');
    } else {
      metrics.counter('websocket_auth_failure_total', 'Total WebSocket authentication failures', { reason: reason || 'invalid_token' });
    }
  }

  public recordSubscription(channel: string): void {
    metrics.counter('websocket_subscriptions_total', 'Total channel subscriptions', { channel });
  }

  public recordUnsubscription(channel: string): void {
    metrics.counter('websocket_unsubscriptions_total', 'Total channel unsubscriptions', { channel });
  }

  public recordBroadcast(channel: string, subscriberCount: number, durationMs: number): void {
    metrics.counter('websocket_broadcasts_total', 'Total broadcasts dispatched', { channel });
    metrics.gauge('websocket_broadcast_fanout', 'Broadcast subscriber fanout count', { channel }, subscriberCount);
    metrics.timer('websocket_broadcast_duration_seconds', 'Broadcast dispatch duration', durationMs, { channel });

    if (durationMs > 100) {
      metrics.counter('websocket_slow_broadcasts_total', 'Total slow broadcasts (>100ms)', { channel });
    }
  }

  public recordHeartbeat(pingPongLatencyMs: number): void {
    metrics.timer('websocket_heartbeat_latency_seconds', 'Heartbeat ping-pong latency', pingPongLatencyMs);
  }

  public recordHeartbeatTimeout(): void {
    metrics.counter('websocket_heartbeat_timeouts_total', 'Total heartbeat timeout disconnects');
  }

  public recordRateLimitBlock(scope: 'ip' | 'user' | 'socket'): void {
    metrics.counter('websocket_rate_limit_blocks_total', 'Total rate limit blocks', { scope });
  }

  public recordPayloadValidationFailure(reason: string): void {
    metrics.counter('websocket_payload_validation_failures_total', 'Total payload validation failures', { reason });
  }

  public recordOfflineQueueMetrics(depth: number, droppedCount = 0): void {
    this.offlineQueueDepth = depth;
    metrics.gauge('websocket_offline_queue_depth', 'Current offline queue depth', {}, depth);
    if (droppedCount > 0) {
      metrics.counter('websocket_offline_queue_drops_total', 'Total dropped offline messages', {}, droppedCount);
    }
  }

  public recordMessageThroughput(bytesSent: number, bytesReceived: number): void {
    metrics.counter('websocket_bytes_sent_total', 'Total bytes sent via WebSocket', {}, bytesSent);
    metrics.counter('websocket_bytes_received_total', 'Total bytes received via WebSocket', {}, bytesReceived);
  }
}

export const webSocketRuntimeCollector = new WebSocketRuntimeCollector();
