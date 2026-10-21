# Domain 04: Students, Applications & Smart Capacity Allocation

================================================================================
EXECUTIVE SUMMARY & SYSTEM TOPOLOGY
================================================================================

The **Students & Allocation Domain** manages student transport onboarding, academic year session derivation, smart bus capacity allocation, atomic seat reassignment, and service renewals across Assam down town University (ADTU ITMS).
- Multi-cohort transport enrollment: fresh admissions, session renewals, and future-session staging (`verified_upcoming`).
- Dynamic mid-session academic calendar recalculation cascade ([`recalculate_academic_lifecycle_dates`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql)): shifts session bounds across active students and upcoming applicants without manual data fixes.
- Atomic seat quota guarantees: vehicles cannot be overbooked; concurrent seat claims are serialized via PostgreSQL row locks (`approve_renewal_with_seat`).
- Deadlock-free atomic student reassignment ([`reassign_students_atomically`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql)): pre-locks all involved buses in strict `ORDER BY id ASC FOR UPDATE` order, preventing PostgreSQL 40P01 deadlocks.
- Shift parity accounting: supports Morning, Evening, and Both shifts with exact seat load decrement and increment.
- Wildcard cache invalidation cascade ([`src/domains/student/services/student-assignment-cache.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/student/services/student-assignment-cache.ts)): flushes student bus assignments instantly upon seat reassignment or administrative calendar shift.

```
       [ Student Submits Application ]
                     │
                     ▼
         [ Application Eligibility ]
         - calculateAcademicSessionStartYear(now, config)
         - resolveApplicationType()
                     │
        ┌────────────┴────────────┐
        │                         │
  [ Target: Current Year ]   [ Target: Future Year ]
        │                         │
        ▼                         ▼
  (State: 'submitted')      (State: 'verified_upcoming')
  (Approvable Immediately)  (Holds until eligibleApproval)
        │                         │
        └────────────┬────────────┘
                     │ Moderator Reviews & Approves
                     ▼
      ┌───────────────────────────────┐
      │  approve_renewal_with_seat    │
      │  - SELECT FOR UPDATE on bus   │
      │  - Enforce vehicle capacity   │
      │  - Increment load by shift    │
      │  - Update student_profiles    │
      └──────────────┬────────────────┘
                     │
                     ▼
      [ Invalidate Assignment Cache ]
      - invalidateStudentAssignmentCache(uid)
      - Emit realtime seat update
```

---

## 1. Domain State Taxonomy & Invariants

| State Classification | Storage Engine | Concrete Entities | Retention / Eviction Policy | Invariant Enforced |
| :--- | :--- | :--- | :--- | :--- |
| **Durable Authoritative** | PostgreSQL 16 | `public.student_profiles`, `public.applications`, `public.buses` | Permanent records; Soft-block $\rightarrow$ Hard-delete retention lifecycle. | Strict vehicle capacity ($\text{load} \le \text{capacity}$); unique enrollment ID. |
| **Transactional State** | PostgreSQL 16 | `approve_renewal_with_seat`, `reassign_students_atomically`, `soft_block_student_with_seat_release` | ACID transactions; serializes concurrent claims. | No overbooking; shift parity ('Morning', 'Evening', 'Both'). |
| **Audit History** | PostgreSQL 16 | `public.reassignment_logs`, `public.audit_events` | Append-only immutable table; records pre/post reassignment state. | Full historical traceability with snapshot rollback support. |
| **Process-Local L1 Cache** | Node.js Memory | `studentAssignmentCache` (L1 Memory Map) | 5-minute TTL; wiped via wildcard `*` on calendar shifts. | Zero DB lookups during bus pass scans and route navigation. |
| **Ephemeral Cache** | Redis 7.2 | `student_assignment:{uid}` | Synchronized with L1; Redis Pub/Sub invalidations. | Fast cross-node cache eviction across cluster instances. |

---

## 2. Low-Level Component Architecture

### 2.1 Dynamic Academic Calendar & Session Derivation (`src/lib/utils/application-eligibility.ts`)
- **`calculateAcademicSessionStartYear(now, config)`**: Dynamically derives current session start year from active system calendar configuration rather than hardcoded month values.
- **`resolveApplicationType(app, now, config)`**: Classifies applications into `'fresh'`, `'renewal'`, `'renewal_after_soft_block'`, or `'future'`. Automatically transitions unapproved future applications to `'fresh'` once their target start year arrives.
- **`computeFutureEligibleApproval(targetStartYear, config)`**: Computes the exact timestamp when future applications become approvable:
  $$\text{eligibleApproval} = \text{softBlock}(\text{targetStartYear}) + 1\text{ day}$$
  ensuring outgoing cohorts release seats before incoming cohorts occupy them.

### 2.2 Atomic Capacity & Seat Allocation (`supabase/COMPLETE_SCHEMA.sql`)
- **`approve_renewal_with_seat` RPC**:
  - Atomically locks target vehicle row `FOR UPDATE`.
  - Enforces capacity constraints: rejects approval with `BUS_FULL` if morning or evening load would exceed physical seats.
  - Updates student profile, assigns bus, route, and stop, and sets calculated `valid_until`, `soft_block`, and `hard_block`.
- **`reassign_students_atomically` RPC**:
  - Pre-locks all source and target buses sorted by `id ASC` (`ORDER BY id ASC FOR UPDATE`), permanently eliminating deadlock conditions (PostgreSQL error `40P01`).
  - Calculates shift deltas: accurately increments and decrements Morning, Evening, or Both shift loads.
  - Generates immutable snapshot entries in `public.reassignment_logs`.

### 2.3 Student Assignment Caching Engine (`student-assignment-cache.ts`)
- Dual-tier caching (Process memory L1 + Redis L2).
- Provides wildcard invalidation `invalidateStudentAssignmentCache('*')` which purges all in-memory entries and issues Redis pattern deletions when an administrator updates the academic calendar or performs bulk bus reassignments.

---

## 3. Detailed Document Roadmap

1. [**01-application-and-boarding.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/01-application-and-boarding.md)
   - Prospective onboarding, multi-step wizard, moderator verification codes, Cloudinary uploads, and full administrative review/approval/rejection/staging state machine.
2. [**02-smart-seat-allocation.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/02-smart-seat-allocation.md)
   - Intelligent capacity discovery, the "Full Bus / Single-Bus Stop / Alternative Bus" resolution engine, and fleet route/driver rostering allocation (`assign_drivers_atomically`, `assign_routes_atomically`).
3. [**03-student-reassignment-domain.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/03-student-reassignment-domain.md)
   - Deadlock-free batch student reassignment (`reassign_students_atomically`), 1-click rollback engine (`execute_reassignment_rollback`), immutable audit snapshots, and shift parity math.
4. [**04-academic-calendar-cascade-and-eligibility.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/04-academic-calendar-cascade-and-eligibility.md)
   - Dynamic academic calendar engine, simulation mode, deadline configuration, per-student milestone derivation, and global administrative settings.
5. [**05-lifecycle-crons-and-retention.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/05-lifecycle-crons-and-retention.md)
   - Automated daily lifecycle crons, session activation (`verified_upcoming`), expiry warnings, soft-block seat release, hard cascade deletion (`delete_student_cascade_v1`), and bus load reconciliation (`adminReconcileBusLoads`).
6. [**06-student-profiles-and-change-requests.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/06-student-profiles-and-change-requests.md)
   - Student profile lifecycle, stop/shift change requests, administrative/moderator student CRUD, `SeatReclaimRequiredError`, and financial pass linking.
7. [**07-database-schema-and-rpc-reference.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/07-database-schema-and-rpc-reference.md)
   - Complete relational schema, foreign keys, immutability check constraints, indexes, and PL/pgSQL stored procedures for the academic and allocation pillar.
8. [**08-hardening-verification-and-cross-pillar-gates.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/08-hardening-verification-and-cross-pillar-gates.md)
   - 14-point hardening audit, invariant verification matrix, state machine proofs, Vitest test suite runs, and cross-pillar integration freeze certification.
9. [**ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md)
   - Consolidated master reference (scheduled for archival after child file transition verification).

---

## 4. Key Production Verification Gates

- **ACID Integrity**: Zero seat overbooking guaranteed by PostgreSQL `FOR UPDATE` serial locks.
- **Deadlock Immunity**: Zero 40P01 errors under 50+ concurrent batch reassignments.
- **Automated Vitest Coverage**: Verified in `academic-lifecycle-fixes.test.ts` and `cross-pillar-lifecycle-integration.test.ts`.
