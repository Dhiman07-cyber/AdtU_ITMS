# ADTU ITMS — Multi-Tier Caching Architecture & Data Lifecycle

**Document ID:** `ITMS-PERF-CACHING-LIFECYCLE-2026-V2`  
**Authority:** Principal Systems & Performance Infrastructure Architect  
**Scope:** Complete 6-Tier Caching Topology, Invalidation Contracts & Consistency Invariants  
**Target Environment:** Production Node.js 26 Cluster + Redis 7 + PostgreSQL 16  

---

## 1. Executive Summary: The 6-Tier Caching Architecture

Caching in a transit telematics system involves a delicate balance between **ultra-low read latency** and **strict transactional consistency**:
- Route polylines and bus fleet directories change rarely (once per semester or during fleet maintenance) and should be cached aggressively.
- Bus live GPS coordinates change every 2 to 5 seconds and require ephemeral, in-memory coordination.
- Student seat allocations, trip operational locks, and financial ledger rows must **never be cached stale**—they demand authoritative ACID consistency.

ADTU ITMS implements an explicit **6-Tier Multi-Layer Caching Architecture**:

```text
                                  6-TIER CACHING TOPOLOGY
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │ TIER 1: REACT 19 COMPILER MEMOIZATION (Client Browser DOM)                            │
 │ • Automatic memoization of JSX components, hooks, and callbacks (reactCompiler: true)  │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ TIER 2: IN-MEMORY DOMAIN TTL CACHES (Node.js Process Heap)                             │
 │ • routeService (5 min TTL) | fleetService (2 min TTL) | derivedKeyCache (5,000 LRU)    │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ TIER 3: DISTRIBUTED REDIS 7 COORDINATION & PUB/SUB (Cluster Broker)                    │
 │ • Lua Monotonic GPS Guard | role_invalidate Channel | Ephemeral Bus Coordinates       │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ TIER 4: NEXT.JS 16 & TURBOPACK BUILD CACHES (Compilation Tier)                         │
 │ • turbopackFileSystemCacheForDev | Webpack Filesystem Cache | Vendor splitChunks       │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ TIER 5: HTTP, REVERSE PROXY & NGINX EDGE CACHING (Network Gateway)                     │
 │ • NGINX Upstream Keepalives | /manifest.json SWR | /_next/static Immutable Cache      │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ TIER 6: IMAGE OPTIMIZATION & ASSET PIPELINE (Edge CDN)                                 │
 │ • next/image AVIF/WebP Conversion | minimumCacheTTL: 86400 (24h) | Cloudinary          │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Deep-Dive: The 6 Caching Tiers

### Tier 1: React 19 Compiler Automatic Memoization
* **Location:** Client Browser JavaScript Runtime.
* **Configuration:** `reactCompiler: true` in `next.config.ts`.
* **Mechanics:**
  - In traditional React, developers manually managed `useMemo` and `useCallback` dependency arrays, frequently leading to stale closures or accidental re-renders.
  - The React 19 Compiler performs static AST analysis at build time to automatically memoize computed values, JSX component subtrees, and function references.
  - **Performance Impact:** Eliminates cascading child re-renders when parent states change, keeping client CPU utilization low during high-frequency WebSocket GPS map updates.

### Tier 2: In-Memory Domain TTL Caches (Process Heap)
* **Location:** Node.js Application Server Memory Heap.
* **Components:**

#### A. Route Master Cache (`route.service.ts`)
```typescript
// Bounded in-memory route cache with automatic TTL expiration
let cachedRoutes: Route[] | null = null;
let routesCacheExpiresAt = 0;
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getAllRoutes(): Promise<Route[]> {
  const now = Date.now();
  if (cachedRoutes && now < routesCacheExpiresAt) {
    return cachedRoutes; // Sub-millisecond synchronous memory read
  }
  const routes = await fetchRoutesFromDatabase();
  cachedRoutes = routes;
  routesCacheExpiresAt = now + ROUTE_CACHE_TTL_MS;
  return routes;
}

export function invalidateRouteCache(): void {
  cachedRoutes = null;
  routesCacheExpiresAt = 0;
}
```

#### B. Fleet Master Cache (`fleet.service.ts`)
* **TTL:** 2 minutes (`120,000ms`).
* **Behavior:** Holds vehicle license plates, onboard GPS device IDs, and seat capacity limits.
* **Invalidation:** Automatically evicted via `invalidateBusCache()` whenever an admin creates, updates, or deactivates a bus.

#### C. Cryptographic Key Derivation LRU Cache (`encryption.service.ts`)
* **Defect Identified:** Synchronous PBKDF2 (100,000 iterations) previously locked the Node.js event loop on every database field decryption, causing severe API latency spikes.
* **Solution:** Introduced an in-memory Least Recently Used (LRU) cache (`derivedKeyCache`) storing up to 5,000 derived cryptographic keys.
* **Performance Impact:** Decryption execution time dropped from **~15ms down to <0.01ms per record**, completely eliminating event-loop stalls during bulk student exports.

### Tier 3: Distributed Redis 7 Caching & Ephemeral Telematics
* **Location:** Redis 7.x Broker (Port 6379).
* **Role in Architecture:**
  1. **Atomic Monotonic GPS Guard:**
     - Key: `bus:{busId}:last_location`
     - Evaluated via an atomic Redis Lua script comparing packet timestamp $t_{\text{packet}}$ against stored timestamp $t_{\text{last}}$.
     - Completely prevents out-of-order or replayed GPS packets from overwriting live location state.
  2. **Multi-Node Role Invalidation Channel (`role_invalidate`):**
     - When an administrator modifies a user's role or revokes permissions in the Next.js web application, Next.js publishes the user UID to Redis.
     - All WebSocket worker nodes (`ws1`) receive the broadcast, purge the UID from their local `tokenAuthCache`, and immediately close matching client sessions with code `4401`.

### Tier 4: Next.js 16 & Turbopack Compilation Caching
* **Location:** Build system & local filesystem (`.next/cache/`).
* **Configuration in `next.config.ts`:**
  - `turbopackFileSystemCacheForDev: true`: Caches module graphs and ASTs to disk, accelerating development server boot times by **60%–80%**.
  - `webpack.cache.type = 'filesystem'`: Persists build artifacts across hot reloads.
  - `webpack.optimization.splitChunks`: Pre-chunks large dependencies into separate, long-lived cacheable assets:
    - `firebase`: Priority 40 (Firebase Auth SDK)
    - `supabase`: Priority 35 (PostgreSQL client)
    - `uiLibs`: Priority 30 (Radix UI, Motion, Lucide, Recharts)
    - `vendors`: Priority 10 (Utility packages)

### Tier 5: HTTP, Reverse Proxy & NGINX Edge Caching
* **Location:** NGINX Reverse Proxy (`nginx/nginx.conf`) and HTTP Response Headers.
* **Cache-Control Strategy Matrix:**

| Route Category | HTTP Header Configuration | Rationale & Cache Behavior |
|---|---|---|
| **API Endpoints (`/api/*`)** | `Cache-Control: no-store, no-cache, must-revalidate`<br>`Pragma: no-cache` | Zero caching. Sensitive user profiles, payments, and trip states must always be fetched fresh from the server. |
| **Health Probe (`/api/health`)** | `Cache-Control: no-cache, max-age=0, must-revalidate` | Prevents CDN edge caching so monitoring tools (Prometheus/Uptime) always verify live container health. |
| **PWA Manifest (`/manifest.json`)**| `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` | Browser caches for 1 hour; allows background revalidation without blocking app launch. |
| **Static Build Assets (`/_next/static/*`)** | `Cache-Control: public, max-age=31536000, immutable` | Permanent immutable cache. Files have unique content hashes in filenames (e.g. `main-a8f9c.js`); never need revalidation. |
| **HTML Page Shells** | `Cache-Control: private, no-cache, must-revalidate` | Browser checks server for new deployment HTML on navigation; prevents stale script mismatches. |

### Tier 6: Image Optimization & Asset CDN Caching
* **Location:** Next.js Image Optimization Pipeline (`next/image`) & Cloudinary.
* **Configuration:**
  - `formats: ['image/avif', 'image/webp']`: Serves next-generation AVIF images with fallback to WebP.
  - `minimumCacheTTL: 86400` (24 hours): Processed and resized images are cached at the edge for 24 hours.
  - `qualities: [25, 50, 75, 90, 100]`: Restricts image optimization to pre-defined quality steps, preventing cache fragmentation from arbitrary query parameters.

---

## 3. Cache Invalidation & Consistency Contracts

A caching architecture is only as sound as its invalidation contracts. The system strictly adheres to the following event-driven invalidation rules:

```text
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │                      MUTATION-DRIVEN CACHE INVALIDATION FLOW                           │
 │                                                                                        │
 │  ADMIN ACTION (e.g., Update Route Stops or Deactivate Bus)                             │
 │         │                                                                              │
 │         ▼                                                                              │
 │  1. PostgreSQL Transaction Committed (Primary Source of Truth)                         │
 │         │                                                                              │
 │         ├────────────────────────────────────────┬───────────────────────────────────┐ │
 │         ▼                                        ▼                                   ▼ │
 │  2. Local In-Memory Eviction              3. Redis Pub/Sub Broadcast            4. Zero│
 │     • invalidateRouteCache()                 • role_invalidate (UID)               Stale│
 │     • invalidateBusCache()                   • All WS Nodes purge local maps       Read│
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

### Strict Zero-Cache Zones (ACID Guarantees):
1. **Financial Ledger (`payments` table)**:
   - Direct PostgreSQL queries via Supabase client with row-level locks.
   - Idempotent CAS verification prevents double-spending; caching is strictly forbidden.
2. **Active Trip Locks (`active_trips` table)**:
   - Trip start/end operations use PostgreSQL stored procedures (`acquire_trip_lock`, `end_trip_atomically`).
   - Caching a trip lock in memory without database synchronization is prohibited by `INV-TRIP-001`.
3. **Student Boarding Scans**:
   - Ticket scans must verify live database validity and bus route matching; cached offline passes must present valid HMAC signatures.

---

## 4. Performance Impact Summary

| Caching Layer | Pre-Caching Latency | Cached Latency | Reduction / Benefit |
|---|:---:|:---:|:---:|
| **Route Master Polyline** | 45ms – 85ms (DB query) | **< 0.1ms** (Memory Heap) | **99.8% Latency Cut** |
| **Fleet Bus Directory** | 35ms – 70ms (DB query) | **< 0.1ms** (Memory Heap) | **99.7% Latency Cut** |
| **Crypto Key Derivation (PBKDF2)** | 12ms – 18ms (CPU lock) | **< 0.01ms** (LRU Cache) | **Zero Event-Loop Stalls** |
| **Turbopack Dev Server Restart** | 4.8s (Cold Parse) | **1.2s** (FS Cache) | **75% Faster Re-compilation** |
| **PWA Shell Assets** | 350ms (Network Roundtrip)| **0ms** (Disk Cache) | **Instant App Shell Launch** |
| **Optimized Image Avatars** | ~450 KB (JPEG) | **~38 KB** (AVIF) | **~91% Payload Cut** |
