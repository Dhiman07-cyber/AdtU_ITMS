# 06 — PostgreSQL / Supabase Schema Audit

## Business Understanding
PostgreSQL (Supabase) is the canonical store. There are three migration-era files plus a bootstrap-fixes file. The DB hosts identity, applications, trips, payments, waiting flags, device sessions, bus locations, audit events, notifications, and 10+ SECURITY DEFINER RPCs that enforce business invariants (trip locks, capacity, end-trip atomicity).

## Architecture
- `supabase/migrations/Firestore_to_supabase_migration.sql` (2475 lines, "canonical single migration" per header).
- `supabase/migrations/COMPLETE_SCHEMA.sql` (older comprehensive schema).
- `supabase/migrations/production_bootstrap_fixes.sql` — runtime tables + RPCs added after go-live (waiting_flags, payments, driver_trip_history, device_sessions, bus_locations, end_trip_atomically, cleanup_old_trip_history, bus_increment_capacity).
- `supabase/migrations/fix_fcm_lock_rpc.sql` — FCM lock RPC.
- App talks to PG via service-role client (`getSupabaseServer`); RLS exists but the `authenticated` role is never used by the app (Firebase tokens are never exchanged for Supabase JWTs).
- `supabase/config.toml` + `supabase/README.md` — instructions conflict between migration files.

## Verified Findings

### C3 — Fresh database cannot be built from the "canonical" migration [VERIFIED]
- **Where:** `Firestore_to_supabase_migration.sql:54-61` (idempotent DROP of `driver_profiles.bus_id/route_id/shift`, no-op on fresh DB) then `:1181-1183`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_driver_profiles_bus_id ON driver_profiles(bus_id);
  CREATE INDEX IF NOT EXISTS idx_driver_profiles_route_id ON driver_profiles(route_id);
  CREATE INDEX IF NOT EXISTS idx_driver_profiles_shift ON driver_profiles(shift);
  ```
  `driver_profiles` is created at `:188` **without** those columns. `IF NOT EXISTS` applies to the index, not the column → `ERROR: column "bus_id" does not exist` → migration aborts.
- **Additionally:** `COMPLETE_SCHEMA.sql` is not self-contained (`COMMENT ON TABLE bus_locations` errors on fresh DB per agent report; it also defines `reassignment_logs.operation_id UNIQUE` while the canonical migration defines it TEXT with a non-unique index at `:408`).
- **Impact:** No documented path produces a working schema on a fresh DB. Disaster-recovery (spin up new Supabase instance) or environment cloning (staging) is broken. Only a DB that already went through the 29 historical migrations works.
- **Fix (smallest):** change the three index statements to conditional (only create when the column exists) or (better) keep the columns and drop the legacy-cleanup for fresh DBs — the DROP block is only needed for the historical path. Then make one file the single documented entry point and delete/annotate the others.

### H5 — `authenticated` grants on SECURITY DEFINER RPCs [VERIFIED]
- **Where:** `production_bootstrap_fixes.sql:438,457,498`; `fix_fcm_lock_rpc.sql:69`; lock RPCs in `Firestore_to_supabase_migration.sql:939-1007` (grants section follows function definitions).
- **Issue:** `GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role` on `end_trip_atomically`, `cleanup_old_trip_history`, `bus_increment_capacity`, `acquire_fcm_lock`, `acquire/extend/release/check_bus_lock`. The app never uses `authenticated`; the grants are leftovers from the RLS design phase.
- **Impact:** If Supabase `auth.enabled` (config.toml) exposes signup or the anon key + a valid Supabase account is available, anyone can call these RPCs directly over REST, bypassing Firebase auth: forge trip locks, end trips, inflate capacity. Today it is dormant (no exchange path), but it is one config flip away from exploitable.
- **Fix:** single migration: `REVOKE EXECUTE ... FROM authenticated` on all listed functions; disable signup or restrict domains in `config.toml`.

### H4 — no unique constraint on `applications.applicant_uid` [VERIFIED]
- See report 04. Relevant schema side: add partial unique index for one active application per applicant (pattern already exists: `idx_waiting_flags_one_active`).

## Agent-reported findings (medium confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| No FK constraints anywhere (28 tables) — orphan risk (e.g., student deleted, application remains; bus deleted, active_trips row remains) | migration CREATE TABLEs | High (pattern verified by grep — no REFERENCES) |
| RLS enabled on 16 tables but dormant; `GRANT SELECT USING(true)` on bus_locations and several public tables | RLS section | High |
| Missing indexes: `applications(applicant_uid)` exists (idx_applications_applicant_uid :1204) — but `notifications(recipient_ids)`, `fcm_tokens`, `waiting_flags(raised_at)` absent | index sections | Medium |
| `reassignment_logs.operation_id` UNIQUE vs TEXT conflict between schema files | both files | Verified |
| `active_trips` partial unique indexes present (bus active, driver active) | migration | Verified |
| payments unique index `idx_payments_one_completed_per_student_session` present | migration | Verified |
| `production_bootstrap_fixes.sql` uses `CREATE TABLE IF NOT EXISTS` — conflicts silently if shapes drift from the canonical file | bootstrap file | Medium |

## What is solid (verified)
- `end_trip_atomically` single-statement transaction; `bus_increment_capacity` FOR UPDATE re-check; `updated_at` triggers; leap-year-aware date handling in app layer.
- Waiting-flag partial unique index; payments one-per-session unique index; append-only payments (no delete policy).

## Recommendations
1. C3: make `Firestore_to_supabase_migration.sql` runnable on fresh DB (fix the three indexes; self-contained comments). Test by applying to a scratch DB in CI.
2. H5: revoke `authenticated` grants; disable signup.
3. H4: partial unique index on active application per applicant.
4. Medium: add FK constraints where business-valid (bus_id → buses.id, driver_id → driver_profiles.uid, student_uid → student_profiles.uid) with `ON DELETE` semantics matching app behavior; add `notifications(recipient_ids)` GIN/btree as query patterns justify.
5. Reconcile the two schema files: one entry point, others moved to `archive/`.

## Confidence
High for VERIFIED rows; Medium–High for agent rows (index/constraint patterns confirmed by grep; behavioral impact of some not re-run).
