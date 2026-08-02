# 08 — Observability & SRE Audit

## Business Understanding
A production bus system with real money, live GPS, and ~175 API routes needs metrics, alerting, tracing, and runbooks. The repo ships a full stack: prometheus, alertmanager, grafana (provisioned dashboards), a WS metrics service, an in-memory trace store, structured logging, SLO definitions, and maintenance-mode tooling.

## Verified Findings (all VERIFIED — grep-confirmed zero usage)

| # | Finding | Evidence |
|---|---------|----------|
| O1 | **No application metric is ever emitted.** `withObservability` (HTTP wrapper) and `wrapCronJob` (cron wrapper) exist but have **zero callers** in `src/`. Domain metric collectors (`trip-metrics`, `payment-metrics`, `gps-metrics`, etc.) are defined but never referenced by production routes. | grep across `src/` |
| O2 | **Alertmanager receivers are all empty.** `alertmanager/alertmanager.yml` defines routes with no receiver config → no page/email/slack target. Even if alerts fired, nobody is notified. | alertmanager.yml |
| O3 | **Tracing is a memory-only buffer.** TraceStore (cap 1000) is written by nothing; `/api/tracing` endpoints exist but no span is ever recorded. | tracing store + endpoints |
| O4 | **Grafana dashboards reference metrics nothing emits** (e.g., HTTP rate/latency panels over `app_*` series) — every panel is "No data". | grafana/dashboards/*.json |
| O5 | **SLO / error-budget are static mock values** — not derived from any real SLI. | SLO module |
| O6 | **Maintenance-mode is unenforced.** `isWriteBlocked` has zero callers in request paths — write-blocking during maintenance/rollback does nothing. | maintenance-mode module |

- **Impact:** Any regression in payment webhooks, trip locks, or the WS server is invisible until a user complains. The 3am page for a crashed WS node (C1) never arrives; the node restarts silently and students see "disconnected".
- **Fix (smallest safe, in order):**
  1. Wire `withObservability` into `withSecurity` (one place) → HTTP metrics appear.
  2. Wrap the 7 cron routes with `wrapCronJob` → cron success/failure is visible.
  3. Point one alertmanager receiver at a real channel (email/slack webhook) + alert rules for: WS process down (health 9090), payment webhook errors, trip lock failures, cron failures, queue depth.
  4. Connect TraceStore writes in `processMessage` (WS) and the payment service — then decide whether to export (Zipkin/OTLP) or drop it (ponytail: in-memory store is fine at current scale).

## Agent-reported findings (medium confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| prometheus scrape config only covers WS nodes' /metrics (9090) — no Node/Vercel HTTP metrics, no Postgres exporter | prometheus.yml | Medium |
| Structured logger exists (`structured-logger.ts`) and is used well in trip orchestrator, but most API routes use `console.log` (no JSON, no trace id) | grep console.log | High (pattern) |
| No runbooks/playbooks in repo (docs/handbooks exist but no on-call runbook) | docs/ | Medium |

## What is solid (verified)
- WS metrics service + `/metrics` endpoint (Prometheus format) on 9090; structured logger with error classes; audit log lines for connect/disconnect; health service with readiness/graceful shutdown.

## Recommendations
1. O1: instrument `withSecurity` + cron wrapper (single hooks, ~20 lines).
2. O2/O4: one real receiver; mark dashboards "no data until O1".
3. O6: either enforce `isWriteBlocked` in `withSecurity` (3 lines) or delete the module — dead code is worse than none.
4. O5: replace mock SLOs with counts from O1 (e.g., availability = 1 − 5xx/total) or delete.

## Confidence
High — all O-rows verified by grep/read this session.
