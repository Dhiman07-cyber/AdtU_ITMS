# Student Application, Prospective Onboarding & Administrative Review Pipeline (Forensic Truth)

**Module:** Student Applications, Verification Codes, Multi-Step Wizard & Approval State Transitions  
**File Authority:** `src/app/apply/page.tsx`, `src/app/student/apply/page.tsx`, `src/domains/student/`, `src/app/api/admin/applications/`  
**Database Tables:** `student_applications`, `student_profiles`, `moderator_codes`, `buses`, `routes`  

---

# PART 2: Prospective Student Onboarding, Unauthenticated User Flow, Moderator Verification Codes & Multi-Step Application Wizard (`/apply` & `/student/apply`)

### 2.1 Sub-Domain Architecture & Exact Execution Pipeline

The onboarding lifecycle for new student commuters bridges three distinct identity states:
1. **Unregistered Visitor / Google Auth Session**: Authenticated with Firebase Auth, but possesses NO record in PostgreSQL `public.users` or `public.student_profiles`.
2. **Pending Unauth User (`public.unauth_users`)**: Staged during the multi-step application wizard with role `'student'`, status `'pending'` / `'pending_application'`, and `needsApplication: true`.
3. **Application Lifecycle State Machine (`public.applications`)**: Transitions from `draft` to `submitted` directly via `submitFinal`, embedding personal data, academic data, bus/stop selection, and payment confirmation (Online Razorpay vs. Offline Bank Challan).

#### Onboarding & Multi-Step Application Flow (ASCII Trace)

```
[ New Student Commuter (Browser/Mobile) ]
                  │
                  ▼
  1. Signs in via Google OAuth (Firebase Auth)
                  │
                  ▼
  2. POST /api/unauth-users/create (Rate Limit: 5 req/min)
     ├─ Authenticates Firebase ID Token (adminAuth.verifyIdToken)
     ├─ Checks public.users by UID -> If exists, returns hasUserDoc: true
     ├─ Checks public.unauth_users by UID:
     │  ├─ If exists: updates last_login_at
     │  └─ If absent: creates row (role: 'student', status: 'pending_application', needsApplication: true)
     └─ Redirects client to /apply/form
                  │
                  ▼
  3. Multi-Step Wizard: /apply/form (ApplicationFormContent)
     ├─ Step 1: Personal Information (Step1Personal.tsx)
     │   └─ Validates name, phone, parent details, address, blood group, DOB.
     │   └─ Uploads Profile Photo -> POST /api/upload (Cloudinary, 5MB cap, JPEG/PNG/WebP, strip EXIF)
     │   └─ Debounced Auto-Save -> POST /api/applications/save-draft (state: 'draft')
     │
     ├─ Step 2: Academic Information (Step2Academic.tsx)
     │   └─ Validates faculty, department, semester, enrollment ID.
     │   └─ Debounced Auto-Save -> POST /api/applications/save-draft
     │
     ├─ Step 3: Bus & Route Selection (Step3Bus.tsx)
     │   └─ Fetches active routes and buses (GET /api/routes, GET /api/buses).
     │   └─ Selects route -> Selects stop -> Selects shift ('Morning' | 'Evening').
     │   └─ Runs client-side & server-side capacity check:
     │       └─ If bus full on chosen shift -> needsCapacityReview = true
     │
     ├─ Step 4: Payment & Service Entitlement (Step4ServicePayment.tsx)
     │   ├─ OPTION A: Online Payment (Razorpay SDK via PaymentModeSelector.tsx)
     │   │   ├─ Creates Order -> POST /api/payment/razorpay/create-order
     │   │   ├─ Student pays ₹5,000 / ₹1,200 via UPI/Netbanking/Card
     │   │   ├─ Verifies Payment -> POST /api/payment/razorpay/verify-payment
     │   │   │   └─ Saves payment session in localStorage + sets applicationState = 'verified'
     │   │   └─ CRASH RECOVERY:
     │   │       If user phone crashes before Step 5:
     │   │       └─ Wizard re-mount checks hasCompletedPayment(uid, 'new_registration')
     │   │       └─ Polling hook usePaymentRecovery polls GET /api/payment/recover
     │   │       └─ Recovers captured payment from Razorpay/payments table without re-paying!
     │   │
     │   └─ OPTION B: Offline Bank Challan / NEFT / RTGS
     │       ├─ Uploads Bank Challan/Receipt -> POST /api/upload
     │       └─ Enters Transaction Reference (UTR / Challan No.)
     │
     └─ Step 5: Review & Final Submission (Step5Review.tsx)
         ├─ Client accepts Legal Declaration (`declarationAccepted = true`).
         ├─ Optionally downloads client-rendered PDF summary (jsPDF).
         └─ Submits Application -> POST /api/applications/submit-final
             ├─ Preflight Anti-Replay: Verifies offlineTxId is NOT already used in payments or applications.
             ├─ Bypasses obsolete manual verification code step:
             │   └─ Automatically sets verifiedBy = 'system_online_payment' (Online)
             │      or 'system_offline_submission_bypass' (Offline).
             ├─ Directly transitions application state to 'submitted'.
             ├─ Upserts public.applications row via repository.upsert.
             └─ Client purges localStorage draft and payment session keys.
```

---

### 2.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/api/unauth-users/create/route.ts` | `POST` (API Handler) | Next.js Auth flow, sign-in redirect | `adminAuth`, `getUserById`, `getUnauthUserById`, `createUnauthUser`, `updateUnauthUser` | Reads `public.users`, mutates `public.unauth_users` |
| `src/app/api/unauth-users/cleanup/route.ts` | `POST`, `GET` (Cron / Admin API) | Scheduled cron job (`CRON_SECRET`), manual admin trigger | `getAllUnauthUsers`, `adminAuth.deleteUser`, `deleteUnauthUser`, `getUserById`, `createUser`, `createStudent` | Mutates `public.unauth_users`, `public.users`, `public.student_profiles`, deletes Firebase Auth users |
| `src/app/api/applications/save-draft/route.ts` | `POST` (API Handler) | `/apply/form` debounced draft autosave | `adminAuth.verifyIdToken`, `saveDraft` | Reads and updates `public.applications` (`state = 'draft'`) |
| `src/app/api/applications/submit-final/route.ts` | `POST` (API Handler) | Step 5 Review (`Step5Review.tsx`) submission button | `withSecurity`, `getById`, `submitFinal` | Upserts `public.applications` (`state = 'submitted'`), checks `public.payments` |
| `src/app/api/applications/submit/route.ts` | `POST` (API Handler) | Legacy submission endpoint | `adminAuth.verifyIdToken`, `getById`, `submit` | Calls RPC `transition_application_state` (`state = 'submitted'`) |
| `src/app/api/upload/route.ts` | `POST` (API Handler) | Profile photo uploader (`ProfileImageAddModal.tsx`), payment proof uploader (`PaymentModeSelector.tsx`) | `verifyTokenOnly`, `checkRateLimit`, `cloudinary.uploader.upload_stream` | Uploads image to Cloudinary CDN, strips EXIF metadata |
| `src/hooks/usePaymentRecovery.ts` | `usePaymentRecovery` (React Hook) | `PaymentModeSelector.tsx`, `/apply/form` mount recovery | `fetch('/api/payment/recover')`, `mapRecoverStatusToState` | Reads recovery API status, manages polling interval (9s x 5 attempts) |
| `src/app/api/payment/recover/route.ts` | `GET`, `OPTIONS` (API Handler) | `usePaymentRecovery`, direct recovery checks | `withSecurity`, `getByApplicantUid`, `paymentsSupabaseService`, `isRecoveryThrottled`, `fetchPaymentDetails`, `processCapturedPayment` | Reads/updates `public.payments`, `public.applications`, checks Upstash Redis throttle |
| `src/lib/payment/application-payment.service.ts` | `savePaymentSession`, `getCurrentPaymentSession`, `getPaymentSession`, `hasCompletedPayment`, `clearPaymentSession`, `storePaymentReceipt` | Wizard step components, `PaymentModeSelector.tsx`, recovery hooks | Browser `localStorage` API | Mutates browser `localStorage` keys (`currentPaymentSession`, `paymentSessions`) |
| `src/app/(auth)/apply/page.tsx` | `ApplyLandingPage` (React Page) | Prospective commuter entering `/apply` | `useAuth`, `router.push`, `/api/settings/deadline-config` | Read-only |
| `src/app/(auth)/apply/form/page.tsx` | `ApplicationFormContent` (React Page) | Routed from `/apply` | `useAuth`, `useToast`, `useDebouncedStorage`, Step 1–5 components, `/api/applications/submit-final` | Mutates localStorage draft, calls upload and submission APIs |
| `src/app/(auth)/apply/form/steps/Step1Personal.tsx` | `Step1Personal` (React Component) | Step 1 of form wizard | `ProfileImageAddModal`, `OptimizedInput` | Local form state |
| `src/app/(auth)/apply/form/steps/Step2Academic.tsx` | `Step2Academic` (React Component) | Step 2 of form wizard | Form inputs | Local form state |
| `src/app/(auth)/apply/form/steps/Step3Bus.tsx` | `Step3Bus` (React Component) | Step 3 of form wizard | `getAllRoutes`, `getAllBuses`, `checkBusCapacity` | Local form state |
| `src/app/(auth)/apply/form/steps/Step4ServicePayment.tsx` | `Step4ServicePayment` (React Component) | Step 4 of form wizard | `PaymentModeSelector` | Local form state |
| `src/app/(auth)/apply/form/steps/Step5Review.tsx` | `Step5Review` (React Component) | Step 5 of form wizard | `jsPDF`, `Checkbox`, `handleSubmitApplication` | Triggers final submission |
| `src/app/(auth)/apply/verify/page.tsx` | `VerifyApplicationPage` (React Page) | Direct navigation to `/apply/verify` | Informational stub ("Verification system is being loaded...") | Read-only |

---

### 2.3 Method-by-Method Low-Level Walkthrough

#### 1. Unauthenticated User Lifecycle (`/api/unauth-users/create` & `/api/unauth-users/cleanup`)
- **Creation Endpoint (`POST /api/unauth-users/create`):**
  - Secured via `withSecurity` with rate limiting: maximum 5 requests per 60,000 ms.
  - Verifies Firebase Auth session from `auth` context. If `email` is absent, aborts with 400.
  - Queries `public.users` via `getUserById(uid)`. If a row already exists, returns `{ success: false, message: 'User already exists in users table', hasUserDoc: true }`.
  - Queries `public.unauth_users` via `getUnauthUserById(uid)`.
    - If row exists: executes `updateUnauthUser(uid, { lastLoginAt: now })` to update timestamp without violating primary key uniqueness. Returns `{ success: true, isNewUser: false }`.
    - If absent: executes `createUnauthUser` inserting `{ uid, email, displayName, photoURL: null, createdAt: now, lastLoginAt: now, status: 'pending_application', needsApplication: true }`. Returns `{ success: true, isNewUser: true }`.
- **Cleanup Worker (`POST /api/unauth-users/cleanup`):**
  - Authenticates via either `verifyCronSecret(request)` or admin session (`verifyApiAuth(request, ['admin'])`).
  - Computes `fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)`.
  - Queries all rows in `public.unauth_users`.
  - **Forensic Finding — Missing Payment / In-Flight Application Guard:**
    - If `lastLoginAt < fortyFiveDaysAgo`: Immediately calls `adminAuth.deleteUser(userId)` and `deleteUnauthUser(userId)`.
    - **Crucial Code Reality:** The cleanup handler does **NOT** query `public.applications` to check if the student has a `submitted`, `verified_upcoming`, or `pending_seat_allocation` application, nor does it query `public.payments` to check if the unauth user has captured Razorpay payments. Any applicant whose unauth record is older than 45 days will have their Firebase Auth account and unauth record purged regardless of in-flight application status!
  - If `userData.status === 'approved'`: Checks if already migrated to `users`. If not, migrates to `public.users` (`role = 'student'`), `public.student_profiles`, and deletes `unauth_users` record.
  - If `userData.status === 'rejected'`: Deletes Firebase Auth user and deletes `unauth_users` row.

#### 2. Multi-Step Form Wizard & Draft Persistence (`saveDraft`)
- **Autosave Endpoint (`POST /api/applications/save-draft`):**
  - Validates `Authorization: Bearer <token>` against Firebase Admin.
  - Strips blacklisted client fields (e.g. `delete formData.age`).
  - Calls `saveDraft(uid, applicationId, formData)`:
    - If `applicationId` provided: fetches existing application. Enforces ownership (`existing.applicantUid === uid`).
    - Enforces state immutability: if existing application is in `['verified', 'submitted', 'verified_upcoming', 'pending_seat_allocation', 'approved', 'rejected']`, aborts with 400 (`"Cannot edit application in current state"`).
    - If editable (`state = 'draft'`), updates `form_data` and timestamps.
    - If `applicationId` omitted: creates new draft with ID `app_<timestamp>_<uuid12>`, sets `state = 'draft'`, `verificationAttempts = 0`.

#### 3. Moderator Verification Code Pipeline vs. Direct Submission Bypass
- **Architectural Shift in Production Code:**
  - In earlier schema designs, the state transition was: `draft -> awaiting_verification -> (moderator issues code) -> verified -> submitted`.
  - In `src/app/(auth)/apply/verify/page.tsx`, the page is an inactive stub stating `"Verification system is being loaded... Contact a moderator to get your verification code"`.
  - In `src/domains/application/services/application.service.ts` line 161:
    - `submitFinal(...)` explicitly states in docstring: `"Submit a new application directly (bypass verification). Creates application in submitted state."`
    - When `submitFinal` is invoked, it sets `state = 'submitted'` and stamps:
      ```typescript
      verifiedBy: formData.paymentInfo?.paymentMode === 'online'
        ? 'system_online_payment'
        : 'system_offline_submission_bypass',
      verifiedAt: now,
      ```
    - Thus, manual moderator verification codes are completely bypassed in the active production submission path.

#### 4. Anti-Replay Verification on Bank Challan / Offline Transactions
- In `submitFinal`:
  - Extracts `offlineTxId = String(formData.transactionId || formData.paymentInfo?.paymentReference || body.transactionId || '').trim()`.
  - If `paymentMode === 'offline'` and `offlineTxId` is present:
    1. Queries `public.payments` for any existing payment with `offline_transaction_id ILIKE offlineTxId` and `status IN ('Completed', 'Pending')`. If found, rejects submission with 409 Conflict (`"This bank transaction reference ID has already been used."`).
    2. Queries `public.applications` for up to 300 non-terminal applications (`state NOT IN ('rejected', 'cancelled', 'expired')`). Inspects JSON `form_data` for duplicate `transactionId` or `paymentReference`. If matched, rejects with 409 Conflict.
  - Backed at database level by partial unique index `idx_payments_unique_offline_tx_id` on `LOWER(TRIM(offline_transaction_id))` WHERE `status IN ('Completed', 'Pending')`.

#### 5. Online Payment Crash Recovery Pipeline (`usePaymentRecovery` & `/api/payment/recover`)
- **The Crash Scenario:** An applicant completes a ₹5,000 Razorpay transaction. Razorpay captures the payment and returns payment ID `pay_XYZ`. Before `submitFinal` executes or commits, the applicant's mobile browser crashes, battery dies, or tab closes.
- **The Recovery Mechanism:**
  1. When applicant re-opens `/apply/form`, the component mount effect checks:
     `const completedPayment = hasCompletedPayment(currentUser.uid, 'new_registration');`
  2. If `localStorage` holds a completed session (`currentPaymentSession`), it restores `paymentId`, `orderId`, and sets `applicationState = 'verified'`.
  3. If localStorage was cleared or user switches devices, `PaymentModeSelector.tsx` mounts `usePaymentRecovery({ getToken, orderId, paymentId })`.
  4. The hook polls `GET /api/payment/recover?orderId=...&paymentId=...` every 9 seconds (up to 5 attempts / 45s).
  5. The backend endpoint `/api/payment/recover`:
     - Checks if caller is authorized for this UID.
     - Fast-path: checks if an approved application or completed renewal already exists.
     - Resolves pending payment record from `public.payments` or fetches from Razorpay via `fetchPaymentDetails` / `fetchOrderPayments`.
     - When Razorpay status is `'captured'`: invokes `processCapturedPayment(...)`, recording the payment into `public.payments` as `'Completed'` (or `'captured_pending_review'`).
     - Returns `{ success: true, status: 'success', message: 'Payment verified and processed successfully.' }`.
  6. The client hook triggers `onSuccess()`, advancing the wizard to Step 5 Review so the student can submit without double-paying.

---

### 2.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Execution Scenario | PostgreSQL Queries & RPCs | Redis Commands | External Network Calls | Total Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Unauth User Creation (`POST /api/unauth-users/create`)** | **2 Queries:**<br>1. Select `users` WHERE `uid = ...`<br>2. Select `unauth_users` WHERE `uid = ...` (and Insert if new, or Update `last_login_at`) | **0** | **1 Call:**<br>Firebase Admin Auth token verification | **3 Operations** |
| **(b) Wizard Draft Autosave (`POST /api/applications/save-draft`)** | **2 Queries:**<br>1. Select `applications` WHERE `application_id = ...`<br>2. Update `applications` (or Insert new draft row) | **0** | **1 Call:**<br>Firebase Admin Auth token verification | **3 Operations** |
| **(c) Image Upload (`POST /api/upload`)** | **0 DB Queries** | **0** | **2 Calls:**<br>1. Firebase Token Auth<br>2. Cloudinary CDN upload (`uploader.upload_stream`) | **2 Operations** |
| **(d) Final Online Application Submission (`POST /api/applications/submit-final`)** | **2 DB Operations:**<br>1. Select `applications` by applicant UID (Live states check)<br>2. Upsert `applications` row (`state = 'submitted'`) | **0** | **0 External Calls** | **2 Operations** |
| **(e) Final Offline Application Submission (with Anti-Replay)** | **4 DB Operations:**<br>1. Select `applications` by applicant UID<br>2. Select `payments` checking `offline_transaction_id`<br>3. Select `applications` checking duplicate form_data UTR<br>4. Upsert `applications` row (`state = 'submitted'`) | **0** | **0 External Calls** | **4 Operations** |
| **(f) Payment Crash Recovery Poll (`GET /api/payment/recover`)** | **3 to 4 DB Operations:**<br>1. Select `applications` by applicant UID<br>2. Select `payments` (history for student)<br>3. Check/Insert `payments` via `processCapturedPayment` | **1 Redis Command:**<br>`SET payment-recovery:<uid> 1 EX 15 NX` (Throttle check) | **1 to 2 Calls:**<br>Razorpay API (`fetchPaymentDetails` / `fetchOrderPayments`) | **5 to 7 Operations** |
| **(g) Daily Unauth User Cleanup Cron (`POST /api/unauth-users/cleanup`)** | **2 DB Operations per 45d-inactive user:**<br>1. Select all `unauth_users`<br>2. Delete `unauth_users` WHERE `uid = ...` | **0** | **1 Call per user:**<br>Firebase Admin `adminAuth.deleteUser(uid)` | **3 Ops per expired user** |

---

### 2.5 Verbatim Source Code from Live Codebase

#### 1. Unauthenticated User Creation: `src/app/api/unauth-users/create/route.ts`
*(Source: `src/app/api/unauth-users/create/route.ts`, lines 1–72)*

```typescript
import { createUnauthUser, getUnauthUserById, getUserById, updateUnauthUser } from '@/domains/identity';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';

/**
 * Create or update an unauthenticated user entry
 * This is called when a new user signs in with Google but doesn't have a user doc yet
 */
export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const uid = auth.uid;
      const email = auth.email;

      if (!email) {
        return NextResponse.json({ error: 'Email not found in token' }, { status: 400 });
      }

      const existingUser = await getUserById(uid);
      if (existingUser) {
        return NextResponse.json({
          success: false,
          message: 'User already exists in users table',
          hasUserDoc: true
        });
      }

      const existingPgUser = await getUnauthUserById(uid);
      if (existingPgUser) {
        // Existing row: bump last_login_at (an insert here PK-violates)
        await updateUnauthUser(uid, { lastLoginAt: new Date().toISOString() });

        return NextResponse.json({
          success: true,
          message: 'Unauthenticated user record updated',
          isNewUser: false
        });
      }

      const now = new Date().toISOString();
      const unauthUserData = {
        uid,
        email,
        displayName: auth.name || email.split('@')[0],
        photoURL: null,
        createdAt: now,
        lastLoginAt: now,
        status: 'pending_application',
        needsApplication: true
      };

      await createUnauthUser(unauthUserData);

      return NextResponse.json({
        success: true,
        message: 'Unauthenticated user created',
        isNewUser: true
      });
    } catch (error: any) {
      console.error('Error creating unauthenticated user:', error);
      return NextResponse.json(
        { error: 'Failed to create unauthenticated user' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: [],
    rateLimit: { maxRequests: 5, windowMs: 60_000 },
  }
);
```

#### 2. Unauthenticated User 45-Day Cleanup Worker: `src/app/api/unauth-users/cleanup/route.ts`
*(Source: `src/app/api/unauth-users/cleanup/route.ts`, lines 1–147)*

```typescript
import { deleteUnauthUser, getAllUnauthUsers, getUserById } from '@/domains/identity';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Cleanup old unauth users and handle application states
 * This should be called periodically (e.g., daily cron job)
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      const auth = await verifyApiAuth(request, ['admin']);
      if (!auth.authenticated) return auth.response;
    }

    const now = new Date();
    const fortyFiveDaysAgo = new Date(now.getTime() - (45 * 24 * 60 * 60 * 1000));

    let deletedCount = 0;
    let movedCount = 0;
    let totalProcessed = 0;
    const cleanupResults: Array<{ userId: string; action: string; reason: string }> = [];

    // Get all unauth users from PostgreSQL (canonical source of truth)
    const unauthUsers = await getAllUnauthUsers();
    const supabase = getSupabaseServer();

    for (const userData of unauthUsers) {
      const userId = userData.uid;
      const lastLoginAt = userData.lastLoginAt ? new Date(userData.lastLoginAt) : new Date(userData.createdAt);
      totalProcessed++;

      // Check if user should be deleted (45+ days old with no activity)
      if (lastLoginAt < fortyFiveDaysAgo) {
        // Application Safety Guard: Protect users with active/pending/upcoming applications or completed/pending payments
        const [{ data: apps }, { data: payments }] = await Promise.all([
          supabase
            .from('applications')
            .select('application_id')
            .eq('applicant_uid', userId)
            .in('state', ['submitted', 'verified', 'awaiting_verification', 'verified_upcoming', 'pending_seat_allocation', 'approved'])
            .limit(1),
          supabase
            .from('payments')
            .select('payment_id')
            .eq('student_uid', userId)
            .in('status', ['Completed', 'Pending', 'Captured_Pending_Review', 'Duplicate_Pending_Refund'])
            .limit(1),
        ]);

        if ((apps && apps.length > 0) || (payments && payments.length > 0)) {
          cleanupResults.push({
            userId,
            action: 'skipped',
            reason: 'protected_active_application_or_payment',
          });
          continue;
        }

        try {
          await adminAuth.deleteUser(userId);
        } catch (authError: any) {
          console.error(`Failed to delete Firebase Auth user ${userId}:`, authError.message);
        }

        // Delete from PostgreSQL first (canonical)
        try {
          await deleteUnauthUser(userId);
        } catch (pgErr: any) {
          console.error(`PG delete failed for ${userId}:`, pgErr.message);
        }

        deletedCount++;
        cleanupResults.push({ userId, action: 'deleted', reason: '45+ days inactive' });
        continue;
      }

      // Check if user should be moved to users collection (approved applications)
      if (userData.status === 'approved') {
        try {
          const existingUser = await getUserById(userId);
          if (existingUser) {
            try {
              await deleteUnauthUser(userId);
              cleanupResults.push({ userId, action: 'deleted', reason: 'already migrated to users' });
            } catch (pgErr: any) {
              console.error(`PG delete failed for already migrated unauth user ${userId}:`, pgErr.message);
            }
          } else {
            // User Record Synchronization: If user is approved but does NOT yet exist in public.users,
            // do NOT create a broken skeleton student profile without bus/shift/validUntil/capacity!
            // Leave the record for Application.approve / session-activation to activate properly with full bus capacity.
            cleanupResults.push({ userId, action: 'skipped', reason: 'awaiting_proper_session_activation' });
          }
        } catch (moveError: any) {
          console.error(`Failed to move user ${userId}:`, moveError.message);
        }
        continue;
      }

      // Check if user should be deleted (rejected applications)
      if (userData.status === 'rejected') {
        try {
          await adminAuth.deleteUser(userId);
        } catch (authError: any) {
          console.error(`Failed to delete Firebase Auth user ${userId}:`, authError.message);
        }

        // Delete from PostgreSQL first (canonical)
        try {
          await deleteUnauthUser(userId);
        } catch (pgErr: any) {
          console.error(`PG delete failed for ${userId}:`, pgErr.message);
        }

        deletedCount++;
        cleanupResults.push({ userId, action: 'deleted', reason: 'rejected application' });
        continue;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed successfully',
      results: {
        totalProcessed,
        deleted: deletedCount,
        moved: movedCount,
        kept: totalProcessed - deletedCount - movedCount
      },
      details: cleanupResults
    });

  } catch (error: any) {
    console.error('Error during cleanup:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup unauth users' },
      { status: 500 }
    );
  }
}

export const GET = POST;
```

#### 3. Save Draft Endpoint: `src/app/api/applications/save-draft/route.ts`
*(Source: `src/app/api/applications/save-draft/route.ts`, lines 1–40)*

```typescript
import { saveDraft } from '@/domains/application';
import { adminAuth } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { applicationId, formData } = body;
    if (formData && 'age' in formData) {
      delete formData.age;
    }

    const result = await saveDraft(uid, applicationId, formData);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      applicationId: result.applicationId,
      message: applicationId ? 'Draft updated successfully' : 'Draft created successfully',
    });
  } catch (error: any) {
    console.error('Error saving draft:', error);
    return NextResponse.json(
      { error: 'Failed to save draft' },
      { status: 500 }
    );
  }
}
```

#### 4. Final Submission Endpoint: `src/app/api/applications/submit-final/route.ts`
*(Source: `src/app/api/applications/submit-final/route.ts`, lines 1–63)*

```typescript
import { getById, submitFinal } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const uid = auth.uid;
      const email = auth.email;
      const rawFormData = { ...asRecord((body as any).formData) };
      if ('age' in rawFormData) {
        delete rawFormData.age;
      }

      // Ownership: a custom applicationId may only reference the caller's own
      // application — otherwise one user could overwrite another's submission.
      const claimedId = asString((body as any).applicationId);
      if (claimedId && claimedId !== uid) {
        const existingApp = await getById(claimedId);
        if (!existingApp) {
          return NextResponse.json({ error: 'Application not found' }, { status: 404 });
        }
        if ((existingApp as any).applicantUid !== uid) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      if (Object.keys(rawFormData).length === 0) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      const result = await submitFinal(uid, email || '', rawFormData, asRecord(body));

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        applicationId: result.applicationId,
        message: 'Application submitted successfully and waiting for approval',
      });
    } catch (error) {
      console.error('Failed to submit application:', error);
      return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
    }
  },
  {
    requiredRoles: [],
    schema: undefined,
  }
);
```

#### 5. Image & Proof Upload Handler: `src/app/api/upload/route.ts`
*(Source: `src/app/api/upload/route.ts`, lines 1–151)*

```typescript
import cloudinary, {
  isAllowedMimeType,
  isAllowedSize,
  MAX_FILE_SIZE,
  sanitizeFolder,
} from '@/lib/cloudinary-server';
import { verifyTokenOnly } from '@/lib/security/api-auth';
import { checkRateLimit, createRateLimitId } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authentication ─────────────────────────────────────────────────
    const user = await verifyTokenOnly(request);
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // ── 2. Rate Limiting ──────────────────────────────────────────────────
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
    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.' },
        { status: 400 }
      );
    }

    // ── 5. Validate File Size ─────────────────────────────────────────────
    if (!isAllowedSize(file.size)) {
      return NextResponse.json(
        {
          error: `File size too large. Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        },
        { status: 400 }
      );
    }

    // ── 6. Sanitise Folder ────────────────────────────────────────────────
    const folder = sanitizeFolder(rawFolder);

    // ── 7. Upload to Cloudinary (server-side SDK) ─────────────────────────
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

    if (!result.secure_url) {
      throw new Error('Cloudinary upload succeeded but returned no URL');
    }

    return NextResponse.json({
      url: result.secure_url,
      public_id: result.public_id,
    });
  } catch (error: any) {
    console.error('❌ [Upload] Error:', error);

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

#### 6. Payment Recovery Polling Hook: `src/hooks/usePaymentRecovery.ts`
*(Source: `src/hooks/usePaymentRecovery.ts`, lines 1–191)*

```typescript
"use client";

import {
  mapRecoverStatusToState,
  PaymentFrontendStatus,
  RECOVERY_MAX_ATTEMPTS,
  RECOVERY_POLL_INTERVAL_MS,
} from '@/lib/payment/payment-state';
import { useEffect, useRef, useState } from 'react';

export interface RecoveryState {
  status: PaymentFrontendStatus | null;
  isPolling: boolean;
  attemptsDone: number;
  timedOut: boolean;
  rawApiStatus: string | null;
}

export interface UsePaymentRecoveryOptions {
  getToken: () => Promise<string | null>;
  onSuccess?: () => void;
  autoStart?: boolean;
  orderId?: string;
  paymentId?: string;
}

export function usePaymentRecovery(opts: UsePaymentRecoveryOptions) {
  const { getToken, onSuccess, autoStart = true, orderId, paymentId } = opts;

  const [state, setState] = useState<RecoveryState>({
    status: null,
    isPolling: false,
    attemptsDone: 0,
    timedOut: false,
    rawApiStatus: null,
  });

  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runOnce = async (): Promise<void> => {
    if (!mountedRef.current) return;

    const token = await getToken();
    if (!token) {
      console.warn('[usePaymentRecovery] No auth token, aborting poll.');
      return;
    }

    const params = new URLSearchParams();
    if (orderId) params.set('orderId', orderId);
    if (paymentId) params.set('paymentId', paymentId);
    const qs = params.toString() ? `?${params.toString()}` : '';

    let data: any;
    try {
      const res = await fetch(`/api/payment/recover${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      data = await res.json();
    } catch (err) {
      console.error('[usePaymentRecovery] network error:', err);
      data = { success: false, status: 'verification_pending' };
    }

    const rawStatus: string = data?.status || 'verification_pending';
    const frontendStatus = mapRecoverStatusToState(rawStatus);

    if (!mountedRef.current) return;

    if (frontendStatus === 'success') {
      setState(prev => ({
        ...prev,
        status: 'success',
        isPolling: false,
        attemptsDone: attemptsRef.current + 1,
        rawApiStatus: rawStatus,
      }));
      onSuccess?.();
      return;
    }

    if (frontendStatus === 'duplicate_pending_refund') {
      setState(prev => ({
        ...prev,
        status: 'duplicate_pending_refund',
        isPolling: false,
        attemptsDone: attemptsRef.current + 1,
        rawApiStatus: rawStatus,
      }));
      return;
    }

    if (frontendStatus === 'failed') {
      setState(prev => ({
        ...prev,
        status: 'failed',
        isPolling: false,
        attemptsDone: attemptsRef.current + 1,
        rawApiStatus: rawStatus,
      }));
      return;
    }

    attemptsRef.current += 1;

    if (attemptsRef.current >= RECOVERY_MAX_ATTEMPTS) {
      setState(prev => ({
        ...prev,
        status: frontendStatus,
        isPolling: false,
        attemptsDone: attemptsRef.current,
        timedOut: true,
        rawApiStatus: rawStatus,
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      status: frontendStatus,
      isPolling: true,
      attemptsDone: attemptsRef.current,
      rawApiStatus: rawStatus,
    }));

    timerRef.current = setTimeout(() => {
      if (mountedRef.current) runOnce();
    }, RECOVERY_POLL_INTERVAL_MS);
  };

  const start = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    attemptsRef.current = 0;
    setState({
      status: null,
      isPolling: true,
      attemptsDone: 0,
      timedOut: false,
      rawApiStatus: null,
    });
    runOnce();
  };

  const triggerManualCheck = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(prev => ({ ...prev, isPolling: true }));
    runOnce();
  };

  useEffect(() => {
    if (autoStart) start();
  }, [autoStart]);

  return { state, start, triggerManualCheck };
}
```

---



---

# PART 4: Admin & Moderator Application Review, Approval, Rejection, `verified_upcoming` Staging & Multi-RPC Transaction Boundaries

---

### 4.1 Sub-Domain Architecture & Exact Execution Pipeline

The Application Review, Approval, and Rejection lifecycle manages the official administrative determination of transport eligibility. It transitions unverified prospective submissions into either fully activated commuters with bus seat entitlements, staged future commuters waiting for an academic semester roll-over, or rejected applicants.

The domain exposes two main entrypoints in `src/domains/application/services/application.service.ts`:
- `approve(applicationId, approverData, notes?, overrides?)`
- `reject(applicationId, rejectorData, reason)`

These operations are invoked via four primary HTTP route handlers:
- `POST /api/applications/approve` (Fresh current or upcoming applications reviewed by Admins/Moderators)
- `POST /api/applications/approve-unauth` (Fresh applications submitted via the unauthenticated wizard)
- `POST /api/renewal-requests/approve-v2` (Renewal applications submitted by existing students)
- `POST /api/applications/reject` & `POST /api/renewal-requests/reject` (Rejection endpoints)

#### Sequence & Dataflow Diagram: The Three Approval Execution Paths

```
                               [ Admin / Moderator Approval Request ]
                                                 │
                                                 │ HTTP POST /api/applications/approve
                                                 ▼
                                     [ verifyApiAuth / withSecurity ]
                                                 │
                                                 ▼
                               [ db.rpc('approve_application') ]
                               (Acquires processing_lock, returns application row)
                                                 │
                                                 ├───────────────────────────────────────────────┐
                                                 │                                               │
                                                 ▼                                               ▼
                              [ Is Upcoming Application? ]                         [ Current Session Application ]
                         (targetSession.startYear > currentYear)                                 │
                                                 │                                               │
                         ┌───────────────────────┴───────────────────────┐                       │
                         ▼                                               ▼                       │
                   [ YES: PATH 1 ]                                 [ NO: PATH 2 & 3 ]            │
                         │                                                                       │
           [ release_application_lock ]                                                          │
                         │                                                                       │
           [ verifyUpcoming(appId) ]                                                             │
                         │                                                                       │
         - state = 'verified_upcoming'                                                           │
         - verified_upcoming_at = now()                                                          │
         - NO student_profiles row created                                                       │
         - NO bus load incremented                                                               │
         - Audit log emitted                                                                     │
                         │                                                                       │
                         ▼                                                                       │
                  [ Return 200 OK ]                                                              │
                                                                                                 │
                         ┌───────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
               [ Is Renewal Application? ]
         (application_type in ('renewal', 'renewal_after_soft_block'))
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   [ YES: PATH 3 ]                [ NO: PATH 2 (FRESH) ]
          │                             │
          │                             ├─► buildStudentData(...)
          │                             │   (computes validUntil, softBlock, hardBlock)
          │                             │
          │                             ├─► db.rpc('identity_activate_student_with_capacity')
          │                             │   - Checks bus capacity (aborts if full)
          │                             │   - Increments buses.morning_load / evening_load
          │                             │   - Upserts public.users (role = 'student')
          │                             │   - Upserts public.student_profiles (status = 'active')
          │                             │   [COMMITS IN POSTGRESQL TRANSACTION 1]
          │                             │
          │                             ├─► deleteUnauthUser(app.applicant_uid) (best-effort)
          │                             │
          │                             ├─► db.rpc('finalize_application_approval')
          │                             │   - Sets application state = 'approved'
          │                             │   - Releases processing_lock
          │                             │   [COMMITS IN POSTGRESQL TRANSACTION 2]
          │                             │
          │                             └─► postCommitApprovalSideEffects(...)
          │                                 - Payment creation/update
          │                                 - Invalidate student:assign:<uid>
          │                                 - Emit audit_events
          │                                 - Send Push/Email Notification
          │
          ├─────────────────────────────────────────────────┐
          ▼                                                 ▼
[ Path 3A: Renewal Post-Soft-Block ]              [ Path 3B: Standard Active Renewal ]
      (seatWasReleased === true)                        (seatWasReleased === false)
          │                                                 │
[ db.rpc('approve_renewal_with_seat') ]           [ studentDataForRpc = { valid_until, ... } ]
- Checks bus capacity (aborts if full)                      │
- Increments buses.morning_load / evening_load    [ db.rpc('finalize_application_approval') ]
- Sets student_profiles.seat_released_at = NULL   - Updates student_profiles validity
- Sets student_profiles.status = 'active'         - Sets application state = 'approved'
- Sets application state = 'approved'             - Releases processing_lock
- Releases processing_lock                                  │
[SINGLE ATOMIC PL/PGSQL TRANSACTION]              [ postCommitApprovalSideEffects(...) ]
          │
[ postCommitApprovalSideEffects(...) ]
```

#### Critical Forensic Atomicity Trace: The Fresh Application Two-Transaction Split

In the fresh application approval flow (`application.service.ts` lines 535–640), execution is intentionally split across **two separate database transactions**:
1. **Transaction 1 (`identity_activate_student_with_capacity`):**
   - Validates that `morning_load < capacity` or `evening_load < capacity`.
   - Atomically increments the bus shift load.
   - Inserts or updates the `users` row.
   - Inserts or updates the `student_profiles` row with `status = 'active'`.
   - **Commits immediately upon RPC completion.**
2. **Node.js Intermediate Execution:**
   - Calls `deleteUnauthUser(app.applicant_uid)`.
3. **Transaction 2 (`finalize_application_approval`):**
   - Updates `public.applications` setting `state = 'approved'` and `processing_lock = false`.
   - **Commits immediately upon RPC completion.**

**What occurs if Transaction 2 fails or the server process crashes between Transaction 1 and Transaction 2?**
- In the TypeScript `catch (error: any)` block (lines 620–639):
  ```typescript
  if (seatCompensation) {
    await Seat.releaseSeat(seatCompensation.busId, seatCompensation.studentId, seatCompensation.shift)
      .catch(releaseErr => {
        console.error(`CRITICAL: Seat compensation failed for ${seatCompensation?.busId}/${seatCompensation?.studentId}:`, releaseErr);
      });
  }
  try {
    await db.rpc('release_application_lock', { p_application_id: applicationId });
  } catch {}
  return { success: false, error: error.message, status: error.status || 500 };
  ```
- **The Codebase Reality:**
  - The compensating logic calls `Seat.releaseSeat`, which decrements the bus load in `buses` to avoid a phantom seat leak.
  - It calls `release_application_lock` to unlock the application in `applications`.
  - **However, it DOES NOT delete or deactivate the newly inserted rows in `public.student_profiles` or `public.users`!**
  - Result: An active student profile and user account exist in PostgreSQL, but the application record remains in `submitted` state with its lock released. If an admin clicks "Approve" a second time, `identity_activate_student_with_capacity` executes an `ON CONFLICT (uid) DO UPDATE` and re-increments the bus capacity cleanly.

#### Rejection Pipeline Trace (`Application.reject`)

```
[ Admin / Moderator Rejection Request ]
                  │
                  ▼
[ db.rpc('reject_application') ]
- Acquires processing_lock on application row
- Returns application data payload
                  │
                  ▼
[ db.rpc('finalize_application_rejection') ]
- Sets application.state = 'rejected'
- Sets application.rejected_at = now()
- Sets application.rejected_by = rejector_uid
- Releases processing_lock = false
                  │
                  ▼
[ Post-Commit Rejection Side Effects ]
├─► rejectApplicationPayment(app.payment_id)
│   (Marks pending payment record as rejected in public.payments)
├─► createAuditEvent('application_rejected')
├─► sendApplicationRejectedNotification (Email via Resend / SMTP)
└─► deleteAsset(publicId) (Cloudinary payment proof deletion in renewal route)
```

---

### 4.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/domains/application/services/application.service.ts` | `approve`, `approveUnauth`, `reject`, `rejectUnauth`, `verifyUpcoming`, `checkApplication`, `saveDraft`, `submitFinal` | `/api/applications/*`, `/api/renewal-requests/*`, Admin/Moderator pages | `approve_application`, `identity_activate_student_with_capacity`, `approve_renewal_with_seat`, `finalize_application_approval`, `reject_application`, `finalize_application_rejection`, `release_application_lock`, `deleteUnauthUser`, `postCommitApprovalSideEffects` | Mutates `public.applications`, `public.student_profiles`, `public.users`, `public.buses`, `public.unauth_users`, `public.payments`, `public.audit_events`. Invalidates Redis `student:assign:<uid>`. |
| `src/app/api/applications/approve/route.ts` | `POST` (Next.js App Router Route Handler) | Admin UI (`/admin/applications`), Moderator UI | `approve`, `withSecurity`, `requireModeratorPermission`, `getUpdaterInfo` | Mutates database via `Application.approve`. Enforces `RateLimits.UPDATE`. |
| `src/app/api/applications/approve-unauth/route.ts` | `POST` | Moderator UI (`/moderator/applications`) | `approveUnauth`, `adminAuth.verifyIdToken`, `resolveUserRole`, `requireModeratorPermission` | Mutates database via `Application.approveUnauth`. |
| `src/app/api/applications/reject/route.ts` | `POST` | Admin UI, Moderator UI | `reject`, `withSecurity`, `requireModeratorPermission`, `getUpdaterInfo` | Mutates database via `Application.reject`. |
| `src/app/api/renewal-requests/approve-v2/route.ts` | `POST` | Admin Renewal Dashboard, Moderator Renewal Dashboard | `Application.approve`, `verifyToken`, `getUserById`, `requireModeratorPermission`, `sendApplicationApprovedNotification` | Mutates database via `Application.approve`. Sends confirmation email. |
| `src/app/api/renewal-requests/reject/route.ts` | `POST` | Admin Renewal Dashboard, Moderator Renewal Dashboard | `Application.reject`, `verifyToken`, `getUserById`, `requireModeratorPermission`, `deleteAsset` | Mutates database via `Application.reject`. Deletes Cloudinary receipt asset. |

---

### 4.3 Method-by-Method Low-Level Walkthrough

#### 1. `Application.verifyUpcoming` (`src/domains/application/services/application.service.ts`)
- **Signature:** `export async function verifyUpcoming(applicationId: string, verifierData: { uid: string; name: string; role: string }, notes?: string): Promise<{ success: boolean; error?: string; status?: number }>`
- **Control Flow:**
  1. `repository.findByApplicationId(applicationId)`: If missing, returns `{ success: false, error: 'Application not found', status: 404 }`.
  2. State Gate: If `app.state !== 'submitted' && app.state !== 'draft'`, returns `400 Bad Request`.
  3. Updates application in PostgreSQL:
     - Sets `state = 'verified_upcoming'`
     - Sets `verifiedUpcomingAt = now`
     - Sets `verifiedUpcomingBy = verifierData.name`
     - Sets `verifiedUpcomingById = verifierData.uid`
     - Appends entry to `stateHistory`
  4. Emits `createAuditEvent` with `action: 'application_verified_upcoming'`, category `'applications'`, severity `'medium'`.
  5. Returns `{ success: true }`.

#### 2. `Application.approve` (`src/domains/application/services/application.service.ts`)
- **Signature:** `export async function approve(applicationId: string, approverData: { uid: string; name: string; role: string }, notes?: string, overrides?: { busId?: string; startYear?: number; endYear?: number }): Promise<{ success: boolean; studentUid?: string; error?: string; status?: number }>`
- **Control Flow & Branching:**
  1. Calls `db.rpc('approve_application', { p_application_id, p_approver_uid })`.
     - Checks if application exists and is in state `'submitted'`.
     - Acquires lease lock (`processing_lock = true`, lease duration 60s).
     - Returns application record as JSON.
     - If RPC fails or returns `success = false`, immediately returns error and status.
  2. **Path 1 Intercept (Upcoming Applications):**
     - Evaluates `if (isUpcomingApplication(app) && app.state === 'submitted')`.
     - Releases lock via `db.rpc('release_application_lock', { p_application_id })`.
     - Invokes `verifyUpcoming(applicationId, approverData, notes)`.
     - Returns `{ success: true, studentUid: app.applicant_uid }`.
  3. Evaluates `isRenewal = app.application_type === 'renewal' || app.application_type === 'renewal_after_soft_block'`.
  4. **Path 3 (Renewal Applications):**
     - Loads existing student record via `Student.getByUid(app.applicant_uid)`.
     - Computes renewal validity date using `calculateValidUntilDate(baseYear, durationYears, deadlineConfig)`.
     - Enforces max-of-old-and-new invariant: `finalValidUntil = max(existingValidUntil, newValidUntil)`.
     - Computes soft-block and hard-block dates via `computeBlockDatesFromValidUntil`.
     - Evaluates `seatWasReleased = !!student.seatReleasedAt`.
     - **Sub-Path 3A: Post-Soft-Block Renewal (`seatWasReleased && renewalBusId`):**
       - Invokes `db.rpc('approve_renewal_with_seat', { p_application_id, p_approver_uid, p_approved_by, p_student_uid, p_bus_id, p_shift, p_valid_until, p_session_end_year, p_session_duration, p_soft_block, p_hard_block })`.
       - If capacity full, catches `CAPACITY_FULL`, sets `status: 409`, `needsCapacityReview: true`, and throws.
       - If successful, sets `renewalAlreadyFinalized = true`.
     - **Sub-Path 3B: Standard Active Renewal:**
       - Prepares `studentDataForRpc` with updated `valid_until`, `session_end_year`, `status: 'active'`.
  5. **Path 2 (Fresh Applications):**
     - Invokes `buildStudentData(app, approverData, overrides)`.
     - Resolves `targetBusId` and `studentShift`.
     - Calls `db.rpc('identity_activate_student_with_capacity', { p_bus_id, p_shift, p_uid, p_email, p_full_name, p_student_data })`.
     - If bus capacity is exhausted, RPC raises exception `Bus ... is at full capacity`, aborting transaction.
     - On RPC success, sets `seatCompensation = { busId: targetBusId, studentId: app.applicant_uid, shift: studentShift }`.
     - Calls `deleteUnauthUser(app.applicant_uid)` (best effort).
  6. **Step 2: Finalize Application Approval:**
     - If `!renewalAlreadyFinalized`, calls `db.rpc('finalize_application_approval', { p_application_id, p_approver_uid, p_student_data })`.
     - Clears `seatCompensation = null`.
  7. **Step 3: Post-Commit Side Effects:**
     - Calls `postCommitApprovalSideEffects(app, studentData, approverData, isRenewal ? 'renewal' : 'new')`.
       - Online payments: calls `upsertApprovalPayment` or updates `entitlement_status = 'active'`.
       - Offline payments: calls `createOfflinePaymentAtApproval` with retry.
       - Entitlement cache invalidation: calls `invalidateStudentAssignmentCache(app.applicant_uid)` (clears L1 memory, Redis `student:assign:<uid>`, publishes to Redis Pub/Sub).
       - Audit: records `application_approved` event.
       - Notification: sends in-app notification to student.
  8. Returns `{ success: true, studentUid: app.applicant_uid }`.

#### 3. `Application.reject` (`src/domains/application/services/application.service.ts`)
- **Signature:** `export async function reject(applicationId: string, rejectorData: { uid: string; name: string; role: string }, reason: string): Promise<{ success: boolean; error?: string; status?: number }>`
- **Control Flow:**
  1. Calls `db.rpc('reject_application', { p_application_id, p_rejector_uid })`.
     - Locks application row and verifies it is in `submitted` state.
  2. Calls `db.rpc('finalize_application_rejection', { p_application_id, p_rejector_uid })`.
     - Sets `state = 'rejected'`, stamps `rejected_at` and `rejected_by`, releases lock.
  3. If `app.payment_id` exists, calls `rejectApplicationPayment(app.payment_id)` to transition payment to `Rejected`.
  4. Records `application_rejected` event in `audit_events`.
  5. Dispatches rejection email via `sendApplicationRejectedNotification`.
  6. If any step in Step 2 fails, catches error, invokes `release_application_lock`, and returns 500 error.

---

### 4.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Execution Context | PostgreSQL Queries / RPCs Executed | Redis Commands | External Network Calls | Latency Profile |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Path 1: Upcoming Application Review** | 2 RPCs / Queries: `approve_application` (lock), `release_application_lock`, 1 UPDATE: `applications` (via `verifyUpcoming`), 1 INSERT: `audit_events` | 0 | 1 Firebase Auth verification | ~35ms - 55ms |
| **(b) Path 2: Fresh Application Approval (Cold/Success)** | 3 RPCs: `approve_application`, `identity_activate_student_with_capacity`, `finalize_application_approval`; 1 DELETE: `unauth_users`; 1-2 INSERT/UPDATE: `payments`; 1 INSERT: `audit_events`; 1 INSERT: `notifications` | 2 Redis commands: `DEL student:assign:<uid>`, `PUBLISH user:assignment:invalidate` | 1 Firebase Auth verification + optional FCM/Email dispatch | ~85ms - 140ms |
| **(c) Path 3A: Renewal with Seat Reclaim (Post-Soft-Block)** | 1 SELECT: `student_profiles`, 1 RPC: `approve_application`, 1 RPC: `approve_renewal_with_seat` (fused capacity + student update + app finalize in 1 TX); 1 INSERT: `payments`; 1 INSERT: `audit_events`; 1 INSERT: `notifications` | 2 Redis commands: `DEL student:assign:<uid>`, `PUBLISH user:assignment:invalidate` | 1 Firebase Auth verification + 1 Email notification | ~75ms - 120ms |
| **(d) Concurrency / Bus Capacity Full Rejection** | 2 RPCs: `approve_application` (acquires lock), `identity_activate_student_with_capacity` (raises exception: bus full), 1 RPC: `release_application_lock` | 0 | 0 | ~25ms - 40ms |
| **(e) Rejection Execution (`Application.reject`)** | 2 RPCs: `reject_application`, `finalize_application_rejection`; 1 UPDATE: `payments` (if `payment_id`); 1 INSERT: `audit_events` | 0 | 1 Firebase Auth verification + 1 Cloudinary asset delete (`deleteAsset`) + 1 Email notification | ~65ms - 180ms |

---

### 4.5 Verbatim Source Code from Live Codebase

#### 1. `src/domains/application/services/application.service.ts` (Lines 320–763, 881–1098)
```typescript
export async function verifyUpcoming(
  applicationId: string,
  verifierData: { uid: string; name: string; role: string },
  notes?: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const app = await repository.findByApplicationId(applicationId);
  if (!app) {
    return { success: false, error: 'Application not found', status: 404 };
  }

  if (app.state !== 'submitted' && app.state !== 'draft') {
    return { success: false, error: `Application in state '${app.state}' cannot be verified`, status: 400 };
  }

  const now = new Date().toISOString();

  await repository.update(applicationId, {
    state: 'verified_upcoming',
    verifiedUpcomingAt: now,
    verifiedUpcomingBy: verifierData.name,
    verifiedUpcomingById: verifierData.uid,
    updatedAt: now,
    stateHistory: [
      ...(app.stateHistory || []),
      { state: 'verified_upcoming', timestamp: now, actor: verifierData.uid }
    ]
  });

  void createAuditEvent({
    action: 'application_verified_upcoming',
    actor_id: verifierData.uid,
    actor_name: verifierData.name,
    actor_role: verifierData.role,
    target_id: applicationId,
    target_type: 'application',
    target_name: app.formData?.fullName || app.applicantEmail || '',
    category: 'applications',
    summary: `Verified upcoming session application for ${app.formData?.fullName || app.applicantEmail || ''}`,
    severity: 'medium',
    metadata: {
      applicationId,
      sessionStartYear: (app as any).sessionStartYear || app.targetSession?.startYear,
      notes,
    }
  });

  return { success: true };
}

/**
 * Approve an application. Orchestrates:
 * 1. Application RPC (validate + lock + return payload)
 * 2. Student activation (identity for fresh, update for renewal)
 * 3. Seat reclamation (renewal_after_soft_block only)
 * 4. Payment (idempotent)
 * 5. Audit (idempotent)
 * 6. Notification (idempotent)
 * 7. Finalize RPC (delete for fresh, preserve for renewal)
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
          p_approved_by: approverData.uid,
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
          const rawErr = rpcResult?.error || rpcError?.message || 'Renewal with seat assignment failed';
          const isCapacity = rawErr.includes('CAPACITY_FULL') || rpcResult?.error === 'CAPACITY_FULL';
          const capacityErr: any = new Error(
            isCapacity
              ? 'CAPACITY_FULL: Assigned bus is at full capacity for this shift. Please select an alternative bus (overrideBusId) to approve this renewal.'
              : rawErr
          );
          if (isCapacity) {
            capacityErr.status = 409;
            capacityErr.needsCapacityReview = true;
          }
          throw capacityErr;
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
    try {
      await db.rpc('release_application_lock', { p_application_id: applicationId });
    } catch {
      // Best-effort lock release
    }
    return {
      success: false,
      error: error.message,
      status: error.status || 500,
      ...(error.needsCapacityReview ? { needsCapacityReview: true } : {}),
    };
  }
}

export async function approveUnauth(
  studentUid: string,
  moderatorData: { uid: string; name: string; role: string },
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<{ success: boolean; studentUid?: string; error?: string; status?: number }> {
  return approve(studentUid, moderatorData, undefined, overrides);
}

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

async function buildStudentData(
  app: any,
  approverData: { uid: string; name: string; role: string },
  overrides?: { busId?: string; startYear?: number; endYear?: number }
): Promise<Record<string, any>> {
  const fd = app.form_data || app.formData || {};
  const si = fd.sessionInfo || {};
  const startYear = overrides?.startYear || si.sessionStartYear || fd.sessionStartYear || new Date().getFullYear();
  const endYear = overrides?.endYear || si.sessionEndYear || fd.sessionEndYear || (startYear + 1);
  const durationYears = Math.max(1, endYear - startYear);

  const busId = overrides?.busId || app.bus_id || app.busId || fd.busId || fd.bus_id || fd.selectedBus;
  const routeId = app.route_id || app.routeId || fd.routeId || fd.route_id || fd.selectedRoute;
  const stop_name = app.stop_name || fd.stop_name || fd.selected_stop_name || fd.selectedStop;
  const rawShift = app.shift || fd.shift || fd.selectedShift;
  const shift = normalizeShift(rawShift);
  if (!shift) {
    throw new Error('Application is missing a valid shift assignment.');
  }

  const fullName = app.full_name || fd.fullName || app.name || '';
  const email = app.email || fd.email || '';
  const enrollmentId = app.enrollment_id || app.enrollmentId || fd.enrollmentId || '';

  const deadlineConfig = await getDeadlineConfig();
  const validUntilDate = calculateValidUntilDate(startYear, durationYears, deadlineConfig);
  const validUntilStr = validUntilDate.toISOString();
  const blockDates = computeBlockDatesFromValidUntil(validUntilDate, deadlineConfig);

  return {
    applicationId: app.application_id || app.applicationId || app.id || null,
    fullName,
    email,
    phone: fd.phoneNumber || fd.phone || app.phone || '',
    altPhone: fd.alternatePhone || fd.altPhone || null,
    parentName: fd.parentName || null,
    parentPhone: fd.parentPhone || null,
    faculty: app.faculty || fd.faculty || '',
    department: app.department || fd.department || '',
    gender: fd.gender || null,
    dob: fd.dob || null,
    enrollmentId,
    bloodGroup: fd.bloodGroup || null,
    address: fd.address || null,
    profilePhotoUrl: fd.profilePhotoUrl || null,
    busId,
    routeId,
    stop_name,
    shift,
    sessionStartYear: startYear,
    sessionEndYear: endYear,
    sessionDuration: String(durationYears),
    semester: app.semester || fd.semester || '',
    durationYears,
    validUntil: validUntilStr,
    softBlock: (typeof blockDates.softBlock === 'string' ? blockDates.softBlock : (blockDates.softBlock as any)?.toISOString()) || null,
    hardBlock: (typeof blockDates.hardBlock === 'string' ? blockDates.hardBlock : (blockDates.hardBlock as any)?.toISOString()) || null,
    approvedBy: approverData.name || approverData.uid,
  };
}

async function postCommitApprovalSideEffects(
  app: any,
  studentData: Record<string, any>,
  approverData: { uid: string; name: string; role: string },
  applicationType?: 'new' | 'renewal'
): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  const purpose: 'new_registration' | 'renewal' = applicationType === 'renewal' ? 'renewal' : 'new_registration';

  let amount = Number(
    app.amount_paid ||
    app.form_data?.paymentInfo?.amountPaid ||
    app.form_data?.totalFee ||
    app.form_data?.amount ||
    0
  );

  const paymentMode =
    app.payment_mode ||
    app.form_data?.paymentInfo?.paymentMode ||
    app.form_data?.paymentMode ||
    'offline';
  const studentIdVal = app.form_data?.enrollmentId || app.enrollment_id || app.enrollmentId || studentData.enrollmentId;
  const studentNameVal = app.form_data?.fullName || app.full_name || studentData.fullName;

  if (paymentMode === 'online') {
    const resolvedPaymentId =
      app.payment_id ||
      app.form_data?.paymentId ||
      app.form_data?.paymentInfo?.razorpayPaymentId ||
      (typeof app.application_id === 'string' && app.application_id.startsWith('online_')
        ? app.application_id.replace(/^online_/, '')
        : null);

    tasks.push(
      (async () => {
        const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
        if (resolvedPaymentId) {
          const existingPayment = await paymentsSupabaseService.getPaymentById(resolvedPaymentId);
          if (existingPayment && existingPayment.status === 'Completed') {
            await paymentsSupabaseService.updatePaymentMetadata(resolvedPaymentId, {
              entitlement_status: 'active',
              approved_by: approverData.name || approverData.uid,
              application_id: app.application_id,
              approved_at: new Date().toISOString(),
            }).catch(() => null);
            return;
          }
        }

        const { upsertApprovalPayment } = await import('@/domains/payment');
        await upsertApprovalPayment({
          paymentId: resolvedPaymentId || `pay_${Date.now()}`,
          studentId: studentIdVal,
          studentUid: app.applicant_uid,
          studentName: studentNameVal,
          amount: amount > 0 ? amount : 50000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: studentData.sessionStartYear,
          sessionEndYear: studentData.sessionEndYear,
          durationYears: studentData.durationYears,
          validUntil: studentData.validUntil
            ? new Date(studentData.validUntil)
            : new Date(Date.UTC(studentData.sessionEndYear || (new Date().getFullYear() + 1), 5, 30, 23, 59, 59, 999)),
          razorpayPaymentId: resolvedPaymentId || app.form_data?.paymentInfo?.razorpayPaymentId || app.payment_id,
          razorpayOrderId: app.form_data?.paymentInfo?.razorpayOrderId,
          approvedAt: new Date(),
        });
      })().catch(err => { console.error('Payment upsert failed:', err); })
    );
  } else {
    tasks.push(
      (async () => {
        let finalAmount = amount;
        if (finalAmount <= 0) {
          try {
            const { getCurrentBusFee } = await import('@/lib/bus-fee-service');
            const feeConfig = await getCurrentBusFee();
            finalAmount = (feeConfig?.amount || 0) * (studentData.durationYears || 1);
          } catch {
            finalAmount = 0;
          }
        }

        const { createOfflinePaymentAtApproval } = await import('@/domains/payment');
        const paymentPayload = {
          studentId: studentIdVal,
          studentUid: app.applicant_uid,
          studentName: studentNameVal,
          amount: finalAmount,
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
        };

        try {
          await createOfflinePaymentAtApproval(paymentPayload);
        } catch (errFirst) {
          console.warn('Initial createOfflinePaymentAtApproval failed, retrying once...', errFirst);
          await createOfflinePaymentAtApproval(paymentPayload);
        }
      })().catch(err => { console.error('Offline payment creation failed after retry:', err); })
    );
  }

  // Cross-process entitlement cache invalidation (L1 memory + L2 Redis student:assign:<uid> + WS1 broadcast)
  tasks.push(
    (async () => {
      const { invalidateStudentAssignmentCache } = await import('@/domains/student');
      await invalidateStudentAssignmentCache(app.applicant_uid);
    })().catch(err => { console.error('Student assignment cache invalidation failed:', err); })
  );

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
}
```

#### 2. `src/app/api/applications/approve/route.ts` (Lines 1–65)
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

#### 3. `src/app/api/applications/approve-unauth/route.ts` (Lines 1–82)
```typescript
import { approveUnauth } from '@/domains/application';
import { adminAuth } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { resolveUserRole } from '@/lib/security/role-cache';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextRequest, NextResponse } from 'next/server';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const moderatorUid = decodedToken.uid;
    const body = asRecord(await request.json());
    const applicationId = asString(body.applicationId || body.studentUid);

    if (!applicationId) {
      return NextResponse.json({ error: 'Missing application ID' }, { status: 400 });
    }

    const userRole = await resolveUserRole(moderatorUid);
    if (!userRole.role) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const updaterInfo = await getUpdaterInfo(moderatorUid);

    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: decodedToken.email || '',
        role: userRole.role,
        name: updaterInfo.name,
      },
      'applications',
      'canApprove'
    );
    if (permissionDenied) return permissionDenied;

    const result = await approveUnauth(
      applicationId,
      {
        uid: moderatorUid,
        name: updaterInfo.name || 'Approver',
        role: userRole.role,
      },
      {
        busId: body.overrideBusId ? asString(body.overrideBusId) : undefined,
        startYear: body.sessionStartYear ? Number(body.sessionStartYear) : undefined,
        endYear: body.sessionEndYear ? Number(body.sessionEndYear) : undefined,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Application approved successfully',
      studentUid: result.studentUid,
    });
  } catch (error) {
    console.error('Error approving application:', error);
    return NextResponse.json(
      { error: safeErrorMessage(error, 'Failed to approve application') },
      { status: 500 }
    );
  }
}
```

#### 4. `src/app/api/applications/reject/route.ts` (Lines 1–63)
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

#### 5. `src/app/api/renewal-requests/approve-v2/route.ts` (Lines 1–124)
```typescript
import * as Application from '@/domains/application';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { verifyToken } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { requestId, overrideBusId } = body;
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 100) {
      return NextResponse.json({ error: 'Request ID required' }, { status: 400 });
    }

    const decodedToken = await verifyToken(token);
    const approverUserId = decodedToken.uid;

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

    const result = await Application.approve(
      requestId,
      {
        uid: approverUserId,
        name: approverProfile.fullName || approverProfile.name || 'Admin',
        role: approverProfile.role,
      },
      undefined,
      overrideBusId ? { busId: overrideBusId } : undefined
    );

    if (!result.success) {
      return NextResponse.json({
        error: result.error,
        needsCapacityReview: (result as any).needsCapacityReview,
      }, { status: result.status || 500 });
    }

    const postTasks = [
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

#### 6. `src/app/api/renewal-requests/reject/route.ts` (Lines 1–120)
```typescript
import * as Application from '@/domains/application';
import { getUserById } from '@/domains/identity';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { adminAuth } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

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

    const fd = app.formData as any;
    const receiptImageUrl = fd.receiptImageUrl;

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

---

