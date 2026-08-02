# MASTER_FINAL_PRODUCTION_AUDIT

**ITMS — full-repository production audit, consolidated and cross-verified.**
Date: 2026-08-02 · Scope: 812 files / ~159K lines / 175 API routes · Read-only (no code changed)
Method: 12 domain audits (see `docs/final-production-audit/01`–`11`) + personal re-verification of every Critical/High finding against source. Each finding below carries a **confidence** label: `[V]` = verified by re-reading source in this session; `[A]` = agent-verified during domain walkthrough, evidence cited.

---

## CRITICAL (fix first — crash, money, or unreachable core behavior)

### CR-1 · WS pre-auth socket crash kills a node [V]
- `server/websocket-server.ts:32,205` — `'error'` listener attached only after auth; pre-auth socket error (64KB maxPayload, bad UTF-8, reset) → uncaught exception. `server/index.ts:120-121` has only SIGTERM/SIGINT — no `uncaughtException`.
- Impact: one malformed socket crashes a WS node; all sessions drop; in-memory state lost. WS fleet = ws1/ws2.
- Fix: attach error listener at connection start + process-level handlers. → Plan item P1.

### CR-2 · Expiry reminders can never fire [V]
- `vercel.json:4-10` schedules Jun 1 + Jun 15; gates are Mar 1 (R1) / Apr 1 (R2) / Jun 15 (final) (`deadline-computation.ts:161-176`); final requires `expiryReminderCount === 2` (`expiry-check.ts:95-99`), which requires R1+R2 to have fired. Both impossible.
- Impact: zero renewal reminders ever sent to students; reliance on manual outreach. Revenue + service-continuity risk.
- Fix: schedule Mar 1/Apr 1 (+ keep Jun 15) or relax count gate. → P2.

### CR-3 · Fresh database cannot be built [V]
- `Firestore_to_supabase_migration.sql:54-61` drops `driver_profiles.bus_id/route_id/shift` (no-op fresh), then `:1181-1183` creates indexes on those columns → `column "bus_id" does not exist` → migration aborts. `COMPLETE_SCHEMA.sql` also not self-contained; the two files disagree (`reassignment_logs.operation_id` UNIQUE vs TEXT).
- Impact: no working schema path for staging, DR, or new environments; "canonical" file is a lie.
- Fix: make one file runnable fresh; CI smoke test. → P5.

### CR-4 · Scanner authorization is dead code [V]
- `src/lib/security/scanner-auth.ts:102-105` — after the ownership check fails, ANY non-empty `scannerBusId` passes; `:35` returns true for non-string bus ids.
- Impact: any driver scans/verifies any student on any bus; boarding verification meaningless; student PII (name, enrollment, photo, shift, validUntil) readable.
- Fix: delete the fallback block. → P3.

### CR-5 · Aadhaar PII exposure: moderators & drivers [V]
- `moderators/[id]/route.ts:26,75` — any moderator reads any moderator's Aadhaar/DOB/phone (no permission gate).
- `drivers/[id]/route.ts:10,24` — student/driver roles fetch full driver record incl. Aadhaar/license.
- `students/route.ts:19,87-111` — drivers list all students with parent phone/DOB/email (no bus scoping, no stripping).
- Impact: national-ID-grade PII available to the wrong roles. DPDP/GDPR exposure.
- Fix: permission gates + field-level stripping. → P3.

## HIGH

### HI-1 · `busId === busId` self-comparison — any driver with ≥1 bus approves/rejects ANY student's profile update [V]
- `src/app/api/driver/handle-profile-update/route.ts:79` (+ deletes the student's Cloudinary photo on approve, `:95-113`). → P3.

### HI-2 · Arbitrary Cloudinary deletion by any authenticated user [V]
- `src/app/api/delete-image/route.ts:23,54,62` — no ownership check; publicId format-guessable. → P3.

### HI-3 · Payment "self-healing" never heals [V]
- `src/lib/payment/payment.service.ts:137-152` — missing renewal application is logged, never created; paid student stuck at `already_processed` forever. Real money, no service. → P6.

### HI-4 · `maybeSingle` on `applications.applicant_uid` → 406 → 500 [V]
- `src/domains/application/repositories/application.repository.pg.ts:215-230`; renewals create 2+ rows by design; no unique constraint. → P6.

### HI-5 · SECURITY DEFINER RPCs granted to `authenticated` [V]
- `production_bootstrap_fixes.sql:438,457,498`; `fix_fcm_lock_rpc.sql:69`; lock RPCs `Firestore_to_supabase_migration.sql:939-1007`. App never uses `authenticated`; Supabase `auth.enabled=true` makes it one config away from exploitable. → P8.

### HI-6 · WS rate limit collapses to one shared IP bucket behind nginx [V]
- `server/websocket-server.ts:39,258` + `rate-limiter.ts:27-32` — all clients share ~100 msgs/10s; ~2 concurrent users exhaust it. → P8.

### HI-7 · Redis RESP parser breaks on `\r\n` inside bulk strings [V]
- `server/redis-client.ts` — line-based framing corrupts JSON payloads containing CRLF. → P8.

### HI-8 · Live bus locations never cleared [V]
- `server/socket-router.ts:54-65` — `clearLiveBusLocation` zero callers; stale coordinates broadcast after trip end. → P4.

### HI-9 · Renew-services idempotency key is dead code [V]
- `src/app/api/renew-services/route.ts:94-99` — `operationKey` never used; offline double-submit re-applies renewal. Also no moderator permission gate (`:53`) and `adminUid` trusted from body. → P6.

### HI-10 · Cron coverage holes [V]
- `cleanup-trip-history/route.ts` exists, not scheduled → PG growth (bus_locations at 1Hz).
- Jun 1 expiry cron permanently no-op (CR-2). → P2/P5.

### HI-11 · Observability is a shell [V]
- `withObservability`/`wrapCronJob` zero callers; alertmanager receivers EMPTY; dashboards plot nothing; tracing store never written; `isWriteBlocked` unenforced; SLOs static mocks. → P9.

### HI-12 · Renewal approval idempotency: fresh-approval double-increment [A]
- Approval service may increment capacity twice on retry (evidence: approval service walkthrough). → P6 (verify first).

### HI-13 · No FKs, dormant RLS, missing indexes [A/V]
- 28 tables, no `REFERENCES`; RLS on 16 tables but app uses service role only; `GRANT SELECT USING(true)` on public tables; missing `notifications(recipient_ids)`/`fcm_tokens` indexes. → P7.

## MEDIUM

- **M1** · Stale-lock cron daily 04:00 vs 600s hardcoded stale-delete; TTL param ignored for cleanup [V] — `migration:953-980`. → P4.
- **M2** · Heartbeat/device-session constant mismatches (client 60s vs server; 30s/60s) [A]. → P4.
- **M3** · WS `tokenAuthCache` unbounded when all tokens valid [A]. → P8.
- **M4** · WS session restore delete+create (brief gap) [A]. → P8.
- **M5** · `expiryReminderCount` read-modify-write non-atomic [V] — `expiry-check.ts:130-137`. → P6.
- **M6** · Firestore mirror failures swallowed [V] — `handle-profile-update/route.ts:137-139` pattern. → P6.
- **M7** · ack-flag / mark-boarded lack bus revalidation [A]. → P4.
- **M8** · Reassignment path ignores capacity guard; `eligibleApproval` client-controlled; `submit()` IDOR [A]. → P6/P3.
- **M9** · CSRF: Origin check only when header present; `allowBodyToken` default merges query token [A]. → P3.
- **M10** · API rate limit trusts first `X-Forwarded-For` (spoofable) [A]. → P3.
- **M11** · delete-image rate limit is per-user (10/60s) — weak for bulk destruction but bounded [V]. → P3 (with HI-2).
- **M12** · Docker-compose: no resource limits, no redis volume, ports 3001/3003 exposed [A]. → P5.
- **M13** · nginx: app-upstream keepalive without `proxy_http_version 1.1`; 1MB `client_max_body_size` vs uploads; no nginx rate limit [A]. → P5.
- **M14** · CI: no `npm audit`, no schema-apply smoke test, no WS integration test [A]. → P5.
- **M15** · Encryption key derived from `payment_id`; receipt 64-char signature truncation [A]. → P6.
- **M16** · WS client: `idToken`+`reconnect_token` in URL query; localStorage reconnect token [A]. → P8/P3.
- **M17** · PWA SW cache invalidation; page-hook subscription cleanup; no manual retry after 10 backoff attempts [A]. → P10.

## LOW / INFO

- **L1** · `studentData.busId || studentData.busId` self-redundant (`handle-profile-update:62`), `renewalBusId` triple self-or (`renew-services:207`) [V].
- **L2** · `.env` secret hygiene relies on .gitignore discipline; `.env.example` committed [A].
- **L3** · Hand-rolled auth in 8+ settings routes instead of `withSecurity`; inconsistent `audit_events` [A].
- **L4** · Docs stale vs code (§9.2 soft-block +1/+2 discrepancy) [A].
- **L5** · Session-restore race duplicates reconnect tokens on fast refresh [A].

## ARCHITECTURAL DEBT

- **AD-1** Dual-write (PG canonical + Firestore mirror + Redis) — divergence invisible; mirror errors swallowed (M6). Consolidate or reconcile via `audit_events`.
- **AD-2** Two schema files + bootstrap file with conflicting definitions; no single source of truth (CR-3).
- **AD-3** Role checks split across `withSecurity`, `verifyApiAuth`, and hand-rolled variants — inconsistent coverage; every new route must remember the pattern.
- **AD-4** RLS designed but dormant; either adopt token exchange (JWT with `authenticated` role) or strip RLS/grants to reduce attack surface (HI-5).
- **AD-5** WS node in-memory state (sessions, locations, rate buckets) — restart loses everything; Redis adoption incomplete (H7 blocks cross-node correctness).

## FUTURE

- **F-1** IaC (Terraform/Ansible) only when fleet >1 box (ponytail: not needed now).
- **F-2** OTLP export / Zipkin when tracing volume warrants; in-memory store is fine today.
- **F-3** Per-account lock granularity for rate limiting if single-node scale demands (currently global buckets are the actual bug, not the granularity).
- **F-4** Audit-export (CSV/API) for the ledger per DPDP/GDPR compliance.

## OPS / DEVOPS

- Scheduled: 7 crons, 2 of which are wrong (CR-2) and 1 missing (HI-10). `CRON_SECRET` guarding is solid.
- Deploy: GHCR images, compose rollout with healthchecks — solid baseline. Add resource limits, redis volume, close exposed ports (M12).
- Alerting: empty receivers (HI-11) — the single most important ops fix after CR-1.

## SCALABILITY

- WS: 1Hz GPS × N buses → `liveBusLocations` + Redis keys; bounded by memory per node; fine at current scale; revisit at >50 concurrent trips/node.
- PG: bus_locations/trip_history grow unbounded without scheduled cleanup (HI-10); add indexes only when query plans demand (agent check M13-analog).
- Rate buckets: O(users) in-memory maps with 60s sweeper — fine.

## MAINTAINABILITY

- `ponytail:` markers show intentional shortcuts (capacity fast-fail, etc.) — good practice; the `pgIncrementBusCapacity` generic-error TODO is the one to close (R10).
- Dead code to delete: scanner fallback (CR-4), idempotency key (HI-9), `isWriteBlocked` if unenforced (HI-11), `endSuppressed`-era remnants (none found — good).
- Test inventory: WS unit tests + trip atomicity tests exist and are well-structured; no tests for payment self-heal, scanner auth, cron gates — add the 3 highest-value tests with the fixes.

---

# PHASE 2 — Dynamic behaviour audit (workflow races, long-running sessions, scale, deploy resilience)

Second wave answering: *"will the system still behave correctly after 3 years of real-world usage?"* — four new audit classes, each re-verified against source. Full detail: reports `12`–`15`.

## New CRITICAL

### CR-6 · Reconnect restores the session with ZERO subscriptions [V]
- `websocket-server.ts:146-147` runs `subscriptionManager.unsubscribeAll(oldSession)` BEFORE `restoreSession`; `unsubscribeAll` clears the session's `subscriptions` Set (`subscription-manager.ts:25-30`), so `restoreSession` (`session-manager.ts:151,167`) restores nothing, and the `channelSubscriptions` reverse index is never repopulated for the new socketId. Client re-sends only `pendingSubscriptions` (emptied by acks, `ws-client.ts:136,149`).
- Impact: after EVERY network flip / failover / deploy, the client is connected-but-deaf — frozen map, no waiting-flag/trip events — until page reload. The single most user-visible realtime bug.
- Fix: copy the channel list before `unsubscribeAll`; re-add new socketId to the reverse index; client resends all `handlers` channels on `auth_ok`. → Plan P21.

### CR-7 · Deployment takes the whole WS fleet down; rollback does nothing [V]
- `scripts/deploy-compose.ts:63-67` — `up -d` recreates ws1+ws2 in parallel (full outage); compose 10s stop timeout truncates the 30s drain. `scripts/rollback-compose.ts:22-28` — `down` + `up -d` restarts the SAME broken build; no image tags anywhere.
- Fix: sequence ws1→ws2 with `--no-deps --wait`; `stop_grace_period: 40s`; consume GHCR tags + rollback to previous tag. → Plan P30-P32.

### CR-8 · Students shown stale trips and frozen positions with no staleness signal [V]
- `trip-status/route.ts:48-56` — no `expires_at` filter → trips whose lock expired (driver dead; cron daily 04:00) show `tripActive: true` up to 24h. `liveBusLocations` never cleared + no expiry + pushed to new subscribers (`socket-router.ts:54-66,76-83`); client staleness guards exist but are unused.
- Fix: filter `expires_at`; timestamp locations; client clears marker after 60s. → Plan P22, P23.

## New HIGH

| # | Finding | Evidence | Ref |
|---|---------|----------|-----|
| HI-13 | Offline queue is dead code — keyed by server socketId that no reconnect reuses; wiped on close before any drain; `trip_ended` never reaches offline students | `offline-queue.ts:37-44`; `connection-cleanup-service.ts:15`; `websocket-server.ts:286-288` | 13 L-3 |
| HI-14 | After ~1h, Firebase token expiry → 4001 → clients WITHOUT `getNewToken` (track-bus, driver, useBusLocation) enter permanent error until reload | `ws-client.ts:168-174`; `track-bus/page.tsx:370` | 13 D2 |
| HI-15 | Awaited `active_trips` write on every GPS push — ~100 awaited PostgREST writes/s at 200 buses, drives p99; a 20s throttle already exists for the identical purpose | `location/update/route.ts:52-65` | 14 P-1 |
| HI-16 | Students list: default & busId paths return the FULL table (`.select('*')`, no range) — multi-thousand-row PII dump per request | `students/route.ts:84`; `student.repository.pg.ts:447-455` | 14 P-2 |
| HI-17 | Redis: no publish buffering (silent loss), startup-deaf node if Redis down at boot, no keepalive (silent partition never reconnects), readiness lies, no resync | `redis-client.ts:44-91,167-188`; `index.ts:34-47`; `health-service.ts:49-51` | 13 L-5 |
| HI-18 | No timeouts on Supabase queries or Firebase verify (HTTP + WS auth) — 1s PG spike + 5s polls = pile-up, no circuit breaker | `supabase-server.ts:35-42`; `api-security.ts:271` | 15 D-7 |
| HI-19 | Migrations manual + destructive (`"migrate:supabase": "supabase db reset && supabase migration up"`); nothing on the release path | `package.json:34` | 15 D-6 |
| HI-20 | Vercel + docker API split undefined — WS bridge only reachable from docker (`WS_HOST=127.0.0.1:3001`); if HTTP is served by Vercel, realtime broadcasts silently never fire | `transport/websocket.ts:24-25`; `.env.example:90` | 15 D-13 |
| HI-21 | Concurrent approve+reject of one profile update deletes BOTH Cloudinary photos (no CAS on status) | `handle-profile-update/route.ts:95-120,150-175` | 12 W-1 |
| HI-22 | No unique guard on active applications per student → double approval = double seat + double payment, single row | `application.service.ts:155-226`; schema | 12 W-2 |
| HI-23 | Scan/board doesn't revalidate trip or current bus; waiting flags survive reassignment | `bus-pass/verify-student/route.ts:67,121-136`; reassign RPC | 12 W-3 |
| HI-24 | Renewal vs soft-block cron race — just-paid student can be soft-blocked + seat released | `cleanup-expired-students/route.ts:140-250`; RPC `:1687-1719` | 12 W-4 |
| HI-25 | No mem limits in compose — OOM kills drop sessions/tokens/queues/locations; one node can degrade the whole host | `docker-compose.yml` | 15 D-5 |

## New MEDIUM
- **M18** · `clearRateLimitsFor` O(n) per disconnect → O(n²) churn (`rate-limiter.ts:34-38`) · heartbeat `missedCount` unbounded leak (`heartbeat-service.ts:39-51`) [V]
- **M19** · Broadcast waste: dead `bus:` channel broadcast, encode with 0 subscribers, Redis publish per tick regardless of audience; sync `BROADCAST_BATCH_SIZE` slicing is dead weight [V]
- **M20** · Duplicate reads in student hot paths: 3× `active_trips` in dashboard-data, 2× student fetch in trip-status [V]
- **M21** · dashboard-counts ships the whole payments ledger to JS (`select('amount, source')` no limit) [V]
- **M22** · WS core import cycles (socket-router ↔ websocket-server, subscription-manager ↔ socket-router) [V]
- **M23** · GHCR pipeline disconnected (cd.yml never deploys; compose has no `image:`); ws2 health port unpublished, never smoke-tested [A]
- **M24** · Redis reconnect: fixed 5s no jitter; no alerting; healthcheck `start_period 10s` vs tsx cold start → transient unhealthy/restart churn [A]
- **M25** · `tokenAuthCache` pruned only when >1000 (dead entries linger) [A]
- **M26** · nginx passive-only health (max_fails TCP), no active checks [A]
- **M27** · 30s drain truncated by compose 10s stop timeout; offline queue dropped (not flushed) on shutdown [A]

## Retracted / corrected
- Phase-1 "ws healthcheck wget missing in node:22-alpine" — **RETRACTED**: busybox ships wget in alpine. Healthchecks are correct liveness semantics.
- Phase-1 "FCM end suppression" — remains discarded (never reproduced).
- New positive: capacity FOR UPDATE guard, approval CAS lease, trip-lock atomic INSERT, payment uniqueness, timer/listener census all verified CLEAN in the dynamic pass (reports 12, 13, 14).

---

**Confidence legend:** [V] verified against source this session (38 findings) · [A] agent-verified with cited evidence (18 findings). Two agent claims corrected/retracted as noted. Cross-references: reports `01`–`15` in this folder; ordering & dependencies: `FINAL_IMPLEMENTATION_PLAN.md`.
