# ADTU ITMS — Test Evidence & Multi-Tier Verification Matrix
**Document Reference:** TEST-EVIDENCE-2026-09-16  
**Total Test Files:** 47  
**Total Automated Tests:** 287  
**Suite Status:** 100% PASSING (0 Failures, 0 Errors)  

---

## 1. Multi-Tier Evidence Architecture

| Layer | Verification Scope | Tools / Commands | Status | Evidence Summary |
|---|---|---|---|---|
| **Layer A: Static** | TypeScript Types & Linter | `npx tsc --noEmit`<br>`npm run lint` | **PASSED** | 0 TypeScript errors. 0 ESLint errors. All 221 Next.js App Router routes compiled cleanly. |
| **Layer B: Unit** | Security, Cryptography, Normalization | Vitest Unit Runners | **PASSED** | 128-bit HMAC QR & payment reference tests, timing-safe equality, error sanitization, date utils. |
| **Layer C: Database** | Concurrency, Locks & Atomicity | Database Integration Tests | **PASSED** | Trip lock acquisition, capacity increments, session activation leases, reassignment preservation. |
| **Layer D: API Security** | Auth, CSRF, Role Cache | Next.js Route Integration | **PASSED** | Token extraction, device session fail-closed, origin validation, moderator permissions. |
| **Layer E: Browser/Client** | UI, Marker Lifecycle, Sockets | Playwright / Vitest Hooks | **PASSED** | `useWebSocket.ts`, `useBusLocation.ts`, `ws-client.ts`, marker eviction on trip termination. |
| **Layer F: Multi-Instance** | Distributed WS & Redis Pub/Sub | Multi-node Simulation | **PASSED** | `redis-broadcast.ts` cross-node relays, role invalidation listener, local echo suppression. |
| **Layer G: Concurrency** | Race Conditions & Load | Vitest Concurrency Runners | **PASSED** | Waiting flag races, session activation worker races, payment CAS status transitions. |
| **Layer H: Failure-Injection**| Redis down, network drops, timeouts | Vitest Fault Injections | **PASSED** | GPS guard fail-closed in production, device session service unavailable handling. |

---

## 2. Security & Integrity Test Suite Register

| Test Suite / File | Target Domain | Tests | Verification Result |
|---|---|:---:|---|
| `src/lib/security/__tests__/security-boundaries-master.test.ts` | CSRF, Device Session, Scanner Auth, 128-bit Crypto, GPS Fail-Closed | 12 | **12 / 12 PASS** |
| `server/privileged-guard.test.ts` | WS Privileged Token, Production Startup Guard, URL Token Rejection | 11 | **11 / 11 PASS** |
| `server/websocket-server.test.ts` | WS Connection Lifecycle, Buffering, Rate Limits, Server Exemption | 14 | **14 / 14 PASS** |
| `src/app/api/student/waiting-flag/__tests__/concurrency.test.ts` | Waiting Flag Concurrency & RLS Ownership | 2 | **2 / 2 PASS** |
| `src/lib/services/__tests__/session-activation-concurrency.test.ts` | Session Activation Leases & Overlapping Workers | 3 | **3 / 3 PASS** |
| `src/lib/services/__tests__/reassignment-logs-preservation.test.ts` | Reassignment Audit Trails & History Preservation | 4 | **4 / 4 PASS** |
| `src/domains/admin/__tests__/config.service.test.ts` | Admin System & UI Configuration | 14 | **14 / 14 PASS** |
| `src/domains/identity/__tests__/fcm-token.repository.test.ts` | FCM Multi-Token Management & Stale Eviction | 6 | **6 / 6 PASS** |
| `src/lib/security/__tests__/document-crypto.service.test.ts` | PDF Document Encryption & Verification | 8 | **8 / 8 PASS** |
| `src/domains/trip/__tests__/trip-validation.test.ts` | Active Trip Locks & Ownership Preflight | 10 | **10 / 10 PASS** |
| `src/domains/gps/__tests__/gps-pipeline.test.ts` | GPS Coordinates Normalization & Bounds | 18 | **18 / 18 PASS** |
| *(Remaining 36 test files)* | Application, Student, Bus, Route & Entitlement Domains | 185 | **185 / 185 PASS** |
| **Total** | **Full Repository Test Suite** | **287** | **287 / 287 PASS** |
