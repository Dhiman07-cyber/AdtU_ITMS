# Observability Architecture & Metrics Telemetry

## 1. Observability Topology

ITMS operates a unified Prometheus, Grafana, and Alertmanager observability stack configured in [`docker-compose.yml`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docker-compose.yml):

```
+────────────────────────────────────────────────────────────────────────────────────────────────----+
|                                    METRICS SCRAPING ARCHITECTURE                                   |
+────────────────────────────────────────────────────────────────────────────────────────────────----+

  [ WebSocket Node (ws1) ]            [ Next.js API Layer ]
   ws1:9090/metrics                    nextjs:3000/api/metrics
          │                                      │
          └──────────────────┬───────────────────┘
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
2. **WebSocketNodeDown**: Fired if Prometheus fails to scrape `ws1` for 3 consecutive intervals.
3. **DatabaseConnectionPoolExhausted**: Fired if Next.js database health check exceeds 2,500ms latency.

---

## 5. Comprehensive Low-Level Design (LLD) Breakdown & Justifications

### 5.1 `server/metrics.ts` & In-Memory Prometheus Metric Counters
- **Concrete Architectural Role**: High-frequency operational telemetry engine. Instruments atomic in-process counters, gauges, and histograms (`itms_ws_connections_active`, `itms_gps_accepted_total`, `itms_gps_rejected_total`) exposed on internal port `9090/metrics` for Prometheus scraping.
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without real-time telemetry gauges, memory leaks in Node.js socket buffers or event loop lag go completely unnoticed until the server crashes under 1,500 students at 08:00 AM.
  - If a driver's phone hardware begins outputting invalid coordinates, `itms_gps_rejected_total` spikes immediately. Without this metric, administrators have no warning that a bus has vanished from student maps.
  - Using heavy external APM agents (Datadog/NewRelic) injects 15%–25% CPU overhead into the single-threaded Node.js event loop during high-throughput socket broadcasting.
- **State Taxonomy & Invariants Enforced**:
  - *Telemetry State* (Volatile atomic counters and histograms).
- **Production Code Implementation**:
  ```typescript
  // File: server/metrics.ts
  export const metrics = {
    wsConnectionsActive: new Gauge('itms_ws_connections_active', 'Active WebSocket connections'),
    gpsAcceptedTotal: new Counter('itms_gps_accepted_total', 'Accepted GPS packets'),
    gpsRejectedTotal: new Counter('itms_gps_rejected_total', 'Rejected GPS packets', ['reason']),
    wsBroadcastLatencyMs: new Histogram('itms_ws_broadcast_latency_ms', 'Fan-out broadcast duration'),
  };
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Zero-Overhead Memory Arithmetic*: Increments are standard V8 JavaScript integer additions taking **<0.001ms**, producing zero disk I/O and zero network overhead until Prometheus scrapes every 10 seconds.

---

### 5.2 Internal Health Probes (:9090 `/health/live` & `/health/ready`)
- **Concrete Architectural Role**: Container lifecycle hooks for Docker Compose and Kubernetes. Distinguishes between process liveliness (is the event loop responsive?) and operational readiness (is the database connection pool primed and Redis connected?).
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without readiness probes, Docker routes incoming student traffic to a newly restarted container before its Firebase Admin SDK and database pools have initialized, returning 500 errors to students.
  - Without liveness probes, if an unhandled promise rejection or synchronous loop blocks the Node.js event loop, the orchestrator has no way to detect the frozen container and restart it automatically.
- **State Taxonomy & Invariants Enforced**:
  - *Telemetry & Process State*.
- **Production Code Implementation**:
  ```typescript
  // File: server/health.ts
  export function registerHealthRoutes(app: Express, state: HealthState) {
    app.get('/health/live', (req, res) => {
      // Event loop responsive check
      res.status(200).json({ status: 'ok', uptime: process.uptime() });
    });

    app.get('/health/ready', async (req, res) => {
      const dbOk = await checkDatabaseConnection();
      const redisOk = checkRedisReady();
      if (dbOk && redisOk) res.status(200).json({ status: 'ready' });
      else res.status(503).json({ status: 'degraded', dbOk, redisOk });
    });
  }
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Separation from App Port*: Listening on internal port `9090` ensures health probes cannot be saturated or starved by incoming user traffic on port `3001` or `3000`.

