# 07. GPS & Location Integrity

Welcome to the GPS & Real-Time Location Engineering documentation for the **Assam down town University (AdtU) Intelligent Transport Management System (ITMS)**.

This section contains the authoritative forensic audit, real-browser Playwright simulation suites, location pipeline integrity proofs, and live fleet monitoring documentation.

---

## 📑 Documents in This Directory

### 1. [ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md)
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

### 2. [ADTU_ITMS_BUS_MARKER_ROUTE_ALIGNMENT_FINAL_REPORT.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/ADTU_ITMS_BUS_MARKER_ROUTE_ALIGNMENT_FINAL_REPORT.md)
* Comprehensive report detailing the MapLibre bus marker route alignment, interpolation dynamics, easing curves, and client-side telemetry smoothing.

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
  │     - Zero database writes for high-frequency GPS fixes; state managed via Redis & WS
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

---

## 4. Comprehensive Low-Level Design (LLD) Breakdown & Justifications

### 4.1 Ingress Geofence & Waiting Flag Abuse Guard (`src/domains/gps/services/waiting-flag.service.ts`)
- **Concrete Architectural Role**: Proximity and abuse barrier for student waiting flags. Verifies student assignment, ensures only 1 active flag per student (`idx_waiting_flags_one_active_student`), and validates that the bus is within an approaching radius before permitting flag submission.
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without proximity verification and database unique constraints, malicious or prankster students can submit dozens of flags from their dorm rooms for buses miles away, repeatedly buzzing the driver's phone while the vehicle is navigating heavy morning highway traffic.
  - Driver distraction caused by notification spam is a direct physical hazard in university transit operations.
- **State Taxonomy & Invariants Enforced**:
  - *Durable State & Ephemeral Realtime State* (`waiting_flags`).
  - *Passenger Integrity & Driver Exclusivity*.
- **Production Code Implementation**:
  ```sql
  -- File: supabase/COMPLETE_SCHEMA.sql (Partial Unique Index on waiting_flags)
  CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_flags_one_active_student
  ON waiting_flags (student_uid)
  WHERE status IN ('raised', 'acknowledged', 'waiting');
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Engine-Level Unique Index*: Guarantees that even if a student spams the "I'm Waiting" button with 20 parallel HTTP requests, PostgreSQL allows exactly 1 row to be inserted, rejecting the remaining 19 with zero application concurrency errors.

