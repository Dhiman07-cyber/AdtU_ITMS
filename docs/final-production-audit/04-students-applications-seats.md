# 04 — Students, Applications & Seat Capacity Audit

## Business Understanding
Students apply (registration or renewal), get assigned buses/routes/shifts, and seats are capacity-managed per bus+shift. Applications flow through states (`draft → submitted → approved / rejected`); approvals can be conditional (`eligibleApproval`). Reassignments move students between buses with a capacity guard. Waiting flags track raised/acknowledged requests.

## Architecture
- `src/domains/application/` — services + `application.repository.pg.ts` (canonical PG) with a Firestore mirror.
- `src/domains/seat/`, `src/domains/student/` — assignment and profile logic.
- `bus_increment_capacity` RPC — FOR UPDATE capacity guard (canonical).
- `reassignment_logs` table records operation history (schema conflict — see 06).
- Docs (engineering handbook §9.2) describe soft-block +1/+2 year windows.

## Verified Findings

### H4 — `maybeSingle` on applicant_uid can 500 [VERIFIED]
- **Where:** `src/domains/application/repositories/application.repository.pg.ts:215-230`
- **Issue:** `pgFindByApplicantUid` uses `.eq('applicant_uid', uid).maybeSingle()`. There is **no unique constraint** on `applications.applicant_uid`; renewal flow preserves prior approved applications while creating new rows for the same student. Two rows → PostgREST returns 406 → the repo throws → callers (e.g., renew-services `getByApplicantUid` at `renew-services/route.ts:139`) return 500.
- **Impact:** Any student who has ever had 2+ application rows can break renewal and profile flows that call `getByApplicantUid`. Realistic for renewals by design.
- **Fix options (smallest first):** (a) `order('submitted_at', {ascending:false}).limit(1)` + `.maybeSingle()`; (b) add a partial unique index for a *single active* application per applicant (like `idx_waiting_flags_one_active`), preserving history.

### H5c — `bus_increment_capacity` granted to `authenticated` [VERIFIED]
- **Where:** `production_bootstrap_fixes.sql:467-498`
- **Issue:** SECURITY DEFINER + `GRANT EXECUTE TO authenticated`. Any Supabase-authenticated caller can increment a bus's `morning_load/evening_load` arbitrarily (capacity guard runs inside the RPC, but the attacker controls the bus id and can also exceed capacity by just calling repeatedly — the guard blocks at capacity, but they can still inflate load up to capacity on any bus and even on shifts they're not assigned to).
- **Impact:** Capacity tampering / seat-blocking DoS if Supabase auth surface is exposed (same exposure as H5b in report 03).

## Agent-reported findings (medium confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| Reassignment path ignores capacity guard (reassign without `bus_increment_capacity` check) | reassignment service | Medium |
| `eligibleApproval` client-controlled (client passes approval eligibility flag) | approval route/validation | Medium |
| `submit()` lacks applicant-ownership check (IDOR: submit another student's application) | application service submit | Medium |
| Fresh-approval retry double-increments (approve → retry → capacity incremented twice) | approval service | Medium |
| Soft-block +1 vs +2 year discrepancy vs docs §9.2 | deadline-computation / soft-block cron vs handbook | Low (docs may be stale) |
| `reassignment_logs.operation_id`: UNIQUE in `COMPLETE_SCHEMA.sql` vs plain TEXT in `Firestore_to_supabase_migration.sql` | both files | Verified (line 408 index is non-unique; COMPLETE_SCHEMA declares unique) |

## What is solid (verified)
- `idx_waiting_flags_one_active` partial unique index — one active waiting flag per student+bus.
- Capacity guard is server-side in the RPC (`FOR UPDATE`, re-check inside lock) — the renew-services fast-fail pre-check is documented as an optimization, not the guard (ponytail comment at renew-services/route.ts:215-223).

## Recommendations
1. H4: order+limit(1) in `pgFindByApplicantUid` (also audit `pgFindByApplicationId`-style siblings for the same pattern).
2. H5c: revoke `authenticated` on capacity RPC (same migration as H5b).
3. Agent rows: verify and fix reassign capacity guard; stop trusting client `eligibleApproval`; add owner check in `submit()`; make approval retry idempotent via `reassignment_logs`/unique key.
4. Reconcile `reassignment_logs.operation_id` definition between the two schema files.

## Confidence
High for VERIFIED rows; Medium for agent rows.
