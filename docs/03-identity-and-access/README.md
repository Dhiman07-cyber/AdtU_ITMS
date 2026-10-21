# Domain 03: Identity, Access Control & Device Session Security

================================================================================
EXECUTIVE SUMMARY & SYSTEM TOPOLOGY
================================================================================

The **Identity & Access Domain** manages authentication, role resolution, granular permissions, device session concurrency, and boarding verification security across Assam down town University (ADTU ITMS).
- Multi-role authorization spanning 5 roles (`student`, `driver`, `moderator`, `admin`, `superadmin`).
- Hybrid identity federation: Firebase Auth (OAuth2, JWT issuance, token revocation) + Supabase PostgreSQL 16 (authoritative role store, profile schemas, RLS).
- Next.js 16 Edge Proxy ([`src/proxy.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/proxy.ts)) enforcing CSRF origin checking, global rate limiting, and bot mitigation.
- Role cache with multi-tier invalidation ([`src/lib/security/role-cache.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/security/role-cache.ts)) preventing database query storms on high-frequency requests.
- Single-device operator enforcement ([`src/lib/services/device-session-cache.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/services/device-session-cache.ts)) preventing multiple phones driving under the same identity.
- Fast, zero-DB warm path QR scanner authentication ([`src/lib/security/scanner-auth.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/security/scanner-auth.ts)) with 15s L1 cache and driver active-trip binding.
- Granular moderator permissions engine ([`src/lib/security/moderator-permissions.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/security/moderator-permissions.ts)) with least-privilege bitmasks.

```
                  [ CLIENT WEB / MOBILE APP ]
                               │
               1. Firebase ID Token (Bearer JWT)
                               │
                               ▼
               ┌───────────────────────────────┐
               │    NEXT.JS 16 EDGE PROXY      │
               │         (src/proxy.ts)        │
               │ - CSRF / Origin Gate          │
               │ - IP Rate Limiter             │
               └───────────────┬───────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │   API SECURITY & AUTH GATE    │
               │   - verifyApiAuth()           │
               │   - withSecurity() wrapper    │
               └───────┬───────────────┬───────┘
                       │               │
       2. Cache Lookup │               │ 3. Fresh Lookup on Miss
          (Memory/Redis│               │    (Indexed SQL Query)
                       ▼               ▼
           ┌───────────────────┐   ┌───────────────────────────┐
           │   ROLE CACHE      │   │   SUPABASE POSTGRESQL     │
           │ - 5m TTL L1/Redis │   │ - public.users (role)     │
           │ - Invalidate Hook │   │ - public.student_profiles │
           └───────────────────┘   │ - public.driver_profiles  │
                                   │ - public.device_sessions  │
                                   │ - public.moderator_perms  │
                                   └───────────────────────────┘
```

---

## 1. Domain State Taxonomy & Invariants

| State Classification | Storage Engine | Concrete Entities | Retention / Eviction Policy | Invariant Enforced |
| :--- | :--- | :--- | :--- | :--- |
| **Durable Authoritative** | PostgreSQL 16 | `public.users`, `public.student_profiles`, `public.driver_profiles`, `public.moderator_profiles` | Permanent record; RLS enforced on every table. | Role immutability without admin authorization; single role per UID. |
| **Transactional State** | PostgreSQL 16 | User deletion cascade (`delete_student_cascade_v1`), profile creation | ACID boundary. | Cascade deletes linked profiles, sessions, and waiting flags safely. |
| **Audit History** | PostgreSQL 16 | `public.audit_events` | Append-only immutable table. | Logs every role elevation, profile modification, and admin intervention. |
| **Ephemeral State** | PostgreSQL & Memory | `public.device_sessions`, `deviceSessionCache` | 10-minute TTL; heartbeated; reaped on stale connection. | `INV-AUTH-001`: Single active device session per operating driver. |
| **Process-Local L1 Cache** | Node.js Memory | `scannerBusCache`, `roleMemoryCache`, `moderatorPermsCache` | 15s to 300s TTL; instant flush on trip start/end or permission update. | Zero-DB-read hot boarding scan path ($<5$ms response time). |

---

## 2. Low-Level Component Architecture

### 2.1 Edge & Security Ingress (`src/proxy.ts`, `src/lib/security/`)
- **`proxy.ts`**: Intercepts all inbound requests, verifies `Origin` and `Host` headers against trusted domain allowlists, applies IP-based rate limiting, and attaches security headers (CSP, HSTS, X-Content-Type-Options).
- **`api-auth.ts` / `api-security.ts`**: Standardized authentication middleware providing `verifyApiAuth(req, requiredRoles)` and `withSecurity({ auth, body, rateLimit })`. Rejects missing, expired, or tampered tokens with HTTP 401/403.
- **`role-cache.ts`**: Two-tiered cache (L1 process memory + Redis) caching `uid -> role` mappings for 5 minutes. Employs `invalidateCachedRole(uid)` on profile edits and deletions.

### 2.2 QR Scanner Auth & Driver Exclusivity (`src/lib/security/scanner-auth.ts`, `device-session-cache.ts`)
- **`scanner-auth.ts`**:
  - Resolves driver operating context: binds driver to their currently active vehicle via `active_trips`.
  - Caches vehicle assignment for 15 seconds in `scannerBusCache` to absorb burst scans when 50+ students board at a stop.
  - Automatically invalidated on trip start/end via `invalidateScannerBusCache(driverId)`.
  - Fallback mechanism for administrative desk verification (allowing manual boarding review).
- **`device-session-cache.ts`**:
  - Validates driver's device fingerprint against `public.device_sessions`.
  - Blocks concurrent logins from different phones; new login forces prior session revocation.

### 2.3 Moderator Fine-Grained RBAC (`src/lib/security/moderator-permissions.ts`)
- Implements least-privilege access masks across 6 operational modules: `applications`, `students`, `buses`, `routes`, `drivers`, and `notifications`.
- Caches permissions with 60-second TTL and immediate eviction on administrative update.

---

## 3. Detailed Document Roadmap

1. [**01-auth-architecture.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/01-auth-architecture.md)
   - Edge perimeter proxy (`proxy.ts`), anti-spoofing IP resolution, CSRF protection, dual identity spine, role resolution caches, and timing-safe first admin bootstrap.
2. [**02-role-permissions-matrix.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/02-role-permissions-matrix.md)
   - Granular 6-category moderator RBAC matrix, 60s LRU cache, instant session eviction (`4401`), and university audit log system.
3. [**03-scanner-auth-and-device-sessions.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/03-scanner-auth-and-device-sessions.md)
   - Digital student boarding pass lifecycle, 128-bit rotating QR tokens, single-device driver lock, and 4-gate scanner verification.
4. [**04-moderator-permissions-and-cleanup.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/04-moderator-permissions-and-cleanup.md)
   - Fleet, route & driver CRUD operations, in-flight trip mutation rejection triggers, driver phone verification, and cascading cleanup.
5. [**05-operational-relief-pool-and-conductor.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/05-operational-relief-pool-and-conductor.md)
   - Operational relief pool for reserve drivers, emergency substitute rostering, and dynamic conductor QR check-in architecture.
6. [**06-notifications-and-anti-idor.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/06-notifications-and-anti-idor.md)
   - Push notifications, SMS/WhatsApp emergency alerts, in-app notifications, and anti-IDOR security protocol (`INV-NOTIF-001`).
7. [**07-database-schema-and-rls-reference.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/07-database-schema-and-rls-reference.md)
   - Relational tables, foreign keys, check constraints, Row-Level Security (RLS) policies, and administrative stored procedures.
8. [**08-verification-suite-and-production-gates.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/08-verification-suite-and-production-gates.md)
   - Complete verification suite, chaos tests for device session contention and token forgery, and 4 production gate certifications.
9. [**IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md)
   - Consolidated master reference (scheduled for archival after child file transition verification).

---

## 4. Key Production Verification Gates

- **TypeScript 5.x**: Strictly typed role unions (`'student' | 'driver' | 'moderator' | 'admin' | 'superadmin'`).
- **ESLint Clean**: Zero unused variables, secure headers, no raw SQL or unsanitized JWT parsing.
- **Vitest Suite**: Concurrency and multi-device contention verified in `identity-rbac-scanner-chaos.test.ts`.
