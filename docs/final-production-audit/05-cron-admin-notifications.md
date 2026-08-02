# 05 — Cron, Admin & Notifications Audit

## Business Understanding
Vercel cron jobs drive the operational lifecycle: expiry reminders, cleanup (notifications, expired students, stale locks, trip history), integrity sweep, session activation. Admin routes manage users, deadlines, and settings. Notifications are written to PG and pushed via FCM.

## Architecture
- 7 cron routes in `src/app/api/cron/`; scheduling in `vercel.json` (Vercel cron format).
- `expiry-check.ts` — the reminder engine, gated on derived lifecycle dates + per-student `expiryReminderCount`.
- `deadline-computation.ts` — `deriveAcademicLifecycle` derives all dates from academic session start (July 1).
- Admin settings routes hand-roll auth (verifyIdToken + role string checks) in many places rather than using `withSecurity`.

## Verified Findings

### C2 — Expiry reminders can never fire [VERIFIED]
- **Where:** `vercel.json:4-10` vs `src/lib/expiry-check.ts:34-46,89-99` + `deadline-computation.ts:161-176`
- **Issue:**
  - Lifecycle (session start July 1): expiry = Jun 30; **reminder1 = Mar 1** (expiry − 3 months, day 1); **reminder2 = Apr 1** (expiry − 2 months); **finalReminder = Jun 15** (expiry − 15 days).
  - Scheduled crons: `0 0 1 6 *` (Jun 1, `type=main`) and `0 0 15 6 *` (Jun 15, `type=mid-june`).
  - Jun 1 matches **no** gate → the main cron is a permanent no-op.
  - Jun 15 matches `finalReminder`, but the final branch requires `expiryReminderCount === 2`; the counter only increments when R1 (Mar 1) or R2 (Apr 1) fires — which are never scheduled → **zero reminders ever sent**, counter always 0.
- **Impact:** Students are never reminded to renew; the entire reminder pipeline (notifications + FCM) is dead in production. Renewal revenue and service continuity depend on students noticing expiry themselves.
- **Fix (smallest):** schedule crons on Mar 1 and Apr 1 (and keep Jun 15); or relax the count gate so each gate fires at its own cadence (send if `currentCount < required`). Align `type=` query params with route behavior — verify `src/app/api/cron/expiry-check/route.ts` actually branches on `type`.

### H11a — `cleanup-trip-history` never scheduled [VERIFIED]
- **Where:** `src/app/api/cron/cleanup-trip-history/route.ts` exists; `vercel.json` has 7 crons, not 8.
- **Impact:** `driver_trip_history` and `bus_locations` grow unboundedly (bus_locations is written at 1Hz per active bus; trip history at trip end). PG bloat → slow queries → deadline.
- **Fix:** add a cron entry (e.g., weekly) and confirm the route is guarded by `CRON_SECRET`.

## Agent-reported findings (medium confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| Settings routes hand-roll auth (8+ duplicates of verifyIdToken + role check instead of withSecurity) — inconsistent audit_events writes | src/app/api/settings/* | Medium |
| `audit_events` writes inconsistent across admin routes (some write, some don't; shape varies) | admin routes | Medium |
| `integrity-sweep` and `session-activation` exist and are scheduled — behavior not deep-verified | vercel.json | High (scheduled) |
| Expiry-check uses non-transactional read-modify-write on `expiryReminderCount` (`getStudentById` → `updateStudent`) — concurrent/lost increments on retry | expiry-check.ts:130-137 | Verified (read) |

## What is solid (verified)
- Every cron route is protected by `CRON_SECRET` header auth (agent-verified).
- `cleanup-stale-locks`, `integrity-sweep`, `session-activation`, `cleanup-notifications`, `cleanup-expired-students` are all scheduled.
- `deriveAcademicLifecycle` handles leap-year normalization and UTC consistently.

## Recommendations
1. C2: fix cron schedule (Mar 1 + Apr 1 + Jun 15) and/or relax the `=== 2` gate; add a manual trigger check (manualExpiryCheck exists with force=true).
2. H11a: schedule cleanup-trip-history.
3. Centralize settings-route auth on `withSecurity`; standardize `audit_events` payloads.
4. Make `expiryReminderCount` increment atomic (single UPDATE with `SET expiry_reminder_count = expiry_reminder_count + 1 WHERE ...`).

## Confidence
High for VERIFIED rows; Medium for agent rows.
