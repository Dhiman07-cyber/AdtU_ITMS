# Smart Seat Allocation, Stop Capacity Discovery & Fleet Rostering Engine (Forensic Truth)

**Module:** Route/Stop Capacity Discovery, Alternative Bus Recommendation & Multi-Bus Fleet Allocation  
**File Authority:** `src/app/api/routes/[id]/buses/route.ts`, `src/app/api/fleet/assign-drivers/route.ts`, `src/app/api/fleet/assign-routes/route.ts`  
**Database Transactions:** `assign_drivers_atomically`, `assign_routes_atomically`  

---

# PART 3: Route, Stop & Bus Capacity Discovery — The "Full Bus / Single-Bus Stop / Alternative Bus" Resolution Engine

---

### 3.1 Sub-Domain Architecture & Exact Execution Pipeline

The Bus Capacity Discovery & Alternative Bus Resolution Engine bridges the static geographic definition of transit corridors (`routes` and their sequential stop definitions) with the dynamic, shift-partitioned passenger loads of the physical fleet (`buses`). It evaluates seat availability during two distinct lifecycle phases:
1. **Prospective Applicant Discovery (Client Wizard / Pre-Submission):** As an applicant chooses a Route, Stop, and Shift in the onboarding wizard, the client initiates asynchronous evaluation via `checkCapacityForApplication` (`POST /api/buses/capacity`).
2. **Administrative Staging & Approval (Admin/Moderator Decision Gate):** When reviewing submitted applications in `/admin/applications` or `/moderator/applications`, the system re-verifies capacity in real-time. If the assigned bus has filled up between submission and review, the UI invokes `AlternativeBusPicker.tsx` to allow the admin to stage an alternative bus serving that stop before committing.

#### Chronological Execution Trace & Pipeline

```
[ Applicant / Wizard UI ]
       │
       │ 1. Select Route, Stop Name, Shift
       ▼
[ checkCapacityForApplication ] (src/lib/bus-capacity-checker.ts)
       │
       │ 2. HTTP POST /api/buses/capacity { routeId, stop_name, busId?, shift }
       ▼
[ POST /api/buses/capacity ] (src/app/api/buses/capacity/route.ts)
       │
       ├─► 3. verifyApiAuth(request) -> extract auth.uid
       ├─► 4. applyRateLimit(uid:buses-capacity-check, RateLimits.READ)
       ├─► 5. getCachedRoutes() [30s in-memory TTL]
       │       └─ Filter routes whose stops[] match stop_name (case-insensitive trim)
       │          => matchingRouteIds
       ├─► 6. getCachedBuses() [30s in-memory TTL]
       │       └─ Filter buses matching matchingRouteIds
       │       └─ Filter buses by shift compatibility (areShiftsCompatible)
       │          => candidateBuses
       ├─► 7. Compute available seats per bus:
       │       totalCapacity = bus.capacity
       │       shiftLoad = getShiftLoad(bus, normalizedShift)
       │       availableSeats = totalCapacity - shiftLoad
       │       isFull = availableSeats <= 0
       │       Sort buses: availableSeats DESC
       │
       ├─► 8. Determine primaryBus:
       │       selectedBusId ? matchingBuses.find(id) : (matchingBuses.find(routeId) || matchingBuses[0])
       │
       ├─► 9. Filter alternativeBuses:
       │       matchingBuses.filter(bus != primaryBus && availableSeats > 0)
       │
       ▼
[ Decision Branching ]
       │
       ├─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
       ▼                                 ▼                                 ▼                                 ▼
[ Case 1: Primary Available ]    [ Case 2: Bus Full, Alt Exists ]   [ Case 3: Bus Full, Single Stop ] [ Case 4: No Buses Match Stop ]
• isFull: false                  • isFull: true                     • isFull: true                    • isFull: false
• hasAlternatives: boolean       • hasAlternatives: true            • hasAlternatives: false          • hasAlternatives: false
• canProceed: true               • canProceed: true                 • canProceed: true (CRITICAL!)    • canProceed: true
• needsCapacityReview: false     • needsCapacityReview: true        • needsCapacityReview: true       • needsCapacityReview: true
• reassignmentReason: 'no_issue' • reassignmentReason:              • reassignmentReason:             • message: "No buses found..."
                                    'bus_full_alternatives_exist'      'bus_full_only_option'
```

#### Sequence & Atomicity Trace: The "Full Bus" and "Single-Bus Stop" Scenarios

```
Scenario A: Selected Bus Full, Alternative Buses Exist
Applicant Stop: "Khanapara" | Shift: "Morning"
Primary Bus: Bus 04 (Capacity: 50, Morning Load: 50 -> Available: 0) -> FULL
Alternative Bus: Bus 08 (Capacity: 50, Morning Load: 38 -> Available: 12) -> Serves "Khanapara"

1. POST /api/buses/capacity returns:
   {
     selectedBus: { busId: "bus_04", isFull: true, availableSeats: 0 },
     alternativeBuses: [{ busId: "bus_08", isFull: false, availableSeats: 12 }],
     hasAlternatives: true,
     canProceed: true,
     needsCapacityReview: true,
     reassignmentReason: "bus_full_alternatives_exist"
   }
2. Applicant proceeds and submits application. Form stores:
   needs_capacity_review = true, has_alternative_buses = true, reassignment_reason = 'bus_full_alternatives_exist'
3. Admin views application in /admin/applications:
   UI flags that Bus 04 is full. Admin clicks "Approve" -> AlternativeBusPicker modal opens automatically.
4. Admin selects Bus 08:
   Admin approval calls /api/applications/approve with { overrideBusId: "bus_08" }.
5. Approval proceeds atomically on Bus 08.

-----------------------------------------------------------------------------------------------------------------------

Scenario B: Selected Bus Full, Single-Bus Stop (No Other Bus Serves Stop)
Applicant Stop: "Sonapur Outpost" | Shift: "Morning"
Primary Bus: Bus 12 (Capacity: 45, Morning Load: 45 -> Available: 0) -> FULL
Alternative Buses: NONE (Bus 12 is the only bus assigned to Route 09, and no other route stops at Sonapur Outpost).

1. POST /api/buses/capacity returns:
   {
     selectedBus: { busId: "bus_12", isFull: true, availableSeats: 0 },
     alternativeBuses: [],
     hasAlternatives: false,
     canProceed: true,            <--- APPLICANT IS NOT BLOCKED FROM SUBMITTING!
     needsCapacityReview: true,
     requiresAdminNotification: true,
     reassignmentReason: "bus_full_only_option",
     message: "The bus (Bus 12) for your stop is currently full and this is the only bus serving this stop. Your application will be reviewed by the managing team for seat availability after submission."
   }
2. Application is submitted and persists with:
   needs_capacity_review = true, has_alternative_buses = false, reassignment_reason = 'bus_full_only_option'
3. Admin Review & Lockout Reality:
   When Admin attempts to approve this applicant WITHOUT expanding bus capacity:
   a. POST /api/applications/approve calls db.rpc('approve_application') -> acquires lock.
   b. Calls db.rpc('identity_activate_student_with_capacity', { p_bus_id: 'bus_12', p_shift: 'Morning', ... }).
   c. Inside identity_activate_student_with_capacity, PostgreSQL checks:
        v_current_morning >= v_bus_capacity
      Since 45 >= 45, RPC aborts and raises exception: 'Bus bus_12 is at full capacity (45/45)'.
   d. application.service.ts catches error:
        catch (err: any) {
          await db.rpc('release_application_lock', { p_application_id: id });
          return { success: false, error: err.message };
        }
   e. The application remains in 'submitted' state with lock released.
   f. Resolution Options for Admin:
      - Admin manually increases capacity on Bus 12 in /admin/buses.
      - Admin reassigns another existing student off Bus 12 to create an empty seat via Smart Allocation.
      - Admin re-routes another bus to include "Sonapur Outpost".
```

---

### 3.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/lib/bus-capacity-checker.ts` | `checkBusCapacity`, `checkCapacityForApplication`, `createOverloadNotification`, `createNearCapacityNotification` | Application Form Wizard, Admin/Moderator UI, Client hooks | `fetch('/api/buses/capacity')`, `fetch('/api/notifications/create')` | Client-side utility; reads Next.js API endpoints. |
| `src/app/api/buses/capacity/route.ts` | `GET`, `POST` | `src/lib/bus-capacity-checker.ts`, Application wizard components | `verifyApiAuth`, `applyRateLimit`, `fleet.service.checkBusCapacity`, `route.service.getAll`, `fleet.service.getAllBuses`, `shift-utils` | In-memory 30s cache (`cachedRoutes`, `cachedBuses`); reads `public.buses`, `public.routes`. |
| `src/components/smart-allocation/AlternativeBusPicker.tsx` | `AlternativeBusPicker` (React Dialog Component) | Admin Application Review Table, Moderator Application Review | `Dialog`, `Badge`, `Button`, `motion`, `sonner.toast`, `normalizeShift` | UI component; invokes `onSelect(busId)` prop to submit approval with `overrideBusId`. |
| `src/lib/utils/application-eligibility.ts` | `computeFutureEligibleApproval`, `resolveApplicationType`, `isApprovalEligible`, `getUpcomingStatus`, `isUpcomingApplication`, `resolveEligibleApprovalAtCreation`, `deriveCreationCategorisation` | `application.service.ts`, `application.repository.pg.ts`, Application submission & approval routes | `deadline-computation.ts` | Pure business logic; computes and verifies future session eligibility dates. |
| `src/domains/seat/services/seat-assignment.service.ts` | `getCapacity`, `assignSeat`, `releaseSeat`, `findAlternativeBuses`, `validateAssignment` | Application domain, Allocation domain, Admin APIs | `seat.repository.ts` | Thin domain orchestration layer. |
| `src/domains/seat/repositories/seat.repository.ts` | `getBusCapacity`, `incrementCapacity`, `decrementCapacity`, `findAlternatives`, `validateAssignment` | `seat-assignment.service.ts` | `fleet.service`, `route.service`, `shift-utils` | Delegates directly to `fleet.service` and `route.service` against PostgreSQL `buses` and `routes`. |
| `src/domains/fleet/services/fleet.service.ts` | `checkBusCapacity`, `incrementBusCapacity`, `decrementBusCapacity`, `getAllBuses`, `getBusById`, `invalidateBusCache` | Seat domain, Bus APIs, Cron jobs | `fleet.repository.pg.ts` | In-memory fleet cache (2-min TTL: `allBusesCache`, `busByIdCache`); queries `public.buses`. |

---

### 3.3 Method-by-Method Low-Level Walkthrough

#### 1. `checkCapacityForApplication` (`src/lib/bus-capacity-checker.ts`)
- **Signature:** `async function checkCapacityForApplication(routeId: string, stop_name: string, selectedBusId?: string, shift?: string): Promise<CapacityCheckResult>`
- **Control Flow:**
  1. Calls `getAuthHeaders()` to extract Bearer JWT from Firebase Client Auth (`auth?.currentUser?.getIdToken()`).
  2. Issues `fetch('/api/buses/capacity', { method: 'POST', body: JSON.stringify({ routeId, stop_name, busId: selectedBusId, shift }) })`.
  3. If response is not OK or throws network error, fails open with:
     ```json
     {
       "selectedBus": null,
       "isFull": false,
       "alternativeBuses": [],
       "hasAlternatives": false,
       "canProceed": true,
       "message": "Unable to check bus capacity. Please proceed with application.",
       "requiresAdminNotification": false,
       "needsCapacityReview": false,
       "isNearCapacity": false,
       "capacityPercentage": 0
     }
     ```
  4. If successful, parses JSON payload returned by `POST /api/buses/capacity`.

#### 2. `POST /api/buses/capacity` (`src/app/api/buses/capacity/route.ts`)
- **Signature:** `export async function POST(request: NextRequest): Promise<NextResponse>`
- **Control Flow & Branching:**
  1. `verifyApiAuth(request)`: Returns `401 Unauthorized` if invalid session.
  2. `applyRateLimit(uid: 'buses-capacity-check', RateLimits.READ)`: Returns `429 Too Many Requests` if burst exceeded.
  3. Parse body: extracts `routeId`, `stop_name`, `busId` (`selectedBusId`), `shift`.
  4. Validation: If `!routeId || !resolved_stop_name`, returns `400 Bad Request`.
  5. Fetch routes via `getCachedRoutes()` (30-second memory cache).
  6. Filters routes where `route.stops` contains an item matching `resolved_stop_name` (case-insensitive string trim comparison on `stop.stop_name || stop.name`).
  7. If `matchingRouteIds.length === 0`:
     - Returns `200 OK` with `canProceed: true`, `needsCapacityReview: true`, `requiresAdminNotification: true`, `message: 'No buses found for this stop. Your application will be reviewed by the managing team.'`
  8. Fetch buses via `getCachedBuses()` (30-second memory cache).
  9. Filters buses whose `routeId` is in `matchingRouteIds`.
  10. Shift Compatibility Filter: Calls `areShiftsCompatible(shift, bus.shift || 'Both')`. Morning-only buses are rejected for Evening applicants; Evening-only buses are rejected for Morning applicants; 'Both' is compatible with all shifts.
  11. Maps candidates to capacity objects:
      - `totalCapacity = bus.capacity || 0`
      - `shiftLoad = getShiftLoad(bus, normalizedShift)` (evaluates `bus.morning_load` or `bus.evening_load`)
      - `availableSeats = totalCapacity - shiftLoad`
      - `isFull = availableSeats <= 0`
      - Sorts descending by `availableSeats`.
  12. Resolves `primaryBus`:
      - If `selectedBusId` specified, finds in matching buses.
      - Otherwise, finds matching bus with `routeId === body.routeId`, falling back to `matchingBuses[0]`.
  13. Computes `isNearCapacity = currentCapacityPercentage > 95`.
  14. Computes `alternativeBuses = matchingBuses.filter(bus => bus.busId !== primaryBus.busId && bus.availableSeats > 0)`.
  15. **Critical Branch - Primary Bus Full:**
      - If `primaryBus.isFull` AND `alternativeBuses.length > 0`:
        - Returns `reassignmentReason: 'bus_full_alternatives_exist'`, `hasAlternatives: true`, `needsCapacityReview: true`, `canProceed: true`.
      - If `primaryBus.isFull` AND `alternativeBuses.length === 0` (**Single-Bus Stop / Capacity Exhausted**):
        - Returns `reassignmentReason: 'bus_full_only_option'`, `hasAlternatives: false`, `needsCapacityReview: true`, `canProceed: true`, `requiresAdminNotification: true`.
  16. **Primary Bus Has Capacity:**
      - Returns `reassignmentReason: 'no_issue'`, `isFull: false`, `canProceed: true`, `needsCapacityReview: false`.

#### 3. `AlternativeBusPicker` (`src/components/smart-allocation/AlternativeBusPicker.tsx`)
- **Signature:** `export default function AlternativeBusPicker(props: AlternativeBusPickerProps): JSX.Element`
- **State & Props:**
  - Props: `applicantName`, `applicantStopName`, `applicantShift`, `currentBus`, `alternatives`, `onSelect: (busId: string) => Promise<void>`, `onClose: () => void`.
  - State: `selectedBusId` (string | null), `submitting` (boolean).
- **Control Flow:**
  1. Computes `shift = normalizeShift(applicantShift)`.
  2. Sorts `alternatives` by remaining free seats in descending order.
  3. Renders full-screen modal with warning: `"${currentBus.busNumber} is at full capacity (${currentBus.capacity}/${currentBus.capacity})"`.
  4. Renders alternative bus cards displaying:
     - Bus Number & Route Name.
     - Shift Badge & Available seats badge (Emerald if >5 seats, Amber if <=5).
     - Progress bar showing current shift load percentage (Green <70%, Amber 70-90%, Red >90%).
  5. On user click, invokes `handleSelect(bus.id)`:
     - Sets `selectedBusId = bus.id`, `submitting = true`.
     - Calls parent `onSelect(bus.id)`.
     - If approval rejects, catches error, displays toast notification via Sonner, and unlocks UI.

#### 4. `findAlternatives` (`src/domains/seat/repositories/seat.repository.ts`)
- **Signature:** `export async function findAlternatives(stop_name: string, routeId: string, shift: string, preFetchedBuses?: any[], preFetchedRoutes?: any[]): Promise<{ success: boolean; alternativeBuses?: any[]; message: string; adminAlert?: boolean }>`
- **Control Flow:**
  1. Reuses pre-fetched buses and routes or queries `fleetService.getAllBuses()` and `routeService.getAll()`.
  2. Finds routes passing through `stop_name`.
  3. Excludes current `routeId` (`if (bus.routeId === routeId) return false`).
  4. Checks shift compatibility and available seats (`shiftLoad < bus.capacity`).
  5. Returns structured alternatives array or flags `adminAlert: true` if all buses serving the area are exhausted.

---

### 3.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Execution Context | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls | Latency Profile |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Cold Cache (First Request / Cache Expired)** | 2 queries: `SELECT * FROM routes`, `SELECT * FROM buses` | 0 | 1 Firebase Auth token verification (`verifyApiAuth`) | ~45ms - 85ms |
| **(b) Warm Cache (< 30s after previous check)** | 0 queries (Served entirely from `cachedRoutes` and `cachedBuses` module memory) | 0 | 1 Firebase Auth token verification (`verifyApiAuth`) | ~3ms - 8ms |
| **(c) Concurrency / Bus Full with Alternatives Exist** | 0 queries (Warm cache) | 0 | 1 Firebase Auth token verification | ~5ms |
| **(d) Concurrency / Single-Bus Stop Full (No Alternatives)** | 0 queries (Warm cache) | 0 | 1 Firebase Auth token verification + optional client-side `createOverloadNotification` call to `/api/notifications/create` (writes 1 row to `notifications`) | ~6ms (API) + ~40ms (notification) |
| **(e) Admin Approval Capacity Rejection (Locked Collision)** | 2 RPCs: `approve_application` (locks row), `identity_activate_student_with_capacity` (fails with capacity exception), 1 compensation RPC: `release_application_lock` | 0 | 0 | ~35ms |

---

### 3.5 Verbatim Source Code from Live Codebase

#### 1. `src/lib/bus-capacity-checker.ts` (Lines 1–206)
```typescript
import { auth } from '@/lib/firebase';

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const user = auth?.currentUser;
    if (user) {
      const token = await user.getIdToken();
      return { Authorization: `Bearer ${token}` };
    }
  } catch (e) {
    // Ignore token acquisition errors
  }
  return {};
}

export interface BusCapacityInfo {
  busId: string;
  busNumber: string;
  capacity: number;
  currentMembers: number;
  availableSeats: number;
  isFull: boolean;
  routeId: string;
  routeName: string;
}

export interface CapacityCheckResult {
  selectedBus: BusCapacityInfo | null;
  isFull: boolean;
  alternativeBuses: BusCapacityInfo[];
  hasAlternatives: boolean;
  canProceed: boolean;
  message: string;
  requiresAdminNotification: boolean;
  needsCapacityReview: boolean;
  isNearCapacity: boolean;
  capacityPercentage: number;
  reassignmentReason?: 'bus_full_only_option' | 'bus_full_alternatives_exist' | 'no_issue';
}

/**
 * Checks if a specific bus has available capacity.
 * Calls GET /api/buses/capacity server-side (PostgreSQL).
 */
export async function checkBusCapacity(busId: string, shift?: string): Promise<BusCapacityInfo | null> {
  try {
    const params = new URLSearchParams({ busId });
    if (shift) params.set('shift', shift);

    const headers = await getAuthHeaders();
    const response = await fetch(`/api/buses/capacity?${params.toString()}`, { headers });
    if (!response.ok) {
      console.error('Capacity check failed:', response.statusText);
      return null;
    }

    const data = await response.json();

    return {
      busId: data.busId,
      busNumber: data.busNumber || busId,
      capacity: data.capacity,
      currentMembers: data.currentMembers,
      availableSeats: data.availableSeats,
      isFull: data.isFull,
      routeId: data.routeId || '',
      routeName: data.routeName || '',
    };
  } catch (error) {
    console.error('Error checking bus capacity:', error);
    return null;
  }
}

/**
 * Comprehensive capacity check for new application.
 * Calls POST /api/buses/capacity server-side (PostgreSQL).
 */
export async function checkCapacityForApplication(
  routeId: string,
  stop_name: string,
  selectedBusId?: string,
  shift?: string
): Promise<CapacityCheckResult> {
  try {
    const authHeaders = await getAuthHeaders();
    const response = await fetch('/api/buses/capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ routeId, stop_name, busId: selectedBusId, shift }),
    });

    if (!response.ok) {
      console.error('Capacity check failed:', response.statusText);
      return {
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'Unable to check bus capacity. Please proceed with application.',
        requiresAdminNotification: false,
        needsCapacityReview: false,
        isNearCapacity: false,
        capacityPercentage: 0,
      };
    }

    return await response.json();
  } catch (error) {
    console.error('Error in capacity check:', error);
    return {
      selectedBus: null,
      isFull: false,
      alternativeBuses: [],
      hasAlternatives: false,
      canProceed: true,
      message: 'Unable to check bus capacity. Please proceed with application.',
      requiresAdminNotification: false,
      needsCapacityReview: false,
      isNearCapacity: false,
      capacityPercentage: 0,
    };
  }
}

/**
 * Creates an admin notification for overloaded bus.
 */
export async function createOverloadNotification(
  studentName: string,
  enrollmentId: string,
  busInfo: BusCapacityInfo,
  stop_name: string
): Promise<boolean> {
  try {
    const response = await fetch('/api/notifications/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        title: 'Bus Capacity Alert - Overloaded Bus Request',
        content: `**Student Application Alert**\n\n` +
          `**Student:** ${studentName} (${enrollmentId})\n` +
          `**Bus:** ${busInfo.busNumber} (${busInfo.busId})\n` +
          `**Stop:** ${stop_name}\n` +
          `**Status:** Bus is currently at FULL capacity (${busInfo.currentMembers}/${busInfo.capacity})\n\n` +
          `**Action Required:** Please review capacity reallocation or consider adding additional bus service for this route.\n\n` +
          `[View Smart Allocation](/admin/smart-allocation)`,
        targetType: 'all_role',
        targetRole: 'admin',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error creating overload notification:', error);
    return false;
  }
}

/**
 * Creates an admin notification for near-capacity bus (>95%).
 */
export async function createNearCapacityNotification(
  studentName: string,
  enrollmentId: string,
  busInfo: BusCapacityInfo,
  stop_name: string,
  currentPercentage: number,
  futurePercentage: number
): Promise<boolean> {
  try {
    const futureMembers = busInfo.currentMembers + 1;
    const futureAvailableSeats = busInfo.capacity - futureMembers;

    const response = await fetch('/api/notifications/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        title: 'Bus Near Capacity - High Utilization Alert',
        content: `**New Student Enrollment - Capacity Warning**\n\n` +
          `**Student:** ${studentName} (${enrollmentId})\n` +
          `**Bus:** ${busInfo.busNumber} (${busInfo.busId})\n` +
          `**Stop:** ${stop_name}\n\n` +
          `**Current Capacity:**\n` +
          `• Occupancy: ${busInfo.currentMembers}/${busInfo.capacity} seats (${currentPercentage.toFixed(1)}%)\n` +
          `• Available: ${busInfo.availableSeats} seat(s)\n\n` +
          `**After Enrollment:**\n` +
          `• Occupancy: ${futureMembers}/${busInfo.capacity} seats (${futurePercentage.toFixed(1)}%)\n` +
          `• Available: ${futureAvailableSeats} seat(s)\n\n` +
          `**Recommended Action:** Review bus allocation and consider capacity expansion if trend continues.\n\n` +
          `[View Smart Allocation](/admin/smart-allocation)`,
        targetType: 'all_role',
        targetRole: 'admin',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error creating near-capacity notification:', error);
    return false;
  }
}
```

#### 2. `src/app/api/buses/capacity/route.ts` (Lines 1–258)
```typescript
import { checkBusCapacity, getAllBuses } from '@/domains/fleet/services/fleet.service';
import { getAll as getAllRoutes } from '@/domains/route/services/route.service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { areShiftsCompatible, getShiftLoad, normalizeShift } from '@/lib/utils/shift-utils';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/buses/capacity?busId=xxx&shift=Morning
 * Simple single-bus capacity check.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'buses-capacity'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const busId = searchParams.get('busId');
    const shift = searchParams.get('shift') || undefined;

    if (!busId) {
      return NextResponse.json({ error: 'busId is required' }, { status: 400 });
    }

    const result = await checkBusCapacity(busId, shift || undefined);

    return NextResponse.json({
      busId,
      busNumber: busId,
      capacity: result.capacity,
      currentMembers: result.shiftLoad,
      availableSeats: result.capacity - result.shiftLoad,
      isFull: !result.available,
      shiftLoad: result.shiftLoad,
      shift: shift ? normalizeShift(shift) : null,
    }, { headers: rl.headers });
  } catch (error: any) {
    return NextResponse.json(handleApiError(error, 'buses-capacity-get', 'Failed to check capacity'), { status: 500 });
  }
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
let cachedRoutes: CacheEntry<any[]> | null = null;
let cachedBuses: CacheEntry<any[]> | null = null;
const CACHE_TTL_MS = 30_000;

async function getCachedRoutes(): Promise<any[]> {
  const now = Date.now();
  if (cachedRoutes && cachedRoutes.expiresAt > now) {
    return cachedRoutes.data;
  }
  const routes = await getAllRoutes();
  cachedRoutes = { data: routes, expiresAt: now + CACHE_TTL_MS };
  return routes;
}

async function getCachedBuses(): Promise<any[]> {
  const now = Date.now();
  if (cachedBuses && cachedBuses.expiresAt > now) {
    return cachedBuses.data;
  }
  const buses = await getAllBuses();
  cachedBuses = { data: buses, expiresAt: now + CACHE_TTL_MS };
  return buses;
}

/**
 * POST /api/buses/capacity
 * Body: { routeId, stop_name, stop_name, busId?, shift? }
 * Comprehensive capacity check for application flow.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'buses-capacity-check'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const body = await request.json();
    const { routeId, stop_name, busId: selectedBusId, shift } = body;
    const resolved_stop_name = stop_name || body.stop_name || body.stop_name;

    if (!routeId || !resolved_stop_name) {
      return NextResponse.json({ error: 'routeId and stop_name are required' }, { status: 400 });
    }

    const normalizedShift = normalizeShift(shift);

    // Find all routes that contain this stop (using cached lookup)
    const allRoutes = await getCachedRoutes();
    const matchingRouteIds = allRoutes
      .filter(route => {
        const stops = route.stops || [];
        return stops.some((stop: any) => {
          const name = (stop.stop_name || stop.name || '').toLowerCase().trim();
          const target = resolved_stop_name.toLowerCase().trim();
          return name === target;
        });
      })
      .map(route => route.routeId || route.id)
      .filter(Boolean);

    if (matchingRouteIds.length === 0) {
      return NextResponse.json({
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'No buses found for this stop. Your application will be reviewed by the managing team.',
        requiresAdminNotification: true,
        needsCapacityReview: true,
        isNearCapacity: false,
        capacityPercentage: 0,
      }, { headers: rl.headers });
    }

    // Get all buses and filter by matching routes + shift (using cached lookup)
    const allBuses = await getCachedBuses();
    const candidateBuses = allBuses.filter(bus => matchingRouteIds.includes(bus.routeId || ''));

    // Filter by shift compatibility
    const filteredBuses = shift
      ? candidateBuses.filter(bus => {
          const busShift = bus.shift || 'Both';
          return areShiftsCompatible(shift, busShift);
        })
      : candidateBuses;

    // Compute capacity for each candidate
    const matchingBuses = filteredBuses.map(bus => {
      const totalCapacity = bus.capacity || 0;
      const shiftLoad = getShiftLoad(bus, normalizedShift);
      const availableSeats = totalCapacity - shiftLoad;

      return {
        busId: bus.busId || bus.id || '',
        busNumber: bus.busNumber || bus.id || '',
        capacity: totalCapacity,
        currentMembers: shiftLoad,
        availableSeats,
        isFull: availableSeats <= 0,
        routeId: bus.routeId || '',
        routeName: bus.routeName || '',
      };
    }).sort((a, b) => b.availableSeats - a.availableSeats);

    if (matchingBuses.length === 0) {
      return NextResponse.json({
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'No buses found for this stop. Your application will be reviewed by the managing team.',
        requiresAdminNotification: true,
        needsCapacityReview: true,
        isNearCapacity: false,
        capacityPercentage: 0,
      }, { headers: rl.headers });
    }

    // Find primary bus
    const primaryBus = selectedBusId
      ? matchingBuses.find(bus => bus.busId === selectedBusId)
      : (matchingBuses.find(bus => bus.routeId === routeId) || matchingBuses[0]);

    if (!primaryBus) {
      return NextResponse.json({
        selectedBus: null,
        isFull: false,
        alternativeBuses: matchingBuses,
        hasAlternatives: true,
        canProceed: false,
        message: 'Selected bus does not stop here. Please choose another stop or bus.',
        requiresAdminNotification: false,
        needsCapacityReview: false,
        isNearCapacity: false,
        capacityPercentage: 0,
      }, { headers: rl.headers });
    }

    const currentCapacityPercentage = primaryBus.capacity > 0
      ? (primaryBus.currentMembers / primaryBus.capacity) * 100
      : 0;
    const futureCapacityPercentage = primaryBus.capacity > 0
      ? ((primaryBus.currentMembers + 1) / primaryBus.capacity) * 100
      : 0;
    const isNearCapacity = currentCapacityPercentage > 95;

    const alternativeBuses = matchingBuses.filter(bus =>
      bus.busId !== primaryBus.busId && bus.availableSeats > 0
    );

    if (primaryBus.isFull) {
      if (alternativeBuses.length > 0) {
        return NextResponse.json({
          selectedBus: primaryBus,
          isFull: true,
          alternativeBuses,
          hasAlternatives: true,
          canProceed: true,
          message: alternativeBuses.length === 1
            ? `The selected bus (${primaryBus.busNumber}) is full. You will be assigned to ${alternativeBuses[0].busNumber} which has ${alternativeBuses[0].availableSeats} available seat(s).`
            : `The selected bus (${primaryBus.busNumber}) is full. Please select from available buses: ${alternativeBuses.map(b => `${b.busNumber} (${b.availableSeats} seats)`).join(', ')}.`,
          requiresAdminNotification: false,
          needsCapacityReview: true,
          isNearCapacity: false,
          capacityPercentage: 100,
          reassignmentReason: 'bus_full_alternatives_exist',
        }, { headers: rl.headers });
      } else {
        return NextResponse.json({
          selectedBus: primaryBus,
          isFull: true,
          alternativeBuses: [],
          hasAlternatives: false,
          canProceed: true,
          message: `The bus (${primaryBus.busNumber}) for your stop is currently full and this is the only bus serving this stop. Your application will be reviewed by the managing team for seat availability after submission.`,
          requiresAdminNotification: true,
          needsCapacityReview: true,
          isNearCapacity: false,
          capacityPercentage: 100,
          reassignmentReason: 'bus_full_only_option',
        }, { headers: rl.headers });
      }
    }

    return NextResponse.json({
      selectedBus: primaryBus,
      isFull: false,
      alternativeBuses: alternativeBuses.length > 0 ? alternativeBuses : [],
      hasAlternatives: alternativeBuses.length > 0,
      canProceed: true,
      message: `✓ Bus ${primaryBus.busNumber} has ${primaryBus.availableSeats} available seat(s).`,
      requiresAdminNotification: false,
      needsCapacityReview: false,
      isNearCapacity,
      capacityPercentage: futureCapacityPercentage,
      reassignmentReason: 'no_issue',
    }, { headers: rl.headers });
  } catch (error: any) {
    return NextResponse.json(handleApiError(error, 'buses-capacity-post', 'Failed to check capacity'), { status: 500 });
  }
}
```

#### 3. `src/components/smart-allocation/AlternativeBusPicker.tsx` (Lines 1–272)
```typescript
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { normalizeShift, type CanonicalShift } from "@/lib/utils/shift-utils";
import { motion } from "motion/react";
import {
	AlertCircle,
	ArrowRight,
	Bus,
	Check,
	MapPin,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";

// ── Types (compatible with ReassignmentPanel) ─────────────────────────────────

export interface AlternativeBusData {
  id: string;
  busNumber: string;
  routeId?: string;
  routeName?: string;
  capacity: number;
  shift: string;
  load?: {
    morningCount?: number;
    eveningCount?: number;
  };
  currentMembers?: number;
}

export interface AlternativeBusPickerProps {
  applicantName: string;
  applicantStopName: string;
  applicantShift: string;
  currentBus: AlternativeBusData;
  alternatives: AlternativeBusData[];
  onSelect: (busId: string) => Promise<void>;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getShiftLoad(
  bus: AlternativeBusData,
  shift: CanonicalShift
): number {
  const load = bus.load || {};
  const morning = Number((bus as any).morningLoad ?? (bus as any).morning_load ?? load.morningCount ?? 0);
  const evening = Number((bus as any).eveningLoad ?? (bus as any).evening_load ?? load.eveningCount ?? 0);
  if (shift === "Both") return Math.max(morning, evening);
  if (shift === "Evening") return evening;
  return morning;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AlternativeBusPicker({
  applicantName,
  applicantStopName,
  applicantShift,
  currentBus,
  alternatives,
  onSelect,
  onClose,
}: AlternativeBusPickerProps) {
  const shift = normalizeShift(applicantShift);
  const [selectedBusId, setSelectedBusId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Sort alternatives: most available seats first
  const sortedAlternatives = [...alternatives].sort((a, b) => {
    const seatsA = Math.max(0, (a.capacity || 55) - getShiftLoad(a, shift));
    const seatsB = Math.max(0, (b.capacity || 55) - getShiftLoad(b, shift));
    return seatsB - seatsA;
  });

  const handleSelect = async (busId: string) => {
    if (submitting) return;
    setSelectedBusId(busId);
    setSubmitting(true);
    try {
      await onSelect(busId);
    } catch (err: any) {
      toast.error(err?.message || "Failed to approve with alternative bus");
      setSubmitting(false);
      setSelectedBusId(null);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent 
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-xl bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 p-0 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header — same gradient as ReassignmentPanel */}
        <DialogHeader className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/30 dark:via-pink-950/30 dark:to-purple-950/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <Bus className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-zinc-900 dark:text-white">
                Select Alternative Bus
              </DialogTitle>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">{currentBus.busNumber}</span> is full for{" "}
                <span className="font-semibold">{applicantName}</span>
                {applicantStopName ? <> at <MapPin className="w-3 h-3 inline text-purple-500" /> {applicantStopName}</> : ""}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Full-bus banner */}
        <div className="px-5 py-3 border-b border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {currentBus.busNumber} is at full capacity ({currentBus.capacity}/{currentBus.capacity})
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              {sortedAlternatives.length} alternative bus{sortedAlternatives.length !== 1 ? "es" : ""} serve this stop with available {shift.toLowerCase()} seats.
              Select one to approve this application.
            </p>
          </div>
        </div>

        {/* Alternative bus cards */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4">
            {sortedAlternatives.map((bus, idx) => {
              const currentLoad = getShiftLoad(bus, shift);
              const capacity = bus.capacity || 55;
              const availableSeats = Math.max(0, capacity - currentLoad);
              const loadPercent = Math.min(100, (currentLoad / capacity) * 100);

              return (
                <motion.div
                  key={bus.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={cn(
                    "group relative transition-all duration-300 rounded-xl p-4 shadow-lg border cursor-pointer",
                    selectedBusId === bus.id
                      ? "border-purple-500 bg-purple-500/5 shadow-[0_0_20px_-5px_rgba(168,85,247,0.25)] dark:bg-purple-950/20 dark:border-purple-500"
                      : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800/80 hover:border-purple-500/50 hover:shadow-[0_0_20px_-5px_rgba(168,85,247,0.15)]"
                  )}
                  onClick={() => !submitting && handleSelect(bus.id)}
                >
                  {/* Bus header — matches ReassignmentPanel card structure */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg border transition-colors",
                        selectedBusId === bus.id
                          ? "bg-purple-500 border-purple-400 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-purple-500 group-hover:text-purple-400"
                      )}>
                        {selectedBusId === bus.id ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <Bus className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-base text-zinc-900 dark:text-white tracking-tight">
                            {bus.busNumber}
                          </h4>
                          {bus.routeName && (
                            <Badge variant="outline" className="text-[10px] h-5 border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 font-normal">
                              {bus.routeName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn(
                            "text-[10px] px-1.5 h-4 border",
                            normalizeShift(bus.shift) === "Morning"
                              ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                              : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                          )}>
                            {normalizeShift(bus.shift)}
                          </Badge>
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                            availableSeats > 5
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          )}>
                            {availableSeats} seat{availableSeats !== 1 ? "s" : ""} left
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Select button */}
                    <Button
                      size="sm"
                      variant={selectedBusId === bus.id ? "default" : "outline"}
                      disabled={submitting}
                      className={cn(
                        "h-8 text-[11px] font-bold shadow-sm transition-all",
                        selectedBusId === bus.id
                          ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white border-0"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400"
                      )}
                    >
                      {selectedBusId === bus.id ? "Staging…" : "Select"}
                      {selectedBusId !== bus.id && <ArrowRight className="w-3 h-3 ml-1" />}
                    </Button>
                  </div>

                  {/* Load stats — matches ReassignmentPanel card structure */}
                  <div className="grid grid-cols-2 gap-4 mb-3 px-1">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-bold mb-1">
                        Current {shift} Load
                      </div>
                      <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {loadPercent.toFixed(0)}%{" "}
                        <span className="text-zinc-400 dark:text-zinc-500 text-xs">({currentLoad}/{capacity})</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold mb-1">
                        Available
                      </div>
                      <div className="text-sm font-bold text-zinc-900 dark:text-white">
                        {availableSeats} <span className="text-zinc-400 dark:text-zinc-500 text-xs font-normal">free</span>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar — same dimensions as ReassignmentPanel */}
                  <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700/50">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${loadPercent}%` }}
                      transition={{ duration: 0.6, delay: idx * 0.05 }}
                      className={cn(
                        "h-full rounded-full",
                        loadPercent > 90
                          ? "bg-red-500"
                          : loadPercent > 70
                            ? "bg-amber-500"
                            : "bg-gradient-to-r from-purple-600 to-pink-500"
                      )}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### 4. `src/domains/seat/repositories/seat.repository.ts` (Lines 1–129)
```typescript
/**
 * D8 Seat Repository (capacity + reassignment persistence)
 *
 * Persistence only — no business logic.
 *
 * Capacity operations delegate to D6 Fleet domain (PostgreSQL buses table).
 * Route stop matching delegates to D7 Route domain (PostgreSQL routes table).
 * Zero Firestore reads.
 */
import * as fleetService from '@/domains/fleet';
import * as routeService from '@/domains/route';
import { areShiftsCompatible, getShiftLoad } from '@/lib/utils/shift-utils';

export async function getBusCapacity(busId: string, shift?: string) {
  const result = await fleetService.checkBusCapacity(busId, shift);
  return {
    available: result.available,
    currentMembers: result.shiftLoad,
    shiftLoad: result.shiftLoad,
    capacity: result.capacity,
  };
}

export async function incrementCapacity(busId: string, _studentUid: string, shift?: string): Promise<void> {
  await fleetService.incrementBusCapacity(busId, shift);
}

export async function decrementCapacity(busId: string, _studentUid: string, shift?: string): Promise<void> {
  await fleetService.decrementBusCapacity(busId, shift);
}

export async function findAlternatives(
  stop_name: string,
  routeId: string,
  shift: string,
  preFetchedBuses?: any[],
  preFetchedRoutes?: any[]
) {
  // ponytail: Use pre-fetched data if available to avoid N+1 database roundtrips
  const allBuses = preFetchedBuses || await fleetService.getAllBuses();
  const allRoutes = preFetchedRoutes || await routeService.getAll();

  const matchingRouteIds = allRoutes
    .filter(route => {
      const stops = route.stops || [];
      return stops.some((stop: any) => {
        const id = (stop.stop_name || stop.id || stop.name || '').toLowerCase().trim();
        const name = (stop.name || '').toLowerCase().trim();
        return id === stop_name.toLowerCase().trim() || name === stop_name.toLowerCase().trim();
      });
    })
    .map(route => route.routeId || route.id)
    .filter(Boolean);

  const alternativeBuses = allBuses
    .filter(bus => {
      if (bus.routeId === routeId) return false;
      if (!matchingRouteIds.includes(bus.routeId || '')) return false;
      const busShift = bus.shift || 'Both';
      if (!areShiftsCompatible(shift, busShift)) return false;
      const shiftLoad = getShiftLoad(bus, shift);
      return shiftLoad < bus.capacity;
    })
    .map(bus => ({
      busId: bus.busId || bus.id || '',
      busNumber: bus.busNumber,
      capacity: bus.capacity,
      currentMembers: getShiftLoad(bus, shift),
      routeId: bus.routeId || '',
      shift: bus.shift || 'Both',
      isFull: false,
    }))
    .sort((a, b) => (b.capacity - b.currentMembers) - (a.capacity - a.currentMembers));

  if (alternativeBuses.length > 0) {
    return {
      success: true,
      alternativeBuses,
      message: `Found ${alternativeBuses.length} alternative bus(es) that pass through your stop with available seats.`,
    };
  }

  return {
    success: false,
    message: 'All buses serving your area are currently full. An administrator has been notified and will assist you shortly.',
    adminAlert: true,
  };
}

export async function validateAssignment(params: { routeId: string; stop_name: string; shift: string }) {
  const { routeId, stop_name, shift } = params;

  const buses = await fleetService.getBusesByRouteId(routeId);
  const busId = buses[0]?.id || buses[0]?.busId;
  if (!busId) {
    return {
      canAssign: false,
      message: `No bus assigned to route ${routeId}`,
      requiresAdminAttention: true,
    };
  }

  const capacityCheck = await fleetService.checkBusCapacity(busId, shift);

  if (capacityCheck.available) {
    return {
      canAssign: true,
      busId,
      message: `Seat available on Bus ${busId} (${capacityCheck.shiftLoad}/${capacityCheck.capacity})`,
    };
  }

  const alternativeResult = await findAlternatives(stop_name, routeId, shift);

  if (alternativeResult.success && alternativeResult.alternativeBuses && alternativeResult.alternativeBuses.length > 0) {
    return {
      canAssign: false,
      message: `Bus ${busId} is full. ${alternativeResult.message}`,
      alternatives: alternativeResult.alternativeBuses,
    };
  }

  return {
    canAssign: false,
    message: alternativeResult.message,
    requiresAdminAttention: true,
  };
}
```

#### 5. `src/domains/seat/services/seat-assignment.service.ts` (Lines 1–33)
```typescript
/**
 * SeatAssignmentService
 *
 * Responsibilities: seat capacity, shift-scoped availability, reassignment
 * + rollback, allocation ranking. Master data resides in fleet/route services.
 *
 * Implementation details (ReassignmentService, AllocationRanker,
 * reassignmentLogs, alertBusFull) are internal to the seat domain.
 * External consumers import these directly from their canonical
 * locations in @/lib/services/.
 */
import * as seatRepository from '../repositories/seat.repository';

export async function getCapacity(busId: string, shift?: string) {
  return seatRepository.getBusCapacity(busId, shift);
}

export async function assignSeat(busId: string, studentUid: string, shift?: string): Promise<void> {
  return seatRepository.incrementCapacity(busId, studentUid, shift);
}

export async function releaseSeat(busId: string, studentUid: string, shift?: string): Promise<void> {
  return seatRepository.decrementCapacity(busId, studentUid, shift);
}

export async function findAlternativeBuses(stop_name: string, routeId: string, shift: string) {
  return seatRepository.findAlternatives(stop_name, routeId, shift);
}

export async function validateAssignment(params: { routeId: string; stop_name: string; shift: string }) {
  return seatRepository.validateAssignment(params);
}
```

#### 6. `src/lib/utils/application-eligibility.ts` (Lines 1–238)
```typescript
import { Application, ApplicationFormData, ApplicationType, TargetSession } from '@/lib/types/application';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';

export type ApplicationCandidate = (Partial<Omit<Application, 'formData'>> & {
  formData?: Partial<ApplicationFormData> | Record<string, any>;
}) & Record<string, any>;

/**
 * Phase 2 — Future-session eligibility.
 *
 * LOCKED RULE: eligibleApproval = softBlock(targetSession.startYear) + 1 day.
 *
 * A future-session application waits for the seats currently owned by the
 * OUTGOING session. Those seats are released (Phase 1) when that session's
 * students are soft-blocked. The soft-block date for a session ending in June of
 * year S is computed by `computeBlockDatesFromValidUntil` as the soft-block
 * month/day of year S. Therefore a future application whose service begins in
 * year S becomes approvable the day AFTER that soft block.
 *
 * The resolved date is FROZEN into the application document at creation time so
 * eligibility is deterministic and immune to later deadline-config edits.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the eligibleApproval ISO timestamp for a future-session application.
 *
 * @param targetStartYear the year service begins (targetSession.startYear)
 * @param config the deadline configuration in effect at creation time
 */
export function computeFutureEligibleApproval(
  targetStartYear: number,
  config: DeadlineConfig
): string {
  if (!config) throw new Error('Config required for computeFutureEligibleApproval');

  // Reuse the EXACT Phase 1 soft-block computation. The soft block of the
  // outgoing session occurs in the validUntil year; for a future application the
  // relevant year is the target start year (the outgoing students' validUntil
  // falls in June of that year). A proxy validUntil in that year yields the
  // identical soft-block date used by the seat-release path.
  const anchorMonth = config.academicYear.anchorMonth;
  const anchorDay = config.academicYear.anchorDay;
  const proxyValidUntil = new Date(
    Date.UTC(targetStartYear, anchorMonth, anchorDay, 23, 59, 59, 999)
  ).toISOString();

  const { softBlock } = computeBlockDatesFromValidUntil(proxyValidUntil, config);

  // +1 day: the application is approvable the day after seats are released.
  const eligible = new Date(new Date(softBlock).getTime() + ONE_DAY_MS);
  return eligible.toISOString();
}

export function extractApplicationStartYear(app: ApplicationCandidate): number {
  if (!app) return 0;
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const sessionInfo = formData.sessionInfo || formData.session_info || {};
  return Number(
    app.sessionStartYear ||
    app.session_start_year ||
    app.targetSession?.startYear ||
    app.target_session?.start_year ||
    formData.sessionStartYear ||
    formData.startYear ||
    formData.session_start_year ||
    formData.start_year ||
    sessionInfo.sessionStartYear ||
    sessionInfo.startYear ||
    sessionInfo.session_start_year ||
    sessionInfo.start_year ||
    0
  );
}

export function calculateAcademicSessionStartYear(
  now: Date = new Date(),
  config?: DeadlineConfig | { academicSessionStart?: { month?: number; day?: number } }
): number {
  const cached = !config ? getCachedActiveConfig() : null;
  const effectiveConfig = config || cached;
  const startMonth = effectiveConfig?.academicSessionStart?.month ?? 6; // Configured month or July (0-indexed default)
  const startDay = effectiveConfig?.academicSessionStart?.day ?? 1;
  const thisYear = now.getUTCFullYear();
  const sessionStartThisYear = new Date(Date.UTC(thisYear, startMonth, startDay, 0, 0, 0, 0));
  return now.getTime() >= sessionStartThisYear.getTime() ? thisYear : thisYear - 1;
}

/**
 * Resolve an application's type, defaulting legacy/absent values to 'fresh'.
 * Legacy applications created before Phase 2 carry no discriminator and are, by
 * definition, current-session fresh applications.
 */
export function resolveApplicationType(
  app: ApplicationCandidate,
  now: Date = new Date(),
  config?: DeadlineConfig
): ApplicationType {
  if (!app) return 'fresh';
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const explicitType = app.applicationType || app.application_type || formData.applicationType || formData.application_type;

  const startYear = extractApplicationStartYear(app);
  const currentSessionStartYear = calculateAcademicSessionStartYear(now, config);

  const eligibleApprovalTime = app.eligibleApproval ? new Date(app.eligibleApproval).getTime() : 0;
  const isEligibleApprovalInFuture = eligibleApprovalTime > 0 && eligibleApprovalTime > now.getTime();

  // If the application state is submitted, draft, or unapproved, and its target session has arrived
  // (startYear <= currentSessionStartYear) and eligibleApproval has arrived, it must resolve to fresh
  // so it is no longer trapped in 'future' mode.
  const isUnactivatedState = !app.state || app.state === 'submitted' || app.state === 'draft';
  if (isUnactivatedState && startYear > 0 && startYear <= currentSessionStartYear && !isEligibleApprovalInFuture) {
    if (explicitType === 'renewal' || explicitType === 'renewal_after_soft_block') {
      return explicitType as ApplicationType;
    }
    return 'fresh';
  }

  if (explicitType === 'future' || explicitType === 'renewal' || explicitType === 'renewal_after_soft_block' || explicitType === 'fresh') {
    return explicitType as ApplicationType;
  }

  if (startYear > currentSessionStartYear || isEligibleApprovalInFuture) {
    return 'future';
  }

  return 'fresh';
}

/**
 * Whether an application is approvable RIGHT NOW with respect to the locked
 * eligibility rule. This is purely the date/eligibility gate — it does NOT make
 * any statement about capacity, which remains enforced atomically at approval.
 *
 * Legacy/absent eligibleApproval ⇒ immediately eligible (fresh/renewal).
 *
 * @param app the application document
 * @param now optional clock injection for testing
 */
export function isApprovalEligible(
  app: Pick<Application, 'eligibleApproval'>,
  now: Date = new Date()
): boolean {
  if (!app.eligibleApproval) return true;
  return new Date(app.eligibleApproval).getTime() <= now.getTime();
}

/**
 * DERIVED upcoming-lifecycle status (Phase 2).
 *
 * Future-session ("upcoming") applications are NOT modelled with extra stored
 * Firestore states. They live in `state: 'submitted'` like any other application;
 * the ONLY thing holding them back is the frozen `eligibleApproval` date gate
 * (enforced server-side in both approval routes via `isApprovalEligible`).
 *
 * This function projects that single frozen date into the two human-facing
 * lifecycle labels the UI shows, so there is exactly one source of truth (the
 * date) and no mutable state to migrate or keep in sync:
 *
 *   - 'waiting_for_eligibility'  : now <  eligibleApproval  (seats not yet freed)
 *   - 'eligible_for_approval'    : now >= eligibleApproval  (approvable now)
 *
 * It is intentionally a pure projection of `isApprovalEligible` so the label can
 * never disagree with the server-side approval gate.
 */
export type UpcomingStatus = 'waiting_for_eligibility' | 'eligible_for_approval';

export function getUpcomingStatus(
  app: Pick<Application, 'eligibleApproval'>,
  now: Date = new Date()
): UpcomingStatus {
  return isApprovalEligible(app, now) ? 'eligible_for_approval' : 'waiting_for_eligibility';
}

/**
 * Whether an application is a future-session ("upcoming") application.
 * Centralised so UI and server agree on the single discriminator.
 */
export function isUpcomingApplication(
  app: ApplicationCandidate,
  now: Date = new Date(),
  config?: DeadlineConfig
): boolean {
  if (!app) return false;

  // SEAM FIX 1: Renewals are for existing students extending service.
  // They must NEVER be hijacked into verified_upcoming!
  const formData = (app.formData || app.form_data || {}) as Record<string, any>;
  const explicitType = app.applicationType || app.application_type || formData.applicationType || formData.application_type;
  if (explicitType === 'renewal' || explicitType === 'renewal_after_soft_block') {
    return false;
  }
  const resolvedType = resolveApplicationType(app, now, config);
  if (resolvedType === 'renewal' || resolvedType === 'renewal_after_soft_block') {
    return false;
  }

  if (app.state === 'verified_upcoming' || app.state === 'pending_seat_allocation') {
    return true;
  }

  const startYear = extractApplicationStartYear(app);
  const currentSessionStartYear = calculateAcademicSessionStartYear(now, config);
  const eligibleApprovalTime = app.eligibleApproval ? new Date(app.eligibleApproval).getTime() : 0;
  const isEligibleApprovalInFuture = eligibleApprovalTime > 0 && eligibleApprovalTime > now.getTime();

  // Once the target session start date/year has arrived (startYear <= currentSessionStartYear and eligibleApproval <= now),
  // an application in state 'submitted' or 'draft' is no longer upcoming. Application.approve must activate immediately!
  if (startYear > 0 && startYear <= currentSessionStartYear && !isEligibleApprovalInFuture) {
    return false;
  }

  if (resolveApplicationType(app, now, config) === 'future') {
    return true;
  }

  if (startYear > currentSessionStartYear || isEligibleApprovalInFuture) {
    return true;
  }

  return false;
}

/**
 * Build the eligibleApproval timestamp for ANY application type at creation.
 * 'fresh'/'renewal' are immediately eligible (creation time); 'future' uses the
 * locked soft-block(+1 day) rule.
 */
export function resolveEligibleApprovalAtCreation(
  type: ApplicationType,
  targetSession: TargetSession,
  config: DeadlineConfig,
  nowIso: string
): string {
  if (type === 'future') {
    return computeFutureEligibleApproval(targetSession.startYear, config);
  }
  return nowIso;
}

/**
 * Derive the Phase 2 categorisation fields for a NEW (fresh/future) application
 * from its chosen session, at creation/submission time.
 *
 * An application is 'future' when its service-start year is greater than the
 * current academic-session start year. The current session start year is the
 * calendar year of "now" when on/after the academic anchor (July), otherwise the
 * previous calendar year — derived purely from the deadline-config anchor, so no
 * separate global session pointer is needed.
 *
 * Renewal applications are categorised by the renewal flow itself, not here.
 *
 * @returns the three fields to merge into the application document.
 */
export function deriveCreationCategorisation(
  sessionStartYear: number,
  sessionEndYear: number,
  config: DeadlineConfig,
  nowIso: string
): { applicationType: ApplicationType; targetSession: TargetSession; eligibleApproval: string } {
  const now = new Date(nowIso);
  const anchorMonth = config.academicYear.anchorMonth; // 0-indexed (e.g. 6 = July)
  // Current session start year: if we are at/after the July anchor, the session
  // that started this calendar year is current; before July, last year's session
  // is still current.
  const currentSessionStartYear =
    now.getMonth() >= anchorMonth ? now.getFullYear() : now.getFullYear() - 1;

  const targetSession: TargetSession = { startYear: sessionStartYear, endYear: sessionEndYear };
  const applicationType: ApplicationType =
    sessionStartYear > currentSessionStartYear ? 'future' : 'fresh';
  const eligibleApproval = resolveEligibleApprovalAtCreation(
    applicationType,
    targetSession,
    config,
    nowIso
  );

  return { applicationType, targetSession, eligibleApproval };
}
```

---



---

# PART 9: Fleet, Route & Driver Rostering Allocation (`BusRouteAllocationTab`, `DriverReassignmentTab` & Temporary Assignments)

---

### 9.1 Sub-Domain Architecture & Exact Execution Pipeline

The Fleet, Route, and Driver Allocation sub-domain governs operational transit resource binding: assigning buses to routes, assigning and swapping drivers across buses, reserving relief operators, and modifying route stop topology. 

#### 1. Architectural Model & 2026-09 Decoupling Reality
Historically, the system maintained static foreign keys (`buses.driver_uid` and `driver_profiles.bus_id` / `driver_profiles.route_id`). In September 2026, the physical schema was re-architected:
- **Dynamic Operational Driver Binding:** Real-time driver-to-bus coupling is established dynamically via physical QR scans and PostgreSQL row locks in `public.active_trips` (`trip_id`, `bus_id`, `driver_id`, `route_id`, `shift`).
- **Static Administrative Roster / Reservation:** The administrative driver roster manages operator duty readiness via `driver_profiles.is_reserved` and `driver_profiles.status` (`'active'` vs. `'reserved'`). The driver-to-bus intent is maintained in client-side staging and permanently committed to the immutable audit table `public.reassignment_logs` (`type = 'driver_reassignment'`).
- **Bus-to-Route Topology Binding:** `public.buses` maintains a physical foreign key to `public.routes.id` (`buses.route_id` and denormalized `buses.route_name`). Changes to bus route assignments are committed via `assign_routes_atomically`.

```
========================================================================================================================
FLEET, ROUTE & DRIVER ALLOCATION EXECUTION & DISPATCH PIPELINE
========================================================================================================================

                                  ADMIN / MODERATOR DISPATCH CONSOLE
                                                  |
                  +-------------------------------+-------------------------------+
                  |                                                               |
     [DriverReassignmentTab]                                           [BusRouteAllocationTab]
                  |                                                               |
    1. Select Driver + Target Bus                                     1. Multi-Select Fleet Buses
    2. Optional Shift Slot Prompt                                     2. Target Canonical Route Selection
    3. Client Staging (`stagedAssignments`)                            3. Client Staging (`stagedAssignments`)
    4. Net Reduction Algorithm:                                       4. Net Reduction Algorithm:
       `computeNetAssignments(staged, snapshot)`                          `computeNetRouteAssignments(staged, snapshot)`
                  |                                                               |
    HTTP POST /api/fleet/assign-drivers                               HTTP POST /api/fleet/assign-routes
    [Bearer Token / Moderator Perm: canReassign]                      [Bearer Token / Moderator Perm: canReassign]
                  |                                                               |
    Phase 1: Pre-validate driver UIDs (read-only)                     Phase 1: Pre-validate route IDs & active status
                  |                                                               |
    Phase 2: RPC `assign_drivers_atomically`                          Phase 2: RPC `assign_routes_atomically`
      - Acquire `FOR UPDATE` on each `buses` row                     - Acquire `FOR UPDATE` on each `buses` row
      - Abort 409 if any bus deleted                                   - Verify optimistic concurrency:
      - Update `driver_profiles` SET:                                    `v_current IS NOT DISTINCT FROM prev_route_id`
          `is_reserved = v_is_reserved`,                               - Abort 409 on bus deleted or route conflict
          `status = CASE WHEN v_is_reserved                             - Update `buses` SET:
                     THEN 'reserved' ELSE 'active' END`                    `route_id = new_route_id`,
                  |                                                       `route_name = new_route_name`
                  |                                                               |
    Phase 3: Audit Logging (Non-blocking)                             Phase 3: Audit Logging (Non-blocking)
      - Insert `reassignment_logs`                                    - Insert `reassignment_logs`
      - Write `createAuditEvent` ('drivers_reassigned')                 - Write `createAuditEvent` ('routes_reassigned')
                  |                                                               |
    UI Refresh: Re-fetch drivers & buses                              UI Refresh: Re-fetch buses & routes
========================================================================================================================
```

---

#### 2. Critical Operational Conflicts & Mismatch Analysis

##### A. Driver Reassignment During Active Trip
- **Scenario:** Driver A is operating Bus 01 with a live trip recorded in `public.active_trips`. An admin opens `DriverReassignmentTab` and moves Driver A to "Reserved" or assigns Driver A to Bus 02.
- **Codebase Reality:**
  - Neither `POST /api/fleet/assign-drivers` nor the PL/pgSQL RPC `assign_drivers_atomically` queries `public.active_trips`.
  - The RPC updates `driver_profiles.is_reserved` and `driver_profiles.status`.
  - **The active trip is NOT aborted, terminated, or orphaned.** The three-way lock in `public.active_trips` (`bus_id`, `driver_id`, `route_id`) remains intact. Real-time telematics ingestion continues to accept GPS frames from Driver A's mobile client.
  - The active trip completes normally when Driver A calls `/api/trips/end` or when `cleanup_stale_locks` reaps the trip if heartbeats cease for >600 seconds.

##### B. Bus-to-Route Reassignment with Enrolled Students
- **Scenario:** Bus 01 is currently assigned to Route 1 ("Beltola Corridor") with 42 enrolled students (`morning_load = 42`). An admin uses `BusRouteAllocationTab` to reassign Bus 01 to Route 4 ("Khanapara Corridor").
- **Codebase Reality:**
  - `POST /api/fleet/assign-routes` calls `assign_routes_atomically`.
  - The RPC updates `buses.route_id = 'route_4'` and `buses.route_name = 'Khanapara Corridor'`.
  - **`public.student_profiles` is NOT updated or inspected.**
  - The 42 students retain `student_profiles.bus_id = 'bus_01'`, `route_id = 'route_1'`, and their original Beltola corridor `stop_name`.
  - **Mismatched State:** A database inconsistency is introduced where `student_profiles.route_id != buses.route_id`. When student arrival pings or corridor projection engines run, the student's stop cannot be found on Bus 01's new route geometry.

##### C. Route Stop Deletion with Enrolled Students
- **Scenario:** An admin navigates to `/admin/routes/edit/[id]` and deletes a stop (e.g., "Six Mile") from Route 1, then saves the route via `PUT /api/routes/[id]/update`. Active students have `student_profiles.stop_name = 'Six Mile'`.
- **Codebase Reality:**
  - `PUT /api/routes/[id]/update` takes `updatedRouteData.stops`, computes `totalStops`, and executes `routeService.update(id, updated)`.
  - The update replaces `public.routes.stops` JSON array in PostgreSQL and invalidates the route cache (`clearRouteCache(id)`).
  - **No foreign key or constraint exists on `student_profiles.stop_name`.**
  - The students continue to hold `stop_name = 'Six Mile'`, but "Six Mile" no longer exists in `routes.stops`. When `route-alignment-engine.ts` or client ETA hooks evaluate the student, distance calculations fail to find a matching stop coordinate.

##### D. Lowering Bus Capacity Below Active Load
- **Scenario:** Bus 01 has `capacity = 50`, `morning_load = 45`, and `evening_load = 40`. An admin attempts to update Bus 01's capacity to 35 via `PUT /api/buses/update`.
- **Codebase Reality:**
  - `PUT /api/buses/update` lines 74–81 execute an explicit sanity gate:
    ```typescript
    if (newCapacity > 0) {
        if (inputMorning > newCapacity) {
            return NextResponse.json({ success: false, error: `Morning count (${inputMorning}) exceeds bus capacity (${newCapacity}).` }, { status: 400 });
        }
        if (inputEvening > newCapacity) {
            return NextResponse.json({ success: false, error: `Evening count (${inputEvening}) exceeds bus capacity (${newCapacity}).` }, { status: 400 });
        }
    }
    ```
  - The request is **blocked immediately with HTTP 400 Bad Request**. The capacity reduction cannot be committed until students are reassigned off the bus.
  - In addition, `PUT /api/buses/update` lines 96–98 check:
    ```typescript
    if (oldBusData.activeTripId) {
        return NextResponse.json({ success: false, error: 'Cannot update bus configuration during an active trip.' }, { status: 400 });
    }
    ```
    Bus metadata updates are completely forbidden while a vehicle is actively in transit.

---

### 9.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/components/smart-allocation/DriverReassignmentTab.tsx` | `DriverReassignmentTab` (forwardRef) | `src/app/admin/smart-allocation/page.tsx`, `src/app/moderator/smart-allocation/page.tsx` | `computeNetAssignments`, `validateStagingPreCheck`, `POST /api/fleet/assign-drivers` | In-memory staging state; exports CSV |
| `src/components/smart-allocation/BusRouteAllocationTab.tsx` | `BusRouteAllocationTab` (forwardRef) | `src/app/admin/smart-allocation/page.tsx`, `src/app/moderator/smart-allocation/page.tsx` | `computeNetRouteAssignments`, `validateRouteStagingPreCheck`, `POST /api/fleet/assign-routes` | In-memory staging state; exports CSV |
| `src/app/api/fleet/assign-drivers/route.ts` | `POST` | `DriverReassignmentTab.tsx`, `src/app/moderator/driver-assignment/page.tsx` | `verifyApiAuth`, `requireModeratorPermission`, `rpc('assign_drivers_atomically')`, `createAuditEvent` | `public.driver_profiles`, `public.buses` (row lock), `public.reassignment_logs`, `public.audit_events` |
| `src/app/api/fleet/assign-routes/route.ts` | `POST` | `BusRouteAllocationTab.tsx`, `src/app/moderator/route-allocation/page.tsx` | `verifyApiAuth`, `requireModeratorPermission`, `rpc('assign_routes_atomically')`, `createAuditEvent` | `public.buses`, `public.reassignment_logs`, `public.audit_events` |
| `supabase/COMPLETE_SCHEMA.sql` (Lines 1715–1752) | `assign_drivers_atomically` | `POST /api/fleet/assign-drivers` | PostgreSQL PL/pgSQL engine | `public.buses` (FOR UPDATE), `public.driver_profiles` |
| `supabase/COMPLETE_SCHEMA.sql` (Lines 1754–1776) | `assign_routes_atomically` | `POST /api/fleet/assign-routes` | PostgreSQL PL/pgSQL engine | `public.buses` (FOR UPDATE & UPDATE) |
| `src/lib/services/net-assignment-types.ts` | `computeNetAssignments`, `validateStagingPreCheck`, `createBusLabel` | `DriverReassignmentTab.tsx`, `assign-drivers` | Pure TypeScript algorithms | In-memory calculation only |
| `src/lib/services/net-route-assignment-types.ts` | `computeNetRouteAssignments`, `validateRouteStagingPreCheck`, `formatBusLabel` | `BusRouteAllocationTab.tsx`, `assign-routes` | Pure TypeScript algorithms | In-memory calculation only |
| `src/app/api/buses/update/route.ts` | `PUT` | `src/app/admin/buses/edit/[id]/page.tsx` | `getBusById`, `updateBus`, `getUserById`, `requireModeratorPermission` | `public.buses` |
| `src/app/api/routes/[id]/update/route.ts` | `PUT` | `src/app/admin/routes/edit/[id]/page.tsx` | `routeService.update`, `clearRouteCache`, `requireModeratorPermission` | `public.routes`, local memory cache |
| `src/domains/route/services/route.service.ts` | `getAll`, `getById`, `update`, `remove`, `create`, `invalidateRouteCache` | Route API endpoints, Bus services | `routeRepository` | In-memory 5-min cache (`allRoutesCache`, `routeByIdCache`), `public.routes` |
| `src/domains/route/services/route-alignment-engine.ts` | `haversineMeters`, `projectPointToSegment`, `RouteCorridorProjection` | GPS Pipeline, Telematics Ingestion, Bus Proximity Engine | Pure mathematical projection | None |

---

### 9.3 Method-by-Method Low-Level Walkthrough

#### 1. `POST /api/fleet/assign-drivers`
- **Endpoint:** `POST /api/fleet/assign-drivers`
- **Access Control:** Bearer token required. Roles allowed: `'admin'`, `'moderator'`. If moderator, calls `requireModeratorPermission(auth, 'drivers', 'canReassign')`.
- **Payload Contract:**
  ```typescript
  interface AssignDriversBody {
      netChanges: Array<{
          busId: string;
          busLabel: string;
          prevAssignedDriverId: string | null;
          newAssignedDriverId: string | null;
      }>;
      driverFinalState: Array<{
          driverId: string;
          driverName: string;
          finalBusId: string | null;
          finalRouteId: string | null;
          isReserved: boolean;
      }>;
      stagingSnapshot?: unknown[];
      actorInfo?: { name: string; role: string; label?: string };
  }
  ```
- **Execution Steps:**
  1. If `netChanges` is empty, immediately returns `{ success: true, updatedBuses: [], updatedDrivers: [] }`.
  2. **Phase 1 (Pre-validation):** Extracts all `driverId`s from `driverFinalState`. Queries `driver_profiles` where `uid IN (driverIds)`. If any driver ID is missing from PostgreSQL, aborts with HTTP 409 Conflict: `"Driver {name} has been deleted"`.
  3. **Phase 2 (Atomic RPC Commit):** Formats payload for `assign_drivers_atomically`:
     ```typescript
     const busUpdates = netChanges.map(c => ({
         bus_id: c.busId,
         bus_label: c.busLabel,
         prev_driver_uid: c.prevAssignedDriverId,
         new_driver_uid: c.newAssignedDriverId,
     }));
     const driverUpdates = driverFinalState.map(d => ({
         driver_uid: d.driverId,
         new_bus_id: d.finalBusId,
         new_route_id: d.finalRouteId,
         is_reserved: d.isReserved,
     }));
     const { data: rpcResult, error: rpcError } = await supabase.rpc('assign_drivers_atomically', {
         p_bus_updates: busUpdates,
         p_driver_updates: driverUpdates,
     });
     ```
  4. If `rpcError` occurs, returns HTTP 500. If `!rpcResult.success`, returns HTTP 409 with error details.
  5. **Phase 3 (Audit Trail & Telemetry):**
     - Generates `operationId = driver_reassignment_{timestamp}_{uuid}`.
     - Inserts structured document into `public.reassignment_logs` containing before/after changes for every affected bus and driver.
     - Calls non-blocking `createAuditEvent({ action: 'drivers_reassigned', category: 'reassignments', severity: 'medium' })`.
  6. Returns HTTP 200 with `{ success: true, updatedBuses, updatedDrivers }`.

---

#### 2. PL/pgSQL RPC: `assign_drivers_atomically(p_bus_updates JSONB, p_driver_updates JSONB)`
- **Security:** `SECURITY DEFINER SET search_path = public`.
- **Execution Steps:**
  1. Iterates over `p_bus_updates`. For each bus record:
     ```sql
     PERFORM 1 FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
     IF NOT FOUND THEN
         RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
     END IF;
     ```
     Acquires exclusive row locks on all target buses to prevent concurrent deletions or mutations.
  2. Iterates over `p_driver_updates`:
     ```sql
     v_is_reserved := COALESCE((v_driver_rec->>'is_reserved')::boolean, false);
     UPDATE driver_profiles SET
         is_reserved = v_is_reserved,
         status = CASE WHEN v_is_reserved THEN 'reserved' ELSE 'active' END,
         updated_at = NOW()
     WHERE uid = v_driver_rec->>'driver_uid';
     ```
  3. Returns `{ success: true, updatedBuses: [...], updatedDrivers: [...] }`.

---

#### 3. `POST /api/fleet/assign-routes`
- **Endpoint:** `POST /api/fleet/assign-routes`
- **Access Control:** Bearer token required. Roles: `'admin'`, `'moderator'`. If moderator, checks `canReassign` on `'buses'`.
- **Payload Contract:**
  ```typescript
  interface AssignRoutesBody {
      netChanges: Array<{
          busId: string;
          busLabel: string;
          prevRouteId: string | null;
          newRouteId: string;
          newRouteName: string;
      }>;
      stagingSnapshot?: unknown[];
      actorInfo?: { name: string; role: string; label?: string };
  }
  ```
- **Execution Steps:**
  1. If `netChanges` is empty, returns `{ success: true, updatedBuses: [] }`.
  2. **Phase 1 (Pre-validation):** Extracts distinct `newRouteId`s. Queries `public.routes` for `id, status`.
     - If any route does not exist: aborts with HTTP 404 `"Route {name} ({id}) not found"`.
     - If any route has `status === 'inactive'`: aborts with HTTP 400 `"Route {name} is not active"`.
  3. **Phase 2 (Atomic RPC Commit):** Formats payload and invokes `assign_routes_atomically`:
     ```typescript
     const busUpdates = netChanges.map(c => ({
         bus_id: c.busId,
         bus_label: c.busLabel,
         prev_route_id: c.prevRouteId,
         new_route_id: c.newRouteId,
         new_route_name: c.newRouteName,
     }));
     const { data: rpcResult, error: rpcError } = await supabase.rpc('assign_routes_atomically', {
         p_bus_updates: busUpdates,
     });
     ```
  4. **Phase 3 (Audit Trail):**
     - Inserts into `public.reassignment_logs` (`type: 'route_reassignment'`) with before/after `route_id` and `route_name`.
     - Calls `createAuditEvent({ action: 'routes_reassigned', category: 'reassignments' })`.
  5. Returns HTTP 200 with `{ success: true, updatedBuses }`.

---

#### 4. PL/pgSQL RPC: `assign_routes_atomically(p_bus_updates JSONB)`
- **Security:** `SECURITY DEFINER SET search_path = public`.
- **Optimistic Concurrency & Lock Acquisition:**
  ```sql
  FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
      SELECT route_id INTO v_current FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
      IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
      END IF;
      IF v_current IS DISTINCT FROM v_bus_rec->>'prev_route_id' THEN
          RETURN jsonb_build_object('success', false, 'error', 'Conflict: ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' is now on route "' || COALESCE(v_current, 'none') || '" (expected: "' || COALESCE(v_bus_rec->>'prev_route_id', 'none') || '")', 'status', 409);
      END IF;
  END LOOP;

  FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
      UPDATE buses SET route_id = v_bus_rec->>'new_route_id', route_name = v_bus_rec->>'new_route_name', updated_at = NOW()
      WHERE id = v_bus_rec->>'bus_id';
      v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
  END LOOP;
  ```
  - Note: Prevents dirty overwrites by validating `v_current IS NOT DISTINCT FROM prev_route_id`. If another admin re-routed the bus in the interim, the commit is rejected with HTTP 409 Conflict.

---

### 9.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Network Calls |
| :--- | :--- | :--- | :--- |
| **Driver Reassignment Commit (`N` buses, `M` drivers)** | **3 Calls:**<br>1. `SELECT uid FROM driver_profiles WHERE uid IN (...)`<br>2. `rpc('assign_drivers_atomically')` (acquires `N` row locks `FOR UPDATE` on `buses`, updates `M` rows in `driver_profiles`)<br>3. `INSERT INTO reassignment_logs` | 0 | 0 (Audit event runs via internal `createAuditEvent`) |
| **Route Reassignment Commit (`N` buses)** | **3 Calls:**<br>1. `SELECT id, status FROM routes WHERE id IN (...)`<br>2. `rpc('assign_routes_atomically')` (acquires `N` row locks `FOR UPDATE` on `buses`, updates `N` rows in `buses`)<br>3. `INSERT INTO reassignment_logs` | 0 | 0 |
| **Bus Configuration Update (`PUT /api/buses/update`)** | **3 Calls:**<br>1. `SELECT * FROM buses WHERE id = ...`<br>2. `SELECT id FROM buses WHERE bus_number = ... AND id != ...`<br>3. `UPDATE buses SET ... WHERE id = ...` | 0 | 1 Firebase Admin call (`verifyIdToken`) |
| **Route Definition Update (`PUT /api/routes/[id]/update`)** | **1 Call:**<br>1. `UPDATE routes SET ... WHERE id = ...` | 0 | 0 (Invalidates in-memory local cache) |
| **Concurrency / Conflict Rejection (Stale `prev_route_id`)** | **2 Calls:**<br>1. `SELECT id, status FROM routes WHERE id IN (...)`<br>2. `rpc('assign_routes_atomically')` -> aborts on conflict check, zero rows updated | 0 | 0 |

---

### 9.5 Verbatim Source Code from Live Codebase

#### 1. `src/app/api/fleet/assign-drivers/route.ts` (Full Production Code)
```typescript
import { createAuditEvent,type AuditActorRole } from '@/domains/audit';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/fleet/assign-drivers
 *
 * Commits net driver-assignment changes to PostgreSQL via an atomic RPC.
 * Replaces the Firestore transaction in net-assignment-service.ts commitNetChanges().
 *
 * Accepts the same shapes the client already computes:
 *   - netChanges: array of { busId, prevAssignedDriverId, newAssignedDriverId }
 *   - driverFinalState: array of { driverId, finalBusId, finalRouteId, isReserved }
 *   - stagingSnapshot: staged operations for audit trail
 *   - actorInfo: { name, role, label }
 *
 * The RPC acquires FOR UPDATE locks on all affected rows, verifies optimistic
 * concurrency, and applies all updates atomically. No TOCTOU race window.
 */

interface BusChange {
    busId: string;
    busLabel: string;
    prevAssignedDriverId: string | null;
    newAssignedDriverId: string | null;
}

interface DriverFinal {
    driverId: string;
    driverName: string;
    finalBusId: string | null;
    finalRouteId: string | null;
    isReserved: boolean;
}

interface AssignDriversBody {
    netChanges: BusChange[];
    driverFinalState: DriverFinal[];
    stagingSnapshot?: unknown[];
    actorInfo?: { name: string; role: string; label?: string };
}

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canReassign');
        if (permissionDenied) return permissionDenied;

        const body: AssignDriversBody = await req.json();
        const { netChanges, driverFinalState, stagingSnapshot, actorInfo } = body;

        if (!netChanges || netChanges.length === 0) {
            return NextResponse.json({ success: true, updatedBuses: [], updatedDrivers: [] });
        }

        const supabase = getSupabaseServer();

        // ── Phase 1: Pre-validate driver existence (read-only, no lock needed) ──
        if (driverFinalState.length > 0) {
            const driverIds = driverFinalState.map(d => d.driverId);
            const { data: driverRows, error: driverErr } = await supabase
                .from('driver_profiles')
                .select('uid')
                .in('uid', driverIds);

            if (driverErr) {
                return NextResponse.json({ success: false, message: `Failed to read drivers: ${driverErr.message}` }, { status: 500 });
            }

            const driverSet = new Set((driverRows || []).map((r: any) => r.uid));
            for (const df of driverFinalState) {
                if (!driverSet.has(df.driverId)) {
                    return NextResponse.json({
                        success: false,
                        message: `Driver ${df.driverName} has been deleted`,
                    }, { status: 409 });
                }
            }
        }

        // ── Phase 2: Atomic commit via RPC ──
        const busUpdates = netChanges.map(c => ({
            bus_id: c.busId,
            bus_label: c.busLabel,
            prev_driver_uid: c.prevAssignedDriverId,
            new_driver_uid: c.newAssignedDriverId,
        }));

        const driverUpdates = driverFinalState.map(d => ({
            driver_uid: d.driverId,
            new_bus_id: d.finalBusId,
            new_route_id: d.finalRouteId,
            is_reserved: d.isReserved,
        }));

        const { data: rpcResult, error: rpcError } = await supabase
            .rpc('assign_drivers_atomically', {
                p_bus_updates: busUpdates,
                p_driver_updates: driverUpdates,
            });

        if (rpcError) {
            return NextResponse.json({ success: false, message: `RPC failed: ${rpcError.message}` }, { status: 500 });
        }

        if (!rpcResult?.success) {
            const status = rpcResult?.status || 409;
            return NextResponse.json({
                success: false,
                message: rpcResult?.error || 'Assignment failed',
                conflictDetails: rpcResult?.error,
            }, { status });
        }

        const updatedBuses: string[] = rpcResult.updatedBuses || [];
        const updatedDrivers: string[] = rpcResult.updatedDrivers || [];

        // ── Phase 3: Audit log (non-blocking) ──
        try {
            const operationId = `driver_reassignment_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
            const actorLabel = actorInfo?.label || `${auth.name || 'Admin'} (${auth.role})`;

            let summary = `Committed ${updatedDrivers.length} driver assignment(s) affecting ${updatedBuses.length} bus(es)`;
            if (netChanges.length === 1) {
                const bc = netChanges[0];
                const prevDriver = bc.prevAssignedDriverId || 'Vacant';
                const nextDriver = bc.newAssignedDriverId || 'Vacant';
                summary = `Reassigned ${bc.busLabel}: ${prevDriver} → ${nextDriver}`;
            }

            const changes = [
                ...netChanges.map(bc => ({
                    docPath: `buses/${bc.busId}`,
                    collection: 'buses',
                    docId: bc.busId,
                    before: { driver_uid: bc.prevAssignedDriverId },
                    after: { driver_uid: bc.newAssignedDriverId },
                })),
                ...driverFinalState.map(df => ({
                    docPath: `drivers/${df.driverId}`,
                    collection: 'drivers',
                    docId: df.driverId,
                    before: { bus_id: null, is_reserved: true },
                    after: { bus_id: df.finalBusId, is_reserved: df.isReserved },
                })),
            ];

            await supabase.from('reassignment_logs').insert([{
                operation_id: operationId,
                type: 'driver_reassignment',
                actor_id: auth.uid,
                actor_label: actorLabel,
                status: 'committed',
                summary,
                changes,
                meta: {
                    busesAffected: updatedBuses,
                    driversAffected: updatedDrivers,
                    stagingSnapshot: stagingSnapshot || [],
                },
            }]);
        } catch (auditError) {
            console.error('Audit log write failed (non-critical):', auditError);
        }

        void createAuditEvent({
            action: 'drivers_reassigned',
            actor_id: auth.uid,
            actor_name: actorInfo?.label || auth.name || 'Unknown',
            actor_role: (auth.role as AuditActorRole) || 'admin',
            target_id: updatedBuses[0] || '',
            target_type: 'bus',
            target_name: '',
            category: 'reassignments',
            summary: `Reassigned ${updatedDrivers.length} driver(s) across ${updatedBuses.length} bus(es)`,
            severity: 'medium',
            metadata: { updatedBuses, updatedDrivers },
        });

        return NextResponse.json({ success: true, updatedBuses, updatedDrivers });

    } catch (error: any) {
        console.error('assign-drivers error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Internal error' }, { status: 500 });
    }
}
```

---

#### 2. `src/app/api/fleet/assign-routes/route.ts` (Full Production Code)
```typescript
import { createAuditEvent,type AuditActorRole } from '@/domains/audit';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/fleet/assign-routes
 *
 * Commits net route-assignment changes to PostgreSQL via an atomic RPC.
 * Replaces the Firestore transaction in net-route-assignment-service.ts commitNetRouteChanges().
 *
 * The RPC acquires FOR UPDATE locks on all affected rows, verifies optimistic
 * concurrency, and applies all updates atomically. No TOCTOU race window.
 */

interface RouteChange {
    busId: string;
    busLabel: string;
    prevRouteId: string | null;
    newRouteId: string;
    newRouteName: string;
}

interface AssignRoutesBody {
    netChanges: RouteChange[];
    stagingSnapshot?: unknown[];
    actorInfo?: { name: string; role: string; label?: string };
}

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const permissionDenied = await requireModeratorPermission(auth, 'buses', 'canReassign');
        if (permissionDenied) return permissionDenied;

        const body: AssignRoutesBody = await req.json();
        const { netChanges, stagingSnapshot, actorInfo } = body;

        if (!netChanges || netChanges.length === 0) {
            return NextResponse.json({ success: true, updatedBuses: [] });
        }

        const supabase = getSupabaseServer();

        // ── Phase 1: Pre-validate routes exist and are active (read-only) ──
        const routeIds = [...new Set(netChanges.map(c => c.newRouteId))];
        const { data: routeRows, error: routeErr } = await supabase
            .from('routes')
            .select('id, status')
            .in('id', routeIds);

        if (routeErr) {
            return NextResponse.json({ success: false, message: `Failed to read routes: ${routeErr.message}` }, { status: 500 });
        }

        const routeMap = new Map((routeRows || []).map((r: any) => [r.id, r]));
        for (const change of netChanges) {
            const routeRow = routeMap.get(change.newRouteId);
            if (!routeRow) {
                return NextResponse.json({
                    success: false,
                    message: `Route ${change.newRouteName} (${change.newRouteId}) not found`,
                }, { status: 404 });
            }
            if (routeRow.status === 'inactive') {
                return NextResponse.json({
                    success: false,
                    message: `Route ${change.newRouteName} is not active`,
                }, { status: 400 });
            }
        }

        // ── Phase 2: Atomic commit via RPC ──
        const busUpdates = netChanges.map(c => ({
            bus_id: c.busId,
            bus_label: c.busLabel,
            prev_route_id: c.prevRouteId,
            new_route_id: c.newRouteId,
            new_route_name: c.newRouteName,
        }));

        const { data: rpcResult, error: rpcError } = await supabase
            .rpc('assign_routes_atomically', {
                p_bus_updates: busUpdates,
            });

        if (rpcError) {
            return NextResponse.json({ success: false, message: `RPC failed: ${rpcError.message}` }, { status: 500 });
        }

        if (!rpcResult?.success) {
            const status = rpcResult?.status || 409;
            return NextResponse.json({
                success: false,
                message: rpcResult?.error || 'Assignment failed',
                conflictDetails: rpcResult?.error,
            }, { status });
        }

        const updatedBuses: string[] = rpcResult.updatedBuses || [];

        // ── Phase 3: Audit log (non-blocking) ──
        try {
            const operationId = `route_reassignment_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
            const actorLabel = actorInfo?.label || `${auth.name || 'Admin'} (${auth.role})`;

            let summary = `Committed ${updatedBuses.length} route assignment(s)`;
            if (netChanges.length === 1) {
                const bc = netChanges[0];
                const prev = bc.prevRouteId ? bc.busLabel : 'No Route';
                summary = `Reassigned ${bc.busLabel}: ${prev} → ${bc.newRouteName}`;
            }

            const changes = netChanges.map(bc => ({
                docPath: `buses/${bc.busId}`,
                collection: 'buses',
                docId: bc.busId,
                before: { route_id: bc.prevRouteId },
                after: { route_id: bc.newRouteId, route_name: bc.newRouteName },
            }));

            await supabase.from('reassignment_logs').insert([{
                operation_id: operationId,
                type: 'route_reassignment',
                actor_id: auth.uid,
                actor_label: actorLabel,
                status: 'committed',
                summary,
                changes,
                meta: {
                    busesAffected: updatedBuses,
                    stagingSnapshot: stagingSnapshot || [],
                },
            }]);
        } catch (auditError) {
            console.error('Audit log write failed (non-critical):', auditError);
        }

        void createAuditEvent({
            action: 'routes_reassigned',
            actor_id: auth.uid,
            actor_name: actorInfo?.label || auth.name || 'Unknown',
            actor_role: (auth.role as AuditActorRole) || 'admin',
            target_id: updatedBuses[0] || '',
            target_type: 'bus',
            target_name: '',
            category: 'reassignments',
            summary: `Reassigned ${updatedBuses.length} bus(es) to new routes`,
            severity: 'medium',
            metadata: { updatedBuses },
        });

        return NextResponse.json({ success: true, updatedBuses });

    } catch (error: any) {
        console.error('assign-routes error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Internal error' }, { status: 500 });
    }
}
```

---

#### 3. `supabase/COMPLETE_SCHEMA.sql` (Lines 1715–1776)
```sql
CREATE OR REPLACE FUNCTION assign_drivers_atomically(
    p_bus_updates JSONB, p_driver_updates JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bus_rec JSONB; v_driver_rec JSONB; v_is_reserved BOOLEAN;
    v_updated_buses TEXT[] := '{}'; v_updated_drivers TEXT[] := '{}';
BEGIN
    -- NOTE (2026-09): static bus↔driver binding columns (buses.driver_uid,
    -- driver_profiles.bus_id/route_id) were dropped by design — driver↔bus
    -- binding is dynamic via active_trips (QR scan + trip lock). This RPC now
    -- commits the reservation side (is_reserved/status) atomically and
    -- validates that referenced buses still exist. Bus-side driver_uid intent
    -- is preserved in reassignment_logs audit only.
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        PERFORM 1 FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
        END IF;
    END LOOP;

    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
    END LOOP;

    FOR v_driver_rec IN SELECT * FROM jsonb_array_elements(p_driver_updates) LOOP
        v_is_reserved := COALESCE((v_driver_rec->>'is_reserved')::boolean, false);
        UPDATE driver_profiles SET
            is_reserved = v_is_reserved,
            status = CASE WHEN v_is_reserved THEN 'reserved' ELSE 'active' END,
            updated_at = NOW()
        WHERE uid = v_driver_rec->>'driver_uid';
        v_updated_drivers := array_append(v_updated_drivers, v_driver_rec->>'driver_uid');
    END LOOP;

    RETURN jsonb_build_object('success', true, 'updatedBuses', to_jsonb(v_updated_buses), 'updatedDrivers', to_jsonb(v_updated_drivers));
END;
$$;

CREATE OR REPLACE FUNCTION assign_routes_atomically(p_bus_updates JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bus_rec JSONB; v_current TEXT; v_updated_buses TEXT[] := '{}';
BEGIN
    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        SELECT route_id INTO v_current FROM buses WHERE id = v_bus_rec->>'bus_id' FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted', 'status', 409);
        END IF;
        IF v_current IS DISTINCT FROM v_bus_rec->>'prev_route_id' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Conflict: ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' is now on route "' || COALESCE(v_current, 'none') || '" (expected: "' || COALESCE(v_bus_rec->>'prev_route_id', 'none') || '")', 'status', 409);
        END IF;
    END LOOP;

    FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates) LOOP
        UPDATE buses SET route_id = v_bus_rec->>'new_route_id', route_name = v_bus_rec->>'new_route_name', updated_at = NOW()
        WHERE id = v_bus_rec->>'bus_id';
        v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
    END LOOP;

    RETURN jsonb_build_object('success', true, 'updatedBuses', to_jsonb(v_updated_buses));
END;
$$;
```

---

#### 4. `src/app/api/buses/update/route.ts` (Full Production Code)
```typescript
import { getBusById,updateBus } from '@/domains/fleet';
import { getUserById } from '@/domains/identity';
import * as routeService from '@/domains/route';
import { adminAuth } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
    try {
        const authHeader = (await headers()).get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.substring(7);
        const decodedToken = await adminAuth.verifyIdToken(token);

        // Check if user is admin or moderator via PostgreSQL (canonical source of truth)
        const user = await getUserById(decodedToken.uid);
        if (!user || !['admin', 'moderator'].includes(user.role)) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

        const permissionDenied = await requireModeratorPermission(
            { uid: user.id || decodedToken.uid, role: user.role } as any,
            'buses',
            'canEdit'
        );
        if (permissionDenied) return permissionDenied;

        const body = await request.json();
        const { busId, busNumber, color, capacity, driverUID, routeId, shift, load, status } = body;

        if (!busId) {
            return NextResponse.json({ success: false, error: 'Bus ID is required' }, { status: 400 });
        }

        // Fetch old bus data from PostgreSQL
        const oldBusData = await getBusById(busId);
        if (!oldBusData) {
            return NextResponse.json({ success: false, error: 'Bus not found' }, { status: 404 });
        }

        // ---------------------------------------------------------
        // 1. Calculate Loads & Capacity Logic
        // ---------------------------------------------------------
        const inputMorning = load?.morningCount !== undefined ? parseInt(load.morningCount) : oldBusData.load?.morningCount || 0;
        const inputEvening = load?.eveningCount !== undefined ? parseInt(load.eveningCount) : oldBusData.load?.eveningCount || 0;

        const newCurrentMembers = inputMorning + inputEvening;
        const newCapacity = capacity ? parseInt(capacity) : (oldBusData.capacity || 0);

        // A. Bus Number Uniqueness Check (Must be unique in PostgreSQL)
        if (busNumber && busNumber !== oldBusData.busNumber) {
            const supabase = getSupabaseServer();
            const { data: duplicateBus } = await supabase
                .from('buses')
                .select('id')
                .eq('bus_number', busNumber)
                .neq('id', busId)
                .maybeSingle();

            if (duplicateBus) {
                return NextResponse.json({
                    success: false,
                    error: `Bus Number "${busNumber}" is already in use by another bus.`
                }, { status: 400 });
            }
        }

        // C. Capacity Check (per-shift model)
        if (newCapacity > 0) {
            if (inputMorning > newCapacity) {
                return NextResponse.json({ success: false, error: `Morning count (${inputMorning}) exceeds bus capacity (${newCapacity}).` }, { status: 400 });
            }
            if (inputEvening > newCapacity) {
                return NextResponse.json({ success: false, error: `Evening count (${inputEvening}) exceeds bus capacity (${newCapacity}).` }, { status: 400 });
            }
        }

        // D. Shift Validation
        const newShift = shift || oldBusData.shift;
        if (newShift === 'Morning' && inputEvening > 0) {
            return NextResponse.json({ success: false, error: `Cannot set shift to "Morning" while ${inputEvening} students are assigned to the Evening slot.` }, { status: 400 });
        }
        if (newShift === 'Evening' && inputMorning > 0) {
            return NextResponse.json({ success: false, error: `Cannot set shift to "Evening" while ${inputMorning} students are assigned to the Morning slot.` }, { status: 400 });
        }

        // ---------------------------------------------------------
        // 2. Active Trip Guard
        // ---------------------------------------------------------
        if (oldBusData.activeTripId) {
            return NextResponse.json({ success: false, error: 'Cannot update bus configuration during an active trip.' }, { status: 400 });
        }

        // ---------------------------------------------------------
        // 3. Route Logic
        // ---------------------------------------------------------
        const newRouteId = routeId || oldBusData.routeId;
        const routeChanged = routeId && routeId !== oldBusData.routeId;
        let routeData = null;

        if (routeChanged) {
            routeData = await routeService.getById(newRouteId);
            if (!routeData) {
                return NextResponse.json({ success: false, error: `Route "${newRouteId}" not found in canonical routes.` }, { status: 404 });
            }
        }

        // 3. Update Bus in PostgreSQL
        const busUpdates: any = {};
        if (busNumber) busUpdates.busNumber = busNumber;
        if (color) busUpdates.color = color;
        if (capacity) busUpdates.capacity = newCapacity;
        if (status) busUpdates.status = status;
        if (shift) busUpdates.shift = newShift;
        busUpdates.load = { morningCount: inputMorning, eveningCount: inputEvening };
        busUpdates.currentMembers = newCurrentMembers;
        if (routeId) {
            busUpdates.routeId = routeId;
        }

        await updateBus(busId, busUpdates);

        return NextResponse.json({ success: true, message: 'Bus updated successfully' });

    } catch (error: any) {
        console.error('Update bus error:', error);
        return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
    }
}
```

---

#### 5. `src/app/api/routes/[id]/update/route.ts` (Full Production Code)
```typescript
import * as routeService from '@/domains/route';
import { clearRouteCache } from '@/lib/profile-service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextResponse } from 'next/server';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'routes', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Route ID is required' }, { status: 400 });
    }

    const updatedRouteData = await request.json();

    const updated = {
      ...updatedRouteData,
      totalStops: Array.isArray(updatedRouteData.stops) ? updatedRouteData.stops.length : 0,
      updatedAt: new Date().toISOString()
    };

    const success = await routeService.update(id, updated);

    if (!success) {
      return NextResponse.json({ error: 'Route not found or update failed' }, { status: 404 });
    }

    clearRouteCache(id);

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating route:', error);
    return NextResponse.json({ error: 'Failed to update route' }, { status: 500 });
  }
}
```

---

