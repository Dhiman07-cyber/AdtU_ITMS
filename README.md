# 🚌 Assam down town University — Intelligent Transport Management System (ADTU ITMS)

[![Next.js](https://img.shields.io/badge/Next.js-16.3.0_(Turbopack)-black?style=flat&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.8-blue?style=flat&logo=react)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26_LTS-green?style=flat&logo=node.js)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16_(Supabase_RLS)-336791?style=flat&logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.x_Pub%2FSub-DC382D?style=flat&logo=redis)](https://redis.io/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3.3-38B2AC?style=flat&logo=tailwind-css)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Tests-314%2F314_Passing_(100%25)-success?style=flat&logo=vitest)](https://vitest.dev/)
[![Routes](https://img.shields.io/badge/Routes-224_Compiled-blueviolet?style=flat)]()
[![Status](https://img.shields.io/badge/Release-Pre--Production_Verified-emerald?style=flat)]()

> **ADTU ITMS** is an institutional-grade, high-concurrency transit management and live telematics platform engineered specifically for **Assam down town University (Panikhaiti, Guwahati)**. It orchestrates morning and evening campus commutes for **2,000+ daily student commuters**, 25+ university buses, drivers, moderators, and administrators across the Guwahati and Kamrup metropolitan transit corridors.

---

## 📋 Table of Contents

1. [System Philosophy & Core Invariants](#-system-philosophy--core-invariants)
2. [End-to-End User Portals by Role](#-end-to-end-user-portals-by-role)
3. [Full-Stack Technical Architecture](#-full-stack-technical-architecture)
4. [Frontend Performance & Adaptive Layout Engine](#-frontend-performance--adaptive-layout-engine)
5. [Security, Cryptography & Concurrency Invariants](#-security-cryptography--concurrency-invariants)
6. [Comprehensive Documentation Suite (`docs/00`–`docs/10`)](#-comprehensive-documentation-suite-docs00docs10)
7. [Verification, Testing & Build Commands](#-verification-testing--build-commands)
8. [Production Deployment & Environment Setup](#-production-deployment--environment-setup)

---

## 🎯 System Philosophy & Core Invariants

ADTU ITMS is built around four fundamental architectural pillars to eliminate the physical delays, student-driver disputes, morning anxiety, and manual fee reconciliation bottlenecks of university transit:

1. **Trip-First Operational Spine (`active_trips`)**:
   - A vehicle (`bus_id`), driver (`driver_id`), and route (`route_id`) may participate in at most **one active trip** at any instant (`INV-TRIP-001`).
   - Active trips hold transactional locks in PostgreSQL and are synchronized via distributed Redis locks. Concurrency conflicts abort cleanly with `409 Conflict`.
2. **Single Primary Storehouse (PostgreSQL 16 with RLS)**:
   - **PostgreSQL 16 via Supabase** is the authoritative store for all system data: student profiles, driver rosters, bus fleets, route geometry, stop dwells, financial ledgers, and immutable audit trails.
   - **Firebase Authentication** is restricted strictly to user identity authentication and JWT verification (zero external runtime database dependencies).
3. **Real-Time Ephemeral Broadcast Cluster (WS1 + Redis 7)**:
   - A dedicated Node.js 26 WebSocket cluster (`ws1` on port 3001) broadcasts sub-second GPS map telemetry ($v = \text{m/s} \times 3.6$) and waiting flags to connected student sockets with sub-50ms latency.
   - Cross-node scaling is achieved via Redis 7 Pub/Sub with `originNodeId` deduplication to suppress local echo loops.
4. **Deterministic, Deadlock-Free & Reversible Administration**:
   - Seat allocations and mass student reassignments execute in atomic PostgreSQL stored procedures with deterministic lexical row-locking (`ORDER BY id ASC`), completely preventing database deadlocks.
   - Every administrative batch action generates an audit trail with an instant, one-click **Rollback Engine**.

---

## 👥 End-to-End User Portals by Role

```
                                 ADTU ITMS USER ROLES
 ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
 │   🎓 STUDENT      │    │    🚗 DRIVER      │    │   🛡️ MODERATOR    │    │    👑 ADMIN       │
 ├───────────────────┤    ├───────────────────┤    ├───────────────────┤    ├───────────────────┤
 │ • 3-Stream Reg    │    │ • Single-Device   │    │ • 6-Category RBAC │    │ • 3-Tab Smart     │
 │ • Razorpay Pay    │    │   Session Lock    │    │ • Offline Receipt │    │   Allocation Hub  │
 │ • 128-bit QR Pass │    │ • GPS Telematics  │    │   Verification    │    │ • Deadlock-Free   │
 │ • Real-Time Map   │    │   (5s Ingestion)  │    │ • Reassignment    │    │   Batch Transfer  │
 │ • Waiting Flags   │    │ • Manifest Sync   │    │   Execution       │    │ • Rollback Engine │
 │ • Session Renewal │    │ • Flag Ack        │    │ • Scanner Station │    │ • Dynamic Calendar│
 └───────────────────┘    └───────────────────┘    └───────────────────┘    └───────────────────┘
```

### 🎓 Student Commuter Portal (`/student`)
* **3 Application Streams**: Fresh registrations, upcoming session gated pre-registrations, and active pass renewals.
* **Dual Payment Processing**: Server-verified online Razorpay checkout with webhook idempotency, or offline bank challan upload with moderation approval.
* **Cryptographic Digital Bus Pass**: Version 2 (`v2:`) pass with a **128-bit HMAC-SHA256 signature**, tamper-proof offline boarding verification, and dynamic validity badges.
* **Live Commute Tracking**: Real-time Leaflet vector map with smoothed GPS movement, accurate vehicle speed ($v = \text{m/s} \times 3.6$), live ETA, stop dwell indicators, and "Waiting at Stop" proximity pings.

### 🚗 Driver / Pilot Portal (`/driver`)
* **Single-Device Exclusive Session**: Server-side device session lease (<30s heartbeat) prevents multi-device account hijacking or rogue GPS spoofing.
* **Trip Lifecycle Controls**: "Start Trip" acquires three-way mutual exclusion locks; broadcasts continuous telematics at 5-second intervals via `/api/location/update`.
* **Passenger Manifest**: Live dashboard of assigned route stops, student boarding counts, and real-time waiting flags raised by commuters along the corridor.

### 🛡️ Moderator Portal (`/moderator`)
* **Granular RBAC Security Matrix**: 6 independent permission categories (`students`, `drivers`, `buses`, `routes`, `applications`, `payments`) enforced server-side.
* **Offline Challan Verification**: Dual-stage verification verifying physical challan metadata against university bank deposits before activating transit entitlements.
* **QR Boarding Scanner**: Camera-based scanner station with offline token verification, shift validation, and bus capacity matching.

### 👑 Administrator Portal (`/admin`)
* **Smart Allocation Hub (`/admin/smart-allocation`)**: Unified 3-tab allocation console (Bus-Route Assignment, Driver Rostering, Student Reassignment).
* **Deadlock-Free Batch Reassignment**: Atomic stored procedure (`reassign_students_atomically`) locks source and destination buses deterministically (`ORDER BY id ASC`), validates capacity, and provides an instant 1-click **Rollback Engine**.
* **Dynamic Academic Lifecycle**: Automatic graduation-year calculation (`deriveAcademicLifecycle`) eliminating hardcoded date bugs; automated soft-block and hard-block crons.
* **Financial Ledger Oversight**: Server-authoritative fee adjustment logs, double-entry payment audit ledgers, and encrypted CSV/PDF transaction exports.

---

## 🛠 Full-Stack Technical Architecture

```text
                                  SYSTEM TOPOLOGY
                               ┌───────────────────┐
                               │  Client Browsers  │
                               │  & PWA Terminals  │
                               └─────────┬─────────┘
                                         │ HTTPS / WSS
                                         ▼
                               ┌───────────────────┐
                               │    NGINX Proxy    │  Ports 80/443 (SSL, X-Real-IP)
                               └────┬─────────┬────┘
                 HTTP / API Routes  │         │  WebSocket Upgrade
                                    ▼         ▼
             ┌─────────────────────────┐   ┌─────────────────────────┐
             │     Next.js 16 App      │   │   Node.js 26 Cluster    │
             │   Router (Port 3000)    │   │     WS1 (Port 3001)     │
             └──────────┬──────────────┘   └────────────┬────────────┘
                        │                               │
                        ├───────────────┬───────────────┤
                        ▼                               ▼
             ┌─────────────────────┐         ┌─────────────────────┐
             │    Redis 7 Broker   │         │  PostgreSQL 16 DB   │
             │ (Pub/Sub & Lua Guard│         │ (Supabase + ACID    │
             │     Port 6379)      │         │     Port 5432)      │
             └─────────────────────┘         └─────────────────────┘
```

| Architectural Tier | Technology | Purpose & Implementation Details |
|---|---|---|
| **Core Framework** | **Next.js 16.3.0** | App Router, Server Components, Server Actions, Turbopack compiler, Partial Prerendering. |
| **Frontend UI** | **React 19.2.8** | Native compiler memoization, `useActionState`, `useOptimistic`, and contextual loading skeletons. |
| **Styling & Design** | **Tailwind CSS 4.3.3** | Fluid typography, container queries (`@container`), dark mode glassmorphism, and responsive tokens. |
| **Primary Database** | **PostgreSQL 16 (Supabase)** | Authoritative source of truth, Row-Level Security (RLS), atomic RPCs (`bus_increment_capacity`, `reassign_students_atomically`). |
| **Realtime Telematics** | **Node.js 26 + `ws`** | High-throughput WebSocket server cluster (`ws1` port 3001), 5s pre-auth timeouts, and slow-consumer backpressure bounds. |
| **Cache & Coordination** | **Redis 7.x** | Distributed Pub/Sub message relay, atomic Lua monotonic GPS timestamp guard, and cross-node role invalidation. |
| **Edge & Proxy** | **NGINX + `src/proxy.ts`** | Anti-spoofing IP resolution (`X-Real-IP: $remote_addr`), TLS termination, and exact CSRF origin validation. |
| **Identity & Auth** | **Firebase Admin SDK** | JWT token extraction and signature verification; user roles stored and authoritative in PostgreSQL. |
| **Payment Gateway** | **Razorpay SDK** | Server-side order generation, timing-safe HMAC signature verification, and idempotent webhook processing. |
| **Observability** | **Prometheus + Grafana** | Internal `:9090` metrics scraping (`itms_*` counters/histograms), Alertmanager triggers, and SRE dashboards. |

---

## ⚡ Frontend Performance & Adaptive Layout Engine

### 1. Root Landing Page LCP Overhaul
* Converted the root `/` route from a blocking client component into a fast **Server Component**.
* First Contentful Paint (FCP) and Largest Contentful Paint (LCP) dropped from **2.8s–4.2s down to 0.8s–1.2s (~70% improvement)**.
* Role-based redirection is isolated to an asynchronous, non-blocking client island (`<AuthRedirector />`).

### 2. Deterministic 5-Stage Loading Architecture
Eliminates unbounded loading spinners across all portals using a hard **3.5-second UX ceiling** via `usePageShellLoader`:
$$\text{LOADER (max 3.5s)} \longrightarrow \text{PAGE SHELL} \longrightarrow \text{SKELETONS} \longrightarrow \text{REAL DATA} \longrightarrow \text{ERROR/RETRY}$$
If cellular connections are slow, the application navigation shell and contextual skeletons (`TableLoader`, `CardLoader`, `MetricCardSkeleton`) render immediately, allowing users to interact while data streams in.

### 3. Continuous Fluid Responsive Layout Engine
Replaces brittle device-specific media query bands with a continuous space-aware layout engine:
* **Diff-Only CSS Custom Properties**: An `rAF`-throttled `ResizeObserver` updates `--itms-vw`, `--itms-vh`, and `--itms-layout-mode` on `document.documentElement` without triggering full React component tree re-renders.
* **CSS Container Queries**: Header toolbars use `.itms-page-header-container` and `@container (max-width: 740px)` to cleanly stack action button clusters without orphan line wraps.
* **Tested Across 12 Reference Viewports**: From 320px compact phones (iPhone SE) up to 3440px ultrawide displays.

---

## 🔒 Security, Cryptography & Concurrency Invariants

ADTU ITMS strictly adheres to the **Level 0 Global Production Engineering Rule** and the **Level 1 ITMS Constitution**:

```text
                               INVARIANT VERIFICATION SUMMARY
 ┌──────────────────────┬─────────────────────────────────────────────────────────┬────────┐
 │ Invariant ID         │ Core Architectural Rule                                 │ Status │
 ├──────────────────────┼─────────────────────────────────────────────────────────┼────────┤
 │ INV-AUTH-001 / 002   │ Authentication Boundary & Anti-IDOR Ownership Enforced │ PASS   │
 │ INV-AUTH-003 / WS-03 │ Redis role_invalidate Evicts Active Sockets (Code 4401) │ PASS   │
 │ INV-AUTH-004         │ Single Driver Device Session Exclusivity (<30s Lease)   │ PASS   │
 │ INV-AUTH-005         │ Edge Proxy Origin CSRF Exact Match (No Wildcards)       │ PASS   │
 │ INV-WS-001 / 002     │ Pure First-Message Handshake Auth; URL Tokens Banned    │ PASS   │
 │ INV-TRIP-001 / 003   │ 3-Way Active Trip Lock & Atomic RPC Termination         │ PASS   │
 │ INV-GPS-002 / 005    │ Atomic Lua Timestamp Monotonicity & Fail-Closed Ingress │ PASS   │
 │ INV-PAY-001 / 002    │ Razorpay HMAC Verification & Webhook CAS Idempotency    │ PASS   │
 │ INV-CAP-001 / 003    │ Row-Level Lock Capacity Checks & Deadlock-Free Transfers│ PASS   │
 │ INV-DB-001 / 003     │ Schema Drift Reconciled & SECURITY DEFINER Hardened    │ PASS   │
 └──────────────────────┴─────────────────────────────────────────────────────────┴────────┘
```

* **128-Bit Digital Pass Signatures**: Digital bus passes use the Version 2 (`v2:`) contract with a 16-byte (128-bit) truncated HMAC-SHA256 signature, providing $2^{128}$ collision resistance against pass tampering.
* **Deadlock Prevention Mathematical Proof**: Bidirectional reassignments lock source and target buses deterministically (`ORDER BY id ASC`), eliminating wait-for dependency cycles.
* **Production GPS Fail-Closed Ingress**: If Redis is partitioned or unavailable in production, GPS ingestion strictly fails closed (`redis_unavailable`) rather than degrading into split-brain in-memory broadcasting.

---

## 📚 Comprehensive Documentation Suite (`docs/00`–`docs/10`)

The repository features an exhaustive 11-folder documentation suite providing complete Low-Level Design (LLD) justifications and empirical evidence:

| Directory | Master Title & Description | Key Reading |
|---|---|---|
| [**`docs/00`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/) | **Master Index, LLD & VPS Engineering** | Real-world problem statement, 2,000-commuter capacity math, cloud bottleneck audit vs Hetzner VPS (₹1,250/mo), and oral defense manual. |
| [**`docs/01`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/) | **Trip Lifecycle & Telematics Pipeline** | End-to-end dataflow, Redis Pub/Sub envelopes, WebSocket cluster wire protocol, and PostgreSQL RPC state machine. |
| [**`docs/02`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/) | **Payments & Financial Subscriptions** | Razorpay checkout, integer paise ledger, immutable triggers (`protect_completed_payments`), and renewal crons. |
| [**`docs/03`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/) | **Identity & Role-Based Access Control** | Dual auth architecture, Edge proxy trie router, and granular 6-category moderator permission matrix. |
| [**`docs/04`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/) | **Students, Capacity & Route Allocation** | 3 registration streams, dynamic QR pass contract, atomic seat counters, and deadlock-free student reassignment. |
| [**`docs/05`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/) | **Operations, Runbooks & Observability** | Prometheus scraping, custom `itms_*` metrics, Grafana dashboards, and emergency incident runbooks. |
| [**`docs/06`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/) | **System Evidence & Verification Matrices** | Invariant ledger, Golden Battery (G01–G29), Next.js 16 performance benchmarks, and forensic findings tracker. |
| [**`docs/07`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/) | **GPS & Location Integrity Forensics** | Source-to-screen telemetry pipeline certification, MapLibre route alignment, and easing curve dynamics. |
| [**`docs/08`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/) | **Admin System Configuration & Automation** | Programmatic academic calendar derivation, server-authoritative pricing engine, and immutable audit logs. |
| [**`docs/09`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/) | **Canonical Verification & Failure Matrix** | System specification, multi-node failure simulation matrix, and disaster recovery procedures. |
| [**`docs/10`**](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/) | **Performance & Security Architecture** | 224 route rendering audit, dead-weight pruning (Lenis/Motion), 6-tier caching topology, Core Web Vitals (0.8s LCP), and fail-closed security. |

---

## 🧪 Verification, Testing & Build Commands

Every invariant and performance claim is proven by automated regression suites:

```bash
# 1. Typecheck: Zero diagnostic errors
npx tsc --noEmit

# 2. Linter: Zero syntax or security lint errors
npm run lint

# 3. Automated Vitest Battery: 48 test files, 314 tests passed (100%)
npm run test:run

# 4. Standalone WebSocket Server Guard Suite:
npx vitest run server/privileged-guard.test.ts server/websocket-server.test.ts

# 5. Production Next.js Turbopack Build: 224 routes compiled cleanly
npm run build
```

---

## 🚀 Production Deployment & Environment Setup

### Environment Configuration (`.env`)

```env
# Application Environment
NODE_ENV=production
PORT=3000

# Standalone WebSocket Server Cluster
WS_PORT=3001
WS_PRIVILEGED_TOKEN=your-64-character-cryptographically-secure-token-here

# Redis Broker (Cluster Coordination & GPS Guard)
REDIS_URL=redis://:your-redis-password@localhost:6379

# Supabase PostgreSQL Database (Authoritative Primary Store)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_DB_URL=postgresql://postgres:password@localhost:5432/postgres

# Firebase Authentication (ID Token Verification Only)
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Razorpay Payment Gateway
RAZORPAY_KEY_ID=rzp_live_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Cryptography (Digital Bus Passes & Signed Receipts)
DOCUMENT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
DOCUMENT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
TOKEN_SIGNING_SECRET=your-32-byte-hex-secret-for-hmac-sha256

# Administrative & Scheduled Crons
ADMIN_EMAIL=transport-admin@adtu.edu.in
CRON_SECRET=your-high-entropy-cron-authorization-secret
```

### Docker Compose Multi-Service Production Launch

```bash
# Pull and start all co-located containers (Next.js, WS1, Redis, NGINX, Prometheus, Grafana)
docker compose -f docker-compose.prod.yml up -d --build

# Inspect running container health status
docker compose -f docker-compose.prod.yml ps

# Follow live telematics ingestion and WebSocket logs
docker compose -f docker-compose.prod.yml logs -f itms-ws1
```

---

**Institutional Platform**: Assam down town University Intelligent Transport Management System (ADTU ITMS)  
**Corridors Served**: Guwahati & Kamrup Transit Routes (Panikhaiti, Jalukbari, Khanapara, Beltola, Chandmari, Noonmati)  
**Engineering Standard**: Level 0 Global Production Engineering Standard & Level 1 ITMS Constitution  
**License**: Institutional Proprietary
