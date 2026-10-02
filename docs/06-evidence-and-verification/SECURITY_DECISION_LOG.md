# ADTU ITMS — Security Decision & Architecture Log
**Date:** 2026-09-16  
**Status:** ACTIVE & ENFORCED  
**Authority:** Master Security Governance Charter  

---

## 1. Executive Summary
This document records the architectural security decisions, threat models, and explicit invariant policies enforced across the ADTU Intelligent Transport Management System (ITMS). Every decision aligns with the principle of least privilege, fail-closed defaults, cryptographic integrity, and multi-instance concurrency safety.

---

## 2. Formal Security Decisions

### SEC-DEC-01: Standardized Authorization Header Token Extraction (AUTH-01)
- **Problem:** Ad-hoc token extraction such as `.split('Bearer ')[1]` was fragile against unexpected spaces, missing prefixes, or malformed strings, leading to unhandled runtime errors or unneeded downstream verification calls.
- **Decision:** Enforce standardized Bearer token extraction across all API routes:
  1. Header must start with `Bearer ` (case-sensitive prefix).
  2. Extracted token is trimmed using `.slice(7).trim()`.
  3. Token length must be at least 10 characters before being passed to Firebase Admin Auth.
  4. Malformed tokens are rejected immediately with HTTP 401 and generic error classification `AUTH_TOKEN_INVALID`.

### SEC-DEC-02: Device Session Exclusive Control Fail-Closed Policy (AUTH-02)
- **Problem:** `checkDeviceSession` previously returned `{ isCurrentDevice: true, hasActiveSession: false }` on network failure or unexpected exceptions, allowing potential session hijacking or concurrent driver device abuse during infrastructure degradation.
- **Decision:** Enforce a strict **fail-closed** default (`failClosed: true`):
  - On network timeout, HTTP non-200, or malformed non-JSON responses from the session API, the service returns `{ isCurrentDevice: false, hasActiveSession: true, serviceUnavailable: true }`.
  - Sensitive operations (driver trip start, student ticket scanning) deny access until single-device authority can be proven.
  - Distinct `serviceUnavailable` telemetry is emitted to alert operations without compromising security boundaries.

### SEC-DEC-03: Elimination of WebSocket URL Query Token Authentication (AUTH-03 / SEC-04)
- **Problem:** Accepting Firebase JWT tokens via query parameters (`/?token=<JWT>`) exposed sensitive credentials in NGINX access logs, proxy logs, browser history, devtools, and Referer headers.
- **Decision:** Completely disabled Path A (URL query tokens) across all WebSocket environments.
  - WebSocket clients must authenticate via:
    1. HTTP `Authorization: Bearer <JWT>` handshake headers (for programmatic/server connections).
    2. WebSocket First-Message `auth` payload (Path B) sent immediately upon connection upgrade with a strict 5-second timeout.
  - Any connection attempting `/?token=...` receives an immediate authentication failure.

### SEC-DEC-04: Hardening Bootstrap Account Creation (AUTH-04 / AUTH-15 / AUTH-16)
- **Problem:** `/api/create-first-admin` was vulnerable to brute-force attacks against `BOOTSTRAP_ADMIN_SECRET`, lacked constant-time comparison (leaking secret length via timing oracles), and proceeded even when database count queries failed.
- **Decision:**
  1. Rate-limited to 5 requests per 10-minute window per IP.
  2. Constant-time comparison using HMAC-SHA256 digests (`crypto.timingSafeEqual`) ensures uniform comparison time independent of input length or content.
  3. Fail-closed database check: if `supabase.from('users').select('*', { count: 'exact', head: true })` returns an error, the endpoint halts immediately with HTTP 500 (`DATABASE_UNAVAILABLE`) and refuses to create any account.

### SEC-DEC-05: Alertmanager Webhook Fail-Closed Configuration (AUTH-05)
- **Problem:** `/api/admin/alerts` previously accepted unauthenticated webhook payloads if `AM_WEBHOOK_SECRET` was unconfigured in production.
- **Decision:** Fail closed in production.
  - If `process.env.NODE_ENV === 'production'` and `AM_WEBHOOK_SECRET` is unset, all incoming webhook requests are rejected with HTTP 500 and an alert event is logged.
  - Validation uses timing-safe HMAC comparison (`crypto.timingSafeEqual`).

### SEC-DEC-06: WebSocket Privileged Server Token Hardening (AUTH-06 / SEC-07)
- **Problem:** WebSocket server fallback in non-production defaulted to a well-known static token string (`'__server__'`), posing an authorization bypass risk if development configurations leaked into staging or container images.
- **Decision:**
  - In production: Strict startup environment validation halts process launch if `WS_PRIVILEGED_TOKEN` is unset or shorter than 32 characters.
  - In non-production: Automatically generates an ephemeral, cryptographically secure 32-byte random hex token (`crypto.randomBytes(32).toString('hex')`) in memory at process startup. Hardcoded tokens are completely banned.

### SEC-DEC-07: Strict CSRF & Origin Allowlisting (SEC-01 / SEC-02 / SEC-03)
- **Problem:** Origin checking in `src/proxy.ts` accepted any origin ending with `.vercel.app` (wildcard match), allowing malicious actors on free Vercel subdomains to forge authenticated browser requests. Furthermore, requests lacking Origin and Referer headers passed checks by default.
- **Decision:**
  1. Wildcard `.vercel.app` matching is eliminated. Only exact canonical domains (`adtu-bus.vercel.app`, `adtu-bus-xq.vercel.app`, or explicitly configured `VERCEL_PROJECT_PRODUCTION_URL` / `ALLOWED_ORIGINS`) are accepted.
  2. For state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`), if neither `Origin` nor `Referer` is present, the request is rejected unless it carries an explicit `Authorization: Bearer <token>` or `x-internal-token` header (permitting trusted API/mobile clients while blocking unauthenticated ambient browser CSRF).

### SEC-DEC-08: Cross-Instance WebSocket Role Cache Invalidation (SEC-09 / AUTH-WS-01)
- **Problem:** The standalone WebSocket server cached user authentication and role resolution in an in-memory Map for 90 seconds. If an admin demoted a user in the Next.js web application, the WebSocket server continued to grant privileged access for up to 90 seconds.
- **Decision:**
  - The WebSocket server subscribes to the Redis `role_invalidate` pub/sub channel upon startup.
  - Whenever an administrator modifies user permissions, roles, or blocks an account, Next.js publishes the user UID to `role_invalidate`.
  - All WebSocket worker nodes receive the message and instantly purge matching entries from their local `tokenAuthCache`.

### SEC-DEC-09: Explicit Moderator Scanner Authorization (NEW-04)
- **Problem:** Scanner permission validation used `permissions?.students?.canView !== false`, which inadvertently evaluated to `true` if `canView` was `undefined` or omitted from the moderator profile.
- **Decision:** Enforce strict equality: `permissions?.students?.canView === true`. If the permission is missing, null, or undefined, access is denied with HTTP 403.

### SEC-DEC-10: 128-bit Cryptographic Signatures for QR & Payment Tokens (NEW-06 / NEW-07)
- **Problem:** Bus pass QR codes used an 8-byte (64-bit) HMAC truncation, and payment references used a 16-hex-character (64-bit) truncation.
- **Decision:**
  - Upgraded QR token format to Version 2 (`v2:` prefix) containing a 16-byte (128-bit) HMAC-SHA256 signature, providing $2^{128}$ collision resistance against forgery.
  - Backward compatibility: Version 1 (`v1:`) tokens are still accepted during the transition period with 8-byte HMAC verification until existing passes expire.
  - Payment references upgraded to 32 hex characters (128-bit HMAC), with dual-verification supporting legacy 16-character references.

### SEC-DEC-11: Multi-Instance GPS Redis Guard Fail-Closed Policy (Section 12)
- **Problem:** `gps-redis-guard.ts` previously fell back to process-local `memLast` if Redis was unavailable or timed out. In a multi-pod cluster, independent pods would have disjoint local caches, permitting out-of-order GPS packets and impossible spatial jumps across pod boundaries.
- **Decision:**
  - In production (`process.env.NODE_ENV === 'production'`) with Redis configured, if the Redis cluster is unreachable or errors, `atomicGpsGuardAndUpdate` returns `'redis_unavailable'` (fails closed).
  - The GPS pipeline rejects the incoming packet with `ErrorClass.DATABASE_UNAVAILABLE` and alerts SRE.
  - Single-instance local fallback is strictly restricted to development environments or when explicitly opted in via `ALLOW_INSECURE_LOCAL_GPS_FALLBACK=true`.

### SEC-DEC-12: Forensic Investigation of Alleged `.env.docker` Secrets (SEC-11)
- **Problem:** An external audit report asserted that `.env.docker` containing production secrets was committed into the Git repository.
- **Decision & Proof:**
  - Forensic search performed across complete Git commit history: `git log --all --full-history -- ".env.docker"`.
  - Result: 0 commits found. The file was never tracked or committed to Git.
  - Finding classified as **FALSE POSITIVE / STALE FINDING**.
