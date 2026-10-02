# System Settings, SRE Controls & Audit Logging

## 1. Domain Overview

The **Admin System Configuration & Maintenance Domain** controls global operational parameters, public landing configurations, site observability, automated data retention lifecycles, and forensic audit logging across the Assam down town University (AdtU) ITMS platform.

---

## 2. Configuration Subsystems & Schemas

Global configuration is partitioned into dedicated documents within the `settings` collection and synchronized to PostgreSQL:

### 2.1 Core System Configuration (`settings/config`)
Controls primary platform variables:
- `appName`: Global brand title (defaults to `'AdtU Bus Services'`).
- `busFee`: Current transit fee structure, revision counter, and adjustment history.
- `mapProvider`: Map tile routing provider (locked to `'guwahati'`).
- `paymentExport`: Start year and interval configurations for financial accounting exports.
- `version`: System schema and configuration migration version.

### 2.2 Public Landing Page Configuration (`settings/landing`)
Configures dynamic assets for public prospective students and parents:
- `videoPath`: Hosted demonstration/promotional video asset path.
- `supportPhones`: Array of emergency transport helpdesk phone numbers.
- `email`: Official transport management office contact email.

### 2.3 UI & Interface Metadata (`settings/ui`)
Stores interface versions and display flags. During storage, `cleanConfigForStorage` automatically strips volatile presentation properties (`icon`, `gradient`, `color`, `description`, `label`) to prevent database bloat and ensure clean data serialization.

### 2.4 In-Memory Caching & Cache Invalidation
To reduce database read pressure during high-traffic registration windows:
- Configuration is cached in memory with a **5-minute Time-to-Live (TTL)** (`CONFIG_CACHE_TTL_MS = 300000`).
- Mutations via administrative endpoints automatically invoke `invalidateConfigCache()`, ensuring updates propagate immediately without server restarts.

---

## 3. SRE Maintenance Controls & Data Retention Crons

Automated background cron jobs run on recurring schedules to enforce database cleanliness, memory stability, and operational invariants:

| Cron Job Endpoint | Schedule | Purpose & Operational Behavior |
| :--- | :--- | :--- |
| **`/api/cron/cleanup-stale-locks`** | Every 1 minute | Calls PostgreSQL RPC `cleanup_stale_trips()`. Scans `active_trips` where driver heartbeat has lapsed > 60 seconds. Purges stale locks, cancels pending waiting flags, and archives trip records with status `'interrupted'`. |
| **`/api/cron/cleanup-expired-students`**| Daily (Midnight) | Evaluates pre-stored student `softBlock` and `hardBlock` dates. Executes `soft_block_student_with_seat_release` and `deleteUserAndData` for expired accounts. Runs tail bus load reconciliation. |
| **`/api/cron/session-activation`** | Daily | Scans `verified_upcoming` applications and automatically activates student profiles and bus passes once the academic session start date arrives. |
| **`/api/cron/expiry-check`** | Daily | Scans student validity dates and sends staged renewal reminders (90, 60, and 15 days before expiry). |
| **`/api/cron/cleanup-notifications`** | Daily | Purges read and ephemeral notifications older than 3 days to maintain lean database tables. |
| **`/api/cron/cleanup-trip-history`** | Monthly | Purges historical completed driver trip records older than 12 months to satisfy university data retention limits. |
| **`/api/unauth-users/cleanup`** | Periodic | Deletes stale unauthenticated registration attempts older than 45 days. |

---

## 4. Master Forensic Audit Logging Engine

All privileged mutations, security events, financial actions, and system cron completions write immutable audit records to `public.audit_events`.

### 4.1 Schema Definition (`public.audit_events`)
```sql
CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    target_id TEXT,
    target_type TEXT,
    target_name TEXT,
    category TEXT NOT NULL,
    summary TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'low',
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 Audit Invariants
- **Append-Only Immutability:** Audit records can never be updated or deleted through application APIs.
- **Fail-Safe Logging:** Background audit emissions are structured using `void createAuditEvent(...)` with internal try-catch blocks to ensure that auxiliary logging failures never abort primary business transactions.
- **Severity Levels:**
  - `'low'`: Routine read operations and profile views.
  - `'medium'`: Application verifications, status queries, draft saves.
  - `'high'`: Role promotions, student soft-blocking, student hard-deletions, bus reassignments.
  - `'critical'`: Financial fee revisions, system emergency lock releases, authentication security breaches.
