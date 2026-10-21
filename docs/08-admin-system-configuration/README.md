# Domain 08: Admin System Configuration, Dynamic Deadlines & Bus Pricing

================================================================================
EXECUTIVE SUMMARY & SYSTEM TOPOLOGY
================================================================================

The **Admin System Configuration Domain** provides the central control plane for Assam down town University (ADTU ITMS) administrative parameters:
- Centralized configuration persistence in PostgreSQL `public.system_settings` (keys: `'config'`, `'deadline'`, `'landing'`, `'ui'`).
- Complete elimination of legacy Firestore dual-writes and fallbacks.
- Dynamic Academic Calendar Management: dynamic milestone projection via `deriveAcademicLifecycle` without static year drift.
- Atomic Mid-Session Recalculation Cascade ([`recalculate_academic_lifecycle_dates`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/supabase/COMPLETE_SCHEMA.sql)): shifts expiration and soft-block dates across active students and upcoming applicants on calendar changes.
- Zero-Redis-Load Multi-Node Cache Self-Healing: guarantees fee accuracy during checkout bursts without inter-node Redis overhead.
- Automated Maintenance & Retention Crons: grace-period soft-blocking, seat release, and data-minimization hard deletion.

```
            [ Administrator UI (/admin/system-settings) ]
                                 │
                   POST /api/settings/deadline-config
                   POST /api/settings/bus-fees
                                 │
                                 ▼
                 ┌───────────────────────────────┐
                 │     CONFIG & CALENDAR REPO    │
                 │   - src/domains/admin/        │
                 │   - src/domains/calendar/     │
                 └───────┬───────────────┬───────┘
                         │               │
       1. Invalidate L1  │               │ 2. Atomic PostgreSQL Write
          Memory Cache   │               │    (public.system_settings)
                         ▼               ▼
             ┌───────────────────┐   ┌───────────────────────────┐
             │ Process L1 Cache  │   │   SUPABASE POSTGRESQL     │
             │ - configCache     │   │ - public.system_settings  │
             │ - activeConfig    │   │ - RPC recalculate_dates   │
             └───────────────────┘   │ - public.student_profiles │
                                     │ - public.applications     │
                                     └───────────────────────────┘
```

---

## 1. Domain State Taxonomy & Invariants

| State Classification | Storage Engine | Concrete Entities | Retention / Eviction Policy | Invariant Enforced |
| :--- | :--- | :--- | :--- | :--- |
| **Durable Authoritative** | PostgreSQL 16 | `public.system_settings` (`key = 'config'`, `'deadline'`) | Permanent configuration store; updated by verified admins. | Authoritative single source of truth for university transit rules. |
| **Transactional State** | PostgreSQL 16 | `recalculate_academic_lifecycle_dates` | Single ACID transaction; cascades date shifts across cohorts. | Prevents false soft-blocking when session dates shift mid-year. |
| **Audit History** | PostgreSQL 16 | `public.audit_events` | Append-only immutable log. | Audits every fee change, calendar adjustment, and admin override. |
| **Process-Local L1 Cache** | Node.js Memory | `configMemoryCache`, `activeConfigCache` | 5-minute TTL; process-local self-healing on price mismatch. | Zero database queries during high-concurrency landing page visits. |

---

## 2. Low-Level Component Architecture

### 2.1 Configuration Service (`src/domains/admin/services/config.service.ts`)
- Pure PostgreSQL `system_settings` implementation.
- Manages `getSystemConfig()`, `updateSystemConfig()`, and `invalidateConfigCache(key)`.
- Implements process-local 5-minute memory caching (`configMemoryCache`) with O(1) key invalidation.

### 2.2 Calendar Repository (`src/domains/calendar/repositories/calendar.repository.ts`)
- Authoritative reader and writer for `public.system_settings` where `key = 'deadline'`.
- Uses `deriveAcademicLifecycle(startMonth, startDay, currentYear)` to project milestones.
- Exposes `invalidateActiveConfigCache()` and `getCachedActiveConfig()`.

### 2.3 Deadline Config API (`src/app/api/settings/deadline-config/route.ts`)
- `POST`: Verified via `verifyApiAuth(req, ['admin'])` and rate-limited (`RateLimits.UPDATE`).
- Validates date boundaries (month $0..11$, day $1..\text{maxDay}$).
- Invokes `syncSystemConfigDates` calling atomic RPC `recalculate_academic_lifecycle_dates` with a TypeScript fallback.
- Triggers wildcard cache flush across active config, system config, and student assignments.

---

## 3. Detailed Document Roadmap

1. [**01-academic-calendar-and-deadlines.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/01-academic-calendar-and-deadlines.md)
   - Dynamic per-student year rule, 9 lifecycle milestones, automated retention crons, and seat release mechanics.
2. [**02-bus-fees-and-pricing.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/02-bus-fees-and-pricing.md)
   - Official fee structure, versioned audit history, multi-year multiplier math, and zero-Redis self-healing.
3. [**03-system-settings-and-maintenance.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/03-system-settings-and-maintenance.md)
   - Landing page assets, UI toggles, maintenance mode, and nightly integrity sweep orchestrators.

---

## 4. Key Production Verification Gates

- **Pure PostgreSQL Storage**: 100% verified zero Firestore calls in `config.service.test.ts`.
- **Zero-Redis Consistency**: Verified in `cross-pillar-lifecycle-integration.test.ts`.
- **Mid-Session Calendar Shift**: Verified in automated chaos test battery.
