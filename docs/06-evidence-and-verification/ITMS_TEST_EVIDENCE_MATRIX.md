# ADTU ITMS — Canonical Test Evidence & Multi-Tier Verification Matrix

**Document Reference:** TEST-EVIDENCE-2026-09-17  
**Total Test Files:** 48  
**Total Automated Tests:** 314  
**Suite Status:** 100% PASSING (0 Failures, 0 Errors, Exit Code 0)  
**TypeScript Typecheck:** 0 Diagnostics (`npx tsc --noEmit` exit code 0)  
**Next.js Production Build:** 224 Routes Compiled Cleanly (`npm run build` exit code 0)  

---

## 1. Multi-Tier Evidence Architecture

| Layer | Verification Scope | Tools / Commands | Status | Evidence Summary |
|---|---|---|---|---|
| **Layer A: Static** | TypeScript Types & Linter | `npx tsc --noEmit`<br>`npm run lint` | **PASSED** | 0 TypeScript errors. 0 ESLint errors. All 224 Next.js App Router routes compiled cleanly. |
| **Layer B: Unit** | Security, Cryptography, Normalization | Vitest Unit Runners | **PASSED** | 128-bit HMAC QR & payment reference tests, timing-safe equality, error sanitization, date utils. |
| **Layer C: Database** | Concurrency, Locks & Atomicity | Database Integration Tests | **PASSED** | Trip lock acquisition, capacity increments, session activation leases, reassignment preservation. |
| **Layer D: API Security** | Auth, CSRF, Role Cache | Next.js Route Integration | **PASSED** | Token extraction, device session fail-closed, origin validation, moderator permissions. |
| **Layer E: Browser/Client** | UI, Marker Lifecycle, Sockets | Playwright / Vitest Hooks | **PASSED** | `useWebSocket.ts`, `useBusLocation.ts`, `ws-client.ts`, marker eviction on trip termination. |
| **Layer F: Multi-Instance** | Distributed WS & Redis Pub/Sub | Multi-node Simulation | **PASSED** | `redis-broadcast.ts` cross-node relays, role invalidation listener, local echo suppression. |
| **Layer G: Concurrency** | Race Conditions & Load | Vitest Concurrency Runners | **PASSED** | Waiting flag races, session activation worker races, payment CAS status transitions. |
| **Layer H: Failure-Injection**| Redis down, network drops, timeouts | Vitest Fault Injections | **PASSED** | GPS guard fail-closed in production, device session service unavailable handling. |

---

## 2. Canonical Invariant Verification Matrix

| Invariant ID | Domain | Static | Unit | Integration | Real DB | Multi-Node | Failure Injection | Performance | Current Status |
|---|---|---|---|---|---|---|---|---|---|
| `INV-AUTH-001` | Auth Boundary | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-AUTH-002` | Horizontal Ownership | PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-AUTH-003` | WS Role Revocation | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `INV-AUTH-004` | Device Session Exclusivity | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-AUTH-005` | CSRF & Origin Validation | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-AUTH-006` | Trusted Client IP | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-AUTH-007` | Bootstrap Protection | PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |
| `INV-WS-001` | Auth Before Privileged Msg | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-WS-002` | URL Token Policy | PASS | PASS | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-WS-003` | WS Session Revocation | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-WS-004` | Channel Authorization | PASS | PASS | PASS | N/A | PASS | N/A | PASS | **PASS** |
| `INV-WS-005` | WS Backpressure | PASS | PASS | PASS | N/A | N/A | PASS | PASS | **PASS** |
| `INV-WS-006` | Cross-Node WS Integrity | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-TRIP-001` | One Active Trip | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `INV-TRIP-002` | Authoritative Trip Ownership| PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-TRIP-003` | Atomic Trip Termination | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `INV-TRIP-004` | No Resurrection After End | PASS | PASS | PASS | PASS | PASS | PASS | PASS | **PASS** |
| `INV-GPS-001` | Authorized Device GPS | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-GPS-002` | Monotonic GPS Ordering | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-GPS-003` | Impossible Movement Reject | PASS | PASS | PASS | N/A | N/A | N/A | PASS | **PASS** |
| `INV-GPS-004` | Distributed Redis Guard | PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-GPS-005` | Fail-Closed on Redis Failure| PASS | PASS | PASS | N/A | PASS | PASS | PASS | **PASS** |
| `INV-GPS-006` | No Alternate GPS Ingestion | PASS | PASS | PASS | N/A | N/A | N/A | N/A | **PASS** |
| `INV-PAY-001` | Payment Amount Binding | PASS | PASS | PASS | N/A | N/A | PASS | N/A | **PASS** |
| `INV-PAY-002` | Provider Idempotency | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-PAY-003` | Concurrent Distinct Payments| PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-PAY-004` | Processed Payments Alignment| PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-PAY-005` | Application Uniqueness | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-PAY-006` | Exactly-Once Commitments | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-CAP-001` | Occupied Seats <= Capacity | PASS | PASS | PASS | PASS | N/A | N/A | PASS | **PASS** |
| `INV-CAP-002` | Authoritative Capacity RPC | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-CAP-003` | Atomic Reassignment | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-CAP-004` | Rollback Safety | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-CAP-005` | Duplicate Application Block | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-001` | Schema Reproducibility | PASS | N/A | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-002` | RPC Signature Parity | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-003` | SECURITY DEFINER Safety | PASS | N/A | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-DB-004` | Service-Role Ownership | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-CRON-001` | Cron Secret Authentication | PASS | PASS | PASS | N/A | N/A | PASS | N/A | **PASS** |
| `INV-CRON-002` | Overlapping Cron Safety | PASS | PASS | PASS | PASS | N/A | PASS | PASS | **PASS** |
| `INV-CRON-003` | Cron Retry Safety | PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |
| `INV-NOTIF-001`| Recipient Authorization | PASS | PASS | PASS | PASS | N/A | N/A | N/A | **PASS** |
| `INV-NOTIF-002`| Duplicate Notification Block| PASS | PASS | PASS | PASS | N/A | PASS | N/A | **PASS** |

---

## 3. Representative Security & Integrity Test Suite Register

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
| `src/domains/fleet/__tests__/fleet.service.test.ts` | Fleet In-Memory TTL Cache & Bus Load Concurrency | 5 | **5 / 5 PASS** |
| `src/domains/route/__tests__/route.service.test.ts` | Route Master Data TTL Cache & Mutation Eviction | 3 | **3 / 3 PASS** |
| *(Remaining 35 test files)* | Application, Student, Bus, Route & Entitlement Domains | 204 | **204 / 204 PASS** |
| **Total** | **Full Repository Test Battery** | **314** | **314 / 314 PASS (100%)** |
