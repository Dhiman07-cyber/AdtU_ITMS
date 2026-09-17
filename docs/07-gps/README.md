# 07. GPS & Location Integrity

Welcome to the GPS & Real-Time Location Engineering documentation for the **Assam down town University (AdtU) Intelligent Transport Management System (ITMS)**.

This section contains the authoritative forensic audit, real-browser Playwright simulation suites, location pipeline integrity proofs, and live fleet monitoring documentation.

---

## 📑 Documents in This Directory

### 1. [ADTU_ITMS_GPS_REAL_WORLD_FORENSIC_AUDIT_RUTH.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps/ADTU_ITMS_GPS_REAL_WORLD_FORENSIC_AUDIT_RUTH.md)
* **Author:** **Ruth** (Lead Forensic Engineering & Verification Agent)
* **Classification:** Canonical Master Report & Architectural Proof
* **Contents:**
  - Executive summary and verification verdicts
  - Complete 10-step Source-to-Screen GPS pipeline
  - Individual answers with measured data for **Sir's 10 Questions**
  - Real authenticated Playwright browser simulation results
  - Waiting flag trust boundaries, abuse testing, and geofence findings
  - Admin & Moderator live fleet map architecture and verification
  - Docker optimization analysis (fixing the 857 MB build context bottleneck)
  - Phone to dedicated onboard GPS hardware readiness roadmap

### 2. [ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps/ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md)
* Standard canonical copy of the master forensic report for university review and submission.

---

## 🧭 Source-to-Screen GPS Telemetry Pipeline

```
Driver Phone / Playwright Geolocation Emulation
  │
  ▼ [navigator.geolocation.watchPosition]
Driver Page React State (`src/app/driver/live-tracking/page.tsx`)
  │
  ▼ [setInterval broadcastLocation: 2000ms]
HTTP POST `/api/location/update`
  │
  ├─ 1. Security Gateway (`src/lib/security/api-security.ts`)
  │     - Firebase Bearer token verification
  │     - Driver role validation
  │     - Active device session check (`device_sessions` table)
  │     - Rate limit enforcement (240 req/min)
  │
  ├─ 2. Pipeline Bounds Normalization (`src/domains/gps/services/gps-pipeline.service.ts`)
  │     - Coordinate rounding (6 decimal places)
  │     - Null Island guard (lat=0, lng=0 rejected)
  │     - Speed cap (<= 200 km/h)
  │     - Accuracy threshold (<= 150m rejected)
  │
  ├─ 3. Active Trip Authority (`src/domains/gps/services/gps-persistence.service.ts`)
  │     - Verifies `active_trips` in PostgreSQL (bus_id, driver_id, status = 'active')
  │
  ├─ 4. Distributed Multi-Node Atomic Guard (`src/domains/gps/services/gps-redis-guard.ts`)
  │     - Redis Lua script (`atomicGpsGuardAndUpdate`) on `gps:last:<busId>` (TTL 1200s)
  │     - Out-of-order raw timestamp replay rejection (`stale_raw`)
  │     - Instantaneous jump rejection (>5000m)
  │     - Speed jump rejection (>200 km/h)
  │     - Fail-Closed: Rejects packet if Redis cluster is unreachable
  │
  ├─ 5. Database Persistence Throttling (`src/app/api/location/update/route.ts`)
  │     - `active_trips` heartbeat (1 write / 20s): extends `expires_at` by 600s
  │     - `bus_locations` breadcrumb (1 write / 30s): persists latest known fix for fallback
  │
  ▼ [emitEvent: WebSocket Transport]
WebSocket Server (Port 3001) & Redis Pub/Sub Relay
  │
  ▼ [WebSocket channel: `bus_location_${busId}`]
Student Browser / Admin Fleet Map
  │
  ▼ [`useBusLocation` monotonic packet guard]
MapLibre GL Canvas (`GuwahatiMap.tsx` / `FleetMap.tsx`)
  - 1000ms quartic ease-out interpolation (`animateMarkerTo`)
```

---

## 🧪 Related Test Suites & Benchmark Artifacts

### Automated Playwright & Vitest Suites
- **Real-Browser Simulation:** [`e2e/gps/gps-realistic-simulation.spec.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/e2e/gps/gps-realistic-simulation.spec.ts)
- **Waiting Flag Abuse:** [`e2e/gps/waiting-flag-abuse.spec.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/e2e/gps/waiting-flag-abuse.spec.ts)
- **Stale Packet & Impossible Jumps:** [`e2e/gps/gps-stale-packet.spec.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/e2e/gps/gps-stale-packet.spec.ts)
- **GPS Reliability Unit Tests:** [`src/domains/gps/__tests__/gps-reliability.test.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/gps/__tests__/gps-reliability.test.ts)
- **Real-Time Location Guard:** [`src/domains/realtime/__tests__/location-packet-guard.test.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/realtime/__tests__/location-packet-guard.test.ts)

### Benchmarks & Tooling
- **Canonical Guwahati Route Fixture:** [`scripts/gps/gps-route-fixture.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/scripts/gps/gps-route-fixture.ts)
- **Route Deviation Calculator:** [`scripts/gps/route-deviation-calculator.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/scripts/gps/route-deviation-calculator.ts)
- **Benchmark Runner:** [`scripts/gps/gps-route-runner.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/scripts/gps/gps-route-runner.ts)
- **Machine-Readable Telemetry Artifacts:** [`artifacts/gps-audit/run-2026-09-17T07-59-48/`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/artifacts/gps-audit/run-2026-09-17T07-59-48/)
