# docs/10-performance-and-security: Full-Stack Performance & Security Architecture

**Module Status:** PRODUCTION FORENSIC AUDIT & ARCHITECTURAL BLUEPRINT  
**Target Environment:** Production / Multi-Node Staging / Hetzner CPX31 VPS  
**Platform Version:** Next.js 16.3.0 (Turbopack) | React 19.2.8 | PostgreSQL 16 | Node.js 26 | Redis 7  
**Standard:** Level 0 Global Production Engineering Rule & Level 1 ITMS Constitution  

---

## 1. Executive Summary

This directory provides the definitive, comprehensive forensic audit of **Performance, Rendering Topology, Component Weights, Caching Mechanisms, and Security Boundaries** across the entire **Assam down town University Intelligent Transport Management System (ADTU ITMS)**.

A mission-critical transit platform serving **2,000+ daily student commuters**, 25+ university buses, drivers, and administrative dispatchers cannot treat performance or security as afterthoughts. In transit telematics:
- A **1,000ms delay** in live GPS delivery causes students to miss morning pickups at Panikhaiti, Jalukbari, or Khanapara.
- An **unbounded client loading spinner** locks students out on weak 3G cellular connections along the Brahmaputra corridor.
- A **permissive wildcard CORS or CSRF check** opens student records and driver trip locks to cross-origin exploitation.
- A **redundant client bundle** drains commuter battery and slows initial interaction times.

This documentation evaluates the exact balance between **zero-waste runtime performance** and **uncompromising security invariants**, detailing which files use which rendering model, what every component consumes, what dead-weight can be eliminated or deferred without compromising consistency, how multi-tier caching operates, and how fail-closed security guarantees are enforced across every tier.

```text
                       ADTU ITMS PERFORMANCE & SECURITY DUAL PILLARS
 ┌───────────────────────────────────────────────────┬───────────────────────────────────────────────────┐
 │               PERFORMANCE ARCHITECTURE            │                SECURITY ARCHITECTURE              │
 ├───────────────────────────────────────────────────┼───────────────────────────────────────────────────┤
 │ • Server Component Root LCP (0.8s, ~70% faster)   │ • NGINX X-Real-IP Anti-Spoofing Perimeter        │
 │ • Deterministic 3.5s Bounded UX (Page Shells)     │ • Edge Proxy Exact Origin Allowlist (No Wildcards)│
 │ • React 19 Automatic Compiler Memoization         │ • Anti-IDOR Server-Side Resource Ownership        │
 │ • 6-Tier Multi-Layer Caching (In-Memory, Redis)   │ • Multi-Node Role Invalidation WS Eviction (4401)  │
 │ • Projection-Only DB Queries (Zero SELECT *)      │ • Fail-Closed Driver Device Session Lock (<30s)   │
 │ • Continuous Fluid Layout Engine (Container Qs)   │ • Fail-Closed GPS Ingestion on Redis Outage       │
 │ • Component Tree Pruning & Heavy Asset Splitting  │ • 128-Bit HMAC-SHA256 Digital Pass QR Contract    │
 │ • Dynamic Vector Tile Chunks (MapLibre/Leaflet)   │ • PostgreSQL 16 RLS & SECURITY DEFINER Isolation  │
 └───────────────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

---

## 2. Directory Structure & Reading Roadmap

| Document | Core Focus | Technical Scope & Concrete Proofs |
|---|---|---|
| [**`01-rendering-architecture-and-route-inventory.md`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/01-rendering-architecture-and-route-inventory.md) | **Rendering Architecture & Route Inventory** | Exhaustive audit of all 224 compiled routes: Server Components vs Client Components (`'use client'`), dynamic vs static rendering, Suspense boundaries, and hydration waterfall costs. |
| [**`02-component-overhead-and-dead-weight-elimination.md`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/02-component-overhead-and-dead-weight-elimination.md) | **Component Weights & Dead-Weight Pruning** | Forensic breakdown: Why every component exists, what it consumes, and what can be removed, deferred, or tree-shaken (Motion, Lenis, dual toast libs, Recharts, MapLibre workers, PDF generators) without affecting functionality. |
| [**`03-caching-mechanisms-and-data-lifecycle.md`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/03-caching-mechanisms-and-data-lifecycle.md) | **6-Tier Caching Architecture & Lifecycle** | Deep-dive across all caching layers: React 19 compiler, in-memory domain TTL caches (`routeService`, `fleetService`, `derivedKeyCache`), Redis 7 Pub/Sub, HTTP headers, Turbopack cache, and mutation invalidation contracts. |
| [**`04-frontend-performance-and-cwv-benchmarks.md`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/04-frontend-performance-and-cwv-benchmarks.md) | **Core Web Vitals & Fast Rendering** | Empirical CWV audit: LCP (0.8s), CLS (0.02), INP (<50ms), TTIS (≤3.5s), speed telemetry pipeline ($3.6 \times v$), image optimization (AVIF/WebP), and container-query layout engine. |
| [**`05-full-stack-security-and-fail-closed-boundaries.md`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/05-full-stack-security-and-fail-closed-boundaries.md) | **Full-Stack Security & Fail-Closed Bounds** | OWASP ASVS 5.0.0 compliance: Edge proxy CSRF, timing-safe auth comparisons, device session locks, WS wire security, PostgreSQL RLS, and cryptographic proof verification. |

---

## 3. Key High-Impact Metrics & System Benchmarks

```text
 ┌──────────────────────────────────────────────┬───────────────────┬───────────────────┬───────────────┐
 │ Metric / Dimension                           │ Pre-Audit State   │ Optimized State   │ Improvement   │
 ├──────────────────────────────────────────────┼───────────────────┼───────────────────┼───────────────┤
 │ Root Landing Page LCP                        │ 2.8s – 4.2s       │ 0.8s – 1.2s       │ ~70% Faster   │
 │ Cumulative Layout Shift (CLS)                │ 0.28 (table jump) │ 0.02 (skeletons)  │ 92.8% Cut     │
 │ Max Initial Loading Screen Duration          │ Indefinite (lock) │ ≤ 3.5s (bounded)  │ 100% Bounded  │
 │ Student Background Polling Rate              │ 12 req / min      │ 2 req / min       │ 83.3% Cut     │
 │ Driver Pending Requests Latency              │ 450ms – 1,200ms   │ 90ms – 180ms      │ ~75% Cut      │
 │ Database Wire Transfer (Hot Paths)           │ SELECT * (heavy)  │ Projected Columns │ 50% – 80% Cut │
 │ Route & Fleet Master DB Queries              │ Every page hit    │ Bounded TTL Cache │ Near-Zero DB  │
 │ Live Bus Velocity Telemetry                  │ Stuck at 0 km/h   │ Real-time km/h    │ 100% Fixed    │
 │ Reassignment Deadlock Risk                   │ Unordered Locks   │ Sorted (id ASC)   │ Zero Deadlock │
 │ Redis GPS Failure Boundary                   │ Local Fallback    │ Fail-Closed (503) │ Spatial Safety│
 │ QR Bus Pass Collision Resistance             │ 64-bit HMAC       │ 128-bit HMAC-256  │ 2^128 Safety  │
 │ TypeScript Compilation Errors                │ 0 errors          │ 0 errors          │ Clean Build   │
 │ Automated Regression Battery                 │ 314 tests         │ 314 tests passing │ 100% Pass     │
 │ Compiled Production Routes (Turbopack)       │ 224 routes        │ 224 routes        │ Clean Compile │
 └──────────────────────────────────────────────┴───────────────────┴───────────────────┴───────────────┘
```

---

## 4. Architectural Invariants Enforced Across This Module

1. **No Performance Without Correctness**: Never remove an authentication check, row lock, or input validation to save CPU cycles or network milliseconds.
2. **Deterministic Bounded Loading**: No commuter may ever be permanently trapped behind an unbounded full-page loading spinner. Skeletons and page shells must render within 3.5 seconds.
3. **Fail-Closed Security Boundaries**: On unexpected exceptions, network timeouts, or database pool exhaustion, the system must fail closed (deny access), never fail open.
4. **Authoritative Single Storehouse**: In-memory and Redis caches are strictly read caches or operational locks. PostgreSQL 16 via Supabase remains the sole authoritative store of record.
