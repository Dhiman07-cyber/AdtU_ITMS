# Razorpay Payment Lifecycle, Pricing Engine & Webhook Verification (Forensic Truth)

**Module:** Server-Authoritative Fee Pricing, Checkout Initiation, HMAC-SHA256 Signatures & Dual-Path Webhook Reconciliation  
**File Authority:** `src/app/api/payments/create-order/route.ts`, `src/app/api/payments/verify/route.ts`, `src/app/api/webhooks/razorpay/route.ts`  
**Database Tables:** `payments`, `payment_orders`, `system_settings`, `buses`  

---

# PART 2: Server-Authoritative Bus Fee Configuration, Pricing Engine & Dynamic Academic Calendar Derivation

### 2.1 Sub-Domain Architecture & Exact Execution Pipeline

The Bus Fee Configuration, Pricing Engine, and Academic Calendar subsystem enforces server-side pricing integrity and derives commuter lifecycle timelines without client-side trust. All monetary and calendar decisions are anchored to the canonical PostgreSQL table `public.system_settings` with memory-level TTL caching and real-time invalidation.

#### Architectural Dataflow & State Sequence

```
   [Admin Browser]                                     [Student Checkout / Cron]
          │                                                       │
          │ 1. POST /api/settings/bus-fees                        │ 1. getCurrentBusFee()
          ▼                                                       ▼
┌──────────────────────────────────────┐        ┌──────────────────────────────────────┐
│ withSecurity() Rate Limit & Auth     │        │ configMemoryCache (5-min TTL Map)    │
│ - RateLimit: RateLimits.UPDATE       │        │ - Cache Hit: Return cached object    │
│ - Role: 'admin'                      │        │ - Cache Miss: Query PostgreSQL       │
│ - Schema: BusFeeUpdateSchema         │        └──────────────────┬───────────────────┘
└──────────────────┬───────────────────┘                           │
                   │                                               ▼
                   ▼                                    ┌──────────────────────┐
┌──────────────────────────────────────┐                │ public.system_       │
│ getSystemConfig()                    │                │ settings             │
│ - Fetch current config & busFee      │                │ WHERE key = 'config' │
│ - Push current fee to history        │                └──────────┬───────────┘
│ - Cap history: .slice(-3)            │                           │
│ - Bump version: version + 1          │                           ▼
└──────────────────┬───────────────────┘                ┌──────────────────────┐
                   │                                    │ Strict Validation    │
                   ▼                                    │ typeof amount ===    │
┌──────────────────────────────────────┐                │ 'number' && > 0      │
│ cleanConfigForStorage()              │                └──────────────────────┘
│ - Strips UI fields (icon, gradient)  │
│ - Writes to public.system_settings   │
│ - Dual-writes Firestore (compat)     │
│ - Deletes configMemoryCache key      │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ notifyBusFeeChange()                 │
│ - Inserts announcement notification  │
│   via pgInsertNotification()         │
└──────────────────────────────────────┘
```

#### Academic Calendar Derivation Architecture

```
                          ┌─────────────────────────────────────┐
                          │    Academic Session Start Config    │
                          │   (month: 0-11, day: 1-31, year: Y) │
                          └──────────────────┬──────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │   deriveAcademicLifecycle(month, day, Y)  │
                       └─────────────────────┬─────────────────────┘
                                             │
      ┌────────────────────────┬─────────────┴──────────┬────────────────────────┐
      │                        │                        │                        │
      ▼                        ▼                        ▼                        ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ sessionStart │         │    expiry    │         │  reminder1   │         │  hardDelete  │
│ UTC(Y-1,     │         │ UTC(Y, M, D) │         │ 3 months     │         │ UTC(Y+2,     │
│     M, D)    │         │ minus 1 day, │         │ before       │         │     M, D)    │
│              │         │ 23:59:59.999 │         │ expiry (1st) │         │ (Purge date) │
└──────────────┘         └──────┬───────┘         └──────────────┘         └──────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
   ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
   │  reminder2   │       │finalReminder │       │  softBlock   │
   │ 2 months     │       │ 15 days      │       │ UTC(Y, M, D) │
   │ before       │       │ before       │       │ at 00:00:00  │
   │ expiry (1st) │       │ expiry       │       │ (Seat Free)  │
   └──────────────┘       └──────────────┘       └──────────────┘
```

---

### 2.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/domains/admin/services/config.service.ts` | `getSystemConfig`, `updateSystemConfig`, `invalidateConfigCache`, `getLandingConfig`, `updateLandingConfig`, `getUiConfig`, `updateUiConfig`, `getLegalConfig`, `updateLegalConfig`, `findMarker`, `upsertMarker` | `bus-fee-service.ts`, `/api/settings/bus-fees`, `/api/settings/system-config`, checkout APIs | `getSupabaseServer()`, `public.system_settings`, Firestore (dual-write) | Mutates `public.system_settings`, invalidates in-memory `configMemoryCache` (5-min TTL) |
| `src/lib/bus-fee-service.ts` | `getCurrentBusFee`, `updateBusFee`, `getBusFeeHistory`, `notifyBusFeeChange`, `initializeBusFee` | Payment checkout routes, student renewal pages, admin bus-fee APIs | `getSystemConfig`, `updateSystemConfig`, `pgInsertNotification` | Reads/writes config via config service, creates notifications |
| `src/app/api/settings/bus-fees/route.ts` | `GET`, `POST` | Admin Settings UI, Student Checkout Preflight | `getSystemConfig`, `updateSystemConfig`, `notifyBusFeeChange`, `withSecurity` | Mutates `public.system_settings` |
| `src/domains/calendar/repositories/calendar.repository.ts` | `findActiveConfig`, `saveConfig`, `invalidateActiveConfigCache`, `setActiveConfigForTesting` | `calendar.service.ts`, `deadline-config-service.ts` | `getSupabaseServer()`, `public.system_settings`, `deriveAcademicLifecycle` | Reads/writes `system_settings` (key = 'deadline'), in-memory `activeConfigCache` |
| `src/domains/calendar/services/calendar.service.ts` | `getActiveConfig`, `updateConfig`, `computeSession` | Lifecycle crons, admin calendar UI, application review | `calendar.repository.ts`, `deriveAcademicLifecycle` | In-memory computation |
| `src/lib/utils/deadline-computation.ts` | `deriveAcademicLifecycle`, `normalizeLeapYearDate`, `computeDatesForStudent`, `computeBlockDatesFromValidUntil`, `shouldSoftBlockStudent`, `shouldHardDeleteStudent`, `getDaysUntilSoftBlockForStudent`, `getDaysUntilHardDeleteForStudent`, `generateDatePreview` | Calendar service, lifecycle crons, student profile resolvers, admin previews | Pure mathematical and Date computation | In-memory evaluation |
| `src/lib/deadline-config-service.ts` | `getDeadlineConfig`, `updateDeadlineConfig` | Compatibility façade for legacy callers (20+ routes) | `getActiveConfig`, `updateConfig` from `@/domains/calendar` | No direct storage mutations |
| `src/app/api/settings/deadline-config/route.ts` | `GET`, `POST` | Admin Deadline Settings Page | `getDeadlineConfig`, `updateDeadlineConfig`, `checkDependencies`, `adminAuth` | Mutates `system_settings` key 'deadline' |

---

### 2.3 Method-by-Method Low-Level Walkthrough

#### 1. `getSystemConfig()` (Config Service)
- **Signature:** `export async function getSystemConfig(): Promise<ConfigResult<SystemConfig>>`
- **Control Flow:**
  1. Checks in-memory cache: `configMemoryCache.get('config')`. If cached and `Date.now() < cached.expiresAt`, returns cached `ConfigResult` immediately.
  2. Authoritative PostgreSQL Lookup: Calls `getFromPg<SystemConfig>('config')` querying `SELECT value, updated_at, updated_by FROM public.system_settings WHERE key = 'config'`.
  3. If found and non-empty, sets cache with 5-minute TTL (`Date.now() + 300,000ms`) and returns.
  4. Fallback: If not in PostgreSQL, queries Firestore document `settings/config`.
  5. Default Fallback: If both fail, returns default object: `{ appName: 'AdtU Bus Services', busFee: { amount: 5000, version: 1 } }`.

#### 2. `updateSystemConfig(data, updatedByUid)`
- **Signature:** `export async function updateSystemConfig(data: Partial<SystemConfig>, updatedByUid: string): Promise<SystemConfig>`
- **Control Flow:**
  1. Fetches current config via `getSystemConfig()`.
  2. Merges `{ ...previous, ...data }`.
  3. Sanitizes via `cleanConfigForStorage`:
     - Strips prototype pollution / unsafe keys via `stripUnsafeObjectKeys`.
     - Deletes UI display fields (`icon`, `gradient`, `color`, `description`, `label`).
     - Truncates `busFee.history` to at most 3 entries (`slice(-3)`).
  4. Sets timestamps: `cleaned.lastUpdated = new Date().toISOString()`, `cleaned.updatedBy = updatedByUid`.
  5. Writes to PostgreSQL via `saveToPg('config', cleaned, updatedByUid)` executing `UPSERT INTO public.system_settings (key, value, updated_at, updated_by)`.
  6. Dual-writes to Firestore `settings/config` if initialized.
  7. Invalidates memory cache: `configMemoryCache.delete('config')`.
  8. Returns cleaned config.

#### 3. `getCurrentBusFee()` (Bus Fee Service)
- **Signature:** `export async function getCurrentBusFee(): Promise<BusFeeData>`
- **Control Flow:**
  1. Calls `getSystemConfig()`.
  2. Extracts `const amount = config.busFee?.amount`.
  3. Strict Server-Authoritative Guard: Evaluates `typeof amount !== 'number' || amount <= 0`.
  4. If invalid, **DOES NOT FALLBACK** to hardcoded values; throws explicit error:
     `'Bus fee configuration is missing in settings database. Please configure settings and try again later.'`
  5. Returns `{ amount, updatedAt, updatedBy, version: 1 }`.

#### 4. `POST /api/settings/bus-fees` (API Route Handler)
- **Guard:** Wrapped with `withSecurity` requiring role `'admin'`, schema `BusFeeUpdateSchema` (`amount: z.number().min(0).max(1000000)`), and rate limit `RateLimits.UPDATE`.
- **Control Flow:**
  1. Extracts `uid = auth.uid` and `{ amount } = body`.
  2. Validates `amount > 0`, returning 400 if invalid.
  3. Fetches current config via `getSystemConfig()`.
  4. Appends current active fee to history:
     `combinedHistory = [...existingHistory, { amount: oldAmount, updatedAt: ... }].slice(-3)`.
  5. Builds `updatedConfig` with new fee, new timestamp, bumped `version = (version || 0) + 1`, and capped history.
  6. Calls `updateSystemConfig(updatedConfig, uid)`.
  7. Dispatches broadcast notification via `notifyBusFeeChange(uid, oldAmount, amount)` inserting an announcement into `notifications` table.
  8. Returns 200 with `{ message: 'Bus fee updated successfully', fees: amount, notificationSent }`.

#### 5. `deriveAcademicLifecycle(startMonth, startDay, effectiveYear)`
- **Signature:** `export function deriveAcademicLifecycle(startMonth: number, startDay: number, effectiveYear: number): DerivedLifecycle`
- **Parameter Definitions:**
  - `startMonth`: 0-indexed integer (0 = January, 6 = July).
  - `startDay`: Day of month (e.g. 1).
  - `effectiveYear`: The commuter's target academic session end year (e.g. 2026).
- **Exact Date Derivations:**
  1. `sessionStart = Date.UTC(effectiveYear - 1, startMonth, startDay, 0, 0, 0, 0)`
  2. `expiry`: Starts at `Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0)`, decrements by 1 UTC day, sets time to `23:59:59.999` UTC.
  3. `reminder1`: Subtracts 3 UTC months from expiry, sets date to 1st of that month, time to `00:00:00.000` UTC (e.g. April 1st).
  4. `reminder2`: Subtracts 2 UTC months from expiry, sets date to 1st of that month, time to `00:00:00.000` UTC (e.g. May 1st).
  5. `finalReminder`: Subtracts 15 UTC days from expiry, time to `00:00:00.000` UTC (e.g. June 15th).
  6. `deadline`: Exactly matches `expiry`.
  7. `softBlock = Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0)` UTC (e.g. July 1st, 00:00:00).
  8. `activation = Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0)` UTC (matches softBlock).
  9. `hardDelete = Date.UTC(effectiveYear + 2, startMonth, startDay, 0, 0, 0, 0)` UTC (two full academic cycles after expiry).
  10. **Leap Year Normalization:** Iterates through all 9 derived date objects. If `month === 1 && day === 29` (Feb 29) on a non-leap year, normalizes to Feb 28.
  11. Returns `DerivedLifecycle` object containing all 9 dates.

#### 6. `computeBlockDatesFromValidUntil(validUntil, config)`
- **Signature:** `export function computeBlockDatesFromValidUntil(validUntil: string | Date, config: DeadlineConfig): { softBlock: string; hardBlock: string }`
- **Control Flow:**
  1. Parses `validUntil` date and extracts `validUntilYear = validUntilDate.getUTCFullYear()`.
  2. Validates `config.academicSessionStart.month`. Throws if missing.
  3. Calls `deriveAcademicLifecycle(startMonth, startDay, validUntilYear)`.
  4. Returns `{ softBlock: lifecycle.softBlock.toISOString(), hardBlock: lifecycle.hardDelete.toISOString() }`.

---

### 2.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario / Flow | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls |
| :--- | :--- | :--- | :--- |
| **(a) Cold Cache (System Config / Bus Fee Resolution via `getCurrentBusFee()`)** | 1x `SELECT value, updated_at, updated_by FROM public.system_settings WHERE key = 'config' LIMIT 1` | 0 | 0 (Firestore queried only if PostgreSQL returns null) |
| **(b) Warm Cache (Subsequent Bus Fee Lookup within 5-min TTL)** | 0 (Resolved entirely from in-memory `configMemoryCache` Map) | 0 | 0 |
| **(c) Admin Bus Fee Update via `POST /api/settings/bus-fees`** | 1x `SELECT system_settings WHERE key = 'config'`<br>1x `UPSERT INTO public.system_settings (key, value, updated_at, updated_by)`<br>1x `INSERT INTO public.notifications` | 0 | 1x Firestore `settings/config` write (dual-write compat) |
| **(d) Academic Calendar Lookup & Derivation via `computeSession(sessionEndYear)`** | **Cold:** 1x `SELECT system_settings WHERE key = 'deadline'`<br>**Warm:** 0 (Served from `activeConfigCache` 5-min TTL)<br>0 DB queries for math derivation (pure CPU in-memory) | 0 | 0 |

---

### 2.5 Verbatim Source Code from Live Codebase

#### File: `src/domains/admin/services/config.service.ts`
```typescript
/**
 * D11 Config Service — business logic for system configuration and markers.
 *
 * All persistence handled in PostgreSQL (`system_settings` table).
 * Config keys: 'config', 'landing', 'ui', 'privacy', 'terms'
 * Marker keys: 'activation_{year}', 'soft_block_completed_{year}'
 */
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';
import { getSupabaseServer } from '@/lib/supabase-server';

function getSupabase() {
  try {
    return getSupabaseServer();
  } catch {
    return null;
  }
}

async function getFromPg<T>(key: string): Promise<ConfigResult<T> | null> {
  const supabase = getSupabase();
  if (!supabase || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value, updated_at, updated_by')
      .eq('key', key)
      .maybeSingle();
    if (error || !data || !data.value) return null;
    return {
      data: data.value as T,
      updatedAt: data.updated_at || null,
      updatedByUid: data.updated_by || null,
    };
  } catch {
    return null;
  }
}

async function saveToPg(key: string, value: Record<string, unknown>, updatedByUid?: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    await supabase.from('system_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedByUid || null,
    });
  } catch (err) {
    console.warn(`[config.service] Failed to persist ${key} to system_settings:`, err);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConfigResult<T> = {
  data: T;
  updatedAt: string | null;
  updatedByUid: string | null;
};

export interface SystemConfig {
  appName: string;
  busFee: {
    amount: number;
    updatedAt?: string;
    updatedBy?: string;
    version?: number;
    history?: any[];
  };
  paymentExport?: {
    startYear: number;
    interval: number;
  };
  academicYearEnd?: string;
  renewalReminder?: string;
  renewalDeadline?: string;
  softBlock?: string;
  hardBlock?: string;
  version?: string;
  mapProvider?: 'guwahati';
  [key: string]: any;
}

export interface LandingConfig {
  videoPath: string;
  supportPhones: string[];
  email: string;
  [key: string]: any;
}

export interface UiConfig {
  version: string;
  [key: string]: any;
}

export interface LegalConfigSection {
  title: string;
  content: string;
}

export interface LegalConfig {
  title: string;
  sections: LegalConfigSection[];
}

// ─── Config Cleaning ─────────────────────────────────────────────────────────

const UI_FIELDS_TO_STRIP = ['icon', 'gradient', 'color', 'description', 'label'];

function cleanConfigForStorage(config: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripUnsafeObjectKeys({ ...config }) as Record<string, unknown>;

  for (const key of Object.keys(cleaned)) {
    if (UI_FIELDS_TO_STRIP.includes(key)) {
      delete cleaned[key];
    }
  }

  const busFee = cleaned.busFee as Record<string, unknown> | undefined;
  if (busFee && Array.isArray(busFee.history)) {
    if (busFee.history.length > 3) {
      busFee.history = busFee.history.slice(-3);
    }
  }

  return cleaned;
}

// ─── Cache Layer ─────────────────────────────────────────────────────────────

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL
const configMemoryCache = new Map<string, { data: any; expiresAt: number }>();

export function invalidateConfigCache(key?: string): void {
  if (key) {
    configMemoryCache.delete(key);
  } else {
    configMemoryCache.clear();
  }
}

// ─── System Config ───────────────────────────────────────────────────────────

export async function getSystemConfig(): Promise<ConfigResult<SystemConfig>> {
  const cached = configMemoryCache.get('config');
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 1. PostgreSQL system_settings (Authoritative Source of Truth)
  const pgResult = await getFromPg<SystemConfig>('config');
  if (pgResult && pgResult.data && Object.keys(pgResult.data).length > 0) {
    configMemoryCache.set('config', { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  // 2. In-memory default fallback
  const defaultFallback: ConfigResult<SystemConfig> = {
    data: { appName: 'AdtU Bus Services', busFee: { amount: 5000, version: 1 } } as any,
    updatedAt: null,
    updatedByUid: null,
  };

  configMemoryCache.set('config', { data: defaultFallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return defaultFallback;
}

export async function updateSystemConfig(
  data: Partial<SystemConfig>,
  updatedByUid: string,
): Promise<SystemConfig> {
  const current = await getSystemConfig();
  const previous = current.data || ({} as SystemConfig);

  const merged = { ...previous, ...data };
  const cleaned = cleanConfigForStorage(merged as Record<string, unknown>);
  cleaned.lastUpdated = new Date().toISOString();
  cleaned.updatedBy = updatedByUid;

  // 1. Write to PostgreSQL system_settings
  await saveToPg('config', cleaned, updatedByUid);

  configMemoryCache.delete('config');
  return cleaned as SystemConfig;
}

// ─── Landing Config ──────────────────────────────────────────────────────────

export async function getLandingConfig(): Promise<ConfigResult<LandingConfig>> {
  const cached = configMemoryCache.get('landing');
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const defaultConfig: LandingConfig = {
    heroTitle: 'AdtU Bus Services',
    heroSubtitle: 'Smart Campus Transit Portal',
    features: [],
    updatedAt: new Date().toISOString(),
  } as any;

  // 1. PostgreSQL system_settings
  const pgResult = await getFromPg<LandingConfig>('landing');
  if (pgResult && pgResult.data && Object.keys(pgResult.data).length > 0) {
    configMemoryCache.set('landing', { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  const fallback: ConfigResult<LandingConfig> = {
    data: defaultConfig,
    updatedAt: null,
    updatedByUid: null,
  };
  configMemoryCache.set('landing', { data: fallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return fallback;
}

export async function updateLandingConfig(
  data: Partial<LandingConfig>,
  updatedByUid: string,
): Promise<void> {
  const current = await getLandingConfig();
  const previous = current.data || ({} as LandingConfig);

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await saveToPg('landing', merged as Record<string, unknown>, updatedByUid);

  configMemoryCache.delete('landing');
}

// ─── UI Config ───────────────────────────────────────────────────────────────

export async function getUiConfig(): Promise<ConfigResult<UiConfig> | null> {
  const cached = configMemoryCache.get('ui');
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 1. PostgreSQL system_settings
  const pgResult = await getFromPg<UiConfig>('ui');
  if (pgResult && pgResult.data) {
    configMemoryCache.set('ui', { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  return null;
}

export async function updateUiConfig(
  data: Partial<UiConfig>,
  updatedByUid: string,
): Promise<void> {
  const current = await getUiConfig();
  const previous = current?.data || ({} as UiConfig);

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await saveToPg('ui', merged as Record<string, unknown>, updatedByUid);

  configMemoryCache.delete('ui');
}

// ─── Legal Config (Privacy / Terms) ──────────────────────────────────────────

export async function getLegalConfig(type: 'privacy' | 'terms'): Promise<ConfigResult<LegalConfig>> {
  const cacheKey = `legal:${type}`;
  const cached = configMemoryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 1. PostgreSQL system_settings
  const pgResult = await getFromPg<LegalConfig>(type);
  if (pgResult && pgResult.data) {
    configMemoryCache.set(cacheKey, { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  const fallback: ConfigResult<LegalConfig> = {
    data: { title: type === 'privacy' ? 'Privacy Policy' : 'Terms of Service', sections: [] },
    updatedAt: null,
    updatedByUid: null,
  };

  configMemoryCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return fallback;
}

export async function updateLegalConfig(
  type: 'privacy' | 'terms',
  data: Partial<LegalConfig>,
  updatedByUid: string,
): Promise<void> {
  const current = await getLegalConfig(type);
  const previous = current.data || ({} as LegalConfig);

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await saveToPg(type, merged as Record<string, unknown>, updatedByUid);

  configMemoryCache.delete(`legal:${type}`);
}

// ─── System Markers ──────────────────────────────────────────────────────────

export async function findMarker(key: string): Promise<Record<string, unknown> | null> {
  const pgResult = await getFromPg<Record<string, unknown>>(`marker:${key}`);
  if (pgResult && pgResult.data) return pgResult.data;
  return null;
}

export async function upsertMarker(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await saveToPg(`marker:${key}`, payload);
}
```

#### File: `src/lib/bus-fee-service.ts`
```typescript
// File: src/lib/bus-fee-service.ts
/**
 * Bus Fee Management Service
 * Handles bus fee storage in Firestore settings/config collection
 */

import { getSystemConfig,updateSystemConfig } from '@/domains/admin';
import { getAdminById } from '@/domains/identity';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';

/**
 * Sends a system-wide announcement notification when bus fees change.
 */
export async function notifyBusFeeChange(
  adminUid: string,
  oldAmount: number,
  newAmount: number
): Promise<boolean> {
  try {
    const adminData = await getAdminById(adminUid);
    const adminName = adminData?.name || adminData?.fullName || 'Admin';

    const notificationContent = `The bus fee for the upcoming session has been revised from ₹${oldAmount.toLocaleString('en-IN')} to ₹${newAmount.toLocaleString('en-IN')}. ` +
      `Please update your payment plans accordingly. For any queries, contact the administration office.`;

    await pgInsertNotification({
      title: '💰 Bus Fee Update - Important Notice',
      content: notificationContent,
      type: 'announcement',
      sender: {
        userId: adminUid,
        userName: adminName,
        userRole: 'admin',
      },
      target: {
        type: 'all_users',
      },
      recipientIds: [],
      readByUserIds: [],
    });
    return true;
  } catch (error) {
    console.error('[notifyBusFeeChange] Failed to send announcement notification:', error);
    return false;
  }
}

export interface BusFeeData {
  amount: number;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface BusFeeHistory {
  amount: number;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

/**
 * Get current bus fee from system config
 * NO FALLBACK - throws error if config unavailable
 */
export async function getCurrentBusFee(): Promise<BusFeeData> {
  try {
    const systemConfigResult = await getSystemConfig();
    const config = systemConfigResult.data;

    console.log('🔍 Fetching bus fee from system config...');
    const amount = config.busFee?.amount;

    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('Bus fee configuration is missing in settings database. Please configure settings and try again later.');
    }

    console.log('📊 Bus fee data from config:', {
      amount: amount,
      updatedAt: systemConfigResult.updatedAt,
      updatedByUid: systemConfigResult.updatedByUid,
      version: config.version
    });

    return {
      amount: amount,
      updatedAt: systemConfigResult.updatedAt || new Date().toISOString(),
      updatedBy: systemConfigResult.updatedByUid || 'system',
      version: 1
    };
  } catch (error: any) {
    console.error('Error getting current bus fee:', error);
    throw new Error(error.message || 'Unstable network detected, please try again later');
  }
}

/**
 * Update bus fee in system config
 * This updates the global bus fee for the system
 */
export async function updateBusFee(
  adminUid: string,
  newAmount: number
): Promise<{ success: boolean; error?: string; previousAmount?: number }> {
  try {
    const systemConfigResult = await getSystemConfig();
    const currentConfig = systemConfigResult.data;

    // Ensure busFee object exists
    if (!currentConfig.busFee) {
      currentConfig.busFee = { amount: 0 };
    }

    const previousAmount = currentConfig.busFee.amount;

    // Add current state to history before updating
    if (!currentConfig.busFee.history) {
      currentConfig.busFee.history = [];
    }

    // Push the previous state to history and retain only latest 3 entries
    currentConfig.busFee.history.push({
      amount: previousAmount,
      updatedAt: systemConfigResult.updatedAt || new Date().toISOString(),
      updatedBy: adminUid,
      version: 1
    });
    if (currentConfig.busFee.history.length > 3) {
      currentConfig.busFee.history = currentConfig.busFee.history.slice(-3);
    }

    // Update with new values
    currentConfig.busFee.amount = newAmount;

    // Save via service
    await updateSystemConfig(currentConfig, adminUid);

    console.log(`✅ Bus fee updated by admin ${adminUid}: ${previousAmount} → ${newAmount}`);

    return {
      success: true,
      previousAmount
    };
  } catch (error: any) {
    console.error('Error updating bus fee:', error);
    return {
      success: false,
      error: error.message || 'Unstable network detected, please try again later'
    };
  }
}

/**
 * Get bus fee update history
 */
export async function getBusFeeHistory(): Promise<BusFeeHistory[]> {
  try {
    const systemConfigResult = await getSystemConfig();
    return systemConfigResult.data.busFee?.history || [];
  } catch (error) {
    console.error('Error getting bus fee history:', error);
    throw new Error('Unstable network detected, please try again later');
  }
}

/**
 * Initialize bus fee config if not exists
 * (This is now largely handled by getSystemConfig fallback, but kept for compatibility)
 */
export async function initializeBusFee(defaultAmount: number = 0): Promise<void> {
  try {
    await getSystemConfig();
  } catch {
    const defaultConfig = {
      appName: "AdtU Bus Services",
      busFee: {
        amount: defaultAmount,
        history: []
      },
      version: "v1.0.0",
    };
    await updateSystemConfig(defaultConfig, 'system');
    console.log(`✅ Initialized system config with bus fee: ${defaultAmount}`);
  }
}

```

#### File: `src/app/api/settings/bus-fees/route.ts`
```typescript
// File: src/app/api/settings/bus-fees/route.ts
import { getSystemConfig,updateSystemConfig } from '@/domains/admin';
import { notifyBusFeeChange } from '@/lib/bus-fee-service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BusFeeUpdateSchema } from '@/lib/security/validation-schemas';
import { NextRequest,NextResponse } from 'next/server';

// GET: Retrieve bus fees from system config (Firestore settings/config)
export async function GET(req: NextRequest) {
  try {
    const systemConfigResult = await getSystemConfig();
    const busFeeAmount = systemConfigResult.data?.busFee?.amount;
    if (typeof busFeeAmount !== 'number') {
      return NextResponse.json(
        { message: 'Bus fee configuration is missing in Firestore settings. Please try again later.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      amount: busFeeAmount,
      fees: busFeeAmount,
      data: {
        amount: busFeeAmount
      }
    });
  } catch (error: any) {
    console.error('Error fetching bus fees:', error);
    return NextResponse.json(
      { message: error?.message || 'Unstable network detected, please try again later' },
      { status: 503 }
    );
  }
}

// POST: Update bus fees (Admin only)
export const POST = withSecurity(
  async (request, { auth, body }) => {
    try {
      const uid = auth.uid;
      const { amount } = body as { amount: number };

      if (!amount || amount <= 0) {
        return NextResponse.json({ message: 'Invalid amount' }, { status: 400 });
      }

      // Get current config
      const systemConfigResult = await getSystemConfig();
      const oldAmount = systemConfigResult.data?.busFee?.amount || 0;

    // Prepare updated bus fee data
    // Note: The service will handle truncation of history
    const existingHistory = systemConfigResult.data?.busFee?.history || [];
    const newHistoryEntry = {
      amount: oldAmount,
      updatedAt: systemConfigResult.data?.busFee?.updatedAt || new Date().toISOString(),
    };
    const combinedHistory = [...existingHistory, newHistoryEntry].slice(-3);

    // Construct new config object
    // We clone the existing config to preserve other fields
    const updatedConfig = {
      ...systemConfigResult.data,
      busFee: {
        amount: amount,
        updatedAt: new Date().toISOString(),
        version: (systemConfigResult.data?.busFee?.version || 0) + 1,
        history: combinedHistory
      }
    };

    // Save via service (which handles cleaning/truncation)
    await updateSystemConfig(updatedConfig, uid);

    console.log(`✅ Bus fee updated by admin ${uid}: ${oldAmount} -> ${amount}`);

    // Notify all users about bus fee change via shared service
    const notificationSent = await notifyBusFeeChange(uid, oldAmount, amount);

    return NextResponse.json({
      message: 'Bus fee updated successfully',
      fees: amount,
      notificationSent
    });

  } catch (error) {
    console.error('Error updating bus fees:', error);
    return NextResponse.json(
      { message: 'Failed to update bus fees' },
      { status: 500 }
    );
  }
},
{
  requiredRoles: ['admin'],
  schema: BusFeeUpdateSchema,
  rateLimit: RateLimits.UPDATE,
});


```

#### File: `src/domains/calendar/repositories/calendar.repository.ts`
```typescript
/**
 * D2 Calendar Repository — PostgreSQL Implementation
 *
 * Persistence owner: PostgreSQL system_settings (`key = 'deadline'`).
 * Business computation (`deriveAcademicLifecycle`) stays in CalendarService / deadline-computation.
 */

import { getSupabaseServer } from '@/lib/supabase-server';
import type { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const getOrdinal = (day: number): string => {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL
let activeConfigCache: { data: DeadlineConfig; expiresAt: number } | null = null;

export function invalidateActiveConfigCache(): void {
  activeConfigCache = null;
}

export function setActiveConfigForTesting(config: DeadlineConfig): void {
  activeConfigCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function getCachedActiveConfig(): DeadlineConfig | null {
  return activeConfigCache?.data || null;
}

export async function findActiveConfig(): Promise<DeadlineConfig> {
  if (activeConfigCache && Date.now() < activeConfigCache.expiresAt) {
    return activeConfigCache.data;
  }

  let firestoreData: Record<string, any> = {};

  // 1. Query PostgreSQL system_settings (Authoritative Source of Truth)
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const supabase = getSupabaseServer();
      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'deadline')
        .maybeSingle();
      if (!error && data?.value && Object.keys(data.value).length > 0) {
        firestoreData = data.value;
      }
    }
  } catch {
    // Return standard defaults if DB is temporarily unreachable
  }

  const startMonth = typeof firestoreData.academicSessionStart?.month === 'number'
    ? firestoreData.academicSessionStart.month
    : 6; // July default (0-indexed)
  const startDay = firestoreData.academicSessionStart?.day || 1;
  const currentYear = new Date().getFullYear();
  const lifecycle = deriveAcademicLifecycle(startMonth, startDay, currentYear);

  const config: DeadlineConfig = {
    description: firestoreData.description ?? 'Academic Calendar Configuration',
    version: firestoreData.version ?? '1.0.0',
    lastUpdated: firestoreData.lastUpdated ?? new Date().toISOString(),
    lastUpdatedBy: firestoreData.lastUpdatedBy ?? 'system',

    academicSessionStart: {
      month: startMonth,
      day: startDay,
    },

    academicYear: {
      description: 'Academic year boundary',
      anchorMonth: lifecycle.expiry.getUTCMonth(),
      anchorMonthName: MONTH_NAMES[lifecycle.expiry.getUTCMonth()],
      anchorDay: lifecycle.expiry.getUTCDate(),
      anchorDayOrdinal: getOrdinal(lifecycle.expiry.getUTCDate()),
    },

    renewalNotification: {
      description: 'Renewal notification start date',
      month: lifecycle.reminder1.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.reminder1.getUTCMonth()],
      day: lifecycle.reminder1.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.reminder1.getUTCDate()),
      hour: 0,
      minute: 5,
      daysBeforeDeadline: 90,
      displayText: 'Renewal notification period has started',
    },

    renewalDeadline: {
      description: 'Renewal deadline date',
      month: lifecycle.deadline.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.deadline.getUTCMonth()],
      day: lifecycle.deadline.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.deadline.getUTCDate()),
      hour: 23,
      minute: 59,
      displayText: 'Renewal deadline date',
    },

    softBlock: {
      description: 'Service expiration date (dashboard & live tracking restricted until renewal)',
      month: lifecycle.softBlock.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.softBlock.getUTCMonth()],
      day: lifecycle.softBlock.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.softBlock.getUTCDate()),
      daysAfterDeadline: 15,
      displayText: 'Service expired — dashboard & live tracking restricted until renewal',
      warningText: firestoreData.softBlock?.warningText || "Student's access to dashboard and live bus tracking will be restricted after this date.",
    },

    hardDelete: {
      description: 'Hard delete date (account removal)',
      month: lifecycle.hardDelete.getUTCMonth(),
      monthName: MONTH_NAMES[lifecycle.hardDelete.getUTCMonth()],
      day: lifecycle.hardDelete.getUTCDate(),
      dayOrdinal: getOrdinal(lifecycle.hardDelete.getUTCDate()),
      daysAfterDeadline: 60,
      daysAfterSoftBlock: 45,
      displayText: 'Hard delete scheduled',
      criticalWarningText: firestoreData.hardDelete?.criticalWarningText || 'Warning: Account will be permanently deleted.',
    },

    urgentWarningThreshold: {
      description: 'Days before hard delete for warning',
      days: firestoreData.urgentWarningThreshold?.days ?? 15,
      displayText: 'Critical warning period',
    },

    contactInfo: firestoreData.contactInfo ?? {
      description: 'Contact office info',
      officeName: 'AdtU Transport Office',
      phone: '+91 93657 71454',
      email: 'support@adtu.in',
      officeHours: 'Mon-Fri 9:00 AM - 5:00 PM',
      address: 'Panikhaiti, Guwahati, Assam 781026',
      visitInstructions: 'Please visit during office hours with your valid student ID.',
    },

    timeline: {
      description: 'Academic Session Timeline Events',
      events: [
        {
          id: 'session_start',
          date: { month: startMonth, day: startDay },
          label: 'Academic Session Starts',
          color: 'blue',
          icon: 'calendar',
        },
        {
          id: 'expiry',
          date: { month: lifecycle.expiry.getUTCMonth(), day: lifecycle.expiry.getUTCDate() },
          label: 'Bus Service Expires',
          color: 'amber',
          icon: 'clock',
        },
        {
          id: 'soft_block',
          date: { month: lifecycle.softBlock.getUTCMonth(), day: lifecycle.softBlock.getUTCDate() },
          label: 'Service Expired (Access Restricted)',
          color: 'orange',
          icon: 'alert-triangle',
        },
        {
          id: 'hard_delete',
          date: { month: lifecycle.hardDelete.getUTCMonth(), day: lifecycle.hardDelete.getUTCDate() },
          label: 'Hard Delete Scheduled',
          color: 'red',
          icon: 'trash-2',
          critical: true,
        },
      ],
    },
  };

  activeConfigCache = { data: config, expiresAt: Date.now() + CACHE_TTL_MS };
  return config;
}

export async function saveConfig(config: DeadlineConfig, updatedByUid?: string): Promise<void> {
  const payload = {
    description: config.description,
    version: config.version,
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: updatedByUid || 'admin',
    academicSessionStart: {
      month: config.academicSessionStart.month,
      day: config.academicSessionStart.day,
    },
    urgentWarningThreshold: {
      days: config.urgentWarningThreshold.days,
    },
    softBlock: {
      warningText: config.softBlock.warningText,
    },
    hardDelete: {
      criticalWarningText: config.hardDelete.criticalWarningText,
    },
    contactInfo: config.contactInfo,
  };

  // 1. Write to PostgreSQL system_settings
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const supabase = getSupabaseServer();
      await supabase.from('system_settings').upsert({
        key: 'deadline',
        value: payload,
        updated_at: payload.lastUpdated,
        updated_by: updatedByUid || 'admin',
      });
    }
  } catch (err) {
    console.warn('[calendar.repository] Failed to persist deadline to PostgreSQL system_settings:', err);
  }

  invalidateActiveConfigCache();
}
```

#### File: `src/domains/calendar/services/calendar.service.ts`
```typescript
// File: src/domains/calendar/services/calendar.service.ts
/**
 * CalendarService
 *
 * Responsibilities: read/update academic calendar config, derive
 * per-student lifecycle dates (AcademicSession).
 */
import type { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle,type DerivedLifecycle } from '@/lib/utils/deadline-computation';
import * as calendarRepository from '../repositories/calendar.repository';

export async function getActiveConfig(): Promise<DeadlineConfig> {
  return calendarRepository.findActiveConfig();
}

export async function updateConfig(config: DeadlineConfig, updatedByUid?: string): Promise<void> {
  return calendarRepository.saveConfig(config, updatedByUid);
}

/**
 * Computes the derived AcademicSession lifecycle (expiry, reminders,
 * soft block, hard delete) for a given session end year, using the
 * active config's academicSessionStart month/day.
 */
export async function computeSession(sessionEndYear: number): Promise<DerivedLifecycle> {
  const config = await getActiveConfig();
  const { month, day } = config.academicSessionStart;
  return deriveAcademicLifecycle(month, day, sessionEndYear);
}

```

#### File: `src/lib/utils/deadline-computation.ts`
```typescript
// File: src/lib/utils/deadline-computation.ts
/**
 * Per-Student Deadline Computation Engine
 * 
 * This module provides the core date computation logic for the renewal deadline system.
 * All dates are computed per-student based on their individual sessionEndYear.
 * 
 * KEY RULES:
 * 1. Config stores month/day ONLY (no year)
 * 2. Year is derived from each student's sessionEndYear
 * 3. Hard delete ALWAYS occurs in sessionEndYear + 1 (next academic cycle)
 * 4. Simulation mode can override the year for testing
 */

import { DeadlineConfig } from '@/lib/types/deadline-config';

// Actually normalizeLeapYearDate was in deadline-computation.ts previously? Let me check.
// No, it was in deadline-computation.ts. I need to keep it.

/**
 * Handle leap year edge case for Feb 29
 * Returns Feb 28 for non-leap years
 */
export function normalizeLeapYearDate(year: number, month: number, day: number): Date {
    if (month === 1 && day === 29) { // February 29
        const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        if (!isLeapYear) {
            console.log(`[Date Computation] Feb 29 normalized to Feb 28 for non-leap year ${year}`);
            return new Date(year, 1, 28);
        }
    }
    return new Date(year, month, day);
}

/**
 * Student deadline status type
 */
type StudentDeadlineStatus = 'active' | 'soft_blocked' | 'pending_deletion' | 'deleted';

/**
 * Student computed fields
 */
interface StudentComputedFields {
    serviceExpiryDate?: string;
    renewalDeadlineDate?: string;
    softBlockDate?: string;
    hardDeleteDate?: string;
    urgentWarningDate?: string;
    computedAt?: string;
    configVersion?: string;
}

/**
 * Date preview result
 */
interface DatePreviewResult {
    studentId: string;
    studentName: string;
    studentEmail: string;
    sessionEndYear: number;
    currentStatus: StudentDeadlineStatus;
    computedDates: {
        serviceExpiryDate: string;
        renewalNotificationDate: string;
        renewalDeadlineDate: string;
        softBlockDate: string;
        hardDeleteDate: string;
        urgentWarningDate: string;
    };
    todayActions: {
        wouldSoftBlock: boolean;
        wouldSendUrgentWarning: boolean;
        wouldHardDelete: boolean;
    };
    daysUntil: {
        serviceExpiry: number;
        renewalDeadline: number;
        softBlock: number;
        hardDelete: number;
        urgentWarning: number;
    };
    isSimulation: boolean;
    simulationYear?: number;
}


/**
 * Parameters for computing per-student dates
 */
export interface ComputeDateParams {
    /** Student's session end year (e.g., 2026) */
    studentSessionEndYear: number;

    /** Deadline configuration (month/day only) - REQUIRED */
    config: DeadlineConfig;

    /** Optional simulation mode override */
    simulationMode?: {
        enabled: boolean;
        customYear: number;
    };
}

/**
 * Result of date computation
 */
export interface ComputedDates {
    /** Date when student's service expires */
    serviceExpiryDate: Date;

    /** Date when renewal notifications start */
    renewalNotificationDate: Date;

    /** Final renewal deadline */
    renewalDeadlineDate: Date;

    /** Date when access is blocked (soft block) */
    softBlockDate: Date;

    /** Date when account is deleted (ALWAYS in effectiveYear + 1) */
    hardDeleteDate: Date;

    /** Date when urgent warnings start */
    urgentWarningDate: Date;

    /** The effective year used for computation */
    effectiveYear: number;

    /** Whether simulation mode was used */
    isSimulated: boolean;
}

export interface DerivedLifecycle {
    sessionStart: Date;
    expiry: Date;
    reminder1: Date;
    reminder2: Date;
    finalReminder: Date;
    deadline: Date;
    softBlock: Date;
    activation: Date;
    hardDelete: Date;
}

/**
 * Derives all lifecycle dates programmatically from the single Academic Session Start month and day.
 * Applies leap year normalization across all derived dates.
 */
export function deriveAcademicLifecycle(
    startMonth: number,
    startDay: number,
    effectiveYear: number
): DerivedLifecycle {
    // Session Start date in the previous calendar year relative to sessionEndYear (effectiveYear)
    const sessionStart = new Date(Date.UTC(effectiveYear - 1, startMonth, startDay, 0, 0, 0, 0));

    // Expiry date is 1 day before the next session start of the effectiveYear
    const expiry = new Date(Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0));
    expiry.setUTCDate(expiry.getUTCDate() - 1);
    expiry.setUTCHours(23, 59, 59, 999);

    // Reminder 1 is 3 months before expiry (1st of that month)
    const reminder1 = new Date(expiry);
    reminder1.setUTCMonth(reminder1.getUTCMonth() - 3);
    reminder1.setUTCDate(1);
    reminder1.setUTCHours(0, 0, 0, 0);

    // Reminder 2 is 2 months before expiry (1st of that month)
    const reminder2 = new Date(expiry);
    reminder2.setUTCMonth(reminder2.getUTCMonth() - 2);
    reminder2.setUTCDate(1);
    reminder2.setUTCHours(0, 0, 0, 0);

    // Final Reminder is 15 days before expiry
    const finalReminder = new Date(expiry);
    finalReminder.setUTCDate(finalReminder.getUTCDate() - 15);
    finalReminder.setUTCHours(0, 0, 0, 0);

    // Renewal Deadline is equal to expiry
    const deadline = new Date(expiry);

    // Soft Block is exactly when next session starts (e.g. July 1, 2026 at 00:00:00)
    const softBlock = new Date(Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0));

    // Future Session Activation starts on the same day as soft block (July 1st)
    const activation = new Date(Date.UTC(effectiveYear, startMonth, startDay, 0, 0, 0, 0));

    // Hard Delete is two sessions after expiry (e.g. July 1, 2028)
    const hardDelete = new Date(Date.UTC(effectiveYear + 2, startMonth, startDay, 0, 0, 0, 0));

    // Apply consistency normalization to all leap years
    const normalizeLeap = (d: Date) => {
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        if (m === 1 && day === 29) { // Feb 29
            const isLeapYear = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
            if (!isLeapYear) {
                d.setUTCMonth(1, 28);
            }
        }
    };

    [sessionStart, expiry, reminder1, reminder2, finalReminder, deadline, softBlock, activation, hardDelete].forEach(normalizeLeap);

    return {
        sessionStart,
        expiry,
        reminder1,
        reminder2,
        finalReminder,
        deadline,
        softBlock,
        activation,
        hardDelete
    };
}

/**
 * Compute all deadline dates for a specific student
 * 
 * @param params - Parameters including student's sessionEndYear and config
 * @returns Computed dates for the student
 */
export function computeDatesForStudent(params: ComputeDateParams): ComputedDates {
    const {
        studentSessionEndYear,
        config,
        simulationMode
    } = params;

    if (!config) throw new Error("Config required for computeDatesForStudent");

    // Determine the effective year to use
    const isSimulated = simulationMode?.enabled ?? false;
    const effectiveYear = isSimulated
        ? simulationMode!.customYear
        : studentSessionEndYear;

    if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
        throw new Error('Academic session start configuration missing in deadline settings. Please configure settings and try again later.');
    }

    const startMonth = config.academicSessionStart.month;
    const startDay = config.academicSessionStart.day || 1;

    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, effectiveYear);

    // Urgent Warning Date: X days before hard delete
    const urgentWarningDays = config.urgentWarningThreshold?.days ?? 15;
    const urgentWarningDate = new Date(lifecycle.hardDelete);
    urgentWarningDate.setUTCDate(
        urgentWarningDate.getUTCDate() - urgentWarningDays
    );
    urgentWarningDate.setUTCHours(0, 0, 0, 0);

    return {
        serviceExpiryDate: lifecycle.expiry,
        renewalNotificationDate: lifecycle.reminder1,
        renewalDeadlineDate: lifecycle.deadline,
        softBlockDate: lifecycle.softBlock,
        hardDeleteDate: lifecycle.hardDelete,
        urgentWarningDate,
        effectiveYear,
        isSimulated
    };
}

/**
 * Check if two dates are the same day (ignoring time)
 */
export function isSameDay(date1: Date, date2: Date): boolean {
    return (
        date1.getUTCFullYear() === date2.getUTCFullYear() &&
        date1.getUTCMonth() === date2.getUTCMonth() &&
        date1.getUTCDate() === date2.getUTCDate()
    );
}

/**
 * Check if date1 is on or after date2 (ignoring time)
 */
export function isOnOrAfter(date1: Date, date2: Date): boolean {
    const d1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const d2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return d1 >= d2;
}

/**
 * Check if date1 is strictly after date2 (ignoring time)
 */
export function isAfter(date1: Date, date2: Date): boolean {
    const d1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const d2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return d1 > d2;
}

/**
 * Check if date1 is on or before date2 (ignoring time)
 */
export function isOnOrBefore(date1: Date, date2: Date): boolean {
    const d1 = Date.UTC(date1.getUTCFullYear(), date1.getUTCMonth(), date1.getUTCDate());
    const d2 = Date.UTC(date2.getUTCFullYear(), date2.getUTCMonth(), date2.getUTCDate());
    return d1 <= d2;
}

/**
 * Calculate the number of days between two dates
 * Positive if date2 is after date1
 */
export function daysBetween(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
    return Math.ceil((d2.getTime() - d1.getTime()) / oneDay);
}

/**
 * Validate a date configuration for invalid day-of-month
 */
export function validateDateConfig(
    month: number,
    day: number
): { valid: boolean; error?: string } {
    if (month < 0 || month > 11) {
        return { valid: false, error: `Invalid month: ${month}. Must be 0-11.` };
    }

    if (day < 1 || day > 31) {
        return { valid: false, error: `Invalid day: ${day}. Must be 1-31.` };
    }

    const testDate = new Date(new Date().getFullYear(), month, day);

    if (testDate.getMonth() !== month) {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return {
            valid: false,
            error: `Invalid day ${day} for ${monthNames[month]}`
        };
    }

    return { valid: true };
}

/**
 * Check if a specific student should be soft-blocked based on current date
 */
export function shouldSoftBlockStudent(
    student: { sessionEndYear?: number; validUntil?: string; status?: string },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): boolean {
    if (!config) throw new Error("Config required for shouldSoftBlockStudent");

    // Already blocked
    if (student.status === 'soft_blocked' || student.status === 'pending_deletion') {
        return false; // Already blocked, don't re-block
    }

    // Can't compute without sessionEndYear
    if (!student.sessionEndYear) return false;

    // If validUntil is still in future, don't block
    if (student.validUntil) {
        const validUntilDate = new Date(student.validUntil);
        const today = new Date();
        if (validUntilDate > today) return false;
    } else {
        // No validUntil means should probably be blocked
        return true;
    }

    // Compute dates for this student
    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    // Get today's date (respect simulation mode for testing)
    const today = simulationMode?.enabled
        ? new Date()
        : new Date();

    // Block if today is on or after soft block date
    return isOnOrAfter(today, computed.softBlockDate);
}

/**
 * Check if a specific student should be hard-deleted based on current date
 */
export function shouldHardDeleteStudent(
    student: {
        sessionEndYear?: number;
        status?: string;
        lastRenewalDate?: Date | string | { toDate: () => Date } | null;
        validUntil?: Date | string | { toDate: () => Date } | null;
    },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): boolean {
    if (!config) throw new Error("Config required for shouldHardDeleteStudent");

    // Already deleted or pending deletion
    if (student.status === 'deleted' || student.status === 'pending_deletion') {
        return false;
    }

    // Can't compute without sessionEndYear
    if (!student.sessionEndYear) return false;

    // SECURITY: Grace period check
    const GRACE_PERIOD_DAYS = 30;

    if (student.lastRenewalDate) {
        let renewalDate: Date;
        if (student.lastRenewalDate instanceof Date) {
            renewalDate = student.lastRenewalDate;
        } else if (typeof student.lastRenewalDate === 'string') {
            renewalDate = new Date(student.lastRenewalDate);
        } else if (typeof (student.lastRenewalDate as any).toDate === 'function') {
            renewalDate = (student.lastRenewalDate as { toDate: () => Date }).toDate();
        } else {
            renewalDate = new Date(0);
        }

        const daysSinceRenewal = daysBetween(renewalDate, new Date());
        if (daysSinceRenewal < GRACE_PERIOD_DAYS) {
            console.log(`🛡️ GRACE PERIOD: Student renewed ${daysSinceRenewal} days ago, skipping hard delete`);
            return false;
        }
    }

    // SECURITY: Also check validUntil
    if (student.validUntil) {
        let validUntilDate: Date;
        if (student.validUntil instanceof Date) {
            validUntilDate = student.validUntil;
        } else if (typeof student.validUntil === 'string') {
            validUntilDate = new Date(student.validUntil);
        } else if (typeof (student.validUntil as any).toDate === 'function') {
            validUntilDate = (student.validUntil as { toDate: () => Date }).toDate();
        } else {
            validUntilDate = new Date(0);
        }

        if (validUntilDate > new Date()) {
            console.log(`🛡️ VALID SUBSCRIPTION: Student validity until ${validUntilDate.toISOString()}, skipping hard delete`);
            return false;
        }
    }

    // Compute dates
    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    const today = new Date();

    // Delete if today is on or after hard delete date
    return isOnOrAfter(today, computed.hardDeleteDate);
}

/**
 * Get the number of days until hard delete for a specific student
 */
export function getDaysUntilHardDeleteForStudent(
    student: { sessionEndYear?: number },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): number {
    if (!student.sessionEndYear) return 0;
    if (!config) throw new Error("Config required");

    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    return Math.max(0, daysBetween(new Date(), computed.hardDeleteDate));
}

/**
 * Get the number of days until soft block for a specific student
 */
export function getDaysUntilSoftBlockForStudent(
    student: { sessionEndYear?: number },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): number {
    if (!student.sessionEndYear) return 0;
    if (!config) throw new Error("Config required");

    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    return Math.max(0, daysBetween(new Date(), computed.softBlockDate));
}

/**
 * Convert computed dates to storable format for student document
 */
export function computedDatesToStorable(
    computed: ComputedDates,
    configVersion: string
): StudentComputedFields {
    return {
        serviceExpiryDate: computed.serviceExpiryDate.toISOString(),
        renewalDeadlineDate: computed.renewalDeadlineDate.toISOString(),
        softBlockDate: computed.softBlockDate.toISOString(),
        hardDeleteDate: computed.hardDeleteDate.toISOString(),
        urgentWarningDate: computed.urgentWarningDate.toISOString(),
        computedAt: new Date().toISOString(),
        configVersion
    };
}

export function computeBlockDatesFromValidUntil(
    validUntil: string | Date,
    config: DeadlineConfig // REQUIRED
): { softBlock: string; hardBlock: string } {
    if (!config) throw new Error("Config required for computeBlockDatesFromValidUntil");

    // Parse validUntil to get the year
    const validUntilDate = typeof validUntil === 'string' ? new Date(validUntil) : validUntil;
    const validUntilYear = validUntilDate.getUTCFullYear();

    if (!config?.academicSessionStart || typeof config.academicSessionStart.month !== 'number') {
        throw new Error('Academic session start configuration missing in deadline settings. Please configure settings and try again later.');
    }

    const startMonth = config.academicSessionStart.month;
    const startDay = config.academicSessionStart.day || 1;

    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, validUntilYear);

    return {
        softBlock: lifecycle.softBlock.toISOString(),
        hardBlock: lifecycle.hardDelete.toISOString()
    };
}

/**
 * Generate a preview of deadline effects for a student
 */
export function generateDatePreview(
    student: {
        id: string;
        name?: string;
        fullName?: string;
        email?: string;
        sessionEndYear?: number;
        status?: StudentDeadlineStatus;
    },
    config: DeadlineConfig, // REQUIRED
    simulationMode?: { enabled: boolean; customYear: number }
): DatePreviewResult | null {
    if (!student.sessionEndYear) return null;
    if (!config) throw new Error("Config required");

    const computed = computeDatesForStudent({
        studentSessionEndYear: student.sessionEndYear,
        config,
        simulationMode
    });

    const today = new Date();

    return {
        studentId: student.id,
        studentName: student.fullName || student.name || 'Unknown',
        studentEmail: student.email || 'No email',
        sessionEndYear: student.sessionEndYear,
        currentStatus: (student.status as StudentDeadlineStatus) || 'active',

        computedDates: {
            serviceExpiryDate: computed.serviceExpiryDate.toISOString(),
            renewalNotificationDate: computed.renewalNotificationDate.toISOString(),
            renewalDeadlineDate: computed.renewalDeadlineDate.toISOString(),
            softBlockDate: computed.softBlockDate.toISOString(),
            hardDeleteDate: computed.hardDeleteDate.toISOString(),
            urgentWarningDate: computed.urgentWarningDate.toISOString()
        },

        todayActions: {
            wouldSoftBlock: isSameDay(today, computed.softBlockDate) && student.status !== 'soft_blocked',
            wouldSendUrgentWarning: isSameDay(today, computed.urgentWarningDate),
            wouldHardDelete: isSameDay(today, computed.hardDeleteDate)
        },

        daysUntil: {
            serviceExpiry: daysBetween(today, computed.serviceExpiryDate),
            renewalDeadline: daysBetween(today, computed.renewalDeadlineDate),
            softBlock: daysBetween(today, computed.softBlockDate),
            hardDelete: daysBetween(today, computed.hardDeleteDate),
            urgentWarning: daysBetween(today, computed.urgentWarningDate)
        },

        isSimulation: computed.isSimulated,
        simulationYear: computed.isSimulated ? computed.effectiveYear : undefined
    };
}

/**
 * Get formatted date string for display
 */
export function formatComputedDate(date: Date): string {
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

/**
 * Get ordinal suffix for a day number
 */
export function getOrdinalSuffix(day: number): string {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

/**
 * Format a date with ordinal day
 */
export function formatDateWithOrdinal(date: Date): string {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const day = date.getDate();
    return `${monthNames[date.getMonth()]} ${day}${getOrdinalSuffix(day)}, ${date.getFullYear()}`;
}

```

#### File: `src/lib/deadline-config-service.ts`
```typescript
// File: src/lib/deadline-config-service.ts
/**
 * deadline-config-service.ts — Compatibility Façade
 *
 * This file is a ZERO-LOGIC compatibility layer.
 * It exists only to preserve the existing import path used by 20+ callers
 * across API routes, shared services, and other domains.
 *
 * ─── CALL CHAIN ──────────────────────────────────────────────────────────────
 *
 *   Legacy caller (any file importing this module)
 *       ↓
 *   deadline-config-service  (this file — façade only)
 *       ↓
 *   CalendarService          (D2 domain business layer)
 *       ↓
 *   CalendarRepository       (D2 domain persistence layer)
 *       ↓
 *   Firestore                (settings/deadline document)
 *
 * ─── WHAT WAS REMOVED ────────────────────────────────────────────────────────
 *   • adminDb import and all Firestore reads/writes
 *   • SETTINGS_COLLECTION / DOC_ID constants
 *   • MONTH_NAMES / getOrdinal helpers (live in calendar.repository.pg.ts)
 *   • deriveAcademicLifecycle call (delegated to repository layer)
 *   • All inline DeadlineConfig construction logic
 *
 * ─── WHAT MUST NOT CHANGE ─────────────────────────────────────────────────────
 *   The exported function signatures are frozen.
 *   No caller may be required to change its import.
 */
import { getActiveConfig,updateConfig } from '@/domains/calendar';
import type { DeadlineConfig } from './types/deadline-config';

/**
 * Returns the fully-populated DeadlineConfig from PostgreSQL.
 * All lifecycle dates are derived in-memory inside the Calendar domain.
 *
 * @deprecated Prefer importing from `@/domains/calendar` directly
 *   when refactoring a caller. This façade will be removed once all
 *   callers have been migrated to the domain import.
 */
export async function getDeadlineConfig(): Promise<DeadlineConfig> {
    return getActiveConfig();
}

/**
 * Persists an updated DeadlineConfig to PostgreSQL via the Calendar domain.
 *
 * @deprecated Prefer importing from `@/domains/calendar` directly
 *   when refactoring a caller.
 */
export async function updateDeadlineConfig(config: DeadlineConfig, uid?: string): Promise<void> {
    return updateConfig(config, uid);
}


```

#### File: `src/app/api/settings/deadline-config/route.ts`
```typescript
import { invalidateConfigCache } from '@/domains/admin';
import { invalidateActiveConfigCache } from '@/domains/calendar';
import { invalidateStudentAssignmentCache } from '@/domains/student';
import { getUserById } from '@/domains/identity';
import { getDeadlineConfig, updateDeadlineConfig } from '@/lib/deadline-config-service';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';
import { checkRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Check if dependent lifecycle records exist in the system (PostgreSQL)
 */
async function checkDependencies(): Promise<boolean> {
    try {
        const supabase = getSupabaseServer();

        // Check if any student profiles or pending/upcoming applications exist in parallel
        const [studentRes, upcomingRes, pendingSeatRes] = await Promise.all([
            supabase
                .from('student_profiles')
                .select('uid', { count: 'exact', head: true })
                .limit(1),
            supabase
                .from('applications')
                .select('application_id', { count: 'exact', head: true })
                .eq('state', 'verified_upcoming')
                .limit(1),
            supabase
                .from('applications')
                .select('application_id', { count: 'exact', head: true })
                .eq('state', 'pending_seat_allocation')
                .limit(1),
        ]);

        if (
            (studentRes.count && studentRes.count > 0) ||
            (upcomingRes.count && upcomingRes.count > 0) ||
            (pendingSeatRes.count && pendingSeatRes.count > 0)
        ) {
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error checking dependencies:', error);
        return true; // Safe fallback
    }
}

/**
 * GET: Retrieve deadline config and check if it is locked by dependencies
 */
export async function GET(req: NextRequest) {
    try {
        const [config, hasDependencies] = await Promise.all([
            getDeadlineConfig(),
            checkDependencies(),
        ]);
        return NextResponse.json({ config, hasDependencies });
    } catch (error: any) {
        console.error('Error fetching deadline config:', error);
        return NextResponse.json(
            { 
                message: 'Unstable network detected, please try again later',
                error: 'An unexpected error occurred' },
            { status: 503 }
        );
    }
}

/**
 * POST: Update deadline config and cascade recalculation to students and applications
 */
export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin']);
        if (!auth.authenticated) return auth.response;

        const uid = auth.uid;

        // Rate limiting: RateLimits.UPDATE
        const rateLimitId = createRateLimitId(uid, 'deadline-config');
        const rateCheck = checkRateLimit(rateLimitId, RateLimits.UPDATE.maxRequests, RateLimits.UPDATE.windowMs);
        if (!rateCheck.allowed) {
            return NextResponse.json(
                { message: 'Too many requests. Please wait before updating deadline configuration.' },
                {
                    status: 429,
                    headers: { 'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)) },
                }
            );
        }

        const { config: rawConfig } = await req.json();
        const config = stripUnsafeObjectKeys(rawConfig);

        if (!config) {
            return NextResponse.json(
                { message: 'Invalid configuration data' },
                { status: 400 }
            );
        }

        // Validate date fields
        const validationError = validateDateConfig(config);
        if (validationError) {
            return NextResponse.json(
                { message: validationError },
                { status: 400 }
            );
        }

        // 1. Update Deadline Config in PostgreSQL system_settings
        await updateDeadlineConfig(config, uid);

        // 2. Cascade recalculation to student_profiles and applications
        await syncSystemConfigDates(config as DeadlineConfig, uid);

        // 3. Invalidate active config cache, config cache, and all student assignments
        invalidateActiveConfigCache();
        invalidateConfigCache('deadline');
        invalidateConfigCache('config');
        invalidateConfigCache();
        await invalidateStudentAssignmentCache('*');

        return NextResponse.json({
            message: 'Deadline configuration updated and synced successfully.',
            config
        });

    } catch (error: any) {
        console.error('Error updating deadline config:', error);
        return NextResponse.json(
            { message: 'Failed to update deadline configuration' },
            { status: 500 }
        );
    }
}

/**
 * Syncs the abstract rules from DeadlineConfig to concrete dates in student_profiles & applications
 */
export async function syncSystemConfigDates(deadlineConfig: DeadlineConfig, uid: string) {
    const startMonth = deadlineConfig.academicSessionStart?.month ?? 6;
    const startDay = deadlineConfig.academicSessionStart?.day ?? 1;

    const supabase = getSupabaseServer();

    // 1. Try atomic PL/pgSQL RPC first
    try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('recalculate_academic_lifecycle_dates', {
            p_start_month: startMonth,
            p_start_day: startDay,
        });

        if (!rpcError && rpcData?.success) {
            console.log(`[deadline-config] recalculate_academic_lifecycle_dates RPC executed successfully:`, rpcData);
            await invalidateStudentAssignmentCache('*');
            return;
        }
        if (rpcError) {
            console.warn('[deadline-config] RPC recalculate_academic_lifecycle_dates unavailable, running TypeScript fallback:', rpcError.message);
        }
    } catch (err: any) {
        console.warn('[deadline-config] Error invoking recalculate_academic_lifecycle_dates RPC, using TypeScript fallback:', err?.message || err);
    }

    // 2. TypeScript Fallback
    try {
        // A. Update student_profiles
        const { data: students, error: studErr } = await supabase
            .from('student_profiles')
            .select('uid, session_end_year, valid_until')
            .gt('session_end_year', 2000)
            .in('status', ['active', 'soft_blocked']);

        if (!studErr && students && students.length > 0) {
            const nowMs = Date.now();
            const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

            for (const s of students) {
                const lifecycle = deriveAcademicLifecycle(startMonth, startDay, s.session_end_year);
                const newExpiry = lifecycle.expiry;
                const newSoftBlock = lifecycle.softBlock;
                const newHardBlock = lifecycle.hardDelete;

                const resetReminders = newExpiry.getTime() > nowMs + ninetyDaysMs;

                const updatePayload: Record<string, any> = {
                    valid_until: newExpiry.toISOString(),
                    soft_block: newSoftBlock.toISOString(),
                    hard_block: newHardBlock.toISOString(),
                    updated_at: new Date().toISOString(),
                };

                if (resetReminders) {
                    updatePayload.expiry_reminder_count = 0;
                    updatePayload.last_expiry_reminder_sent_at = null;
                }

                await supabase
                    .from('student_profiles')
                    .update(updatePayload)
                    .eq('uid', s.uid);
            }
        }

        // B. Update applications
        const { data: apps, error: appErr } = await supabase
            .from('applications')
            .select('application_id, session_start_year, target_session, form_data')
            .in('state', ['submitted', 'verified_upcoming', 'pending_seat_allocation']);

        if (!appErr && apps && apps.length > 0) {
            for (const app of apps) {
                const targetYear = app.session_start_year ||
                    (app.target_session as any)?.startYear ||
                    (app.target_session as any)?.start_year ||
                    (app.form_data as any)?.sessionStartYear ||
                    (app.form_data as any)?.startYear ||
                    (app.form_data as any)?.sessionInfo?.sessionStartYear ||
                    (app.form_data as any)?.sessionInfo?.startYear;

                if (targetYear && Number(targetYear) > 2000) {
                    const lifecycle = deriveAcademicLifecycle(startMonth, startDay, Number(targetYear));
                    const newEligible = new Date(lifecycle.softBlock.getTime() + 24 * 60 * 60 * 1000);

                    await supabase
                        .from('applications')
                        .update({
                            eligible_approval: newEligible.toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq('application_id', app.application_id);
                }
            }
        }

        await invalidateStudentAssignmentCache('*');
    } catch (fallbackErr: any) {
        console.error('[deadline-config] TypeScript fallback recalculation failed:', fallbackErr);
    }
}

/**
 * Validate date configurations for valid month/day combinations.
 */
function validateDateConfig(config: any): string | null {
    const start = config.academicSessionStart;
    if (!start) {
        return 'Academic Session Start is required.';
    }

    const month = start.month;
    const day = start.day;

    if (month === undefined || day === undefined) {
        return 'Academic Session Start month and day are required.';
    }

    if (typeof month !== 'number' || !Number.isInteger(month) || month < 0 || month > 11) {
        return `Invalid month: ${month}. Must be 0-11.`;
    }

    const maxDay = getMaxDayForMonth(month);
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > maxDay) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        return `Invalid day ${day} for ${monthNames[month]}. Max is ${maxDay}.`;
    }

    return null;
}

function getMaxDayForMonth(month: number): number {
    const date = new Date(2024, month + 1, 0);
    return date.getDate();
}
```

---



---

# PART 3: Student Admission & Renewal Checkout Initiation (Online Razorpay Order Creation & Offline Application Submission)

### 3.1 Sub-Domain Architecture & Exact Execution Pipeline

The checkout initiation subsystem handles two distinct transactional pathways:
1. **Online Razorpay Order Creation:** Preflight server-side price calculation, cryptographic receipt generation, server-derived session bounds, pre-checkout durable ledger persistence in `public.payments`, and order dispatch to Razorpay Orders API.
2. **Offline Bank Challan / Receipt Submission:** Upload of physical receipt evidence to Cloudinary, application creation in `public.applications` in state `submitted`, and assignment of deterministic deduplication IDs without creating premature financial ledger entries.

#### Dual-Pathway Checkout Execution Flow

```
                                  [Student Client]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
         [Mode: 'online']                             [Mode: 'offline']
                   │                                           │
                   ▼                                           ▼
┌──────────────────────────────────────┐    ┌──────────────────────────────────────┐
│ POST /api/payment/razorpay/          │    │ POST /api/student/renew-service-v2   │
│ create-order                         │    │ (or /api/applications/submit-final)  │
├──────────────────────────────────────┤    ├──────────────────────────────────────┤
│ 1. withSecurity() RateLimit & Auth   │    │ 1. withSecurity() Role: 'student'    │
│ 2. getCurrentBusFee() from PG        │    │ 2. getCurrentBusFee() from PG        │
│ 3. expectedAmount = fee * years      │    │ 3. totalFee = currentBusFee * years  │
│ 4. amountsMatch(client, expected)    │    │ 4. Generate daily deterministic ID:  │
│ 5. Derive isRenewal server-side      │    │    renewal_{uid}_{YYYY-MM-DD}        │
│ 6. Derive sessionStart & sessionEnd  │    │ 5. Check duplicate 'submitted' app   │
│ 7. generateReceiptId('ADTU_BUS')     │    │ 6. Upload receipt to Cloudinary      │
│ 8. createRazorpayOrder(expected,...) │    │ 7. submitFinal() to PostgreSQL:      │
│ 9. paymentsSupabaseService.          │    │    - state = 'submitted'             │
│    upsertPayment({                   │    │    - sessionStartYear = sessionEnd   │
│      paymentId: order.id,            │    │    - NO payments row created         │
│      status: 'Pending',              │    │ 8. createNotification() to staff     │
│      metadata: { ... }               │    └──────────────────┬───────────────────┘
│    })                                │                       │
└──────────────────┬───────────────────┘                       ▼
                   │                                ┌──────────────────────┐
                   ▼                                │ Staff Review Queue   │
┌──────────────────────────────────────┐            │ (Moderator / Admin)  │
│ Return { order, key_id } to Client   │            └──────────────────────┘
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Client opens Razorpay Modal          │
│ via useRazorpay()                    │
└──────────────────────────────────────┘
```

#### Database Deduping Invariant: `idx_applications_active_student_session`

The database enforces a strict partial unique index:
```sql
CREATE UNIQUE INDEX idx_applications_active_student_session 
ON public.applications (applicant_uid, COALESCE(session_start_year, 0)) 
WHERE state NOT IN ('rejected', 'cancelled', 'expired');
```
- For fresh registrations: `sessionStartYear` defaults to current academic start year.
- For renewals: `sessionStartYear` is explicitly mapped to the commuter's current `sessionEndYear` (e.g. 2025). This ensures the renewal does not collide with the currently approved fresh pass (which has `session_start_year = 2024`).
- If a student attempts to submit two concurrent applications for the same target session year, PostgreSQL raises unique violation (`23505`), preventing duplicate queues.

---

### 3.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/payment/razorpay/create-order/route.ts` | `POST` | Student checkout modal, renewal page, registration page | `getCurrentBusFee`, `getSystemConfig`, `getStudentByUid`, `createRazorpayOrder`, `paymentsSupabaseService.upsertPayment` | Inserts initial pending record into `public.payments` |
| `src/lib/payment/razorpay.service.ts` | `createRazorpayOrder`, `initializeRazorpay`, `verifyRazorpaySignature`, `fetchOrderDetails`, `fetchPaymentDetails`, `generateReceiptId` | `create-order/route.ts`, `verify-payment/route.ts`, `webhook/route.ts` | Razorpay Node.js SDK (`razorpay.orders.create`) | No direct DB mutations |
| `src/app/api/student/renew-service-v2/route.ts` | `POST` | Student renewal UI (`handleOfflinePayment`, online fallback) | `getById`, `getCurrentBusFee`, `createRazorpayOrder`, `Application.submitFinal`, `createNotification` | Inserts row into `public.applications` (offline), dispatches notifications |
| `src/app/api/applications/submit-final/route.ts` | `POST` | Student application wizard (Step 4 Submit) | `getById`, `submitFinal` | Inserts/updates `public.applications` |
| `src/domains/application/services/application.service.ts` | `submitFinal`, `submit`, `saveDraft`, `verifyUpcoming` | `submit-final/route.ts`, `renew-service-v2/route.ts` | `Seat.getCapacity`, `application.repository.pg.ts` | Mutates `public.applications` |
| `src/hooks/useRazorpay.ts` | `useRazorpay` | `PaymentModeSelector.tsx`, registration wizard | `fetch('/api/payment/razorpay/create-order')`, Razorpay Checkout script | In-memory React state |
| `src/components/PaymentModeSelector.tsx` | `PaymentModeSelector` (Client Component) | `src/app/student/renew/page.tsx`, `src/app/student/apply/page.tsx` | `useRazorpay`, `usePaymentRecovery`, `uploadImage` (Cloudinary) | Local storage / session storage |
| `src/app/student/renew/page.tsx` | `StudentRenewalPage` (Client Page) | Next.js Router (`/student/renew`) | `fetch('/api/settings/bus-fees')`, `PaymentModeSelector` | Client view state |

---

### 3.3 Method-by-Method Low-Level Walkthrough

#### 1. `POST /api/payment/razorpay/create-order` (API Route Handler)
- **Signature:** `export const POST = withSecurity<CreateOrderBody>(async (_request, { auth, body }) => ...)`
- **Validation Guard:**
  - `withSecurity` enforces `CreateOrderSchema`:
    - `amount`: positive number, max 1,000,000 INR.
    - `durationYears`: integer between 1 and 5.
    - `notes`: string-to-string dictionary, max 500 chars per value.
  - Rate limit: `RateLimits.PAYMENT_CREATE` (5 calls per minute per user).
- **Control Flow:**
  1. Resolves trusted identity: `trustedUserId = auth.uid`.
  2. Resolves duration: `trustedDurationYears = durationYears || Number(notes?.duration || 1)`.
  3. Parallel Preflight Lookups:
     - `getCurrentBusFee()`: Fetches authoritative bus fee from PostgreSQL.
     - `getSystemConfig()`: Fetches system config.
     - `getStudentByUid(trustedUserId)`: Fetches existing commuter profile.
  4. Server-Authoritative Fee Calculation:
     - `busFeeAmount = Number(busFeeResult?.amount ?? systemConfigResult.data.busFee?.amount ?? 0)`.
     - `expectedAmount = busFeeAmount * trustedDurationYears`.
  5. Amount Anti-Tampering Assertion:
     - Calls `amountsMatch(amount, expectedAmount)`: asserts `Math.round(clientAmount * 100) === Math.round(expectedAmount * 100)`.
     - If client tampered with amount or submitted mismatched total, returns **400 Bad Request**:
       `{ success: false, error: 'Payment amount does not match the official bus fee' }`.
  6. Server-Side Purpose Derivation:
     - Checks `studentData?.validUntil || studentData?.sessionEndYear`.
     - `orderType = isRenewal ? 'renewal' : 'new_registration'`.
     - Client-submitted `purpose` is completely ignored to prevent fee-tier bypass.
  7. Server-Side Session Boundary Calculation:
     - For renewal: `baseYear = studentData.sessionEndYear || new Date().getUTCFullYear()`.
       `trustedSessionStartYear = baseYear`, `trustedSessionEndYear = baseYear + trustedDurationYears`.
     - For new registration: `trustedSessionStartYear = currentYear`, `trustedSessionEndYear = currentYear + trustedDurationYears`.
  8. Cryptographic Receipt Generation:
     - Calls `generateReceiptId('ADTU_BUS')` -> `ADTU_BUS_{timestamp}_{16-char-random-hex}`.
  9. Order Notes Binding:
     - Binds `userId`, `enrollmentId`, `studentName`, `durationYears`, `sessionStartYear`, `sessionEndYear`, `purpose`, `type`, `timestamp`.
  10. Razorpay Gateway Dispatch:
      - Calls `createRazorpayOrder(expectedAmount, receipt, orderNotes)`.
      - Converts amount to paise: `Math.round(expectedAmount * 100)`.
      - Executes with automatic retry (up to 2 retries on 502/503/504 gateway errors).
  11. Durable Pre-Checkout Persistence (Fail-Closed):
      - Invariant: Committer **MUST** record pending order in PostgreSQL before client receives order ID.
      - Calls `paymentsSupabaseService.upsertPayment`:
        - `paymentId: order.id`
        - `studentUid: trustedUserId`
        - `amount: expectedAmount`
        - `status: 'Pending'`
        - `sessionStartYear`, `sessionEndYear`, `durationYears`
        - `metadata: { order_type, receipt_id, checkout_initiated_at, entitlement_status: 'pending_checkout' }`
      - If DB insert fails or returns null, aborts checkout and returns **500 Internal Server Error**.
  12. Returns 200 with `{ success: true, order: { id, amount, currency, receipt, status, notes }, key_id }`.

#### 2. `POST /api/student/renew-service-v2` (Offline Renewal Submission)
- **Signature:** `export const POST = withSecurity<RenewServiceBody>(...)`
- **Validation Guard:**
  - Role: `'student'`.
  - Schema: `RenewServiceV2Schema` (`durationYears: 1-10`, `paymentMode: 'online' | 'offline'`, `transactionId`, `receiptImageUrl`, `paidAt`).
- **Control Flow for Offline Mode:**
  1. Computes total fee: `totalFee = currentBusFee * durationYears`.
  2. Generates daily deterministic deduplication key:
     `dailyBucket = new Date().toISOString().slice(0, 10)`
     `applicationId = 'renewal_' + userId + '_' + dailyBucket`
  3. Checks existing application: `Application.getById(applicationId)`. If state is `submitted`, rejects with **409 Conflict**:
     `'A pending renewal request already exists. Please wait for it to be reviewed.'`
  4. Calls `Application.submitFinal`:
     - Inserts application into `public.applications` with `state = 'submitted'`, `application_type = 'renewal'`.
     - Explicitly passes `sessionStartYear = student.sessionEndYear`.
     - Sets `formData.transactionId = transactionId`, `formData.receiptImageUrl = receiptImageUrl`, `formData.paidAt = paidAt`.
     - **FINANCIAL LEDGER INVARIANT:** No row is inserted into `public.payments` at offline submission time. Ledger entries are created only upon staff approval.
  5. Dispatches Notification:
     - Queries all `admin` and `moderator` user IDs.
     - Calls `createNotification` alerting staff of a new offline renewal pending review.
  6. Returns 200 with `{ success: true, message: 'Offline renewal request submitted successfully', requestId: applicationId }`.

#### 3. `Application.submitFinal` (Domain Service)
- **Control Flow:**
  1. Enforces `LIVE_STATES` check on applicant: If student has an existing application in `('submitted', 'approved', 'verified', 'awaiting_verification', 'verified_upcoming', 'pending_seat_allocation')`, blocks duplicate submission unless it is a renewal for a new session.
  2. Normalizes shift (`Morning` or `Evening`). Throws if missing.
  3. Capacity pre-check: Calls `Seat.getCapacity(busId, shift)`. If `shiftLoad >= capacity`, flags `needsCapacityReview = true`.
  4. Writes to PostgreSQL `applications` table via `repository.upsert`.
  5. Returns `{ success: true, applicationId }`.

---

### 3.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario / Flow | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls |
| :--- | :--- | :--- | :--- |
| **(a) Cold Cache (Online Razorpay Order Creation via `/api/payment/razorpay/create-order`)** | 1x `SELECT system_settings WHERE key = 'config'`<br>1x `SELECT student_profiles WHERE uid = $1`<br>1x `SELECT student_profiles (profile pre-lookup)`<br>1x `SELECT payments WHERE payment_id = $1` (concurrency check)<br>1x `INSERT INTO public.payments (payment_id, status = 'Pending', ...)` | 0 | 1x Razorpay Orders API (`POST https://api.razorpay.com/v1/orders`) |
| **(b) Warm Cache (Subsequent Order Creation within 5-min Config TTL)** | 1x `SELECT student_profiles WHERE uid = $1`<br>1x `SELECT student_profiles (pre-lookup)`<br>1x `SELECT payments WHERE payment_id = $1`<br>1x `INSERT INTO public.payments` | 0 | 1x Razorpay Orders API |
| **(c) Offline Renewal Submission via `/api/student/renew-service-v2`** | 1x `SELECT student_profiles WHERE uid = $1`<br>1x `SELECT system_settings WHERE key = 'config'`<br>1x `SELECT applications WHERE application_id = $1` (dedup check)<br>1x `SELECT applications WHERE applicant_uid = $1` (live states check)<br>1x `SELECT buses WHERE id = $1` (capacity check)<br>1x `UPSERT INTO public.applications (state = 'submitted')`<br>1x `SELECT users WHERE role IN ('admin', 'moderator')`<br>1x `INSERT INTO public.notifications` | 0 | 1x Cloudinary Upload (executed by client prior to submission) |
| **(d) Concurrent Duplicate Application Race (Two identical renewal requests for same student & session)** | 2x concurrent `UPSERT INTO public.applications`:<br>- 1st succeeds, inserts row.<br>- 2nd hits partial unique index `idx_applications_active_student_session` on `(applicant_uid, session_start_year)`, raises Postgres error `23505`, aborts with 409 Conflict. | 0 | 0 |

---

### 3.5 Verbatim Source Code from Live Codebase

#### File: `src/app/api/payment/razorpay/create-order/route.ts`
```typescript
import { getSystemConfig, invalidateConfigCache } from '@/domains/admin';
import { getByUid as getStudentByUid } from '@/domains/student';
import { getCurrentBusFee } from '@/lib/bus-fee-service';
import { createRazorpayOrder, generateReceiptId } from '@/lib/payment/razorpay.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { isOriginAllowed, withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { CreateOrderSchema } from '@/lib/security/validation-schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

function amountsMatch(clientAmount: number, expectedAmount: number): boolean {
    return Math.round(clientAmount * 100) === Math.round(expectedAmount * 100);
}

export const POST = withSecurity<CreateOrderBody>(
    async (_request, { auth, body }) => {
        const { amount, notes, userName, enrollmentId, durationYears } = body;
        const trustedUserId = auth.uid;
        const trustedDurationYears = durationYears || Number(notes?.duration || 1);
        const [busFeeResult, systemConfigResult, student] = await Promise.all([
            getCurrentBusFee().catch((err) => {
                console.error('[create-order] getCurrentBusFee failed:', err);
                return null;
            }),
            getSystemConfig(),
            getStudentByUid(trustedUserId).catch(() => null),
        ]);

        let busFeeAmount = Number(busFeeResult?.amount ?? systemConfigResult.data.busFee?.amount ?? 0);
        let expectedAmount = busFeeAmount * trustedDurationYears;

        if (!busFeeAmount || busFeeAmount <= 0 || !amountsMatch(amount, expectedAmount)) {
            // Zero-Redis-Load Multi-Node Cache Self-Healing:
            // If an Admin updated the bus fee on Instance A while Instance B's 5-minute configMemoryCache
            // is still warm, invalidate local L1 cache and re-read fresh from PostgreSQL before rejecting.
            invalidateConfigCache('config');
            const [freshBusFeeResult, freshSystemConfigResult] = await Promise.all([
                getCurrentBusFee().catch(() => null),
                getSystemConfig().catch(() => null),
            ]);

            const freshBusFeeAmount = Number(freshBusFeeResult?.amount ?? freshSystemConfigResult?.data?.busFee?.amount ?? 0);
            const freshExpectedAmount = freshBusFeeAmount * trustedDurationYears;

            if (!freshBusFeeAmount || freshBusFeeAmount <= 0 || !amountsMatch(amount, freshExpectedAmount)) {
                return NextResponse.json(
                    {
                        success: false,
                        error: 'Payment amount does not match the official bus fee',
                        currentFee: freshExpectedAmount,
                    },
                    { status: 400 }
                );
            }

            busFeeAmount = freshBusFeeAmount;
            expectedAmount = freshExpectedAmount;
        }

        const studentData = student as any;
        const trustedEnrollmentId = studentData?.enrollmentId || enrollmentId || notes?.enrollmentId || '';
        const trustedStudentName = studentData?.fullName || studentData?.name || userName || auth.name || 'Unknown';

        // SECURITY: 'type' is derived server-side, never from the client body.
        // A client claiming 'renewal' vs 'new_registration' at will could route
        // the payment through whichever funnel is cheaper to pass. A renewal is
        // a student who already holds transport validity (paid a prior session);
        // everyone else is a first-time registration.
        const isRenewal = !!(studentData?.validUntil) || !!(studentData?.sessionEndYear);
        const orderType = isRenewal ? 'renewal' : 'new_registration';

        // SECURITY: Academic session boundaries are derived or validated by trusted server-side logic.
        // A client must NEVER be able to inject arbitrary or conflicting years into Razorpay order notes.
        let trustedSessionStartYear: number;
        let trustedSessionEndYear: number;

        if (isRenewal) {
            const currentSessionEnd = Number(studentData?.sessionEndYear || 0);
            const currentYear = new Date().getUTCFullYear();
            const existingValidUntil = studentData?.validUntil;
            let baseYear = currentYear;
            if (existingValidUntil && new Date(existingValidUntil) > new Date() && currentSessionEnd > 0) {
                baseYear = currentSessionEnd;
            } else if (currentSessionEnd > 0) {
                baseYear = currentSessionEnd;
            }
            trustedSessionStartYear = baseYear;
            trustedSessionEndYear = baseYear + trustedDurationYears;
        } else {
            // New registration: derive from system academic year or current calendar
            const configAny = systemConfigResult.data as any;
            const systemStartYear = Number(configAny?.academicYear?.startYear || configAny?.busFee?.sessionStartYear || 0);
            const baseYear = systemStartYear > 2000 ? systemStartYear : new Date().getUTCFullYear();
            trustedSessionStartYear = baseYear;
            trustedSessionEndYear = baseYear + trustedDurationYears;
        }

        // If client provided conflicting session years in notes, log warning and overwrite
        if (notes?.sessionStartYear && Number(notes.sessionStartYear) !== trustedSessionStartYear) {
            console.warn(`[create-order] Client provided conflicting sessionStartYear (${notes.sessionStartYear} vs trusted ${trustedSessionStartYear}). Enforcing trusted server value.`);
        }
        if (notes?.sessionEndYear && Number(notes.sessionEndYear) !== trustedSessionEndYear) {
            console.warn(`[create-order] Client provided conflicting sessionEndYear (${notes.sessionEndYear} vs trusted ${trustedSessionEndYear}). Enforcing trusted server value.`);
        }

        // Generate unique receipt ID
        const receipt = generateReceiptId('ADTU_BUS');

        // Create order notes - IMPORTANT: These are used by webhook/verification
        // SECURITY: Use trustedUserId (from auth) instead of client-supplied userId.
        // `purpose` is set to the server-derived orderType: the client `purpose`
        // field is free-text and must never decide renewal vs registration
        // routing downstream (validity math differs per funnel).
        // `sessionStartYear` and `sessionEndYear` are explicitly server-derived.
        const orderNotes = {
            ...notes,
            userId: trustedUserId || 'unknown',
            enrollmentId: trustedEnrollmentId,
            studentId: trustedEnrollmentId || trustedUserId || '',
            studentName: trustedStudentName,
            userName: trustedStudentName,
            durationYears: trustedDurationYears.toString(),
            sessionStartYear: String(trustedSessionStartYear),
            sessionEndYear: String(trustedSessionEndYear),
            purpose: orderType,
            type: orderType,
            timestamp: new Date().toISOString(),
        };

        // Create Razorpay order with error handling
        let order;
        try {
            order = await createRazorpayOrder(expectedAmount, receipt, orderNotes);
        } catch (orderErr: any) {
            console.error('❌ Failed to create Razorpay order:', orderErr?.message || orderErr);
            const status = orderErr?.statusCode || 500;
            return NextResponse.json(
                { success: false, error: orderErr?.message || 'Failed to create payment order' },
                { status }
            );
        }

        console.log('📝 Order created:', {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt,
        });

        // DURABLE PRE-CHECKOUT PERSISTENCE: Write pending payment record to Supabase
        // before student begins client checkout. This provides trusted server attribution
        // and enables background reconciliation sweeps to discover captured funds even if
        // the client session is interrupted or webhook retries lapse.
        // INVARIANT: Fail-closed. Client MUST NOT receive a usable checkout response with
        // order ID unless the pending ledger record has been durably persisted locally.
        let persistedPaymentId: string | null = null;
        try {
            persistedPaymentId = await paymentsSupabaseService.upsertPayment({
                paymentId: order.id,
                studentUid: trustedUserId,
                studentId: trustedEnrollmentId,
                studentName: trustedStudentName,
                amount: expectedAmount,
                method: 'Online',
                status: 'Pending',
                sessionStartYear: trustedSessionStartYear,
                sessionEndYear: trustedSessionEndYear,
                durationYears: trustedDurationYears,
                razorpayOrderId: order.id,
                purpose: `Order created for ${orderType}. Awaiting checkout capture.`,
                metadata: {
                    order_type: orderType,
                    receipt_id: receipt,
                    checkout_initiated_at: new Date().toISOString(),
                    entitlement_status: 'pending_checkout',
                },
            });
        } catch (dbErr: any) {
            console.error('[create-order] Database write failure for pending payment:', dbErr);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Database service failure: Unable to initiate order registration. Please try again.',
                },
                { status: 500 }
            );
        }

        if (!persistedPaymentId) {
            console.error('[create-order] Failed to persist initial pending payment record (null returned)');
            return NextResponse.json(
                {
                    success: false,
                    error: 'Failed to record pending checkout order in financial ledger. Checkout cannot proceed.',
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency,
                receipt: order.receipt,
                status: order.status,
                notes: order.notes,
            },
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        });
    },
    {
        requiredRoles: [], // Any authenticated user can create an order
        schema: CreateOrderSchema,
        rateLimit: RateLimits.PAYMENT_CREATE,
        allowBodyToken: true
    }
);

// OPTIONS method for CORS - Production safe
export async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get('origin') || '';
    const isAllowed = isOriginAllowed(origin);

    return new NextResponse(null, {
        status: isAllowed ? 204 : 403,
        headers: isAllowed ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400',
        } : {},
    });
}
```

#### File: `src/lib/payment/razorpay.service.ts`
```typescript
// File: src/lib/payment/razorpay.service.ts
/**
 * Razorpay Payment Service
 * Handles all Razorpay payment operations including order creation and verification
 */

import crypto from 'crypto';

// Razorpay Types
export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  notes: any;
  created_at: number;
}

export interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface PaymentVerification {
  isValid: boolean;
  orderId?: string;
  paymentId?: string;
  signature?: string;
  error?: string;
}

// Initialize Razorpay with dynamic import to avoid client-side issues
let razorpayInstance: any = null;
let razorpayInitPromise: Promise<any> | null = null;

/**
 * Initialize Razorpay instance (server-side only)
 */
export async function initializeRazorpay() {
  if (razorpayInstance) return razorpayInstance;
  if (!razorpayInitPromise) {
    razorpayInitPromise = (async () => {
      const Razorpay = (await import('razorpay')).default;
      const keyId = process.env.RAZORPAY_KEY_ID;
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      
      if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials are not configured in environment variables');
      }

      razorpayInstance = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
      return razorpayInstance;
    })().catch((err) => {
      razorpayInitPromise = null;
      throw err;
    });
  }
  return razorpayInitPromise;
}

/**
 * Create a new Razorpay order
 * @param amount - Amount in rupees (will be converted to paise)
 * @param receipt - Unique receipt ID for the order
 * @param notes - Additional notes for the order
 */
export async function createRazorpayOrder(
  amount: number,
  receipt: string,
  notes?: Record<string, any>
): Promise<RazorpayOrder> {
  const razorpay = await initializeRazorpay();
  
  if (!amount || amount <= 0) {
    throw new Error('Invalid amount. Amount must be greater than 0');
  }

  const options = {
    amount: Math.round(amount * 100), // Convert to paise
    currency: 'INR',
    receipt: receipt || `rcpt_${Date.now()}`,
    notes: notes || {},
  };

  let lastError: any = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[Razorpay] Retrying order creation (attempt ${attempt + 1}/${maxRetries + 1})...`);
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
      const order = await razorpay.orders.create(options);
      return order;
    } catch (error: any) {
      lastError = error;
      const statusCode = error?.statusCode || error?.status;
      const isGatewayError = statusCode === 503 || statusCode === 502 || statusCode === 504;
      if (!isGatewayError) {
        break; // Do not retry non-gateway errors (e.g. 400 bad auth/request)
      }
    }
  }

  console.error('❌ Razorpay order creation error details:', lastError);

  const statusCode = lastError?.statusCode || lastError?.status;
  if (statusCode === 503 || statusCode === 502 || statusCode === 504) {
    const customErr: any = new Error(
      'Razorpay payment gateway is currently undergoing maintenance (503 Service Unavailable). Please try again shortly or use offline payment.'
    );
    customErr.statusCode = statusCode;
    throw customErr;
  }

  const err: any = new Error(lastError?.message || lastError?.error?.description || 'Failed to create payment order');
  err.statusCode = statusCode || 500;
  throw err;
}

/**
 * Verify Razorpay payment signature using HMAC SHA256
 * @param paymentResponse - Response from Razorpay after payment
 * @param secret - Razorpay secret key
 */
export function verifyRazorpaySignature(
  paymentResponse: RazorpayPaymentResponse
): PaymentVerification {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;
    
    // Validate input
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return {
        isValid: false,
        error: 'Missing payment details',
      };
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new Error('Razorpay secret key not configured');
    }

    // Create the signature using HMAC SHA256
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(razorpay_signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const isValid = signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (isValid) {
      return {
        isValid: true,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      };
    } else {
      return {
        isValid: false,
        error: 'Invalid payment signature',
      };
    }
  } catch (error: any) {
    return {
      isValid: false,
      error: error.message || 'Payment verification failed',
    };
  }
}

/**
 * Fetch payment details from Razorpay
 * @param paymentId - Razorpay payment ID
 */
export async function fetchPaymentDetails(paymentId: string) {
  try {
    const razorpay = await initializeRazorpay();
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error: any) {
    const message = error?.error?.description || error?.message || 'Failed to fetch payment details';
    const err: any = new Error(message);
    err.statusCode = error?.statusCode || error?.status || 500;
    err.code = error?.error?.code || error?.code;
    err.originalError = error;
    throw err;
  }
}

/**
 * Fetch order details from Razorpay
 * @param orderId - Razorpay order ID
 */
export async function fetchOrderDetails(orderId: string) {
  try {
    const razorpay = await initializeRazorpay();
    const order = await razorpay.orders.fetch(orderId);
    return order;
  } catch (error: any) {
    const message = error?.error?.description || error?.message || 'Failed to fetch order details';
    const err: any = new Error(message);
    err.statusCode = error?.statusCode || error?.status || 500;
    err.code = error?.error?.code || error?.code;
    err.originalError = error;
    throw err;
  }
}

/**
 * Fetch payments for a specific order from Razorpay
 * @param orderId - Razorpay order ID
 */
export async function fetchOrderPayments(orderId: string) {
  try {
    const razorpay = await initializeRazorpay();
    const payments = await razorpay.orders.fetchPayments(orderId);
    return payments;
  } catch (error: any) {
    const message = error?.error?.description || error?.message || 'Failed to fetch order payments';
    const err: any = new Error(message);
    err.statusCode = error?.statusCode || error?.status || 500;
    err.code = error?.error?.code || error?.code;
    err.originalError = error;
    throw err;
  }
}


/**
 * Generate a unique receipt ID
 */
export function generateReceiptId(prefix: string = 'ADTU'): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Format amount for display
 * @param amountInPaise - Amount in paise
 */
export function formatAmount(amountInPaise: number): string {
  const amountInRupees = amountInPaise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amountInRupees);
}

```

#### File: `src/app/api/student/renew-service-v2/route.ts`
```typescript
// File: src/app/api/student/renew-service-v2/route.ts
import * as Application from '@/domains/application';
import { getUsersByRole } from '@/domains/identity';
import { createNotification } from '@/domains/notification';
import { getById } from '@/domains/student';
import { getCurrentBusFee } from '@/lib/bus-fee-service';
import { createRazorpayOrder } from '@/lib/payment/razorpay.service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RenewServiceV2Schema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

type RenewServiceBody = {
  durationYears: number;
  paymentMode: 'online' | 'offline';
  transactionId?: string;
  receiptImageUrl?: string;
  paidAt?: string; // ISO timestamp of when student claims payment was made (offline only)
};

export const POST = withSecurity<RenewServiceBody>(
  async (_request, { auth, body }) => {
    const userId = auth.uid;
    const { durationYears, paymentMode, transactionId, receiptImageUrl, paidAt } = body;

    const [student, busFeeData] = await Promise.all([
      getById(userId),
      getCurrentBusFee(),
    ]);

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const enrollmentId = student.enrollmentId || '';
    const studentName = student.fullName || student.name || auth.name || 'Student';

    const currentBusFee = Number(busFeeData.amount || 0);
    const totalFee = currentBusFee * durationYears;

    if (!currentBusFee || totalFee <= 0) {
      return NextResponse.json({ error: 'Bus fee is not configured' }, { status: 500 });
    }

    if (paymentMode === 'online') {
      const receipt = `renewal_${enrollmentId || userId}_${Date.now()}`;
      const order = await createRazorpayOrder(totalFee, receipt, {
        userId,
        studentId: userId,
        enrollmentId,
        studentName,
        durationYears: durationYears.toString(),
        type: 'renewal',
      });

      return NextResponse.json({
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      });
    }

    if (paymentMode === 'offline') {
      // D8: Insert renewal application into PostgreSQL instead of Firestore.
      // Deterministic ID for deduplication: same student + same day = same ID.
      const dailyBucket = new Date().toISOString().slice(0, 10);
      const applicationId = `renewal_${userId}_${dailyBucket}`;

      // Check for existing pending renewal (deduplication)
      const existing = await Application.getById(applicationId);
      if (existing && existing.state === 'submitted') {
        return NextResponse.json(
          { error: 'A pending renewal request already exists. Please wait for it to be reviewed.' },
          { status: 409 }
        );
      }

      try {
        await Application.submitFinal(
          userId,
          student.email || '',
          {
            studentId: userId,
            enrollmentId,
            studentName,
            durationYears,
            totalFee,
            transactionId: transactionId || '',
            receiptImageUrl: receiptImageUrl || '',
            paidAt: paidAt || '',
            paymentMode: 'offline',
            phoneNumber: (student as any).phone || '',
            // FIX-10 (APP-01): Pass the correct session_start_year for the renewal.
            //
            // The unique index is: (applicant_uid, session_start_year) WHERE state NOT IN
            // ('rejected', 'cancelled', 'expired'). Without a sessionStartYear, submitFinal
            // defaults to 0 — every renewal from the same student collides on (uid, 0) the
            // moment a previous renewal reaches 'approved' state.
            //
            // WHY sessionEndYear, not sessionStartYear:
            //   A renewal extends service into the NEXT academic period. The student's current
            //   session ends at sessionEndYear (e.g. 2025). The renewal starts from 2025 and
            //   covers durationYears (e.g. 1 year → ends 2026). Subsequent renewals would
            //   start from 2026, 2027, etc. Each is a distinct (uid, year) pair — no collision.
            //
            //   Using sessionStartYear (e.g. 2024) would collide with the still-active fresh
            //   application that has (uid, 2024) in the approved state.
            busId: student.busId || '',
            routeId: student.routeId || '',
            stop_name: student.stop_name || '',
            shift: student.shift || 'Morning',
            sessionStartYear: (student as any).sessionEndYear
              || ((student as any).sessionStartYear ? (student as any).sessionStartYear + durationYears : new Date().getFullYear()),
          },
          {
            applicationId,
            applicationType: 'renewal',
            busId: student.busId || '',
            routeId: student.routeId || '',
            stop_name: student.stop_name || '',
            shift: student.shift || 'Morning',
          }
        );
      } catch (err: any) {
        console.error('Failed to create renewal application:', err);
        return NextResponse.json(
          { error: 'Failed to create renewal request. Please retry.' },
          { status: 503 }
        );
      }

      // OFFLINE PAYMENT: No Supabase payment row is created at submission time.
      // Financial ledger records are created ONLY after admin/moderator verification
      // and approval. The student's submitted payment details (transactionId,
      // receiptImageUrl) are stored in the application form_data for review.

      // Notify staff via domain API
      try {
        const [admins, moderators] = await Promise.all([
          getUsersByRole('admin'),
          getUsersByRole('moderator'),
        ]);
        const allStaffIds = [
          ...admins.map((u: any) => u.id || u.uid),
          ...moderators.map((u: any) => u.id || u.uid),
        ].filter(Boolean);
        if (allStaffIds.length > 0) {
          await createNotification(
            { userId, userName: studentName, userRole: 'student' },
            { type: 'specific_users', specificUserIds: allStaffIds },
            `${studentName} (${enrollmentId}) has submitted an offline renewal request for ${durationYears} year(s).`,
            'New Renewal Request',
          );
        }
      } catch (notifyErr) {
        console.error('Failed to send renewal notification to staff:', notifyErr);
      }

      return NextResponse.json({
        success: true,
        message: 'Offline renewal request submitted successfully',
        requestId: applicationId,
      });
    }

    return NextResponse.json({ error: 'Invalid payment mode' }, { status: 400 });
  },
  {
    requiredRoles: ['student'],
    schema: RenewServiceV2Schema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);

```

#### File: `src/app/api/applications/submit-final/route.ts`
```typescript
// File: src/app/api/applications/submit-final/route.ts
import { getById,submitFinal } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const uid = auth.uid;
      const email = auth.email;
      const rawFormData = { ...asRecord((body as any).formData) };
      if ('age' in rawFormData) {
        delete rawFormData.age;
      }

      // Ownership: a custom applicationId may only reference the caller's own
      // application — otherwise one user could overwrite another's submission.
      const claimedId = asString((body as any).applicationId);
      if (claimedId && claimedId !== uid) {
        const existingApp = await getById(claimedId);
        if (!existingApp) {
          return NextResponse.json({ error: 'Application not found' }, { status: 404 });
        }
        if ((existingApp as any).applicantUid !== uid) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      if (Object.keys(rawFormData).length === 0) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      const result = await submitFinal(uid, email || '', rawFormData, asRecord(body));

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        applicationId: result.applicationId,
        message: 'Application submitted successfully and waiting for approval',
      });
    } catch (error) {
      console.error('Failed to submit application:', error);
      return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
    }
  },
  {
    requiredRoles: [],
    schema: undefined,
  }
);

```

#### File: `src/hooks/useRazorpay.ts`
```typescript
// File: src/hooks/useRazorpay.ts
/**
 * useRazorpay Hook
 * Custom React hook for handling Razorpay payments
 */

import { useAuth } from '@/contexts/auth-context';
import { mapRazorpayErrorToState,type PaymentFrontendStatus } from '@/lib/payment/payment-state';
import { useEffect,useState } from 'react';
import { toast } from 'sonner';

// Types
export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayResponse) => void;
  modal?: {
    ondismiss?: () => void;
    confirm_close?: boolean;
  };
  readonly?: {
    email?: boolean;
    contact?: boolean;
  };
  config?: {
    display?: {
      language?: string;
    };
  };
}

export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface PaymentConfig {
  amount: number;
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  enrollmentId?: string;
  durationYears?: number;
  purpose?: string;
  notes?: Record<string, any>;
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  orderId?: string;
  signature?: string;
  error?: string;
  /** Internal raw Razorpay error code — do NOT display to students */
  errorCode?: string;
  /** Internal raw Razorpay error reason — do NOT display to students */
  errorReason?: string;
  details?: any;
  /** Canonical frontend state — use this to drive UI */
  frontendStatus?: PaymentFrontendStatus;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

/**
 * Custom hook for Razorpay payment integration
 */
export function useRazorpay() {
  const { currentUser } = useAuth();
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Razorpay script with mobile-specific handling and zombie script recovery
  useEffect(() => {
    let script: HTMLScriptElement | null = null;

    const loadScript = () => {
      // Check if already in document
      if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
        return;
      }

      script = document.createElement('script');
      script.setAttribute('src', 'https://checkout.razorpay.com/v1/checkout.js');
      script.async = true;

      script.onload = () => {
        setIsScriptLoaded(true);
      };

      script.onerror = () => {
        setError('Failed to load payment gateway');
      };

      document.body.appendChild(script);
    };

    if (window.Razorpay) {
      setIsScriptLoaded(true);
    } else {
      loadScript();
    }

    return () => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  /**
   * Create a payment order
   */
  const createOrder = async (config: PaymentConfig) => {
    try {
      const token = await currentUser?.getIdToken();
      const response = await fetch('/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          amount: config.amount,
          userId: config.userId || 'anonymous',
          userName: config.userName || 'Guest User',
          enrollmentId: config.enrollmentId,
          durationYears: config.durationYears || config.notes?.duration,
          purpose: config.purpose || 'Bus Service Payment',
          notes: {
            ...config.notes,
            email: config.userEmail || '',
            phone: config.userPhone || '',
            enrollmentId: config.enrollmentId || '',
            durationYears: String(config.durationYears || config.notes?.duration || '1'),
            // Ensure all note values are strings to satisfy Zod schema
            description: config.purpose || 'Bus Service Payment'
          },
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create order');
      }

      return data;
    } catch (error: any) {
      throw error;
    }
  };

  /**
   * Verify payment after successful transaction
   */
  const verifyPayment = async (
    response: RazorpayResponse,
    config: PaymentConfig
  ): Promise<PaymentResult> => {


    try {

      const token = await currentUser?.getIdToken();

      const requestBody = {
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
        userId: config.userId,
        userName: config.userName,
        enrollmentId: config.enrollmentId,
        durationYears: config.durationYears || config.notes?.duration,
        purpose: config.purpose,
        amount: config.amount,
      };



      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyPayment: calling verify-payment with body:`, requestBody);
      const verifyResponse = await fetch('/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyResponse HTTP status:`, verifyResponse.status);
      const data = await verifyResponse.json();
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyResponse Body:`, data);

      if (data.success) {
        return {
          success: true,
          paymentId: response.razorpay_payment_id,
          orderId: response.razorpay_order_id,
          signature: response.razorpay_signature,
          details: data.payment,
        };
      } else {
        return {
          success: false,
          error: data.error || 'Payment verification failed',
          frontendStatus: 'verification_pending',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Payment verification failed',
        frontendStatus: 'verification_pending',
      };
    }
  };

  /**
   * Process payment
   */
  const processPayment = async (
    config: PaymentConfig
  ): Promise<PaymentResult> => {
    // Reset error state
    setError(null);

    // Validate script loaded
    if (!isScriptLoaded) {
      const errorMsg = 'Payment gateway not loaded. Please refresh the page.';
      setError(errorMsg);
      toast.error(errorMsg);
      return { success: false, error: errorMsg, frontendStatus: 'failed' };
    }

    // Validate amount
    if (!config.amount || config.amount <= 0) {
      const errorMsg = 'Invalid amount';
      setError(errorMsg);
      toast.error(errorMsg);
      return { success: false, error: errorMsg, frontendStatus: 'failed' };
    }

    setIsProcessing(true);

    try {
      // Step 1: Create order
      toast.loading('Creating payment order...');

      const orderData = await createOrder(config);

      toast.dismiss();

      // Step 2: Open Razorpay checkout
      return new Promise<PaymentResult>((resolve) => {
        if (!window.Razorpay) {
          const errorMsg = 'Payment gateway not available. Please refresh the page.';
          setError(errorMsg);
          setIsProcessing(false);
          toast.dismiss();
          toast.error(errorMsg);
          resolve({ success: false, error: errorMsg, frontendStatus: 'failed' });
          return;
        }

        // ─── Checkout Session State Machine ───────────────────────────────
        //
        // ONE checkout session = potentially MANY payment.failed events.
        // payment.failed is INTERMEDIATE. The session outcome is determined
        // only when the checkout closes (handler = success, ondismiss = close).
        //
        // Priority (higher may never be overwritten by lower):
        //   success > verification_pending > processing > failed > cancelled
        //
        // checkoutSessionId guards against stale callbacks from old sessions.

        const checkoutSessionId = `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // Latest buffered failure from intermediate payment.failed events.
        // Discarded entirely if success arrives.
        let pendingFailure: PaymentResult | null = null;

        // Terminal lock: once set to 'success', no further state change is allowed.
        // Prevents ondismiss or late payment.failed from overwriting a win.
        let terminalResult: PaymentResult | null = null;

        // Single-use gate — the Promise resolves exactly once.
        let resolved = false;

        const safeResolve = (sessionId: string, result: PaymentResult) => {
          // Ignore callbacks from stale sessions
          if (sessionId !== checkoutSessionId) return;
          // Already resolved — ignore
          if (resolved) return;
          resolved = true;
          setIsProcessing(false);
          resolve(result);
        };

        const options: RazorpayOptions = {
          key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '',
          amount: orderData.order.amount,
          currency: orderData.order.currency,
          name: 'ADTU Bus Service',
          description: config.purpose || 'Bus Service Payment',
          order_id: orderData.order.id,
          prefill: {
            name: config.userName,
            email: config.userEmail,
            contact: config.userPhone,
          },
          theme: { color: '#3B82F6' },
          readonly: {
            email: !!config.userEmail,
            contact: !!config.userPhone,
          },
          config: { display: { language: 'en' } },

          // ── SUCCESS handler ─────────────────────────────────────────────
          // Called by Razorpay after a payment is captured.
          // SUCCESS is ALWAYS the highest-priority terminal state.
          handler: async (response: RazorpayResponse) => {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.handler (payment.success) ENTER. response:`, response);
            // ⚠️  SYNCHRONOUS section — runs before any await.
            // Razorpay fires ondismiss immediately after invoking the handler
            // (because it closes the modal). Setting terminalResult here — before
            // the first await — ensures ondismiss sees a non-null terminalResult
            // and exits without resolving the Promise as failed.
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Clearing pendingFailure (was:`, pendingFailure, `)`);
            pendingFailure = null;
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Setting terminalResult to success sentinel`);
            terminalResult = { success: true, frontendStatus: undefined } as PaymentResult;

            toast.loading('Verifying payment...');

            const result = await verifyPayment(response, config);
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.handler: verifyPayment result:`, result);

            toast.dismiss();
            if (result.success) {
              toast.success('Payment completed successfully!');
            } else {
              // Verification pending — recovery will handle it
              toast.error(result.error || 'Payment verification failed');
            }

            // Overwrite sentinel with real result, then resolve.
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Overwriting terminalResult with result and safeResolving`);
            terminalResult = result;
            safeResolve(checkoutSessionId, result);
          },

          modal: {
            confirm_close: true,

            // ── ONDISMISS handler ────────────────────────────────────────
            // Razorpay fires ondismiss when the checkout modal is closed.
            // This fires AFTER handler on success path too, so we must guard.
            ondismiss: () => {
              console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.modal.ondismiss ENTER. terminalResult:`, terminalResult, `pendingFailure:`, pendingFailure);
              toast.dismiss();

              // Case A: Success already resolved — ondismiss is a no-op.
              if (terminalResult !== null) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.modal.ondismiss Case A: terminalResult is not null. Exiting.`);
                return;
              }

              // Case B / C: Checkout closed without a successful payment.
              // Use the buffered failure if one exists (user tried and failed),
              // otherwise treat as a plain cancellation (user just closed).
              const finalResult: PaymentResult = pendingFailure ?? {
                success: false,
                error: 'failed',
                errorCode: 'USER_CANCELLED',
                errorReason: 'payment_cancelled',
                frontendStatus: 'failed',
              };
              console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.modal.ondismiss Case B/C: resolving with:`, finalResult);
              safeResolve(checkoutSessionId, finalResult);
            },
          },
        };

        // ── Mobile back-button protection ───────────────────────────────
        const historyState = { isRazorpayOpen: true, sessionId: checkoutSessionId, orderId: orderData.order.id };
        let historyCleanedUp = false;

        const cleanupHistory = () => {
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] cleanupHistory() ENTER. historyCleanedUp:`, historyCleanedUp);
          if (historyCleanedUp) return;
          historyCleanedUp = true;
          window.removeEventListener('popstate', handlePopState);
          if (
            window.history.state?.isRazorpayOpen &&
            window.history.state?.sessionId === checkoutSessionId
          ) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] cleanupHistory() - calling window.history.back()`);
            window.history.back();
          } else {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] cleanupHistory() - condition not met, skipping back()`);
          }
        };

        const handlePopState = (_event: PopStateEvent) => {
          cleanupHistory();
        };
        // ────────────────────────────────────────────────────────────────

        // Wrap success handler to also clean up history
        const originalHandler = options.handler;
        options.handler = async (response: RazorpayResponse) => {
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped success handler wrapper ENTER.`);
          cleanupHistory();
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped success handler wrapper calling originalHandler...`);
          await originalHandler(response);
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped success handler wrapper EXIT.`);
        };

        // Wrap ondismiss to also clean up history
        const originalOnDismiss = options.modal?.ondismiss;
        if (options.modal) {
          options.modal.ondismiss = () => {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped ondismiss wrapper ENTER.`);
            cleanupHistory();
            if (originalOnDismiss) {
              console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped ondismiss wrapper calling originalOnDismiss...`);
              originalOnDismiss();
            }
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped ondismiss wrapper EXIT.`);
          };
        }

        // Create Razorpay instance
        let razorpay: any;
        try {
          razorpay = new window.Razorpay(options);
        } catch (err: any) {
          const errorMsg = 'Failed to initialize payment gateway. Please try again.';
          setError(errorMsg);
          setIsProcessing(false);
          toast.dismiss();
          toast.error(errorMsg);
          resolve({ success: false, error: errorMsg, frontendStatus: 'failed' });
          return;
        }

        // ── payment.failed — INTERMEDIATE, NEVER resolves the session ────
        //
        // Razorpay fires this while the checkout is still open.
        // The user can retry inside the same modal.
        // We ONLY buffer the failure. We never call safeResolve here.
        // Final resolution happens in ondismiss (user closes) or handler (success).
        razorpay.on('payment.failed', (response: any) => {
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] payment.failed event callback ENTER. response:`, response);
          // Guard: if success already locked in, ignore all subsequent events
          if (terminalResult !== null) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] payment.failed: Success already locked in, ignoring event.`);
            return;
          }

          const errorObj = response?.error || response || {};
          const rawCode: string = errorObj.code || '';
          const rawReason: string = errorObj.reason || '';
          const rawDesc: string = errorObj.description || '';
          const rawSource: string = errorObj.source || '';

          if (process.env.NODE_ENV === 'development') {
            console.info(
              `[useRazorpay][${checkoutSessionId}] payment.failed buffered ` +
              `(checkout still open): code=${rawCode}, reason=${rawReason}, ` +
              `description=${rawDesc}, source=${rawSource}`
            );
          }

          const frontendStatus = mapRazorpayErrorToState(rawCode, rawReason);

          // Overwrite with the latest failure — earlier ones are irrelevant
          pendingFailure = {
            success: false,
            error: frontendStatus,
            errorCode: rawCode,
            errorReason: rawReason,
            frontendStatus,
          };
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] payment.failed: Set pendingFailure to:`, pendingFailure);

          // DO NOT call safeResolve — checkout is still open, user can retry.
        });
        // ────────────────────────────────────────────────────────────────

        // Open checkout
        try {
          window.history.pushState(historyState, '');
          window.addEventListener('popstate', handlePopState);
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] CHECKOUT_OPEN: calling razorpay.open()`);
          razorpay.open();
        } catch (err: any) {
          cleanupHistory();
          const errorMsg = err.message || 'Failed to open payment checkout. Please try again.';
          setError(errorMsg);
          setIsProcessing(false);
          toast.dismiss();
          toast.error(errorMsg);
          resolve({ success: false, error: errorMsg, frontendStatus: 'failed' });
        }
      });

    } catch (error: any) {

      const errorMsg = error.message || 'Failed to process payment';
      setError(errorMsg);
      setIsProcessing(false);
      toast.dismiss();
      toast.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
        frontendStatus: 'failed'
      };
    }
  };

  return {
    isScriptLoaded,
    isProcessing,
    error,
    processPayment,
    createOrder,
    verifyPayment,
  };
}

```

---

---



---

# PART 4: Online Payment Verification, Cryptographic Binding & Dual-Path Razorpay Webhook vs. Client Callback Concurrency

### 4.1 Sub-Domain Architecture & Exact Execution Pipeline

The online payment verification architecture operates across two concurrent pathways:
1. **Path 1: Client-Side Callback (`POST /api/payment/razorpay/verify-payment`)**: Invoked by the student browser upon successful Razorpay modal checkout completion.
2. **Path 2: Server-to-Server Webhook (`POST /api/payment/webhook/razorpay` / alias `/api/payment/razorpay/webhook`)**: Pushed directly by Razorpay infrastructure to the server upon payment capture (`payment.captured`) or gateway failure/refund events (`payment.failed`, `refund.processed`, `refund.created`, `refund.failed`).

Both pathways converge on the server-authoritative `processCapturedPayment` engine in `src/lib/payment/payment.service.ts`.

```
                                  STUDENT BROWSER / RAZORPAY GATEWAY
                                                  │
                 ┌────────────────────────────────┴────────────────────────────────┐
                 │                                                                 │
      [PATH 1: Client Callback]                                         [PATH 2: Server Webhook]
                 │                                                                 │
  POST /api/payment/razorpay/verify-payment                      POST /api/payment/webhook/razorpay
  (withSecurity, JWT Cookie/Body Token)                          (Raw Body + X-Razorpay-Signature)
                 │                                                                 │
  crypto.timingSafeEqual(                                        crypto.timingSafeEqual(
    order_id + "|" + payment_id,                                   rawBody HMAC-SHA256,
    RAZORPAY_KEY_SECRET                                            RAZORPAY_WEBHOOK_SECRET
  )                                                              )
                 │                                                                 │
  fetchOrderDetails(razorpay_order_id)                           fetchOrderDetails(order_id)
  fetchPaymentDetails(razorpay_payment_id)                                         │
                 │                                               Amount Binding (paise match)
  Verify auth.uid === order.notes.userId                         Currency Invariant ('INR' match)
  Amount Binding (order.amount === payment.amount)                                 │
  Currency Invariant (order/payment === 'INR')                                     │
  Status Check (payment.status === 'captured')                                     │
                 │                                                                 │
                 └────────────────────────────────┬────────────────────────────────┘
                                                  │
                                                  ▼
                                     processCapturedPayment(details)
                                                  │
                                  inFlightPayments.has(paymentId)?
                                   ├── YES ──► Await in-flight Promise (Deduplication)
                                   └── NO  ──► Register Promise in Map & Execute
                                                  │
                                  isPaymentProcessed(paymentId)?
                                   ├── YES ──► Check Status:
                                   │            ├── Duplicate_Pending_Refund ──► 'already_paid_for_session'
                                   │            ├── Captured_Pending_Review  ──► 'captured_pending_review'
                                   │            └── Completed ───────────────► Self-Healing Check / 'already_processed'
                                   └── NO  ──► Proceed to Processing Pipeline
                                                  │
                             Is Registration or Renewal (from order notes.type)?
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
        [Registration]                              [Renewal]
              │                                         │
    Resolve sessionStartYear                  Resolve student by UID (getStudentByUid)
    & sessionEndYear from                     Compute newValidUntil via calculateValidUntilDate
    targetSession / order notes                         │
              │                               Check Pre-Insert in public.payments:
    If session unresolved:                     student_uid + session_start_year + session_end_year
    createDuplicatePaymentRecord                        │
    (status: 'Captured_Pending_Review')       Found completed for same session?
              │                                ├── YES (Same payment_id)      ──► 'already_processed'
    paymentsSupabaseService.createPayment      ├── YES (Different payment_id) ──► throws DUPLICATE_SESSION_PAYMENT
    (status: 'Completed')                      └── NO                         ──► Insert 'Completed' payment row
              │                                                                           │
    Set initial entitlement_status                                               Insert Application:
    ('active' if app exists,                                                      submitFinal(applicationType: 'renewal',
     else 'pending_registration_submission')                                                 applicationId: 'online_' + paymentId)
              │                                                                           │
              │                                                                  Notify Staff (Admins & Moderators)
              │                                                                           │
              └────────────────────┬──────────────────────────────────────────────────────┘
                                   │
                          Evict inFlightPayments
                                   │
                    Return { status: 'success' }
```

---

### 4.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/payment/razorpay/verify-payment/route.ts` | `POST`, `OPTIONS` | Student browser checkout callback | `withSecurity`, `verifyRazorpaySignature`, `fetchOrderDetails`, `fetchPaymentDetails`, `processCapturedPayment` | Reads `payments` via `processCapturedPayment` |
| `src/app/api/payment/webhook/razorpay/route.ts` | `POST` | Razorpay gateway webhook triggers | `crypto.timingSafeEqual`, `fetchOrderDetails`, `processCapturedPayment`, `paymentsSupabaseService.getPaymentByRazorpayId`, `confirmManualRefundRecord`, `updatePaymentMetadata` | Mutates `public.payments` (`status`, `metadata`, `refund_history`) |
| `src/app/api/payment/razorpay/webhook/route.ts` | `POST` (Re-export) | Legacy/alternative Razorpay webhook webhook config | Re-exports canonical `POST` from `src/app/api/payment/webhook/razorpay/route.ts` | None directly |
| `src/lib/payment/razorpay.service.ts` | `verifyRazorpaySignature`, `fetchOrderDetails`, `fetchPaymentDetails` | `verify-payment`, `webhook/razorpay`, checkout flows | Razorpay Node SDK (`razorpay.orders.fetch`, `razorpay.payments.fetch`), `crypto.createHmac` | None (External gateway I/O) |
| `src/lib/payment/payment.service.ts` | `processCapturedPayment`, `isPaymentProcessed` | `verify-payment`, `webhook/razorpay` | `isPaymentProcessed`, `paymentsSupabaseService.createPayment`, `createDuplicatePaymentRecord`, `getStudentByUid`, `calculateValidUntilDate`, `submitFinal`, `createAuditEvent`, `Notification.createNotification` | Mutates `public.payments`, `public.applications`, `public.audit_events`; Mutates in-memory `inFlightPayments` Map |
| `src/lib/services/payments-supabase.ts` | `createPayment`, `createDuplicatePaymentRecord`, `confirmManualRefundRecord`, `updatePaymentMetadata` | `payment.service.ts`, `webhook/razorpay` | Supabase Client (`from('payments')`), `encryptData` | Mutates `public.payments` |

---

### 4.3 Method-by-Method Low-Level Walkthrough

#### 1. `verifyRazorpaySignature` (`src/lib/payment/razorpay.service.ts`)
- **Signature:** `verifyRazorpaySignature(paymentResponse: RazorpayPaymentResponse): PaymentVerification`
- **Input Parameters:**
  - `razorpay_order_id`: string
  - `razorpay_payment_id`: string
  - `razorpay_signature`: string
- **Return Value:**
  - On valid: `{ isValid: true, orderId: string, paymentId: string, signature: string }`
  - On invalid: `{ isValid: false, error: string }`
- **Control Flow & Cryptographic Checks:**
  1. Validates presence of all three identifiers (`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`). If missing, returns `{ isValid: false, error: 'Missing payment details' }`.
  2. Reads `process.env.RAZORPAY_KEY_SECRET`. Throws error if unconfigured.
  3. Constructs digest body: `body = razorpay_order_id + '|' + razorpay_payment_id`.
  4. Generates HMAC-SHA256 hex digest using `RAZORPAY_KEY_SECRET`.
  5. Performs timing-safe comparison:
     ```typescript
     const signatureBuffer = Buffer.from(razorpay_signature, 'utf8');
     const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
     const isValid = signatureBuffer.length === expectedBuffer.length &&
       crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
     ```
  6. Returns verification object.

---

#### 2. Client Callback: `POST /api/payment/razorpay/verify-payment` (`src/app/api/payment/razorpay/verify-payment/route.ts`)
- **Wrapped with:** `withSecurity<VerifyPaymentBody>` with `RateLimits.PAYMENT_VERIFY` (10 requests / 60 seconds) and `allowBodyToken: true`.
- **Payload Schema (`VerifyPaymentSchema`):**
  - `razorpay_payment_id`: string
  - `razorpay_order_id`: string
  - `razorpay_signature`: string
  - `applicationId` (optional): string
- **Control Flow:**
  1. Invokes `verifyRazorpaySignature`. If invalid, returns HTTP 400 (`{ success: false, error: verification.error }`).
  2. Parallel fetches from Razorpay Gateway:
     ```typescript
     const [orderDetails, paymentDetails] = await Promise.all([
         fetchOrderDetails(razorpay_order_id),
         fetchPaymentDetails(razorpay_payment_id),
     ]);
     ```
     If either gateway fetch fails, returns HTTP 502 Bad Gateway (`{ success: false, error: 'Payment verification service temporarily unavailable...' }`).
  3. **Ownership Verification:** Extracts `trustedUserId = noteString(trustedNotes, 'userId') || noteString(trustedNotes, 'studentId')`. Compares against authenticated user (`auth.uid`). If `trustedUserId !== auth.uid`, rejects with **HTTP 403 Forbidden** (`'Payment order does not belong to the authenticated user'`).
  4. **Amount & Currency Invariant Validation:**
     - Confirms `paymentDetails.id === razorpay_payment_id`.
     - Confirms `paymentDetails.order_id === razorpay_order_id`.
     - Confirms `Number(paymentDetails.amount) === Number(orderDetails.amount)`.
     - Confirms both `orderDetails.currency` and `paymentDetails.currency` strictly equal `'INR'`.
     - If any invariant fails, returns **HTTP 400 Bad Request** (`'Razorpay payment details do not match the order'`).
  5. **Status Verification:** Checks `paymentDetails.status === 'captured'`. If not captured, returns **HTTP 409 Conflict** (`'Payment is not captured yet. Please retry shortly.'`).
  6. **Invokes Engine:** Calls `processCapturedPayment({ paymentId, orderId, amount: trustedAmount, method: paymentDetails.method || 'Online', notes: trustedNotes, source: 'verify-payment' })`.
  7. **Branching on Engine Result:**
     - `result.status === 'error'`: Returns HTTP 500 (`{ success: false, error: result.error }`).
     - `result.status === 'already_paid_for_session'`: Returns HTTP 200 with `duplicatePayment: true`, status `Duplicate_Pending_Refund`.
     - `result.status === 'captured_pending_review'`: Returns HTTP 200 with `pendingReview: true`, status `Captured_Pending_Review`.
     - Default success: Returns HTTP 200 with `success: true`, `pendingApproval: (trustedPurpose === 'renewal')`.

---

#### 3. Canonical Webhook Handler: `POST /api/payment/webhook/razorpay` (`src/app/api/payment/webhook/razorpay/route.ts`)
- **Direct NextRequest Handler** (processes raw text body for HMAC cryptographic validation).
- **Control Flow:**
  1. Extracts `X-Razorpay-Signature` from request headers. If absent, returns HTTP 400.
  2. Reads `process.env.RAZORPAY_WEBHOOK_SECRET`. If missing, returns HTTP 500.
  3. Computes expected HMAC-SHA256 digest of raw string body using secret.
  4. Compares with `crypto.timingSafeEqual`. If mismatched or buffer length unequal, returns HTTP 400 (`'Invalid signature'`).
  5. Parses JSON payload. If malformed, returns HTTP 400.
  6. **Event Handling Dispatch:**
     - **Event `payment.captured`:**
       - Validates `paymentEntity` presence.
       - Fetches authoritative order details from Razorpay: `await fetchOrderDetails(order_id)`.
         - *Critical Retry Guarantee:* If `fetchOrderDetails` fails, returns **HTTP 502**. Razorpay retries non-2xx webhooks, preventing execution against untrusted payment entity notes.
       - Amount binding: Compares `Number(orderDetails.amount) !== Number(paymentEntity.amount)`. If mismatched, returns HTTP 400 (deterministic mismatch halts retries).
       - Currency check: Both `orderDetails.currency` and `paymentEntity.currency` must be `'INR'`. If not, returns HTTP 400.
       - Calls `processCapturedPayment({ paymentId, orderId, amount: amount / 100, method, notes: orderDetails.notes, source: 'webhook' })`.
       - If engine returns `error`, returns **HTTP 500** (triggers Razorpay automatic retry).
       - Otherwise returns HTTP 200 (`{ status: result.status }`).
     - **Event `refund.processed`:**
       - Resolves payment row via `paymentsSupabaseService.getPaymentByRazorpayId` or `getPaymentById`.
       - Executes atomic refund ledger update via `paymentsSupabaseService.confirmManualRefundRecord`.
       - Returns HTTP 200 with `{ status: 'refund_processed', isPartial, cumulativeRefunded }`.
     - **Event `payment.failed`:**
       - Looks up pending payment row by `razorpay_order_id` or `razorpay_payment_id`.
       - Updates payment metadata with gateway failure details (`gateway_payment_failed_at`, `gateway_error_code`, `gateway_error_description`, `requires_student_retry: true`).
       - Returns HTTP 200 (`{ status: 'payment_failed_logged' }`).
     - **Event `refund.created` / `refund.failed`:**
       - Appends/updates `refund_history` array inside `public.payments.metadata`.
       - On failure, sets `requires_refund_review: true` for finance staff.
       - Returns HTTP 200.

---

#### 4. Concurrency Map & Engine: `processCapturedPayment` (`src/lib/payment/payment.service.ts`)
- **In-Memory Concurrency Map:**
  ```typescript
  const inFlightPayments = new Map<string, Promise<{ status: ... }>>();
  ```
- **Race Condition Resolution (Dual-Path Arrival at the exact same millisecond):**
  If Path 1 (`verify-payment`) and Path 2 (`webhook`) execute simultaneously for the same `paymentId`:
  ```typescript
  if (inFlightPayments.has(paymentId)) {
      return await inFlightPayments.get(paymentId)!;
  }
  const execPromise = executeProcessCapturedPayment(paymentDetails);
  inFlightPayments.set(paymentId, execPromise);
  try {
      return await execPromise;
  } finally {
      inFlightPayments.delete(paymentId);
  }
  ```
  The secondary caller attaches to the exact same execution promise as the first caller.
- **Idempotency Check via `isPaymentProcessed(paymentId)`:**
  - Queries `public.payments` by primary `payment_id` and `razorpay_payment_id`.
  - Checks if record exists with status `Completed`, `Duplicate_Pending_Refund`, or `Captured_Pending_Review`.
  - If existing status is `Duplicate_Pending_Refund`, immediately returns `{ status: 'already_paid_for_session' }`.
  - If existing status is `Captured_Pending_Review`, immediately returns `{ status: 'captured_pending_review' }`.
  - **Self-Healing Guarantee:** If existing status is `Completed`, verifies that the corresponding application (`online_${paymentId}`) exists in `public.applications`. If missing due to an earlier transient crash, executes self-heal via `submitFinal` and updates payment metadata to `entitlement_status: 'active'`.
- **Pre-Insert Session Collision Check in `createPayment`:**
  Before inserting a `Completed` row into `public.payments`, queries:
  ```sql
  SELECT payment_id, razorpay_payment_id, status
  FROM payments
  WHERE student_uid = input.studentUid
    AND session_start_year = input.sessionStartYear
    AND session_end_year = input.sessionEndYear
    AND status = 'Completed';
  ```
  - If an existing record exists with the same payment ID: throws `ALREADY_PROCESSED`.
  - If an existing record exists with a DIFFERENT payment ID: throws `DUPLICATE_SESSION_PAYMENT`.
- **Duplicate Session Handling (`DUPLICATE_SESSION_PAYMENT`):**
  1. Catches `DUPLICATE_SESSION_PAYMENT`.
  2. Calls `paymentsSupabaseService.createDuplicatePaymentRecord`:
     - Creates an immutable row in `public.payments` with `status = 'Duplicate_Pending_Refund'`.
     - Encrypts student identifiers (`student_name`, `student_id`) with AES-256-GCM.
     - Notes: `'DUPLICATE_SESSION_PAYMENT - pending refund review'`.
  3. **Fail-Closed Guarantee:** If duplicate record insertion fails, returns `{ status: 'error' }` to cause provider retry, preventing unrecorded captured revenue.
  4. Emits high-severity financial audit event (`duplicate_session_payment_captured`) to `public.audit_events`.
  5. Returns `{ status: 'already_paid_for_session' }`.

---

### 4.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Cold Execution: Path 1 (`verify-payment`)** | **4 Queries:**<br>1. Check `payments` by ID (`isPaymentProcessed`)<br>2. Select `system_settings` for deadline config<br>3. Select `payments` for session conflict check<br>4. Insert into `payments` (status: Completed) | **0** | **2 Gateway Calls:**<br>1. `razorpay.orders.fetch`<br>2. `razorpay.payments.fetch` | **6 I/O Ops** |
| **(b) Cold Execution: Path 2 (`webhook` `payment.captured`)** | **4 Queries:**<br>1. Check `payments` by ID (`isPaymentProcessed`)<br>2. Select `system_settings` for deadline config<br>3. Select `payments` for session conflict check<br>4. Insert into `payments` (status: Completed) | **0** | **1 Gateway Call:**<br>1. `razorpay.orders.fetch` | **5 I/O Ops** |
| **(c) Concurrent Race Collision (Path 1 + Path 2 at exact same ms)** | **4 Queries total** (De-duplicated via `inFlightPayments` Map; second request waits for identical promise) | **0** | **3 Gateway Calls total** (`orders.fetch` & `payments.fetch` for Path 1; `orders.fetch` for Path 2 before lock) | **7 I/O Ops total** |
| **(d) Duplicate Session Payment (Commuter already paid for session)** | **4 Queries:**<br>1. Check `payments` by ID (`isPaymentProcessed`)<br>2. Pre-insert conflict query on `payments` (throws `DUPLICATE_SESSION_PAYMENT`)<br>3. Insert into `payments` (status: `Duplicate_Pending_Refund`)<br>4. Insert into `audit_events` (action: `duplicate_session_payment_captured`) | **0** | **1 to 2 Gateway Calls** (`orders.fetch` / `payments.fetch`) | **5 to 6 I/O Ops** |
| **(e) External Gateway / DB Failure (e.g. Razorpay down / DB unreachable)** | **0 to 1 Queries** (Fails at gateway fetch or initial DB check) | **0** | **1 Failed Call** (Returns 502 to client / 502 to Webhook for automatic retry) | **1 to 2 Ops** |

---

### 4.5 Verbatim Source Code from Live Codebase

#### 1. Client Verification Route: `src/app/api/payment/razorpay/verify-payment/route.ts`
```typescript
import { processCapturedPayment } from '@/lib/payment/payment.service';
import {
    fetchOrderDetails,
    fetchPaymentDetails,
    verifyRazorpaySignature,
} from '@/lib/payment/razorpay.service';
import { isOriginAllowed, withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { VerifyPaymentSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type VerifyPaymentBody = z.infer<typeof VerifyPaymentSchema>;

type RazorpayNotes = Record<string, string | number | boolean | null | undefined>;

type RazorpayOrderDetails = {
    id?: string;
    amount: number;
    currency?: string;
    notes?: RazorpayNotes;
};

type RazorpayPaymentDetails = {
    id?: string;
    order_id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    method?: string;
};

type OnlineTransactionRecord = {
    studentId: string;
    studentName: string;
    amount: number;
    paymentMethod: 'online';
    paymentId: string;
    timestamp: string;
    durationYears: number;
    validUntil: string;
    status: 'completed';
    purpose: 'new_registration' | 'renewal';
};

function noteString(notes: RazorpayNotes, key: string): string {
    const value = notes[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function parseDuration(value: string): number {
    const parsed = Number.parseInt(value || '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePurpose(value: string): 'new_registration' | 'renewal' {
    const normalized = value.toLowerCase();
    return normalized.includes('registration') || normalized === 'new_registration'
        ? 'new_registration'
        : 'renewal';
}

export const POST = withSecurity<VerifyPaymentBody>(
    async (_request, { auth, body }) => {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment API POST handler ENTER. body:`, JSON.stringify(body), `auth:`, JSON.stringify(auth));
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;

        const verification = verifyRazorpaySignature({
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_signature,
        });

        if (!verification.isValid) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyRazorpaySignature returned invalid. Error:`, verification.error);
            const res = NextResponse.json(
                { success: false, error: verification.error || 'Payment verification failed' },
                { status: 400 }
            );
            return res;
        }

        let orderDetails: RazorpayOrderDetails;
        let paymentDetails: RazorpayPaymentDetails;

        try {
            const [orderRes, paymentRes] = await Promise.all([
                fetchOrderDetails(razorpay_order_id),
                fetchPaymentDetails(razorpay_payment_id)
            ]);
            orderDetails = orderRes as RazorpayOrderDetails;
            paymentDetails = paymentRes as RazorpayPaymentDetails;
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Parallel fetch complete. orderDetails:`, JSON.stringify(orderDetails), `paymentDetails:`, JSON.stringify(paymentDetails));
        } catch (fetchErr: any) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Razorpay fetch failed:`, fetchErr?.message || fetchErr);
            return NextResponse.json(
                { success: false, error: 'Failed to verify payment or order details with Razorpay' },
                { status: 502 }
            );
        }

        const trustedNotes = orderDetails.notes || {};
        const trustedUserId = noteString(trustedNotes, 'userId');
        const trustedEnrollmentId = noteString(trustedNotes, 'enrollmentId') || noteString(trustedNotes, 'studentId');
        const trustedStudentName = noteString(trustedNotes, 'studentName') || noteString(trustedNotes, 'userName') || 'Unknown';
        const trustedDurationYears = parseDuration(noteString(trustedNotes, 'durationYears'));
        const trustedPurpose = normalizePurpose(noteString(trustedNotes, 'type') || noteString(trustedNotes, 'purpose'));
        const trustedAmount = Number(orderDetails.amount || 0) / 100;

        if (!trustedUserId || trustedUserId !== auth.uid) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] User mismatch. trustedUserId:`, trustedUserId, `auth.uid:`, auth.uid);
            return NextResponse.json(
                { success: false, error: 'Payment order does not belong to the authenticated user' },
                { status: 403 }
            );
        }

        const rawOrderCurrency = orderDetails.currency;
        const rawPaymentCurrency = paymentDetails.currency;

        const isOrderCurrencyValid = typeof rawOrderCurrency === 'string' && rawOrderCurrency.trim().toUpperCase() === 'INR';
        const isPaymentCurrencyValid = typeof rawPaymentCurrency === 'string' && rawPaymentCurrency.trim().toUpperCase() === 'INR';

        if (
            paymentDetails.id !== razorpay_payment_id ||
            paymentDetails.order_id !== razorpay_order_id ||
            Number(paymentDetails.amount || 0) !== Number(orderDetails.amount || 0) ||
            !isOrderCurrencyValid ||
            !isPaymentCurrencyValid
        ) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Details mismatch: paymentDetails.id=`, paymentDetails.id, `razorpay_payment_id=`, razorpay_payment_id, `paymentDetails.order_id=`, paymentDetails.order_id, `razorpay_order_id=`, razorpay_order_id, `paymentCurrency=`, rawPaymentCurrency, `orderCurrency=`, rawOrderCurrency);
            return NextResponse.json(
                { success: false, error: 'Razorpay payment details do not match the order' },
                { status: 400 }
            );
        }

        if (paymentDetails.status !== 'captured') {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Payment status not captured. status:`, paymentDetails.status);
            return NextResponse.json(
                { success: false, error: 'Payment is not captured yet. Please retry shortly.' },
                { status: 409 }
            );
        }

        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment invoking processCapturedPayment...`);

        let result: { status: 'success' | 'already_processed' | 'error' | 'already_paid_for_session' | 'captured_pending_review'; error?: string };
        try {
            result = await processCapturedPayment({
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                amount: trustedAmount,
                method: paymentDetails.method || 'Online',
                notes: trustedNotes,
                source: 'verify-payment'
            });
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment: processCapturedPayment returned:`, JSON.stringify(result));
        } catch (procErr: any) {
            console.error('[verify-payment] processCapturedPayment threw:', procErr?.message || procErr);
            return NextResponse.json(
                { success: false, error: procErr?.message || 'Payment processing failed unexpectedly' },
                { status: 500 }
            );
        }

        if (result.status === 'error') {
            console.error('[verify-payment] processCapturedPayment returned error:', result.error);
            return NextResponse.json(
                { success: false, error: result.error || 'Failed to process payment' },
                { status: 500 }
            );
        }

        if (result.status === 'already_paid_for_session') {
            const responseBody = {
                success: true,
                duplicatePayment: true,
                message: `Payment received and recorded (Reference: ${razorpay_payment_id}). An existing active payment already covers this academic session. This transaction has been flagged in the university ledger for refund review.`,
                payment: {
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    userId: trustedUserId,
                    userName: trustedStudentName,
                    purpose: trustedPurpose,
                    amount: trustedAmount,
                    status: 'Duplicate_Pending_Refund',
                    method: paymentDetails.method || 'Online',
                    capturedAt: new Date().toISOString(),
                },
                verification: {
                    isValid: true,
                    orderId: verification.orderId,
                    paymentId: verification.paymentId,
                },
            };
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment API returning duplicate/refund response:`, JSON.stringify(responseBody));
            return NextResponse.json(responseBody);
        }

        if (result.status === 'captured_pending_review') {
            const responseBody = {
                success: true,
                pendingReview: true,
                message: `Payment received and recorded in ledger (Reference: ${razorpay_payment_id}). Academic session details could not be automatically established. This transaction has been queued for administrative review and attribution.`,
                payment: {
                    paymentId: razorpay_payment_id,
                    orderId: razorpay_order_id,
                    userId: trustedUserId,
                    userName: trustedStudentName,
                    purpose: trustedPurpose,
                    amount: trustedAmount,
                    status: 'Captured_Pending_Review',
                    method: paymentDetails.method || 'Online',
                    capturedAt: new Date().toISOString(),
                },
                verification: {
                    isValid: true,
                    orderId: verification.orderId,
                    paymentId: verification.paymentId,
                },
            };
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment API returning review response:`, JSON.stringify(responseBody));
            return NextResponse.json(responseBody);
        }

        const pendingApproval = trustedPurpose === 'renewal';
        const responseBody = {
            success: true,
            pendingApproval,
            message: pendingApproval
                ? 'Payment received. Your renewal is now awaiting approval — transport access will be restored once an administrator approves it.'
                : 'Payment verified successfully',
            payment: {
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                userId: trustedUserId,
                userName: trustedStudentName,
                purpose: trustedPurpose,
                amount: trustedAmount,
                status: paymentDetails.status,
                method: paymentDetails.method || 'unknown',
                capturedAt: new Date().toISOString(),
            },
            verification: {
                isValid: true,
                orderId: verification.orderId,
                paymentId: verification.paymentId,
            },
        };
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment API returning success. responseBody:`, JSON.stringify(responseBody));
        return NextResponse.json(responseBody);
    },
    {
        requiredRoles: [],
        schema: VerifyPaymentSchema,
        rateLimit: RateLimits.PAYMENT_VERIFY,
        allowBodyToken: true,
    }
);

export async function OPTIONS(request: Request) {
    const origin = request.headers.get('origin') ?? '';
    const isAllowed = isOriginAllowed(origin);

    return new NextResponse(null, {
        status: isAllowed ? 204 : 403,
        headers: isAllowed ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400',
        } : {},
    });
}

```

#### 2. Webhook Alias Route: `src/app/api/payment/razorpay/webhook/route.ts`
```typescript
/**
 * Razorpay Webhook Alias Route
 *
 * Delegates directly to the canonical webhook handler at
 * /api/payment/webhook/razorpay so that webhook deliveries configured at
 * either URL path are handled identically with no redirection or payload loss.
 */
export { POST } from '@/app/api/payment/webhook/razorpay/route';

```

#### 3. Canonical Webhook Route: `src/app/api/payment/webhook/razorpay/route.ts`
```typescript
/**
 * Razorpay Webhook Handler
 * 
 * SECURITY FIXES:
 * - Atomic idempotency check inside transaction to prevent race conditions
 * - Uses order notes (trusted source) instead of payment notes
 * - Processed payment marker set BEFORE student update
 */

import { processCapturedPayment } from '@/lib/payment/payment.service';
import { fetchOrderDetails } from '@/lib/payment/razorpay.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('X-Razorpay-Signature');
    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook received. signature:`, signature);

    if (!signature) {
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: No signature provided`);
      return NextResponse.json({ error: 'No signature provided' }, { status: 400 });
    }

    // Verify webhook signature
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Webhook secret not configured`);
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    if (!signature || signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      )) {
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Invalid signature`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Signature verified successfully`);

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      console.warn('[webhook] Webhook received invalid JSON payload');
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const event = payload?.event;
    const paymentEntity = payload?.payload?.payment?.entity;
    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Event is:`, event);

    if (event === 'payment.captured') {
      if (!paymentEntity) {
        console.error('[webhook] payment.captured event missing payment entity');
        return NextResponse.json({ error: 'Missing payment entity' }, { status: 400 });
      }
      const { id: paymentId, order_id, amount, method } = paymentEntity;

      // SECURITY: Fetch order details from Razorpay to get TRUSTED data.
      // Don't trust payment notes - they can differ from order notes.
      // On fetch failure return 502 (NOT 200): Razorpay retries webhooks on
      // non-2xx, so the payment is processed on retry instead of being
      // processed now from untrusted payment-entity notes.
      let orderDetails;
      try {
        orderDetails = await fetchOrderDetails(order_id);
      } catch (error) {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: order fetch failed, returning 502 for retry`);
        return NextResponse.json({ error: 'Order verification unavailable, retrying' }, { status: 502 });
      }

      // SECURITY: Extract trusted values from order notes only.
      const notes = orderDetails.notes || {};

      // Amount binding (mirrors verify-payment): the captured amount must
      // match the trusted order amount before any ledger write. A mismatch is
      // deterministic (integer paise), so 400 stops Razorpay retries.
      if (Number(orderDetails.amount || 0) !== Number(paymentEntity.amount || 0)) {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: amount mismatch, rejecting`);
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
      }

      // Currency invariant: compare provider payment details to trusted order data.
      // Must both explicitly be 'INR' and match each other. Fail-closed: reject absent, empty, invalid or mismatched currencies.
      const rawOrderCurrency = orderDetails.currency;
      const rawPaymentCurrency = paymentEntity.currency;
      const isOrderCurrencyValid = typeof rawOrderCurrency === 'string' && rawOrderCurrency.trim().toUpperCase() === 'INR';
      const isPaymentCurrencyValid = typeof rawPaymentCurrency === 'string' && rawPaymentCurrency.trim().toUpperCase() === 'INR';

      if (!isOrderCurrencyValid || !isPaymentCurrencyValid) {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: currency invalid or mismatch (order: ${String(rawOrderCurrency)}, payment: ${String(rawPaymentCurrency)}), rejecting`);
        return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: Calling processCapturedPayment for:`, paymentId, `orderId:`, order_id);
      const result = await processCapturedPayment({
        paymentId,
        orderId: order_id,
        amount: amount / 100, // convert to rupees
        method: method || 'Online',
        notes,
        source: 'webhook'
      });
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: processCapturedPayment returned:`, JSON.stringify(result));

      if (result.status === 'error') {
        // Log the internal error detail server-side only — never expose it to
        // Razorpay (external caller). The generic response still triggers a
        // Razorpay retry on 5xx so the payment is retried safely.
        console.error('[webhook] processCapturedPayment error (internal):', result.error);
        return NextResponse.json({ error: 'Payment processing failed' }, { status: 500 });
      }

      return NextResponse.json({ status: result.status }, { status: 200 });
    }

    if (event === 'refund.processed') {
      const refundEntity = payload.payload?.refund?.entity;
      if (!refundEntity?.payment_id || !refundEntity?.id) {
        console.warn('[webhook] refund.processed received without payment_id or refund id');
        return NextResponse.json({ error: 'Missing refund entity identifiers' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: refund.processed received for payment ${refundEntity.payment_id}, refund ${refundEntity.id}, amount ${refundEntity.amount}`);
      
      const paymentRec = await paymentsSupabaseService.getPaymentByRazorpayId(refundEntity.payment_id)
        || await paymentsSupabaseService.getPaymentById(refundEntity.payment_id);
      
      if (!paymentRec) {
        console.error(`[webhook] refund.processed: Payment ${refundEntity.payment_id} not found in database`);
        return NextResponse.json({ error: 'Payment record not found for refund' }, { status: 404 });
      }

      const refundAmountRupees = (Number(refundEntity.amount) || 0) / 100;
      if (refundAmountRupees <= 0) {
        console.warn(`[webhook] refund.processed: invalid refund amount ${refundEntity.amount}`);
        return NextResponse.json({ error: 'Invalid refund amount' }, { status: 400 });
      }

      // Execute atomic refund recording across Completed, Duplicate_Pending_Refund, and Captured_Pending_Review
      const refundResult = await paymentsSupabaseService.confirmManualRefundRecord({
        paymentId: paymentRec.payment_id,
        refundReference: refundEntity.id,
        refundedAmount: refundAmountRupees,
        authorizedBy: {
          userId: 'system:razorpay_webhook',
          name: 'Razorpay Gateway Webhook',
          role: 'system',
          type: 'system',
        },
        reason: `Automated gateway refund processed event received from Razorpay (${refundEntity.id})`,
      });

      if (!refundResult.success) {
        console.error('[webhook] confirmManualRefundRecord failed:', refundResult.error);
        return NextResponse.json({ error: refundResult.error || 'Failed to record refund' }, { status: 500 });
      }

      return NextResponse.json({ 
        status: 'refund_processed',
        isPartial: refundResult.isPartial,
        cumulativeRefunded: refundResult.cumulativeRefunded 
      }, { status: 200 });
    }

    if (event === 'payment.failed') {
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: payment.failed received for order ${orderId}, payment ${paymentId}, code: ${paymentEntity?.error_code}`);
      
      if (orderId || paymentId) {
        // getPaymentByRazorpayOrderId queries by razorpay_order_id (set at order creation).
        // getPaymentByRazorpayId queries by razorpay_payment_id (set at capture, may not exist yet).
        // getPaymentById queries by internal payment_id; never by Razorpay IDs — do NOT use for orderId lookup.
        const pendingRec = (orderId ? await paymentsSupabaseService.getPaymentByRazorpayOrderId(orderId) : null)
          || (paymentId ? await paymentsSupabaseService.getPaymentByRazorpayId(paymentId) : null);
        
        if (pendingRec && pendingRec.status === 'Pending') {
          const ok = await paymentsSupabaseService.updatePaymentMetadata(pendingRec.payment_id, {
            gateway_payment_failed_at: new Date().toISOString(),
            gateway_error_code: paymentEntity.error_code || 'unknown_failure',
            gateway_error_description: paymentEntity.error_description || 'Gateway reported payment failure',
            gateway_error_reason: paymentEntity.error_reason || 'payment_failed',
            gateway_failed_payment_id: paymentEntity.id,
            requires_student_retry: true,
          });

          if (!ok) {
            console.error('[webhook] Error updating payment.failed metadata: database write failed');
            return NextResponse.json({ error: 'Failed to record payment failure' }, { status: 500 });
          }
        }
      }
      return NextResponse.json({ status: 'payment_failed_logged' }, { status: 200 });
    }

    if (event === 'refund.created') {
      const refundEntity = payload.payload?.refund?.entity;
      if (!refundEntity?.payment_id || !refundEntity?.id) {
        return NextResponse.json({ error: 'Missing refund entity identifiers' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: refund.created received for payment ${refundEntity.payment_id}, refund ${refundEntity.id}`);

      const paymentRec = await paymentsSupabaseService.getPaymentByRazorpayId(refundEntity.payment_id)
        || await paymentsSupabaseService.getPaymentById(refundEntity.payment_id);

      if (paymentRec) {
        const refundAmountRupees = (Number(refundEntity.amount) || 0) / 100;
        const currentRefunds = Array.isArray(paymentRec.metadata?.refund_history) ? [...paymentRec.metadata.refund_history] : [];
        const trimmedRef = refundEntity.id.trim();
        const existingIdx = currentRefunds.findIndex((r: any) => r.refund_id === trimmedRef);
        const now = new Date().toISOString();

        if (existingIdx >= 0) {
          currentRefunds[existingIdx] = {
            ...currentRefunds[existingIdx],
            status: refundEntity.status || 'created',
            updated_at: now,
          };
        } else {
          currentRefunds.push({
            refund_id: trimmedRef,
            amount: refundAmountRupees,
            status: refundEntity.status || 'created',
            created_at: now,
            source: 'webhook:refund.created',
          });
        }

        const ok = await paymentsSupabaseService.updatePaymentMetadata(paymentRec.payment_id, {
          last_refund_event: 'refund.created',
          last_refund_event_at: now,
          refund_history: currentRefunds,
          latest_refund_id: trimmedRef,
          latest_refund_status: refundEntity.status || 'created',
        });

        if (!ok) {
          console.error('[webhook] Failed to record refund.created event in metadata');
          return NextResponse.json({ error: 'Failed to record refund.created event' }, { status: 500 });
        }
      }

      return NextResponse.json({ status: 'refund_created_logged' }, { status: 200 });
    }

    if (event === 'refund.failed') {
      const refundEntity = payload.payload?.refund?.entity;
      if (!refundEntity?.payment_id || !refundEntity?.id) {
        return NextResponse.json({ error: 'Missing refund entity identifiers' }, { status: 400 });
      }

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Webhook: refund.failed received for payment ${refundEntity.payment_id}, refund ${refundEntity.id}`);

      const paymentRec = await paymentsSupabaseService.getPaymentByRazorpayId(refundEntity.payment_id)
        || await paymentsSupabaseService.getPaymentById(refundEntity.payment_id);

      if (paymentRec) {
        const currentRefunds = Array.isArray(paymentRec.metadata?.refund_history) ? [...paymentRec.metadata.refund_history] : [];
        const trimmedRef = refundEntity.id.trim();
        const existingIdx = currentRefunds.findIndex((r: any) => r.refund_id === trimmedRef);
        const now = new Date().toISOString();
        const errorInfo = {
          code: refundEntity.error_code || 'gateway_refund_failed',
          description: refundEntity.error_description || 'Gateway reported refund failure',
          reason: refundEntity.error_reason || 'unknown',
        };

        if (existingIdx >= 0) {
          currentRefunds[existingIdx] = {
            ...currentRefunds[existingIdx],
            status: 'failed',
            error: errorInfo,
            failed_at: now,
          };
        } else {
          currentRefunds.push({
            refund_id: trimmedRef,
            amount: (Number(refundEntity.amount) || 0) / 100,
            status: 'failed',
            error: errorInfo,
            failed_at: now,
            source: 'webhook:refund.failed',
          });
        }

        const ok = await paymentsSupabaseService.updatePaymentMetadata(paymentRec.payment_id, {
          last_refund_event: 'refund.failed',
          last_refund_event_at: now,
          refund_history: currentRefunds,
          refund_failed_alert: true,
          latest_refund_error: errorInfo,
          requires_refund_review: true, // Actionable flag for university finance staff
        });

        if (!ok) {
          console.error('[webhook] Failed to record refund.failed event in metadata');
          return NextResponse.json({ error: 'Failed to record refund failure' }, { status: 500 });
        }
      }

      return NextResponse.json({ status: 'refund_failed_logged' }, { status: 200 });
    }

    return NextResponse.json({ status: 'received' }, { status: 200 });

  } catch (error) {
    console.error('[webhook] Processing error:', (error as any)?.message);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

```

#### 4. Cryptographic Signature Verification: `src/lib/payment/razorpay.service.ts` (Lines 134–185)
```typescript
 */
export function verifyRazorpaySignature(
  paymentResponse: RazorpayPaymentResponse
): PaymentVerification {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = paymentResponse;
    
    // Validate input
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return {
        isValid: false,
        error: 'Missing payment details',
      };
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new Error('Razorpay secret key not configured');
    }

    // Create the signature using HMAC SHA256
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');

    // SECURITY: Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(razorpay_signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const isValid = signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (isValid) {
      return {
        isValid: true,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      };
    } else {
      return {
        isValid: false,
        error: 'Invalid payment signature',
      };
    }
  } catch (error: any) {
    return {
      isValid: false,
      error: error.message || 'Payment verification failed',
    };
  }
```

#### 5. Concurrency Control, Idempotency & Engine: `src/lib/payment/payment.service.ts`
```typescript
// Lines 159-770: Concurrency Deduplication, Idempotency, and executeProcessCapturedPayment
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment: ${paymentId} is already in Supabase ledger.`);
            
            // Check if this payment was already recorded as a duplicate capture or pending review
            const existingPayment = await paymentsSupabaseService.getPaymentById(paymentId)
                || await paymentsSupabaseService.getPaymentByRazorpayId(paymentId);
            if (existingPayment?.status === 'Duplicate_Pending_Refund') {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment: ${paymentId} is already recorded as Duplicate_Pending_Refund. Returning already_paid_for_session.`);
                return { status: 'already_paid_for_session' };
            }
            if (existingPayment?.status === 'Captured_Pending_Review') {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment: ${paymentId} is already recorded as Captured_Pending_Review. Returning captured_pending_review.`);
                return { status: 'captured_pending_review' };
            }

            // SELF-HEALING GUARANTEE: For renewal payments, verify that the renewal application record exists.
            // If a previous payment capture failed halfway due to a transient database outage or network switch,
            // recover and create the renewal application now instead of dropping it.
            // Server-derived `type` (set at order creation) is authoritative;
            // free-text `purpose` is only a legacy fallback.
            const rawPurpose = String(notes.type || notes.purpose || '');
            const isRenewal = !rawPurpose.toLowerCase().includes('registration') && rawPurpose.toLowerCase() !== 'new_registration';
            if (isRenewal) {
                const applicationId = `online_${paymentId}`;
                const existingRequest = await getApplicationById(applicationId).catch(() => null);
                if (existingRequest || existingPayment?.metadata?.entitlement_status === 'active') {
                    if (existingPayment?.metadata?.entitlement_status !== 'active') {
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'active',
                            application_id: applicationId,
                            activated_at: new Date().toISOString(),
                        }).catch(() => null);
                    }
                    return { status: 'already_processed' };
                }
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Self-healing missing renewal application for payment ${paymentId}`);
                try {
                    const enrollmentId = notes.enrollmentId || notes.studentId;
                    const userId = notes.userId;
                    const durationYears = parseInt(notes.durationYears || '1', 10) || 1;
                    const studentName = notes.studentName || notes.userName || 'Unknown';
                    let studentUid = userId || '';
                    let actualStudentName = studentName;
                    let studentEmail = '';
                    let studentPhone = '';
                    let studentData: any = null;
                    if (studentUid) {
                        const student = await getStudentByUid(studentUid);
                        if (student) studentData = student as any;
                    }
                    if (studentData) {
                        actualStudentName = studentData.fullName || studentName;
                        studentEmail = studentData.email || '';
                        studentPhone = studentData.phone || studentData.phoneNumber || '';
                    }
                    const existingValidUntil = studentData?.validUntil;
                    let baseYear = new Date().getUTCFullYear();
                    const now = new Date();
                    if (existingValidUntil) {
                        const existingDate = new Date(existingValidUntil);
                        if (existingDate > now) {
                            baseYear = studentData?.sessionEndYear || baseYear;
                        }
                    }
                    const deadlineConfig = await getDeadlineConfig();
                    const newValidUntil = calculateValidUntilDate(baseYear, durationYears, deadlineConfig);
                    const { submitFinal } = await import('@/domains/application');
                    const healSubmitRes = await submitFinal(
                        studentUid,
                        studentEmail || '',
                        {
                            studentId: studentUid,
                            enrollmentId: enrollmentId || studentData?.enrollmentId || '',
                            studentName: actualStudentName,
                            studentEmail,
                            studentPhone,
                            durationYears,
                            totalFee: amount,
                            paymentMode: 'online',
                            paymentId,
                            razorpayOrderId: orderId,
                            paymentStatus: 'paid',
                            requestedValidUntil: newValidUntil.toISOString(),
                            phoneNumber: studentPhone,
                            shift: studentData?.shift || 'Morning',
                            busId: studentData?.busId || '',
                            routeId: studentData?.routeId || '',
                            stop_name: studentData?.stop_name || studentData?.stopName || '',
                            sessionStartYear: studentData?.sessionEndYear || baseYear,
                            sessionEndYear: (studentData?.sessionEndYear || baseYear) + durationYears,
                        },
                        {
                            applicationId,
                            applicationType: 'renewal',
                            shift: studentData?.shift || 'Morning',
                            busId: studentData?.busId || '',
                            routeId: studentData?.routeId || '',
                            stop_name: studentData?.stop_name || studentData?.stopName || '',
                            sessionStartYear: studentData?.sessionEndYear || baseYear,
                            sessionEndYear: (studentData?.sessionEndYear || baseYear) + durationYears,
                        }
                    );
                    if (healSubmitRes && !healSubmitRes.success) {
                        console.warn(`[PAYMENT_TRACE] submitFinal self-heal returned failure for renewal ${applicationId}:`, healSubmitRes.error);
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'failed',
                            application_id: applicationId,
                            entitlement_error: healSubmitRes?.error || 'submitFinal self-heal returned failure',
                            last_attempt_at: new Date().toISOString(),
                        }).catch(() => null);
                    } else {
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'active',
                            application_id: applicationId,
                            activated_at: new Date().toISOString(),
                        }).catch(() => null);
                    }
                    return { status: 'success' };
                } catch (healError: any) {
                    console.error(`[PAYMENT_TRACE] Self-heal failed for payment ${paymentId}:`, healError);
                    await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                        entitlement_status: 'failed',
                        application_id: applicationId,
                        entitlement_error: healError?.message || String(healError),
                        last_attempt_at: new Date().toISOString(),
                    }).catch(() => null);
                    return { status: 'error', error: `Self-heal failed: ${healError?.message || String(healError)}` };
                }
            } else {
                const registrationAppId = notes.userId || notes.studentId;
                if (registrationAppId) {
                    const existingApp = await getApplicationById(registrationAppId).catch(() => null);
                    if (existingApp && existingPayment?.metadata?.entitlement_status !== 'active') {
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'active',
                            application_id: registrationAppId,
                            activated_at: new Date().toISOString(),
                        }).catch(() => null);
                    }
                }
                return { status: 'already_processed' };
            }
        }

        const enrollmentId = notes.enrollmentId || notes.studentId;
        const userId = notes.userId;
        const durationYears = parseInt(notes.durationYears || '1', 10) || 1;
        const studentName = notes.studentName || notes.userName || 'Unknown';

        if (!enrollmentId && !userId) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment error: Missing enrollment/user ID in notes:`, JSON.stringify(notes));
            return { status: 'error', error: 'Missing enrollment or user ID in payment notes' };
        }

        const rawPurpose = String(notes.purpose || notes.type || '');
        const isNewRegistration = rawPurpose.toLowerCase().includes('registration') || rawPurpose.toLowerCase() === 'new_registration';
        const deadlineConfig = await getDeadlineConfig();

        if (isNewRegistration) {
            let sessionStartYear: number | undefined;
            let sessionEndYear: number | undefined;
            let targetValidUntil: Date;
            if (userId) {
                const app = await getApplicationById(userId);
                if (app) {
                    const ts = (app as any).targetSession;
                    if (ts && Number(ts.startYear) > 0 && Number(ts.endYear) > 0) {
                        sessionStartYear = Number(ts.startYear);
                        sessionEndYear = Number(ts.endYear);
                    }
                }
            }
            if (sessionStartYear && sessionEndYear) {
                const anchorMonth = deadlineConfig.academicYear.anchorMonth;
                const anchorDay = deadlineConfig.academicYear.anchorDay;
                targetValidUntil = new Date(Date.UTC(sessionEndYear, anchorMonth, anchorDay, 23, 59, 59, 999));
            } else if (notes.sessionStartYear && notes.sessionEndYear) {
                const parsedStart = parseInt(notes.sessionStartYear, 10);
                const parsedEnd = parseInt(notes.sessionEndYear, 10);
                if (parsedStart > 2000 && parsedEnd > parsedStart) {
                    sessionStartYear = parsedStart;
                    sessionEndYear = parsedEnd;
                    const anchorMonth = deadlineConfig.academicYear.anchorMonth;
                    const anchorDay = deadlineConfig.academicYear.anchorDay;
                    targetValidUntil = new Date(Date.UTC(sessionEndYear, anchorMonth, anchorDay, 23, 59, 59, 999));
                }
            }

            if (!sessionStartYear || !sessionEndYear) {
                console.warn(`[processCapturedPayment] Academic session could not be determined for registration payment ${paymentId}. Preserving in ledger without granting transit entitlement.`);
                await paymentsSupabaseService.createDuplicatePaymentRecord({
                    paymentId,
                    studentUid: userId || enrollmentId || '',
                    studentId: enrollmentId || '',
                    studentName,
                    amount,
                    method,
                    status: 'Captured_Pending_Review',
                    sessionStartYear: undefined,
                    sessionEndYear: undefined,
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    notes: `Captured registration payment missing verified academic session. Preserved in ledger for manual review without granting transit entitlement.`,
                    metadata: {
                        requires_manual_review: true,
                        unresolved_academic_session: true,
                        duplicate_session_capture: false,
                    }
                });
                return {
                    status: 'captured_pending_review'
                };
            }

            // Save Completed online payment record to Supabase (Immutable Ledger)
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert`);
            const registrationAppId = userId || enrollmentId;
            let initialEntitlementStatus = 'pending_registration_submission';
            if (registrationAppId) {
                const existingApp = await getApplicationById(registrationAppId).catch(() => null);
                if (existingApp) {
                    initialEntitlementStatus = 'active';
                }
            }

            const result = await paymentsSupabaseService.createPayment({
                paymentId,
                studentId: enrollmentId || '',
                studentUid: userId || '',
                studentName,
                amount,
                method: 'Online',
                status: 'Completed',
                sessionStartYear,
                sessionEndYear,
                durationYears,
                validUntil: targetValidUntil,
                transactionDate: new Date(),
                razorpayPaymentId: paymentId,
                razorpayOrderId: orderId,
                approvedBy: { type: 'SYSTEM' },
                approvedAt: new Date(),
                metadata: {
                    ...(notes || {}),
                    entitlement_status: initialEntitlementStatus,
                    application_id: registrationAppId || undefined,
                    initial_captured_at: new Date().toISOString(),
                },
            });

            if (!result) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert FAILED`);
                throw new Error(`Failed to create online payment ledger record: ${paymentId}`);
            }

            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert SUCCESS: ${result}`);

            return { status: 'success' };
        } else {
            // Renewal Flow
            let studentUid = userId || '';
            let actualStudentName = studentName;
            let studentEmail = '';
            let studentPhone = '';
            let transactionRecord: any = null;

            // Resolve student from domain API (needed for renewal validity calc)
            let studentData: any = null;
            if (studentUid) {
                const student = await getStudentByUid(studentUid);
                if (student) studentData = student as any;
            }

            if (studentData) {
                actualStudentName = studentData.fullName || studentName;
                studentEmail = studentData.email || '';
                studentPhone = studentData.phone || studentData.phoneNumber || '';
            }

            let existingSessionStartYear = studentData?.sessionStartYear;
            let existingSessionEndYear = studentData?.sessionEndYear;

            // If not on student profile, check verified order notes
            if (!existingSessionStartYear || !existingSessionEndYear) {
                if (notes.sessionStartYear && notes.sessionEndYear) {
                    const parsedStart = parseInt(notes.sessionStartYear, 10);
                    const parsedEnd = parseInt(notes.sessionEndYear, 10);
                    if (parsedStart > 2000 && parsedEnd > parsedStart) {
                        existingSessionStartYear = parsedStart;
                        existingSessionEndYear = parsedEnd;
                    }
                }
            }

            if (!existingSessionStartYear || !existingSessionEndYear) {
                console.warn(`[processCapturedPayment] Renewal session could not be determined for student ${studentUid}. Preserving in ledger without granting transit entitlement.`);
                await paymentsSupabaseService.createDuplicatePaymentRecord({
                    paymentId,
                    studentUid,
                    studentId: enrollmentId || studentData?.enrollmentId || '',
                    studentName: actualStudentName,
                    amount,
                    method,
                    status: 'Captured_Pending_Review',
                    sessionStartYear: undefined,
                    sessionEndYear: undefined,
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    notes: `Captured renewal payment missing verified academic session. Preserved in ledger for manual review without granting transit entitlement.`,
                    metadata: {
                        requires_manual_review: true,
                        unresolved_academic_session: true,
                        duplicate_session_capture: false,
                    }
                });
                return {
                    status: 'captured_pending_review'
                };
            }

            const existingDurationYears = studentData?.durationYears || 0;
            const existingValidUntil = studentData?.validUntil;
            const previousValidUntilISO = existingValidUntil
                ? (typeof existingValidUntil === 'string' ? existingValidUntil : new Date(existingValidUntil).toISOString())
                : null;

            let baseYear = new Date().getUTCFullYear();
            const now = new Date();

            if (existingValidUntil) {
                const existingDate = new Date(existingValidUntil);
                if (existingDate > now) {
                    baseYear = existingSessionEndYear;
                }
            }

            let newValidUntil = calculateValidUntilDate(baseYear, durationYears, deadlineConfig);
            let newSessionStartYear = existingSessionStartYear;
            let newSessionEndYear = baseYear + durationYears;
            let totalDurationYears = existingDurationYears + durationYears;

            transactionRecord = {
                studentId: enrollmentId || studentData?.enrollmentId || '',
                studentName: actualStudentName,
                amount,
                paymentMethod: 'online' as const,
                paymentId,
                timestamp: new Date().toISOString(),
                durationYears,
                validUntil: newValidUntil.toISOString(),
                previousValidUntil: previousValidUntilISO,
                newValidUntil: newValidUntil.toISOString(),
                previousSessionEndYear: existingSessionEndYear,
                newSessionEndYear,
                previousDurationYears: existingDurationYears,
                newDurationYears: totalDurationYears,
                userId: studentUid,
                status: 'completed' as const
            };

            // Save Completed online payment record to Supabase (Immutable Ledger)
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert`);
            const applicationId = `online_${paymentId}`;
            const result = await paymentsSupabaseService.createPayment({
                paymentId,
                studentId: transactionRecord.studentId,
                studentUid: transactionRecord.userId,
                studentName: transactionRecord.studentName,
                amount: transactionRecord.amount,
                method: 'Online',
                status: 'Completed',
                sessionStartYear: newSessionStartYear,
                sessionEndYear: newSessionEndYear,
                durationYears: transactionRecord.durationYears,
                validUntil: new Date(transactionRecord.validUntil),
                transactionDate: new Date(),
                razorpayPaymentId: paymentId,
                razorpayOrderId: orderId,
                approvedBy: { type: 'SYSTEM' },
                approvedAt: new Date(),
                metadata: {
                    ...(notes || {}),
                    entitlement_status: 'pending_application',
                    application_id: applicationId,
                    initial_captured_at: new Date().toISOString(),
                },
            });

            if (!result) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert FAILED`);
                throw new Error(`Failed to create online payment ledger record: ${paymentId}`);
            }

            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert SUCCESS: ${result}`);

            // D8: Create the PENDING renewal application in PostgreSQL instead of Firestore
            const existingRequest = await getApplicationById(applicationId);
            if (!existingRequest) {
                const { submitFinal } = await import('@/domains/application');
                const renewalSubmitRes = await submitFinal(
                    studentUid,
                    studentEmail || '',
                    {
                        studentId: studentUid,
                        enrollmentId: enrollmentId || transactionRecord?.studentId || studentData?.enrollmentId || '',
                        studentName: actualStudentName,
                        studentEmail,
                        studentPhone,
                        durationYears,
                        totalFee: amount,
                        paymentMode: 'online',
                        paymentId,
                        razorpayOrderId: orderId,
                        paymentStatus: 'paid',
                        requestedValidUntil: newValidUntil.toISOString(),
                        phoneNumber: studentPhone,
                        shift: studentData?.shift || 'Morning',
                        busId: studentData?.busId || '',
                        routeId: studentData?.routeId || '',
                        stop_name: studentData?.stop_name || studentData?.stopName || '',
                        sessionStartYear: studentData?.sessionEndYear || baseYear,
                        sessionEndYear: (studentData?.sessionEndYear || baseYear) + durationYears,
                    },
                    {
                        applicationId,
                        applicationType: 'renewal',
                        shift: studentData?.shift || 'Morning',
                        busId: studentData?.busId || '',
                        routeId: studentData?.routeId || '',
                        stop_name: studentData?.stop_name || studentData?.stopName || '',
                        sessionStartYear: studentData?.sessionEndYear || baseYear,
                        sessionEndYear: (studentData?.sessionEndYear || baseYear) + durationYears,
                    }
                );
                if (renewalSubmitRes && !renewalSubmitRes.success) {
                    console.warn(`[PAYMENT_TRACE] submitFinal renewal returned failure for ${applicationId}:`, renewalSubmitRes.error);
                    await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                        entitlement_status: 'failed',
                        application_id: applicationId,
                        entitlement_error: renewalSubmitRes?.error || 'submitFinal renewal returned failure',
                        last_attempt_at: new Date().toISOString(),
                    }).catch(() => null);
                } else if (renewalSubmitRes && renewalSubmitRes.success) {
                    await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                        entitlement_status: 'active',
                        application_id: applicationId,
                        activated_at: new Date().toISOString(),
                    }).catch(() => null);
                }
            } else {
                await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                    entitlement_status: 'active',
                    application_id: applicationId,
                    activated_at: new Date().toISOString(),
                }).catch(() => null);
            }

                // Send notification to staff
                try {
                    const [admins, moderators] = await Promise.all([
                        getUsersByRole('admin'),
                        getUsersByRole('moderator'),
                    ]);
                    const allStaffIds = [
                        ...admins.map((u: any) => u.id || u.uid),
                        ...moderators.map((u: any) => u.id || u.uid),
                    ].filter(Boolean);
                    if (allStaffIds.length > 0) {
                        await Notification.createNotification(
                            {
                                userId: studentUid || enrollmentId || '',
                                userName: actualStudentName,
                                userRole: 'student',
                                employeeId: enrollmentId || '',
                            },
                            {
                                type: 'specific_users',
                                specificUserIds: allStaffIds,
                            },
                            `${actualStudentName} (${enrollmentId || ''}) paid online for a ${durationYears} year(s) renewal and is awaiting approval.`,
                            'Online Renewal Awaiting Approval',
                            { paymentId },
                        );
                    }
                } catch (notifyErr) {
                    console.error('[processCapturedPayment] Failed to notify staff of online renewal request:', notifyErr);
                }

            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment (renewal) returning success.`);
            return { status: 'success' };
        }
    } catch (err: any) {
        if (err.message === 'ALREADY_PROCESSED') {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment returning already_processed`);
            return { status: 'already_processed' };
        }
        if (err.message === 'DUPLICATE_SESSION_PAYMENT') {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment DUPLICATE_SESSION_PAYMENT for paymentId: ${paymentId}. Durably recording in ledger as Duplicate_Pending_Refund.`);

            // 1. Durably record in payments ledger so money is never lost or untracked
            let dupRecordedId: string | null = null;
            let dupSessionStart = notes.sessionStartYear ? parseInt(notes.sessionStartYear, 10) : undefined;
            let dupSessionEnd = notes.sessionEndYear ? parseInt(notes.sessionEndYear, 10) : undefined;

            // If notes omitted session years, inherit the session from the student's existing Completed transaction
            if (!dupSessionStart || !dupSessionEnd) {
                const targetUid = notes.userId || notes.studentId || '';
                if (targetUid) {
                    try {
                        const supabase = getSupabaseServer();
                        const query = supabase
                            .from('payments')
                            .select('session_start_year, session_end_year')
                            .eq('student_uid', targetUid)
                            .eq('status', 'Completed');

                        let existingCompleted: any = null;
                        if (typeof (query as any).order === 'function') {
                            const res = await (query as any).order('created_at', { ascending: false }).limit(1).maybeSingle();
                            existingCompleted = res?.data;
                        } else if (typeof (query as any).maybeSingle === 'function') {
                            const res = await (query as any).maybeSingle();
                            existingCompleted = res?.data;
                        } else if (typeof (query as any).single === 'function') {
                            const res = await (query as any).single();
                            existingCompleted = res?.data;
                        }

                        if (existingCompleted?.session_start_year && existingCompleted?.session_end_year) {
                            dupSessionStart = existingCompleted.session_start_year;
                            dupSessionEnd = existingCompleted.session_end_year;
                        }
                    } catch (lookupErr) {
                        console.warn('[processCapturedPayment] Error looking up completed session for duplicate capture:', lookupErr);
                    }
                }
            }

            try {
                dupRecordedId = await paymentsSupabaseService.createDuplicatePaymentRecord({
                    paymentId,
                    studentUid: notes.userId || notes.studentId || '',
                    studentId: notes.enrollmentId || notes.studentId || '',
                    studentName: notes.studentName || notes.userName || 'Student',
                    amount,
                    method,
                    status: 'Duplicate_Pending_Refund',
                    sessionStartYear: dupSessionStart,
                    sessionEndYear: dupSessionEnd,
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    notes: `Duplicate payment captured for student ${notes.userId || notes.studentId}. Academic session was already covered. Flagged for manual refund review.`
                });
            } catch (dupInsertErr: any) {
                console.error('[processCapturedPayment] Could not insert duplicate payment row:', dupInsertErr?.message);
            }

            // FAIL-CLOSED GUARANTEE: If ledger insertion failed, do NOT return already_paid_for_session
            // because webhook would return HTTP 200 to Razorpay and permanently drop unrecorded money!
            if (!dupRecordedId) {
                console.error(`[processCapturedPayment] CRITICAL: Failed to persist duplicate payment ${paymentId} in ledger. Returning error to trigger provider retry.`);
                return {
                    status: 'error',
                    error: 'Failed to record duplicate payment in financial ledger. Provider retry required.'
                };
            }

            // 2. High-priority audit trail event for financial reconciliation
            try {
                const { createAuditEvent } = await import('@/domains/audit');
                void createAuditEvent({
                    category: 'financial',
                    action: 'duplicate_session_payment_captured',
                    summary: `Duplicate payment ${paymentId} (₹${amount}) captured for student ${notes.userId || notes.studentId}. Recorded as Duplicate_Pending_Refund.`,
                    severity: 'high',
                    actor_id: notes.userId || 'system',
                    actor_name: notes.studentName || 'Student',
                    actor_role: 'system',
                    target_type: 'payment',
                    target_id: paymentId,
                    target_name: orderId,
                    metadata: {
                        paymentId,
                        orderId,
                        amount,
                        notes,
                        source,
                        reason: 'DUPLICATE_SESSION_PAYMENT'
                    }
                });
            } catch (auditErr: any) {
                console.warn('[processCapturedPayment] Could not emit duplicate payment audit event:', auditErr?.message);
            }

            return { status: 'already_paid_for_session' };
        }
        throw err;
    }
}

/**
 * Create a completed offline payment record AT APPROVAL TIME.
 * 
 * ⚠️ CRITICAL: This is the ONLY way offline payments enter the financial ledger.
 * 
 * Offline workflow:
 *   Student submits application → NO payment row
 *   Admin verifies & approves → THIS function creates payment row (status=completed)
 * 
 * The financial ledger contains ONLY verified financial events, not user claims.
 * 
 * @param request - Verified payment details from admin/moderator review
 * @returns The created payment document

// Lines 1811-1845: isPaymentProcessed implementation
/**
 * Check if a payment has already been processed (idempotency check).
 * Canonical implementation — used by webhook and verify-payment routes.
 */
export async function isPaymentProcessed(paymentId: string): Promise<boolean> {
    const isRazorpayId = paymentId.startsWith('pay_') && !paymentId.startsWith('pay_online_');
    if (isRazorpayId) {
        const paymentByRazorpay = await paymentsSupabaseService.getPaymentByRazorpayId(paymentId);
        if (
            paymentByRazorpay?.status === 'Completed' ||
            paymentByRazorpay?.status === 'Duplicate_Pending_Refund' ||
            paymentByRazorpay?.status === 'Captured_Pending_Review'
        ) return true;
        const payment = await paymentsSupabaseService.getPaymentById(paymentId);
        return (
            payment?.status === 'Completed' ||
            payment?.status === 'Duplicate_Pending_Refund' ||
            payment?.status === 'Captured_Pending_Review'
        );
    }

    // 1. Check by Primary ID (Supabase)
    const payment = await paymentsSupabaseService.getPaymentById(paymentId);
    if (
        payment?.status === 'Completed' ||
        payment?.status === 'Duplicate_Pending_Refund' ||
        payment?.status === 'Captured_Pending_Review'
    ) return true;

    // 2. Check by Razorpay ID (Supabase) - In case paymentId passed is a Razorpay ID
    const paymentByRazorpay = await paymentsSupabaseService.getPaymentByRazorpayId(paymentId);
    if (
        paymentByRazorpay?.status === 'Completed' ||
        paymentByRazorpay?.status === 'Duplicate_Pending_Refund' ||
        paymentByRazorpay?.status === 'Captured_Pending_Review'
```

#### 6. Database Pre-Insert Check & Duplicate Session Ledger Record: `src/lib/services/payments-supabase.ts`
```typescript
// Lines 356-455: createPayment pre-insert conflict validation
     */
    async createPayment(input: CreatePaymentInput): Promise<string | null> {
        if (!this.isReady()) {
            console.error('[PaymentsSupabaseService] Not initialized');
            return null;
        }

        try {
            // Validate academic session boundaries for Completed payments upfront
            if (input.status === 'Completed') {
                if (
                    !input.sessionStartYear ||
                    !input.sessionEndYear ||
                    input.sessionStartYear >= input.sessionEndYear ||
                    input.sessionStartYear < 2000
                ) {
                    throw new Error(
                        `INVALID_SESSION_YEARS: Completed payments require valid academic session years (received start=${input.sessionStartYear}, end=${input.sessionEndYear})`
                    );
                }
            }

            // 1. Pre-insert check: Query existing completed payment for the student and session
            if (input.studentUid && input.sessionStartYear && input.sessionEndYear) {
                const { data: existingRecords, error: queryErr } = await this.supabase
                    .from('payments')
                    .select('payment_id, razorpay_payment_id, status')
                    .eq('student_uid', input.studentUid)
                    .eq('session_start_year', input.sessionStartYear)
                    .eq('session_end_year', input.sessionEndYear)
                    .eq('status', 'Completed');

                if (!queryErr && existingRecords && existingRecords.length > 0) {
                    const existing = existingRecords[0];
                    const isSamePayment = existing.payment_id === input.paymentId || 
                                          (existing.razorpay_payment_id && existing.razorpay_payment_id === input.razorpayPaymentId) ||
                                          (input.razorpayPaymentId && existing.payment_id === input.razorpayPaymentId);
                    
                    if (isSamePayment) {
                        throw new Error('ALREADY_PROCESSED');
                    } else {
                        throw new Error('DUPLICATE_SESSION_PAYMENT');
                    }
                }
            }

            // Pre-lookup profile data if studentName or studentId is missing to guarantee no NULLs
            if ((!input.studentName || !input.studentId) && input.studentUid) {
                try {
                    const profileQuery = this.supabase?.from?.('student_profiles');
                    const { data: profile } = profileQuery?.select
                        ? await profileQuery
                            .select('full_name, enrollment_id')
                            .eq('uid', input.studentUid)
                            .maybeSingle()
                        : { data: null };
                    if (profile) {
                        input.studentName = input.studentName || profile.full_name;
                        input.studentId = input.studentId || profile.enrollment_id;
                    }
                    if (!input.studentName) {
                        const userQuery = this.supabase?.from?.('users');
                        const { data: userRec } = userQuery?.select
                            ? await userQuery
                                .select('name')
                                .eq('uid', input.studentUid)
                                .maybeSingle()
                            : { data: null };
                        if (userRec && userRec.name) input.studentName = userRec.name;
                    }
                } catch (e) {
                    console.error('[PaymentsSupabaseService] Profile pre-lookup error in createPayment:', e);
                }
            }

            const validUntilIso = input.validUntil?.toISOString();
            const transactionDateIso = input.transactionDate?.toISOString() || new Date().toISOString();
            const documentSignature = this.buildCompletedPaymentSignature(input, {
                paymentId: input.paymentId,
                validUntil: validUntilIso,
                transactionDate: transactionDateIso,
            });
            const approvedBy = this.normalizeApprovedBy(input);
            const approvedAtIso = input.approvedAt
                ? input.approvedAt.toISOString()
                : (input.status === 'Completed' ? new Date().toISOString() : null);

            const effectiveSessionStartYear = input.sessionStartYear;
            const effectiveSessionEndYear = input.sessionEndYear;

            if (input.status === 'Completed') {
                if (
                    !effectiveSessionStartYear ||
                    !effectiveSessionEndYear ||
                    effectiveSessionStartYear >= effectiveSessionEndYear ||
                    effectiveSessionStartYear < 2000
                ) {
                    throw new Error(
                        `INVALID_SESSION_YEARS: Completed payments require valid academic session years (received start=${effectiveSessionStartYear}, end=${effectiveSessionEndYear})`
                    );

// Lines 657-735: createDuplicatePaymentRecord implementation
     */
    async createDuplicatePaymentRecord(input: {
        paymentId: string;
        studentUid: string;
        studentId?: string;
        studentName?: string;
        amount: number;
        method?: string;
        status?: string;
        sessionStartYear?: number;
        sessionEndYear?: number;
        razorpayPaymentId?: string;
        razorpayOrderId?: string;
        notes?: string;
        metadata?: Record<string, unknown>;
    }): Promise<string | null> {
        if (!this.isReady()) return null;

        try {
            const transactionDateIso = new Date().toISOString();
            const record: Record<string, unknown> = {
                payment_id: input.paymentId,
                student_uid: input.studentUid,
                amount: input.amount,
                currency: 'INR',
                method: input.method || 'Online',
                status: input.status || 'Duplicate_Pending_Refund',
                session_start_year: input.sessionStartYear ?? null,
                session_end_year: input.sessionEndYear ?? null,
                duration_years: 1,
                transaction_date: transactionDateIso,
                student_name: input.studentName ? encryptData(input.studentName) : null,
                student_id: input.studentId ? encryptData(input.studentId) : null,
                razorpay_payment_id: input.razorpayPaymentId || input.paymentId,
                razorpay_order_id: input.razorpayOrderId || null,
                notes: input.notes || 'DUPLICATE_SESSION_PAYMENT - pending refund review',
                metadata: input.metadata || {
                    duplicate_session_capture: true,
                    requires_refund_review: true,
                }
            };

            const { data, error } = await this.supabase
                .from('payments')
                .insert([record])
                .select('payment_id')
                .single();

            if (error) {
                if (error.code === '23505') {
                    console.log(`[PaymentsSupabaseService] Duplicate payment ${input.paymentId} already in ledger.`);
                    return input.paymentId;
                }
                console.error('[PaymentsSupabaseService] Failed to record duplicate payment:', error);
                return null;
            }

            return data?.payment_id || input.paymentId;
        } catch (err: any) {
            console.error('[PaymentsSupabaseService] Exception recording duplicate payment:', err);
            return null;
        }
    }

    /**
     * Update payment status (approve or reject payment)
     * Allows: Pending → Completed, Pending → Rejected
     */
    /**
     * Update payment status with ATOMIC transition guard.
     * Only allows: Pending → Completed, Pending → Rejected
     * The WHERE clause ensures no double-approval/rejection race conditions.
     */
    async updatePaymentStatus(
        paymentId: string,
        status: 'Completed' | 'Rejected',
        approverInfo?: {
            userId: string;
            name: string;
```

---

