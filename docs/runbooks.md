# Operational Runbooks — ITMS

Canonical operational procedures for the ADTU Bus Services / ITMS platform.

Every procedure is deterministic and repeatable.
Every procedure lists its pre-conditions, steps, and verification.

> **IMPORTANT:** All commands assume SSH access to the production EC2 host.
> All environment paths assume deployment to `/home/ec2-user/itms/`.

---

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

# 3. Build Next.js (on EC2, or upload pre-built .next artifact)
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

### Rollback
See RB-02.

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
# 1. Immediately stop all traffic — update NGINX to return 503
# (fastest option: stop NGINX)
sudo systemctl stop nginx

# 2. Stop application processes
pm2 stop all

# 3. Disable Vercel deployment if applicable
# (From Vercel dashboard: Settings → Deployment → Disable Production)

# 4. Notify stakeholders
# See incident response template

# 5. Investigate and restore after root cause identified
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

---

*Runbooks version: PROGRAM-003-PHASE-07 | Last updated: 2026-07-26*
