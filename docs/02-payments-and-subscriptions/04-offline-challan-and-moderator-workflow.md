# Offline Bank Challan / Receipt Workflow, Moderator Queue & Audit Verification (Forensic Truth)

**Module:** Bank Challans, Counter Cash Receipts, Moderator Verification Queue, Document Audit & Approval RPCs  
**File Authority:** `src/app/api/payments/offline/route.ts`, `src/app/api/moderator/payments/verify/route.ts`, `src/domains/payment/`  
**Database Tables:** `payments`, `payment_receipts`, `moderator_audit_logs`  

---

# PART 5: Offline Bank Challan / Receipt Workflow, Moderator Verification Queue & Granular RBAC

### 5.1 Sub-Domain Architecture & Exact Execution Pipeline

The offline payment lifecycle enforces a strict financial ledger invariant: **Student submission of an offline payment reference or bank receipt creates NO row in `public.payments`**. The submission exists solely as an application in `state = 'submitted'` with the payment reference, amount, and Cloudinary receipt URL stored inside `form_data`. 

An immutable completed payment row is created in `public.payments` **ONLY when an authorized Admin or Moderator reviews and approves the application**.

```
  STUDENT APPLICANT                  CLOUDINARY / SERVER               ADMIN / MODERATOR
         │                                   │                                 │
         │─── 1. POST /api/upload ──────────►│                                 │
         │    (Image buffer, 5MB cap,        │                                 │
         │     strip EXIF, unique public_id) │                                 │
         │◄── Returns secure_url ────────────│                                 │
         │                                                                     │
         │─── 2. POST /api/student/renew-service-v2 (or /submit-final) ───────►│
         │    (paymentMode: 'offline', transactionId, receiptImageUrl)         │
         │    [Inserts into public.applications with state='submitted']        │
         │    [ZERO writes to public.payments at this stage]                   │
         │                                                                     │
         │                                   ┌─────────────────────────────────┴─────────────────────────────────┐
         │                                   │                                                                   │
         │                                   ▼                                                                   ▼
         │                        [PATH A: APPROVAL]                                                  [PATH B: REJECTION]
         │                                   │                                                                   │
         │                    POST /api/renewal-requests/approve-v2                               POST /api/renewal-requests/reject
         │                    (or /api/applications/approve)                                      (or /api/applications/reject)
         │                                   │                                                                   │
         │                    requireModeratorPermission(                                         requireModeratorPermission(
         │                      auth, 'payments',                                                   auth, 'payments',
         │                      'canApproveOfflinePayment'                                          'canRejectOfflinePayment'
         │                    )                                                                   )
         │                                   │                                                                   │
         │                    Application.approve(applicationId, approver)                        Application.reject(applicationId, rejector, reason)
         │                                   │                                                                   │
         │                    1. RPC approve_application (Lock row)                               1. RPC reject_application (Lock row)
         │                    2. If Renewal & Seat Released:                                      2. RPC finalize_application_rejection
         │                       RPC approve_renewal_with_seat                                    3. Audit event ('application_rejected')
         │                       Else Fresh:                                                      4. Dispatch rejection email
         │                       RPC identity_activate_student_with_capacity                      5. Delete receipt image from Cloudinary
         │                    3. RPC finalize_application_approval                                               │
         │                    4. Post-Commit Side Effects:                                                       ▼
         │                       - createOfflinePaymentAtApproval()                                        HTTP 200 { success: true }
         │                         [status='Completed', method='Offline',
         │                          paymentId='ORTF_...' or 'OADF_...']
         │                       - Audit event ('application_approved')
         │                       - Dispatch approval email
         │                       - Delete receipt image from Cloudinary
         │                                   │
         │                                   ▼
         │◄──────────────────────── HTTP 200 { success: true }
```

---

### 5.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/upload/route.ts` | `POST` | Student checkout / application forms | `verifyTokenOnly`, `checkRateLimit`, `cloudinary.uploader.upload_stream`, `sanitizeFolder` | Rate limit in-memory cache; External Cloudinary asset store |
| `src/lib/security/moderator-permissions.ts` | `getModeratorPermissions`, `requireModeratorPermission`, `requireAdminPermission`, `isModeratorActive`, `invalidateModeratorPermissionCache` | API Route Handlers across `/api/applications/*`, `/api/renewal-requests/*`, `/api/students/*` | `getModeratorById` (Identity domain), `mergeWithDefaults` | Reads `moderator_profiles` (with 60-second in-memory LRU cache: `permissionCache`) |
| `src/lib/types/moderator-permissions.ts` | `DEFAULT_MODERATOR_PERMISSIONS`, `FULL_MODERATOR_PERMISSIONS`, `ZERO_MODERATOR_PERMISSIONS`, `mergeWithDefaults` | `moderator-permissions.ts` | Pure configuration & types | None |
| `src/app/api/renewal-requests/approve-v2/route.ts` | `POST` | Admin / Moderator Renewal Workbench | `verifyToken`, `getUserById`, `requireModeratorPermission`, `Application.getById`, `Application.approve`, `extractPublicId`, `deleteAsset`, `sendApplicationApprovedNotification` | Reads/mutates `public.applications`, `public.student_profiles`, `public.payments` |
| `src/app/api/renewal-requests/reject/route.ts` | `POST` | Admin / Moderator Renewal Workbench | `adminAuth.verifyIdToken`, `getUserById`, `requireModeratorPermission`, `Application.getById`, `Application.reject`, `extractPublicId`, `deleteAsset` | Mutates `public.applications`, `public.audit_events` |
| `src/app/api/applications/approve/route.ts` | `POST` | Admin / Moderator Application Workbench | `withSecurity`, `getUpdaterInfo`, `requireModeratorPermission`, `Application.approve` | Reads/mutates `public.applications`, `public.student_profiles`, `public.buses`, `public.payments` |
| `src/app/api/applications/reject/route.ts` | `POST` | Admin / Moderator Application Workbench | `withSecurity`, `getUpdaterInfo`, `requireModeratorPermission`, `Application.reject` | Mutates `public.applications`, `public.audit_events` |
| `src/domains/application/services/application.service.ts` | `approve`, `reject`, `postCommitApprovalSideEffects` | Application approval/rejection API routes | DB RPCs (`approve_application`, `approve_renewal_with_seat`, `identity_activate_student_with_capacity`, `finalize_application_approval`, `release_application_lock`, `reject_application`, `finalize_application_rejection`), `createOfflinePaymentAtApproval`, `upsertApprovalPayment` | Mutates `public.applications`, `public.buses`, `public.student_profiles`, `public.payments`, `public.audit_events` |
| `src/lib/payment/payment.service.ts` | `createOfflinePaymentAtApproval` | `postCommitApprovalSideEffects` in Application service | `generateOfflinePaymentId`, `paymentsSupabaseService.createPayment` | Mutates `public.payments` (status: Completed, method: Offline) |
| `src/lib/types/payment.ts` | `generateOfflinePaymentId`, `generateOnlinePaymentId` | `createOfflinePaymentAtApproval`, admin create user | `getSecureRandomString` (crypto PRNG) | None |

---

### 5.3 Method-by-Method Low-Level Walkthrough

#### 1. Secure Proof Upload: `POST /api/upload` (`src/app/api/upload/route.ts`)
- **Authentication:** Mandatory Firebase auth token via `verifyTokenOnly(request)`. Unauthenticated calls yield HTTP 401.
- **Rate Limiting:** Enforces strict 5 uploads per 60 seconds per user (`createRateLimitId(user.uid, 'upload')`). Violations return HTTP 429 with `Retry-After` header.
- **File Validation:**
  - MIME Allowlist: Strictly JPEG (`image/jpeg`), PNG (`image/png`), and WebP (`image/webp`). Reject all others with HTTP 400.
  - File Size: Maximum 5 MB (`MAX_FILE_SIZE = 5 * 1024 * 1024`). Reject larger with HTTP 400.
- **Cloudinary Ingestion:**
  - Folder sanitization: Restricts upload targets to allowlisted directory prefixes.
  - Generates unique random `public_id` on the server; `overwrite: false`.
  - Strips EXIF and geolocation metadata via transformation `[{ flags: 'strip_profile' }]`.
  - Returns `{ url: result.secure_url, public_id: result.public_id }`.

---

#### 2. Granular Moderator RBAC Guard: `requireModeratorPermission` (`src/lib/security/moderator-permissions.ts`)
- **Signature:** `requireModeratorPermission<C extends PermissionCategory>(auth: SecurityAuth, category: C, permission: PermissionKey<C>, requestId?: string): Promise<NextResponse | null>`
- **Control Flow:**
  1. **Admin Exemption:** If `auth.role === 'admin'`, immediately returns `null` (allowed unconditionally).
  2. **Non-Moderator Check:** If `auth.role !== 'moderator'`, returns **HTTP 403 Forbidden** (`'Insufficient permissions'`).
  3. **Permission Resolution with 60-Second In-Memory LRU Cache:**
     - Checks `permissionCache.get(uid)`. If valid and `Date.now() < cached.expiresAt`, returns cached permissions object.
     - On cache miss, fetches moderator record via `getModeratorById(uid)` from `moderator_profiles`.
     - If moderator profile is suspended or `status !== 'active'`, returns `ZERO_MODERATOR_PERMISSIONS` (all flags `false`).
     - Otherwise merges stored permissions with `DEFAULT_MODERATOR_PERMISSIONS`.
     - Caches result for 60 seconds (`PERMISSION_CACHE_TTL_MS = 60_000`), capped at 1,000 entries.
  4. **Evaluation:** Checks `Boolean(permissions[category]?.[permission])`.
     - If `true`, returns `null` (access permitted).
     - If `false`, returns **HTTP 403 Forbidden** (`'Moderator permission not granted'`).
- **Granular Categories & Keys for Payments/Applications:**
  - `category: 'applications'`, `permission: 'canApprove'` (general admission approval)
  - `category: 'applications'`, `permission: 'canReject'` (general admission rejection)
  - `category: 'payments'`, `permission: 'canApproveOfflinePayment'` (renewal offline approval)
  - `category: 'payments'`, `permission: 'canRejectOfflinePayment'` (renewal offline rejection)

---

#### 3. Renewal Approval Handler: `POST /api/renewal-requests/approve-v2` (`src/app/api/renewal-requests/approve-v2/route.ts`)
- **Authentication & RBAC:**
  - Reads Bearer token, verifies via `verifyToken(token)`.
  - Checks approver profile in Identity domain (`getUserById`). Must have role `admin` or `moderator`.
  - Enforces `requireModeratorPermission(auth, 'payments', 'canApproveOfflinePayment')`.
- **Pre-Conditions:**
  - Fetches application via `Application.getById(requestId)`. Must exist, else HTTP 404.
  - State check: `app.state === 'submitted'`. If already processed, returns HTTP 400.
  - Type check: `app.applicationType === 'renewal' || 'renewal_after_soft_block'`.
- **Execution via `Application.approve`:**
  - Invokes `Application.approve(requestId, { uid, name, role })`.
  - If approval fails, returns HTTP 500 or error status from domain.
- **Post-Commit Side Effects (Executed via `Promise.allSettled`):**
  1. Cloudinary Cleanup: Extracts public ID from `fd.receiptImageUrl` via `extractPublicId` and calls `deleteAsset(publicId)`.
  2. Email Notification: Calls `sendApplicationApprovedNotification` to student with assigned bus, shift, and new `validUntil` date.
  3. Returns HTTP 200 `{ success: true, message: 'Renewal approved successfully' }`.

---

#### 4. Renewal Rejection Handler: `POST /api/renewal-requests/reject` (`src/app/api/renewal-requests/reject/route.ts`)
- **Authentication & RBAC:**
  - Enforces `requireModeratorPermission(auth, 'payments', 'canRejectOfflinePayment')`.
- **Pre-Conditions:**
  - Requires `requestId` and `reason`.
  - Validates application is a renewal in `state = 'submitted'`.
- **Execution via `Application.reject`:**
  - Invokes `Application.reject(requestId, { uid, name, role }, reason)`.
  - Rejection identity is extracted strictly from the authenticated session, ignoring client-provided names.
- **Post-Commit Side Effects:**
  - Rejection email dispatched inside `Application.reject`.
  - If `receiptImageUrl` is present, deletes proof asset from Cloudinary via `deleteAsset(publicId)`.
  - Returns HTTP 200 `{ success: true, message: 'Renewal request rejected successfully' }`.

---

#### 5. Application Orchestration: `Application.approve` (`src/domains/application/services/application.service.ts`)
- **Step 1: Application Lock RPC (`approve_application`):**
  - Calls PostgreSQL RPC `approve_application(p_application_id, p_approver_uid)`.
  - Atomically locks the application row (`FOR UPDATE`), verifies `state = 'submitted'`, and assigns the lock.
- **Step 2A: Renewal Execution Path:**
  - If commuter was soft-blocked and their seat was released (`seatWasReleased = !!student.seatReleasedAt` and `renewalBusId` exists):
    - Invokes atomic RPC `approve_renewal_with_seat`.
    - Atomically locks `public.buses` row, checks load against capacity, increments load, updates `student_profiles`, clears `seat_released_at`, and commits application approval in a single database transaction.
    - Sets `renewalAlreadyFinalized = true`.
  - If standard renewal (seat not released):
    - Computes updated validity (`calculateValidUntilDate`, `computeBlockDatesFromValidUntil`).
    - Prepares student update payload for `finalize_application_approval`.
- **Step 2B: Fresh Application Path:**
  - Builds student data payload via `buildStudentData`.
  - If bus assigned: Calls atomic RPC `identity_activate_student_with_capacity` (fuses bus load increment and identity profile creation).
  - If no bus assigned: Calls RPC `identity_activate_student`.
- **Step 2C: Application Finalization:**
  - If not already finalized, calls RPC `finalize_application_approval` to commit changes.
- **Step 3: Post-Commit Side Effects (`postCommitApprovalSideEffects`):**
  - Offline Payment Generation:
    ```typescript
    createOfflinePaymentAtApproval({
        studentId: studentIdVal,
        studentUid: app.applicant_uid,
        studentName: studentNameVal,
        amount,
        durationYears: studentData.durationYears,
        sessionStartYear: studentData.sessionStartYear,
        sessionEndYear: studentData.sessionEndYear,
        validUntil: studentData.validUntil,
        transactionId: app.form_data?.paymentInfo?.paymentReference || '',
        paidAt: new Date(app.form_data?.paymentInfo?.paidAt),
        receipt: app.form_data?.paymentInfo?.paymentEvidenceUrl || '',
        approverUserId: approverData.uid,
        approverName: approverData.name,
        approverEmpId: '',
        approverRole: approverData.role,
        purpose,
    })
    ```
  - Audit Logging: Logs `application_approved` to `public.audit_events`.

---

#### 6. Offline Payment Creation: `createOfflinePaymentAtApproval` (`src/lib/payment/payment.service.ts`)
- **ID Generation:** Calls `generateOfflinePaymentId(purpose)`.
  - For `new_registration`: Generates `OADF_${Date.now()}_${cryptoRandom8}` (Offline Admission Fee).
  - For `renewal`: Generates `ORTF_${Date.now()}_${cryptoRandom8}` (Offline Renewal Transport Fee).
- **Ledger Insertion:** Calls `paymentsSupabaseService.createPayment`:
  - Sets `method = 'Offline'`.
  - Sets `status = 'Completed'`.
  - Stores `offline_transaction_id = request.transactionId` (the student's bank reference).
  - Records manual approver audit metadata: `approvedBy: { type: 'Manual', userId, name, role }`.
  - Records `transaction_date = request.paidAt` (student's payment timestamp).

---

### 5.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Cold Execution: Student Offline Proof Upload (`POST /api/upload`)** | **0 DB Queries** | **0** | **1 Cloudinary Call:**<br>1. `cloudinary.uploader.upload_stream` | **1 I/O Op** |
| **(b) Cold Execution: Moderator Offline Approval (Renewal with Seat Reclamation)** | **7 Queries / RPCs:**<br>1. Select `moderator_profiles` for permissions<br>2. Select `applications` by ID<br>3. RPC `approve_application` (Lock)<br>4. Select `student_profiles` by UID<br>5. RPC `approve_renewal_with_seat` (Atomic capacity check + seat increment + student update + app finalize)<br>6. Insert `public.payments` (`createOfflinePaymentAtApproval`)<br>7. Insert `public.audit_events` | **0** | **2 External Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Resend / SMTP Email API (`sendApplicationApprovedNotification`) | **9 I/O Ops** |
| **(c) Warm Execution: Moderator Offline Approval (Permissions Cached in LRU)** | **6 Queries / RPCs:**<br>(Omits `moderator_profiles` lookup due to 60s memory cache; executes RPCs 2 through 7) | **0** | **2 External Calls** (Cloudinary delete + Email) | **8 I/O Ops** |
| **(d) Rejection Execution (Moderator Rejects Offline Application)** | **4 Queries / RPCs:**<br>1. Check `moderator_profiles` (or warm cache)<br>2. RPC `reject_application` (Lock)<br>3. RPC `finalize_application_rejection`<br>4. Insert `public.audit_events` | **0** | **2 External Calls:**<br>1. Cloudinary `deleteAsset`<br>2. Rejection Email API | **6 I/O Ops** |
| **(e) Concurrent Collision (Two moderators approve same application simultaneously)** | **2 Queries total for loser:**<br>1. Moderator auth check<br>2. RPC `approve_application` fails immediately on row lock (`ALREADY_LOCKED` / `INVALID_STATE`) | **0** | **0 External Calls** (Fails closed before external side effects) | **2 I/O Ops** |

---

### 5.5 Verbatim Source Code from Live Codebase

#### 1. Secure Receipt Proof Upload Handler: `src/app/api/upload/route.ts`
```typescript
/**
 * POST /api/upload — Secure Image Upload
 * ────────────────────────────────────────
 * SECURITY HARDENING (March 2026):
 *  1. ✅ Authentication required (Firebase token verified server-side)
 *  2. ✅ Rate-limited (5 uploads / 60 s per user)
 *  3. ✅ MIME-type allow-list (jpg, png, webp only — no gif)
 *  4. ✅ File size capped at 5 MB
 *  5. ✅ Folder allow-list — client cannot choose arbitrary folders
 *  6. ✅ Server-generated unique public_id (client cannot set it)
 *  7. ✅ Overwrite disabled (prevents replacing existing assets)
 *  8. ✅ EXIF/metadata stripped from uploads
 *  9. ✅ No deletion of caller-supplied URLs (deleting any known asset URL
 *     would let an authenticated user destroy other users' photos whose URLs
 *     are visible in-app; old-photo cleanup happens in update-profile-photo,
 *     which only deletes the target's current photo)
 * 10. ✅ Error messages sanitised in production
 *
 * Accepts multipart/form-data with fields:
 *   file        – the image file (required)
 *   folder      – target folder, validated against allow-list (default: "adtu")
 */

import cloudinary,{
	isAllowedMimeType,
	isAllowedSize,
	MAX_FILE_SIZE,
	sanitizeFolder,
} from '@/lib/cloudinary-server';
import { verifyTokenOnly } from '@/lib/security/api-auth';
import { checkRateLimit,createRateLimitId } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authentication ─────────────────────────────────────────────────
    // SECURITY: Every upload must come from an authenticated user.
    const user = await verifyTokenOnly(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // ── 2. Rate Limiting ──────────────────────────────────────────────────
    // SECURITY: Prevent upload flooding — 5 requests per 60 seconds per user.
    const rateLimitId = createRateLimitId(user.uid, 'upload');
    const rateCheck = checkRateLimit(rateLimitId, 5, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please wait before trying again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)),
          },
        }
      );
    }

    // ── 3. Parse Form Data ────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const rawFolder = formData.get('folder') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // ── 4. Validate MIME Type ─────────────────────────────────────────────
    // SECURITY: Allowlist-only — blocks everything that isn't jpg/png/webp.
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.' },
        { status: 400 }
      );
    }

    // ── 5. Validate File Size ─────────────────────────────────────────────
    // SECURITY: Hard cap at 5 MB.
    if (!isAllowedSize(file.size)) {
      return NextResponse.json(
        {
          error: `File size too large. Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        },
        { status: 400 }
      );
    }

    // ── 6. Sanitise Folder ────────────────────────────────────────────────
    // SECURITY: Only permitted folder names are accepted.
    const folder = sanitizeFolder(rawFolder);

    // ── 7. Upload to Cloudinary (server-side SDK) ─────────────────────────
    // SECURITY:
    //  - unique_filename: true  → Cloudinary generates a random name
    //  - use_filename: false    → Ignores the original filename
    //  - overwrite: false       → Cannot replace an existing asset
    //  - strip_profile flag     → Removes EXIF / GPS metadata
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          use_filename: false,
          unique_filename: true,
          overwrite: false,
          transformation: [{ flags: 'strip_profile' }],
          resource_type: 'image',
        },
        (error, uploadResult) => {
          if (error) {
            reject(error);
          } else {
            resolve(uploadResult);
          }
        }
      );
      uploadStream.end(buffer);
    });

    // Validate we got a URL back
    if (!result.secure_url) {
      throw new Error('Cloudinary upload succeeded but returned no URL');
    }

    return NextResponse.json({
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (error: any) {
    console.error('❌ [Upload] Error:', error);

    // Handle timeout / network errors with specific status
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return NextResponse.json(
        { error: 'Upload timed out. Please try with a smaller image.' },
        { status: 408 }
      );
    }

    return NextResponse.json(
      handleApiError(error, 'upload', 'Failed to upload image'),
      { status: 500 }
    );
  }
}
```

#### 2. Moderator RBAC Guard & LRU Cache: `src/lib/security/moderator-permissions.ts`
```typescript
import { getModeratorById } from '@/domains/identity';
import type { SecurityAuth } from '@/lib/security/api-security';
import {
	DEFAULT_MODERATOR_PERMISSIONS,
	mergeWithDefaults,
	type ModeratorPermissions,
	ZERO_MODERATOR_PERMISSIONS,
} from '@/lib/types/moderator-permissions';
import { NextResponse } from 'next/server';

type PermissionCategory = keyof ModeratorPermissions;
type PermissionKey<C extends PermissionCategory> = keyof ModeratorPermissions[C];

const permissionCache = new Map<string, { permissions: ModeratorPermissions; expiresAt: number }>();
const PERMISSION_CACHE_TTL_MS = 60 * 1000;

export async function getModeratorPermissions(uid: string): Promise<ModeratorPermissions> {
  const cached = permissionCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    // Re-insert to maintain true LRU order
    permissionCache.delete(uid);
    permissionCache.set(uid, cached);
    return cached.permissions;
  }

  const moderator = await getModeratorById(uid);
  if (!moderator || (moderator.status && moderator.status !== 'active')) {
    permissionCache.set(uid, {
      permissions: ZERO_MODERATOR_PERMISSIONS,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
    return ZERO_MODERATOR_PERMISSIONS;
  }

  const permissions = mergeWithDefaults(
    moderator.permissions as Partial<ModeratorPermissions> | undefined
  );

  permissionCache.set(uid, {
    permissions,
    expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
  });

  if (permissionCache.size > 1000) {
    const firstKey = permissionCache.keys().next().value;
    if (firstKey) permissionCache.delete(firstKey);
  }

  return permissions;
}

export function invalidateModeratorPermissionCache(uid: string): void {
  permissionCache.delete(uid);
}

/**
 * Returns true iff the moderator exists in moderator_profiles with status='active'.
 * Uses the same 60-second in-process cache as getModeratorPermissions — no extra
 * DB round-trip when the cache is warm (the common path for requests within 60s of
 * the previous moderator API call).
 *
 * Used by withSecurity (RBAC-11) to gate suspended/inactive moderators on ALL
 * moderator-accessible routes, not just those that call requireModeratorPermission.
 */
export async function isModeratorActive(uid: string): Promise<boolean> {
  const perms = await getModeratorPermissions(uid);
  // If the moderator is suspended/inactive, getModeratorPermissions returns
  // ZERO_MODERATOR_PERMISSIONS whose every leaf value is false.  An active
  // moderator with all permissions stripped would also return all-false, so we
  // check the DB result directly here by re-querying (still cache-backed).
  const cached = permissionCache.get(uid);
  if (cached) {
    // We already fetched; the cache entry's permissions pointer is either
    // the ZERO constant (suspended) or a mergeWithDefaults result (active).
    // Compare by checking the cached field used to distinguish them.
    return perms !== ZERO_MODERATOR_PERMISSIONS;
  }
  // Cache miss after getModeratorPermissions — can't happen in practice, but
  // be safe: treat as active only if getModeratorById returns active status.
  const moderator = await getModeratorById(uid);
  return Boolean(moderator && (!moderator.status || moderator.status === 'active'));
}

export async function requireAdminPermission(
  auth: SecurityAuth,
  requestId?: string
): Promise<NextResponse | null> {
  if (auth.role === 'admin') return null;

  return NextResponse.json(
    { success: false, error: 'Insufficient permissions', requestId },
    { status: 403 }
  );
}

export async function requireModeratorPermission<C extends PermissionCategory>(
  auth: SecurityAuth,
  category: C,
  permission: PermissionKey<C>,
  requestId?: string
): Promise<NextResponse | null> {
  if (auth.role === 'admin') return null;

  if (auth.role !== 'moderator') {
    return NextResponse.json(
      { success: false, error: 'Insufficient permissions', requestId },
      { status: 403 }
    );
  }

  const permissions = await getModeratorPermissions(auth.uid);
  const allowed = Boolean(permissions[category]?.[permission]);

  if (allowed) return null;

  return NextResponse.json(
    { success: false, error: 'Moderator permission not granted', requestId },
    { status: 403 }
  );
}

```

#### 3. Moderator Permission Definitions & Presets: `src/lib/types/moderator-permissions.ts`
```typescript
/**
 * Moderator Permission Configuration
 * 
 * This defines all granular permissions that an admin can configure
 * for each moderator. Stored in Firestore at `moderators/{modId}/permissions`.
 * 
 * Security Note: These permissions are enforced BOTH client-side (for UX) 
 * AND server-side (in API routes) to prevent bypass.
 */

export interface ModeratorPermissions {
  // ═══════════════════════════════════════════════
  // STUDENT OPERATIONS
  // ═══════════════════════════════════════════════
  students: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Student reassignment (smart-allocation)
  };

  // ═══════════════════════════════════════════════
  // DRIVER OPERATIONS
  // ═══════════════════════════════════════════════
  drivers: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Driver reassignment (driver-assignment)
  };

  // ═══════════════════════════════════════════════
  // BUS OPERATIONS
  // ═══════════════════════════════════════════════
  buses: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;  // Bus route reassignment (route-allocation)
  };

  // ═══════════════════════════════════════════════
  // ROUTE OPERATIONS
  // ═══════════════════════════════════════════════
  routes: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };

  // ═══════════════════════════════════════════════
  // APPLICATION & VERIFICATION OPERATIONS
  // ═══════════════════════════════════════════════
  applications: {
    canView: boolean;
    canApprove: boolean;       // Approve student application forms
    canReject: boolean;         // Reject student application forms
    canGenerateVerificationCode: boolean;  // Generate/manage verification codes
    canAppearInModeratorList: boolean;      // Show in student apply form's moderator dropdown
  };

  // ═══════════════════════════════════════════════
  // OFFLINE PAYMENT OPERATIONS
  // ═══════════════════════════════════════════════
  payments: {
    canApproveOfflinePayment: boolean;   // Approve offline payments
    canRejectOfflinePayment: boolean;    // Reject offline payments
  };
}

/**
 * Default permissions for a newly added moderator.
 * By default, moderators can view everything but cannot modify or approve anything.
 * Admin must explicitly grant write/approve permissions.
 */
export const DEFAULT_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  drivers: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  buses: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  routes: {
    canView: true,
    canAdd: false,
    canEdit: false,
    canDelete: false,
  },
  applications: {
    canView: true,
    canApprove: false,
    canReject: false,
    canGenerateVerificationCode: false,
    canAppearInModeratorList: false,
  },
  payments: {
    canApproveOfflinePayment: false,
    canRejectOfflinePayment: false,
  },
};

/**
 * Full permissions preset - grants all permissions.
 * Used for trusted, senior moderators.
 */
export const FULL_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canReassign: true,
  },
  drivers: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canReassign: true,
  },
  buses: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
    canReassign: true,
  },
  routes: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
  },
  applications: {
    canView: true,
    canApprove: true,
    canReject: true,
    canGenerateVerificationCode: true,
    canAppearInModeratorList: true,
  },
  payments: {
    canApproveOfflinePayment: true,
    canRejectOfflinePayment: true,
  },
};

/**
 * Zero permissions preset - all actions revoked/disabled.
 * Used when moderator access is suspended or revoked.
 */
export const ZERO_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  drivers: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  buses: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canReassign: false,
  },
  routes: {
    canView: false,
    canAdd: false,
    canEdit: false,
    canDelete: false,
  },
  applications: {
    canView: false,
    canApprove: false,
    canReject: false,
    canGenerateVerificationCode: false,
    canAppearInModeratorList: false,
  },
  payments: {
    canApproveOfflinePayment: false,
    canRejectOfflinePayment: false,
  },
};

/**
 * Merge partial permissions with defaults for backward compatibility.
 */
export function mergeWithDefaults(partial?: Partial<ModeratorPermissions>): ModeratorPermissions {
  return {
    students: { ...DEFAULT_MODERATOR_PERMISSIONS.students, ...(partial?.students || {}) },
    drivers: { ...DEFAULT_MODERATOR_PERMISSIONS.drivers, ...(partial?.drivers || {}) },
    buses: { ...DEFAULT_MODERATOR_PERMISSIONS.buses, ...(partial?.buses || {}) },
    routes: { ...DEFAULT_MODERATOR_PERMISSIONS.routes, ...(partial?.routes || {}) },
    applications: { ...DEFAULT_MODERATOR_PERMISSIONS.applications, ...(partial?.applications || {}) },
    payments: { ...DEFAULT_MODERATOR_PERMISSIONS.payments, ...(partial?.payments || {}) },
  };
}

/**
 * Permission category labels for the UI
 */
export const PERMISSION_CATEGORIES = {
  students: {
    label: 'Student Management',
    icon: 'Users',
    color: 'blue',
    permissions: {
      canView: 'View Students',
      canAdd: 'Add Students',
      canEdit: 'Edit Students',
      canDelete: 'Delete Students',
      canReassign: 'Student Reassignment',
    },
  },
  drivers: {
    label: 'Driver Management',
    icon: 'UserCog',
    color: 'indigo',
    permissions: {
      canView: 'View Drivers',
      canAdd: 'Add Drivers',
      canEdit: 'Edit Drivers',
      canDelete: 'Delete Drivers',
      canReassign: 'Driver Reassignment',
    },
  },
  buses: {
    label: 'Bus Management',
    icon: 'Bus',
    color: 'amber',
    permissions: {
      canView: 'View Buses',
      canAdd: 'Add Buses',
      canEdit: 'Edit Buses',
      canDelete: 'Delete Buses',
      canReassign: 'Bus Route Reassignment',
    },
  },
  routes: {
    label: 'Route Management',
    icon: 'MapPin',
    color: 'emerald',
    permissions: {
      canView: 'View Routes',
      canAdd: 'Add Routes',
      canEdit: 'Edit Routes',
      canDelete: 'Delete Routes',
    },
  },
  applications: {
    label: 'Applications & Verification',
    icon: 'ClipboardCheck',
    color: 'orange',
    permissions: {
      canView: 'View Applications',
      canApprove: 'Approve Applications',
      canReject: 'Reject Applications',
      canGenerateVerificationCode: 'Generate Verification Codes',
      canAppearInModeratorList: 'Available for Student Application Review',
    },
  },
  payments: {
    label: 'Payment Operations',
    icon: 'CreditCard',
    color: 'purple',
    permissions: {
      canApproveOfflinePayment: 'Approve Offline Payments',
      canRejectOfflinePayment: 'Reject Offline Payments',
    },
  },
} as const;

```

#### 4. Renewal Offline Approval Route: `src/app/api/renewal-requests/approve-v2/route.ts`
```typescript
import * as Application from '@/domains/application';
import { deleteAsset,extractPublicId } from '@/lib/cloudinary-server';
import { verifyToken } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/renewal-requests/approve-v2
 *
 * D8: Renewal approval migrated from Firestore transaction to Application domain API.
 * The Application.approve() method orchestrates:
 *   1. RPC validate + lock
 *   2. Student.update() (renewal path)
 *   3. Seat.assignSeat() (if renewal_after_soft_block)
 *   4. Payment (idempotent)
 *   5. Audit (idempotent)
 *   6. Notification (idempotent)
 *   7. RPC finalize (preserve as approved for renewal)
 *
 * Post-commit side effects (notifications, Cloudinary cleanup, email) remain here.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { requestId } = body;
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 100) {
      return NextResponse.json({ error: 'Request ID required' }, { status: 400 });
    }

    const decodedToken = await verifyToken(token);
    const approverUserId = decodedToken.uid;

    // Auth check — read approver profile from Identity domain
    const { getUserById } = await import('@/domains/identity');
    const approverProfile = await getUserById(approverUserId);
    if (!approverProfile || !['admin', 'moderator'].includes(approverProfile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const permissionDenied = await requireModeratorPermission(
      {
        uid: approverUserId,
        email: decodedToken.email || '',
        role: approverProfile.role,
        name: approverProfile.fullName || approverProfile.name || '',
      },
      'payments',
      'canApproveOfflinePayment'
    );
    if (permissionDenied) return permissionDenied;

    // Read application from PostgreSQL
    const app = await Application.getById(requestId);
    if (!app) return NextResponse.json({ error: 'Renewal request not found' }, { status: 404 });
    if (app.state !== 'submitted') return NextResponse.json({ error: 'Request already processed' }, { status: 400 });

    const isRenewal = app.applicationType === 'renewal' || app.applicationType === 'renewal_after_soft_block';
    if (!isRenewal) {
      return NextResponse.json({ error: 'This is not a renewal application' }, { status: 400 });
    }

    const fd = app.formData as any;
    const studentName = fd.studentName || app.applicantUid;
    const receiptImageUrl = fd.receiptImageUrl || '';

    // ── Core approval via Application domain ──────────────────────────
    const result = await Application.approve(
      requestId,
      {
        uid: approverUserId,
        name: approverProfile.fullName || approverProfile.name || 'Admin',
        role: approverProfile.role,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    // ── Post-commit side effects (non-critical) ──────────────────────
    const postTasks = [
      // Cloudinary cleanup
      (async () => {
        if (receiptImageUrl) {
          const publicId = extractPublicId(receiptImageUrl);
          if (publicId) await deleteAsset(publicId);
        }
      })(),

      // Email notification
      (async () => {
        const studentEmail = fd.studentEmail || app.email || app.applicantEmail;
        if (studentEmail) {
          try {
            const { sendApplicationApprovedNotification } = await import('@/lib/services/admin-email.service');
            await sendApplicationApprovedNotification({
              studentName,
              studentEmail,
              busNumber: (app.formData?.busId as string)?.replace('bus_', 'Bus-') || 'Assigned Bus',
              routeName: 'Service Renewal',
              shift: (app.formData?.shift as string) || 'Assigned Shift',
              validUntil: new Date(Date.UTC(((app.formData as any)?.sessionEndYear as number) || (new Date().getFullYear() + 1), 5, 30)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            });
          } catch (err) { console.error('Email notify failed:', err); }
        }
      })(),
    ];

    await Promise.allSettled(postTasks);

    return NextResponse.json({
      success: true,
      message: 'Renewal approved successfully',
    });

  } catch (error: any) {
    console.error('Renewal approval failed:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Failed to process renewal approval') }, { status: 500 });
  }
}

```

#### 5. Renewal Offline Rejection Route: `src/app/api/renewal-requests/reject/route.ts`
```typescript
import * as Application from '@/domains/application';
import { getUserById } from '@/domains/identity';
import { deleteAsset,extractPublicId } from '@/lib/cloudinary-server';
import { adminAuth } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/renewal-requests/reject
 *
 * D8: Renewal rejection migrated from Firestore transaction to Application domain API.
 * The Application.reject() method orchestrates:
 *   1. RPC validate + lock
 *   2. Payment cleanup (idempotent)
 *   3. Audit (idempotent)
 *   4. Notification (idempotent)
 *   5. RPC finalize (delete application for rejection)
 *
 * Post-commit side effects (email, Cloudinary cleanup) remain here.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { requestId, reason } = body;

    if (!requestId || !reason) {
      return NextResponse.json({ error: 'Missing required fields: requestId, reason' }, { status: 400 });
    }

    // Verify user is admin or moderator
    const userProfile = await getUserById(uid);
    if (!userProfile || !['admin', 'moderator'].includes(userProfile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: userProfile.role,
        name: userProfile.fullName || userProfile.name || '',
      },
      'payments',
      'canRejectOfflinePayment'
    );
    if (permissionDenied) return permissionDenied;

    // Read application from PostgreSQL
    const app = await Application.getById(requestId);
    if (!app) {
      return NextResponse.json({ error: 'Renewal request not found' }, { status: 404 });
    }

    const isRenewal = app.applicationType === 'renewal' || app.applicationType === 'renewal_after_soft_block';
    if (!isRenewal) {
      return NextResponse.json({ error: 'This is not a renewal application' }, { status: 400 });
    }

    if (app.state !== 'submitted') {
      return NextResponse.json({ error: 'Renewal request must be pending' }, { status: 400 });
    }

    // ── Core rejection via Application domain ─────────────────────────
    // Rejector identity comes exclusively from the server-verified token + DB profile.
    // Client-supplied rejectorId / rejectorName are intentionally ignored.
    const result = await Application.reject(
      requestId,
      {
        uid,
        name: userProfile.fullName || userProfile.name || uid,
        role: userProfile.role,
      },
      reason
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    // ── Post-commit side effects (non-critical) ──────────────────────
    const fd = app.formData as any;
    const receiptImageUrl = fd.receiptImageUrl;

    // NOTE: Rejection email is already sent inside Application.reject().
    // Only Cloudinary cleanup remains as a route-level side effect.

    // Delete assets ONLY after transaction commit succeeds
    if (receiptImageUrl) {
      try {
        const publicId = extractPublicId(receiptImageUrl);
        if (publicId) await deleteAsset(publicId);
      } catch (cloudinaryError) {
        console.error('Error deleting payment proof from Cloudinary post-commit:', cloudinaryError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Renewal request rejected successfully'
    });

  } catch (error: any) {
    console.error('Error rejecting renewal request:', error);
    return NextResponse.json(
      { error: 'Failed to reject renewal request' },
      { status: 500 }
    );
  }
}

```

#### 6. General Application Approval Route: `src/app/api/applications/approve/route.ts`
```typescript
import { approve } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const { applicationId, notes, overrideBusId, sessionStartYear, sessionEndYear } = (body || {}) as any;
      if (!applicationId) return NextResponse.json({ error: 'Application ID required', requestId }, { status: 400 });

      const updaterInfo = await getUpdaterInfo(auth.uid);

      const permissionDenied = await requireModeratorPermission(
        {
          uid: auth.uid,
          email: auth.email || '',
          role: auth.role,
          name: updaterInfo.name || auth.name,
        },
        'applications',
        'canApprove',
        requestId
      );
      if (permissionDenied) return permissionDenied;

      const result = await approve(
        applicationId,
        {
          uid: auth.uid,
          name: updaterInfo.name || auth.name || 'Admin',
          role: auth.role,
        },
        notes,
        {
          busId: overrideBusId,
          startYear: sessionStartYear ? Number(sessionStartYear) : undefined,
          endYear: sessionEndYear ? Number(sessionEndYear) : undefined,
        }
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error, requestId }, { status: result.status || 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Application approved successfully',
        studentUid: result.studentUid,
        requestId,
      });
    } catch (error: any) {
      console.error('Approval error:', error);
      return NextResponse.json({ error: safeErrorMessage(error, 'Failed to approve application'), requestId }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.UPDATE,
  }
);

```

#### 7. General Application Rejection Route: `src/app/api/applications/reject/route.ts`
```typescript
import { reject } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const { applicationId, reason } = (body || {}) as any;

      if (!applicationId || !reason) {
        return NextResponse.json({ error: 'Missing required fields', requestId }, { status: 400 });
      }

      const updaterInfo = await getUpdaterInfo(auth.uid);

      const permissionDenied = await requireModeratorPermission(
        {
          uid: auth.uid,
          email: auth.email || '',
          role: auth.role,
          name: updaterInfo.name || auth.name,
        },
        'applications',
        'canReject',
        requestId
      );
      if (permissionDenied) return permissionDenied;

      // Audit identity comes from the verified session, never the body —
      // client-supplied rejectorName would let anyone forge the audit trail.
      const result = await reject(
        applicationId,
        {
          uid: auth.uid,
          name: updaterInfo.name || auth.name,
          role: auth.role,
        },
        reason
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error, requestId }, { status: result.status || 500 });
      }

      return NextResponse.json({ success: true, message: 'Application rejected', requestId });
    } catch (error: any) {
      console.error('Error rejecting application:', error);
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to reject application'), requestId },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.UPDATE,
  }
);

```

#### 8. Application Approval, Seat Reclamation & Side Effects: `src/domains/application/services/application.service.ts`
```typescript
// Lines 323-570: approve orchestration & atomic renewal seat allocation
 */
export async function approve(
  applicationId: string,
  approverData: { uid: string; name: string; role: string },
  notes?: string,
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<{ success: boolean; studentUid?: string; error?: string; status?: number }> {
  const db = getSupabaseServer();

  // ── Step 1: Application RPC — validate + lock + return payload ────
  const { data: rpcResult, error: rpcError } = await db.rpc('approve_application', {
    p_application_id: applicationId,
    p_approver_uid: approverData.uid,
  });

  if (rpcError || !rpcResult?.success) {
    return {
      success: false,
      error: rpcResult?.error || rpcError?.message,
      status: rpcResult?.status || 500,
    };
  }

  const app = rpcResult.application;

  // Intercept upcoming applications: verifying an upcoming application MUST NOT create a student
  // profile or consume bus capacity. It transitions state to 'verified_upcoming' only.
  if (isUpcomingApplication(app) && app.state === 'submitted') {
    try {
      await db.rpc('release_application_lock', { p_application_id: applicationId });
    } catch {}
    const verifyResult = await verifyUpcoming(applicationId, approverData, notes);
    if (!verifyResult.success) {
      return verifyResult;
    }
    return {
      success: true,
      studentUid: app.applicant_uid,
    };
  }

  const isRenewal = app.application_type === 'renewal' || app.application_type === 'renewal_after_soft_block';
  let seatCompensation: { busId: string; studentId: string; shift: string } | null = null;

  try {
    let studentData: Record<string, any> | null = null;
    let studentDataForRpc: Record<string, any> | null = null;
    let renewalAlreadyFinalized = false;

    if (isRenewal) {
      // ── RENEWAL PATH ──────────────────────────────────────────────
      // Use new atomic RPC: approve_renewal_with_seat handles capacity check +
      // seat increment + student update + application finalization in one TX.
      // Fixes race condition where concurrent renewals could over-allocate.
      const student = await Student.getByUid(app.applicant_uid);
      if (!student) throw new Error('Student not found for renewal');

      const fd = app.form_data || {};
      const durationYears = Number(fd.durationYears || fd.targetSession?.durationYears || 1);
      const now = new Date();
      const deadlineConfig = await getDeadlineConfig();

      // Compute renewal validity (max-of-old-and-new invariant)
      const existingValidUntil = (student as any).validUntil
        ? new Date((student as any).validUntil)
        : null;
      let baseYear = now.getUTCFullYear();
      if (existingValidUntil && existingValidUntil > now) {
        baseYear = (student as any).sessionEndYear || existingValidUntil.getUTCFullYear();
      }
      const newValidUntil = calculateValidUntilDate(baseYear, durationYears, deadlineConfig);
      const finalValidUntil = (existingValidUntil && existingValidUntil > newValidUntil)
        ? existingValidUntil
        : newValidUntil;
      const newSessionEndYear = baseYear + durationYears;
const finalSessionEndYear = ((student as any).sessionEndYear && (student as any).sessionEndYear > newSessionEndYear)
        ? (student as any).sessionEndYear
        : newSessionEndYear;
      const originalStartYear = (student as any).sessionStartYear || baseYear;
      const totalDuration = Math.max(finalSessionEndYear - originalStartYear, (student as any).durationYears || 0);
      const blockDates: { softBlock: string; hardBlock: string } = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);

      const seatWasReleased = !!(student as any).seatReleasedAt;
      const renewalBusId = overrides?.busId || (student as any).busId || (student as any).currentBusId || null;
      const studentShift = normalizeShift((student as any).shift || app.shift);
      if (!studentShift) {
        throw new Error('Student record is missing a valid shift assignment.');
      }

      let studentDataForRenewalRpc: Record<string, any> | null = null;

      // FIX (APP-04): If student's seat was released during soft-block, ANY renewal
      // must atomically reclaim capacity on the bus and clear seat_released_at.
      if (isRenewal && seatWasReleased && renewalBusId) {
        // Atomic RPC: capacity check + increment + student update + app finalize
        const { data: rpcResult, error: rpcError } = await db.rpc('approve_renewal_with_seat', {
          p_application_id: applicationId,
          p_approver_uid: approverData.uid,
          p_student_uid: app.applicant_uid,
          p_bus_id: renewalBusId,
          p_shift: studentShift,
          p_valid_until: finalValidUntil.toISOString(),
          p_session_end_year: finalSessionEndYear,
          p_session_duration: String(totalDuration),
          p_soft_block: (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as Date)?.toISOString()) || null,
          p_hard_block: (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as Date)?.toISOString()) || null,
        });

        if (rpcError || !rpcResult?.success) {
          throw new Error(rpcResult?.error || rpcError?.message || 'Renewal with seat assignment failed');
        }
        // RPC succeeded — student updated, capacity incremented, application finalized
        // No need to call finalize_application_approval separately
        studentDataForRpc = null; // Mark as already finalized
        renewalAlreadyFinalized = true; // Track that finalize_application_approval should be skipped
      } else {
        // Standard renewal (no seat reclamation): just finalize application
        studentDataForRpc = {
          valid_until: finalValidUntil.toISOString(),
          status: 'active',
          session_end_year: finalSessionEndYear,
          session_duration: String(totalDuration),
          soft_block: (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as Date)?.toISOString()) || null,
          hard_block: (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as Date)?.toISOString()) || null,
        };
      }

      studentData = {
        validUntil: finalValidUntil.toISOString(),
        sessionStartYear: (student as any).sessionStartYear || baseYear,
        sessionEndYear: finalSessionEndYear,
        durationYears: totalDuration,
      };
    } else {
      // ── FRESH APPLICATION PATH ────────────────────────────────────
      studentData = await buildStudentData(app, approverData, overrides);

      const targetBusId = overrides?.busId || studentData.busId || app.bus_id;
      const studentShift = normalizeShift(studentData.shift || app.shift);
      if (!studentShift) {
        throw new Error('Application is missing a valid shift assignment.');
      }

      if (targetBusId) {
      // ── ATOMIC: capacity check + increment + identity activation in one DB transaction ──
      // Previously this was two separate RPCs (bus_increment_capacity → identity_activate_student)
      // with a code-level compensating decrement on failure. A process crash between the two
      // would permanently increment bus capacity with no student enrolled (phantom seat leak).
      // identity_activate_student_with_capacity fuses both into a single plpgsql transaction,
      // matching the pattern already used by approve_renewal_with_seat for the renewal path.
      const { data: atomicResult, error: atomicError } = await db.rpc('identity_activate_student_with_capacity', {
        p_bus_id: targetBusId,
        p_shift: studentShift,
        p_uid: app.applicant_uid,
        p_email: app.email || app.applicant_email,
        p_full_name: app.form_data?.fullName || null,
        p_student_data: studentData,
      });

      if (atomicError) {
        console.error('identity_activate_student_with_capacity RPC error:', atomicError);
        throw new Error(`Student activation with capacity failed: ${atomicError.message || atomicError.code}`);
      }

      if (!atomicResult?.success) {
        console.error('identity_activate_student_with_capacity returned failure:', atomicResult?.error);
        throw new Error(atomicResult?.error || 'Student activation with capacity failed');
      }

      seatCompensation = { busId: targetBusId, studentId: app.applicant_uid, shift: studentShift };
    } else {
      // No bus assigned (e.g. walk-in or bus-less application) — activate identity only.
      const { data: identityResult, error: identityError } = await db.rpc('identity_activate_student', {
        p_uid: app.applicant_uid,
        p_email: app.email || app.applicant_email,
        p_full_name: app.form_data?.fullName || null,
        p_student_data: studentData,
      });

      if (identityError) {
        console.error('identity_activate_student RPC error:', identityError);
        throw new Error(`Identity activation failed: ${identityError.message || identityError.code}`);
      }

      if (!identityResult?.success) {
        throw new Error('Identity activation failed');
      }
    }

    // Identity now owns this user — the transient unauth_users row is
    // superseded. Best-effort delete (45-day TTL cron is the fallback).
    await deleteUnauthUser(app.applicant_uid).catch(() => {});
  }

  // ── Step 2: Finalize application — atomic commit ────────────────
  // C3: For renewals, student update + idempotency marker + application
  // finalization happen in a single RPC (single DB transaction).
  // For fresh: deletes application. Identity already activated above.
  // Skip if renewal was already finalized by approve_renewal_with_seat RPC
  if (!renewalAlreadyFinalized) {
    const { data: finalizeResult, error: finalizeError } = await db.rpc('finalize_application_approval', {
      p_application_id: applicationId,
      p_approver_uid: approverData.uid,
      ...(studentDataForRpc ? { p_student_data: studentDataForRpc } : {}),
    });

    if (finalizeError) {
      console.error('finalize_application_approval RPC error:', finalizeError);
      throw new Error(`Application finalization failed: ${finalizeError.message || finalizeError.code}`);
    }

    if (!finalizeResult?.success) {
      throw new Error('Application finalization failed');
    }
  }

  // Step 2 committed successfully; clear compensating rollback flag
  seatCompensation = null;

  // ── Step 3: Side effects — AFTER finalize (non-critical) ───────
  // H4: Payment, audit, notification run last. Each is idempotent.
  if (studentData) {
    await postCommitApprovalSideEffects(app, studentData, approverData, isRenewal ? 'renewal' : 'new');
  }

  return { success: true, studentUid: app.applicant_uid };

} catch (error: any) {
  // C4: Compensating rollback — release seat if it was assigned before the failure
  if (seatCompensation) {
    await Seat.releaseSeat(seatCompensation.busId, seatCompensation.studentId, seatCompensation.shift)
      .catch(releaseErr => {
        console.error(`CRITICAL: Seat compensation failed for ${seatCompensation?.busId}/${seatCompensation?.studentId}:`, releaseErr);
      });
  }
  // Release lock — application still exists
  await db.rpc('release_application_lock', { p_application_id: applicationId });
  return { success: false, error: error.message, status: 500 };
}
}

/**
 * Approve an unauthenticated student's application.
 * Same orchestration as approve but with different data source.
 */
export async function approveUnauth(
  studentUid: string,
  moderatorData: { uid: string; name: string; role: string },

// Lines 584-675: reject orchestration & cleanup
 */
export async function reject(
  applicationId: string,
  rejectorData: { uid: string; name: string; role: string },
  reason: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const db = getSupabaseServer();

  // Step 1: Validate + lock + return payload
  const { data: rpcResult, error: rpcError } = await db.rpc('reject_application', {
    p_application_id: applicationId,
    p_rejector_uid: rejectorData.uid,
  });

  if (rpcError) {
    console.error('reject_application RPC error:', rpcError);
    return { success: false, error: rpcError.message, status: 500 };
  }

  if (!rpcResult?.success) {
    return { success: false, error: rpcResult?.error || 'Failed to reject application', status: rpcResult?.status || 400 };
  }

  const app = rpcResult.application;

  try {
    // Step 2: Finalize (delete / commit rejection state) in DB FIRST before external side effects
    const { data: finalizeResult, error: finalizeError } = await db.rpc('finalize_application_rejection', {
      p_application_id: applicationId,
      p_rejector_uid: rejectorData.uid,
    });

    if (finalizeError) {
      console.error('finalize_application_rejection RPC error:', finalizeError);
      throw new Error(finalizeError.message || 'Database error during rejection finalization');
    }

    if (!finalizeResult?.success) {
      throw new Error(finalizeResult?.error || 'Failed to finalize application rejection');
    }

    // Step 3a: Payment cleanup (idempotent, only after DB finalization)
    // H2: Payment operations go through Payment domain public API.
    if (app.payment_id) {
      try {
        const { rejectApplicationPayment } = await import('@/domains/payment');
        await rejectApplicationPayment(app.payment_id, {
          userId: rejectorData.uid,
          name: rejectorData.name,
          empId: '',
          role: rejectorData.role,
        });
      } catch (paymentError) {
        console.error('Failed to reject pending payment record:', paymentError);
      }
    }

    // Step 3b: Audit (idempotent)
    await createAuditEvent({
      category: 'applications',
      action: 'application_rejected',
      summary: `Application rejected: ${app.full_name || ''}`,
      severity: 'medium',
      actor_id: rejectorData.uid,
      actor_name: rejectorData.name,
      actor_role: rejectorData.role,
      target_type: 'application',
      target_id: app.applicant_uid,
      target_name: app.full_name || '',
      metadata: { reason },
    });

    // Step 3c: Notification (dispatched ONLY after database finalization succeeds)
    if (app.email || app.applicant_email) {
      const { sendApplicationRejectedNotification } = await import('@/lib/services/admin-email.service');
      await sendApplicationRejectedNotification({
        studentName: app.full_name || 'Student',
        studentEmail: app.email || app.applicant_email,
        reason,
        rejectedBy: rejectorData.name,
      }).catch(err => console.error('Rejection email failed:', err));
    }

    return { success: true };

  } catch (error: any) {
    await db.rpc('release_application_lock', { p_application_id: applicationId });
    return { success: false, error: error.message, status: 500 };
  }
}

/**

// Lines 863-970: postCommitApprovalSideEffects (offline payment creation)

async function postCommitApprovalSideEffects(
  app: any,
  studentData: Record<string, any>,
  approverData: { uid: string; name: string; role: string },
  applicationType?: 'new' | 'renewal'
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  const purpose: 'new_registration' | 'renewal' = applicationType === 'renewal' ? 'renewal' : 'new_registration';

  // Payment (online: idempotent via upsertPayment; offline: session-level duplicate check via createPayment)
  // H2: All payment operations go through Payment domain public API — no internal implementation leakage.
  const amount = Number(
    app.amount_paid ||
    app.form_data?.paymentInfo?.amountPaid ||
    app.form_data?.totalFee ||
    app.form_data?.amount ||
    0
  );
  if (amount > 0) {
    const paymentMode =
      app.payment_mode ||
      app.form_data?.paymentInfo?.paymentMode ||
      app.form_data?.paymentMode ||
      'offline';
    const studentIdVal = app.form_data?.enrollmentId || app.enrollment_id || app.enrollmentId || studentData.enrollmentId;
    const studentNameVal = app.form_data?.fullName || app.full_name || studentData.fullName;

    if (paymentMode === 'online') {
      tasks.push(
        import('@/domains/payment').then(({ upsertApprovalPayment }) =>
          upsertApprovalPayment({
            paymentId: app.payment_id || app.form_data?.paymentInfo?.razorpayPaymentId || `pay_${Date.now()}`,
            studentId: studentIdVal,
            studentUid: app.applicant_uid,
            studentName: studentNameVal,
            amount,
            method: 'Online',
            status: 'Completed',
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            durationYears: studentData.durationYears,
            validUntil: studentData.validUntil
              ? new Date(studentData.validUntil)
              : new Date(Date.UTC(studentData.sessionEndYear || (new Date().getFullYear() + 1), 5, 30, 23, 59, 59, 999)),
            razorpayPaymentId: app.form_data?.paymentInfo?.razorpayPaymentId || app.payment_id,
            razorpayOrderId: app.form_data?.paymentInfo?.razorpayOrderId,
            approvedAt: new Date(),
          })
        ).catch(err => { console.error('Payment upsert failed:', err); })
      );
    } else {
      tasks.push(
        import('@/domains/payment').then(({ createOfflinePaymentAtApproval }) =>
          createOfflinePaymentAtApproval({
            studentId: studentIdVal,
            studentUid: app.applicant_uid,
            studentName: studentNameVal,
            amount,
            durationYears: studentData.durationYears,
            sessionStartYear: studentData.sessionStartYear,
            sessionEndYear: studentData.sessionEndYear,
            validUntil: studentData.validUntil || new Date(Date.UTC(studentData.sessionEndYear || (new Date().getFullYear() + 1), 5, 30, 23, 59, 59, 999)).toISOString(),
            transactionId: app.form_data?.paymentInfo?.paymentReference || app.form_data?.transactionId || '',
            paidAt: app.form_data?.paymentInfo?.paidAt || app.form_data?.paidAt
              ? new Date(app.form_data?.paymentInfo?.paidAt || app.form_data?.paidAt)
              : new Date(),
            receipt: app.form_data?.paymentInfo?.paymentEvidenceUrl || app.form_data?.receiptImageUrl || '',
            approverUserId: approverData.uid,
            approverName: approverData.name,
            approverEmpId: '',
            approverRole: approverData.role,
            purpose,
          })
        ).catch(err => { console.error('Payment creation failed:', err); })
      );
    }
  }

  // Audit (idempotent)
  tasks.push(
    createAuditEvent({
      category: 'applications',
      action: 'application_approved',
      summary: `Application approved: ${app.full_name || ''}`,
      severity: 'high',
      actor_id: approverData.uid,
      actor_name: approverData.name,
      actor_role: approverData.role,
      target_type: 'student',
      target_id: app.applicant_uid,
      target_name: app.full_name || '',
      metadata: { applicationId: app.application_id },
    })
  );

  // Notification (idempotent)
  tasks.push(
    Notification.createNotification(
      { userId: 'system', userName: 'System', userRole: 'admin' },
      { type: 'specific_users', specificUserIds: [app.applicant_uid] },
      'Your bus service application has been approved.',
      'Application Approved',
      { applicationId: app.application_id }
    ).catch(err => { console.error('Notification failed:', err); })
  );

  await Promise.allSettled(tasks);
```

#### 9. Offline Payment Creation at Approval & ID Generation: `src/lib/payment/payment.service.ts` & `src/lib/types/payment.ts`
```typescript
// src/lib/payment/payment.service.ts: createOfflinePaymentAtApproval (Lines 771-860)
 */
export async function createOfflinePaymentAtApproval(
    request: {
        studentId: string;
        studentUid: string;
        studentName: string;
        amount: number;
        durationYears: number;
        sessionStartYear: number;
        sessionEndYear: number;
        validUntil: string;
        /** Student's submitted transaction reference (verified by admin) */
        transactionId: string;
        /** Student's submitted payment date/time (verified by admin) */
        paidAt: Date;
        /** Receipt URL (verified by admin) */
        receipt?: string;
        /** Approver details */
        approverUserId: string;
        approverName: string;
        approverEmpId: string;
        approverRole: string;
        /** Purpose: new_registration or renewal */
        purpose: 'new_registration' | 'renewal';
    }
): Promise<OfflinePaymentDocument> {
    const paymentId = generateOfflinePaymentId(request.purpose);
    const now = new Date();

    // Build the payment document for return
    const paymentDoc: OfflinePaymentDocument = {
        paymentId,
        studentId: request.studentId,
        studentUid: request.studentUid,
        studentName: request.studentName,
        amount: request.amount,
        durationYears: request.durationYears,
        method: 'Offline',
        status: 'Completed',
        sessionStartYear: request.sessionStartYear,
        sessionEndYear: request.sessionEndYear,
        validUntil: request.validUntil,
        createdAt: now,
        updatedAt: now,
        offlineTransactionId: request.transactionId,
        approvedBy: {
            type: 'Manual',
            userId: request.approverUserId,
            name: request.approverName,
            empId: request.approverEmpId,
            role: request.approverRole as 'Admin' | 'Moderator',
        },
        approvedAt: now,
    };

    // Write COMPLETED payment to Supabase (immutable financial record)
    const result = await paymentsSupabaseService.createPayment({
        paymentId,
        studentId: request.studentId,
        studentUid: request.studentUid,
        studentName: request.studentName,
        amount: request.amount,
        method: 'Offline',
        status: 'Completed',
        sessionStartYear: request.sessionStartYear,
        sessionEndYear: request.sessionEndYear,
        durationYears: request.durationYears,
        validUntil: new Date(request.validUntil),
        transactionDate: request.paidAt,
        offlineTransactionId: request.transactionId,
        approvedBy: {
            type: 'Manual',
            userId: request.approverUserId,
            name: request.approverName,
            empId: request.approverEmpId,
            role: request.approverRole,
        },
        approvedAt: now,
    });

    if (!result) {
        throw new Error(`Failed to create offline payment ledger record at approval: ${paymentId}`);
    }

    return paymentDoc;
}

export async function applyPaymentValidityToStudent(payment: PaymentRecord): Promise<void> {
    if (!payment.student_uid) return;


// src/lib/types/payment.ts: generateOfflinePaymentId & generateOnlinePaymentId (Lines 365-388)
 * Generate a unique payment ID for offline payments
 */
export function generateOfflinePaymentId(purpose: 'new_registration' | 'renewal' = 'new_registration'): string {
    const timestamp = Date.now();
    const random = getSecureRandomString(8);
    const prefix = purpose === 'new_registration' ? 'OADF_' : 'ORTF_';
    return `${prefix}${timestamp}_${random}`;
}

/**
 * Generate a unique payment ID for online payments
 */
export function generateOnlinePaymentId(purpose: 'new_registration' | 'renewal' = 'new_registration'): string {
    const timestamp = Date.now();
    const random = getSecureRandomString(8);
    const prefix = purpose === 'new_registration' ? 'OADN_' : 'ORTN_';
    return `${prefix}${timestamp}_${random}`;
}

/**
 * Format approver display string
 */
export function formatApproverDisplay(approver: PaymentApprover): string {
    if (approver.type === 'SYSTEM') {
```

---

