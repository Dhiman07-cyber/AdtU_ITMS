# NGINX Reverse Proxy, Load Balancing & Network Architecture

## 1. Network Topology & Docker Ingress

In the production deployment, NGINX functions as the primary ingress controller and security perimeter. It manages SSL/TLS termination, HTTP-to-HTTPS enforcement, path-based routing, protocol upgrades, and internal endpoint ACLs.

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

## 2. Upstream Definitions & Load Balancing Strategies ([`nginx/nginx.conf`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/nginx/nginx.conf))

### 2.1 WebSocket Upstream (`ws_backend`)
- **Strategy**: `ip_hash`
- **Rationale**: While Redis relays cross-node broadcasts, pinning each client IP to a specific WebSocket server instance ensures optimal session affinity, stabilizes in-memory session presence, and avoids unnecessary connection thrashing.
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

### 2.3 Health & Metrics Upstream (`health_backend`)
- Dedicated to internal Prometheus metric scraping and live health probes on port `9090`.

```nginx
# nginx/nginx.conf
upstream health_backend {
  server ws1:9090 max_fails=3 fail_timeout=10s;
  server ws2:9090 max_fails=3 fail_timeout=10s;
  keepalive 16;
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

## 4. Internal Endpoint Access Control Lists (ACLs)

Internal operational endpoints are strictly segregated. Requests from public internet IPs are rejected at the NGINX perimeter with HTTP 403:

```nginx
# nginx/nginx.conf

# 1. Prometheus scraping & WS health probes
location /health {
  allow 127.0.0.1;
  allow 10.0.0.0/8;
  allow 172.16.0.0/12;
  allow 192.168.0.0/16;
  deny  all;

  proxy_pass         http://health_backend;
  proxy_http_version 1.1;
  proxy_set_header   Host $host;
  proxy_set_header   X-Request-ID $request_id;
}

location /metrics {
  allow 127.0.0.1;
  allow 10.0.0.0/8;
  allow 172.16.0.0/12;
  allow 192.168.0.0/16;
  deny  all;

  proxy_pass         http://health_backend;
  proxy_http_version 1.1;
  proxy_set_header   Host $host;
  proxy_set_header   X-Request-ID $request_id;
}

# 2. Alertmanager webhooks & Next.js metrics
location = /api/admin/alerts {
  allow 127.0.0.1;
  allow 10.0.0.0/8;
  allow 172.16.0.0/12;
  allow 192.168.0.0/16;
  deny  all;

  proxy_pass            http://nextjs_backend;
  proxy_http_version    1.1;
  proxy_set_header      Host              $host;
  proxy_set_header      X-Real-IP         $remote_addr;
  proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header      X-Forwarded-Proto $scheme;
  proxy_set_header      X-Request-ID      $request_id;
}

location = /api/metrics {
  allow 127.0.0.1;
  allow 10.0.0.0/8;
  allow 172.16.0.0/12;
  allow 192.168.0.0/16;
  deny  all;

  proxy_pass            http://nextjs_backend;
  proxy_http_version    1.1;
  proxy_set_header      Host              $host;
  proxy_set_header      X-Real-IP         $remote_addr;
  proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header      X-Forwarded-Proto $scheme;
  proxy_set_header      X-Request-ID      $request_id;
}
```

---

## 5. Client IP Identification & Anti-Spoofing Architecture

### The Client Spoofing Risk
When an incoming request passes through reverse proxies, naive implementations extract `X-Forwarded-For.split(',')[0]`. If a client supplies `X-Forwarded-For: 10.0.0.1`, NGINX's `$proxy_add_x_forwarded_for` appends the real remote address (`10.0.0.1, <real_ip>`). Taking the first element allows attackers to spoof arbitrary client IPs, evading rate limits and brute-force throttles.

### The Defensive Architecture
The application ([`src/lib/security/api-security.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/security/api-security.ts)) enforces strict IP extraction precedence:
1. **`X-Real-IP`**: Evaluated first. Set directly by NGINX using `$remote_addr` (`proxy_set_header X-Real-IP $remote_addr;`). The client cannot forge or overwrite this header.
2. **`CF-Connecting-IP`**: Used when fronted by Cloudflare CDN edges.
3. **Rightmost Element of `X-Forwarded-For`**: When `X-Forwarded-For` is evaluated, the application inspects `parts[parts.length - 1]`, corresponding to the IP address appended by the closest trusted reverse proxy hop, completely defeating client-side header spoofing.

---

## 6. Security Headers & TLS Hardening

All HTTP responses emitted by NGINX include hardened browser headers:

```nginx
# Security Headers
server_tokens        off;
client_max_body_size 10M;
add_header           Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header           X-Content-Type-Options    "nosniff"                                      always;
add_header           X-Frame-Options           "DENY"                                         always;
add_header           Referrer-Policy           "strict-origin-when-cross-origin"              always;
add_header           Permissions-Policy        "geolocation=(self), camera=(), microphone=()" always;

# SSL/TLS Protocols & Ciphers
ssl_protocols        TLSv1.2 TLSv1.3;
ssl_ciphers          ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
ssl_session_cache    shared:SSL:10m;
ssl_session_timeout  1d;
ssl_stapling         on;
ssl_stapling_verify  on;
```
