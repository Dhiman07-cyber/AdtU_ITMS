# 03 — Trip & Driver Lifecycle Audit

## Business Understanding
Drivers start/operate/end trips; students track buses live; attendance/boarding is verified with a scanner; waiting flags and seat capacity are real business invariants. The system is dual-write: PostgreSQL `active_trips` (canonical, RPC-guarded) + Redis broadcast + in-memory WS state.

## Architecture
- `trip-orchestrator.ts` — `startTrip`/`endTrip` with ownership checks and structured logging.
- `tripLockService` (PG RPCs): `acquire_trip_lock`, `extend_trip_lock`, `release_trip_lock`, `check_bus_lock`, `end_trip_atomically` — SECURITY DEFINER, single-statement transactions.
- `socket-router.ts` — `liveBusLocations` in-memory map; GPS pipeline writes bus location (and Redis `bus:location:{busId}` per handbook).
- Heartbeat: client sends heartbeats; server `heartbeat-service` pings; `connection-cleanup-service` reaps dead sockets.
- Stale locks: `cleanup-stale-locks` cron (daily 04:00) calls `cleanup_old_trip_history`-style RPCs.

## Workflow & Execution Traces
1. Driver opens app → WS connect → auth → subscribe to `trip:{busId}` channel.
2. `startTrip` → `acquire_trip_lock` RPC (FOR UPDATE on buses/active_trips) → broadcast `trip_started`.
3. GPS pushes (1Hz) → `liveBusLocations.set` + Redis + broadcast.
4. `endTrip` → `end_trip_atomically` RPC + cleanup concurrently → broadcast `trip_ended` → (intended) `clearLiveBusLocation`.
5. Stale-lock cron reaps `active_trips` older than TTL.

## Verified Findings

### H8 — `liveBusLocations` never cleared [VERIFIED]
- **Where:** `server/socket-router.ts:54-65`
- **Issue:** `clearLiveBusLocation(busId)` exists (`:60`) but has **zero callers** in `src/` or `server/`. On trip end the location stays in the in-memory map (and Redis key per handbook design) until process restart.
- **Impact:** After a trip ends, students still see the last known bus position; the "trip_ended" state shows a stale moving map pin. If the bus starts a new trip elsewhere, old coordinates may briefly override the new broadcast (map keyed by busId).
- **Fix:** Call `clearLiveBusLocation(busId)` in the `trip_ended` broadcast path (`trip-orchestrator.ts:207` area) and delete the Redis `bus:location:{busId}` key.

### H5b — Lock RPCs granted to `authenticated` [VERIFIED]
- **Where:** `supabase/migrations/Firestore_to_supabase_migration.sql:939-1007` (acquire/extend/release/check_bus_lock, SECURITY DEFINER); `production_bootstrap_fixes.sql:438,457,498`; `fix_fcm_lock_rpc.sql:69`
- **Issue:** `GRANT EXECUTE ... TO authenticated` on lock functions that mutate `active_trips` (and `bus_increment_capacity` mutates bus load). The app never uses the `authenticated` role (service role only), but Supabase `auth.enabled = true` in `config.toml` means anyone with a Supabase account (signup config dependent) can call these RPCs directly via the REST endpoint `/rest/v1/rpc/...` with the anon key from the client bundle.
- **Impact:** An attacker can lock/steal/release any trip lock, forge `active_trips`, or fill bus capacity — without touching the app's Firebase auth at all.
- **Fix:** `REVOKE EXECUTE FROM authenticated` (keep service_role only); if RLS-protected RPCs are ever needed for end users, use `SECURITY INVOKER` + RLS checks. Also disable Supabase signup or restrict allowed domains if the console is not needed.

### H6 — WS rate limiter: shared IP bucket behind nginx [VERIFIED]
- **Where:** `server/websocket-server.ts:39,258` + `server/rate-limiter.ts:27-32`
- **Issue:** IP is `request.socket.remoteAddress` — behind the nginx reverse proxy that is the proxy address for every client. All users share ONE `ipBuckets` entry (~100 msgs / 10s global budget) in addition to per-user (200) and per-socket (60) budgets.
- **Impact:** ~2 concurrent active users can exhaust the shared IP budget; legitimate students get blocked (connection still open, messages dropped). Silent denial of service under normal load.
- **Fix:** Read `x-real-ip`/`x-forwarded-for` (set by nginx) for the IP bucket — and/or drop the IP bucket in WS context (user+socket buckets already bound per-actor).

## Agent-reported findings (trip domain, medium confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| ack-flag / mark-boarded endpoints lack bus-ownership revalidation | ack-flag route, mark-boarded route | Medium |
| Heartbeat staleness mismatch: client heartbeat interval (~60s) vs server expectation; `last_heartbeat` staleness constant differs between RPC and cleanup cron | client ws-client.ts; heartbeat-service.ts; migration :963-967 | Medium |
| device-session TTL mismatch: 30s vs 60s between creation and cleanup paths | device_sessions table + cleanup service | Medium |
| Stale-lock cron daily at 04:00; `acquire_trip_lock` stale-delete hardcoded 600s; TTL param ignored for cleanup | migration :953-980; vercel.json `0 4 * * *` | Verified (lines confirmed) |
| FCM trip-end notification "suppressed" | NOT FOUND — symbol does not exist in `src/`; discarded from ratings | Low |
| Session restore = delete old + create new (not atomic) | `session-manager.ts` restoreSession | Medium |
| WS `tokenAuthCache` eviction only removes expired entries — unbounded when all valid | authenticator.ts | Medium |

## What is solid (verified)
- `end_trip_atomically` is a single-statement transaction; `bus_increment_capacity` uses `FOR UPDATE` with re-check (correct under concurrency; ponytail comment in renew-services confirms awareness of the TOCTOU gap and its handling).
- Ownership checks in `trip-orchestrator` (`ownership_denied` path) and `active_trips` partial unique indexes on (bus,status) and (driver,status).
- Offline queue + drain on reconnect; pre-auth message buffering with bound (32).

## Recommendations
1. H8: clear live location on `trip_ended` (server + Redis).
2. H5b: revoke `authenticated` grants (single GRANT/REVOKE migration).
3. H6: use proxied client IP (or drop IP bucket in WS path).
4. Align heartbeat/device-session constants; make stale-lock cron minutely if 600s staleness matters, or accept daily and document.
5. Make session restore atomic (swap map entries, not delete+create).

## Confidence
High for VERIFIED rows; Medium for agent rows (reported with line refs but not all re-read).
