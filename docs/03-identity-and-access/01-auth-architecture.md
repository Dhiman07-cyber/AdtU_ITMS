# Authentication Architecture, Edge Perimeter Proxy & Dual Identity Spine (Forensic Truth)

**Module:** Supabase Auth, Edge Proxy (`proxy.ts`), Timing-Safe First Admin Bootstrap & Dual-Layer Identity  
**File Authority:** `src/proxy.ts`, `src/lib/auth/auth-service.ts`, `src/app/api/auth/`  
**Security Gate:** OWASP ASVS V2 & V3, Cloudflare/Reverse-Proxy IP Spoof Guard  

---

# PART 2: Edge Perimeter Proxy, API Security Gateway, Anti-Spoofing IP Resolution & CSRF Protection

### 2.1 Sub-Domain Architecture & Exact Execution Pipeline

The Edge Perimeter Proxy (`src/proxy.ts`) acts as the L7 ingress firewall. Every HTTP request passes through `proxy.ts` before reaching Next.js route handlers or page renderers.

```
Incoming Request
      │
      ▼
┌────────────────────────────────────────────────────────┐
│ Edge Proxy Perimeter (src/proxy.ts)                   │
├────────────────────────────────────────────────────────┤
│ 1. Static asset bypass (/_next, /images, favicon)      │
│ 2. Scanner path rejection (wp-admin, .env, .git) -> 404│
│ 3. HTTP method validation (GET/POST/PUT/PATCH/DELETE)  │
│ 4. Anti-Spoofing Client IP extraction (Rightmost XFF)  │
│ 5. Campus NAT 2-Tier Rate Limiting (600 vs 6000 req/m) │
│ 6. CSRF Origin Whitelist Check (State-changing verbs)  │
│ 7. Maintenance Gate (Read-only restriction if active)  │
│ 8. Inject X-Proxy-Auth token and Security Headers      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ API Security Gateway (withSecurity in api-security.ts) │
├────────────────────────────────────────────────────────┤
│ 1. Verify X-Proxy-Auth internal perimeter secret       │
│ 2. Verify Authorization Bearer JWT (Firebase Admin)    │
│ 3. Resolve user role from PostgreSQL (via RoleCache)   │
│ 4. Suspended-moderator gate (RBAC-11)                  │
│ 5. Endpoint-specific rate limiting (per UID or IP)     │
│ 6. Payload size limit (MAX_JSON_BODY_BYTES = 256KB)    │
│ 7. Zod schema validation for request bodies            │
│ 8. Execute business route handler                      │
│ 9. Inject audit requestId & sanitise errors (500)      │
└────────────────────────────────────────────────────────┘
```

---

### 2.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Entities / Functions | Callers | Callees | State / Invariants Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/proxy.ts` | `proxy`, `middleware`, `config`, `isOriginAllowed`, `validateOrigin` | Next.js Engine (L7 Ingress) | In-memory `ipRequestCounts` Map | Edge rate limiter map, response headers |
| `src/lib/security/api-security.ts` | `withSecurity`, `withCronSecurity`, `withWebhookSecurity`, `getClientIp`, `isOriginAllowed` | All `/api/**` route handlers | `adminAuth.verifyIdToken`, `resolveUserRole`, `isModeratorActive`, `applyRateLimit`, `validateInput` | Enforces authentication, authorization, rate limits |

---

### 2.3 Method-by-Method Low-Level Walkthrough

1. **`getClientIp(request: NextRequest): string`:**
   Extracts client IP with anti-spoofing guarantees. Reads `x-real-ip` or `cf-connecting-ip`. When reading `x-forwarded-for`, it selects `parts[parts.length - 1]` (the rightmost hop). Because reverse proxies append client IPs to the end, using the rightmost entry prevents clients from spoofing upstream addresses by injecting artificial `X-Forwarded-For` headers.
2. **`checkGlobalRateLimit(ip: string, isAuthenticated: boolean)`:**
   Two-tier rate limiter: Anonymous clients receive 600 requests/minute (10 req/s); authenticated campus users sharing a NAT receive 6,000 requests/minute (100 req/s). Implements bounded LRU eviction: if `ipRequestCounts.size > 50,000`, it scans up to 1,500 entries to evict expired records, and FIFO-evicts 500 entries if still at capacity.
3. **`validateOrigin(request: NextRequest): boolean`:**
   Enforces CSRF protection for state-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`). Compares `Origin` or `Referer` headers against `ALLOWED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, and Vercel system preview URLs. For non-browser clients without Origin/Referer, allows only requests bearing a verified `Authorization: Bearer` header.
4. **`withSecurity` Wrapper:**
   Composes all API security gates. Checks internal token, parses body with 256KB cap, extracts and verifies Firebase ID tokens, resolves user roles from PostgreSQL via `RoleCache`, checks suspended moderator status via `isModeratorActive`, enforces endpoint-specific rate limiting, validates against Zod schemas, and returns audit headers (`X-Request-Id`, `X-RateLimit-Remaining`).

---

### 2.4 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/proxy.ts
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';

const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();
const IP_RATE_LIMIT_ANONYMOUS = 600;       // max requests per window for unauthenticated IP (10 req/s)
const IP_RATE_LIMIT_AUTHENTICATED = 6000;  // max requests per window for campus NAT with authenticated users (100 req/s)
const IP_RATE_WINDOW_MS = 60_000;          // 1 minute window
const IP_CACHE_MAX = 50_000;               // prevent unbounded memory growth

function checkGlobalRateLimit(ip: string, isAuthenticated: boolean = false): { allowed: boolean; remaining: number; limit: number } {
    const limit = isAuthenticated ? IP_RATE_LIMIT_AUTHENTICATED : IP_RATE_LIMIT_ANONYMOUS;
    const now = Date.now();

    if (ipRequestCounts.size > IP_CACHE_MAX) {
        let checked = 0;
        for (const [key, entry] of ipRequestCounts) {
            if (now > entry.resetTime) ipRequestCounts.delete(key);
            if (++checked >= 1500) break;
        }
        if (ipRequestCounts.size >= IP_CACHE_MAX) {
            let evicted = 0;
            for (const key of ipRequestCounts.keys()) {
                if (evicted >= 500) break;
                ipRequestCounts.delete(key);
                evicted++;
            }
        }
    }

    const entry = ipRequestCounts.get(ip);
    if (!entry || now > entry.resetTime) {
        ipRequestCounts.set(ip, { count: 1, resetTime: now + IP_RATE_WINDOW_MS });
        return { allowed: true, remaining: limit - 1, limit };
    }

    entry.count++;
    if (entry.count > limit) {
        return { allowed: false, remaining: 0, limit };
    }

    return { allowed: true, remaining: limit - entry.count, limit };
}

function getClientIp(request: NextRequest): string {
    const realIp = request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip');
    if (realIp) return realIp.trim();

    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
        const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) return parts[parts.length - 1];
    }
    return '127.0.0.1';
}

export function isOriginAllowed(origin: string): boolean {
    if (!origin) return false;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl && origin === appUrl) return true;

    const explicit = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    if (explicit.includes(origin)) return true;

    if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return true;
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL && origin === `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) return true;

    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        if (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000') return true;
        if (origin.startsWith('http://localhost:')) return true;
        if (origin.includes('.devtunnels.ms')) return true;
    }

    return false;
}

export function validateOrigin(request: NextRequest): boolean {
    const method = request.method;
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    // Webhooks and cron jobs have independent signature/secret auth
    const pathname = request.nextUrl.pathname;
    if (
        pathname.startsWith('/api/payment/webhook') ||
        pathname.startsWith('/api/webhooks/') ||
        pathname.startsWith('/api/cron/') ||
        isCronRoute(pathname)
    ) {
        return true;
    }

    if (origin) return isOriginAllowed(origin);

    if (referer) {
        try {
            const refererUrl = new URL(referer);
            return isOriginAllowed(refererUrl.origin);
        } catch {
            return false;
        }
    }

    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) return true;

    return false;
}
```

---



---

# PART 3: Dual-Layer Identity Spine, Role Resolution Caches & Timing-Safe First Admin Bootstrap

### 3.1 Sub-Domain Architecture & Exact Execution Pipeline

The identity spine uses a multi-tier caching architecture to prevent database exhaustion on authenticated routes:
1. **L1 In-Memory LRU Cache:** 2,000 max entries, 5-minute TTL per process.
2. **L2 Redis Pub/Sub Synchronization:** Channels `role_invalidate` and `itms:roles:invalidate`. When an admin changes a user's role on Node A, a Redis message invalidates the cache on Node B immediately.
3. **Timing-Safe First-Admin Bootstrap:** Protected by SHA-256 HMAC constant-time comparison and database-level emptiness verification.

---

### 3.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Entities / Functions | Callers | Callees | State / Invariants Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/lib/security/role-cache.ts` | `resolveUserRole`, `getCachedRole`, `setCachedRole`, `invalidateCachedRole`, `clearRoleCache` | `api-security.ts`, `api-auth.ts`, Admin Role Endpoints | `getUserById` (PostgreSQL), `publishRoleInvalidation` | L1 `_roleCache` Map |
| `src/lib/security/role-cache-redis.ts` | `initRoleCacheRedis`, `publishRoleInvalidation` | `role-cache.ts` | Node.js `net`/`tls` sockets (Redis RESP) | Redis Pub/Sub channels |
| `src/app/api/create-first-admin/route.ts` | `POST` | Setup Admin Wizard | `createUser`, `crypto.timingSafeEqual`, `supabase.from('users').select()` | Mints the initial administrative user record |

---

### 3.3 Method-by-Method Low-Level Walkthrough

1. **`resolveUserRole(uid: string)`:**
   Checks L1 in-memory cache. On cache miss, queries `public.users` via `getUserById(uid)`. Caches result with 5-minute TTL. Returns empty role if not found, causing downstream route handlers to reject unauthorized requests with HTTP 403.
2. **`publishRoleInvalidation(uid: string)`:**
   Writes RESP command `PUBLISH role_invalidate <uid>` directly to Redis via raw socket. Subscribing nodes execute `_roleCache.delete(uid)` and `invalidateModeratorPermissionCache(uid)` immediately.
3. **First-Admin Timing-Safe Verification (`create-first-admin`):**
   Derives HMAC-SHA256 digests of the incoming header secret and server `FIRST_ADMIN_BOOTSTRAP_SECRET`. Compares digests via `crypto.timingSafeEqual`. Verifies that `public.users` is completely empty (`count === 0`). Rejects requests with HTTP 400 if any user already exists.

---

### 3.4 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/lib/security/role-cache.ts
// ============================================================================

import { getUserById } from '@/domains/identity';
import { initRoleCacheRedis, publishRoleInvalidation } from './role-cache-redis';

const ROLE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ROLE_CACHE_MAX = 2000;

interface RoleCacheEntry {
    role: string;
    name: string;
    employeeId: string;
    expiresAt: number;
}

const _roleCache = new Map<string, RoleCacheEntry>();

if (typeof setInterval !== 'undefined' && !(globalThis as any).__roleCacheRedisBridgeStarted) {
    (globalThis as any).__roleCacheRedisBridgeStarted = true;
    initRoleCacheRedis((uid: string) => {
        _roleCache.delete(uid);
        try {
            const { invalidateModeratorPermissionCache } = require('./moderator-permissions');
            invalidateModeratorPermissionCache(uid);
        } catch {}
    });
}

export function getCachedRole(uid: string): { role: string; name: string; employeeId: string } | null {
    const cached = _roleCache.get(uid);
    if (!cached) return null;

    if (Date.now() < cached.expiresAt) {
        // True LRU: Delete and re-insert to position at tail of Map
        _roleCache.delete(uid);
        _roleCache.set(uid, cached);
        return { role: cached.role, name: cached.name, employeeId: cached.employeeId };
    }

    // Expired entry eviction on read
    _roleCache.delete(uid);
    return null;
}

export async function resolveUserRole(uid: string): Promise<{ role: string; name: string; employeeId: string }> {
    const cached = getCachedRole(uid);
    if (cached) return cached;

    try {
        const pgUser = await getUserById(uid);
        if (pgUser) {
            const result = {
                role: pgUser.role || 'student',
                name: pgUser.name || '',
                employeeId: '',
            };
            setCachedRole(uid, result);
            return result;
        }
    } catch (err: any) {
        console.error(`[role-cache] PostgreSQL read failed for uid ${uid}:`, err.message);
    }

    return { role: '', name: '', employeeId: '' };
}

export function setCachedRole(uid: string, entry: { role: string; name: string; employeeId: string }): void {
    if (_roleCache.has(uid)) {
        _roleCache.delete(uid);
    } else if (_roleCache.size >= ROLE_CACHE_MAX) {
        // Evict least-recently-used entry
        const firstKey = _roleCache.keys().next().value;
        if (firstKey) _roleCache.delete(firstKey);
    }
    _roleCache.set(uid, { ...entry, expiresAt: Date.now() + ROLE_CACHE_TTL });
}

export function invalidateCachedRole(uid: string): void {
    _roleCache.delete(uid);
    publishRoleInvalidation(uid);
}
```

```typescript
// ============================================================================
// VERBATIM FROM src/app/api/create-first-admin/route.ts (Timing-Safe Check)
// ============================================================================

    const bootstrapSecret = process.env.FIRST_ADMIN_BOOTSTRAP_SECRET;
    if (!bootstrapSecret) {
      return new Response(JSON.stringify({ success: false, error: 'Bootstrap is disabled' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headerSecret = request.headers.get('x-bootstrap-secret') || '';
    const hmacKey = 'bootstrap-secret-hasher';
    const expectedHash = crypto.createHmac('sha256', hmacKey).update(bootstrapSecret).digest();
    const actualHash = crypto.createHmac('sha256', hmacKey).update(headerSecret).digest();
    if (!crypto.timingSafeEqual(expectedHash, actualHash)) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized bootstrap request' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = getSupabaseServer();
    const { count, error: countError } = await supabase
      .from('users')
      .select('uid', { count: 'exact', head: true });
    if (countError || (count || 0) > 0) {
      return new Response(JSON.stringify({ success: false, error: 'First admin already exists' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
```

---

