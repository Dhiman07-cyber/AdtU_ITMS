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

---

## 5. Comprehensive Low-Level Design (LLD) Breakdown & Justifications

### 5.1 `public.audit_events` Append-Only Ledger (`createAuditEvent`)
- **Concrete Architectural Role**: Immutable compliance logging engine. Persists all security transitions, student status changes, financial revisions, and administrative reassignments with actor UID, role, category, and metadata.
- **Failure Analysis ("Why the System Fails Without It")**:
  - In disputed student disciplinary or financial cases (e.g., student claiming their pass was maliciously revoked), without immutable audit logs, administrators cannot determine who clicked "Soft Block" or when.
  - If audit logging fails synchronously and throws an exception, critical business transactions (like payment capture or student onboarding) would abort merely because a log could not be written!
  - `void createAuditEvent(...)` wraps logging in fail-safe try-catch boundaries, ensuring auxiliary log errors never fail core business transactions.
- **State Taxonomy & Invariants Enforced**:
  - *Audit History & Immutable State* (`audit_events`).
- **Production Code Implementation**:
  ```typescript
  // File: src/lib/audit/audit.service.ts
  export async function createAuditEvent(params: AuditEventParams): Promise<void> {
    try {
      const supabase = getSupabaseServer();
      await supabase.from('audit_events').insert({
        action: params.action,
        actor_id: params.actorId,
        actor_name: params.actorName,
        actor_role: params.actorRole,
        category: params.category,
        summary: params.summary,
        severity: params.severity || 'low',
        metadata: params.metadata || {},
      });
    } catch (err) {
      console.warn('[AuditService] Failed to record audit event (non-fatal):', err);
    }
  }
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Non-Blocking Execution*: Unawaited background promise prevents audit logging latency from delaying HTTP API responses.

---

### 5.2 Dynamic In-Memory Configuration Caching (`invalidateConfigCache`)
- **Concrete Architectural Role**: Database read-reduction cache. Caches global platform configurations (fees, branding, map coordinates) in process memory with a 5-minute TTL.
- **Failure Analysis ("Why the System Fails Without It")**:
  - Every incoming public request loads brand settings, fee structures, and emergency helpdesk phone numbers.
  - 1,500 students loading pages during morning rush produces 1,500 database reads per second for static settings, exhausting database connection limits.
- **State Taxonomy & Invariants Enforced**:
  - *Cache State* (`settingsCache`).
- **Production Code Implementation**:
  ```typescript
  // File: src/lib/config/config.service.ts
  const CONFIG_CACHE_TTL_MS = 300000; // 5 minutes
  let cachedConfig: SystemConfig | null = null;
  let cacheExpiry = 0;

  export async function getSystemConfig(): Promise<SystemConfig> {
    if (cachedConfig && Date.now() < cacheExpiry) return cachedConfig;
    cachedConfig = await fetchConfigFromDb();
    cacheExpiry = Date.now() + CONFIG_CACHE_TTL_MS;
    return cachedConfig;
  }

  export function invalidateConfigCache(): void {
    cachedConfig = null;
    cacheExpiry = 0;
  }
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *99.9% Query Reduction*: 5-minute cache reduces configuration database reads from 50,000 queries/hour to 12 queries/hour per server instance.

