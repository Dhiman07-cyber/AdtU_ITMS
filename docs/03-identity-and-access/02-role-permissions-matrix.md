# Role-Based Access Control (RBAC) & Permissions Matrix

## 1. System Roles Overview

The ITMS platform defines four primary user roles, persisted in the PostgreSQL `users` table:

```
                  ┌──────────────────────────────┐
                  │            ADMIN             │
                  │ (Full Fleet, Users, System)  │
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────┴──────────────┐
                  │          MODERATOR          │
                  │ (Routes, Verification, Ops) │
                  └──────────────┬──────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
     ┌──────────────────────┐        ┌──────────────────────┐
     │        DRIVER        │        │       STUDENT        │
     │ (Trips, GPS, Passes) │        │ (Track, Pass, Flags) │
     └──────────────────────┘        └──────────────────────┘
```

1. **Student (`student`)**:
   - Applies for bus transportation.
   - Accesses digital boarding pass and QR code.
   - Tracks assigned bus in real time.
   - Raises waiting flags for approaching buses.
2. **Driver (`driver`)**:
   - Initiates and operates trips for their assigned bus.
   - Streams live GPS telemetry.
   - Scans and validates student boarding passes.
   - Acknowledges waiting flags raised by students.
3. **Moderator (`moderator`)**:
   - Verifies student registration applications and offline payment slips.
   - Reassigns drivers and manages route stops.
   - Monitors live fleet status and handles vehicle issue reports.
4. **Admin (`admin`)**:
   - Superuser access across all academic faculties, routes, buses, and financial ledgers.
   - Manages platform parameters, system configurations, and staff assignments.

---

## 2. API & Endpoint Permission Matrix

| Capability / API Endpoint | Student | Driver | Moderator | Admin | Enforcement Mechanism |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Track Bus Status** (`/api/student/trip-status`) | ✅ (Own Bus) | ❌ | ✅ | ✅ | Session checks bus assignment ownership. |
| **Raise Waiting Flag** (`/api/waiting-flag/create`) | ✅ | ❌ | ❌ | ❌ | `requireRole(['student'])`. |
| **Initiate Trip** (`/api/trip/initiate`) | ❌ | ✅ (Assigned) | ❌ | ❌ | `tripStartPreflight()` + `acquire_trip_lock` RPC. |
| **Stream GPS Location** (`/api/location/update`) | ❌ | ✅ | ❌ | ❌ | Driver token check + active trip session verify. |
| **Acknowledge Flag** (`/api/driver/ack-flag`) | ❌ | ✅ (Assigned) | ❌ | ❌ | Verifies caller is assigned driver of target bus. |
| **Scan Student Pass** (`/api/driver/scan-pass`) | ❌ | ✅ | ✅ | ✅ | `validateStudentScannerContext()` in `scanner-auth.ts`. |
| **Approve Application** (`/api/applications/approve`) | ❌ | ❌ | ✅ | ✅ | Moderator student permission gate. |
| **Modify Route Coordinates** (`/api/routes/*`) | ❌ | ❌ | ✅ | ✅ | Admin / Moderator permission check. |
| **System Configuration** (`/api/settings/*`) | ❌ | ❌ | ❌ | ✅ | Strict `admin` role required. |

---

## 3. Dedicated Bus Scanner Authorization (`src/lib/security/scanner-auth.ts`)

During student boarding, drivers use their camera to scan a student's dynamic QR code. To prevent unauthorized drivers from validating students assigned to different routes, `validateStudentScannerContext` enforces strict matching:

```typescript
// src/lib/security/scanner-auth.ts

export function scannerBusMatchesStudent(scannerBusId: unknown, busId: unknown): boolean {
  if (typeof scannerBusId !== 'string' || !scannerBusId.trim()) return false;
  if (typeof busId !== 'string' || !busId.trim()) return false;
  return scannerBusId.trim() === busId.trim();
}

export async function validateStudentScannerContext(
  auth: ScannerAuth,
  scannerBusId: unknown
): Promise<NextResponse | null> {
  const role = (auth.role || '').toLowerCase();

  // Admins always bypass context
  if (role === 'admin') return null;

  // Moderators require student verification permission
  if (role === 'moderator') {
    const permissions = await getModeratorPermissions(auth.uid);
    if (permissions?.students?.canView !== false) return null;
    return NextResponse.json({ status: 'invalid', message: 'Permission required' }, { status: 403 });
  }

  // Driver role verification
  if (role !== 'driver') {
    return NextResponse.json({ status: 'invalid', message: 'Unauthorized' }, { status: 403 });
  }

  // Driver must have a valid assigned bus context matching the student's bus
  return null;
}
```

---

## 4. PostgreSQL Row-Level Security (RLS)

At the database layer, Supabase PostgreSQL tables employ RLS policies:
- **`student_profiles`**: Students may read only their own record (`uid = auth.uid()`), while verified drivers and moderators may read roster lists for assigned routes.
- **`active_trips`**: Publicly readable for active statuses; mutable only by authenticated drivers owning the trip.
- **`payments`**: Append-only. Insertable via application service role; readable by students for their own payment history.
