# ITMS Canonical Production Deployment Guide

## Program & Phase Context
- **Program:** PROGRAM-005 (Infrastructure Standardization & Production Foundation)
- **Phase:** Phase 01 (Infrastructure Standardization)
- **Target Runtime:** Node.js 22 LTS (Alpine Container / Managed Vercel Serverless)

---

## Canonical Deployment Architecture

```
                                  Client Request (HTTPS / WSS)
                                               │
                                               ▼
                                      NGINX Reverse Proxy
                                         (Ports 80/443)
                                               │
                 ┌─────────────────────────────┼─────────────────────────────┐
                 │                             │                             │
                 ▼                             ▼                             ▼
       Next.js App Server             WebSocket Upstream Cluster          Monitoring Stack
         (nextjs:3000)                   (ws1:3001, ws2:3001)           (Prometheus / Grafana)
                 │                             │                             │
                 ▼                             ▼                             ▼
     Supabase DB & Firebase           Firebase Token Auth / REST           Health & Metrics
        Managed Services                   Profile Lookup                    (ws1/ws2:9090)
```

---

## Supported Deployment Topologies

### 1. Primary Docker Compose (Canonical Production Simulation & Local Stack)
The canonical multi-container environment includes Next.js, 2 WS runtime instances, NGINX reverse proxy, Prometheus, Alertmanager, and Grafana.

```bash
# Validate compose setup and boot full stack
docker compose up -d --build

# Verify container health status
docker compose ps
```

### 2. Primary Managed Hybrid Production (Vercel + Containerized WS Edge)
- **Next.js Application:** Hosted on Vercel Serverless Edge with `output: 'standalone'` (`next.config.ts`).
- **WebSocket Server & Reverse Proxy:** Deployed via Docker Compose on AWS EC2 or standalone Linux instance behind NGINX.
- **Database:** Supabase PostgreSQL 17 (Managed).
- **Authentication:** Firebase Auth & FCM (Managed).

### 3. Standalone Linux / EC2 Node Deployment
- **Node.js:** Node.js 22 LTS
- **Process Manager:** PM2 or Docker Compose

```bash
# 1. Next.js standalone server
npm run build
NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js

# 2. WebSocket Production Server
NODE_ENV=production WS_PORT=3001 HEALTH_PORT=9090 npx tsx server/index.ts
```

---

## Standardized Container & Service Ports

| Service | Container Name | Host Port | Internal Port | Protocol | Purpose |
|---------|----------------|-----------|---------------|----------|---------|
| Next.js App | `itms-nextjs` | 3000 | 3000 | HTTP | Web UI & Edge API |
| WS Instance 1 | `itms-ws1` | Dynamic | 3001 / 9090 | HTTP/WS | Realtime Transport & Health |
| WS Instance 2 | `itms-ws2` | Dynamic | 3001 / 9090 | HTTP/WS | Realtime Transport & Health |
| NGINX | `itms-nginx` | 80 / 443 | 80 / 443 | HTTP/HTTPS | Reverse Proxy & SSL Termination |
| Prometheus | `itms-prometheus` | 9090 | 9090 | HTTP | Metrics Collection |
| Alertmanager | `itms-alertmanager` | 9093 | 9093 | HTTP | Operational Alert Routing |
| Grafana | `itms-grafana` | 3002 | 3000 | HTTP | Observability Dashboards |

---

## Health & Operational Lifecycle Probes

| Endpoint | Port | Scope | Purpose | Success Behavior | Failure Behavior |
|----------|------|-------|---------|------------------|------------------|
| `/api/health` | 3000 | Next.js | System & Subsystem Check | `200 OK` | `503 Service Unavailable` |
| `/health/live` | 9090 | WS Server | Container Liveness Probe | `200 OK` | Container restart triggered |
| `/health/ready` | 9090 | WS Server | Upstream Readiness Probe | `200 OK` | `503` (Draining / Shutting down) |
| `/metrics` | 9090 | WS Server | Prometheus Scrape Target | `200 OK` (Text/plain) | Scrape alert fired |
| `/api/metrics` | 3000 | Next.js | Prometheus Scrape Target | `200 OK` (Text/plain) | Scrape alert fired |

---

## Fail-Fast Environment Validation

The runtime enforces fail-fast environment variable validation at startup via `src/lib/env-validator.ts`.
If any required secret or configuration variable is missing, production startup halts deterministically with an explicit log output.

To inspect environment validity locally:
```bash
npx tsc --noEmit
```

---

## Zero-Downtime Signal Handling & Shutdown

The WebSocket server implements standardized graceful termination:
1. Receives `SIGTERM` / `SIGINT`.
2. `/health/ready` probe immediately returns `503` to remove instance from NGINX upstream.
3. Enters 30-second connection drain window.
4. Closes active WS connections gracefully with WebSocket close code `4003`.
5. Cleans up internal sessions, rate limit buckets, and offline message queues.
6. Process terminates with exit code `0`.
