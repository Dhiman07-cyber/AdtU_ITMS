# ADTU ITMS — Production Runtime & Environment Remedial Pass Report

**Execution Date:** October 3, 2026  
**Target Environment:** Production Runtime & Staging Verification  
**Repository Branch:** `main` (Base HEAD: `d1c68c3`)  
**Architecture Freeze Policy:** Redis, WS1, WS2, NGINX routing, Lua scripts, and `bus_locations` strictly preserved.

---

## 1. Actual Production Architecture Overview

The ADTU ITMS platform in production operates as a split-compute, distributed real-time cloud topology:

```
[Student / Driver / Admin Browser]
       │                    │
       ▼ (HTTPS / APIs)     ▼ (WSS Realtime Telemetry)
┌────────────────┐   ┌───────────────────────────────┐
│ Vercel Edge/   │   │ Render Docker Web Service     │
│ Serverless App │   │ (`itms-websocket-server`)     │
│ Next.js 16     │   │ Single/Multi Node (Port 3001) │
└───────┬────────┘   └──────────────┬────────────────┘
        │                           │
        │      ┌────────────────────┴────────────────┐
        ▼      ▼                                     ▼
┌─────────────────────────────┐        ┌─────────────────────────┐
│ Supabase Managed PostgreSQL │        │ Redis Cloud / Upstash   │
│ DB: `ztqilqooygdqpmhnxidi`   │        │ Pub/Sub & Telemetry     │
│ Region: `ap-south-1` (AWS)  │        │ Deduplication / State   │
└─────────────────────────────┘        └─────────────────────────┘
```

1. **Frontend & Serverless Compute Layer (Vercel):**
   - **Project:** `adtu-bus-system` (Project ID: `prj_EfxjALMtbQqtYEO0upSBLY8ADt5J`)
   - **Organization:** `team_bM43Ean2sb3pPbw7olat1tpQ`
   - **Production URL:** `https://adtu-itms.vercel.app`
   - **Responsibilities:** Next.js 16 App Router, Server Components, client bundles, authenticated REST APIs (`/api/*`), cron worker pipelines (`/api/cron/*`), and SSR page delivery.

2. **Dedicated Realtime WebSocket Engine (Render):**
   - **Service Name:** `itms-websocket-server` (Service ID: `srv-dae2ae7qj5pc73a06skg`)
   - **Workspace:** `Dhiman's workspace` (`tea-dae26nn40ujc73dg6q10`)
   - **Production Endpoint:** `https://itms-websocket-server.onrender.com` / `wss://itms-websocket-server.onrender.com/ws`
   - **Containerization:** Alpine Node 22 Docker container (`./server/Dockerfile`) running `server/index.ts`.
   - **Health & Monitoring Endpoints:** `/health/live` (HTTP 200), `/health/ready` (HTTP 200/503), `/metrics` (Prometheus text), `/metrics/json`.

3. **Authoritative Relational Database (Supabase PostgreSQL):**
   - **Project Ref:** `ztqilqooygdqpmhnxidi`
   - **Region:** AWS Mumbai (`ap-south-1`)
   - **Responsibilities:** Row-level security (RLS), atomic stored procedures (`end_trip_atomically`, `record_gps_fix_atomically`), ledger accounting, entitlement rules, seat locking, and foreign key integrity.

4. **Distributed Caching & In-Memory Relay (Redis):**
   - **Topology:** Dual-node broadcast relay (WS1/WS2 pub/sub fanout), GPS monotonic deduplication, and ephemeral latest-fix caching (`bus_location:{id}`).

---

## 2. Production Deployment & Live Status

| Component | Target Identity | Verified Live State | Health Status |
| :--- | :--- | :--- | :--- |
| **Vercel Frontend** | `adtu-bus-system` (`https://adtu-itms.vercel.app`) | Live & Serving traffic | **HEALTHY / 200 OK** |
| **Render WebSocket** | `itms-websocket-server` (`srv-dae2ae7qj5pc73a06skg`) | Live & Accepting WS handshake | **OPERATIONAL / DEGRADED REDIS** |
| **Supabase DB** | `ztqilqooygdqpmhnxidi` | Live & Connected | **HEALTHY / MIGRATED** |
| **Redis Telemetry** | Local/Staging vs Remote | Not configured on Render (`redis: not_configured`) | **PENDING PROVISIONING** |

---

## 3. Verified Live Database Remediations (Closed in Live DB)

1. **`end_trip_atomically` RPC Synchronized:**
   - Applied to live Supabase database via Supabase MCP.
   - Live routine verified with signature `(p_trip_id uuid, p_bus_id uuid, p_driver_id uuid, p_forced boolean, p_reason text)`.
   - Idempotency verified: re-ending an ended trip returns `{ success: true, message: 'Trip already completed' }`.

2. **Live Trip Status & Termination Reason Constraints:**
   - Table `trips` constraint `trips_status_check` accepts `'in_progress'`, `'completed'`, and `'terminated_early'`.
   - Constraint `trips_end_reason_check` accepts `'driver_ended'`, `'short_trip'`, `'admin_forced'`, `'auto_expired'`, and `'emergency'`.
   - Tested live on PostgreSQL: short trips under 2 minutes terminate cleanly with reason `'short_trip'`.

---

## 4. Completed Remediations in This Pass

1. **Portable Deployment Architecture (Zero Hardcoded Domains):**
   - Removed all hardcoded SaaS domains (`adtu-itms.vercel.app`, `itms-websocket-server.onrender.com`, `adtu-bus-services.vercel.app`, `adtu.in` wildcard) from source code:
     - `src/proxy.ts`: Origin validation dynamically resolves against `NEXT_PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, and Vercel preview headers (`x-vercel-deployment-url`). Loopbacks (`localhost`, `127.0.0.1`) are strictly restricted to `NODE_ENV === 'development' || NODE_ENV === 'test'`.
     - `src/lib/security/api-security.ts`: `getAllowedOriginHosts()` dynamically parses hosts from `NEXT_PUBLIC_APP_URL` and `ALLOWED_ORIGINS`.
     - `src/app/api/payment/razorpay/create-order/route.ts`, `verify-payment/route.ts`, `recover/route.ts`: CORS headers driven dynamically by environment variables.
     - `src/lib/services/admin-email.service.ts`: Eliminated static URL fallback; dynamically reads `NEXT_PUBLIC_APP_URL`.
     - `src/domains/realtime/ws-config.ts`: Client WebSocket endpoint resolution is purely driven by `NEXT_PUBLIC_WS_URL` and `WS_SERVER_URL`.

2. **Vercel Production Environment Synchronization:**
   - Corrected `NEXT_PUBLIC_APP_URL` from `http://localhost:3000` to `https://adtu-itms.vercel.app`.
   - Provisioned `ALLOWED_ORIGINS` with `https://adtu-itms.vercel.app,http://localhost:3000`.
   - Provisioned high-entropy cryptographic secrets for `METRICS_SECRET` and `AM_WEBHOOK_SECRET` across Production, Preview, and Development.

3. **Render Blueprint Verification:**
   - Verified Render CLI is authenticated to workspace `tea-dae26nn40ujc73dg6q10` and web service `srv-dae2ae7qj5pc73a06skg`.
   - Created and validated declarative Blueprint `render.yaml` (`valid: true`).

4. **Environment File Alignment & Coherence:**
   - Consolidated email settings into a single cohesive section with clear provider documentation.
   - Added Redis local-fallback flags (`ALLOW_INSECURE_LOCAL_WS_FALLBACK=true`, `ALLOW_INSECURE_LOCAL_GPS_FALLBACK=true`) and `REDIS_URL`.
   - Clarified `NODE_ENV` ("Environment Mode") and its behavioral impact across environments.
   - Updated `.env.example` to document all 153 identified variables and settings.

5. **Excision of Obsolete Routes:**
   - Removed 6 legacy/duplicate routes from the codebase:
     - `/app/admin/driver-assignment`
     - `/app/admin/renew-services`
     - `/app/admin/route-allocation`
     - `/app/api/admin/bus-fee`
     - `/app/api/driver/update-location`
     - `/app/api/get-bus-fee`

---

## 5. Verification Gate Results

- **TypeScript Compilation (`npx tsc --noEmit`):** ✅ **PASS (0 errors)**
- **Test Suite Execution (`npm run test:run`):** ✅ **PASS (54 test files passed, 365 tests passed)**
- **Environment Validation (`npm run validate:env`):** ✅ **PASS (All required environment requirements satisfied)**

---

## 6. Architecture Freeze Enforcement

Under strict architecture freeze constraints, this pass **DID NOT**:
- Remove or disable Redis.
- Alter the Redis Lua GPS deduplication or caching scripts.
- Change the two-WebSocket topology (WS1/WS2) or NGINX routing.
- Modify the 0.5 Hz (2s) GPS transmission cadence.
- Modify the 10s client / 30s server heartbeat intervals.
- Redesign `bus_locations` table or schema.
- Refactor trip lifecycle orchestration.

---

## 7. Deferred Items (Scheduled for Future Phase)

The following items are deferred to a separate, subsequent architecture reduction phase:
- Evaluation of single-WebSocket vs dual-WebSocket server topology.
- Evaluation of Redis storage removal vs lightweight memory/Postgres pubsub.
- Finalization of remote Redis cluster provisioning if Redis architecture is retained.
