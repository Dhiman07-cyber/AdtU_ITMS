# Dual Identity & Authentication Architecture

## 1. Dual Auth Architecture: Firebase Auth + Supabase PostgreSQL

ITMS utilizes a hybrid identity and persistence model to decouple identity federation from relational authorization:

```
+----------------------------------------------------------------------------------------------------+
|                                    HYBRID IDENTITY ARCHITECTURE                                     |
+----------------------------------------------------------------------------------------------------+

         [ Client App / Browser ]
                    │
                    ├── 1. Firebase Google OAuth / Email Sign-In
                    ▼
         [ Firebase Auth Service ]
                    │
                    ├── 2. Issues ID Token (JWT)
                    ▼
         [ Client Application ]
                    │
                    ├── 3. Sends Bearer JWT in Authorization Header
                    ▼
         [ Next.js Edge Proxy (src/proxy.ts) ]
                    │
                    ├── 4. Rate Limiting, CSRF Origin Validation, Scanner Block
                    ▼
         [ API Route / Domain Handler ]
                    │
                    ├── 5. verifyIdToken() via Firebase Admin SDK
                    │      (Extracts UID: usr_...)
                    ▼
         [ Supabase PostgreSQL ]
                    │
                    ├── 6. SELECT role FROM users WHERE uid = 'usr_...'
                    │      (Resolves: 'student' | 'driver' | 'moderator' | 'admin')
                    ▼
         [ Profile Fetch & RBAC Authorization ]
         - student_profiles / driver_profiles / admin_profiles
```

### Why Dual Identity?
- **Firebase Auth**: Provides battle-tested identity management, Google OAuth integrations, password resets, session tokens, and phone OTP support without storing password hashes in the application database.
- **Supabase PostgreSQL**: Enforces ACID relational constraints, foreign keys, role assignment tables (`users`, `driver_profiles`, `student_profiles`), and Row-Level Security (RLS) policies.

---

## 2. Next.js 16 Edge Proxy (`src/proxy.ts`)

Per Next.js 16 conventions, the route-level ingress layer is implemented in [`src/proxy.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/proxy.ts) (formerly `middleware.ts`). It acts as a defensive shield before traffic touches route handlers:

```typescript
// src/proxy.ts
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const clientIp = getClientIp(request);

  // 1. Skip static assets
  if (isStaticFile(pathname)) return NextResponse.next();

  // 2. Immediate 404 for automated scanner probe patterns (.php, /wp-admin, .env)
  if (isBlockedPath(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  // 3. Global IP Rate Limiter (300 requests/minute per IP)
  const rateLimit = checkGlobalRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return jsonError('Too many requests', 429);
  }

  // 4. CSRF Validation for state-changing HTTP methods (POST, PUT, DELETE)
  if (!validateOrigin(request)) {
    return jsonError('Forbidden: Invalid request origin', 403);
  }

  // 5. Allow public routes (e.g., /login, /about, /api/health)
  if (isPublicRoute(pathname) || isPublicApiRoute(pathname)) {
    return NextResponse.next();
  }

  // 6. Non-public API authentication check
  if (pathname.startsWith('/api/')) {
    const hasAuth = request.headers.get('authorization') ||
                    request.cookies.get('__session')?.value;
    if (!hasAuth) {
      response.headers.set('X-Proxy-Auth', 'none');
    }
  }

  return response;
}
```

---

## 3. Server-Side Token Verification & Session Lifecycles

### Token Exchange (`src/lib/security/api-security.ts`)
Protected API endpoints are wrapped with the `withSecurity` higher-order function:
1. Extracts the Bearer token from the `Authorization: Bearer <token>` header.
2. Calls `getAuth().verifyIdToken(token, true)` (validating issuer, expiration, and revocation status).
3. Queries `users` in Supabase PostgreSQL by `uid` to resolve the current active role.
4. If the user's role does not match the route requirement, returns `403 Forbidden`.

```typescript
// Example Endpoint Guard
export const POST = withSecurity(
  async (request, { auth, body }) => {
    // auth.uid and auth.role are guaranteed verified
    const driverId = auth.uid;
    ...
  },
  { roles: ['driver'] } // Only verified drivers can execute
);
```
