/**
 * PROGRAM-004 / PHASE-02 NGINX & Network Infrastructure Collector
 * Instrumenting edge proxy connections, WebSocket upgrades, TLS handshakes, bandwidth, network errors.
 */

import { metrics } from '../metrics';

class NginxNetworkCollector {
  public recordConnectionStats(active: number, accepted: number, dropped: number): void {
    metrics.gauge('nginx_active_connections', 'Current active NGINX connections', {}, active);
    metrics.counter('nginx_accepted_connections_total', 'Total accepted NGINX connections', {}, accepted);
    metrics.counter('nginx_dropped_connections_total', 'Total dropped NGINX connections', {}, dropped);
  }

  public recordWebSocketUpgrade(success: boolean, clientIp?: string): void {
    metrics.counter('nginx_websocket_upgrades_total', 'Total NGINX WebSocket upgrade attempts', {
      result: success ? 'success' : 'failure',
    });
  }

  public recordTlsHandshake(version: string, cipher: string, durationMs: number): void {
    metrics.counter('nginx_tls_handshakes_total', 'Total TLS handshakes completed', { version, cipher });
    metrics.timer('nginx_tls_handshake_duration_seconds', 'TLS handshake duration', durationMs);
  }

  public recordProxyError(backend: string, statusCode: number): void {
    metrics.counter('nginx_proxy_errors_total', 'Total NGINX proxy errors', {
      backend,
      status: String(statusCode),
    });
  }

  public recordNetworkBandwidth(bytesIn: number, bytesOut: number): void {
    metrics.counter('network_bytes_received_total', 'Total network inbound bytes', {}, bytesIn);
    metrics.counter('network_bytes_transmitted_total', 'Total network outbound bytes', {}, bytesOut);
  }

  public recordSocketError(type: string): void {
    metrics.counter('network_socket_errors_total', 'Total network socket errors', { type });
  }
}

export const nginxNetworkCollector = new NginxNetworkCollector();
