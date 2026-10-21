# Trip Lifecycle Architecture, Driver Initiation & Live Passenger Dataflow (Forensic Truth)

**Module:** End-to-End Trip Lifecycle, Start-Trip Initiation, Three-Way Locks & Student Tracking Frontend  
**File Authority:** `src/app/driver/page.tsx`, `src/app/student/track/page.tsx`, `src/app/api/trips/start/route.ts`, `src/app/api/trips/active/route.ts`  
**Database Tables:** `active_trips`, `trip_history`, `buses`, `routes`, `stops`  

---

# PART 2: Driver Trip Initiation — From "Start Trip" Button Press to Lock Acquisition & Cache Priming

### 2.1 Sub-Domain Architecture & Exact Execution Pipeline

Driver trip initiation transitions a stationary, off-duty university bus into an active, tracked transit asset. The initiation architecture enforces single-driver exclusivity, dynamic bus binding via QR or selection, multi-tenant shift validation, and zero-DB-read hot-path cache priming.

#### Detailed End-to-End Sequence & Execution Pipeline
```
[ Driver UI: Start Trip Button ]
           |
           | User clicks "Start Trip" or scans Bus QR
           v
[ Client Validation & Device Binding ]
   - Extracts/generates deviceId via localStorage ('adtu_device_id')
   - Checks device session: POST /api/driver/device-session (action: 'check')
   - Registers session: POST /api/driver/device-session (action: 'register')
           |
           | POST /api/driver/initiate-trip
           | Payload: { busId: "bus_01", shift: "Morning", deviceId: "uuid-..." }
           v
[ Next.js API Layer: withSecurity Middleware ]
   - Rate Limit Check: RateLimits.CREATE (10 req / 60s per IP/UID) -> 429 if exceeded
   - Token & Role Verification: auth.uid must have role 'driver' -> 401/403 if unauthorized
   - Schema Parse: InitiateTripSchema (shift capitalized & constrained to 'Morning'|'Evening')
           |
           v
[ Domain Orchestrator: tripService.startTrip() ]
   - normalizeShift("Morning") -> 'morning'
   - tripStartPreflight(driverId, busId):
       * Executes Promise.all([
           supabase.from('buses').select('id, bus_number, route_id, route_name, status').eq('id', busId).maybeSingle(),
           supabase.from('active_trips').select('trip_id, driver_id, expires_at').eq('bus_id', busId).eq('status', 'active').maybeSingle(),
           supabase.from('active_trips').select('trip_id, bus_id, expires_at').eq('driver_id', driverId).eq('status', 'active').maybeSingle()
         ])
       * Check 1: Bus existence & status (must not be 'inactive')
       * Check 2: Driver concurrency invariant (driver not active on another bus)
       * Check 3: Bus lock status (if active by other driver and expires_at > now -> conflict)
       * Check 4: Idempotency (if active by same driver -> return existingTripId)
   - Route Resolution:
       * Checks preflight.busData?.route_id
       * resolveRouteName(routeId): In-memory Map (5-min TTL) with singleflight promise deduplication
           |
           +-----------------------------+-----------------------------+
           | (If Idempotent Resume)                                    | (If New Trip)
           v                                                           v
   Return { success: true,                                    tripLockService.startTrip(...)
            tripId: existingTripId,                                    |
            alreadyActive: true }                                      v
                                                              RPC: acquire_trip_lock
                                                              (See Part 1.3 for SQL steps)
                                                                       |
                                                                       v
                                                              Clean Slate Invalidation:
                                                              - invalidateActiveTripCache(busId, driverId)
                                                                (purges negativeLockCache, positiveLockCache)
                                                              - clearRedisTripLock(busId) -> DEL trip:active:<busId>
                                                              - invalidateBusTripSnapshot(busId)
                                                              - clearInMemoryLastLocation(busId)
                                                                       |
                                                                       v
                                                              Broadcast Trip Event:
                                                              - broadcastTripEvent({
                                                                  busId, tripId, event: 'trip_started',
                                                                  driverId, routeId, shift, busNumber
                                                                })
                                                              - Emits to WebSocket channel: trip-status-<busId>
                                                                       |
                                                                       v
                                                              Push Notification Fan-Out:
                                                              - dispatchFcmBounded(dispatchTripNotification(...), 5000ms)
                                                                (Detailed in Part 3)
                                                                       |
                                                                       v
                                                              Hot-Path Cache Priming:
                                                              - positiveLockCache.set(`${driverId}:${busId}`, TTL: 35s)
                                                              - setRedisTripLock(busId, ...) -> SET trip:active:<busId> EX 120
           |                                                           |
           +-----------------------------+-----------------------------+
                                         |
                                         v
[ Route Handler Response Finalization ]
   - requestDeviceId Check:
       * Upsert public.device_sessions (feature: 'driver_location_share')
       * setCachedDeviceSession(driverUid, requestDeviceId, Date.now()) [TTL: 8s]
   - setActiveTripCache(busId, ...) refreshed for 600s
   - HTTP 200 OK:
     {
       success: true,
       tripId: "...",
       busId: "...",
       routeId: "...",
       shift: "morning",
       timestamp: "2026-10-18T...",
       processingTimeMs: 142
     }
```

---

### 2.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/driver/page.tsx` | `DriverDashboard` (Default React Component) | Next.js Router (`/driver`) | `authApiFetch('/api/driver/dashboard-data')`, `supabase.from('active_trips')`, `WebSocketClient` | React state: `hasActiveTrip`, `tripData` |
| `src/app/driver/trip/start/page.tsx` | `StartTripPage` (Default React Component), `QRScanner`, `findBusByQR` | Next.js Router (`/driver/trip/start`) | `authApiFetch('/api/driver/available-buses')`, `authApiFetch('/api/driver/resolve-bus-qr')`, `authApiFetch('/api/driver/initiate-trip')` | React state: `step`, `selectedBus`, `selectedShift` |
| `src/app/driver/live-tracking/page.tsx` | `DriverLiveTrackingPage` (Default React Component) | Next.js Router (`/driver/live-tracking`) | `checkDeviceSession`, `registerDeviceSession`, `authApiFetch('/api/driver/initiate-trip')`, `startLocationTracking` | React state: `tripActive`, `tripId`, `isFullScreenMap` |
| `src/lib/session-device-service.ts` | `getOrCreateDeviceId`, `checkDeviceSession`, `registerDeviceSession`, `heartbeatDeviceSession`, `releaseDeviceSession` | `DriverLiveTrackingPage`, `StartTripPage` | `fetch('/api/driver/device-session')` | `localStorage('adtu_device_id')` |
| `src/app/api/driver/device-session/route.ts` | `POST` (Route Handler) | `callDeviceSessionAPI` from client | `supabase.from('device_sessions')`, `setCachedDeviceSession`, `invalidateCachedDeviceSession` | `public.device_sessions`, `sessionCache` (8s TTL) |
| `src/lib/services/device-session-cache.ts` | `getCachedDeviceSession`, `setCachedDeviceSession`, `invalidateCachedDeviceSession` | `api/driver/device-session`, `api/driver/initiate-trip`, `api/location/update` | Memory Map `sessionCache` | `sessionCache` |
| `src/app/api/driver/initiate-trip/route.ts` | `POST` (Route Handler) | Driver UI (`StartTripPage`, `DriverLiveTrackingPage`) | `withSecurity`, `tripService.startTrip`, `supabase.from('device_sessions')`, `setCachedDeviceSession`, `setActiveTripCache` | `public.device_sessions`, `sessionCache`, `positiveLockCache`, `trip:active:<busId>` |
| `src/domains/trip/services/trip-orchestrator.ts` | `startTrip`, `endTrip`, `heartbeat`, `canOperate` | `api/driver/initiate-trip/route.ts` | `tripStartPreflight`, `resolveRouteName`, `tripLockService.startTrip`, `invalidateActiveTripCache`, `clearInMemoryLastLocation`, `broadcastTripEvent`, `dispatchFcmBounded`, `setActiveTripCache` | `negativeLockCache`, `positiveLockCache`, Redis `trip:active:<busId>`, in-memory GPS anchors |
| `src/domains/trip/services/trip-validation.service.ts` | `tripStartPreflight`, `resolveRouteId`, `resolveRouteName`, `verifyDriverBusAssignment`, `checkNoConflict` | `trip-orchestrator.ts` | `supabase.from('buses')`, `supabase.from('active_trips')`, `supabase.from('routes')` | Memory Map `routeNamesCache` (5-min TTL) |
| `src/lib/services/trip-lock-service.ts` | `TripLockService.prototype.startTrip` | `trip-orchestrator.ts` | `supabase.rpc('acquire_trip_lock')` | PostgreSQL `public.active_trips` |
| `src/domains/trip/services/trip-broadcast.service.ts` | `broadcastTripEvent` | `trip-orchestrator.ts` | `transport.broadcast` -> WebSocket / Redis PubSub | Channel `trip-status-<busId>` |
| `src/domains/gps/services/gps-persistence.service.ts` | `setActiveTripCache`, `getPositiveTripLock`, `invalidateActiveTripCache` | `trip-orchestrator.ts`, `api/driver/initiate-trip` | `positiveLockCache`, `negativeLockCache`, `setRedisTripLock`, `clearRedisTripLock`, `invalidateBusTripSnapshot` | Memory Maps `positiveLockCache`, `negativeLockCache`, Redis key `trip:active:<busId>` |
| `src/domains/gps/services/gps-redis-guard.ts` | `setRedisTripLock`, `getRedisTripLock`, `clearRedisTripLock` | `gps-persistence.service.ts` | Raw TCP RESP socket to Redis | Redis key `trip:active:<busId>` (120s TTL) |

---

### 2.3 Method-by-Method Low-Level Walkthrough

#### 1. `src/app/api/driver/initiate-trip/route.ts` -> `POST`
- **Security & Middleware**:
  - Wrapped with `withSecurity(handler, { requiredRoles: ['driver'], schema: InitiateTripSchema, rateLimit: RateLimits.CREATE, allowBodyToken: true })`.
  - `RateLimits.CREATE`: Enforces maximum 10 calls per minute per IP / UID. If breached, returns HTTP `429 Too Many Requests`.
  - Authentication: Evaluates Firebase session cookie or Bearer token; rejects non-drivers with HTTP `403 Forbidden`.
- **Validation**:
  - `busId`: string, min 1, max 100 characters.
  - `shift`: string, transformed by `s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()`, constrained by `z.enum(['Morning', 'Evening'])`.
  - `deviceId`: optional string, max 256 characters. Falls back to `x-device-id` HTTP header.
- **Orchestration Flow**:
  1. Calls `tripService.startTrip({ driverId: driverUid, busId, shift, deviceId: requestDeviceId })`.
  2. If `!result.success`: Logs warning `initiate_trip_failed` with `latencyMs`. If `result.errorCode === 'LOCKED_BY_OTHER'`, returns HTTP `409 Conflict`. Otherwise returns HTTP `500 Internal Server Error`.
  3. If `requestDeviceId` is provided: Performs an atomic upsert to `public.device_sessions` with `user_id: driverUid`, `device_id: requestDeviceId`, `feature: 'driver_location_share'`, `onConflict: 'user_id,feature'`.
  4. Calls `setCachedDeviceSession(driverUid, requestDeviceId, Date.now())` to populate L1 session cache (8s TTL).
  5. Calls `setActiveTripCache(busId, { tripId: result.tripId, driverId: driverUid, routeId: result.routeId, deviceId: requestDeviceId, expiresAtMs: Date.now() + 600_000 })`.
  6. Returns HTTP `200 OK` with JSON payload:
     ```json
     {
       "success": true,
       "message": "Trip started successfully",
       "tripId": "b18b45a9-4673-455b-bf72-4d2bc33054a8",
       "busId": "bus_01",
       "routeId": "route_1",
       "shift": "morning",
       "timestamp": "2026-10-18T...",
       "processingTimeMs": 138
     }
     ```

---

#### 2. `src/domains/trip/services/trip-orchestrator.ts` -> `startTrip(params: StartTripParams)`
- **Signature**: `export async function startTrip(params: StartTripParams): Promise<StartTripOutput>`
- **Input Contract**:
  ```typescript
  export interface StartTripParams {
    driverId: string;
    busId: string;
    routeId?: string;
    shift?: string;
    tripId?: string;
    deviceId?: string;
  }
  ```
- **Control Flow & Branching**:
  1. `normalizeShift(params.shift)`: If null or invalid, immediately returns `{ success: false, reason: 'Invalid or missing trip shift parameters', errorCode: 'VALIDATION_ERROR' }`.
  2. `tripStartPreflight(params.driverId, params.busId)`: Parallel lookup of bus status and existing active locks.
     - If `!preflight.authorized`: Rejects with `errorCode: preflight.conflict ? 'LOCKED_BY_OTHER' : 'VALIDATION_ERROR'`.
  3. Route resolution:
     - `rawRouteId := params.routeId || preflight.busData?.route_id || null`. If null, throws and catches -> returns `{ success: false, reason: 'Bus ... is not assigned to a valid route.', errorCode: 'VALIDATION_ERROR' }`.
     - `resolveRouteName(effectiveRouteId)`: Looks up human-readable name in in-memory cache (`routeNamesCache`).
  4. Idempotent resume check:
     - If `preflight.existingTripId` is present (same driver already has active trip on this bus):
       - Logs `start_idempotent`.
       - Returns `{ success: true, tripId: preflight.existingTripId, routeId: effectiveRouteId, shift: tripShift }`.
       - Bypasses DB insertion, WebSocket broadcast, and FCM dispatch.
  5. Unique trip ID generation: `tripId := params.tripId || crypto.randomUUID()`.
  6. Distributed Lock Acquisition:
     - `tripLockService.startTrip(params.driverId, params.busId, effectiveRouteId, tripShift, tripId)`.
     - Invokes `acquire_trip_lock` RPC. If RPC errors or fails, logs `start_failed` and returns error payload.
  7. State Clean-Slate Invalidation:
     - `invalidateActiveTripCache(params.busId, params.driverId)`: Flushes negative and positive memory caches and sends Redis `DEL trip:active:<busId>`.
     - `clearInMemoryLastLocation(params.busId)`: Clears previous trip's coordinates in `inMemoryLastLocations` and `inMemoryLastRawTs`.
  8. Realtime Broadcast & FCM (only if `!lockResult.alreadyActive`):
     - `broadcastTripEvent({...})`: Emits `trip_started` on channel `trip-status-<busId>`.
     - `dispatchFcmBounded(dispatchTripNotification({...}), 'trip start')`: Races FCM push against a 5,000ms timeout so Vercel serverless executions do not hang.
  9. Hot-path Cache Priming:
     - `setActiveTripCache(params.busId, {...})`: Primes in-memory positive lock (35s) and Redis key `trip:active:<busId>` (120s TTL).
  10. Returns `{ success: true, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift }`.

---

#### 3. `src/domains/trip/services/trip-validation.service.ts` -> `tripStartPreflight(driverId, busId)`
- **Signature**: `export async function tripStartPreflight(driverId: string, busId: string): Promise<TripPreflightResult>`
- **Execution Flow**:
  1. Issues 3 queries in parallel via `Promise.all`:
     ```typescript
     const [busResult, tripResult, driverTripResult] = await Promise.all([
       supabase.from('buses').select('id, bus_number, route_id, route_name, status').eq('id', busId).maybeSingle(),
       supabase.from('active_trips').select('trip_id, driver_id, expires_at').eq('bus_id', busId).eq('status', 'active').maybeSingle(),
       supabase.from('active_trips').select('trip_id, bus_id, expires_at').eq('driver_id', driverId).eq('status', 'active').maybeSingle(),
     ]);
     ```
  2. If `!busData`: Returns `{ authorized: false, reason: 'Bus not found', conflict: false }`.
  3. If `busData.status === 'inactive'`: Returns `{ authorized: false, reason: 'Bus is inactive', conflict: false }`.
  4. Invariant 1 Driver Check: If `driverActiveTrip && driverActiveTrip.bus_id !== busId`:
     - Checks if `driverActiveTrip.expires_at` has expired.
     - If not expired: Returns `{ authorized: false, reason: 'You are currently operating an active trip on another bus...', conflict: true, existingTripId: driverActiveTrip.trip_id }`.
  5. Bus Lock Check:
     - If no active trip on bus: Returns `{ authorized: true, busData, conflict: false }`.
     - If active trip has `driver_id === driverId`: Returns `{ authorized: true, busData, conflict: false, existingTripId: activeTrip.trip_id }` (idempotent re-entry).
     - If active trip has `expires_at < now`: Bus lock is stale; returns `{ authorized: true, busData, conflict: false }`.
     - If active trip has different driver and is not expired: Returns `{ authorized: false, reason: 'This bus is currently being operated by another driver', conflict: true, existingTripId: activeTrip.trip_id }`.

---

#### 4. `src/lib/services/trip-lock-service.ts` -> `TripLockService.prototype.startTrip`
- **Signature**: `startTrip(driverId: string, busId: string, routeId: string, shift: 'morning' | 'evening' | 'both', tripId: string): Promise<StartTripResult>`
- **Input Validation**: Validates all IDs against `/^[a-zA-Z0-9_-]{1,128}$/`. Returns `VALIDATION_ERROR` if invalid.
- **RPC Invocation**:
  ```typescript
  const { data: result, error: rpcError } = await this.supabase
      .rpc('acquire_trip_lock', {
          p_trip_id: tripId,
          p_bus_id: busId,
          p_driver_id: driverId,
          p_route_id: routeId,
          p_shift: shift,
          p_ttl_seconds: 600,
      });
  ```
- **Error Mapping**:
  - If `rpcError`: Logs error and returns `{ success: false, reason: rpcError.message, errorCode: 'SUPABASE_ERROR' }`.
  - If `result.error === 'LOCKED_BY_OTHER'`: Returns `{ success: false, reason: 'This bus is currently being operated by another driver...', errorCode: 'LOCKED_BY_OTHER' }`.
  - If successful: Returns `{ success: true, tripId: result.tripId || tripId, alreadyActive: result.alreadyActive === true }`.

---

#### 5. `src/domains/gps/services/gps-persistence.service.ts` -> Cache Priming & Invalidation
- **`invalidateActiveTripCache(busId, driverId)`**:
  - Deletes `${driverId}:${busId}` and `${busId}:${driverId}` from `negativeLockCache` and `positiveLockCache`.
  - Asynchronously fires `clearRedisTripLock(busId)` which executes Redis command:
    `DEL trip:active:<busId>`.
  - Calls `invalidateBusTripSnapshot(busId)`.
- **`setActiveTripCache(busId, data)`**:
  - Key: `${data.driverId}:${busId}`.
  - Deletes negative cache entry.
  - Sets `positiveLockCache` entry with `cachedUntilMs = Date.now() + 35_000` (35 seconds).
  - Asynchronously fires `setRedisTripLock(busId, data)` which executes Redis command:
    `SET trip:active:<busId> '{"tripId":"...","driverId":"...","routeId":"...","deviceId":"...","expiresAtMs":...}' EX 120`.

---

### 2.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Case A: Fresh New Trip Initiation (Cold Cache)
| System / Component | Operation | Exact Target / Key / Channel | Count |
| :--- | :--- | :--- | :--- |
| **PostgreSQL (Preflight)** | SELECT (`maybeSingle`) | `buses` (by `id`) | 1 |
| **PostgreSQL (Preflight)** | SELECT (`maybeSingle`) | `active_trips` (by `bus_id`, `status = 'active'`) | 1 |
| **PostgreSQL (Preflight)** | SELECT (`maybeSingle`) | `active_trips` (by `driver_id`, `status = 'active'`) | 1 |
| **PostgreSQL (Route Name)** | SELECT (`maybeSingle`) | `routes` (by `id`) — cached for 5 mins thereafter | 1 |
| **PostgreSQL (RPC)** | `acquire_trip_lock` | Row lock `buses FOR UPDATE`, stale check, and `INSERT active_trips` | 4 (atomic) |
| **PostgreSQL (Session)** | UPSERT (`onConflict`) | `device_sessions` (`user_id, feature`) | 1 |
| **Redis (TCP RESP)** | DEL | `trip:active:<busId>` (Invalidation) | 1 |
| **Redis (TCP RESP)** | SET ... EX 120 | `trip:active:<busId>` (Priming) | 1 |
| **WebSocket (`ws1`)** | Broadcast Frame | Channel: `trip-status-<busId>`, Event: `trip_started` | 1 |
| **External Calls (FCM)** | HTTPS (Firebase Admin) | Multicast FCM HTTP/v1 API dispatch | 1 |
| **Total Cold Operations** | | **9 PG Queries/Steps, 2 Redis Commands, 1 WS Frame, 1 FCM Call** | |

---

#### Case B: Idempotent Resume (Same Driver Re-initiating Active Trip)
| System / Component | Operation | Exact Target / Key / Channel | Count |
| :--- | :--- | :--- | :--- |
| **PostgreSQL (Preflight)** | SELECT (`maybeSingle`) | `buses`, `active_trips` (bus), `active_trips` (driver) in parallel | 3 |
| **PostgreSQL (Session)** | UPSERT (`onConflict`) | `device_sessions` (`user_id, feature`) | 1 |
| **PostgreSQL (RPC)** | None | Bypassed — `preflight.existingTripId` returned directly | 0 |
| **Redis (TCP RESP)** | SET ... EX 120 | `trip:active:<busId>` (TTL refresh via `setActiveTripCache`) | 1 |
| **WebSocket (`ws1`)** | None | Bypassed on idempotent resume | 0 |
| **External Calls (FCM)** | None | Bypassed on idempotent resume | 0 |
| **Total Warm Operations** | | **4 PG Queries, 1 Redis Command, 0 WS Frames, 0 FCM Calls** | |

---

#### Case C: Redis Outage / Network Failure
| System / Component | Behavior Under Failure | Result |
| :--- | :--- | :--- |
| **Redis (`trip:active:*`)** | `setRedisTripLock` catches errors silently (`catch { /* best-effort */ }`). | Falls back to in-memory `positiveLockCache` (35s) and PostgreSQL `active_trips`. Trip start succeeds. |
| **WebSocket Transport** | Dual-lane queue buffers message or logs warning if disconnected. | Trip start succeeds; client syncs via direct REST/Supabase check on mount. |
| **FCM Service** | `dispatchFcmBounded` times out after 5,000ms via `Promise.race`. | Notification fails gracefully; trip lock remains valid; driver receives HTTP 200. |

---

### 2.5 Verbatim Source Code from Live Codebase

#### 1. API Route Handler: `POST /api/driver/initiate-trip`
*Source: `src/app/api/driver/initiate-trip/route.ts` (Lines 1–118)*
```typescript
/**
 * POST /api/driver/initiate-trip
 *
 * CANONICAL trip-start endpoint — the ONLY route that should be called
 * to start a bus trip. Duplicate routes (start-trip, start-journey-v2) have
 * been removed.
 *
 * Flow:
 *  1. Validates driver auth and role
 *  2. Calls tripService.startTrip() which:
 *     a. Runs preflight checks (bus ownership, no conflicting trips)
 *     b. Acquires the trip lock in active_trips
 *     c. Broadcasts trip_started via WebSocket
 *     d. Dispatches FCM push notifications to students (awaited)
 *  3. Returns the new tripId and shift to the client
 *
 * FCM notification is AWAITED so it completes before the response is
 * returned — critical for serverless environments (Vercel).
 */
import * as tripService from '@/domains/trip';
import { appLogger } from '@/lib/logger';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { setCachedDeviceSession } from '@/lib/services/device-session-cache';
import { setActiveTripCache } from '@/domains/gps/services/gps-persistence.service';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const InitiateTripSchema = z.object({
  busId: z.string().min(1).max(100),
  // Accept both 'Morning'/'Evening' (from web) and 'morning'/'evening' (from mobile)
  shift: z.string()
    .transform(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .pipe(z.enum(['Morning', 'Evening'])),
  deviceId: z.string().max(256).optional(),
});

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const startTime = Date.now();
    const { busId, shift, deviceId } = body as z.infer<typeof InitiateTripSchema>;
    const driverUid = auth.uid;

    const requestDeviceId = deviceId || (request instanceof Request ? request.headers.get('x-device-id') : (request as any).headers?.get?.('x-device-id')) || undefined;

    const result = await tripService.startTrip({ driverId: driverUid, busId, shift, deviceId: requestDeviceId });

    const latencyMs = Date.now() - startTime;

    if (!result.success) {
      appLogger.warn('trip', 'initiate_trip_failed', {
        driverId: driverUid, busId, shift, reason: result.reason, errorCode: result.errorCode, latencyMs,
      });
      return NextResponse.json(
        { success: false, error: result.reason, errorCode: result.errorCode },
        { status: result.errorCode === 'LOCKED_BY_OTHER' ? 409 : 500 },
      );
    }

    // Seamless Device Handover / Crash Resume:
    // If deviceId is provided (or passed via x-device-id header), immediately bind this device
    // in device_sessions and prime the in-memory cache so GPS ticks are never rejected with ANOTHER_DEVICE_ACTIVE.
    if (requestDeviceId) {
      const nowIso = new Date().toISOString();
      const expiresAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const supabase = getSupabaseServer();
      await supabase
        .from('device_sessions')
        .upsert({
          user_id: driverUid,
          device_id: requestDeviceId,
          feature: 'driver_location_share',
          last_active_at: nowIso,
          last_active: nowIso,
          expires_at: expiresAtIso,
          created_at: nowIso,
        }, {
          onConflict: 'user_id,feature',
          ignoreDuplicates: false,
        });
      setCachedDeviceSession(driverUid, requestDeviceId, Date.now());
    }

    // Prime the active trip cache so GPS updates resolve instantly in memory
    if (result.tripId) {
      setActiveTripCache(busId, {
        tripId: result.tripId,
        driverId: driverUid,
        routeId: result.routeId || '',
        deviceId: requestDeviceId,
        expiresAtMs: Date.now() + 600_000,
      });
    }

    appLogger.info('trip', 'initiate_trip_success', {
      driverId: driverUid, busId, tripId: result.tripId, routeId: result.routeId, shift: result.shift, latencyMs,
    });

    return NextResponse.json({
      success: true,
      message: 'Trip started successfully',
      tripId: result.tripId,
      busId,
      routeId: result.routeId,
      shift: result.shift,
      timestamp: new Date().toISOString(),
      processingTimeMs: latencyMs,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: InitiateTripSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  },
);
```

#### 2. Domain Orchestration: `startTrip`
*Source: `src/domains/trip/services/trip-orchestrator.ts` (Lines 14–160)*
```typescript
// FCM send is best-effort and must not dictate trip-response latency, but it
// also must not be dropped silently: serverless runtimes may freeze the
// function after the response, so a bare fire-and-forget can lose the send.
// Bound it: give FCM up to 5s, then return and let the dedup lock
// (acquire_fcm_lock) make any late/duplicate delivery safe.
function dispatchFcmBounded(promise: Promise<unknown>, label: string): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('FCM dispatch timeout (5s)')), 5000)
  );
  return Promise.race([promise, timeout]).then(
    () => undefined,
    (e) => {
      console.warn(`${label} FCM dispatch failed or timed out (non-critical):`, (e as Error)?.message || e);
    }
  );
}

type ShiftLower = 'morning' | 'evening' | 'both';

export interface StartTripParams {
  driverId: string;
  busId: string;
  routeId?: string;
  shift?: string;
  tripId?: string;
  deviceId?: string;
}

export interface StartTripOutput {
  success: boolean;
  tripId?: string;
  routeId?: string;
  reason?: string;
  errorCode?: string;
  shift?: ShiftLower;
}

export async function startTrip(params: StartTripParams): Promise<StartTripOutput> {
  const start = Date.now();
  const normalized = normalizeShift(params.shift);
  if (!normalized) {
    return { success: false, reason: 'Invalid or missing trip shift parameters', errorCode: 'VALIDATION_ERROR' };
  }
  const tripShift = normalized.toLowerCase() as ShiftLower;
  const logCtx = { driverId: params.driverId, busId: params.busId };

  // Single preflight: fires buses + active_trips in parallel (replaces 3 serial DB calls)
  const preflight = await tripStartPreflight(params.driverId, params.busId);
  if (!preflight.authorized) {
    const errorCode = preflight.conflict ? 'LOCKED_BY_OTHER' : 'VALIDATION_ERROR';
    const errorClass = preflight.conflict ? ErrorClass.TRIP_LOCK_CONFLICT : ErrorClass.TRIP_VALIDATION_FAILED;
    appLogger.warn('trip', 'start_rejected', { ...logCtx, reason: preflight.reason, errorClass, latencyMs: Date.now() - start });
    return { success: false, reason: preflight.reason, errorCode };
  }

  let effectiveRouteId: string;
  let routeName: string;
  try {
    // Use route_id already fetched from preflight busData when available
    const rawRouteId = params.routeId || preflight.busData?.route_id || null;
    if (!rawRouteId) throw new Error(`Bus ${params.busId} is not assigned to a valid route.`);
    effectiveRouteId = rawRouteId;
    routeName = await resolveRouteName(effectiveRouteId);
  } catch (routeErr: any) {
    appLogger.warn('trip', 'start_rejected', { ...logCtx, reason: routeErr.message, errorClass: ErrorClass.TRIP_VALIDATION_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: routeErr?.message || 'Route assignment validation failed', errorCode: 'VALIDATION_ERROR' };
  }

  if (preflight.existingTripId) {
    appLogger.info('trip', 'start_idempotent', { ...logCtx, tripId: preflight.existingTripId, routeId: effectiveRouteId, latencyMs: Date.now() - start });
    return { success: true, tripId: preflight.existingTripId, routeId: effectiveRouteId, shift: tripShift };
  }

  const tripId = params.tripId || crypto.randomUUID();

  const lockResult = await tripLockService.startTrip(params.driverId, params.busId, effectiveRouteId, tripShift, tripId);
  if (!lockResult.success) {
    appLogger.error('trip', 'start_failed', { ...logCtx, tripId, routeId: effectiveRouteId, reason: lockResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: lockResult.reason, errorCode: lockResult.errorCode };
  }

  // Drop any cached trip-lock entries and in-memory location anchors for this driver/bus —
  // ensures every new trip begins with a completely clean GPS state.
  invalidateActiveTripCache(params.busId, params.driverId);
  clearInMemoryLastLocation(params.busId);

  const activeTripId = lockResult.tripId || tripId;
  const busNumber = preflight.busData?.bus_number || params.busId;

  if (!lockResult.alreadyActive) {
    appLogger.info('trip', 'started', { ...logCtx, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift, latencyMs: Date.now() - start });
    broadcastTripEvent({
      busId: params.busId,
      tripId: activeTripId,
      event: 'trip_started',
      driverId: params.driverId,
      routeId: effectiveRouteId,
      shift: tripShift,
      busNumber,
    });

    // FCM off the critical path but bounded (see dispatchFcmBounded): dedup
    // via acquire_fcm_lock is preserved; a notification failure must never
    // fail an already-acquired trip start.
    await dispatchFcmBounded(
      dispatchTripNotification({
        routeId: effectiveRouteId,
        tripId: activeTripId,
        routeName,
        busId: params.busId,
        shift: tripShift,
        eventType: 'TRIP_STARTED',
      }),
      'trip start'
    );
  }

  // Prime active trip cache in memory and Redis for 0-DB read hot path on GPS ticks
  setActiveTripCache(params.busId, {
    tripId: activeTripId,
    driverId: params.driverId,
    routeId: effectiveRouteId,
    deviceId: params.deviceId,
    expiresAtMs: Date.now() + 600_000,
  });

  return { success: true, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift };
}
```

#### 3. Trip Start Preflight Service
*Source: `src/domains/trip/services/trip-validation.service.ts` (Lines 19–72)*
```typescript
export async function tripStartPreflight(driverId: string, busId: string): Promise<TripPreflightResult> {
  const supabase = getSupabaseServer();

  const [busResult, tripResult, driverTripResult] = await Promise.all([
    supabase.from('buses').select('id, bus_number, route_id, route_name, status').eq('id', busId).maybeSingle(),
    supabase.from('active_trips').select('trip_id, driver_id, expires_at').eq('bus_id', busId).eq('status', 'active').maybeSingle(),
    supabase.from('active_trips').select('trip_id, bus_id, expires_at').eq('driver_id', driverId).eq('status', 'active').maybeSingle(),
  ]);

  const busData = busResult.data;
  if (!busData) return { authorized: false, reason: 'Bus not found', conflict: false };
  if (busData.status === 'inactive') return { authorized: false, reason: 'Bus is inactive', conflict: false };

  // 1. Check if the driver is already participating in an active trip on another vehicle (Invariant 1)
  const driverActiveTrip = driverTripResult?.data;
  if (driverActiveTrip && driverActiveTrip.bus_id !== busId) {
    const isDriverExpired = driverActiveTrip.expires_at ? Date.now() > new Date(driverActiveTrip.expires_at).getTime() : false;
    if (!isDriverExpired) {
      return {
        authorized: false,
        reason: 'You are currently operating an active trip on another bus. End your active trip before starting a new one.',
        busData,
        conflict: true,
        existingTripId: driverActiveTrip.trip_id,
      };
    }
  }

  const activeTrip = tripResult?.data;

  // No active trip — bus is free
  if (!activeTrip) {
    return { authorized: true, busData, conflict: false };
  }

  // Same driver — idempotent re-entry
  if (activeTrip.driver_id === driverId) {
    return { authorized: true, busData, conflict: false, existingTripId: activeTrip.trip_id };
  }

  // Different driver — check lock expiry
  const isExpired = activeTrip.expires_at ? Date.now() > new Date(activeTrip.expires_at).getTime() : false;
  if (isExpired) {
    return { authorized: true, busData, conflict: false };
  }

  return {
    authorized: false,
    reason: 'This bus is currently being operated by another driver',
    busData,
    conflict: true,
    existingTripId: activeTrip.trip_id,
  };
}
```

#### 4. PostgreSQL Trip Lock Service Wrapper
*Source: `src/lib/services/trip-lock-service.ts` (Lines 142–187)*
```typescript
    async startTrip(
        driverId: string,
        busId: string,
        routeId: string,
        shift: 'morning' | 'evening' | 'both',
        tripId: string
    ): Promise<StartTripResult> {
        const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
        if (!idPattern.test(driverId) || !idPattern.test(busId) || !idPattern.test(routeId) || !idPattern.test(tripId)) {
            return { success: false, reason: 'Invalid ID formats provided', errorCode: 'VALIDATION_ERROR' };
        }

        try {
            const { data: result, error: rpcError } = await this.supabase
                .rpc('acquire_trip_lock', {
                    p_trip_id: tripId,
                    p_bus_id: busId,
                    p_driver_id: driverId,
                    p_route_id: routeId,
                    p_shift: shift,
                    p_ttl_seconds: LOCK_TTL_SECONDS,
                });

            if (rpcError) {
                appLogger.error('trip-lock', 'acquire_lock_rpc_error', { busId, driverId, tripId, error: rpcError.message });
                return { success: false, reason: rpcError.message, errorCode: 'SUPABASE_ERROR' };
            }

            if (!result?.success) {
                if (result?.error === 'LOCKED_BY_OTHER') {
                    return {
                        success: false,
                        reason: 'This bus is currently being operated by another driver. Please wait or try again later.',
                        errorCode: 'LOCKED_BY_OTHER'
                    };
                }
                return { success: false, reason: result?.error || 'Failed to acquire lock', errorCode: 'SUPABASE_ERROR' };
            }

            return { success: true, tripId: result.tripId || tripId, alreadyActive: result.alreadyActive === true };

        } catch (error: unknown) {
            appLogger.error('trip-lock', 'start_trip_error', { busId, driverId, tripId, error: getErrorMessage(error) });
            return { success: false, reason: getErrorMessage(error) };
        }
    }
```

#### 5. Cache Priming & Invalidation Service
*Source: `src/domains/gps/services/gps-persistence.service.ts` (Lines 21–68)*
```typescript
export function setActiveTripCache(busId: string, data: { tripId: string; driverId: string; routeId?: string; deviceId?: string; expiresAtMs: number }): void {
  const cacheKey = `${data.driverId}:${busId}`;
  negativeLockCache.delete(cacheKey);
  positiveLockCache.set(cacheKey, {
    tripId: data.tripId,
    driverId: data.driverId,
    routeId: data.routeId,
    deviceId: data.deviceId,
    expiresAtMs: data.expiresAtMs,
    cachedUntilMs: Date.now() + POSITIVE_CACHE_TTL_MS,
  });
  setRedisTripLock(busId, data).catch(() => {});
}

export function invalidateActiveTripCache(busId?: string, driverId?: string): void {
  const purgeKeys = (map: Map<string, any>) => {
    if (busId && driverId) {
      map.delete(`${driverId}:${busId}`);
      map.delete(`${busId}:${driverId}`);
    } else if (busId || driverId) {
      const target = busId || driverId;
      for (const key of map.keys()) {
        if (key.includes(target!)) {
          map.delete(key);
        }
      }
    } else {
      map.clear();
    }
  };

  purgeKeys(negativeLockCache);
  purgeKeys(positiveLockCache);

  if (busId) {
    clearRedisTripLock(busId).catch(() => {});
  }
  invalidateBusTripSnapshot(busId);
}
```

#### 6. Redis Lock Command Dispatcher
*Source: `src/domains/gps/services/gps-redis-guard.ts` (Lines 733–765)*
```typescript
const TRIP_LOCK_PREFIX = 'trip:active:';

export async function getRedisTripLock(busId: string): Promise<RedisTripLockData | null> {
  const state = getState();
  if (!state.ready || !state.socket || state.socket.destroyed) return null;
  try {
    const raw = await sendCommand(state, ['GET', `${TRIP_LOCK_PREFIX}${busId}`]);
    if (!raw) return null;
    const data = JSON.parse(raw) as RedisTripLockData;
    if (!data || typeof data.expiresAtMs !== 'number' || data.expiresAtMs <= Date.now()) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function setRedisTripLock(busId: string, data: RedisTripLockData): Promise<void> {
  const state = getState();
  if (!state.ready || !state.socket || state.socket.destroyed) return;
  try {
    await sendCommand(state, ['SET', `${TRIP_LOCK_PREFIX}${busId}`, JSON.stringify(data), 'EX', '120']);
  } catch { /* best-effort */ }
}

export async function clearRedisTripLock(busId: string): Promise<void> {
  const state = getState();
  if (!state.ready || !state.socket || state.socket.destroyed) return;
  try {
    await sendCommand(state, ['DEL', `${TRIP_LOCK_PREFIX}${busId}`]);
  } catch { /* best-effort */ }
}
```


---



---

## PART 8: Student Live Tracking Experience — Track Bus Page, Singleflight Snapshot API, Adaptive Polling & MapLibre Alignment/Rotation

### 8.1 Sub-Domain Architecture & Exact Execution Pipeline

The Student Live Tracking experience provides university commuters with an accurate, battery-conscious visualization of their assigned bus. It eliminates server query floods during campus rush hours through Singleflight request deduplication and client-side route-corridor alignment.

```
                       [ Student Opens /student/track-bus ]
                                       │
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │ 1. Page Hydration & Entitlement Gate                          │
       │ - TransportEntitlementGuard: verify active transport pass     │
       │ - Request GPS coordinates for student location pin            │
       │ - Fetch Route Geometry: GET /api/routes/[id]/geometry         │
       │ - Open WebSocket via useBusLocation hook                      │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │ 2. Singleflight Snapshot API (GET /api/student/trip-status)   │
       │ - Entitlement check: requireTransportEntitlement(auth.uid)   │
       │ - Bus assignment gate: studentBusId === busId                 │
       │ - Singleflight Coalescing (trip-snapshot-cache.ts):          │
       │   * Check L1 memory cache (TTL 3,000ms)                       │
       │   * Check inFlightBusFetches Map (deduplicates in-flight)     │
       │   * 60 concurrent students trigger exactly 1 DB query!       │
       │   * Fetches active_trips + waiting_flags in parallel         │
       │   * Merges live location from Redis / memory                  │
       │ - Shift Compatibility Check: isShiftCompatible(sShift, tShift)│
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │ 3. WebSocket Channel Subscription (useBusLocation.ts)         │
       │ - Queue presence: ws.setPresence({ busId })                   │
       │ - Subscribe: bus_location_<busId> & trip-status-<busId>       │
       │ - Immediate Snapshot: receives cached position (source: snap) │
       │ - Adaptive Polling Suppression:                               │
       │   * WS Connected: HTTP polling backed off                     │
       │   * WS Disconnected / Reconnecting: HTTP poll acts as backup  │
       │   * visibilitychange / online: immediate resync               │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       │ Inbound Telemetry Frame
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │ 4. Pure Location Packet Guard (location-packet-guard.ts)      │
       │ - Reject tombstoned trip packets (packet.tripId === endedId)  │
       │ - Cross-trip contamination guard (stale older trip packets)   │
       │ - Monotonic timestamp ordering with 5,000ms clock skew window │
       │ - Self-healing activation on valid live packet                │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       │ Accepted Packet
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │ 5. Client Route Alignment Engine (route-alignment-engine.ts)  │
       │ - Equirectangular orthogonal projection to road polyline      │
       │ - Dynamic Corridor: 20m / 25m / 35m / 40m based on accuracy   │
       │ - Disambiguation Penalties:                                   │
       │   * Opposing Lane Bearing: +100m penalty                      │
       │   * Reverse Sequence Progression: +60m penalty                │
       │ - 3-Strike Hysteresis State Machine:                          │
       │   * < 25m: IN_CORRIDOR_HIGH_CONFIDENCE (Snaps to centerline)  │
       │   * 1-2 points > 25m: TEMPORARY_ANOMALY (Raw GPS displayed)   │
       │   * >= 3 points > 25m: OFF_ROUTE_CONFIRMED (Detour confirmed) │
       └───────────────────────────────┬───────────────────────────────┘
                                       │
                                       │ Display Target { lat, lng, heading }
                                       ▼
       ┌───────────────────────────────────────────────────────────────┐
       │ 6. MapLibre GL Smooth Animation & Vector Bus Rotation         │
       │ - animateMarkerTo(): 1800ms Quartic Ease-Out interpolation    │
       │   p = Math.min(1, (t - start) / 1800); e = 1 - (1 - p)^4     │
       │ - Screen Off / Hidden: cancel RAF, jump instantly (0% GPU)    │
       │ - Top-Down Vector Bus Rotation:                               │
       │   rotator.style.transform = `rotate(${effectiveHeading}deg)`   │
       │   transition: transform 1.2s ease-out                         │
       └───────────────────────────────────────────────────────────────┘
```

---

### 8.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | State / Cache Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/student/track-bus/page.tsx` | `TrackBusLive` | Student Navigation (`/student/track-bus`) | `useBusLocation`, `useAuth`, `useToast`, `LiveTrackingBusMap`, `TransportEntitlementGuard` | Component UI state (`busLocation`, `studentLocation`, `tripActive`, `isWaiting`) |
| `src/app/api/student/trip-status/route.ts` | `GET` (wrapped in `withSecurity`) | `useBusLocation.ts`, `track-bus/page.tsx` | `requireTransportEntitlement`, `getSharedBusTripSnapshot`, `isShiftCompatible` | None (read-only query) |
| `src/lib/services/trip-snapshot-cache.ts` | `getSharedBusTripSnapshot`, `invalidateBusTripSnapshot` | `src/app/api/student/trip-status/route.ts`, `trip-orchestrator.ts`, `stop-dwell.service.ts` | `getSupabaseServer`, `getLastLocationForBusAsync`, `supabase.from('active_trips')`, `supabase.from('waiting_flags')` | Mutates `busSnapshotCache` (3s TTL), `inFlightBusFetches` |
| `src/hooks/useBusLocation.ts` | `useBusLocation` | `src/app/student/track-bus/page.tsx`, `src/app/student/page.tsx` | `WebSocketClient`, `decideLocationPacket`, `fetch('/api/student/trip-status')` | Component state (`currentLocation`, `history`, `loading`) |
| `src/domains/realtime/location-packet-guard.ts` | `decideLocationPacket`, `parseTimestampMs` | `useBusLocation.ts` | None | Pure state transformation |
| `src/lib/maps/route-alignment-engine.ts` | `alignBusPositionToRoute`, `createInitialAlignmentState`, `getOrCreateCachedRoute` | `GuwahatiMap.tsx` | Vector trigonometry (`haversineDistance`, `bearingDifference`) | Mutates `RouteAlignmentState` per bus |
| `src/components/maps/LiveTrackingBusMap.tsx` | `LiveTrackingBusMap` | `src/app/student/track-bus/page.tsx` | `GuwahatiBusMap` | Wrapper component |
| `src/components/maps/GuwahatiBusMap.tsx` | `GuwahatiBusMap` | `LiveTrackingBusMap.tsx` | `GuwahatiMap`, `getDistanceText` | Map container UI state |
| `src/components/maps/GuwahatiMap.tsx` | `GuwahatiMap` | `GuwahatiBusMap.tsx`, `GuwahatiDriverMap.tsx` | `maplibregl`, `alignBusPositionToRoute`, `animateMarkerTo` | MapLibre map instance, marker DOM element |
| `src/app/api/routes/[id]/geometry/route.ts` | `GET` | `track-bus/page.tsx`, `LiveTrackingDriverMap.tsx` | `verifyApiAuth`, `getCanonicalRouteGeometry` | Returns cached GeoJSON coordinates |

---

### 8.3 Method-by-Method Low-Level Walkthrough

#### 8.3.1 Singleflight Trip Status API (`src/app/api/student/trip-status/route.ts`)
1. **Security & Entitlement Verification**:
   - Requires role in `['student', 'driver', 'admin', 'moderator']`.
   - For students, executes `requireTransportEntitlement(auth.uid)`. If transit pass expired, returns HTTP `403 Forbidden`.
   - Validates bus ownership: student's assigned `busId` must match query parameter `busId`.
2. **Singleflight Deduplication (`getSharedBusTripSnapshot`)**:
   - Checks L1 in-memory cache: `busSnapshotCache.get(normKey)` (TTL 3,000ms).
   - If miss, checks `inFlightBusFetches.get(normKey)`. If another request for this bus is currently awaiting PostgreSQL, **reuses the existing Promise**.
   - If initiating query, executes `Promise.all`:
     1. `supabase.from('active_trips').select(...).in('bus_id', busVariations).eq('status', 'active').gt('expires_at', now).order('start_time', { ascending: false }).limit(1)`.
     2. `supabase.from('waiting_flags').select(...).in('bus_id', busVariations).in('status', ['waiting', 'raised', 'acknowledged'])`.
   - Resolves live coordinates from Redis (`getLastLocationForBusAsync`) or in-memory fallback.
   - Populates L1 cache for 3,000ms and resolves all awaiting caller promises.
3. **Shift Compatibility Check**:
   - Compares student's assigned shift with `snapshot.tripData.shift` via `isShiftCompatible`.
   - If incompatible, returns HTTP 200 with `{ tripActive: false, reason: 'shift_mismatch' }`.

---

#### 8.3.2 Realtime Location Hook & Packet Guard (`useBusLocation.ts` & `location-packet-guard.ts`)
1. **Initial Bootstrap & Adaptive Synchronization**:
   - Queries `GET /api/student/trip-status?busId=<id>` on mount to establish initial state.
   - Instantiates `WebSocketClient` connecting to `getClientWsUrl()`.
   - Subscribes to `bus_location_<busId>` (telemetry) and `trip-status-<busId>` (lifecycle).
   - Attaches `document.visibilitychange` and `window.online` listeners: when tab becomes visible or network reconnects, triggers non-destructive `handleResume` (re-syncs state without overwriting newer GPS timestamps).
2. **Pure Decision Logic (`decideLocationPacket`)**:
   - **Tombstone Guard**: If `packet.tripId === state.endedTripId`, rejects immediately with `rejectReason: 'ended-trip'` (prevents late-arriving UDP/WS packets from resurrecting an ended trip).
   - **Cross-Trip Contamination Guard**: If packet carries a different `tripId` than currently active trip:
     - If packet is older than current position (`ts + 5000ms < lastTimestamp`), rejects with `rejectReason: 'cross-trip-stale'`.
     - Otherwise, adopts the new `tripId` and untombstones state.
   - **Monotonic Timestamp Guard**: Rejects packets if `incomingTs + 5000ms < lastTimestamp` (`rejectReason: 'stale-timestamp'`).
   - Returns `apply: true` and updates `lastTimestampMs`.

---

#### 8.3.3 Client-Side Route Alignment Engine (`src/lib/maps/route-alignment-engine.ts`)
1. **Performance Budget**:
   - Runs strictly once per incoming location packet (0.5 Hz / every 2-3s). Never runs on 60fps render loop. Measured execution time: `< 0.05ms`.
2. **Segment Projection**:
   - Evaluates precomputed route segments: flat-earth equirectangular offset `dx = dLng * cosLat * 111320`, `dy = dLat * 110574`.
   - Projection scalar `t = (px * dx + py * dy) / segLenSq` clamped to `[0, 1]`.
3. **Disambiguation Penalties**:
   - **Heading Penalty**: If `speed >= 3 km/h` and bearing difference between vehicle and segment > 90° (opposing traffic direction), adds a **+100m distance penalty** to prevent snapping to the wrong road side or parallel lane.
   - **Sequence Continuity Penalty**: Incurred if projection jumps backwards along the route or forward by > 4 segments.
4. **Hysteresis State Machine**:
   - Dynamic Corridor: `20m` (accuracy <= 10m), `25m` (accuracy <= 30m), `35m` (accuracy <= 60m).
   - If distance <= corridor: Transitions to `IN_CORRIDOR_HIGH_CONFIDENCE` -> Snaps marker to centerline.
   - If distance > corridor: Increments `consecutiveOffRouteCount`.
     - 1 or 2 points: `TEMPORARY_ANOMALY` -> Displays raw physical GPS.
     - 3 consecutive points: `OFF_ROUTE_CONFIRMED` -> Detour confirmed! Snapping released completely, displays authoritative raw GPS coordinates.

---

#### 8.3.4 MapLibre Marker Interpolation & Heading Rotation (`GuwahatiMap.tsx`)
1. **Marker Interpolation (`animateMarkerTo`)**:
   - 1,800ms animation loop driven by `requestAnimationFrame`.
   - Quartic ease-out equation:
     ```typescript
     const p = Math.min(1, (t - start) / 1800);
     const e = 1 - Math.pow(1 - p, 4);
     const currentLng = fromLng + (toLng - fromLng) * e;
     const currentLat = fromLat + (toLat - fromLat) * e;
     marker.setLngLat([currentLng, currentLat]);
     ```
   - **Battery & Tab Background Protection**: If `document.visibilityState === 'hidden'`, skips RAF loop entirely and jumps marker immediately to target coordinates.
2. **Vector Bus Heading Rotation**:
   - Top-down vector bus SVG is wrapped in an isolated element with class `.bus-marker-rotator`.
   - Rotates along corners with CSS hardware acceleration:
     `rotator.style.transform = `rotate(${effectiveHeading}deg)`;`
     `rotator.style.transition = 'transform 1.2s ease-out';`

---

### 8.4 Exact I/O, Database Query & Redis Command Count Matrix

#### Scenario A: 60 Students Open /student/track-bus Simultaneously (Cold Snapshot Cache)
- **PostgreSQL Queries**: **1 to 2 Total across all 60 students!**
  - Singleflight coalescing locks the in-flight fetch. Only **1 query** to `active_trips` and **1 query** to `waiting_flags` executes.
  - The other 59 requests await the shared Promise and resolve in <0.05ms.
- **Redis Commands**: **1** (`getLastLocationForBusAsync` -> `HMGET gps:last:<busId>`).
- **WebSocket Frames Emitted**: **60** (1 `auth_ok`, 1 `presence_ok`, 1 `bus_location_update` snapshot per student).
- **External Calls**: **0** (Assuming JWT cached).

#### Scenario B: 60 Students Polling / Re-Syncing during Steady State (Warm Snapshot Cache, T < 3s)
- **PostgreSQL Queries**: **0** (Absorbed by L1 memory cache `busSnapshotCache` with 3,000ms TTL).
- **Redis Commands**: **0**.
- **WebSocket Frames Emitted**: **0**.
- **External Calls**: **0**.

#### Scenario C: Driver Emits Realtime GPS Location Packet (Streaming Tick)
- **PostgreSQL Queries**: **0**.
- **Redis Commands**: **0** (Broadcast via WebSocket).
- **WebSocket Frames Emitted**: **60** (1 frame broadcast to `bus_location_<busId>` delivered to all 60 active student sockets).
- **Client Processing**: Each student's browser runs `decideLocationPacket` (<0.01ms), projects onto polyline (<0.05ms), and animates marker via 1800ms RAF ease-out.

---

### 8.5 Verbatim Source Code from Live Codebase

#### 8.5.1 `src/app/api/student/trip-status/route.ts`
```typescript
// Lines 1 - 108 of src/app/api/student/trip-status/route.ts
import { requireTransportEntitlement } from '@/lib/entitlement/require-transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { TripStatusQuerySchema } from '@/lib/security/validation-schemas';
import { getStudentProfileAndShift } from '@/lib/student-shift-resolver';
import { getSupabaseServer } from '@/lib/supabase-server';
import { isShiftCompatible } from '@/lib/utils';
import { getSharedBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
    async (request, { auth }) => {
        let studentRecord: Record<string, any> | null = null;
        if (auth.role === 'student') {
            const gate = await requireTransportEntitlement(auth.uid);
            if (!gate.ok) return (gate as any).response;
            studentRecord = gate.student;
        }

        const url = new URL(request.url);
        const busId = url.searchParams.get('busId');

        if (!busId) {
            return NextResponse.json({
                tripActive: false,
                error: 'busId is required',
                tripData: null
            }, { status: 400 });
        }

        let studentProfile: { busId?: string | null; shift?: string | null } | null = null;
        if (auth.role === 'student') {
            if (studentRecord) {
                const { normalizeShift } = await import('@/lib/utils/shift-utils');
                studentProfile = {
                    busId: studentRecord.busId || studentRecord.bus_id || null,
                    shift: normalizeShift(studentRecord.shift),
                };
            } else {
                studentProfile = await getStudentProfileAndShift(auth.uid);
            }
            const studentBusId = studentProfile.busId;
            if (studentBusId && studentBusId !== busId && studentBusId !== busId.replace('bus_', '') && `bus_${studentBusId}` !== busId) {
                return NextResponse.json({
                    tripActive: false,
                    error: 'Forbidden: You are not assigned to this bus',
                    tripData: null
                }, { status: 403 });
            }
        }

        const snapshot = await getSharedBusTripSnapshot(busId);

        if (!snapshot.tripActive || !snapshot.tripData) {
            return NextResponse.json({
                tripActive: false,
                tripData: null,
                activeWaitingFlag: null,
            });
        }

        if (auth.role === 'student' && studentProfile) {
            if (studentProfile.shift && !isShiftCompatible(studentProfile.shift, snapshot.tripData.shift)) {
                return NextResponse.json({
                    tripActive: false,
                    tripData: null,
                    reason: 'shift_mismatch',
                    activeWaitingFlag: null,
                });
            }
        }

        let activeWaitingFlag: any = null;
        if (auth.role === 'student' && auth.uid) {
            activeWaitingFlag = snapshot.activeFlagsByStudentUid?.[auth.uid] || null;
        }

        return NextResponse.json({
            tripActive: true,
            tripData: snapshot.tripData,
            activeWaitingFlag,
        });
    },
    {
        requiredRoles: ['student', 'driver', 'admin', 'moderator'],
        schema: TripStatusQuerySchema,
        rateLimit: RateLimits.READ
    }
);
```

---

#### 8.5.2 `src/lib/services/trip-snapshot-cache.ts` (Singleflight Request Coalescing)
```typescript
// Lines 53 - 100, 175 - 227 of src/lib/services/trip-snapshot-cache.ts
const SNAPSHOT_CACHE_TTL_MS = 3000; // 3 seconds
const busSnapshotCache = new Map<string, { snapshot: BusTripSnapshot; expiresAtMs: number }>();
const inFlightBusFetches = new Map<string, Promise<BusTripSnapshot>>();

export async function getSharedBusTripSnapshot(busId: string): Promise<BusTripSnapshot> {
  const normKey = normalizeBusKey(busId);
  if (!normKey) {
    return { tripActive: false, tripData: null, activeFlagsByStudentUid: {}, fetchedAtMs: Date.now() };
  }

  const now = Date.now();

  // 1. Check L1 Memory Cache
  const cached = busSnapshotCache.get(normKey);
  if (cached && now < cached.expiresAtMs) {
    return cached.snapshot;
  }

  // 2. Singleflight: Deduplicate concurrent in-flight fetches for the same bus
  const inFlight = inFlightBusFetches.get(normKey);
  if (inFlight) {
    return inFlight;
  }

  // 3. Initiate fetch promise
  const fetchPromise = (async (): Promise<BusTripSnapshot> => {
    try {
      const busVariations = getBusVariations(normKey);
      const supabase = getSupabaseServer();

      // Parallel fetch: active trip status and active waiting flags for this bus
      const [tripsRes, flagsRes] = await Promise.all([
        supabase
          .from('active_trips')
          .select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at')
          .in('bus_id', busVariations)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .order('start_time', { ascending: false })
          .limit(1),
        supabase
          .from('waiting_flags')
          .select('id, student_uid, status, lat, lng, stop_lat, stop_lng, route_progress_meters, expires_at')
          .in('bus_id', busVariations)
          .in('status', ['waiting', 'raised', 'acknowledged'])
          .limit(100),
      ]);

      if (tripsRes.error) {
        console.error('[trip-snapshot-cache] Error querying active_trips:', tripsRes.error.message);
        return { tripActive: false, tripData: null, activeFlagsByStudentUid: {}, fetchedAtMs: Date.now() };
      }

      const activeRow = tripsRes.data && tripsRes.data.length > 0 ? tripsRes.data[0] : null;

      if (!activeRow) {
        const inactiveSnapshot: BusTripSnapshot = {
          tripActive: false,
          tripData: null,
          activeFlagsByStudentUid: {},
          fetchedAtMs: Date.now(),
        };
        busSnapshotCache.set(normKey, {
          snapshot: inactiveSnapshot,
          expiresAtMs: Date.now() + SNAPSHOT_CACHE_TTL_MS,
        });
        return inactiveSnapshot;
      }

      // Build active waiting flags index by studentUid (0 per-student queries on trip-status!)
      const activeFlagsByStudentUid: Record<string, ActiveWaitingFlagSummary> = {};
      if (flagsRes.data && flagsRes.data.length > 0) {
        const nowMs = Date.now();
        for (const flag of flagsRes.data) {
          const expiresAtMs = flag.expires_at ? new Date(flag.expires_at).getTime() : 0;
          if ((!expiresAtMs || expiresAtMs > nowMs) && flag.student_uid) {
            activeFlagsByStudentUid[flag.student_uid] = {
              id: flag.id,
              studentUid: flag.student_uid,
              status: flag.status,
              lat: Number(flag.lat || flag.stop_lat || 0),
              lng: Number(flag.lng || flag.stop_lng || 0),
              routeProgressMeters: flag.route_progress_meters ?? undefined,
            };
          }
        }
      }

      // Resolve live location from in-memory cache or Redis
      const lastLoc = (await getLastLocationForBusAsync(normKey)) || getLastLocationForBus(normKey);

      let currentLocation = null;
      if (lastLoc) {
        currentLocation = {
          busId: normKey,
          driverUid: activeRow.driver_id,
          lat: lastLoc.lat,
          lng: lastLoc.lng,
          speed: lastLoc.speed != null ? Number(lastLoc.speed) : 0,
          heading: lastLoc.heading != null ? Number(lastLoc.heading) : 0,
          accuracy: lastLoc.accuracy ?? 10,
          timestamp: lastLoc.timestamp,
        };
      }

      const snapshot: BusTripSnapshot = {
        tripActive: true,
        tripData: {
          tripId: activeRow.trip_id,
          status: activeRow.status,
          driverUid: activeRow.driver_id,
          routeId: activeRow.route_id,
          shift: activeRow.shift,
          startedAt: activeRow.start_time,
          lastUpdated: activeRow.last_heartbeat,
          current_location: currentLocation,
        },
        activeFlagsByStudentUid,
        fetchedAtMs: Date.now(),
      };

      const expiresAtMs = Date.now() + SNAPSHOT_CACHE_TTL_MS;
      for (const v of busVariations) {
        busSnapshotCache.set(v, { snapshot, expiresAtMs });
      }

      return snapshot;
    } finally {
      inFlightBusFetches.delete(normKey);
    }
  })();

  inFlightBusFetches.set(normKey, fetchPromise);
  return fetchPromise;
}

export function invalidateBusTripSnapshot(busId?: string): void {
  if (busId) {
    const variations = getBusVariations(busId);
    for (const v of variations) {
      busSnapshotCache.delete(v);
      inFlightBusFetches.delete(v);
    }
  } else {
    busSnapshotCache.clear();
    inFlightBusFetches.clear();
  }
}
```

---

#### 8.5.3 `src/domains/realtime/location-packet-guard.ts`
```typescript
// Lines 62 - 126 of src/domains/realtime/location-packet-guard.ts
export function decideLocationPacket(
  packet: TripPacket,
  state: TripGuardState
): TripPacketDecision {
  const incomingTsMs = parseTimestampMs(packet.timestamp);

  // Tombstoned trip: any packet still claiming this tripId is dead forever.
  if (state.endedTripId && packet.tripId && packet.tripId === state.endedTripId) {
    return rejected(state, 'ended-trip', incomingTsMs);
  }

  const decision: TripPacketDecision = {
    apply: false,
    isTripActive: state.isTripActive,
    activeTripId: state.activeTripId,
    endedTripId: state.endedTripId,
    lastTimestampMs: state.lastTimestampMs,
    incomingTsMs,
  };

  // Self-healing trip state: a valid packet means the trip is active.
  if (!decision.isTripActive && !decision.endedTripId) {
    decision.isTripActive = true;
  }

  // Cross-trip contamination guard with auto-recovery for newer trips.
  if (
    decision.activeTripId &&
    packet.tripId &&
    packet.tripId !== decision.activeTripId
  ) {
    if (incomingTsMs > 0 && incomingTsMs + 5000 < decision.lastTimestampMs) {
      return rejected(state, 'cross-trip-stale', incomingTsMs);
    }
    decision.isTripActive = true;
    decision.activeTripId = packet.tripId;
    decision.endedTripId = null;
  } else if (!decision.activeTripId && packet.tripId) {
    decision.isTripActive = true;
    decision.endedTripId = null;
    decision.activeTripId = packet.tripId;
  }

  // Monotonic timestamp guard with 5-second clock skew tolerance:
  const SKEW_TOLERANCE_MS = 5000;
  if (incomingTsMs > 0 && decision.lastTimestampMs > 0 && incomingTsMs + SKEW_TOLERANCE_MS < decision.lastTimestampMs) {
    return rejected(state, 'stale-timestamp', incomingTsMs);
  }
  if (incomingTsMs > 0) {
    decision.lastTimestampMs = Math.max(decision.lastTimestampMs, incomingTsMs);
  }

  decision.apply = true;
  return decision;
}
```

---

#### 8.5.4 `src/lib/maps/route-alignment-engine.ts`
```typescript
// Excerpt from src/lib/maps/route-alignment-engine.ts
export function alignBusPositionToRoute(
  rawInput: InputLocation,
  routePoints: LatLng[] | null | undefined,
  state: RouteAlignmentState,
  routeId = 'default'
): RouteAlignmentResult {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rawPoint: LatLng = { lat: rawInput.lat, lng: rawInput.lng };

  if (!routePoints || routePoints.length < 2) {
    state.mode = 'NO_ROUTE_GEOMETRY';
    state.confidence = 'LOW';
    state.lastRawPoint = rawPoint;
    state.lastDisplayPoint = rawPoint;
    return {
      rawPoint,
      snappedPoint: rawPoint,
      displayPoint: rawPoint,
      isSnapped: false,
      distanceToRouteMeters: 0,
      mode: 'NO_ROUTE_GEOMETRY',
      confidence: 'LOW',
      consecutiveOffRouteCount: 0,
      selectedSegmentIndex: -1,
      calculationTimeMs: 0,
    };
  }

  const cachedRoute = getOrCreateCachedRoute(routeId, routePoints);
  if (!cachedRoute) {
    return {
      rawPoint,
      snappedPoint: rawPoint,
      displayPoint: rawPoint,
      isSnapped: false,
      distanceToRouteMeters: 0,
      mode: 'NO_ROUTE_GEOMETRY',
      confidence: 'LOW',
      consecutiveOffRouteCount: 0,
      selectedSegmentIndex: -1,
      calculationTimeMs: 0,
    };
  }

  const accuracy = rawInput.accuracy ?? 10;
  let dynamicCorridorMeters = 25;
  if (accuracy <= 10) dynamicCorridorMeters = 20;
  else if (accuracy <= 30) dynamicCorridorMeters = 25;
  else if (accuracy <= 60) dynamicCorridorMeters = 35;
  else dynamicCorridorMeters = 40;

  const speedKmh = rawInput.speed ?? 0;
  const headingDeg = rawInput.heading ?? 0;
  const hasReliableHeading = speedKmh >= 3 && headingDeg > 0;

  let bestEffectiveDistance = Infinity;
  let bestGeometricDistance = Infinity;
  let bestSnappedPoint: LatLng = rawPoint;
  let bestSegmentIndex = state.lastSegmentIndex;

  const segments = cachedRoute.segments;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const proj = projectToPrecomputedSegment(rawPoint, seg);
    let effectiveDist = proj.distanceMeters;

    // Heading Disambiguation Penalty (+100m for opposing direction)
    if (hasReliableHeading) {
      const angleDiff = bearingDifference(headingDeg, seg.bearingDeg);
      if (angleDiff > 90) {
        effectiveDist += 100;
      } else if (angleDiff > 45) {
        effectiveDist += 15;
      }
    }

    // Temporal Sequence Continuity Penalty
    if (state.lastSegmentIndex >= 0) {
      const segDelta = i - state.lastSegmentIndex;
      if (segDelta < 0) {
        if (speedKmh > 5) effectiveDist += Math.min(60, Math.abs(segDelta) * 12);
      } else if (segDelta > 4) {
        effectiveDist += Math.min(50, (segDelta - 4) * 8);
      }
    }

    if (effectiveDist < bestEffectiveDistance) {
      bestEffectiveDistance = effectiveDist;
      bestGeometricDistance = proj.distanceMeters;
      bestSnappedPoint = proj.snapped;
      bestSegmentIndex = i;
    }
  }

  state.lastSegmentIndex = bestSegmentIndex;

  // Hysteresis State Machine:
  if (bestGeometricDistance <= dynamicCorridorMeters) {
    state.consecutiveOnRouteCount++;
    state.consecutiveOffRouteCount = 0;

    if (state.mode === 'OFF_ROUTE_CONFIRMED' && state.consecutiveOnRouteCount < 2) {
      state.confidence = 'MEDIUM';
    } else {
      state.mode = bestGeometricDistance <= 18 ? 'IN_CORRIDOR_HIGH_CONFIDENCE' : 'IN_CORRIDOR_LOW_CONFIDENCE';
      state.confidence = bestGeometricDistance <= 12 ? 'HIGH' : 'MEDIUM';
    }
  } else {
    state.consecutiveOffRouteCount++;
    state.consecutiveOnRouteCount = 0;

    if (state.consecutiveOffRouteCount >= 3) {
      state.mode = 'OFF_ROUTE_CONFIRMED';
      state.confidence = 'HIGH';
    } else {
      state.mode = 'TEMPORARY_ANOMALY';
      state.confidence = 'LOW';
    }
  }

  let displayPoint: LatLng;
  let isSnapped: boolean;

  if (state.mode === 'IN_CORRIDOR_HIGH_CONFIDENCE' || state.mode === 'IN_CORRIDOR_LOW_CONFIDENCE') {
    displayPoint = bestSnappedPoint;
    isSnapped = true;
  } else {
    displayPoint = rawPoint;
    isSnapped = false;
  }

  return {
    rawPoint,
    snappedPoint: bestSnappedPoint,
    displayPoint,
    isSnapped,
    distanceToRouteMeters: Math.round(bestGeometricDistance * 10) / 10,
    mode: state.mode,
    confidence: state.confidence,
    consecutiveOffRouteCount: state.consecutiveOffRouteCount,
    selectedSegmentIndex: bestSegmentIndex,
    calculationTimeMs: 0,
  };
}
```

---

#### 8.5.5 `src/components/maps/GuwahatiMap.tsx` (Quartic Ease-Out Animation & Top-Down Vector Rotation)
```typescript
// Lines 258 - 296, 589 - 596 of src/components/maps/GuwahatiMap.tsx
function animateMarkerTo(
  marker: MapLibreMarker,
  fromRaw: any,
  to: { lat: number; lng: number },
  rafRef: React.MutableRefObject<number | null>
) {
  if (!marker || !to) return;
  const fromLng = Number(fromRaw?.lng ?? to.lng);
  const fromLat = Number(fromRaw?.lat ?? to.lat);
  const toLng = Number(to.lng);
  const toLat = Number(to.lat);

  if (isNaN(toLng) || isNaN(toLat)) return;

  if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

  // If tab/screen is hidden, do not spin a 60fps RAF loop; jump directly to save battery/GPU
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    marker.setLngLat([toLng, toLat]);
    rafRef.current = null;
    return;
  }

  const start = performance.now();
  const step = (t: number) => {
    // 1800ms quartic ease-out smoothly bridges 3s GPS updates without overshoot or jitter
    const p = Math.min(1, (t - start) / 1800);
    const e = 1 - Math.pow(1 - p, 4);
    const currentLng = fromLng + (toLng - fromLng) * e;
    const currentLat = fromLat + (toLat - fromLat) * e;
    marker.setLngLat([currentLng, currentLat]);
    if (p < 1) {
      rafRef.current = requestAnimationFrame(step);
    } else {
      rafRef.current = null;
    }
  };
  rafRef.current = requestAnimationFrame(step);
}

// Marker update within useEffect:
animateMarkerTo(busMarkerRef.current, busMarkerRef.current.getLngLat() as any, pos, busAnimationRef);
// Smoothly rotate bus marker rotator element along road corners and intersections (Uber-style)
const rotator = busMarkerRef.current.getElement().querySelector('.bus-marker-rotator') as HTMLElement | null;
if (rotator) {
  rotator.style.transition = 'transform 1.2s ease-out';
  rotator.style.transform = `rotate(${effectiveHeading}deg)`;
}
```

---

