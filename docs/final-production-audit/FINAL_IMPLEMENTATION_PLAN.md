# FINAL_IMPLEMENTATION_PLAN

**ITMS production fixes — five milestones, smallest safe change first.**
Read-only audit → this plan. No behavior changes unless behavior is wrong. Item IDs (P1–P38, D1–D7) are stable and match the reports (`MASTER_FINAL_PRODUCTION_AUDIT.md`, `01`–`15`). Items within a milestone are independent unless noted.

---

# ⚠️ VALIDATE FIRST — do not blindly implement these six

The audit flagged these as *ideas*, not finished changes. Each needs validation against the exact business rules and existing code before implementation. Criteria below; if validation fails, implement the smaller fallback listed; if validation proves the existing implementation is correct, **document it and make no code changes** — leaving working code alone is a valid outcome.

## Ground rules — evidence required for every implementation
1. **No implementation without evidence.** Every fix ships with a reproducer, benchmark, failing test, trace, or measurable before/after. "It looks inefficient" is not evidence; a profile, a failing test, or a reproduced incident is.
2. **Every fix includes a rollback path.** One-command revert to the previous behavior (git revert, image tag, migration down, feature flag). If a fix cannot be rolled back, it is not ready.
3. **Every fix preserves business rules, security, consistency, and API contracts.** Changes to schemas, payloads, status codes, and state transitions require an explicit note stating what is preserved. Money paths additionally require the V4-style data check first.

## The six validation gates

### V1 · Redis RESP parser rewrite (P14)
- **Why cautious:** the hand-rolled parser works today for everything it actually processes. A rewrite touches the cross-node broadcast path.
- **Validate:** (a) enumerate what is published: does any channel carry free text (waiting-flag notes, notification content, student names) that could legally contain `\r\n`? GPS payloads are numeric — they cannot. (b) Reproduce the failure: unit test a bulk string containing `\r\n` through the current parser.
- **Do Nothing if:** no free-text channel exists and the test shows all actual payloads parse correctly — document the analysis in the code comment and stop.
- **Fallback if a free-text channel exists:** keep the parser, add the length-aware fix ONLY to the bulk-string read (small diff), or defer with a comment. If a free-text channel exists: rewrite is required.

### V2 · Reconnect/subscription architecture (P21)
- **Why cautious:** the fix touches the session-restore path that cleanup/dedup accounting also depends on (double-add risk, stale socketIds in the reverse index after close).
- **Validate:** write the integration test FIRST (connect → subscribe → drop TCP → reconnect with reconnect_token → assert messages arrive). It will fail against current code (report 13 L-1). Then fix with the test as the safety net. Confirm the client `handlers` map actually persists across reconnects in one page instance (it does — only `pendingSubscriptions` is emptied).
- **Do Nothing if:** the test passes against current code (restore already re-arms subscriptions in your branch) — document and stop.
- **Fallback if restore rework proves fragile:** client-side only — resend all `handlers` channels on `auth_ok` (P21 half). Slightly more subscribe traffic, zero server-restore risk.

### V3 · Offline queue rework (P25)
- **Why cautious:** queue semantics (keyed by socketId, TTL 5min, cap 500) are load-bearing for the reconnect path; uid-keying changes multi-device behavior.
- **Validate:** (a) enumerate `enqueueOffline`/`drainQueue` callers — what actually gets queued? (b) decide multi-device semantics: two devices, same uid — drain to both, or first-one-wins? (c) confirm TTL/cap still hold under uid-keying.
- **Do Nothing if:** the audit shows nothing meaningful is ever queued in practice, or every queued-event loss is already covered by the UI's HTTP refetch — document and stop.
- **Fallback if uid-keying is wrong for your rules:** keep socketId keying; instead have the client refetch `trip-status` on `auth_ok` (one HTTP call, no queue change). Take the fallback unless a real queued-event loss case is demonstrated.

### V4 · Application uniqueness constraint (P29)
- **Why cautious:** adding a unique index can fail on existing data or break a legitimate business flow (e.g., `renewal_after_soft_block` + `new_registration` in the same cycle, or resubmit-after-reject).
- **Validate:** (a) run the offender query against prod data: `SELECT applicant_uid, count(*) FROM applications WHERE state IN ('submitted','approved','verified','awaiting_verification','verified_upcoming','pending_seat_allocation') GROUP BY 1 HAVING count(*) > 1;` (b) decide the rule for each offender (keep latest, archive rest) — never auto-merge money-bearing rows; (c) confirm the approve flow never legitimately needs two active applications for one student.
- **Do Nothing if:** the offender query returns zero rows AND no flow can produce two active applications for one student — the index is optional hardening; document and skip.
- **Fallback:** skip the index; fix `pgFindByApplicantUid` with `order+limit(1)` only (P10) and add the index later once the data rule is settled.

### V5 · Firestore/schema migration cleanup (P7)
- **Why cautious:** dropping/archiving `COMPLETE_SCHEMA.sql` and index statements touches the DB bootstrap path; `production_bootstrap_fixes.sql` uses `CREATE TABLE IF NOT EXISTS` which silently tolerates shape drift.
- **Validate:** (a) grep the app for `driver_profiles.bus_id/route_id/shift` — if zero read/write paths exist, the three index statements are dead and safe to drop; (b) apply the 3 files in order to a scratch Supabase (docker `supabase/postgres`), assert schema + RPCs; (c) diff `COMPLETE_SCHEMA.sql` vs `Firestore_to_supabase_migration.sql` table definitions for drift before archiving — if they differ beyond `reassignment_logs.operation_id`, reconcile first.
- **Do Nothing if:** scratch apply passes without changes, no column usage exists, and no file drift — the migrations are already consistent; document and stop.
- **Fallback:** only fix the three failing index statements; leave file organization for later.

### V6 · Large architectural simplifications (P38 Vercel/docker split; AD items)
- **Why cautious:** "pick one source of truth" is correct in principle but may be wrong in practice if Vercel is NOT serving HTTP traffic today.
- **Validate (runtime, not code):** (a) check which runtime actually serves `/api/*` — Vercel project settings, `NEXT_PUBLIC_APP_URL`, request logs; (b) check whether realtime broadcasts actually work in prod right now (grafana/prometheus data, or a manual WS subscribe test against the prod URL); (c) only if the bridge is unreachable → decide.
- **Do Nothing if:** HTTP already routes through docker/nginx and broadcasts work — there is nothing to fix; document the decision and stop.
- **Fallback:** if the split is ambiguous but broadcasts work, do not restructure; add the bridge-connectivity health check only.

---

# Milestone 1 — Critical correctness (money · concurrency · authorization · application races)

*What can lose money, leak PII, or corrupt business state. Highest human-cost items first.*

### M1-1 · Payment self-heal (P9 · HI-3) — money
- `payment.service.ts:137-152`: actually create the missing `online_<paymentId>` renewal application in the self-healing branch; return `success`. On failure return `error` (not `already_processed`) so webhook retries continue.
- **Validate:** review the application-factory contract first (money path). **Verify:** unit test — processed payment w/o application → self-heal creates it; second call → `already_processed`.

### M1-2 · maybeSingle 406 → 500 (P10 · HI-4) — money/flow
- `pgFindByApplicantUid`: `.order('submitted_at', {ascending:false}).limit(1).maybeSingle()`. Data check + partial unique index DEFERRED to V4.
- **Verify:** unit test with 2 rows.

### M1-3 · Renew-services idempotency + permission gate (P11 · HI-9) — money
- Partial unique index on manual payments `transaction_id` (Offline only); on unique violation → `already_processed` per student. Add `requireModeratorPermission(auth,'students','canEdit')`; stop trusting `adminUid` from body.
- **Verify:** double-submit test (same transactionId → second rejected).

### M1-4 · Capacity error typing (P12 · R10)
- `pgIncrementBusCapacity` → throw `CapacityFullError` (code TODO exists). Renew-services `:236` catch then behaves.

### M1-5 · Scanner fallback removal (P2 · CR-4) — authorization
- Delete `scanner-auth.ts:102-105` fallback; tighten `scannerBusMatchesStudent` `:35`. **Verify:** 403 for unassigned driver.

### M1-6 · Profile-update & delete-image authorization (P3 · HI-1, HI-2) — authorization
- Fix `busId === busId` (`handle-profile-update/route.ts:79`); ownership check in `delete-image` (own-asset list or signed one-time delete token).

### M1-7 · PII role stripping (P4 · CR-5) — authorization
- Gate `moderators/[id]` on `staff.canView`; strip Aadhaar/DOB in `drivers/[id]` for driver/student roles; scope `students/route.ts` to driver's own bus + strip parent/DOB/phone.

### M1-8 · CSRF/rate-limit hardening (P5 · M9, M10) — authorization
- Always require Origin on state-changing methods (after confirming nginx headers); `getClientIp` from `x-real-ip`. **Risk:** medium — deploy after confirming proxy headers.

### M1-9 · Revoke `authenticated` RPC grants (P8 · HI-5) — authorization/DB
- One migration: `REVOKE EXECUTE ... FROM authenticated` on all lock/capacity/FCM RPCs. Confirm `enable_signup` state in `config.toml`.

### M1-10 · Cron gates & schedules (P6 · CR-2, HI-10) — business correctness
- vercel.json: Mar 1 + Apr 1 (+ keep Jun 15); remove dead Jun 1 entry; relax `expiryReminderCount` gate (send when below stage threshold); add `cleanup-trip-history` weekly cron. Verify route's `type=` branching.

### M1-11 · Profile-update CAS (P28 · HI-21) — concurrency
- Firestore transition via transaction with `status='pending'` precondition; Cloudinary deletes only after winning the CAS (never both images).

### M1-12 · Application races (P29 · HI-22/23/24) — application races
- Unique index per V4 validation; `mark-boarded` re-checks `active_trips` + student's current bus; reassign RPC deletes the student's `raised/acknowledged` flags; soft-block cron recomputes from the fresh row (renewal-vs-softblock race).

### M1-13 · Debt from this domain (D4, D5)
- Reassignment capacity guard + `eligibleApproval` server-side + `submit()` ownership; ack-flag/mark-boarded bus revalidation — verify each against the application domain first.

---

# Milestone 2 — Realtime (websocket · reconnect · GPS · stale trips · subscriptions)

*What students feel every day: frozen maps, dead channels, silent reconnects.*

### M2-1 · WS pre-auth crash guard (P1 · CR-1)
- Attach `ws.on('error')` at connection start (before auth); add `uncaughtException`/`unhandledRejection` handlers in `server/index.ts` (log + fail-fast).
- **Verify:** unit test — oversized pre-auth frame → server stays alive.

### M2-2 · Reconnect restores subscriptions (P21 · CR-6) — **see V2, write the failing test first**
- Capture channels BEFORE `unsubscribeAll`; repopulate `channelSubscriptions` for the new socketId; client resends all `handlers` channels on `auth_ok`.
- **Verify:** integration test connect→subscribe→reconnect→assert delivery.

### M2-3 · Firebase token refresh on reconnect (P24 · HI-14)
- `getNewToken` for track-bus / live-tracking / useBusLocation; refresh + reconnect in `handleAuthRequired` (max 2 refreshes).

### M2-4 · `trip-status` expiry filter (P22 · CR-8)
- Add `.gt('expires_at', now)` + select `expires_at`. **Verify:** expired lock → `tripActive:false`.

### M2-5 · Stale-location handling (P23 · CR-8)
- Timestamp `liveBusLocations`; stop serving >60s entries; `clearLiveBusLocation` on `trip_ended` (+Redis key); client uses the existing `isNewerTimestamp`/`isImpossibleJump` guards + "N s ago" + clear marker >60s.

### M2-6 · Offline queue (P25 · HI-13) — **see V3**
- uid-keyed queue with TTL/cap, drained on any session of that uid — or the smaller fallback (client refetches `trip-status` on `auth_ok`).

### M2-7 · WS rate limit IP source (P13 · HI-6)
- `x-real-ip`/`x-forwarded-for` with `remoteAddress` fallback — or drop the IP bucket in WS context (smaller; per-user+socket buckets already bound each actor).

### M2-8 · Redis RESP parser (P14 · HI-7) — **see V1**
- Length-aware bulk-string parsing; interface unchanged.

### M2-9 · Live location cleanup (P15 · HI-8)
- `clearLiveBusLocation` from the `trip_ended` path (server + Redis key).

### M2-10 · Auth cache bound (P16 · M3) + heartbeat `missedCount` cleanup (P36 half)
- `tokenAuthCache` size cap/LRU; delete `missedCount` entries on timeout + close.

### M2-11 · Client debt (D6 realtime parts)
- First-message `reconnect_token` (stop URL query leak), SW cache versioning.

---

# Milestone 3 — Scale (pagination · DB throttling · caches · Redis · performance)

*What keeps the system fast at thousands of users. After M1/M2 correctness, these are pure wins with low risk.*

### M3-1 · GPS heartbeat write throttle (P26 · HI-15) — DB throttling
- `location/update/route.ts:52-65`: write `last_heartbeat` ≤ once/20s per bus (in-memory cache; heartbeat route already covers lock liveness). ~20× write reduction. **Verify:** two 2s-apart pushes → one write.

### M3-2 · Students list pagination + projection (P27 · HI-16)
- `.range(offset, limit)` + column projection on default/busId paths; SQL-side status filter; drop PII columns for driver role (ties to M1-7).

### M3-3 · Broadcast waste removal (P35 · M19)
- Zero-subscriber short-circuit; single encode; drop dead `bus:` channel broadcast; gate Redis publish on subscribers; delete sync `BROADCAST_BATCH_SIZE` slicing.

### M3-4 · O(1) rate cleanup (P36 · M18)
- `socketBuckets.delete(socketId)`; `tokenAuthCache` periodic sweep.

### M3-5 · Duplicate reads + aggregate (P37 · M20, M21)
- dashboard-data: single `active_trips` fetch passed through; trip-status: reuse entitlement fetch; dashboard-counts: `sum(amount)` aggregate RPC.

### M3-6 · Redis resilience cluster (P34 · HI-17, M24) — caches/Redis
- Bounded publish buffer drained on reconnect; relay subscription retry; `socket.setKeepAlive`; readiness does real `PING`; reconnect jitter; location snapshot resync on sub-connect.

### M3-7 · `getBusById` enrich + import cycles (P-9, P-10)
- Accept or 2s cache for single lookups; move `broadcastToChannel`/`sendToSocket` to a leaf module.

---

# Milestone 4 — Infrastructure (deployment · rollback · CI · Docker · Compose · health checks)

*What keeps the system running through deploys and outages. Do after M1–M3 so you're not deploying fixes on top of a broken deploy path.*

### M4-1 · Sequenced deploy + stop_grace_period (P30 · CR-7)
- `deploy-compose.ts`: `up -d --no-deps --wait ws1` → healthcheck → `ws2` → rest. `docker-compose.yml`: `stop_grace_period: 40s` on ws; `mem_limit` (2g ws / 1g nextjs).

### M4-2 · Real rollback (P31 · CR-7)
- Compose consumes `image: ghcr.io/...:<tag>`; deploy writes a release manifest; `rollback-compose.ts` restores previous tag; smoke-test ws1 AND ws2 (publish ws2 health port; `health-check.ts` probes both).

### M4-3 · CI gates (P19)
- `npm audit --omit=dev` fail-on-high; fresh-DB schema smoke test (scratch PG — also validates V5); WS integration test (from V2).

### M4-4 · Migrations on the release path (P32 · HI-19)
- `migrate:prod` = `supabase migration up --db-url ...` (NEVER `db reset` — replace the destructive `migrate:supabase`); run from cd.yml after backup gate, before deploy.

### M4-5 · Fresh-DB bootstrap (P7 · CR-3) — **see V5**
- Fix the three index statements on dropped columns; declare one entry point (3 files in order); archive `COMPLETE_SCHEMA.sql` after drift check.

### M4-6 · Compose & nginx (P20 · M12, M13)
- redis `volumes:`; bind 3001/3003 to 127.0.0.1; nginx `proxy_http_version 1.1` + keepalive; `client_max_body_size 5m`; healthcheck `start_period` 30s (cold `tsx` start).

### M4-7 · Timeouts on external calls (P33 · HI-18)
- `getSupabaseServer()` fetch wrapper `AbortSignal.timeout(10000)`; `verifyIdToken` ~10s fail-closed.

---

# Milestone 5 — Polish (observability · metrics · dashboards · docs · cleanup)

*Make the rest measurable and maintainable. Everything above stays unmeasurable until this lands.*

### M5-1 · Real metrics (P17 · HI-11)
- `withObservability` in `withSecurity` (HTTP counters/histograms); `wrapCronJob` on the 7 cron routes; enforce or delete `isWriteBlocked`.

### M5-2 · One real alert receiver (P18 · HI-11)
- Alertmanager: one email/Slack receiver; alerts: WS node down, payment webhook 5xx, cron failure, queue depth. Mark dashboards "no data until M5-1".

### M5-3 · Debt cleanup (D1–D3, D7)
- D1 Firestore mirror errors → `audit_events`; D2 atomic `expiry_reminder_count` update; D3 settings routes → `withSecurity` + standardize `audit_events`; D7 nginx-level rate limiting once upstream limits are sane.

### M5-4 · Architecture decision (P38 · HI-20) — **see V6**
- Vercel/docker split: decide after runtime validation, not before. Enforce with a bridge-connectivity health check.

### M5-5 · Docs & retractions
- Update `supabase/README.md` (single migration entry point), `docs/handbooks` (cron cadence, heartbeat constants, soft-block rules), and record the two retracted phase-1 findings (wget healthcheck, FCM suppression) so nobody re-reports them.

---

## Dependency map
```
M1 (correctness) ────► everything: do first, and P21's test fixture lives here
M2 (realtime) ───────► needs P1 (crash guard) + P13 (rate limit) from M2 itself; V2 test first
M3 (scale) ──────────► independent; but P26/P27 touch files M1-7/M1-12 touched — do M1 first to avoid rework
M4 (infra) ──────────► needs M3 sanity (don't deploy on top of a broken deploy path); CI gates catch M1–M3 regressions
M5 (polish) ─────────► mandatory last; makes M1–M4 measurable
V1–V6 ───────────────► validation gates inside M2-8, M2-2, M2-6, M1-12, M4-5, M5-4 respectively
```

## Effort summary
| Milestone | Items | Effort |
|-----------|-------|--------|
| M1 Critical correctness | P2–P6, P8–P12, P28, P29, D4, D5 | ~6–8 dev-days |
| M2 Realtime | P1, P13–P16, P21–P25 (+P36 half) | ~5–6 dev-days |
| M3 Scale | P26, P27, P34–P37, P-9, P-10 | ~3–4 dev-days |
| M4 Infrastructure | P7, P19, P20, P30–P33 | ~4–5 dev-days |
| M5 Polish | P17, P18, P38, D1–D3, D7 | ~3–4 dev-days |
| **Total** | P1–P38 + D-items | **~21–27 dev-days** |

## What NOT to change (deliberately)
- `end_trip_atomically`, capacity `FOR UPDATE` guard, approval CAS leases, trip-lock atomic INSERT, payment ledger uniqueness, timer/listener hygiene — all verified correct in the dynamic pass (reports 12–14). Do not "improve" them.
- The two retracted phase-1 findings (wget healthcheck, FCM suppression) are non-issues — do not re-implement fixes for them.
