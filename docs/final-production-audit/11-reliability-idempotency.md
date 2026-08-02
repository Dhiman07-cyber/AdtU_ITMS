# 11 — Reliability & Idempotency Audit

## Business Understanding
Payment capture, renewals, trip start/end, seat capacity, and notifications all touch money or core invariants. Failures must be retry-safe: a retried webhook, a double-tapped approve button, or a crash mid-flow must not double-apply or dead-end. This report consolidates the reliability-critical findings from all domains.

## Verified Findings (consolidated)

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| R1 | Payment "self-healing" is log-only — paid renewal students can be permanently stuck (payment captured, application never created, every retry `already_processed`). | Critical (money) | `payment.service.ts:137-152` (see 02) |
| R2 | `pgFindByApplicantUid` `maybeSingle` → 406 → 500 when 2+ application rows exist (renewals produce exactly this by design). | High | `application.repository.pg.ts:215-230` (see 04) |
| R3 | Renew-services idempotency key computed but never used — offline double-submit re-applies renewals (double extension). | High | `renew-services/route.ts:94-99` (see 02) |
| R4 | WS pre-auth crash → full-node outage on one malformed socket (no process-level handler). | Critical | `websocket-server.ts:32,205` (see 10) |
| R5 | Expiry reminders can never fire (schedule/gate mismatch + count gate). | High (business) | `vercel.json:4-10`, `expiry-check.ts:34-46,95-99` (see 05) |
| R6 | Fresh-DB migration abort — no rebuild path for staging/DR. | High | `Firestore_to_supabase_migration.sql:1181-1183` (see 06) |
| R7 | `liveBusLocations` never cleared — stale location broadcast after trip end. | Medium | `socket-router.ts:54-65` (see 03) |
| R8 | `expiryReminderCount` read-modify-write non-transactional — lost updates on overlap (manual + cron). | Medium | `expiry-check.ts:130-137` |
| R9 | Firestore mirror writes swallowed (`console.error` only) after PG commit — dual-write divergence invisible. | Medium | `handle-profile-update/route.ts:137-139` and similar |
| R10 | `bus_increment_capacity` TOCTOU acknowledged in-code with FOR UPDATE guard — sound, but `pgIncrementBusCapacity` throws generic Error instead of `CapacityFullError` (TODO in code) — capacity-full errors surface as "Unknown error". | Medium | renew-services/route.ts:215-227 + fleet repository |

## What is solid (verified)
- `end_trip_atomically` single-statement; capacity RPC `FOR UPDATE` re-check (idempotency-conscious design).
- Webhook HMAC verified; ledger append-only; one-completed-payment-per-session unique index.
- WS: replay guard, pre-auth buffer replay, offline queue drain on reconnect, reconnect-token ownership validation.

## Edge-Case Review (walkthrough outcomes)
1. **Webhook + client-verify double call:** idempotency gate returns `already_processed` → safe (payment-level). Renewal-application gap is the only dead-end (R1).
2. **Approve + retry:** profile-update approve re-checks Firestore status `!== 'pending'` → second call is a no-op (safe). Capacity increments on approve are the risk (agent: fresh-approval double-increment — see 04).
3. **Trip end during GPS push:** `end_trip_atomically` guards on lock; stale push after end hits no row (safe) but location map stays (R7).
4. **Two WS nodes, same user:** no cross-node dedupe of subscriptions; both nodes may broadcast to the same client twice (agent-flagged; Redis pub/sub lacks per-client ownership). Medium.
5. **Clock skew on heartbeats:** stale-lock cron deletes trips whose heartbeat is old — client 60s vs server constants mismatch can kill a healthy trip at the boundary (see 03 WS-6).

## Recommendations (smallest safe change first)
1. R1: create the missing renewal application inside the self-healing branch.
2. R2: `order + limit(1)` on applicant lookups.
3. R3: enforce unique `transaction_id` for manual payments (partial unique index) — blocks double-apply at the DB.
4. R4: pre-auth error listener + process handlers.
5. R8: single atomic `UPDATE ... SET expiry_reminder_count = expiry_reminder_count + 1`.
6. R10: make `pgIncrementBusCapacity` throw `CapacityFullError` (code TODO already says so).
7. R9: log mirror failures to `audit_events` for reconciliation.

## Confidence
High for R1–R10 (source-verified); agent rows marked individually.
