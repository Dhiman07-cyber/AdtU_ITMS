# Student Profile Lifecycle, Stop/Shift Change Requests & Administrative CRUD (Forensic Truth)

**Module:** Student Profile State Transitions, Change Requests, Moderator Approval & Financial Entitlement Linking  
**File Authority:** `src/domains/student/services/student.service.ts`, `src/app/api/student/request-profile-update/route.ts`, `src/app/api/students/[id]/update/route.ts`  
**Database Tables:** `student_profiles`, `profile_update_requests`, `payments`  

---

# PART 10: Student Profile Lifecycle, Stop/Shift Change Requests, Admin/Moderator Student CRUD & Final Invariant Matrix

---

### 10.1 Sub-Domain Architecture & Exact Execution Pipeline

The Student Profile Lifecycle and Administrative CRUD sub-domain enforces commuter identity integrity, student profile updates, driver verification queues, administrative profile adjustments, and safe cascading account deletion.

```
========================================================================================================================
STUDENT PROFILE UPDATE, ADMIN CRUD & LIFECYCLE EXECUTION PIPELINE
========================================================================================================================

    STUDENT MOBILE / WEB APP                         DRIVER MOBILE APP                      ADMIN / MODERATOR CONSOLE
               |                                             |                                           |
    [Profile Update Request]                                 |                                           |
    POST /api/student/request-profile-update                  |                                           |
    - Validate `RequestProfileUpdateSchema`                  |                                           |
    - Read student from PostgreSQL                           |                                           |
    - Create `profile_update_requests` in Firestore         |                                           |
    - Stamp `pending_profile_update` in PostgreSQL          |                                           |
               |                                             |                                           |
               +-------------------> Driver Review Queue <---+                                           |
                                     GET /api/driver/get-pending-profile-requests                        |
                                     POST /api/driver/handle-profile-update                              |
                                     - Verify driver assigned to student's bus                           |
                                     - Win Firestore CAS transaction on request                          |
                                     - If Approved:                                                      |
                                       * Destroy old Cloudinary photo                                    |
                                       * UPDATE `student_profiles` SET `profile_photo_url`, `full_name`  |
                                       * Clear `pending_profile_update = NULL`                           |
                                     - If Rejected:                                                      |
                                       * Destroy new uploaded Cloudinary photo                           |
                                       * Clear `pending_profile_update = NULL` in PostgreSQL             |
                                                             |                                           |
                                                             |                             [Admin Student CRUD]
                                                             |                                           |
                                                             |                             1. POST /api/students/add
                                                             |                                - Strip non-allowlisted keys
                                                             |                                - `bus_id`, `route_id` omitted
                                                             |                                - Compute session & validUntil
                                                             |                                - INSERT `users` & `student_profiles`
                                                             |                                - NO bus capacity incremented
                                                             |                                           |
                                                             |                             2. PUT /api/students/[id]/update
                                                             |                                - Strip `BLOCKED_FIELDS`
                                                             |                                  (`busId`, `routeId`, `status`)
                                                             |                                - UPDATE safe profile fields
                                                             |                                - Trigger `invalidateStudentAssignment`
                                                             |                                           |
                                                             |                             3. PATCH /api/students/[id]/status
                                                             |                                - Validate new status
                                                             |                                - UPDATE `student_profiles.status`
                                                             |                                - Invalidate role cache
                                                             |                                           |
                                                             |                             4. DELETE /api/students/[id]/delete
                                                             |                                - Call `deleteUserAndData`
                                                             |                                - RPC `delete_student_cascade_v1`
                                                             |                                - Auto-decrement bus capacity if
                                                             |                                  `seat_released_at IS NULL`
                                                             |                                - Purge Firestore, Auth, Storage
                                                             |                                - Preserve `payments` & `audit_events`
========================================================================================================================
```

---

### 10.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/student/profile/page.tsx` | `StudentProfilePage` | Next.js App Router | `POST /api/student/request-profile-update`, `POST /api/upload` | Client UI state; Cloudinary upload |
| `src/app/api/student/request-profile-update/route.ts` | `POST` (via `withSecurity`) | `StudentProfilePage` | `getById` (student domain), Firestore `adminDb` | Firestore `profile_update_requests`, PostgreSQL `student_profiles.pending_profile_update` |
| `src/app/api/driver/get-pending-profile-requests/route.ts` | `GET` (via `withSecurity`) | Driver Mobile / Web Roster | `getBusById`, `getAllBuses`, Firestore `adminDb` | Firestore reads |
| `src/app/api/driver/handle-profile-update/route.ts` | `POST` (via `withSecurity`) | Driver Mobile / Web Roster | `getStudentById`, `getBusById`, Cloudinary `destroy`, `updateStudent` | Firestore `profile_update_requests`, Cloudinary CDN, PostgreSQL `student_profiles` |
| `src/domains/student/services/student.service.ts` | `getByUid`, `getById`, `getAll`, `update`, `remove`, `applyPaymentValidity`, `SeatReclaimRequiredError` | Application, Payment, Admin API routes | `studentRepository`, `invalidateStudentAssignment` | PostgreSQL `student_profiles`, L1 LRU Cache, L2 Redis |
| `src/domains/student/repositories/student.repository.pg.ts` | `pgFindByUid`, `pgFindById`, `pgInsert`, `pgUpdate`, `pgRemove`, `pgCountByStatus` | `student.service.ts` | Supabase Server SDK | PostgreSQL `public.student_profiles` |
| `src/domains/student/services/student-assignment-cache.ts` | `getCachedStudentAssignment`, `invalidateStudentAssignment`, `clearStudentAssignmentMemoryCache` | Socket router, trip status, waiting flag, student service | `executeGpsRedisCommand`, `publishRoleInvalidation`, Supabase Server | In-memory Map (`assignmentL1Cache`), Redis key `student:assign:<uid>`, Pub/Sub channel `student_assign_invalidate` |
| `src/app/api/students/add/route.ts` | `POST` | `src/app/admin/students/add/page.tsx` | `verifyApiAuth`, `requireModeratorPermission`, `getDeadlineConfig`, `calculateRenewalDate`, `createUser`, `createStudent` | PostgreSQL `public.users`, `public.student_profiles` |
| `src/app/api/students/[id]/update/route.ts` | `PUT` | `src/app/admin/students/edit/[id]/page.tsx` | `verifyApiAuth`, `requireModeratorPermission`, `normalizeShift`, `studentService.update` | PostgreSQL `public.student_profiles`, Redis / L1 Cache |
| `src/app/api/students/[id]/status/route.ts` | `PATCH` (via `withSecurity`) | Admin student roster / actions | `getById`, `studentService.update`, `invalidateCachedRole` | PostgreSQL `public.student_profiles`, Redis role cache |
| `src/app/api/students/[id]/delete/route.ts` | `DELETE` | Admin student roster / actions | `verifyApiAuth`, `requireModeratorPermission`, `deleteUserAndData` | Calls cascade deletion engine |

---

### 10.3 Method-by-Method Low-Level Walkthrough

#### 1. `POST /api/student/request-profile-update`
- **Access Control:** Student role required. Validates `RequestProfileUpdateSchema`. Rate limit: `RateLimits.CREATE`.
- **Execution Steps:**
  1. Reads student profile from PostgreSQL via `getById(auth.uid)`. If not found, aborts 404.
  2. Generates `requestId = profile_update_${studentUid}_${Date.now()}`.
  3. Prepares request document: `{ requestId, studentUid, studentName, currentImageUrl, newImageUrl, currentName, newName, busId, status: 'pending', createdAt, updatedAt }`.
  4. Writes request document to Firestore collection `profile_update_requests`.
  5. Updates PostgreSQL: calls `update(studentUid, { pendingProfileUpdate: requestId })`.
  6. Returns HTTP 200 with `{ success: true, requestId }`.

---

#### 2. `POST /api/driver/handle-profile-update`
- **Access Control:** Driver role required. Validates `HandleProfileUpdateSchema` (`{ requestId, action: 'approve' | 'reject' }`).
- **Authorization & Ownership Verification:**
  1. Reads `profile_update_requests` doc from Firestore. If missing, aborts 404.
  2. Reads student profile from PostgreSQL. Extracts `studentBusId`.
  3. Queries PostgreSQL `buses` to verify driver is assigned to student's bus:
     ```typescript
     if ((busData as any).assignedDriverId === driverUid || busData.driverUID === driverUid) {
         isAuthorized = true;
     }
     ```
     If not assigned to the student's bus, aborts with HTTP 403 Forbidden.
  4. **Atomic Compare-And-Swap (CAS) in Firestore:**
     Runs a Firestore transaction to transition status from `'pending'` to `'approved'` or `'rejected'`. If another driver or moderator processed the request first, aborts gracefully (`"Request already processed"`).
  5. **Branch: `action === 'approve'`:**
     - Deletes old photo from Cloudinary via `cloudinary.uploader.destroy(publicId)`.
     - Updates PostgreSQL `student_profiles`:
       ```typescript
       await updateStudent(requestData.studentUid, {
           profilePhotoUrl: requestData.newImageUrl,
           fullName: requestData.newName,
           pendingProfileUpdate: null
       });
       ```
  6. **Branch: `action === 'reject'`:**
     - Deletes newly uploaded photo from Cloudinary.
     - Updates PostgreSQL `student_profiles`:
       ```typescript
       await updateStudent(requestData.studentUid, {
           pendingProfileUpdate: null
       });
       ```
     - Updates Firestore request document with `status: 'rejected'`.

---

#### 3. `POST /api/students/add` (Manual Admin Creation)
- **Access Control:** Admin or Moderator with `canAdd` permission.
- **Strict Allowlist Filtering:**
  ```typescript
  const ALLOWED_FIELDS = new Set([
    'name', 'fullName', 'email', 'phone', 'phoneNumber', 'alternatePhone', 'altPhone',
    'enrollmentId', 'gender', 'faculty', 'department', 'semester', 'parentName',
    'parentPhone', 'dob', 'address', 'bloodGroup', 'profilePhotoUrl', 'stop_name',
    'pickupPoint', 'sessionDuration',
  ]);
  ```
  - Note: `busId`, `routeId`, `shift`, `validUntil`, `softBlock`, `hardBlock`, and `status` are **completely excluded** from client input.
- **Lifecycle & Capacity Derivation:**
  1. Generates `studentId = crypto.randomUUID()`.
  2. Queries `getDeadlineConfig()`. Computes `sessionStartYear = currentYear`, `sessionEndYear = currentYear`.
  3. Derives `validUntil` via `calculateRenewalDate(null, 1, config)`.
  4. Computes `softBlock` and `hardBlock` via `computeBlockDatesFromValidUntil(validUntil, config)`.
  5. Inserts into `public.users` with `role: 'student'`.
  6. Inserts into `public.student_profiles` with `status: 'active'`, `bus_id: null`, `route_id: null`.
  7. **Capacity Consequence:** Because `bus_id` is null, **NO bus capacity is incremented**. The student occupies zero physical vehicle seats until an admin assigns them via Smart Allocation.

---

#### 4. `PUT /api/students/[id]/update` (Admin Profile Edit)
- **Access Control:** Admin or Moderator with `canEdit` permission.
- **Strict Blocklist Enforcement:**
  ```typescript
  const BLOCKED_FIELDS = new Set([
    'status', 'validUntil', 'busId', 'routeId', 'role', 'paymentAmount',
    'seatReleasedAt', 'softBlock', 'hardBlock', 'approvedBy'
  ]);
  ```
  - **Inviolable Protection:** An admin cannot mutate `busId`, `routeId`, `status`, or `seatReleasedAt` via this endpoint. Any attempt to update these fields is logged and ignored.
- **Shift Normalization:**
  - If `shift` is passed, validates strictly: `normalizeShift(value)` must be either `'Morning'` or `'Evening'`. Any other value is rejected.
- **Execution & Invalidation:**
  - Calls `studentService.update(id, unifiedUpdateData)`.
  - Inside `studentService.update`:
    ```typescript
    await studentRepository.update(id, data);
    invalidateStudentAssignment(id).catch(() => {});
    ```
  - Automatically invalidates L1 memory cache and Redis key `student:assign:<uid>`.

---

#### 5. `SeatReclaimRequiredError` & `applyPaymentValidity`
- **Definition:**
  ```typescript
  export class SeatReclaimRequiredError extends Error {
    public readonly seatReleasedAt: string;
    public readonly studentUid: string;
    constructor(studentUid: string, seatReleasedAt: string) {
      super(
        `Student ${studentUid} seat was released at soft-block (seatReleasedAt=${seatReleasedAt}). ` +
        `Reactivation requires renewal approval with seat allocation (approve_renewal_with_seat).`
      );
      this.name = 'SeatReclaimRequiredError';
      this.studentUid = studentUid;
      this.seatReleasedAt = seatReleasedAt;
    }
  }
  ```
- **Enforcement:**
  - In `applyPaymentValidity(studentUid, payment)`:
    If `student.seatReleasedAt` is non-null, the function throws `SeatReclaimRequiredError`.
    It refuses to transition the student to `status = 'active'` via a payment update.
    The student **MUST** be processed through `approve_renewal_with_seat`, ensuring vehicle capacity is atomically checked and reclaimed before transit entitlement is restored.

---

#### 6. `DELETE /api/students/[id]/delete` (Manual Admin Student Deletion)
- **Access Control:** Admin or Moderator with `canDelete` permission.
- **Execution:**
  1. Calls `deleteUserAndData(id, 'student')`.
  2. Invokes `db.rpc('delete_student_cascade_v1', { p_student_uid: id })`.
  3. Inside `delete_student_cascade_v1`:
     - If `status = 'active'`, aborts with `ACTIVE_STUDENT_ABORT_DELETE` (must be soft-blocked or suspended first).
     - If `seat_released_at IS NULL`, executes:
       ```sql
       PERFORM bus_decrement_capacity(v_bus_id, v_shift);
       ```
       releasing the physical seat before deleting the record.
     - Deletes profile from `student_profiles`, `users`, `applications`, `waiting_flags`, `fcm_tokens`, `device_sessions`, `notifications`.
     - Preserves all rows in `public.payments` and `public.audit_events`.
  4. In TypeScript, cleans up Cloudinary photo, Firestore review requests, and calls `adminAuth.deleteUser(id)`.

---

### 10.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Network Calls |
| :--- | :--- | :--- | :--- |
| **Request Profile Update (Student)** | **2 Calls:**<br>1. `SELECT * FROM student_profiles WHERE uid = ...`<br>2. `UPDATE student_profiles SET pending_profile_update = ...` | 2 Commands (`DEL`, `PUBLISH` via cache invalidation) | 1 Firestore write (`profile_update_requests`) |
| **Handle Profile Update: Approve (Driver)** | **3 Calls:**<br>1. `SELECT * FROM student_profiles WHERE uid = ...`<br>2. `SELECT * FROM buses WHERE id = ...`<br>3. `UPDATE student_profiles SET profile_photo_url = ..., full_name = ..., pending_profile_update = NULL` | 2 Commands (`DEL`, `PUBLISH` via cache invalidation) | 1 Firestore transaction,<br>1 Cloudinary `destroy` |
| **Handle Profile Update: Reject (Driver)** | **3 Calls:**<br>1. `SELECT * FROM student_profiles WHERE uid = ...`<br>2. `SELECT * FROM buses WHERE id = ...`<br>3. `UPDATE student_profiles SET pending_profile_update = NULL` | 2 Commands (`DEL`, `PUBLISH` via cache invalidation) | 1 Firestore transaction + 1 update,<br>1 Cloudinary `destroy` |
| **Admin Create Student (`POST /api/students/add`)** | **3 Calls:**<br>1. `SELECT * FROM deadline_config WHERE is_active = true`<br>2. `INSERT INTO users ...`<br>3. `INSERT INTO student_profiles ...` | 0 | 0 |
| **Admin Edit Student (`PUT /api/students/[id]/update`)** | **2 Calls:**<br>1. `SELECT * FROM student_profiles WHERE uid = ...`<br>2. `UPDATE student_profiles SET ... WHERE uid = ...` | 2 Commands (`DEL student:assign:<uid>`, `PUBLISH student_assign_invalidate`) | 0 |
| **Admin Update Student Status (`PATCH /api/students/[id]/status`)** | **2 Calls:**<br>1. `SELECT * FROM student_profiles WHERE uid = ...`<br>2. `UPDATE student_profiles SET status = ...` | 3 Commands (`DEL student:assign:<uid>`, `PUBLISH`, `DEL role_cache`) | 0 |
| **Admin Delete Student (`DELETE /api/students/[id]/delete`)** | **2 Calls:**<br>1. `SELECT * FROM student_profiles WHERE uid = ...`<br>2. `rpc('delete_student_cascade_v1')` (locks student, decrements bus if seat held, deletes from 7 tables) | 2 Commands (`DEL`, `PUBLISH`) | 1 Firebase Auth (`deleteUser`),<br>1 Firestore cleanup,<br>1 Cloudinary `destroy` |

---

### 10.5 Verbatim Source Code from Live Codebase

#### 1. `src/domains/student/services/student.service.ts` (Full Production Code)
```typescript
/**
 * StudentService
 *
 * Responsibilities: student lookup, profile, CRUD, transport entitlement
 * (lifecycle status derivation).
 *
 * Delegates to PostgreSQL persistence (student.repository.pg.ts).
 * Approval/rejection/renewal/reassignment stay in dataService and the
 * Application flow; this service covers student domain operations.
 */
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { getTransportEntitlement,hasTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import type { Student } from '../repositories/student.repository';
import * as studentRepository from '../repositories/student.repository';

export async function getByUid(uid: string): Promise<Student | null> {
  return studentRepository.findByUid(uid);
}

export async function getById(id: string): Promise<Student | null> {
  return studentRepository.findById(id);
}

export async function getByUids(ids: string[]): Promise<Student[]> {
  return studentRepository.findByUids(ids);
}

export async function getAll(): Promise<Student[]> {
  return studentRepository.findAll();
}

export async function getByBusId(busId: string): Promise<Student[]> {
  return studentRepository.findByBusId(busId);
}

export async function getByEnrollmentId(enrollmentId: string): Promise<Student | null> {
  return studentRepository.findByEnrollmentId(enrollmentId);
}

export class SeatReclaimRequiredError extends Error {
  public readonly seatReleasedAt: string;
  public readonly studentUid: string;

  constructor(studentUid: string, seatReleasedAt: string) {
    super(
      `Student ${studentUid} seat was released at soft-block (seatReleasedAt=${seatReleasedAt}). ` +
      `Reactivation requires renewal approval with seat allocation (approve_renewal_with_seat).`
    );
    this.name = 'SeatReclaimRequiredError';
    this.studentUid = studentUid;
    this.seatReleasedAt = seatReleasedAt;
  }
}

/**
 * Apply payment validity to a student profile.
 * Encapsulates the business rule: older payment cannot overwrite newer validity.
 * This is a domain capability — Payment calls this, not update() directly.
 */
export async function applyPaymentValidity(
  studentUid: string,
  payment: {
    valid_until?: string | null;
    session_start_year?: number | null;
    session_end_year?: number | null;
  }
): Promise<boolean> {
  const student = await getByUid(studentUid);
  if (!student) return false;

  // LC-01 GUARD: If the student's seat was released during a soft-block
  // (SEAT_RELEASE_AT_SOFT_BLOCK=true path), reactivating via a simple status
  // update would make the student active and entitled while the bus load counter
  // remains decremented.  The reconciler (occupiesSeat, admin-reconcile-bus-loads.ts:69)
  // also excludes seat-released students, so the under-count would be cemented
  // by the next integrity sweep → over-allocation.
  //
  // The correct reactivation for a seat-released student is through the renewal
  // approval flow (approve_renewal_with_seat RPC), which atomically reclaims
  // capacity and clears the seatReleasedAt marker in one DB transaction.
  if ((student as any).seatReleasedAt) {
    console.error(
      `[applyPaymentValidity] Refused to reactivate ${studentUid}: seat was released ` +
      `(seatReleasedAt=${(student as any).seatReleasedAt}).  ` +
      `Use the renewal approval path (approve_renewal_with_seat) to atomically ` +
      `reclaim the bus seat and restore the student to active.`
    );
    throw new SeatReclaimRequiredError(studentUid, String((student as any).seatReleasedAt));
  }

  const newValidUntil = payment.valid_until ? new Date(payment.valid_until) : null;
  const existingValidUntil = (student as any).validUntil
    ? new Date((student as any).validUntil)
    : null;

  // Invariant: older payment cannot overwrite newer validity
  const finalValidUntil = (existingValidUntil && newValidUntil && existingValidUntil > newValidUntil)
    ? existingValidUntil
    : newValidUntil;
  const finalSessionEndYear = ((student as any).sessionEndYear && payment.session_end_year && (student as any).sessionEndYear > payment.session_end_year)
    ? (student as any).sessionEndYear
    : payment.session_end_year;

  let softBlock: string | undefined;
  let hardBlock: string | undefined;

  if (finalValidUntil) {
    try {
      const deadlineConfig = await getDeadlineConfig();
      const blockDates = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);
      softBlock = (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as any)?.toISOString());
      hardBlock = (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as any)?.toISOString());
    } catch (e) {
      console.error('Failed to compute block dates in applyPaymentValidity:', e);
    }
  }

  await update(studentUid, {
    validUntil: finalValidUntil?.toISOString() || undefined,
    softBlock,
    hardBlock,
    sessionStartYear: payment.session_start_year || (student as any).sessionStartYear,
    sessionEndYear: finalSessionEndYear,
    status: 'active',
  } as any);
  return true;
}

import { invalidateStudentAssignment } from './student-assignment-cache';

export async function update(id: string, data: Partial<Student>): Promise<void> {
  await studentRepository.update(id, data);
  invalidateStudentAssignment(id).catch(() => {});
}

export async function remove(id: string): Promise<void> {
  await studentRepository.remove(id);
  invalidateStudentAssignment(id).catch(() => {});
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  return studentRepository.unassignRoute(routeId);
}

export async function getPaymentHistory(uid: string, enrollmentId?: string) {
  return paymentsSupabaseService.getPaymentsByStudentUid(uid);
}

export async function getProfile(uid: string): Promise<Student | null> {
  return getByUid(uid);
}

// Canonical entitlement decision — re-exported as-is (see
// src/lib/entitlement/transport-entitlement.ts for the locked business rule).
export { getTransportEntitlement,hasTransportEntitlement };
```

---

#### 2. `src/app/api/student/request-profile-update/route.ts` (Full Production Code)
```typescript
import { getById,update } from '@/domains/student';
import { db as adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RequestProfileUpdateSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

/**
 * POST /api/student/request-profile-update
 * 
 * Creates a profile update request from a student, to be approved by their bus driver.
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { newImageUrl, fullName } = body as any;
        const studentUid = auth.uid;

        // Check if the student record exists in PostgreSQL
        const student = await getById(studentUid);
        if (!student) {
            return NextResponse.json(
                { error: 'Student record not found' },
                { status: 404 }
            );
        }

        const currentImageUrl = student.profilePhotoUrl || '';
        const currentName = student.fullName || student.name || '';
        const busId = student.busId || student.busId || null;

        // Create a profile update request document
        const requestId = `profile_update_${studentUid}_${Date.now()}`;
        const requestData = {
            requestId,
            studentUid,
            studentName: currentName,
            currentImageUrl,
            newImageUrl,
            currentName,
            newName: fullName || currentName,
            busId, // Store the bus ID so drivers can filter requests
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save review request to Firestore (driver approval queue belongs to Driver domain)
        const requestRef = adminDb.collection('profile_update_requests').doc(requestId);
        await requestRef.set(requestData);

        // Update the student profile's pending flag in PostgreSQL
        await update(studentUid, {
            pendingProfileUpdate: requestId,
        });

        console.log(`Profile update request created for student ${studentUid}: ${requestId}`);

        return NextResponse.json({
            success: true,
            message: 'Profile update request sent to driver for approval',
            requestId
        });
    },
    {
        requiredRoles: ['student'],
        schema: RequestProfileUpdateSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
```

---

#### 3. `src/app/api/students/[id]/update/route.ts` (Full Production Code)
```typescript
import { getById,update } from '@/domains/student';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { normalizeShift } from '@/lib/utils/shift-utils';
import { NextResponse } from 'next/server';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'students', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    const requestBody = await request.json();

    // FIELD ALLOW-LIST: Only safe fields may be updated via API
    const ALLOWED_FIELDS = new Set([
      'fullName', 'name', 'email', 'phone', 'enrollmentId', 'photoURL',
      'faculty', 'department', 'yearOfStudy',
      'stop_name', 'stop_name', 'stopLat', 'stopLng',
      'shift', 'profilePhotoUrl', 'address', 'bloodGroup', 'dob', 'parentName', 'parentPhone'
    ]);
    const BLOCKED_FIELDS = new Set([
      'status', 'validUntil', 'busId', 'routeId', 'role', 'paymentAmount',
      'seatReleasedAt', 'softBlock', 'hardBlock', 'approvedBy'
    ]);

    const updatedStudentData: Record<string, any> = {};
    for (const [key, value] of Object.entries(requestBody)) {
      if (BLOCKED_FIELDS.has(key)) {
        console.warn(`Blocked attempt to update forbidden field: ${key}`);
        continue;
      }
      if (ALLOWED_FIELDS.has(key)) {
        if (key === 'shift') {
          // Students may ONLY have 'Morning' or 'Evening' - use canonical validation
          const normalized = normalizeShift(value as string);
          if (normalized !== 'Morning' && normalized !== 'Evening') {
            console.warn(`Invalid shift value rejected: ${value}`);
            continue;
          }
          updatedStudentData[key] = normalized;
          continue;
        }
        updatedStudentData[key] = value;
      }
    }

    const student = await getById(id);
    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    if (updatedStudentData.profilePhotoUrl !== undefined) {
      if (typeof updatedStudentData.profilePhotoUrl !== 'string') {
        delete updatedStudentData.profilePhotoUrl;
      } else if (updatedStudentData.profilePhotoUrl.trim() === '') {
        updatedStudentData.profilePhotoUrl = null;
      }
    }

    const unifiedUpdateData: Record<string, any> = {
      ...updatedStudentData,
      busId: updatedStudentData.busId || student.busId,
      routeId: updatedStudentData.routeId || student.routeId,
      updatedAt: new Date().toISOString(),
    };

    await update(id, unifiedUpdateData);

    const responseStudent = {
      id: student.id || student.uid,
      name: unifiedUpdateData.fullName ?? unifiedUpdateData.name ?? student.fullName ?? student.name ?? '',
      email: unifiedUpdateData.email ?? student.email ?? '',
      phone: unifiedUpdateData.phone ?? student.phone ?? '',
      alternatePhone: student.altPhone || '',
      enrollmentId: unifiedUpdateData.enrollmentId ?? student.enrollmentId ?? '',
      gender: student.gender || '',
      dob: unifiedUpdateData.dob ?? student.dob ?? '',
      faculty: unifiedUpdateData.faculty ?? student.faculty ?? '',
      department: unifiedUpdateData.department ?? student.department ?? '',
      parentName: unifiedUpdateData.parentName ?? student.parentName ?? '',
      parentPhone: unifiedUpdateData.parentPhone ?? student.parentPhone ?? '',
      busAssigned: student.busId || '',
      routeId: student.routeId || '',
      profilePhotoUrl: unifiedUpdateData.profilePhotoUrl !== undefined ? (unifiedUpdateData.profilePhotoUrl || '') : (student.profilePhotoUrl || ''),
      address: unifiedUpdateData.address ?? student.address ?? '',
      bloodGroup: unifiedUpdateData.bloodGroup ?? student.bloodGroup ?? '',
    };

    return NextResponse.json(responseStudent);
  } catch (error: any) {
    console.error('Error updating student:', error);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}
```

---

#### 4. `src/app/api/students/add/route.ts` (Full Production Code)
```typescript
import { createStudent,createUser } from '@/domains/identity';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { checkRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { calculateRenewalDate } from '@/lib/utils/renewal-utils';
import { NextRequest,NextResponse } from 'next/server';

// Explicit allowlist of client-writable fields. Server-authoritative fields
// (uid, role, status, busId, routeId, shift, validity, blocks, entitlement
// flags) are NEVER taken from client input.
const ALLOWED_FIELDS = new Set([
  'name', 'fullName', 'email', 'phone', 'phoneNumber', 'alternatePhone', 'altPhone',
  'enrollmentId', 'gender', 'faculty', 'department', 'semester', 'parentName',
  'parentPhone', 'dob', 'address', 'bloodGroup', 'profilePhotoUrl', 'stop_name',
  'pickupPoint', 'sessionDuration',
]);

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require admin or moderator authentication
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // SECURITY: Moderators need explicit student-creation permission
    if (auth.role === 'moderator') {
      const permissionDenied = await requireModeratorPermission(auth, 'students', 'canAdd');
      if (permissionDenied) return permissionDenied;
    }

    // SECURITY: Rate limit
    const rateLimitId = createRateLimitId(auth.uid, 'students-add');
    const rateCheck = checkRateLimit(rateLimitId, RateLimits.CREATE.maxRequests, RateLimits.CREATE.windowMs);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait.' },
        { status: 429 }
      );
    }

    const rawStudentData = await request.json();

    // SECURITY: Validate required fields
    if (!rawStudentData.name && !rawStudentData.fullName) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    if (!rawStudentData.email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Allowlist — drop every non-listed key (role, uid, status,
    // busId, routeId, shift, validUntil, blocks, feesStatus, ...).
    const newStudentData: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawStudentData)) {
      if (ALLOWED_FIELDS.has(key)) {
        newStudentData[key] = value;
      }
    }

    const studentId = crypto.randomUUID();
    
    // CRITICAL: Extract session information from application data
    let sessionEndYear: number;
    let sessionStartYear: number;
    let validUntil: string;
    
    const config = await getDeadlineConfig();

    // Session is always computed server-side from the deadline config.
    // Client-supplied sessionInfo/session years are ignored (allowlisted out).
    const currentYear = new Date().getFullYear();
    sessionStartYear = currentYear;
    sessionEndYear = currentYear;
    const renewalResult = calculateRenewalDate(null, 1, config);
    validUntil = renewalResult.newValidUntil;

    const blockDates = computeBlockDatesFromValidUntil(validUntil, config);
    
    const newStudent = {
      ...newStudentData,
      id: studentId,
      sessionStartYear,
      sessionEndYear,
      validUntil,
      softBlock: blockDates.softBlock,
      hardBlock: blockDates.hardBlock
    };

    const createdAt = new Date().toISOString();

    // Write user to PostgreSQL (canonical source of truth) — before transaction
    await createUser({
      uid: studentId,
      email: newStudentData.email,
      name: newStudentData.name || newStudentData.fullName,
      role: 'student',
      createdAt,
    });

    // Write student to PostgreSQL (canonical source of truth) — before transaction
    await createStudent({
      uid: studentId,
      email: newStudentData.email,
      fullName: newStudentData.name || newStudentData.fullName,
      role: 'student',
      status: 'active',
      createdAt,
      ...newStudentData,
      sessionStartYear,
      sessionEndYear,
      validUntil,
      softBlock: blockDates.softBlock,
      hardBlock: blockDates.hardBlock,
    });

    return NextResponse.json(newStudent, { status: 201 });
  } catch (error) {
    console.error('Error adding student:', error);
    return NextResponse.json({ error: 'Failed to add student' }, { status: 500 });
  }
}
```

---

