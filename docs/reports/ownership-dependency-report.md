# Ownership Dependency Report

## Purpose

Catalog every code path that reads or writes driver-to-bus ownership, classify each as Runtime Critical or Admin/Operational, and determine whether the reference can be deleted or must be migrated to `driver_assignments`.

---

## 1. Database Columns

| Column | Table | Write Sources | Read Sources | Runtime Critical | Action |
|--------|-------|---------------|--------------|------------------|--------|
| `driver_uid` | `buses` | `assign_drivers_atomically` RPC, `driver-swap-supabase.ts`, `buses/create`, `buses/update`, `admin/create-user`, `moderator/create-user`, `admin/set-driver-reserved` | `start-journey-v2`, `check-active-trip`, `can-operate`, `fcm-notification-service`, `dashboard-data`, `dashboard-counts`, `check-swap-status`, `end-journey-v2`, `handle-profile-update`, admin/moderator UI pages | Yes | Drop after B |
| `bus_id` | `driver_profiles` | `assign_drivers_atomically` RPC, `driver-swap-supabase.ts`, `buses/create`, `buses/update`, `admin/create-user`, `admin/set-driver-reserved`, `cleanup-service` | `dashboard-data`, `missed-bus-service`, `driver/page.tsx`, `live-tracking`, admin/moderator UI pages | Yes | Drop after B |
| `assignedDriverId` | `buses` (Firestore) | `buses/create`, `buses/update`, `admin/set-driver-reserved` | `dashboard-counts`, `check-swap-status`, `handle-profile-update`, `get-pending-profile-requests`, `set-driver-reserved`, admin/moderator UI pages, `driver/page.tsx`, `driver-swap-supabase.ts` | No | Drop after D |
| `activeDriverId` | `buses` (Firestore) | `buses/create`, `buses/update`, `admin/set-driver-reserved`, `accept-swap` | `dashboard-counts`, `check-swap-status`, admin/moderator UI pages, `driver/page.tsx` | No | Drop after D |
| `driver_uid` | `temporary_assignments` | swap system | `get_effective_driver` function | No | Drop after D (superseded by `driver_assignments`) |

---

## 2. API Routes — Readers

| Route | Reads | Runtime Critical | Migrate to `driver_assignments` in |
|-------|-------|------------------|------------------------------------|
| `driver/dashboard-data` | `driver_profiles.bus_id`, `buses.driver_uid` | Yes | Milestone B |
| `driver/start-journey-v2` | `buses.driver_uid` | Yes | Milestone B |
| `driver/end-journey-v2` | `buses.driver_uid` | Yes | Milestone B |
| `driver/check-active-trip` | `buses.driver_uid` | Yes | Milestone B |
| `driver/can-operate` | `buses.driver_uid` | Yes | Milestone B |
| `driver/update-location` | `buses.driver_uid` | Yes | Milestone B |
| `driver/check-swap-status` | `buses.driverUID/assignedDriverId/activeDriverId` | No | Milestone C |
| `driver/handle-profile-update` | `buses.assignedDriverId/driverUID` | No | Milestone C |
| `driver/get-pending-profile-requests` | `buses.assignedDriverId` | No | Milestone C |
| `admin/dashboard-counts` | `buses.driverUID/assignedDriverId/activeDriverId` | No | Milestone C |
| `buses/route` | `buses.driverUID` | No | Milestone C |
| `buses/[id]/route` | `buses.driverUID` | No | Milestone C |

---

## 3. API Routes — Writers

| Route | Writes | Runtime Critical | Migrate in |
|-------|--------|------------------|------------|
| `buses/create` | `buses.driverUID/assignedDriverId/activeDriverId`, `driver_profiles.bus_id` | No (admin) | Milestone C |
| `buses/update` | `buses.driverUID/assignedDriverId/activeDriverId`, `driver_profiles.bus_id` | No (admin) | Milestone C |
| `admin/create-user` | `buses.driverUID`, `driver_profiles.bus_id` | No (admin) | Milestone C |
| `admin/set-driver-reserved` | `buses.driverUID/assignedDriverId/activeDriverId`, `driver_profiles.bus_id` | No (admin) | Milestone C |
| `moderator/create-user` | `buses.driverUID`, `driver_profiles.bus_id` | No (admin) | Milestone C |
| `fleet/assign-drivers` | `buses.driver_uid`, `driver_profiles.bus_id` via RPC | Yes (fleet ops) | Milestone B |
| `driver-swap/*` | `driver_uid` on buses, `bus_id` on driver_profiles | No | Milestone C |

---

## 4. SQL Functions / RPCs

| RPC | Touches | Runtime Critical | Action |
|-----|---------|------------------|--------|
| `assign_drivers_atomically` | `buses.driver_uid` + `driver_profiles.bus_id` | Yes | Rewrite in A to also write `driver_assignments` |
| `get_effective_driver` | `temporary_assignments` | Yes (swap) | Superseded by `driver_assignments.active` row; update in C |
| `expire_temporary_assignments` | `temporary_assignments` | No (cron) | Superseded by `driver_assignments`; update in C |
| `acquire_trip_lock` | `active_trips(bus_id)` | Yes | Verify ownership via `driver_assignments` in B |
| `release_trip_lock` | `active_trips(bus_id)` | Yes | Verify ownership via `driver_assignments` in B |

---

## 5. Services

| Service | Ownership Reads/Writes | Runtime Critical | Migrate in |
|---------|----------------------|------------------|------------|
| `fcm-notification-service.ts` | Reads `buses.driver_uid` | Yes | Milestone B |
| `trip-lock-service.ts` | Reads `active_trips.bus_id` | Yes | Milestone B |
| `missed-bus-service.ts` | Reads `driver.bus_id` | Yes | Milestone B |
| `reassignment-service.ts` | Reads `bus.driverUID` | No | Milestone C |
| `net-assignment-types.ts` | `BusSnapshot.assignedDriverId/activeDriverId` | No | Milestone C |
| `net-route-assignment-types.ts` | `busId` | No | Milestone C |
| `driver-swap-supabase.ts` | Writes `buses.driver_uid` + `driver_profiles.bus_id` | No | Milestone C |
| `cleanup-service.ts` | Reads/writes Firestore `buses.assignedDriverId/activeDriverId` | No | Milestone D |
| `integrity-detector.ts` | Detects orphan `student.busId` | No | Milestone D |

---

## 6. Hooks

| Hook | Reads | Runtime Critical | Migrate in |
|------|-------|------------------|------------|
| `useWaitingFlags` | `busId`, `ack_by_driver_uid` | Yes | Not ownership; keep |
| `useBusLocation` | `busId`, `driver_uid` (from bus_locations row) | Yes | Milestone B |
| `useMissedBus` | `busId` in notification templates | Yes | Not ownership; keep |

---

## 7. Cron / Background Jobs

| Job | Ownership Reference | Runtime Critical | Migrate in |
|-----|--------------------|------------------|------------|
| `cleanup-stale-locks` | `cleaned_bus_id`, `cleaned_driver_id` | No | Milestone B |
| `cleanup-swaps` | Temporary assignments by bus_id | No | Milestone C |
| `cleanup-expired-students` | Bus capacity by bus_id | No | Not ownership; keep |
| `integrity-sweep` | Orphan busId scans | No | Milestone D |

---

## 8. Types / Interfaces

| Type | Field | Delete in |
|------|-------|-----------|
| `Bus.driverUID` | `driverUID?: string` | Milestone D |
| `EnhancedBus.assignedDriverId` | `assignedDriverId?: string` | Milestone D |
| `EnhancedBus.activeDriverId` | `activeDriverId?: string` | Milestone D |
| `Driver.busId` | `busId?: string` | Milestone D |
| `DriverAssignment` (new) | `driverUid`, `busId`, `assignedAt`, `unassignedAt`, `assignedBy`, `isActive`, `reason` | Add in A |

---

## 9. Validation Schemas

| Schema | Ownership Field | Runtime Critical | Migrate in |
|--------|----------------|------------------|------------|
| `DriverSwapRequestSchema` | `fromDriverUID`, `toDriverUID`, `busId` | No | Milestone C |
| `BusIdSchema` | `busId` | Yes | Keep (generic bus ID) |

---

## 10. Tests

| Test File | Mocks/Owns | Update in |
|-----------|-----------|-----------|
| `fleet.service.test.ts` | `busId` field on bus mocks | Milestone B |
| `student.service.test.ts` | `busId` on student mocks | Not ownership; keep |
| `fcm-notification-service.test.ts` | `driver_uid` on bus mock | Milestone B |
| `trip.service.test.ts` | `bus_id` on active_trips mock | Milestone B |

---

## Summary by Milestone

| Milestone | Files | Add/Modify/Delete | Risk |
|-----------|-------|-------------------|------|
| **A** Ownership Foundation | ~8 files | Add table, types, repo, RPC dual-write | Low (additive) |
| **B** Runtime Migration | ~20 API/services/cron | Migrate readers + writers to `driver_assignments` | Medium (runtime paths) |
| **C** Admin + Swap | ~30 UI + swap files | Update admin UIs, swap system, validation | Medium (tooling) |
| **D** Destructive Cleanup | ~15 schema + type files | Drop columns, remove dead code, type cleanup | Low (after staging) |

---

## Dependency Delta (measurable migration progress)

Each milestone ends with a delta showing architecture getting simpler.

### Legend

| Metric | Definition |
|--------|------------|
| Runtime readers | Production API/services/hooks that *read* `buses.driver_uid` or `driver_profiles.bus_id` |
| Runtime writers | Production API/services/hooks that *write* `buses.driver_uid` or `driver_profiles.bus_id` |
| Admin readers | Admin/moderator UIs that read legacy fields |
| Admin writers | Admin/moderator APIs that write legacy fields |
| Dual writes | Code paths that write *both* old columns and `driver_assignments` |
| Legacy columns | Database columns still present |

### Baseline (Before Milestone A)

```
Runtime readers:    18
Runtime writers:    11
Admin readers:      14
Admin writers:       7
Dual writes:         0
Legacy columns:      4  (buses.driver_uid, driver_profiles.bus_id, assignedDriverId, activeDriverId)
```

### After Milestone A — Ownership Foundation

```
Runtime readers:    18   (unchanged — no runtime changes yet)
Runtime writers:    11   (unchanged — no runtime changes yet)
Admin readers:      14   (unchanged)
Admin writers:       7   (unchanged)
Dual writes:         1   (assign_drivers_atomically RPC)
Legacy columns:      4   (new column: driver_assignments.* added)
```

### After PR-005 — Runtime Reader Migration

```
Runtime readers:     0   (PR-005: all runtime reads of buses.driver_uid / driver_profiles.bus_id migrated)
Runtime writers:    11   (unchanged — all writes still go to legacy columns)
Admin readers:      14   (unchanged)
Admin writers:       7   (unchanged)
Dual writes:         1   (assign_drivers_atomically RPC)
Legacy columns:      4
```

### After PR-006 — Admin + Swap Writer Migration (current)

```
Runtime readers:     0   (unchanged — still zero)
Runtime writers:     5   (6 admin/swap file pairs migrated to assignDriverToBus)
Admin readers:       6   (dashboard, analytics, swap-status, profile-update, pending-requests migrated)
Admin writers:       2   (5 admin routes migrated; buses/route + buses/[id] remain)
Dual writes:         1   (assign_drivers_atomically RPC still dual-writes)
Legacy columns:      4   (still present, Milestone D target)
```

### Target After Milestone D — Destructive Cleanup

```
Runtime readers:     0
Runtime writers:     0
Admin readers:       0
Admin writers:       0
Dual writes:         0
Legacy tables:       0   (temporary_assignments dropped)
Legacy columns:      0   (buses.driver_uid, driver_profiles.bus_id, assignedDriverId, activeDriverId dropped)
Legacy indexes:      0   (idx_buses_driver_uid, idx_driver_profiles_bus_id dropped)
Legacy RPCs:         0   (get_effective_driver, expire_temporary_assignments dropped if superseded)
Legacy endpoints:    0   (swap API routes removed)
Compatibility wrappers: 0 (compat field maps removed)
Compatibility types:    0 (EnhancedBus, driverUID on Bus, busId on Driver removed)
```
