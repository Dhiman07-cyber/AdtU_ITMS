# ADTU ITMS — Canonical Verification Runbook

This document provides exact, executable operational instructions allowing any engineer or verification agent to reproduce the complete verification suite, baseline checks, multi-node clustering, failure injection, and teardown.

---

## 1. Prerequisites & Environment Setup

### Required Tools
* Node.js `>= 20.9.0` (Tested on `v26.2.0`)
* npm `>= 10.0.0` (Tested on `11.13.0`)
* Docker & Docker Compose
* PowerShell (Windows) or Bash (Linux / macOS)

### Environment File
Ensure `.env` exists in the repository root containing required credentials:
```bash
cp .env.example .env
```
Ensure key variables are populated:
```env
NODE_ENV=development
WS_PORT=3001
WS_PRIVILEGED_TOKEN=test-privileged-secret-key-64-characters-long-for-testing
CRON_SECRET=test-cron-secret-key-for-verification
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key
REDIS_URL=redis://localhost:6379
```

---

## 2. Baseline Verification Suite

Execute the standard validation commands in order:

### 2.1 TypeScript Type Checking
```bash
npx tsc --noEmit
```
* **Expected Output:** Code 0, no errors emitted.

### 2.2 ESLint Validation
```bash
npm run lint
```
* **Expected Output:** Code 0 (0 errors, warnings for unused directives permitted).

### 2.3 Automated Test Suite (Vitest)
```bash
npm test -- --run
```
* **Expected Output:** 47 test files passed, 290 tests passed, 0 failures.

### 2.4 Production Next.js Build
```bash
npm run build
```
* **Expected Output:** Code 0, optimized build with ~221 static/dynamic pages compiled.

---

## 3. Local Infrastructure Stack Setup (Docker Compose)

Start the local backing services (PostgreSQL via Supabase, Redis, NGINX, and WS nodes):

### 3.1 Start Redis & Prometheus
```bash
docker compose -f docker-compose.prod.yml up -d redis prometheus alertmanager
```
Verify Redis is healthy:
```bash
docker exec -it itms-redis redis-cli ping
# Expected: PONG
```

### 3.2 Start Multi-Node WebSocket Cluster
To simulate multi-node behavior (WS Node 1 on port 3001, WS Node 2 on port 3003):

**Terminal 1 (WS Node 1):**
```bash
$env:WS_PORT="3001"
$env:HEALTH_PORT="9091"
$env:REDIS_URL="redis://127.0.0.1:6379"
npm run websocket
```

**Terminal 2 (WS Node 2):**
```bash
$env:WS_PORT="3003"
$env:HEALTH_PORT="9092"
$env:REDIS_URL="redis://127.0.0.1:6379"
npm run websocket
```

### 3.3 Start Next.js Application
**Terminal 3:**
```bash
npm run dev
# App listens on http://localhost:3000
```

---

## 4. Staging Data Pool & Persona Initialization

The repository includes a permanent staging pool generator:
* 50 Drivers
* 50 Buses
* 2,000 Students

### 4.1 Seed Staging Personas
```bash
npm run staging:personas
```
* Creates deterministic identities without overwriting production records.

### 4.2 Run Staging Verification Probe
```bash
npm run staging:probe
```
* Validates database connectivity, active trips table, bus capacity records, and route allocations.

### 4.3 Clean Staging Runtime State (Reset Trips & Locks)
```bash
npm run staging:cleanup
```

---

## 5. Critical Invariant Reproduction Scenarios

### 5.1 Active WebSocket Session Revocation (INV-AUTH-003)
1. Connect a WebSocket client to WS Node 1 (`ws://localhost:3001`).
2. Authenticate as user `mod_test_123` with role `moderator`.
3. Verify socket is active and receiving messages.
4. From another terminal, publish a role invalidation to Redis:
   ```bash
   docker exec -it itms-redis redis-cli publish role_invalidate "mod_test_123"
   ```
5. **Observed Result:** WS Node 1 immediately closes the connection with code `4401` ("Role revoked or permissions modified - please re-authenticate").

### 5.2 Device Session Exclusivity (INV-AUTH-004)
1. Establish active session for Driver `drv_100` on Device `DEV_ALPHA`:
   ```bash
   curl -X POST http://localhost:3000/api/driver/device-session \
     -H "Content-Type: application/json" \
     -d '{"action":"register","feature":"driver_location_share","deviceId":"DEV_ALPHA"}'
   ```
2. Attempt to submit GPS from a secondary device `DEV_BETA`:
   ```bash
   curl -X POST http://localhost:3000/api/location/update \
     -H "Content-Type: application/json" \
     -H "x-device-id: DEV_BETA" \
     -d '{"busId":"BUS-01","lat":26.15,"lng":91.77,"deviceId":"DEV_BETA"}'
   ```
3. **Observed Result:** HTTP `403 Forbidden` with body:
   ```json
   {
     "success": false,
     "error": "Active session exists on another device. Location update rejected.",
     "code": "ANOTHER_DEVICE_ACTIVE"
   }
   ```

### 5.3 Fail-Closed GPS on Redis Disconnect (INV-GPS-005)
1. Run the dedicated test:
   ```bash
   npx vitest run src/lib/security/__tests__/security-boundaries-master.test.ts -t "fails closed"
   ```
2. **Observed Result:** `atomicGpsGuardAndUpdate` returns `'redis_unavailable'` when Redis is down; no memory mutation occurs.

### 5.4 Bus Capacity Concurrency Verification (INV-CAP-001)
1. Execute the concurrent session activation / capacity test:
   ```bash
   npx vitest run src/lib/services/__tests__/session-activation-concurrency.test.ts
   ```
2. **Observed Result:** Parallel seat allocations serialize via database row locks; total occupied seats never exceeds capacity.

---

## 6. End-to-End Playwright Browser Verification

Execute the golden E2E test suites against the running Next.js + WS cluster:

```bash
# Run the complete golden E2E battery
npm run test:e2e:golden

# Run resilience & reconnect tests
npm run test:e2e:resilience
npm run test:e2e:reconnect

# Run cross-node Redis synchronization tests
npm run test:e2e:redis
```

---

## 7. Teardown & Environment Cleanup

To stop background processes and clean container state:

```bash
# Stop all Docker services
docker compose -f docker-compose.prod.yml down

# Clean temporary test artifacts
npm run staging:cleanup
```
