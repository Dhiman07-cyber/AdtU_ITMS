# 01 — Authentication & Authorization Audit

## Business Understanding
ITMS has four roles: admin, moderator, driver, student. Users are created by admins/moderators in Firebase Auth + mirrored to PostgreSQL (`users`, `student_profiles`, `driver_profiles`, `moderator_profiles`, `admin_profiles`). Every API call authenticates with a Firebase ID token; PostgreSQL (via a server-side service-role client) is the canonical source of truth for role and permissions. Moderators have granular permission objects (`moderator-permissions.ts`); drivers own trips/buses; students own their profile and applications.

## Architecture
- `withSecurity` (api-security.ts) pipeline: Origin/CSRF check → `verifyIdToken` → role cache (5 min TTL) → `requiredRoles` → optional moderator permission check → rate limit → zod schema → handler.
- `verifyApiAuth` (api-auth.ts): leaner variant used by many routes (firebase verify + role lookup, no schema).
- `scanner-auth.ts`: driver/mod/admin bus-scanner context validation.
- WS auth: Firebase verification server-side; first-message token (Path B) preferred, URL query token (Path A) deprecated but active.
- Role cache is in-memory; permission checks hit PG per call in many paths.

## Workflow & Execution Traces
1. Student opens app → Firebase sign-in → ID token attached `Authorization: Bearer`.
2. `withSecurity` verifies token → role from PG `users` → `requiredRoles` gate → handler.
3. Driver scanner flow: `validateStudentScannerContext(auth, scannerBusId)` → admin: pass; moderator: `students.canView`; driver: bus assignment check → fallback (see C4).
4. Profile update approval: driver POSTs to `handle-profile-update` → Cloudinary delete of old photo → PG `updateStudent` → Firestore mirror.

## Verified Findings

### C4 — Scanner ownership check is dead code [VERIFIED]
- **Where:** `src/lib/security/scanner-auth.ts:98-105`
- **Issue:** After the legitimate check fails (`assignedIds.size > 0 && assignedIds.has(scannerBusId)`), a catch-all fallback returns success for ANY non-empty string:
  ```ts
  if (typeof scannerBusId === 'string' && scannerBusId.trim().length > 0) {
    return null;  // permit
  }
  ```
  So every logged-in driver passes with an arbitrary bus id. Additionally `scannerBusMatchesStudent` (`:34-38`) returns `true` for non-string `scannerBusId`, weakening downstream checks.
- **Impact:** Any driver can read any student's name/enrollmentId/gender/photo/shift/validUntil and receive `canBoard: true` for any bus. Boarding verification is meaningless.
- **Fix:** Delete the fallback block; return the 403 when not assigned.

### H1 — `busId === busId` self-comparison always true [VERIFIED]
- **Where:** `src/app/api/driver/handle-profile-update/route.ts:79`
- **Issue:** In the "driver is assigned to any bus" loop, `const busId = bus.busId || bus.id || ''; if (busId === busId)` compares a variable to itself.
- **Impact:** Any driver who owns at least one bus approves/rejects ANY student's profile update, including deleting the student's current Cloudinary photo (approve path, `:95-113`).
- **Fix:** Compare the student's `busId` (already fetched at `:62`) against each `bus.busId/bus.id`. Also delete the redundant `studentData.busId || studentData.busId` at `:62`.

### H2 — Arbitrary Cloudinary asset deletion [VERIFIED]
- **Where:** `src/app/api/delete-image/route.ts:23,54,62`
- **Issue:** Auth is `verifyTokenOnly` (any authenticated user incl. students); no ownership/association check. `publicId` must match `/^[a-zA-Z0-9/_-]+$/` — trivially guessable for uploads keyed by user/enrollment ids.
- **Impact:** Any student can delete any student's (or driver's/moderator's) profile photo, or any other Cloudinary asset. Denial-of-service / defacement.
- **Fix:** Require `requiredRoles` appropriate to asset type, and validate `publicId` against the authenticated user's own assets (or a signed delete token issued at upload time).

### C5 — Moderator Aadhaar exposure [VERIFIED]
- **Where:** `src/app/api/moderators/[id]/route.ts:26,75`
- **Issue:** `verifyApiAuth(request, ['admin','moderator'])` — no permission gate, no field stripping. Response includes `aadharNumber`, `dob`, `phone`, `alternatePhone`, `employeeId` for any moderator id.
- **Impact:** Aadhaar (national ID) + DOB + phone of all moderators readable by any moderator. DPDP/GDPR-grade breach.
- **Fix:** Gate on `permissions.staff.canView` (like drivers route does) and strip Aadhaar/DOB except for self/admin.

### H10a — Driver profile PII readable by students & drivers [VERIFIED]
- **Where:** `src/app/api/drivers/[id]/route.ts:10,24`
- **Issue:** GET allows `['admin','moderator','driver','student']` and returns the full driver row (`{ driver }`) including Aadhaar, license, phone, DOB. No field stripping for driver/student roles.
- **Fix:** Strip sensitive fields unless admin (or the driver themselves).

### H10b — Drivers list all students with full PII [VERIFIED]
- **Where:** `src/app/api/students/route.ts:19,87-111`
- **Issue:** GET allows `['admin','moderator','driver']`; driver role has no scoping to own bus and response includes `phone`, `altPhone`, `dob`, `parentPhone`, `email` for all students (q-search path `:56` selects these explicitly).
- **Fix:** For driver role: filter by own bus and strip parent/dob/phone fields.

### H12 — renew-services: moderator without permission check [VERIFIED]
- **Where:** `src/app/api/renew-services/route.ts:53`
- **Issue:** `['admin','moderator']` with no granular permission check (unlike every other staff route). Any moderator can bulk-renew up to 100 students and set their `paymentAmount`/`paid_on`.
- **Fix:** Add `requireModeratorPermission(auth, 'students', 'canEdit')`-style gate.

## Agent-reported findings (spot-verified, lower confidence)

| Finding | Evidence | Confidence |
|---------|----------|------------|
| `moderator/create-user` fails open (missing permission check on some paths) | `src/app/api/moderator/create-user/route.ts` | Medium |
| CSRF origin check only when `Origin` header present | `src/lib/security/api-security.ts` | High (pattern observed) |
| API rate limit trusts first `X-Forwarded-For` value (spoofable) | `src/lib/security/rate-limiter.ts` getClientIp | High |
| `allowBodyToken: true` default merges query token into body (CSRF risk vector) | `api-security.ts` | High |
| `renew-services` idempotency key dead code | `renew-services/route.ts:94-99` — operationKey never used | VERIFIED (see H9) |
| WS URL-query token still accepted (Path A) — tokens leak into proxy/access logs | `websocket-server.ts:44-85` | VERIFIED |

## False Positives Discarded
- "Firestore mirror = source of truth mismatch": intentional dual-write; PG is canonical, Firestore is a read mirror. Not a defect per se, though mirroring failures are swallowed (`console.error` only) — flagged as Medium reliability, not security.
- `verifyTokenOnly` routes that only expose non-sensitive data (e.g., own-profile endpoints) were not counted as findings.

## Recommendations (smallest safe change first)
1. Delete scanner fallback (`scanner-auth.ts:102-105`).
2. Fix `busId === busId` (`handle-profile-update/route.ts:79`).
3. Ownership check in `delete-image`.
4. Role-strip `drivers/[id]` GET and `students/route.ts`; gate `moderators/[id]` on permission.
5. Gate `renew-services` on moderator permission.
6. Then (bigger): retire Path A URL-token auth; harden CSRF origin check; stop trusting `X-Forwarded-For` first value.

## Confidence
High for all VERIFIED findings (re-read source this session). Medium for agent-reported rows.
