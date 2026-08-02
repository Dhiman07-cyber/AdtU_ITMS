# ITMS Final Production Audit — Executive Summary

**Date:** 2026-08-02
**Scope:** Full repository (812 files, ~159K lines, 175 API routes) — architecture, security, reliability, data integrity, observability, infrastructure.
**Method:** 12 parallel domain audits + personal cross-verification of every Critical/High finding against source code. Findings that could not be verified are marked explicitly and excluded from the master rating where confidence was low.
**Constraint:** Read-only audit. No code was modified. This is a report and plan only.

---

## Headline

The system handles **real money** (Razorpay) and **national-ID PII** (Aadhaar, phone, DOB, parent contact) in production, yet:

1. **The realtime server can be crashed by one malformed socket** before authentication completes — full WS outage until restart (websocket-server.ts:205, listener attached only after auth; no `uncaughtException` handler in server/index.ts).
2. **Renewal reminders can never fire.** Vercel schedules Jun 1 + Jun 15; code gates are Mar 1 / Apr 1 / Jun 15, and the final reminder additionally requires `expiryReminderCount === 2`, which can never be reached.
3. **A fresh database cannot be built** from any single documented migration — `Firestore_to_supabase_migration.sql` drops `driver_profiles.bus_id/route_id/shift` (idempotent no-op on fresh DB) then creates indexes on those dropped columns (line 1181-1183) → `column "bus_id" does not exist` → migration aborts.
4. **Bus-scanner authorization is a no-op**: any driver can scan (and board-verify) any student on any bus (scanner-auth.ts:102-105 dead fallback).
5. **Observability is a shell**: `withObservability`/`wrapCronJob` have zero callers, alertmanager receivers are empty, Grafana dashboards plot metrics nothing emits, tracing is an in-memory buffer nothing writes to.

---

## Verified Critical Findings (personally re-checked against source)

| # | Finding | Evidence |
|---|---------|----------|
| C1 | WS pre-auth socket crash → process death. `'error'` listener attached only after auth completes; ws emits `'error'` on payload/UTF-8 receiver failures with zero listeners → uncaught exception. No `uncaughtException`/`unhandledRejection` handler anywhere in `server/`. | `server/websocket-server.ts:32,205`; `server/index.ts:120-121` (SIGTERM/SIGINT only) |
| C2 | Expiry-reminder cron chain can never fire. Vercel crons: Jun 1 + Jun 15. Gates: Mar 1 (R1), Apr 1 (R2), Jun 15 (final). Final requires count===2, unreachable. Jun 1 cron is dead every year. | `vercel.json:4-10`; `src/lib/expiry-check.ts:34-46,95-99`; `deadline-computation.ts:161-176` |
| C3 | Fresh-DB migration failure: index on columns dropped by the same migration. | `supabase/migrations/Firestore_to_supabase_migration.sql:54-61,1181-1183` |
| C4 | Scanner ownership check is dead code — any driver scans any student, `canBoard:true`. | `src/lib/security/scanner-auth.ts:98-105`; `:35` (non-string busId → true) |
| C5 | Any moderator can read any moderator's **Aadhaar number, DOB, phone** — no permission gate. | `src/app/api/moderators/[id]/route.ts:26,75` |

## Verified High Findings

| # | Finding | Evidence |
|---|---------|----------|
| H1 | `if (busId === busId)` self-comparison — any driver with ≥1 bus approves/rejects ANY student's profile update and deletes their Cloudinary photo. | `src/app/api/driver/handle-profile-update/route.ts:79` |
| H2 | Any authenticated user (incl. students) can delete arbitrary Cloudinary assets — no ownership check, only format regex. | `src/app/api/delete-image/route.ts:23,54,62` |
| H3 | Payment "self-healing" is log-only: missing renewal application is never created; paid students stay stuck at `already_processed`. | `src/lib/payment/payment.service.ts:137-152` |
| H4 | `maybeSingle` on `applications.applicant_uid` (no unique constraint) → PostgREST 406 → 500 when a student has 2+ rows. | `src/domains/application/repositories/application.repository.pg.ts:215-230` |
| H5 | RPCs `SECURITY DEFINER` + `GRANT EXECUTE TO authenticated` (acquire/extend/release trip locks, end_trip_atomically, bus_increment_capacity, acquire_fcm_lock) — exploitable if Supabase `auth.enabled` signups are exposed; RLS path is dormant (Firebase tokens never exchanged). | `production_bootstrap_fixes.sql:438,457,498`; `fix_fcm_lock_rpc.sql:69`; `Firestore_to_supabase_migration.sql:939-1007` |
| H6 | WS rate limiter keyed by `request.socket.remoteAddress` — behind nginx every client shares one IP bucket (~100 msgs/10s global). | `server/websocket-server.ts:39,258`; `server/rate-limiter.ts:27-32` |
| H7 | Redis RESP parser is line-based; bulk strings containing `\r\n` break channel/message framing. | `server/redis-client.ts` (RESP parse) |
| H8 | `liveBusLocations` map never cleared on trip end — stale positions broadcast after end. `clearLiveBusLocation` has zero callers. | `server/socket-router.ts:54-65` |
| H9 | Renew-services idempotency key is dead code (`operationKey` computed, never stored/checked) — retries re-apply renewals; `adminUid` trusted from body. | `src/app/api/renew-services/route.ts:94-99,270` |
| H10 | Drivers can list **all students** (parent phone, DOB, phone) and any student/driver can fetch any driver's full profile incl. Aadhaar — no role-scoped stripping. | `src/app/api/students/route.ts:19,87-111`; `src/app/api/drivers/[id]/route.ts:10,24` |
| H11 | `cleanup-trip-history` exists but is not scheduled in vercel.json; compose services have no resource limits; no `npm audit`/security scan in CI. | `vercel.json` (7 crons); `docker-compose.yml` |

## Verified Medium/Low highlights

- `acquire_trip_lock` hardcodes 600s stale-delete; TTL param ignored for cleanup (migration :953-980).
- WS `tokenAuthCache` eviction only removes expired entries — unbounded growth when all valid.
- Pre-auth message buffer bound 32; flood → close (ok) but timeout path leaves listener attached (minor).
- Session restore = delete-old + create-new (not atomic) — brief subscription loss.
- `students/[id]` GET allows driver role without field stripping (agent-verified).
- `renew-services` allows any moderator without permission check (:53).
- Heartbeat staleness: client 60s interval vs server expectations; device-session 30s/60s mismatch (agent-verified).
- Frontend WS client puts `idToken` + `reconnect_token` in URL query (log leak); PWA SW cache invalidation gaps (agent-verified).
- No FK constraints anywhere; missing indexes on `applications(applicant_uid)`, `notifications`, `fcm_tokens` (agent-verified).
- Dockerfile build-ARGs vs docker-compose `build.args` mismatch (agent-verified).
- nginx: app-upstream keepalive without `proxy_http_version 1.1`; default 1MB `client_max_body_size` vs uploads (agent-verified).
- `.env`-style secrets presence in repo root unverified; `.env.example` committed (ok).

## Discarded / Unverified during cross-verification

- "FCM end notification suppressed" (agent claim; `endSuppressed` symbol does not exist anywhere in `src/` — likely stale or reworded finding; not carried into master rating).
- Several IDOR-sweep line-level claims from the 13-finding sweep could not be individually re-verified in this pass; the ones carried forward are those with direct source confirmation above.

## What is healthy (credit where due)

- Razorpay webhook HMAC-SHA256 verified with `timingSafeEqual`; payment ledger is append-only with a `payments_no_delete` RLS policy and a partial unique index on one-completed-payment-per-student-session.
- Webhook/callback recovery paths exist (webhook-verify + client-verify + recovery + "restore" endpoints).
- `end_trip_atomically` RPC is a single-statement transaction; `bus_increment_capacity` uses `FOR UPDATE` (correct concurrency guard, modulo grant exposure H5).
- Trip orchestrator ownership checks, structured app logging, and offline message queue are well-designed.
- CI/CD exists (GHCR, two docker-compose stacks, health-checked rollout) and WS has a smoke test suite.
- Schema seeds and `production_bootstrap_fixes.sql` add most runtime tables (waiting_flags, payments, device_sessions, bus_locations, driver_trip_history) — the fixes file itself is the closest thing to a working bootstrap (see report 06).

## Recommended sequence (summary)

1. C1 WS pre-auth crash guard (attach `error` listener at connection start; add process-level handlers in `server/index.ts`).
2. C4/H1/H2 authorization fixes (scanner fallback removal; profile-update bus matching; delete-image ownership).
3. C5/H10 PII exposure (field-level role stripping).
4. C2 cron alignment (schedule Mar 1/Apr 1/Jun 15 or remove count gate).
5. C3 migration bootstrap fix (CREATE TABLE must include bus_id/route_id/shift or indexes must be conditional).
6. H3 payment self-heal (actually create the missing application inside the recovery branch).
7. H4 unique constraint or `order`+`limit(1)` query.
8. H5 revoke `authenticated` grants; disable Supabase signup.
9. H6/H7 WS+Redis hardening. H8 clear live location on end. H9 real idempotency key.
10. H11 scheduling + CI hardening; then observability (single metric hook + one alert receiver).

Full ordering with dependencies, effort, and risk: see `FINAL_IMPLEMENTATION_PLAN.md`.
