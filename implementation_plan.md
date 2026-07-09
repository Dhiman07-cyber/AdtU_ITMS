# Implementation Plan — D7 Route End-to-End Migration & Permanent Freeze (Final Corrected Architecture)

This plan outlines the steps required to migrate the D7 Route domain from Firestore (`routes` collection) to Supabase PostgreSQL (`routes` table) under a strictly isolated master-data architecture. Route owns ONLY Route master data, Route CRUD, Route metadata, Route names, Route stops, Route ordering, and Route status. It does NOT own buses, drivers, students, trips, or applications, and MUST NEVER update their persistence.

## User Review Required

> [!IMPORTANT]
> - **CRITICAL CORRECTION 1**: The `assigned_buses` and `updated_by` columns are completely removed from the PostgreSQL `routes` schema. All references to assigned buses are derived by querying the Fleet domain.
> - **CRITICAL CORRECTION 2**: No cross-domain fallback exists. `GET /api/routes/[id]/stops` will look up the route and return its stops or return Not Found; it will never query Fleet.
> - **CRITICAL CORRECTION 3**: Updating a route will never update bus persistence. `PUT /api/routes/[id]/update` is removed as dead code, and `/api/routes/update` will only modify the route document in PostgreSQL.
> - **CRITICAL CORRECTION 4 (NO EXTRAS)**: Firestore route documents have been inspected and every single field is fully mapped. The `extras` JSONB column is completely omitted from the PostgreSQL routes table.
> - **CRITICAL CORRECTION 5 (SINGLE STATUS FIELD, NO DUPLICATION)**: The duplicate `active` BOOLEAN column is removed. The `status` column is the single source of truth in PostgreSQL (`status IN ('active', 'inactive')`). During migration:
>   - Firestore `active = true` -> `status = 'active'`
>   - Firestore `active = false` -> `status = 'inactive'`
>   - If both `active` and `status` are present in Firestore, they are normalized and checked for consistency. A mismatch will fail migration validation.
>   - Legacy compatibility adapters (like `dataService.ts`) will append `active: status === 'active'` for legacy client compatibility, but the Route Domain (Service and Repository) only uses and returns the canonical `status`.
> - **CRITICAL CORRECTION 6 (BULK UNASSIGN)**: Instead of iterating and calling individual updates, a high-performance bulk unassign capability is added to Fleet and Student repository pg layers, executing a single SQL update query:
>   - `fleetService.unassignRoute(routeId)` -> `fleetRepository.unassignRoute(routeId)` -> `fleetRepository.pg.pgUnassignRoute(routeId)` -> `UPDATE buses SET route_id = NULL, route_name = NULL WHERE route_id = $1`
>   - `studentService.unassignRoute(routeId)` -> `studentRepository.unassignRoute(routeId)` -> `studentRepository.pg.pgUnassignRoute(routeId)` -> `UPDATE student_profiles SET route_id = NULL, assigned_route_id = NULL, stop_id = NULL, stop_name = NULL WHERE route_id = $1 OR assigned_route_id = $1`
>   - `cleanup-helpers.ts` coordinates these calls sequentially without doing any iterations or direct database writes itself.
> - The Firestore security rules for `/routes/{routeId}` will be locked to `allow read, write: if false;`.
> - All client-side components and API endpoints will use the PostgreSQL-backed Route Service.

## Proposed Changes

### Database Layer

#### [NEW] [20260708_d7_routes.sql](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/supabase/migrations/20260708_d7_routes.sql)
- Define PostgreSQL `routes` table:
  - `id` (text, primary key) — maps to Firestore doc ID / `routeId`
  - `route_id` (text, unique, not null)
  - `route_name` (text, not null)
  - `stops` (jsonb, default `[]`)
  - `total_stops` (integer, default 0)
  - `estimated_time` (text)
  - `status` (text, default 'active' check constraint `status IN ('active', 'inactive')`)
  - `created_at` (timestamptz, default now())
  - `updated_at` (timestamptz, default now())
- Add indices on `route_id` and `status`.
- Add trigger to automatically update `updated_at` on row modification.

---

### Fleet Domain Extensions

#### [MODIFY] [fleet.repository.pg.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/fleet/repositories/fleet.repository.pg.ts)
- Implement `pgUnassignRoute(routeId)` to perform a single SQL update clearing route references from the `buses` table.

#### [MODIFY] [fleet.repository.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/fleet/repositories/fleet.repository.ts)
- Add and export `unassignRoute(routeId)` delegating to `pgUnassignRoute(routeId)`.

#### [MODIFY] [fleet.service.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/fleet/services/fleet.service.ts)
- Add and export `unassignRoute(routeId)` calling the repository `unassignRoute` method.

#### [MODIFY] [index.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/fleet/index.ts)
- Export `unassignRoute` from Fleet public surface.

---

### Student Domain Extensions

#### [MODIFY] [student.repository.pg.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/student/repositories/student.repository.pg.ts)
- Implement `pgUnassignRoute(routeId)` to perform a single SQL update clearing route references from the `student_profiles` table.

#### [MODIFY] [student.repository.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/student/repositories/student.repository.ts)
- Add and export `unassignRoute(routeId)` delegating to `pgUnassignRoute`.

#### [MODIFY] [student.service.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/student/services/student.service.ts)
- Add and export `unassignRoute(routeId)` calling repository `unassignRoute` method.

#### [MODIFY] [index.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/student/index.ts)
- Export `unassignRoute` from Student public surface.

---

### Route Domain Implementation

#### [NEW] [route.repository.pg.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/route/repositories/route.repository.pg.ts)
- Create PostgreSQL repository using Supabase client:
  - `pgFindAll()`: Return list of all routes from PG (maps database `status` to domain `status`).
  - `pgFindById(id)`: Return single route from PG.
  - `pgUpdate(id, data)`: Update fields in PG routes table (normalizes status to lowercase).
  - `pgRemove(id)`: Delete route row from PG.
  - `pgInsert(data)`: Create route in PG (normalizes status to lowercase).
  - `pgUpsert(data)`: Upsert route in PG (normalizes status to lowercase, for migration).
  - `pgCount()`: Return count of routes.
- Translate camelCase to snake_case column names and handle Timestamps.

#### [MODIFY] [route.repository.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/route/repositories/route.repository.ts)
- Remove all Firestore wrapper imports.
- Delegate all operations exclusively to `route.repository.pg.ts`.

#### [MODIFY] [route.service.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/route/services/route.service.ts)
- Evolve functions to serve as a thin business-logic facade over `route.repository.ts`.
- **CRITICAL**: No propagation to buses, drivers, or students. It performs CRUD only on Route data.

---

### Compatibility Facade & Cleanup Helpers (Orchestration)

#### [MODIFY] [dataService.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/dataService.ts)
- Refactor `getAllRoutes`, `getRouteById`, `deleteRoute`, `updateRoute`, and `addRoute` to delegate to `routeService` rather than Firestore.
- In `getAllRoutes` and `getRouteById` legacy methods, dynamically map `active = status === 'active'` on the returned objects.
- Evolve `getAllRouteNames` and `getAllStops` to call Route Service.

#### [MODIFY] [cleanup-helpers.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/cleanup-helpers.ts)
- Refactor `deleteRouteAndData` (orchestrator) to call public APIs only:
  1. Call `fleetService.unassignRoute(routeId)` to clear route on buses in PG (single SQL update).
  2. Call `studentService.unassignRoute(routeId)` to clear route on students in PG (single SQL update).
  3. Call `routeService.remove(routeId)` to delete the route from PG.
- Remove all direct database reads/updates/loops from `cleanup-helpers.ts`.

#### [MODIFY] [bus-capacity-checker.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/bus-capacity-checker.ts)
- Replace direct Firestore `routes` collection query with Route Service `getAll()` call.

---

### Analytics & Auxiliary Services

#### [MODIFY] [analytics.repository.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/analytics/repositories/analytics.repository.ts)
- Replace direct Firestore `routes` collection query with Route Service `getAll()`.
- Update the `DashboardRawData` contract: change `routesSnapshot` to `routes: Route[]`.

#### [MODIFY] [analytics.service.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/analytics/services/analytics.service.ts)
- Adapt metric calculations to consume the `routes` array directly, instead of docs snapshots.

#### [MODIFY] [analytics.service.test.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/analytics/__tests__/analytics.service.test.ts)
- Update mock configuration for the analytics repository.

#### [MODIFY] [start-trip/route.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/driver/start-trip/route.ts)
- Replace Firestore doc query with Route Service `getById()`.

#### [MODIFY] [dashboard-data/route.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/student/dashboard-data/route.ts)
- Replace Firestore doc query with Route Service `getById()`.

---

### API Routing & Migration Implementation

#### [NEW] [d7-route.migration.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/domains/route/migrations/d7-route.migration.ts)
- Implement `routeMigration` implementing `MigrationDefinition` contract.
- `up()`: Fetch routes from Firestore and upsert them into PostgreSQL via `pgUpsert`.
- `validate()`: Verify counts, verify consistency of Firestore active and status flags, and check a sample of IDs.
- `down()`: Clear routes table in PostgreSQL.

#### [NEW] [route.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/admin/migrations/run-route/route.ts)
- Implement API controller to invoke Route migration via MigrationRunner.

#### [DELETE] [update/route.ts](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/routes/%5Bid%5D/update/route.ts)
- Delete dead-code endpoint.

#### [MODIFY] API routes under `/api/routes`
- Update endpoints to query PostgreSQL *only* via Route Service:
  - `GET /api/routes`: Call Route service `getAll()` (allow student/driver/moderator/admin).
  - `POST /api/routes` & `/api/routes/create`: Call Route service `create()`.
  - `GET /api/routes/[id]`: Call Route service `getById()` (allow student/driver/moderator/admin).
  - `GET /api/routes/[id]/stops`: Call Route service `getById()`, return stops or return 404 (No fallback, no cross-domain lookup).
  - `POST /api/routes/update`: Call Route service `update()`.

---

### Security Freeze

#### [MODIFY] [firestore.rules](file:///C:/Users/ADMIN/Desktop/Projects/ITMS/firestore.rules)
- Update `/routes/{routeId}` security rules to `allow read, write: if false;`.

## Verification Plan

### Automated Tests
- Run TypeScript checking: `npx tsc --noEmit`
- Run test suites: `npx vitest run`
- Build verification: `npm run build`

### Manual Verification
- Execute `POST /api/admin/migrations/run-route?action=run` to execute migration.
- Execute `POST /api/admin/migrations/run-route?action=validate` to confirm integrity and counts match.
