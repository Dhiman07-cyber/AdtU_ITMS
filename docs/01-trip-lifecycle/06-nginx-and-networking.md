# NGINX Reverse Proxy, Load Balancing & Network Architecture

## 1. Network Topology & Docker Ingress

In the production deployment, NGINX functions as the primary ingress controller and security perimeter. It manages SSL/TLS termination, HTTP-to-HTTPS enforcement, path-based routing, and protocol upgrades.

```
                      INCOMING TRAFFIC (Port 80 / 443)
                                     │
                                     ▼
                      +─────────────────────────────+
                      |   NGINX Ingress Container   |
                      |   (nginx/nginx.conf)        |
                      +──────────────┬──────────────+
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼ /api, / (HTTP)            ▼ /ws (WebSocket)           ▼ /health (Monitoring)
+─────────────────────+     +─────────────────────+     +─────────────────────+
| nextjs_backend      |     | ws_backend          |     | health_backend      |
| Load: least_conn    |     | Load: ip_hash       |     | Internal probes     |
| Node: nextjs:3000   |     | Nodes: ws1:3001     |     | Nodes: ws1:9090     |
|                     |     |        ws2:3001     |     |        ws2:9090     |
+─────────────────────+     +─────────────────────+     +─────────────────────+
```

---

## 2. Upstream Definitions & Load Balancing Strategies (`nginx/nginx.conf`)

### 2.1 WebSocket Upstream (`ws_backend`)
- **Strategy**: `ip_hash`
- **Rationale**: While Redis relays cross-node broadcasts, pinning each client IP to a specific WebSocket server instance ensures optimal session affinity and avoids unnecessary connection thrashing.
- **Failover**: Configured with `max_fails=3 fail_timeout=10s` to bypass dead nodes automatically.

```nginx
# nginx/nginx.conf
upstream ws_backend {
  ip_hash;
  server ws1:3001 max_fails=3 fail_timeout=10s;
  server ws2:3001 max_fails=3 fail_timeout=10s;
  keepalive 256;
}
```

### 2.2 Next.js Application Upstream (`nextjs_backend`)
- **Strategy**: `least_conn`
- **Rationale**: The Next.js compute layer is completely stateless (authenticating via Firebase JWTs and reading/writing Supabase PostgreSQL). `least_conn` distributes CPU-heavy page rendering and API queries to the node currently handling the fewest active requests.

```nginx
# nginx/nginx.conf
upstream nextjs_backend {
  least_conn;
  server nextjs:3000 max_fails=3 fail_timeout=10s;
  keepalive 64;
}
```

---

## 3. WebSocket Upgrade & Streaming Configuration

WebSocket traffic requires special HTTP header rewriting and socket buffer handling:
- **`Upgrade` & `Connection`**: Passes the hop-by-hop upgrade headers through to the upstream WebSocket process.
- **Buffer Disabling (`proxy_buffering off`)**: Vital for real-time streaming; prevents NGINX from buffering 100-byte GPS packets before dispatching to the client.
- **Extended Timeouts (`proxy_read_timeout 86400s`)**: Prevents NGINX from severing idle WebSocket connections after 60 seconds of client silence.

```nginx
# nginx/nginx.conf
location /ws {
  proxy_pass            http://ws_backend;
  proxy_http_version    1.1;
  proxy_set_header      Upgrade           $http_upgrade;
  proxy_set_header      Connection        "upgrade";
  proxy_set_header      Host              $host;
  proxy_set_header      X-Real-IP         $remote_addr;
  proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header      X-Forwarded-Proto $scheme;
  proxy_set_header      X-Request-ID      $request_id;
  proxy_read_timeout    86400s;
  proxy_send_timeout    86400s;
  proxy_buffering       off;
  proxy_cache           off;
}
```

---

## 4. Security Headers & TLS Hardening

All HTTP responses emitted by NGINX include hardened browser headers:

```nginx
# Security Headers
server_tokens        off;
add_header           Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header           X-Content-Type-Options    "nosniff"                                      always;
add_header           X-Frame-Options           "DENY"                                         always;
add_header           Referrer-Policy           "strict-origin-when-cross-origin"              always;
add_header           Permissions-Policy        "geolocation=(self), camera=(), microphone=()" always;

# SSL/TLS Protocols & Ciphers
ssl_protocols        TLSv1.2 TLSv1.3;
ssl_ciphers          ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_session_cache    shared:SSL:10m;
ssl_session_timeout  1d;
```

---

## 5. Docker Network Isolation (`docker-compose.yml`)

The infrastructure services reside on an isolated internal bridge network (`itms`). 

- **Public Port Exposure**: Only NGINX exposes port `80` (HTTP) and `443` (HTTPS) to the public internet.
- **Internal Only**:
  - `redis:6379` is bound exclusively to `127.0.0.1` on the host and accessible over the Docker `itms` network.
  - `nextjs:3000`, `ws1:3001`, and `ws2:3001` are private to the bridge network.
  - Prometheus and Alertmanager scrape metrics over Docker DNS (`ws1:9090`, `nextjs:3000`).
