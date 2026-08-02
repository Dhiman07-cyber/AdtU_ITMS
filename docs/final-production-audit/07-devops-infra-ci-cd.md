# 07 — DevOps / Infrastructure / CI-CD Audit

## Business Understanding
Production runs on a VPS via docker-compose: nginx → ws1 + ws2 (WS nodes, port 3001, health 9090) + nextjs standalone (port 3000) + redis (optional) + prometheus/alertmanager/grafana. Vercel hosts the API routes (crons + HTTP) with the Next.js standalone build. CI/CD pushes two images (nextjs, ws-server) to GHCR and rolls them out. There is **no Terraform/ECS/ECR/CloudWatch anywhere** — confirmed by glob.

## Architecture
- `docker-compose.yml` — services: nginx, ws1, ws2, nextjs, redis, prometheus, alertmanager, grafana; `env_file: .env`; healthchecks; restart policies.
- `Dockerfile` (nextjs multi-stage), `server/Dockerfile` (ws node), `.github/workflows/ci.yml` + `cd.yml` (GHCR).
- `nginx/nginx.conf` — proxy for app (API) and WS nodes (ws1/ws2 with keepalive).
- `vercel.json` — 7 cron entries (see report 05).
- `scripts/*.ts` — preflight, deploy/rollback-compose, maintenance-mode, etc.

## Verified Findings

### H11a — `cleanup-trip-history` cron missing [VERIFIED]
- `src/app/api/cron/cleanup-trip-history/route.ts` exists; not present in `vercel.json` crons → PG growth (driver_trip_history, bus_locations 1Hz rows).

### C2 — expiry cron schedule never matches code gates [VERIFIED]
- Full analysis in report 05. DevOps angle: the two scheduled expiry crons (Jun 1, Jun 15) can never fire the Mar 1 / Apr 1 gates; `type=main`/`type=mid-june` param handling must match route expectations.

## Agent-reported findings (medium confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| No resource limits (`mem_limit`/`cpus`) on any compose service; no `volumes` for redis (data loss on restart) | docker-compose.yml | Verified (read) |
| Ports 3001/3003 exposed on host (beyond nginx) | docker-compose.yml | Verified (read) |
| Dockerfile build ARGs (MEASUREMENT_ID, etc.) vs `build.args` in compose — mismatch risk (build succeeds with defaults, env differs from prod) | Dockerfile + compose | Medium |
| ws-node healthcheck uses `wget --spider` in `node:22-alpine` — wget not guaranteed present in alpine | server/Dockerfile | Medium |
| nginx: `keepalive 32` without `proxy_http_version 1.1` on app upstream (keepalive ineffective / 1.0); default `client_max_body_size 1m` vs profile-photo uploads; no nginx-level rate limiting | nginx.conf | Medium |
| CI: no `npm audit`/dependency vulnerability gate, no DB-migration smoke test (fresh-schema apply), no WS integration test in pipeline (only unit tests) | ci.yml | Medium |
| `.env` secrets file presence at repo root — untracked, but referenced; secret hygiene relies on .gitignore discipline | repo root | Low |
| Deploy scripts (`deploy-compose`, `rollback`) exist but no E2E validation after deploy (only healthchecks) | scripts/ | Medium |

## What is solid (verified)
- GHCR-based CI/CD with separate ws/next images; healthchecked rollout (ws1/ws2 rolling).
- nginx terminates TLS (per config) and proxies WS upgrade headers for ws1/ws2.
- Vercel cron secrets (`CRON_SECRET`) guard cron routes.
- Restart policies + graceful shutdown (SIGTERM/SIGINT handlers in server/index.ts).

## Recommendations
1. C2 + H11a: fix vercel.json schedules (add Mar 1, Apr 1; add cleanup-trip-history).
2. Add `mem_limit`/`cpus` to compose services; add redis volume.
3. Stop exposing 3001/3003 (or bind to 127.0.0.1).
4. CI: add `npm audit --omit=dev` (fail on high), a scratch-DB schema apply test (catches C3), and run WS server tests + a WS round-trip test.
5. nginx: `proxy_http_version 1.1` + keepalive on app upstream; raise `client_max_body_size` to match upload limits (e.g., 5m).
6. Move to IaC (Terraform or plain Ansible) only if the VPS fleet grows beyond one box — ponytail: not needed for current scale.

## Confidence
High for VERIFIED rows; Medium for agent rows.
