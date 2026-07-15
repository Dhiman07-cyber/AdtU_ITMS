# ITMS PostgreSQL Migration — Status & Architecture

> Canonical source of truth for the `Production-Readiness` branch.
> Generated from actual codebase state. Do not trust outdated markdown files.

---

## Project Overview

**ITMS** (University Transport Management System) manages university bus transport — students, drivers, buses, routes, assignments, payments, applications, and notifications.

**Stack:** Next.js (App Router) + TypeScript + Firestore (legacy) + PostgreSQL via Supabase + Firebase Auth + FCM push notifications.

---

## Migration Objective

Migrate from Firestore to PostgreSQL using **Domain Driven Design**, one domain at a time.

- Each domain becomes the sole owner of its data
- No dual-write after migration
- No Firestore fallback
- PostgreSQL is the canonical source of truth for migrated domains
- Repositories contain persistence only
- Services contain business logic only

---

## Architecture

```
Application (API routes / pages)
        │
        ▼
    Domain (index.ts barrel)
        │
        ▼
    Service (business logic, validation)
        │
        ▼
    Repository (persistence only)
        │
        ▼
    PostgreSQL (Supabase)
```

**Rules enforced during migration:**
- Repository = persistence only (no business logic, no validation)
- Service = business logic only (no SQL knowledge, no direct DB calls)
- One barrel export per domain (`@/domains/<name>`)
- No deep imports from external callers
- Codebase is the only source of truth

---

## Migration Phases

### D1–D9: Foundational Domains

Migrated before this branch's focused sessions.

| Domain | Status | PG Tables |
|--------|--------|-----------|
| D1 Identity | Service layer migrated, client SDK still used for reads | users, students, drivers, moderators, admins |
| D2 Calendar | **Fully migrated** | deadline_configs |
| D3 Student | Service layer migrated, heavy Firestore in UI/services | students (PG), Firestore for real-time |
| D4/D8 Application | **Fully migrated** | applications, renewals via PG RPCs |
| D5 Payment | **Fully migrated** | payments |
| D6 Fleet | **Fully migrated** | buses, drivers (PG), Firestore for real-time |
| D7 Route | **Fully migrated** | routes |
| D9 Trip | **Fully migrated** | trips |

### D10: Notification & Communication

**Status: COMPLETE**

- PostgreSQL notification schema, repository, service
- API migration (notifications, FCM tokens)
- Context migration (useNotification → PG polling)
- Removed Firestore notification CRUD
- Removed legacy NotificationService
- Notification polling preserved

### D11: Administration & System Configuration

**Status: COMPLETE**

- Migrated Firestore `settings/*` → PostgreSQL `system_config` + `system_markers`
- Configuration repository + service
- Marker repository + service
- Route migration, operational marker migration
- Session activation migration
- Cleanup cron migration
- Shared `updated_at` trigger
- D11.2 metadata cleanup (introduced `ConfigResult<T>`)

### D12: Audit & Logging

**Status: COMPLETE**

- PostgreSQL audit schema (`audit_events` — immutable, append-only)
- Audit repository (INSERT + SELECT only)
- Audit service (validation + delegation, never-throw)
- 16 production callers migrated to PG
- Admin audit API migrated
- Admin audit UI migrated
- All Firestore audit writers removed
- Legacy Firestore audit infrastructure deleted
- Dead constants, outbox writes, delegation layers removed
- Final production audit: zero legacy references remain

---

## Current PostgreSQL Architecture

### Domains with Full PG Ownership

| Domain | Service | Repository | Tables |
|--------|---------|------------|--------|
| Calendar | `calendar.service.ts` | `calendar.repository.pg.ts` | deadline_configs |
| Application | `application.service.ts` | `application.repository.pg.ts` | applications (via RPCs) |
| Payment | `payment.service.ts` | `payment.repository.ts` | payments |
| Fleet | `fleet.service.ts` | `fleet.repository.pg.ts` | buses, drivers |
| Route | `route.service.ts` | `route.repository.pg.ts` | routes |
| Trip | `trip.service.ts` | `trip.repository.ts` | trips |
| Notification | `notification.service.ts` | `notification.repository.pg.ts` | notifications, fcm_tokens |
| Admin/Config | `config.service.ts` | `config.repository.pg.ts` | system_config, system_markers |
| Audit | `audit.service.pg.ts` | `audit.repository.pg.ts` | audit_events |

### Domain Barrel Convention

Every domain exports through `src/domains/<name>/index.ts`:

```typescript
// Canonical import for external callers
import { ... } from '@/domains/audit';
```

Deep imports (`@/domains/audit/services/...`) are forbidden from outside the domain.

---

## Firestore Status

### Intentionally Still Firestore

These collections are actively read/written and **not in scope** for this migration:

| Collection | Reason |
|------------|--------|
| `users` | Identity layer — client SDK reads throughout UI |
| `students` | Real-time reads in UI, assignment transactions |
| `drivers` | Real-time reads in UI, assignment transactions |
| `buses` | Real-time reads, capacity transactions |
| `routes` | Real-time reads, assignment transactions |
| `admins` / `moderators` | Auth checks in ~20 API routes |
| `applications` | Residual reads in dashboard/analytics |
| `fcm_tokens` | FCM token management (client + admin SDK) |
| `swap_requests` | Driver swap feature (not yet a domain) |
| `profile_update_requests` | Driver profile updates |
| `waiting_flags` | Driver proximity features |
| `announcements` | Bus fee announcements |
| `audit_failures` | Payment recovery outbox (2 writers) |

### Removed by Migration

| Collection | Removed In |
|------------|------------|
| `audit_logs` | D12 — replaced by PG `audit_events` |
| `activity_logs` | D12 — writers migrated to PG audit |
| `driver_swap_audit` | D12 — constant removed (dead) |
| `settings` | D11 — replaced by PG `system_config` + `system_markers` |

---

## Repository Conventions

1. **Repository = persistence only.** No business logic, no validation, no retries.
2. **Service = business logic only.** No SQL, no direct DB calls.
3. **Codebase is the only source of truth.** Documentation may be outdated.
4. **PostgreSQL is canonical** for migrated domains.
5. **No dual-write.** No simultaneous Firestore + PG writes.
6. **No Firestore fallback** after migration complete.
7. **Minimal storage.** Every column must justify itself by current production use.
8. **No duplicated metadata.** Business data only in storage; operational metadata in JSONB or separate columns.
9. **Barrel exports.** All public domain API goes through `index.ts`.
10. **Never-throw pattern.** Audit service returns `AuditResult`, never throws.

---

## Testing Checklist

Before merge, verify these areas:

### Audit (D12)
- [ ] Admin audit-logs page loads and displays PG events
- [ ] Filter by category, severity, role, date range works
- [ ] Search across actions/summaries/targets works
- [ ] Pagination works
- [ ] Detail dialog shows metadata correctly
- [ ] Audit events created on: payment approve/reject, application approve/reject, student delete, user create, session activation, integrity sweep, cron cleanup, reassignment rollback

### Notifications (D10)
- [ ] Notifications API returns PG data
- [ ] Notification polling works
- [ ] FCM token save/update works
- [ ] Notification form sends push notifications
- [ ] Mark as read works

### Configuration (D11)
- [ ] System config reads from PG
- [ ] Config updates persist to PG
- [ ] Operational markers work
- [ ] Session activation reads config from PG
- [ ] Deadline config works

### Core Workflows
- [ ] Student application submission + approval
- [ ] Payment creation + verification
- [ ] Driver route assignment
- [ ] Student reassignment
- [ ] Bus swap
- [ ] Student deletion (with audit)
- [ ] Cron jobs: session activation, cleanup, integrity sweep

---

## Project Status

| Area | Status |
|------|--------|
| D1–D9 foundational domains | Service layers migrated, client SDK still used for real-time UI |
| D10 Notification | **Complete** |
| D11 Administration | **Complete** |
| D12 Audit | **Complete** |
| Branch status | `Production-Readiness` — entering integration testing |
| TypeScript | Clean (zero errors) |
| Tests | 147 passing, 9 pre-existing env-var failures |

**Remaining Firestore footprint:** Identity reads (users/students/drivers/moderators/admins), real-time UI subscriptions, assignment/reassignment transactions, FCM token management, driver swap, analytics dashboard counts. These are intentional — not in scope for this migration.

---

## Branch History

| Commit | Description |
|--------|-------------|
| `f9c7843` | D12 complete audit domain migration + repository cleanup |
| `4fd4ff2` | D11 administration & system configuration migration |
| `3f7c916` | D10 notification recipient resolution fix |
| `8612fe0` | D10 notification & communication migration |
| `cff418e` | D8 renewal migration completion |
| `252161d` | D8 renewal_requests migration |
| `8c5c2bf` | D1–D7 domain snapshot, Firestore freeze |
