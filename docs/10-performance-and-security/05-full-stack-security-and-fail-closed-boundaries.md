# ADTU ITMS — Full-Stack Security & Fail-Closed Boundaries

**Document ID:** `ITMS-SEC-FULL-STACK-2026-V2`  
**Standard:** OWASP Application Security Verification Standard (ASVS 5.0.0 Level 2/3)  
**Authority:** Master Security Governance & Cryptographic Integrity Charter  
**Status:** FULLY HARDENED, AUDITED & CLOSED (0 Unaddressed Vulnerabilities)  

---

## 1. Executive Summary: The Defense-in-Depth Model

Security in the **Assam down town University Intelligent Transport Management System (ADTU ITMS)** is founded on the principle of **defense-in-depth** and **fail-closed defaults**. 

In high-concurrency transit platforms, an attacker might attempt:
- Spoofing GPS telematics to falsely claim bus arrival or bypass stop dwell audits.
- Hijacking a driver session to start fraudulent trips.
- Forging digital bus passes using truncated QR codes.
- Exploiting cross-origin CSRF holes on administrative endpoints.
- Starving WebSocket server memory using unauthenticated slow consumers.

Every operational layer enforces independent security perimeters:

```text
                               DEFENSE-IN-DEPTH SECURITY PERIMETERS
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │ LAYER 1: EDGE & NETWORK PERIMETER                                                      │
 │ • NGINX X-Real-IP Anti-Spoofing | Exact Host CSRF Matching | Security Headers (HSTS)   │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ LAYER 2: IDENTITY & SESSION GOVERNANCE                                                 │
 │ • Standardized Bearer Tokens | Anti-IDOR Ownership | Fail-Closed Device Sessions       │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ LAYER 3: REALTIME WEBSOCKET TRANSPORT                                                  │
 │ • First-Message Auth (URL Tokens Banned) | Redis Role Eviction (4401) | Backpressure    │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ LAYER 4: SPATIAL TELEMATICS & GPS INGRESS                                              │
 │ • Fail-Closed Redis Ingress | Lua Timestamp Monotonicity | 120 km/h Bounding Box Guard  │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ LAYER 5: CRYPTOGRAPHIC INTEGRITY                                                       │
 │ • 128-Bit HMAC-SHA256 Bus Pass QR (v2:) | Timing-Safe Comparisons (timingSafeEqual)   │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ LAYER 6: DATABASE ENGINE & RLS PERIMETER                                               │
 │ • PostgreSQL 16 RLS | SECURITY DEFINER (search_path = public) | Row Locks (FOR UPDATE) │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer 1: Edge & Network Perimeter Security

### A. Anti-Spoofing Client IP Resolution (`INV-AUTH-006`)
* **Threat Model:** Malicious clients forging `X-Forwarded-For: 127.0.0.1` headers to bypass rate limits or evade administrative IP audit trails.
* **Enforcement:**
  - NGINX (`nginx/nginx.conf`) unconditionally overwrites `X-Real-IP: $remote_addr`.
  - Application layer (`src/lib/security/api-security.ts` and `src/proxy.ts`) evaluates `X-Real-IP` first.
  - If reaching through multi-hop proxies, the application extracts strictly the **rightmost trusted hop** of `X-Forwarded-For`.
  - Client-controlled header prefixes cannot tamper with the trusted client address.

### B. Strict CSRF & Origin Allowlisting (`INV-AUTH-005` / `SEC-DEC-07`)
* **Threat Model:** Malicious third-party websites forging authenticated state-changing requests (`POST`, `PUT`, `DELETE`) via ambient browser credentials.
* **Vulnerability Eliminated:** Wildcard `.vercel.app` matching was permanently removed.
* **Enforcement Mechanics (`src/proxy.ts`):**
  1. Requests must supply an `Origin` or `Referer` matching canonical allowlisted domains (`adtu-bus.vercel.app`, `adtu-bus-xq.vercel.app`, or `localhost:3000`).
  2. State-changing requests lacking both `Origin` and `Referer` are strictly rejected unless accompanied by an explicit `Authorization: Bearer <token>` header (accommodating mobile apps and server workers while blocking ambient browser CSRF).

### C. Security Headers Baseline
* Configured in `next.config.ts`:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy`: Restricts scripts, fonts, and API connections; explicitly permits MapLibre Web Workers via `worker-src 'self' blob:`.

---

## 3. Layer 2: Identity & Session Governance

### A. Standardized Authorization Header Token Extraction (`SEC-DEC-01`)
* Header must match `Bearer <token>` (case-sensitive).
* Token extracted using `.slice(7).trim()` with minimum 10-character length check before calling Firebase Admin Auth.
* Malformed or absent tokens terminate execution immediately with HTTP 401 (`AUTH_TOKEN_INVALID`).

### B. Horizontal Ownership Verification (Anti-IDOR) (`INV-AUTH-002`)
* Because backend server routes use Supabase `service_role` (which intentionally bypasses Postgres RLS for operational queries), application routes must explicitly verify horizontal ownership:
  ```typescript
  if (auth.role !== 'admin' && auth.role !== 'moderator' && auth.uid !== targetUid) {
    throw new ForbiddenError('Unauthorized attempt to read or mutate foreign user data');
  }
  ```
* Enforced across student profiles, renewal applications, payment records, and device sessions.

### C. Fail-Closed Device Session Exclusivity (`INV-AUTH-004` / `SEC-DEC-02`)
* Drivers are permitted **exactly one active hardware device** for trip management and GPS submission.
* **Fail-Closed Default:** If the `device_sessions` database query fails or times out during network degradation, the service returns `{ isCurrentDevice: false, hasActiveSession: true, serviceUnavailable: true }`.
* Sensitive trip controls halt immediately with HTTP 503 rather than failing open.

---

## 4. Layer 3: Real-Time WebSocket Transport Security

### A. Elimination of URL Query Token Authentication (`INV-WS-002` / `SEC-DEC-03`)
* **Vulnerability Eliminated:** Accepting JWT tokens via `/?token=<JWT>` in URL query strings leaked credentials into NGINX access logs, browser history, and proxy logs.
* **Enforcement:** In production (`NODE_ENV === 'production'`), any connection attempt carrying `?token=` in the URL query is instantly terminated with close code `4001`.
* **Pure First-Message Handshake:** Client must send `{ type: "auth", token: "..." }` within 5,000ms over the encrypted WebSocket stream. Failure to authenticate within 5s closes the socket (`code: 4001`).

### B. Multi-Node Active Session Eviction on Role Demotion (`INV-WS-003` / `SEC-DEC-08`)
* When an administrator revokes a moderator or driver role in the web portal, Next.js publishes the user UID to Redis channel `role_invalidate`.
* Every running WebSocket node receives the event, clears its local `tokenAuthCache`, locates matching active sockets via `sessionManager.getByUid(uid)`, and terminates them immediately with **close code `4401` (`Role revoked`)**.

### C. Slow Consumer Backpressure Isolation (`INV-WS-005`)
* Mobile devices on 2G connections can throttle TCP acknowledgments, causing server memory buffers to grow unboundedly.
* The WebSocket server monitors `ws.bufferedAmount`. If buffers exceed **1,048,576 bytes (1 MB)**, non-critical GPS frames are dropped, or the connection is terminated with close code `1008`.

---

## 5. Layer 4: Spatial Telematics & GPS Ingress Security

### A. Fail-Closed GPS Ingress on Redis Outage (`INV-GPS-005` / `SEC-DEC-11`)
* In production, the GPS pipeline requires distributed coordination across server processes.
* If Redis disconnects or experiences a network partition, `atomicGpsGuardAndUpdate()` returns `'redis_unavailable'`.
* The ingestion API strictly rejects incoming packets with HTTP 503 (`DATABASE_UNAVAILABLE`).
* **Spatial Invariant Protected:** Prevents split-brain in-memory storage where two independent application pods broadcast conflicting bus locations to commuters.

### B. Monotonic Timestamp Ordering (`INV-GPS-002`)
* Packets with older or equal timestamps ($t_{\text{packet}} \le t_{\text{last}}$) are dropped atomically via Redis Lua scripting, preventing cellular jitter or out-of-order packet replays.

### C. Physical Feasibility & Regional Bounding Box Sanity (`INV-GPS-003`)
* Ingestion pipeline validates:
  - Velocity cap: Speed cannot exceed **120 km/h**.
  - Teleportation jump guard: Marker cannot jump >1.5 km within 5 seconds.
  - Regional Bounding Box: Latitude must fall between **25.0°N and 28.5°N**; Longitude must fall between **89.5°E and 96.5°E** (Assam / Northeast corridor).

---

## 6. Layer 5: Cryptographic Integrity

### A. 128-Bit Digital Bus Pass QR Signatures (`INV-CRYPTO-001` / `SEC-DEC-10`)
* **Upgraded from Legacy 64-Bit:** Historical passes used an 8-byte (64-bit) HMAC truncation vulnerable to birthday collision attacks.
* **Version 2 (`v2:`) QR Contract:**
  - Carries a full **16-byte (128-bit) HMAC-SHA256 signature** encoded in hex.
  - Provides $2^{128}$ collision resistance against ticket counterfeiting.
  - Verified offline by conductor scanners using shared secret keys.

### B. Constant-Time Comparisons (`crypto.timingSafeEqual`)
* Timing attacks measure microsecond differences in string comparison to deduce secret lengths and contents.
* Enforced across:
  - Bootstrap admin secret verification (`/api/create-first-admin`).
  - Alertmanager webhook secrets (`/api/admin/alerts`).
  - Razorpay payment signature verification (`/api/payment/razorpay/verify-payment`).

---

## 7. Layer 6: Database Engine & RLS Perimeter

### A. SECURITY DEFINER Isolation & Search Path Hardening (`INV-DB-003`)
* Malicious SQL injection in stored procedures frequently targets default search paths.
* Every PostgreSQL RPC explicitly specifies `SET search_path = public`:
  ```sql
  ALTER FUNCTION public.bus_increment_capacity(text, text, integer, boolean) SET search_path = public;
  ALTER FUNCTION public.reassign_students_atomically(text, text, text[], text) SET search_path = public;
  ALTER FUNCTION public.acquire_trip_lock(text, text, text) SET search_path = public;
  ALTER FUNCTION public.end_trip_atomically(text, text, text) SET search_path = public;
  ```

### B. Explicit Privilege Revocation Model
```sql
-- Revoke all execution rights from untrusted database roles
REVOKE ALL ON FUNCTION public.reassign_students_atomically(text, text, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_trip_lock(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_trip_atomically(text, text, text) FROM PUBLIC, anon, authenticated;

-- Grant execution permissions exclusively to trusted backend service_role
GRANT EXECUTE ON FUNCTION public.reassign_students_atomically(text, text, text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_trip_lock(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_trip_atomically(text, text, text) TO service_role;
```

### C. Immutable Financial Ledger Trigger (`protect_completed_payments`)
* Financial records in `payments` cannot be altered or deleted once marked `completed`.
* Enforced at the database engine level via an immutable `BEFORE UPDATE OR DELETE` PostgreSQL trigger.
