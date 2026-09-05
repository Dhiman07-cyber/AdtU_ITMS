# Observability Architecture & Metrics Telemetry

## 1. Observability Topology

ITMS operates a unified Prometheus, Grafana, and Alertmanager observability stack configured in [`docker-compose.yml`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docker-compose.yml):

```
+────────────────────────────────────────────────────────────────────────────────────────────────----+
|                                    METRICS SCRAPING ARCHITECTURE                                   |
+────────────────────────────────────────────────────────────────────────────────────────────────----+

  [ WebSocket Node 1 ]      [ WebSocket Node 2 ]               [ Next.js API Layer ]
   ws1:9090/metrics          ws2:9090/metrics                   nextjs:3000/api/metrics
          │                         │                                      │
          └─────────────────────────┼──────────────────────────────────────┘
                                    │
                                    ▼ (Scrape every 10s)
                         [ Prometheus Server ]
                         Port 9090
                                    │
                    ┌───────────────┴───────────────┐
                    ▼ Alerts fired                  ▼ PromQL queries
          [ Alertmanager:9093 ]            [ Grafana Dashboard ]
          - Webhook / Email                - Port 3002
          - Ops paging                     - Real-time fleet health
```

---

## 2. Core Telemetry Metric Catalog

Custom operational metrics are instrumented under the canonical `itms_*` namespace:

| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `itms_ws_connections_active` | Gauge | Currently connected WebSocket clients per node. |
| `itms_ws_messages_received_total` | Counter | Total frames received by the WS server from clients. |
| `itms_ws_messages_sent_total` | Counter | Total frames dispatched by the WS server to clients. |
| `itms_gps_accepted_total` | Counter | GPS updates that passed validation and were broadcasted. |
| `itms_gps_rejected_total` | Counter | GPS updates rejected by the validation pipeline (bounds, jump, stale). |
| `itms_ws_broadcasts_sent_total` | Counter | Total fan-out broadcasts generated across WebSocket channels. |
| `itms_ws_auth_successes_total` | Counter | Successful Firebase ID token authentications on connection. |
| `itms_ws_auth_failures_total` | Counter | Rejected authentication handshakes (expired, invalid, malformed). |
| `itms_redis_pubsub_messages_total` | Counter | Inter-node broadcasts relayed over Redis `ws:broadcast`. |

---

## 3. Health & Liveness Endpoints

Every service exposes unauthenticated HTTP probes for container orchestrators and automated readiness checking:

- **Next.js API**:
  - `GET /api/health` -> Returns `200 OK` and status of PostgreSQL database connection.
- **WebSocket Nodes (`http://localhost:9090`)**:
  - `GET /health/live` -> Returns `200 OK` if the event loop and TCP listeners are responsive.
  - `GET /health/ready` -> Returns `200 OK` if the node is authenticated and initialized.
  - `GET /metrics` -> Returns standard Prometheus exposition format text.
  - `GET /metrics/json` -> Returns machine-readable operational summary.

---

## 4. Alerting Thresholds (`alertmanager/alertmanager.yml`)

Prometheus evaluates rules every 10 seconds and forwards alerts to Alertmanager:
1. **HighGPSRejectionRate**: Fired if `rate(itms_gps_rejected_total[5m]) > 10` for 2 minutes (indicates widespread driver GPS sensor malfunction or coordinate tampering).
2. **WebSocketNodeDown**: Fired if Prometheus fails to scrape `ws1` or `ws2` for 3 consecutive intervals.
3. **DatabaseConnectionPoolExhausted**: Fired if Next.js database health check exceeds 2,500ms latency.
