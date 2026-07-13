# D8: Renewal Request → Application Domain Migration

## Objective
Migrate `renewal_requests` Firestore collection into the existing `applications` PostgreSQL table. Renewal is NOT a separate bounded context — it's `application_type = 'renewal'`.

## Architecture

Each domain operation is idempotent. A dedicated `RenewalApprovalOrchestrator` coordinates the flow. Retries restart from the beginning — already-completed work becomes a no-op.

```
RenewalApprovalOrchestrator
        │
        ├── Application (lease, state machine)
        ├── Seat (idempotent assign/release)
        ├── Student (idempotent applyRenewal via lastRenewalApplicationId)
        ├── Payment (idempotent create via ON CONFLICT)
        ├── Audit (via post_commit_tasks queue)
        ├── Notification (via post_commit_tasks queue)
        └── Email (via post_commit_tasks queue)
```

See `plans/d8-final-design-v2.md` for the complete design.

---

## Implementation Plan

### Phase 1: Primitives

#### Step 1: `block-policy.ts`
**File:** `src/lib/business/block-policy.ts` — computeBlockDatesFromValidUntil

#### Step 2: SQL migration
**File:** `supabase/migrations/20260709_d8_renewal_to_application.sql`
- `last_renewal_application_id TEXT` on student_profiles (idempotency key)
- `post_commit_tasks` table (PostgreSQL retry queue)
- `finalize_application_state()` RPC
- `CREATE INDEX idx_applications_type_status ON applications (application_type, state)`

#### Step 3: Student.applyRenewal()
**File:** `src/domains/student/services/student.service.ts`

Idempotent via `lastRenewalApplicationId`. If same application → return current student (no-op). Otherwise → calculate with max() logic, persist, set `lastRenewalApplicationId`.

---

### Phase 2: Orchestrator

#### Step 4: RenewalApprovalOrchestrator
**File:** `src/domains/application/services/renewal-approval-orchestrator.ts`

```
1. Acquire lease (RPC)
2. Pre-flight capacity check (Seat.getCapacity)
3. Reserve seat (Seat.assignSeat) — idempotent
4. Apply renewal (Student.applyRenewal) — idempotent via applicationId
5. Create payment (ON CONFLICT DO NOTHING) — idempotent
6. Enqueue post-commit tasks (audit, notification, email, cloudinary)
7. Finalize (finalize_application_state RPC)

Catch: if seatReserved → Seat.releaseSeat()
```

---

### Phase 3: Touchpoints

#### Step 5: Student renewal submission
**File:** `src/app/api/student/renew-service-v2/route.ts` — replace Firestore with Application.submitFinal()

#### Step 6: Renewal approval
**File:** `src/app/api/renewal-requests/approve-v2/route.ts` — replace 330-line Firestore with orchestrator

#### Step 7: Renewal rejection
**File:** `src/app/api/renewal-requests/reject/route.ts` — replace Firestore with Application.rejectApplication()

#### Step 8: Pending renewal queries (5 files)
1. `src/app/api/renew-services/route.ts`
2. `src/app/api/payment/transactions/route.ts`
3. `src/app/api/admin/dashboard-counts/route.ts`
4. `src/domains/analytics/repositories/analytics.repository.ts`
5. `src/lib/services/integrity-detector.ts`

#### Step 9: Payment domain
**Files:** `src/lib/payment/payment.service.ts`, `src/lib/payment/recover/route.ts`

---

### Phase 4: Client SDK Cleanup

#### Step 10: Frontend pages
1. `src/app/admin/renewal-service/page.tsx`
2. `src/app/admin/applications/page.tsx`
3. `src/app/moderator/applications/page.tsx`

---

### Phase 5: Migration & Freeze

#### Step 11: Migration + verification
1. `scripts/migrate-renewal-requests.ts`
2. Verify: Firestore count == PG count, sampled records match
3. **Only freeze AFTER verification passes**

#### Step 12: Freeze Firestore
1. `firestore.rules` — deny renewal_requests
2. `firestore.indexes.json` — remove
3. `src/config/firestore-collections.ts` — remove

---

## Files

| Created | Purpose |
|---------|---------|
| `src/lib/business/block-policy.ts` | computeBlockDatesFromValidUntil |
| `src/infrastructure/post-commit-queue.ts` | PostgreSQL retry queue |
| `src/domains/application/services/renewal-approval-orchestrator.ts` | Cross-domain coordinator |
| `supabase/migrations/20260709_d8_renewal_to_application.sql` | Migration |
| `scripts/migrate-renewal-requests.ts` | Data migration |

| Modified | Change |
|----------|--------|
| `src/domains/student/services/student.service.ts` | applyRenewal() with lastRenewalApplicationId |
| `src/domains/student/index.ts` | export |
| `src/app/api/student/renew-service-v2/route.ts` | replace Firestore |
| `src/app/api/renewal-requests/approve-v2/route.ts` | replace Firestore |
| `src/app/api/renewal-requests/reject/route.ts` | replace Firestore |
| `src/app/api/renew-services/route.ts` | replace Firestore query |
| `src/app/api/payment/transactions/route.ts` | replace Firestore query |
| `src/app/api/payment/recover/route.ts` | replace Firestore query |
| `src/app/api/admin/dashboard-counts/route.ts` | replace Firestore count |
| `src/domains/analytics/repositories/analytics.repository.ts` | replace Firestore query |
| `src/lib/services/integrity-detector.ts` | rewrite |
| `src/lib/payment/payment.service.ts` | replace Firestore create |
| `src/app/admin/renewal-service/page.tsx` | remove client SDK |
| `src/app/admin/applications/page.tsx` | remove client SDK |
| `src/app/moderator/applications/page.tsx` | remove client SDK |
| `firestore.rules` | freeze |
| `firestore.indexes.json` | remove |
| `src/config/firestore-collections.ts` | remove |

---

## Verification

1. TypeScript + ESLint
2. SQL: all RPCs + post_commit_tasks
3. Functional: renewal approve/reject/submit
4. Idempotency: retry same renewal → no double-increment
5. Crash recovery: crash after Seat → seat released, retry succeeds
6. Concurrency: double-approve → 409
7. Post-commit queue: retry + alert on failure
8. Migration: count match + sample hash before freeze
