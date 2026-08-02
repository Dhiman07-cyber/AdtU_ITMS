# 15 — Deployment & Operations Resilience

**Audit class:** failure-injection scenarios around deploy, rollback, Redis, PG/Firebase degradation, OOM, healthchecks.
**Method:** 12 scenarios traced through compose, deploy/rollback scripts, CI/CD, nginx, Dockerfiles, health endpoints, client reconnect logic. FAIL rows re-verified after the agent pass.

## Verdict summary

| # | Scenario | Verdict |
|---|----------|---------|
| 1 | WS node dies during deployment | **FAIL** |
| 2 | Redis restarts with 2000 connected | **RISK** |
| 3 | Supabase latency spikes to 1s | **RISK** |
| 4 | Firebase verification slows | **RISK** |
| 5 | Broken image deployed by CI | **FAIL** |
| 6 | nginx health-check flaps | **FAIL** |
| 7 | Container OOM kills | **FAIL** (no limits) |
| 8 | Rolling deployment during active trips | RISK (self-heals via HTTP path) |
| 9 | Graceful shutdown completeness | RISK (10s stop truncates 30s drain) |
| 10 | Docker healthcheck correctness | PASS (busybox wget is present in node:22-alpine) |
| 11 | Vercel + docker coexistence | **UNKNOWN** (architectural decision missing) |
| 12 | DB migrations on deploy | **FAIL** |

## Verified FAIL rows

### D-1 · Deployment is all-at-once; both WS nodes down together [VERIFIED]
- `scripts/deploy-compose.ts:63-67` — `docker compose build --no-cache` then `docker compose up -d`. No sequencing (`--no-deps`), no `--wait`, no drain step. Both ws1 and ws2 are recreated in parallel → **full WS outage for the whole startup window** (~20-60s+ cold `tsx` start). Compose's 10s default stop timeout SIGKILLs the server's 30s drain (`server/index.ts:100-103`).
- **Fix:** `docker compose up -d --no-deps ws1` then `ws2`; `stop_grace_period: 40s` on ws services.

### D-2 · Client never resubscribes after reconnect [VERIFIED — this is report 13's L-1]
- `ws-client.ts:136` replays only `pendingSubscriptions` (empty after acks, `:149`). After ANY failover/restart: sessions restored with zero subscriptions (report 13 L-1) + reconnect tokens are per-process in-memory (`session-manager.ts:20`) → cross-node restore impossible → full re-auth + fresh session → connected-but-deaf channels (waiting-flags, ack, trip events) until page reload. Location is rescued only by the 5s PG poll (`track-bus/page.tsx:522`).
- **Fix:** client re-sends ALL `handlers` channels on `open`/`auth_ok`; optionally persist reconnect tokens in Redis for cross-node restore.

### D-3 · Rollback is a no-op [VERIFIED]
- `scripts/rollback-compose.ts:22-28` — `docker compose down --timeout 30` then `up -d`: rebuilds/restarts the SAME broken images. No tag logic exists anywhere (GHCR `v*`/`sha-*` tags never referenced — compose has no `image:` entries, all services `build:`).
- **Fix:** compose consumes `image: ghcr.io/...:<tag>`; rollback = `up -d` with the previous tag from a release manifest.

### D-4 · GHCR pipeline disconnected from runtime; ws2 never smoke-tested
- `cd.yml:50-103` builds/pushes GHCR images and creates a release — **never deploys**. Since compose builds from source, the published images are dead weight. `scripts/health-check.ts:30-33` probes only ws1's 9090 (ws2's health port not published in compose) → a broken ws2 sails through the gate.
- **Fix:** deploy from CI using tagged images; publish ws2 health port and probe both.

### D-5 · No mem limits — OOM kills drop everything [VERIFIED]
- No `mem_limit`/`memory`/`cpus` on any compose service. `restart: unless-stopped` recovers, but per-process state is lost: rate buckets, offline queues, `liveBusLocations`, sessions + reconnect tokens. One memory-hungry node degrades the whole host (Grafana/Prometheus share it).
- **Fix:** `mem_limit` (2g ws, 1g nextjs) + heap-pressure alert.

### D-6 · Migrations are manual and the npm script is destructive [VERIFIED]
- `package.json:34` — `"migrate:supabase": "supabase db reset && supabase migration up"` — `db reset` **destroys the database**. Nothing in CI/CD runs migrations; deploys never touch the DB. Schema drift between Vercel (old code) and docker (new code) against one DB is unmanaged.
- **Fix:** `migrate:prod` = `supabase migration up --db-url ...` (never `db reset`), invoked from cd.yml before deploy with a backup gate.

### D-7 · No timeouts on Supabase/Firebase calls [VERIFIED]
- `src/lib/supabase-server.ts:35-42` — client created without fetch timeout; `withSecurity`'s `verifyIdToken` (`api-security.ts:271`) and WS auth (`authenticator.ts:49-53`) have no timeout. A 1s Supabase spike + 2000 students × 5s poll = ~400 req/s piling on the Next.js pool, no circuit breaker. WS Path A (URL token — what the client actually uses, ws-client.ts:109) has no verification timeout; client watchdog (~75-105s) eventually force-closes → reconnect loop → after 10 attempts permanent error.
- **Fix:** `AbortSignal.timeout(10000)` wrapper into `getSupabaseServer()`; 10s fail-closed cap on `verifyIdToken`.

## RISK rows
- **D-8 Redis restart (S2):** survives; cross-node relay pauses; self-heals via 2s HTTP pushes; but no resync of `liveBusLocations` snapshot on reconnect, no reconnect jitter (fixed 5s stampede), readiness lies (`health-service.ts:49-51` reports ok whenever `REDIS_URL` set), no alert.
- **D-9 Graceful shutdown (S9):** structure good (4003 close, drain, failsafe) but 10s compose timeout truncates the 30s drain; offline queue dropped (not flushed) on shutdown — bounded (TTL 5min, 500/socket), acceptable, but fix is free with `stop_grace_period`.
- **D-10 Rolling deploy during trips (S8):** trips survive (PG-backed locks + HTTP heartbeats); students see frozen map ≤35s; WebSocketTransport bridge queues (cap 500) with 3s retry drain — brief restarts lose few events. L-1/D-2 closes most of it.

## PASS / corrected
- **D-11 Healthcheck (S10):** node:22-alpine = Alpine+busybox → `wget` present; healthchecks are correct liveness semantics (`/health/live`). Earlier phase-1 "wget missing" Medium finding is **retracted**. Caveats: `start_period: 10s` vs `tsx` cold start is tight (transient unhealthy → restart churn); no readiness probe consumed anywhere.
- **D-12 No double cron execution:** the docker nextjs container has no scheduler; crons fire only on Vercel. Good.

## UNKNOWN — must decide
- **D-13 Vercel + docker API split:** the WS bridge only works from the docker nextjs (`transport/websocket.ts:24-25`, `WS_HOST=127.0.0.1:3001`). If HTTP traffic (incl. `/api/location/update` every 2s) is served by Vercel, `emitEvent` queues to an unreachable bridge → realtime broadcasts never fire → students depend on polling alone, silently. `.env.example:90` defaults `NEXT_PUBLIC_APP_URL` to a `.vercel.app` domain (suggesting Vercel is live); the runtime `.env` is not committed. **One source of truth is required** (docker/nginx for API+WS recommended, Vercel static/cron only).

## Ranked resilience gaps
| # | Gap | Severity | Effort |
|---|-----|----------|--------|
| 1 | All-at-once deploy, both WS nodes down together | Critical | Low |
| 2 | Client never resubscribes after reconnect (L-1/D-2) | Critical | Low |
| 3 | Rollback does nothing | Critical | Medium |
| 4 | GHCR pipeline disconnected; ws2 unsmoke-tested | High | Medium |
| 5 | No mem limits; OOM state loss | High | Low |
| 6 | Migrations manual + destructive script | High | Medium |
| 7 | No Supabase/Firebase timeouts | High | Low |
| 8 | Vercel/docker split undefined | High (UNKNOWN) | Decision |
| 9 | Redis reconnect: no resync/jitter/readiness/alert | Medium | Low |
| 10 | nginx passive-only health; flap churn | Medium | Low |
| 11 | Offline queue dropped on shutdown | Low | Low |

## Confidence
HIGH — D-1, D-3, D-5, D-6, D-7 re-verified against source this session; remaining rows agent-verified with cited lines.
