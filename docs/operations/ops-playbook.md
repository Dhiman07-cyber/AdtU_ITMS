# Assam down town University (AdtU) ITMS — Production Operations Playbook (OPS-PLAYBOOK)
### Consolidated Production Deployment Guide, Environment Reference, and Operational Runbooks
**Version:** 6.0.0 | **Author:** Lead DevOps & SRE Engineer | **Workspace:** `c:\Users\ADMIN\Desktop\Projects\ITMS`

---

## 📑 TABLE OF CONTENTS

- [SECTION 1 — CANONICAL PRODUCTION DEPLOYMENT GUIDE](#section-1--canonical-production-deployment-guide)
- [SECTION 2 — ENVIRONMENT VARIABLES REFERENCE](#section-2--environment-variables-reference)
- [SECTION 3 — OPERATIONAL RUNBOOKS (RB-01 – RB-12)](#section-3--operational-runbooks-rb-01--rb-12)

---

# SECTION 1 — CANONICAL PRODUCTION DEPLOYMENT GUIDE

## 1.1 Program & Phase Context
- **Program:** PROGRAM-005 (Infrastructure Standardization & Production Foundation)
- **Phase:** Phase 01 (Infrastructure Standardization)
- **Target Runtime:** Node.js 22 LTS (Alpine Container / Managed Vercel Serverless)

## 1.2 Canonical Deployment Architecture

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

## 1.3 Supported Deployment Topologies

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

## 1.4 Standardized Container & Service Ports

| Service | Container Name | Host Port | Internal Port | Protocol | Purpose |
|---------|----------------|-----------|---------------|----------|---------|
| Next.js App | `itms-nextjs` | 3000 | 3000 | HTTP | Web UI & Edge API |
| WS Instance 1 | `itms-ws1` | Dynamic | 3001 / 9090 | HTTP/WS | Realtime Transport & Health |
| WS Instance 2 | `itms-ws2` | Dynamic | 3001 / 9090 | HTTP/WS | Realtime Transport & Health |
| NGINX | `itms-nginx` | 80 / 443 | 80 / 443 | HTTP/HTTPS | Reverse Proxy & SSL Termination |
| Prometheus | `itms-prometheus` | 9090 | 9090 | HTTP | Metrics Collection |
| Alertmanager | `itms-alertmanager` | 9093 | 9093 | HTTP | Operational Alert Routing |
| Grafana | `itms-grafana` | 3002 | 3000 | HTTP | Observability Dashboards |

## 1.5 Health & Operational Lifecycle Probes

| Endpoint | Port | Scope | Purpose | Success Behavior | Failure Behavior |
|----------|------|-------|---------|------------------|------------------|
| `/api/health` | 3000 | Next.js | System & Subsystem Check | `200 OK` | `503 Service Unavailable` |
| `/health/live` | 9090 | WS Server | Container Liveness Probe | `200 OK` | Container restart triggered |
| `/health/ready` | 9090 | WS Server | Upstream Readiness Probe | `200 OK` | `503` (Draining / Shutting down) |
| `/metrics` | 9090 | WS Server | Prometheus Scrape Target | `200 OK` (Text/plain) | Scrape alert fired |
| `/api/metrics` | 3000 | Next.js | Prometheus Scrape Target | `200 OK` (Text/plain) | Scrape alert fired |

## 1.6 Fail-Fast Environment Validation
The runtime enforces fail-fast environment variable validation at startup via `src/lib/env-validator.ts`. If any required secret or configuration variable is missing, production startup halts deterministically with an explicit log output.

To inspect environment validity locally:
```bash
npx tsc --noEmit
```

## 1.7 Zero-Downtime Signal Handling & Shutdown
The WebSocket server implements standardized graceful termination:
1. Receives `SIGTERM` / `SIGINT`.
2. `/health/ready` probe immediately returns `503` to remove instance from NGINX upstream.
3. Enters 30-second connection drain window.
4. Closes active WS connections gracefully with WebSocket close code `4003`.
5. Cleans up internal sessions, rate limit buckets, and offline message queues.
6. Process terminates with exit code `0`.

---

# SECTION 2 — ENVIRONMENT VARIABLES REFERENCE

Variables marked `REQUIRED` will cause startup failure or security degradation if absent.
Variables marked `OPTIONAL` have safe defaults but should be configured in production.

## 2.1 Firebase — Client SDK (Public)
These are safe to expose to browsers. They are embedded in the Next.js bundle.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | REQUIRED | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | REQUIRED | `your-project.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | REQUIRED | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | REQUIRED | Firebase Storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | REQUIRED | FCM sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | REQUIRED | Firebase App ID |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | OPTIONAL | GA4 Measurement ID |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | OPTIONAL | FCM VAPID key for push notifications |

## 2.2 Firebase — Admin SDK (Server-side only — NEVER expose to client)

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_CLIENT_EMAIL` | REQUIRED | Service account email |
| `FIREBASE_PRIVATE_KEY` | REQUIRED | Service account private key (PEM with `\n` newlines) |

## 2.3 Supabase

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | REQUIRED | `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | REQUIRED | Supabase anon key (safe to expose) |
| `SUPABASE_SERVICE_ROLE_KEY` | REQUIRED | Service role key (server-only, never expose) |
| `SUPABASE_DB_URL` | OPTIONAL | Direct PostgreSQL connection URL (for migrations) |

## 2.4 Cryptographic Secrets — Server-only
**Generate with:** `openssl rand -hex 32` (produces 64-char hex string)

| Variable | Required | Description |
|----------|----------|-------------|
| `SIGNING_SECRET_KEY` | REQUIRED | General-purpose HMAC signing key |
| `ENCRYPTION_SECRET_KEY` | REQUIRED | AES encryption key for sensitive data |
| `RECEIPT_SIGNING_SECRET` | REQUIRED | HMAC key for payment receipt signing |
| `DOCUMENT_PRIVATE_KEY` | REQUIRED | RSA private key (PEM) for document signing |
| `DOCUMENT_PUBLIC_KEY` | REQUIRED | RSA public key (PEM) for document verification |
| `CRON_SECRET` | REQUIRED | Bearer token for cron job endpoint authorization |
| `WS_PRIVILEGED_TOKEN` | REQUIRED | Internal token for server→WS server trusted calls |

## 2.5 Payments — Razorpay

| Variable | Required | Description |
|----------|----------|-------------|
| `RAZORPAY_KEY_ID` | REQUIRED | Razorpay Key ID |
| `RAZORPAY_KEY_SECRET` | REQUIRED | Razorpay Key Secret (server-only) |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | REQUIRED | Key ID for client SDK initialization |
| `RAZORPAY_WEBHOOK_SECRET` | REQUIRED | Webhook signature secret |

## 2.6 Storage — Cloudinary

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | REQUIRED | Cloudinary cloud name |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | REQUIRED | Upload preset for unsigned uploads |
| `CLOUDINARY_API_KEY` | REQUIRED | API key (server-only) |
| `CLOUDINARY_API_SECRET` | REQUIRED | API secret (server-only) |

## 2.7 Email — Resend

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | REQUIRED | Resend API key |
| `ADMIN_EMAIL` | REQUIRED | Primary admin notification address |
| `EMAIL_FROM` | REQUIRED | Sender display name and address |
| `EMAIL_REPLY_TO` | OPTIONAL | Reply-to address |

## 2.8 Maps — PMTiles

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_GUWAHATI_PMTILES_URL` | OPTIONAL | URL of Guwahati PMTiles vector tileset (MapLibre) |

## 2.9 Analytics — Google Analytics

| Variable | Required | Description |
|----------|----------|-------------|
| `GA4_PROPERTY_ID` | OPTIONAL | GA4 property ID for analytics API |
| `GA_PROJECT_ID` | OPTIONAL | Google Cloud project ID for GA4 service account |
| `GA_CLIENT_EMAIL` | OPTIONAL | GA4 service account email |
| `GA_PRIVATE_KEY` | OPTIONAL | GA4 service account private key (PEM) |

## 2.10 WebSocket Runtime

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WS_PORT` | REQUIRED | `3001` | WebSocket server port |
| `NEXT_PUBLIC_WS_URL` | REQUIRED | — | Public WS URL (e.g. `wss://itms.example.com/ws`) |
| `HEALTH_PORT` | OPTIONAL | `9090` | Health/metrics HTTP server port |
| `WS_HOST` | OPTIONAL | `0.0.0.0` | Bind address |
| `REDIS_URL` | OPTIONAL | — | Redis URL for horizontal WS scaling (`redis://host:6379`) |

## 2.11 Performance & Limits

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RATE_LIMIT_PER_IP` | OPTIONAL | `100` | Max messages per IP per window |
| `RATE_LIMIT_PER_USER` | OPTIONAL | `200` | Max messages per user per window |
| `RATE_LIMIT_PER_SOCKET` | OPTIONAL | `60` | Max messages per socket per window |
| `RATE_LIMIT_WINDOW_MS` | OPTIONAL | `10000` | Rate limit window in ms |
| `MAX_PAYLOAD_SIZE` | OPTIONAL | `65536` | Max WS message size in bytes (64KB) |
| `HEARTBEAT_INTERVAL_MS` | OPTIONAL | `30000` | WS heartbeat ping interval (ms) |
| `HEARTBEAT_TIMEOUT_GRACE_MS` | OPTIONAL | `5000` | Grace period after heartbeat before eviction (ms) |
| `BROADCAST_BATCH_SIZE` | OPTIONAL | `100` | Max subscribers per broadcast batch |
| `OFFLINE_QUEUE_MAX` | OPTIONAL | `500` | Max offline queue depth per socket |
| `SLOW_HANDLER_MS` | OPTIONAL | `100` | Threshold for slow handler warning log (ms) |

## 2.12 Logging & Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | REQUIRED | `development` | `production` \| `development` \| `test` |
| `LOG_LEVEL` | OPTIONAL | `info` | `debug` \| `info` \| `warn` \| `error` |

## 2.13 Feature Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SEAT_RELEASE_AT_SOFT_BLOCK` | OPTIONAL | `false` | Release seat when student account is soft-blocked |

## 2.14 Application URLs

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | REQUIRED | Canonical public URL for CORS and redirects |

## 2.15 Fail-Fast Environment Validation
Both the Next.js App (`src/instrumentation.ts`) and WebSocket Server (`server/index.ts`) enforce deterministic fail-fast environment checks using `src/lib/env-validator.ts`:
- **Classification:** Every variable is classified as `public`, `private`, or `secret`, with defined lifecycle (`build-time`, `runtime`, `both`).
- **Fail-Fast Boot:** In `NODE_ENV=production`, if any required secret or public configuration variable is missing, the boot sequence halts immediately with exit code `1` and outputs structured error logs.
- **Development Warning:** In `NODE_ENV=development`, missing variables trigger explicit console warnings without halting boot.

---

# SECTION 3 — OPERATIONAL RUNBOOKS (RB-01 – RB-12)

> **IMPORTANT:** All commands assume SSH access to the production EC2 host. All environment paths assume deployment to `/home/ec2-user/itms/`.

## RB-01 — Standard Deployment

### Pre-conditions
- CI pipeline passes on the release commit (all 5 gates green)
- Health checks at `/health/ready` return `{ status: "ok" }`
- No in-progress incidents or active maintenance windows

### Procedure
```bash
# 1. Pull the latest release tag
cd /home/ec2-user/itms
git fetch --tags origin
git checkout tags/<VERSION>           # e.g. v1.4.0

# 2. Install dependencies (production only)
npm ci --omit=dev

# 3. Build Next.js
npm run build

# 4. Zero-downtime restart — Next.js via PM2
pm2 reload nextjs --update-env        # graceful reload, PM2 waits for new process ready

# 5. Zero-downtime restart — WebSocket server
# (PM2 reload triggers SIGINT → 30s drain → new instance starts)
pm2 reload websocket --update-env

# 6. Verify deployment
curl -s https://itms.example.com/api/health | jq .status
curl -s http://localhost:9090/health/ready | jq .status
pm2 list
```

### Verification
- `pm2 list` shows `online` for both `nextjs` and `websocket`
- `/api/health` returns `{ "status": "healthy" }`
- `/health/ready` on port 9090 returns `{ "status": "ok" }`
- Check structured logs: `pm2 logs --lines 50`

---

## RB-02 — Emergency Rollback

### Pre-conditions
- A deployment has caused regressions or availability impact
- Previous version tag is known (`git tag -l`)

### Procedure
```bash
# 1. Identify the previous good tag
git log --oneline --tags --no-walk

# 2. Check out previous tag
git checkout tags/<PREVIOUS_VERSION>

# 3. Reinstall and rebuild
npm ci --omit=dev
npm run build

# 4. Reload both processes
pm2 reload nextjs --update-env
pm2 reload websocket --update-env

# 5. Verify rollback
curl -s https://itms.example.com/api/health | jq .
```

### Expected Duration
- Rollback complete in < 5 minutes for a standard PM2 reload.

---

## RB-03 — Graceful WebSocket Server Restart

### When to Use
- Configuration change that requires WS server restart
- After environment variable rotation
- After server-layer TypeScript fix deployed

### Procedure
```bash
# PM2 reload (preferred — zero-downtime)
pm2 reload websocket --update-env

# OR: If reload fails, hard restart (< 30s downtime)
pm2 restart websocket
```

### Behaviour During Reload
- PM2 sends SIGINT to old process
- Old process: marks `healthService.startShutdown()` → NGINX /health/ready returns 503 → NGINX stops routing new connections → 30s drain → exits
- New process: starts, binds port, /health/ready returns 200 → NGINX resumes routing

---

## RB-04 — Secret Rotation

### Pre-conditions
- New secret value generated offline with sufficient entropy
- Vercel dashboard or EC2 `.env` file accessible

### Variables to Rotate

| Variable | Rotation Trigger | Minimum Entropy |
|----------|-----------------|-----------------|
| `CRON_SECRET` | Quarterly or on exposure | UUID v4 |
| `SIGNING_SECRET_KEY` | Annually or on exposure | 64 chars random hex |
| `ENCRYPTION_SECRET_KEY` | Annually or on exposure | 64 chars random hex |
| `RECEIPT_SIGNING_SECRET` | Annually or on exposure | 64 chars random hex |
| `SUPABASE_SERVICE_ROLE_KEY` | On Supabase key rotation | From Supabase dashboard |
| `FIREBASE_PRIVATE_KEY` | On Google service account key rotation | From Firebase console |
| `RAZORPAY_KEY_SECRET` | On provider rotation | From Razorpay dashboard |
| `WS_PRIVILEGED_TOKEN` | Quarterly | 64 chars random hex |

### Procedure
```bash
# 1. Generate a new secret
openssl rand -hex 32    # 64-char hex secret
python3 -c "import uuid; print(uuid.uuid4())"  # UUID

# 2a. Vercel: update via dashboard or CLI
vercel env rm CRON_SECRET production
vercel env add CRON_SECRET production   # enter new value at prompt

# 2b. EC2: update .env file
nano /home/ec2-user/itms/.env          # replace the variable value

# 3. Reload processes to pick up new value
pm2 reload nextjs --update-env
pm2 reload websocket --update-env

# 4. Verify cron endpoint responds correctly
curl -H "Authorization: Bearer <NEW_SECRET>" https://itms.example.com/api/cron/cleanup-stale-locks
```

---

## RB-05 — TLS Certificate Renewal

### Certbot (Let's Encrypt) Automatic Renewal
```bash
# Check expiry
certbot certificates

# Manual renewal (if auto-renewal fails)
certbot renew --nginx

# Reload NGINX to pick up new cert (no downtime)
nginx -s reload
```

### Verification
```bash
openssl s_client -connect itms.example.com:443 -servername itms.example.com 2>/dev/null \
  | openssl x509 -noout -dates
```

---

## RB-06 — Database Migration

### Pre-conditions
- Migration SQL written and reviewed
- Backup taken (see RB-09)
- Migration tested on staging database

### Procedure
```bash
# 1. Take backup first (mandatory)
# See RB-09 — Database Backup

# 2. Run migration via Supabase CLI
supabase db push --password <DB_PASSWORD>

# OR: apply SQL directly via psql
psql "$SUPABASE_DB_URL" -f supabase/migrations/<MIGRATION_FILE>.sql

# 3. Verify migration applied
supabase migration list

# 4. Run application integrity check
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://itms.example.com/api/cron/integrity-sweep
```

### Rollback SQL Pattern
Every migration file must include a corresponding rollback comment block:
```sql
-- Migration: add_column_x
-- Rollback: ALTER TABLE foo DROP COLUMN IF EXISTS x;

ALTER TABLE foo ADD COLUMN x TEXT;
```

---

## RB-07 — Emergency Shutdown

### When to Use
- Active security breach
- Data corruption in progress
- Uncontrolled resource exhaustion

### Procedure
```bash
# 1. Immediately stop all traffic — stop NGINX
sudo systemctl stop nginx

# 2. Stop application processes
pm2 stop all

# 3. Disable Vercel deployment if applicable

# 4. Notify stakeholders
```

---

## RB-08 — Redis Recovery
Redis is an optional horizontal-scaling component. The WS server gracefully degrades without Redis (in-process pub/sub).

```bash
# Restart Redis
sudo systemctl restart redis

# Verify Redis connectivity
redis-cli -u $REDIS_URL ping   # returns PONG

# Restart WS servers to reconnect transport-manager
pm2 restart websocket
```

---

## RB-09 — Database Backup (Supabase)

```bash
# Point-in-time restore is managed by Supabase for paid plans.
# For manual SQL dump:
pg_dump "$SUPABASE_DB_URL" \
  --no-owner \
  --no-acl \
  --format=custom \
  --compress=9 \
  -f "itms_backup_$(date +%Y%m%d_%H%M%S).dump"

# Verify dump integrity
pg_restore --list itms_backup_<TIMESTAMP>.dump | head -20
```

### Retention Policy
- **Daily dumps:** Retain 7 days
- **Weekly dumps:** Retain 4 weeks
- **Pre-migration dumps:** Retain indefinitely (tagged by migration name)

---

## RB-10 — Health Verification (Post-Deployment Checklist)
Run these checks within 5 minutes of every deployment:

```bash
# Next.js health
curl -s https://itms.example.com/api/health | jq .

# WS server health
curl -s http://localhost:9090/health/ready | jq .

# Prometheus metrics (spot-check)
curl -s http://localhost:9090/metrics | grep itms_ws_connections_active

# Active processes
pm2 list

# Recent logs (look for ERROR lines)
pm2 logs --lines 100 2>&1 | grep '"level":"error"'

# Database connectivity
curl -s https://itms.example.com/api/health/db | jq .
```

### Expected Values
- `api/health` → `{ "status": "healthy" }`
- `/health/ready` → `{ "status": "ok", "dependencies": { "firebase": "ok", "supabase": "ok" } }`
- `pm2 list` → both processes `online`, no restarts since deployment

---

## RB-11 — Scaling: Adding a WS Server Instance

```bash
# 1. Provision additional EC2 instance with identical user-data / .env

# 2. Add new server to docker-compose or PM2 fleet

# 3. Update NGINX upstream:
#    Add: server ws3:3001;
#    Reload NGINX: nginx -s reload

# 4. Verify new instance is receiving traffic:
#    curl http://ws3:9090/health/ready
```

---

## RB-12 — Incident Response

### Severity Levels

| Severity | Definition | Response Time |
|----------|-----------|--------------|
| SEV-1 | Total outage — no users can access the service | < 15 minutes |
| SEV-2 | Major degradation — GPS, trips, or student tracking not functioning | < 30 minutes |
| SEV-3 | Partial degradation — specific features affected | < 2 hours |
| SEV-4 | Minor degradation — cosmetic issues, minor errors | Next business day |

### Response Steps
1. **Detect:** Health endpoint alert / user report / log monitoring alert
2. **Assess:** Check `/api/health` and `/health/ready` and `pm2 logs`
3. **Communicate:** Post initial status to operations channel
4. **Contain:** Apply mitigation (rollback, restart, rate limit, shutdown)
5. **Verify:** Confirm recovery via health checks
6. **Post-mortem:** Write incident report within 48 hours
