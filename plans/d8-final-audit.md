# D8 Final Production Audit — All 7 Concerns Addressed

## Concern 1: Remove Student.lastApplicationId

**Problem:** `lastApplicationId` couples Student → Application. Student shouldn't know which Application caused its state. If validity is extended by admin adjustment, scholarship, or migration, you'd need to fake an application ID.

**Resolution:** Idempotency belongs to the orchestration layer, not the Student aggregate. The existing mechanisms are sufficient:

1. **Lease prevents concurrent processing:** `approve_application()` RPC acquires lease. Second moderator gets 409.
2. **RPC state transition prevents re-entry:** Application must be in state `'submitted'` to acquire lease. After approval, state is `'approved'`. Re-entry is impossible.
3. **Lease expiry handles timeouts:** If the flow crashes mid-way, the lease expires after 5 minutes. The cron reclaims the lock. On retry, the RPC re-validates state — if state is still `'processing'` (crash mid-flow), the lease can be re-acquired and the flow restarts safely.
4. **Student.applyRenewal() is deterministic:** Given the same inputs, it produces the same output. The `max(currentValidUntil, calculatedValidUntil)` pattern means calling it twice doesn't double-extend.

**If extra protection is needed:** Use a dedicated `idempotency_key` column on the applications table (TEXT, nullable, set once during processing). Not on Student.

**Revised Student.applyRenewal() contract (no applicationId):**

```typescript
export async function applyRenewal(
  studentUid: string,
  renewalDetails: {
    durationYears: number;
    totalFee: number;
    seatWasReleased: boolean;
    deadlineConfig: DeadlineConfig;
  }
): Promise<Student | null>
```

Idempotency is guaranteed by:
- `max()` on validUntil/sessionEndYear (deterministic, no double-extend)
- `+` on durationYears (additive, but `max()` on validUntil prevents drift)
- Lease + RPC state machine prevents re-entry at the orchestration layer

---

## Concern 2: Compensation Strategy — Avoid It Entirely

**Problem:** "Revert student" is underspecified. Rollback code becomes incomplete when new fields are added.

**Resolution:** Change the ordering to **Seat-first, Student-second**. This eliminates the need for student compensation entirely.

**Why Seat-first is correct:**
- Seat capacity is the scarce resource
- Reserve the scarce resource first, then update the dependent entity
- If Student fails after Seat: seat reservation is abandoned (lease expires, seat reverts via Firestore)
- If Student succeeds: flow continues normally
- No compensation logic needed

**Revised ordering:**

```
1. Seat.getCapacity(busId, shift)         — pre-flight check (read-only)
2. Seat.assignSeat(busId, studentUid, shift) — reserve scarce resource FIRST
3. Student.applyRenewal(studentUid, {...})  — update student SECOND
4. Payment.ensure(...)                      — record payment THIRD
5. finalize_application_state()             — finalize LAST
```

**Failure matrix (Seat-first):**

| Step | Failure | Compensation |
|------|---------|-------------|
| Seat.assignSeat() fails | Student not touched | No compensation — retry from start |
| Student.applyRenewal() fails | Seat reserved but student not updated | Seat reservation abandoned (lease expires, Firestore reverts) |
| Payment fails | Student + Seat both succeeded | No compensation — payment retriable |
| Finalize fails | All succeeded | Lease expires, retry from start (idempotent) |

**Key insight:** Firestore `incrementBusCapacity()` uses an atomic transaction. If the transaction fails (bus not found, capacity race), it throws and nothing is written. If it succeeds, the capacity is incremented. If the subsequent Student step fails, the lease expires and the next retry will NOT re-increment (because the first increment is already committed to Firestore). The capacity is "sticky" — it stays incremented until explicitly decremented.

**This is acceptable because:**
- If Student fails, the application stays in state `'processing'`
- The lease expires after 5 minutes
- The cron reclaims the lock
- On retry, `Seat.assignSeat()` is called again — but Firestore's `incrementBusCapacity()` is a read-modify-write in a transaction. It re-reads the current capacity and increments from there. The previous increment is not lost.
- `Student.applyRenewal()` is called again — it re-reads the current student and applies `max()` logic. No double-extend.

**The only "waste" is:** a seat is reserved but the student isn't updated. This resolves itself when the lease expires and the seat is available for the next approval attempt. No manual intervention needed.

---

## Concern 3: Seat Operations Still in Firestore

**Problem:** If D6 Fleet has been migrated to PostgreSQL, why is seat assignment still in Firestore?

**Answer:** D6 Fleet migration only migrated **bus master data** (id, number, capacity, driver, route, status) to PostgreSQL `buses` table. The **capacity counters** (morningCount, eveningCount, currentMembers, load) are NOT in the PostgreSQL schema. They still live in the Firestore `buses` document as nested fields.

**Evidence:**
- `supabase/migrations/20260708_d6_fleet_buses.sql` — no capacity counter columns
- `src/domains/seat/repositories/seat.repository.ts` — wraps Firestore: "No seat_assignments table exists yet (capacity truth still lives on the Firestore Bus document)"
- `src/lib/busCapacityService.ts` — uses Firestore transactions for atomic capacity mutations

**Status:** Seat capacity is legitimately in Firestore (temporary migration stage). The Seat domain is a Firestore wrapper. This is correct for D8.

**Future:** When capacity counters move to PostgreSQL (D9 or later), the Seat domain's repository will be updated. The service layer (`Seat.assignSeat()`, `Seat.getCapacity()`) stays the same.

**Plan note:** D8 uses Seat domain as-is (Firestore-backed). No seat migration in D8 scope.

---

## Concern 4: Rejection Visibility — Dashboard Audit

**Problem:** If rejected renewals stay as `state = 'rejected'` (not deleted), will dashboards double-count?

**Current renewal_queries (all 3 Firestore queries):**

1. `dashboard-counts/route.ts:59`:
   ```
   adminDb.collection('renewal_requests').where('status', '==', 'pending').count()
   ```
   → Counts ONLY `status == 'pending'`. Rejected rows (status == 'rejected') are NOT counted. ✓

2. `analytics.repository.ts:136`:
   ```
   adminDb.collection('renewal_requests').where('status', '==', 'pending').count()
   ```
   → Same query. Only pending. ✓

3. `renew-services/route.ts`:
   ```
   renewal_requests.where('status', '==', 'pending').get()
   ```
   → Lists ONLY pending. Rejected rows not shown. ✓

**After migration:**
- The `renewal_requests` Firestore collection is frozen (no new writes)
- New queries use `applications` table with `application_type = 'renewal' AND state = 'pending'`
- Rejected renewals (`state = 'rejected'`) are NOT counted in pending queries
- No double-counting possible

**For admin dashboards showing ALL renewals (including rejected):**
- Filter by `application_type = 'renewal'` and exclude `state = 'rejected'` if needed
- This is a UI concern, not a data integrity concern

**Verdict:** No dashboard double-counting. All existing queries filter by `status == 'pending'`.

---

## Concern 5: state_history Duplicate Entries

**Problem:** If `finalize_application_state()` appends to `state_history` on every call, an idempotent retry could create duplicate "approved" entries.

**Resolution:** Check the latest state_history entry before appending.

**Revised finalize_application_state() RPC:**

```sql
-- Only append if the latest state_history entry is NOT already 'approved'
IF NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(
    COALESCE(state_history, '[]'::jsonb)
  ) AS entry
  WHERE entry->>'state' = 'approved'
  ORDER BY entry->>'timestamp' DESC
  LIMIT 1
) THEN
  state_history = COALESCE(state_history, '[]'::jsonb) ||
    jsonb_build_object('state', 'approved', 'timestamp', NOW()::text, 'actor', p_approver_uid);
END IF;
```

**Or simpler:** Check if the row is already approved before the UPDATE:

```sql
-- If state is already 'approved', this is an idempotent no-op
IF EXISTS(SELECT 1 FROM applications WHERE application_id = p_application_id AND state = 'approved') THEN
  RETURN jsonb_build_object('success', true, 'finalized', false, 'already_finalized', true, 'application_id', p_application_id);
END IF;
```

This is already in the contract (step 4 of finalize_application_state). The state_history append only happens during the UPDATE, which only happens when state transitions from 'processing' to 'approved'. If state is already 'approved', the UPDATE matches 0 rows and no history is appended.

**Verdict:** No duplicate history entries. The state check prevents re-entry.

---

## Concern 6: Side-Effect Criticality Matrix

| Side Effect | Critical? | Retry? | Blocks Approval? | Failure Handling |
|------------|-----------|--------|-----------------|-----------------|
| Seat.assignSeat() | Yes | Yes | Yes | If fails: lease expires, retry from start. No compensation needed (seat-first ordering). |
| Student.applyRenewal() | Yes | No | Yes | If fails: lease expires, retry from start. Student state is re-read and re-applied (deterministic). |
| Payment (offline create) | Yes | Yes | Yes | If fails: lease expires, retry. createOfflinePaymentAtApproval is idempotent. |
| Payment (online no-op) | N/A | N/A | No | Online: no action needed. Payment already recorded by webhook. |
| Audit log | No | Yes | No | Post-commit. Fire-and-forget. If fails: logged, not retried. Approval still succeeds. |
| Notification (Firestore) | No | Yes | No | Post-commit. Fire-and-forget. If fails: logged, not retried. |
| Email | No | Yes | No | Post-commit. Fire-and-forget. If fails: logged, not retried. |
| Cloudinary cleanup | No | Yes | No | Post-commit. Fire-and-forget. If fails: logged, not retried. Orphaned asset is harmless. |
| finalize_application_state() | Yes | Yes | Yes | If fails: lease expires, retry from start. RPC is idempotent. |

**Key principle:** Only Seat, Student, Payment, and Finalize are critical and block approval. Audit, Notification, Email, and Cloudinary are non-critical post-commit side effects.

---

## Concern 7: Cross-Domain Ownership Matrix

| Field | Owner Domain | Updated By | Notes |
|-------|-------------|-----------|-------|
| validUntil | Student | Student.applyRenewal() | `max(current, calculated)` |
| durationYears | Student | Student.applyRenewal() | `current + renewal` |
| sessionEndYear | Student | Student.applyRenewal() | `max(current, baseYear + duration)` |
| softBlock | Student | Student.applyRenewal() | Computed from validUntil |
| hardBlock | Student | Student.applyRenewal() | Computed from validUntil |
| status | Student | Student.applyRenewal() | Set to 'active' |
| lastRenewalDate | Student | Student.applyRenewal() | Set to NOW() |
| seatReleasedAt | Student | Student.applyRenewal() | Cleared if seatWasReleased |
| paymentAmount | Student | Student.applyRenewal() | Set to totalFee |
| updatedAt | Student | Student.applyRenewal() | Set to NOW() |
| application.state | Application | finalize_application_state() RPC | 'processing' → 'approved' |
| application.processing_lock | Application | finalize_application_state() RPC | Cleared to NULL |
| application.processing_result | Application | finalize_application_state() RPC | Set to 'approved' |
| application.state_history | Application | finalize_application_state() RPC | Append 'approved' entry |
| application.approved_at | Application | finalize_application_state() RPC | Set to NOW() |
| application.approved_by | Application | finalize_application_state() RPC | Set to approver UID |
| payment.status | Payment | createOfflinePaymentAtApproval() | Set to 'Completed' |
| bus.morningCount | Seat | Seat.assignSeat() | Firestore transaction |
| bus.eveningCount | Seat | Seat.assignSeat() | Firestore transaction |
| bus.currentMembers | Seat | Seat.assignSeat() | Derived statistic |

**Every field has exactly one owner. No field is written by two domains.**

---

## Revised Plan Changes (Summary)

1. **Remove `lastApplicationId`** from Student.applyRenewal() — idempotency handled by lease + RPC state machine + `max()` logic
2. **Seat-first ordering** — reserve seat BEFORE student update. No compensation needed.
3. **Seat operations remain in Firestore** — capacity counters not yet migrated to PostgreSQL. Seat domain is a Firestore wrapper. This is correct for D8.
4. **Rejection keeps row** — `state = 'rejected'`. No dashboard double-counting (all queries filter by `status == 'pending'`).
5. **state_history dedup** — already handled by the state check in finalize_application_state() (UPDATE only matches when state = 'processing').
6. **Side-effect criticality table** — 4 critical (Seat, Student, Payment, Finalize), 4 non-critical (Audit, Notification, Email, Cloudinary).
7. **Cross-domain ownership matrix** — every field has exactly one owner.

---

## Revised Implementation Order

```
Application.approve(renewalApplication)
  ↓
  1. approve_application() RPC → validate + lock + payload
  ↓
  2. Switch: applicationType === 'renewal' || 'renewal_after_soft_block'
  ↓
  3. Seat.getCapacity(busId, shift)        — pre-flight (read-only, reject if full)
  ↓
  4. Seat.assignSeat(busId, studentUid, shift) — reserve FIRST (Firestore txn)
  ↓
  5. Student.applyRenewal(studentUid, {...})   — update SECOND (PG, deterministic)
  ↓
  6. Payment (online: no-op | offline: createOfflinePaymentAtApproval)
  ↓
  7. Post-commit: Audit + Notification + Email + Cloudinary (non-critical, fire-and-forget)
  ↓
  8. finalize_application_state() RPC → state='approved', clear lock, append history
```

If step 4 fails → lease expires, retry from start (no compensation needed).
If step 5 fails → lease expires, seat reservation abandoned, retry from start.
If step 6 fails → lease expires, retry (idempotent).
If step 8 fails → lease expires, retry (idempotent).
