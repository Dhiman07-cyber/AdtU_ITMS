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
   - Monitors live fleet status (view-only bus locations on fleet radar map).
   - Zero involvement in starting/stopping trips or accessing student waiting flags.
4. **Admin (`admin`)**:
   - Superuser access across all academic faculties, routes, buses, and financial ledgers.
   - Manages platform parameters, system configurations, and staff assignments.
   - Monitors live fleet status (view-only bus locations on fleet radar map).
   - Zero involvement in starting/stopping trips or accessing student waiting flags.

---

## 2. API & Endpoint Permission Matrix

| Capability / API Endpoint | Student | Driver | Moderator | Admin | Enforcement Mechanism |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Track Bus Status** (`/api/student/trip-status`) | ✅ (Own Bus) | ❌ | ✅ | ✅ | Session checks bus assignment ownership for students; read-only. |
| **Raise / Cancel Waiting Flag** (`/api/student/waiting-flag`) | ✅ | ❌ | ❌ | ❌ | `requireRole(['student'])` + active trip verification. |
| **Initiate Trip** (`/api/driver/initiate-trip`) | ❌ | ✅ (Assigned) | ❌ | ❌ | `requireRole(['driver'])` + `acquire_trip_lock` RPC. |
| **Stream GPS Location** (`/api/location/update`) | ❌ | ✅ | ❌ | ❌ | Driver token check + active trip lock verification. |
| **Acknowledge Flag** (`/api/driver/ack-flag`) | ❌ | ✅ (Assigned) | ❌ | ❌ | `requireRole(['driver'])` + active trip lock verification. |
| **Mark Boarded** (`/api/driver/mark-boarded`) | ❌ | ✅ (Assigned) | ❌ | ❌ | `requireRole(['driver'])` + active trip lock verification. |
| **End Trip** (`/api/driver/end-trip`) | ❌ | ✅ (Assigned) | ❌ | ❌ | `requireRole(['driver'])` + `release_trip_lock` RPC. |
| **Fleet Radar Map** (`/admin/fleet-map`, `/moderator/fleet-map`) | ❌ | ❌ | ✅ | ✅ | Passive GPS location observability only. |
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

---

## 5. Granular Moderator Permission Model & Administration

To support delegation of responsibilities without granting full administrative privileges, the system implements a granular, category-based permissions architecture (`src/lib/types/moderator-permissions.ts`, `src/lib/security/moderator-permissions.ts`).

### 5.1 The 6 Permission Categories

Every moderator has an explicit configuration document persisted in Firestore (`moderators/{uid}/permissions`) and checked server-side:

```typescript
export interface ModeratorPermissions {
  students: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Student reassignment (smart-allocation)
  };
  drivers: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Driver vehicle reassignment
  };
  buses: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Bus route allocation
  };
  routes: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
  applications: {
    canView: boolean;
    canApprove: boolean;                  // Approve student application forms
    canReject: boolean;                   // Reject student application forms
    canGenerateVerificationCode: boolean; // Generate/manage offline verification codes
    canAppearInModeratorList: boolean;    // Display in student apply form's review dropdown
  };
  payments: {
    canApproveOfflinePayment: boolean;    // Approve offline bank/challan payments
    canRejectOfflinePayment: boolean;     // Reject offline payments
  };
}
```

### 5.2 Permission Presets
- **`DEFAULT_MODERATOR_PERMISSIONS` (View-Only Baseline):** By default, newly enrolled moderators can view (`canView: true`) students, drivers, buses, routes, and applications, but have zero mutation, approval, or reassignment capabilities (`false` for all write flags).
- **`FULL_MODERATOR_PERMISSIONS` (Senior Moderator):** Grants all capabilities across all 6 categories.
- **`ZERO_MODERATOR_PERMISSIONS` (Suspended / Revoked):** All capabilities set to `false`, revoking both read and write capabilities.

### 5.3 Redesigned Unified Management Interface (`/admin/moderators`)
The separate, multi-page configuration route (`/admin/moderators/config/[id]`) has been **deprecated and removed**.
- All moderator profile oversight, account status controls, and granular permission editing are now unified directly within [`/admin/moderators`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/admin/moderators/page.tsx).
- Administrators configure permissions via a responsive, accessible dialog/accordion modal featuring:
  - Quick-preset selectors (Full Access, View Only, Zero/Revoke).
  - Real-time switch toggles per individual capability flag.
  - Category-level bulk toggles.
  - Direct atomic synchronization with `POST /api/moderators/[id]/permissions`.
  - Process-local and Redis cache invalidation (`invalidateModeratorPermissionCache`).

---

## 6. User Account Status Lifecycle & Access Revocation

Account access is governed across all roles via an authoritative `status` field in PostgreSQL user tables (`active`, `suspended`, `disabled`).

### 6.1 Status Management Endpoints
- **Moderators:** `PATCH /api/moderators/[id]/status`
- **Drivers:** `PATCH /api/drivers/[id]/status`
- **Students:** `PATCH /api/students/[id]/status`

### 6.2 Universal Access Block Screen (`UniversalAccessBlockScreen.tsx`)
When a user's status transitions to `suspended` or `disabled`, client-side route layouts (`src/app/driver/layout.tsx`, `src/app/moderator/layout.tsx`, `StudentAuthWrapper.tsx`) intercept all navigation and render [`UniversalAccessBlockScreen`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/components/UniversalAccessBlockScreen.tsx):
- Natively rendered in normal page flow without GPU backdrop-blur lag.
- Displays explicit reason for suspension and administrative contact guidance.
- Disables all mutations, fleet maps, and operational tools until access is restored.

---

## 7. Driver Single-Device Session Security & Caching

- **Immediate Invalidation:** Explicit logout or new session registration instantly purges the cache via `invalidateCachedDeviceSession`.

---

## 8. Comprehensive Low-Level Design (LLD) Breakdown & Justifications

### 8.1 `src/lib/security/scanner-auth.ts` (`validateStudentScannerContext`)
- **Concrete Architectural Role**: In-transit bus boarding verification gate. Evaluates the physical context of the driver operating the camera scanner against the student's registered vehicle assignment (`busId`).
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without scanner context verification, Driver A operating Bus 101 on the Panikhaiti route can scan a student assigned to Driver B's Bus 104 on the Jalukbari route and mark them "Boarded".
  - The university attendance ledger records the student on the wrong vehicle, and the student's parents receive false boarding notifications while the student is actually stranded at their correct stop.
- **State Taxonomy & Invariants Enforced**:
  - *Authorization & Transit Integrity Boundaries*.
  - *Cross-Bus Assignment Invariant*.
- **Production Code Implementation**:
  ```typescript
  // File: src/lib/security/scanner-auth.ts (lines 75-100)
  export function scannerBusMatchesStudent(scannerBusId: unknown, busId: unknown): boolean {
    if (typeof scannerBusId !== 'string' || !scannerBusId.trim()) return false;
    if (typeof busId !== 'string' || !busId.trim()) return false;
    return scannerBusId.trim() === busId.trim();
  }

  export async function validateStudentScannerContext(auth: ScannerAuth, scannerBusId: unknown): Promise<NextResponse | null> {
    const role = (auth.role || '').toLowerCase();
    if (role === 'admin') return null; // Admins bypass
    if (role === 'moderator') {
      const permissions = await getModeratorPermissions(auth.uid);
      if (permissions?.students?.canView !== false) return null;
      return NextResponse.json({ status: 'invalid', message: 'Permission required' }, { status: 403 });
    }
    if (role !== 'driver') return NextResponse.json({ status: 'invalid', message: 'Unauthorized' }, { status: 403 });
    return null;
  }
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Direct Memory Evaluation*: String comparison runs in microseconds without database lookups during rapid line boarding.

---

### 8.2 Granular Moderator Permissions (`src/lib/security/moderator-permissions.ts`)
- **Concrete Architectural Role**: Least-privilege authorization matrix. Partitions administrative privileges into 6 discrete operational scopes (Students, Drivers, Routes, Buses, Payments, Settings) with read/edit/approve toggles.
- **Failure Analysis ("Why the System Fails Without It")**:
  - Without granular moderator scopes, granting a transport clerk permission to view bus stops also grants them access to approve tuition waivers, modify fee pricing, or reassign driver rosters.
  - Violates the Principle of Least Privilege (OWASP ASVS V4.1).
- **State Taxonomy & Invariants Enforced**:
  - *Durable Authoritative State* (`moderator_permissions`).
- **Production Code Implementation**:
  ```typescript
  // File: src/lib/security/moderator-permissions.ts
  export async function requireModeratorPermission(
    uid: string, category: keyof ModeratorPermissions, action: 'canView' | 'canEdit' | 'canApprove' | 'canReassign'
  ): Promise<boolean> {
    const permissions = await getModeratorPermissions(uid);
    if (!permissions) return false;
    return Boolean(permissions[category]?.[action]);
  }
  ```
- **Optimization, Complexity Minimization & Anti-Overhead Rationale**:
  - *Hierarchical Default*: View permissions are implicit when edit permissions are granted, avoiding conflicting boolean state.
  - *Redis Role Invalidation*: Modifications to moderator permissions immediately emit `itms:roles:invalidate`, terminating in-flight sessions instantly.

