# 12 — Business Workflow Correctness Under Concurrency

**Audit class:** workflow races — two users doing conflicting things at the same moment, or unexpected sequences over months of real use.
**Method:** 12 user-defined scenarios traced end-to-end (routes → services → RPCs → WS) + extra races found. Verdicts below; FAIL/RISK rows were re-verified against source after the agent pass.

## Verdict summary

| # | Scenario | Verdict |
|---|----------|---------|
| 1 | Duplicate/parallel application submission (same student, two apps) | **RISK** |
| 2 | Capacity check→increment race (simultaneous approvals) | PASS* |
| 3 | Two drivers start same bus / double-start | PASS |
| 4 | Two moderators approve/reject same application concurrently | PASS |
| 5 | Flag ack / boarding races | PASS (cosmetic) |
| 6 | QR scan during bus reassignment | **RISK** |
| 7 | Waiting flags after reassignment | **RISK** |
| 8 | Session activation vs capacity | PASS |
| 9 | Renewal approval vs soft-block cron | **RISK** |
| 10 | Payment double-verification / double-capture | PASS |
| 11 | Profile-photo approve vs reject concurrently | **FAIL** |
| 12 | Concurrent student profile updates (two devices) | PASS (cosmetic) |

*\* PASS depends on the `bus_increment_capacity` override being live in prod (production_bootstrap_fixes.sql:467-496); the base version in Firestore_to_supabase_migration.sql:890 increments unconditionally. Verify with `\df bus_increment_capacity`.*

## Verified FAIL

### W-1 · Concurrent approve + reject of one profile update destroys both photos [VERIFIED]
- **Trace:** `handle-profile-update/route.ts` — approve deletes the OLD Cloudinary image (`:95-113`), reject deletes the NEW one (`:150-168`); both then check Firestore status with a plain read (`:116-120`, `:170-175` — not a compare-and-set) and both commit.
- **Result:** both status checks pass on stale state → both images deleted → PG holds `profilePhotoUrl = newImageUrl` whose file no longer exists. Photo permanently broken, old photo unrecoverable.
- **Fix:** make the Firestore transition a real CAS (transaction with `status='pending'` precondition) and delete Cloudinary assets only after winning the CAS.

## Verified RISK rows

### W-2 · No unique guard on active applications per student (S1)
- `submitFinal` (`application.service.ts:155-226`) does check-then-upsert; no DB constraint on `applications.applicant_uid`. Two concurrent submits → both approved → **double seat on two buses + two payments, one student row** (identity upsert collapses). Same root as H4 (report 04).
- **Fix:** partial unique index on `applications(applicant_uid) WHERE state IN ('submitted','approved','verified','awaiting_verification','verified_upcoming','pending_seat_allocation')`.

### W-3 · Scan/board does not revalidate against trip or current bus (S6, S7)
- `verify-student` (`bus-pass/verify-student/route.ts:67,121-136`) is snapshot-based and advisory; `mark-boarded` revalidates only flag status, never the trip or the student's bus; `scanner-auth.ts:102-105` fallback lets any driver pass any bus (CR-4). A student reassigned between scan and tap gets boarded on the old bus; waiting flags survive reassignment (reassign RPC `reassign_students_atomically` never touches `waiting_flags`) and old-bus drivers can ack/board them.
- **Fix:** delete scanner fallback; in `mark-boarded` add `active_trips` bus match check; in reassign RPC loop, delete the student's `raised/acknowledged` flags.

### W-4 · Renewal vs soft-block cron race (S9)
- `cleanup-expired-students/route.ts` computes `needsSoftBlock` from a batch-read snapshot, then the RPC (`soft_block_student_with_seat_release`, migration:1687-1719) locks the row and checks **only `status='active'`** — never re-validates soft-block date/validUntil. A renewal landing in the window → just-paid student gets soft-blocked + seat released.
- **Fix:** recompute from the fresh row before the RPC (or guard `soft_block < NOW()` inside the lock).

## Extra races found
- **W-5** `waiting-flag/create`: concurrent `waiting`-state inserts hit the partial unique index → raw 23505 → generic 500 instead of 409 (cosmetic).
- **W-6** Renewal of a seat-released student takes the standard path (application.service.ts:414-423), not `approve_renewal_with_seat` → `seat_released_at` stays set → bus load undercounts until the admin reconcile cron.
- **W-7** `expiryReminderCount` read-modify-write non-atomic — concurrent cron/manual runs double-send R1 and desync the ladder (ties to M5).
- **W-8** ack-flag double-ack: loser returns success with its own `ackByDriverUid` while DB holds the winner's (misleading response only).

## What is genuinely sound (credit)
- **Trip lock arbitration:** partial unique indexes + atomic INSERT in `acquire_trip_lock` — double-start impossible.
- **Approval single-winner:** CAS `processing_lock` + lease + lock-ownership-verified finalize; loser gets 409, no double-activation.
- **Capacity:** FOR UPDATE + re-check inside the RPC — the one race that actually matters is correctly handled (when the override is live).
- **Payments:** DB-level uniqueness (razorpay id + one-completed-per-session) — retries converge, no double-capture.

## Confidence
HIGH (W-1..W-4 re-verified this session); agent-traced rows marked individually.
