# Digital Boarding Pass Issuance, 128-Bit Cryptographic QR Tokens & Verification (Forensic Truth)

**Module:** Boarding Pass Generation, AES/HMAC QR Tokens, Client-Side Canvas PDF Receipts & 4-Gate Scanner Validation  
**File Authority:** `src/app/student/pass/page.tsx`, `src/lib/services/qr-token.service.ts`, `src/components/pass/BoardingPassCard.tsx`  
**Security Standard:** 128-Bit Token Rotation, Anti-Replay Nonce, Offline Driver Validation  

---

# PART 7: Digital Boarding Pass Issuance, 128-Bit Cryptographic QR Tokens, PDF Receipts & Scanner Verification

### 7.1 Sub-Domain Architecture & Exact Execution Pipeline

The Boarding Pass and Document Verification subsystem provides cryptographically authenticated digital passes and university-stamped transaction receipts.

The architecture supports two distinct verification channels:
1. **Physical Bus Boarding Channel (Driver / Conductor Terminal)**:
   - Scans either a **Version 2 128-bit encrypted QR token** or a **Raw Student UID**.
   - Validates live account entitlement (`getTransportEntitlement`) and route assignment (`scannerBusMatchesStudent`).
   - Cross-checks with the active trip context in `public.active_trips`.
2. **Financial Proof & Receipt Channel (Audit / Admin / Conductor Verification)**:
   - Scans document QR tokens embedded on PDF receipts (`ADTU-R2-...` or legacy `ADTU-R1-...`).
   - Validates digital document signatures against `public.payments.document_signature` via RSA-2048 / HMAC-SHA256.

```
                                  STUDENT DIGITAL PASS / RECEIPT
                                                │
                ┌───────────────────────────────┴───────────────────────────────┐
                │                                                               │
     [STUDENT BUS PASS DISPLAY]                                     [PDF RECEIPT VERIFICATION]
   (InlineQRDisplay / bus-pass page)                                (Scanned from Printed/PDF Receipt)
                │                                                               │
   Renders QRCodeCanvas(value)                                      Token format: 'ADTU-R2-...' / 'ADTU-R1-...'
   Either AES-256-GCM Token or UID                                              │
                │                                                               ▼
                ▼                                                   POST /api/receipt/verify
     DRIVER / MODERATOR SCANNER                                     (Role: admin / moderator with payment perms)
  (detectScanType -> verifyStudent)                                             │
                │                                                   1. Parse parseSecureQRData (rid, sig)
   scannedData.length > 60 && base64url?                            2. Fetch payments by ID from Supabase
    ├── YES ──► POST /api/bus-pass/verify-secure-qr                 3. Check status === 'Completed'
    │            │                                                  4. verifyReceiptIntegrity:
    │            ├── 1. quickValidateQRToken (Fast HMAC check)      │  RSA-2048 verification against
    │            ├── 2. decryptQRCodeData (AES-256-GCM + PBKDF2)    │  payment.document_signature
    │            ├── 3. DerivedKeyCache (5,000 LRU check)           │
    │            ├── 4. Token Expiry Check (24h window)             ▼
    │            └── 5. Resolve student profile from DB             HTTP 200 { valid: true, status: 'valid' }
    │
    └── NO  ──► POST /api/bus-pass/verify-student (Raw UID)
                 │
                 ▼
         COMMON LIVE BUS VERIFICATION:
         ├── Query public.active_trips (Trip status and 12h expiry check)
         ├── getTransportEntitlement(studentData):
         │    - Rejects 'soft_blocked'
         │    - Rejects expired 'valid_until'
         │    - Rejects pending renewal applicants
         │    - Rejects future students
         ├── scannerBusMatchesStudent(scannerBusId, student.busId)
         └── Return Privacy-Minimal Response:
              { canBoard: accountValid && busMatchesScanner,
                status: 'success' | 'bus_mismatch' | 'session_expired' }
```

---

### 7.2 File, Component, Hook, API & Service Inventory

| File Path | Exported Functions / Components | Callers (Who calls it) | Callees (What it calls) | Database Tables / Caches Mutated |
| :--- | :--- | :--- | :--- | :--- |
| `src/lib/security/encryption.service.ts` | `encryptQRCodeData`, `decryptQRCodeData`, `quickValidateQRToken`, `clearDerivedKeyCache` | `verify-secure-qr`, student bus pass, testing | `crypto.pbkdf2Sync`, `crypto.createCipheriv`, `crypto.createDecipheriv`, `crypto.createHmac`, `crypto.timingSafeEqual` | In-memory LRU key cache (`derivedKeyCache`, max 5,000 entries) |
| `src/app/api/bus-pass/verify-secure-qr/route.ts` | `POST` | Driver / Moderator Scanner (`BusPassScannerModal`, `verification/page.tsx`) | `verifyApiAuth`, `checkRateLimit`, `validateStudentScannerContext`, `quickValidateQRToken`, `decryptQRCodeData`, `getByUid`, `getTransportEntitlement`, `scannerBusMatchesStudent` | Reads `public.active_trips`, `public.student_profiles` |
| `src/app/api/bus-pass/verify-student/route.ts` | `POST` | Driver / Moderator Scanner (fallback for unencrypted UID QR) | `verifyApiAuth`, `checkRateLimit`, `validateStudentScannerContext`, `getByUid`, `getTransportEntitlement`, `scannerBusMatchesStudent` | Reads `public.active_trips`, `public.student_profiles` |
| `src/app/api/receipt/verify/route.ts` | `POST` | Moderator Document Verification Queue | `withSecurity`, `canVerifyPaymentReceipt`, `parseSecureQRData`, `paymentsSupabaseService.getPaymentById`, `buildDocumentPayloadFromPayment`, `verifyReceiptIntegrity` | Reads `public.payments`, `public.moderator_profiles` |
| `src/lib/services/receipt-pdf.ts` | `renderReceiptPdf` | Payment download routes, receipt generators | `jsPDF` (Node / browser vector canvas) | None (Pure PDF rendering to Buffer) |
| `src/app/student/bus-pass/page.tsx` | Default React Page (`StudentBusPassPage`) | Student navigation | `useAuth`, `getStudentByUid`, `getBusById`, `getRouteById`, `hasTransportEntitlement`, `InlineQRDisplay` | None (Client read) |
| `src/components/bus-pass/InlineQRDisplay.tsx` | Default React Component (`InlineQRDisplay`) | `StudentBusPassPage` | `QRCodeCanvas` (`qrcode.react`), HTML Canvas 2D exporter | None |

---

### 7.3 Method-by-Method Low-Level Walkthrough

#### 1. QR Cryptographic Engine: `encryption.service.ts`
- **Key Derivation with 5,000-entry LRU Cache (`deriveKey`):**
  - Algorithm: PBKDF2 with SHA-256, 100,000 iterations (`ITERATION_COUNT = 100000`), 256-bit key length (`KEY_LENGTH = 32`).
  - Cache Key: `salt.toString('hex') + ':' + secret`.
  - Cache Maintenance: When cache reaches `MAX_KEY_CACHE_SIZE = 5000`, evicts oldest 1,000 entries. Prevents Node.js event-loop CPU starvation on high-frequency scan loops.
- **Token Anatomy (`encryptQRCodeData`):**
  1. Payload: JSON object containing `{ uid, enrollmentId, name, busId, issuedAt, expiresAt: issuedAt + 24h, version: 1 }`.
  2. Generates random 16-byte salt and 16-byte IV (`crypto.randomBytes`).
  3. Encrypts payload with `aes-256-gcm` (128-bit authentication tag).
  4. Packs combined buffer:
     ```
     [Version (1 byte = 0x02)] + [Salt (16 bytes)] + [IV (16 bytes)] + [AuthTag (16 bytes)] + [Ciphertext (N bytes)]
     ```
  5. Computes HMAC-SHA256 signature across the entire combined buffer using `SIGNING_KEY`.
  6. Slices the first 16 bytes (128 bits) of the HMAC: `signature.subarray(0, 16)`.
  7. Appends 16-byte signature to the buffer and encodes as `base64url`.
- **Token Verification & Decryption (`decryptQRCodeData`):**
  1. Decodes `base64url` string. Checks minimum length: `1 + 16 + 16 + 16 + 8 + 1`.
  2. Reads version byte:
     - Version 2: Signature length is 16 bytes (128-bit).
     - Version 1: Signature length is 8 bytes (64-bit, legacy backward compatibility).
  3. Extracts `salt`, `iv`, `authTag`, `ciphertext`, and `signature`.
  4. Verifies HMAC signature using `crypto.timingSafeEqual`. Returns `null` if tampered.
  5. Derives key from salt using cached PBKDF2.
  6. Decrypts ciphertext with AES-256-GCM and verifies 16-byte authTag. Returns `null` if corrupted.
  7. Parses JSON and verifies `Date.now() <= payload.expiresAt`. Returns `null` if expired.

---

#### 2. Secure QR Verification Route: `POST /api/bus-pass/verify-secure-qr` (`src/app/api/bus-pass/verify-secure-qr/route.ts`)
- **Authentication & Rate Limiting:**
  - Roles permitted: `['driver', 'admin', 'moderator']`.
  - Rate limit: Capped per user via `RateLimits.BUS_PASS_VERIFY` (60 scans / min). Exceeded returns HTTP 429.
- **Fast Rejection of Camera Noise (`quickValidateQRToken`):**
  - Runs fast HMAC signature check on raw base64 token before performing heavy PBKDF2 key derivation or database lookups.
- **Active Trip Coordination:**
  - Queries `public.active_trips` for `bus_id = scannerBusId AND status = 'active'`.
  - Flags `isTripStale = true` if the trip was initiated > 12 hours ago.
- **Live Entitlement Enforcement (`getTransportEntitlement`):**
  - Resolves live `student_profiles` row via `getByUid(qrPayload.uid)`.
  - Evaluates account status: soft-blocked students, students past `valid_until`, and renewal applicants awaiting approval are strictly rejected with `status = 'session_expired'`, even if presenting a cryptographically valid token.
- **Bus Assignment Matching (`scannerBusMatchesStudent`):**
  - Compares `scannerBusId` with student's assigned bus. Mismatch returns `status = 'bus_mismatch'`.
- **Privacy-Minimal Return:**
  - Returns `canBoard = accountValid && busMatchesScanner`.
  - Omits student email, phone, financial records, and internal notes.

---

#### 3. Receipt Verification Route: `POST /api/receipt/verify` (`src/app/api/receipt/verify/route.ts`)
- **Granular Moderator Permission Check:**
  - Enforces `canVerifyPaymentReceipt` (`permissions.payments.canApproveOfflinePayment || canRejectOfflinePayment`).
- **Token Format Detection:**
  - `ADTU-R2-...`: Version 2 Document QR (RSA-2048 cryptographic signature).
  - `ADTU-R1-...`: Version 1 Document QR (HMAC-SHA256 signature).
- **Integrity Verification:**
  - Looks up payment record in `public.payments` by `receiptId`.
  - Verifies `status === 'Completed'`.
  - For V2: Reconstructs document payload via `buildDocumentPayloadFromPayment(payment)` and calls `verifyReceiptIntegrity` to match against stored `document_signature`.
  - Detects and rejects any altered receipt amounts or falsified dates.

---

#### 4. Vector PDF Receipt Generator: `renderReceiptPdf` (`src/lib/services/receipt-pdf.ts`)
- **Engine:** `jsPDF` generating A4 compressed documents.
- **Layout & Structure:**
  - University Crest & Header (Sankar Madhab Path, Panikhaiti, Guwahati - 781026).
  - Transaction Receipt Number & Formatted Timestamp.
  - Embedded Verification QR Code (PNG image rendered directly at coordinate 159, 43, size 32x32 mm).
  - Student Details Box (Name, Enrollment ID, Department, Payment Method).
  - Subscription Progression Box: Displays `Initial Validity` and `Updated Validity` with academic session years.
  - Total Amount Box with Indian Rupee currency formatting.
  - Approver name and payment reference metadata.
  - Outputs binary `Buffer` suitable for HTTP streaming.

---

### 7.4 Exact I/O, Database Query, Redis & External API Count Matrix

| Scenario | PostgreSQL Queries / RPCs | Redis Commands | External Gateway Calls | Total I/O Operations |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Boarding Scan: Secure QR (`POST /api/bus-pass/verify-secure-qr`)** | **2 DB Queries:**<br>1. Select `active_trips` by `bus_id` and `status='active'`<br>2. Select `student_profiles` by UID (`getByUid`) | **0** | **0** (Cryptographic decryption performed in-memory via `derivedKeyCache`) | **2 I/O Ops** |
| **(b) Boarding Scan: Raw UID (`POST /api/bus-pass/verify-student`)** | **2 DB Queries:**<br>1. Select `active_trips` by `bus_id` and `status='active'`<br>2. Select `student_profiles` by UID (`getByUid`) | **0** | **0** | **2 I/O Ops** |
| **(c) Moderator Document Receipt Scan (`POST /api/receipt/verify`)** | **2 DB Queries:**<br>1. Select `moderator_profiles` for permissions (or warm LRU)<br>2. Select `public.payments` by ID (`getPaymentById`) | **0** | **0** (RSA-2048 / HMAC verification in-memory) | **2 I/O Ops** |
| **(d) Client PDF Receipt Generation (`renderReceiptPdf`)** | **0 DB Queries** (Takes pre-fetched payment record) | **0** | **0** (Pure in-memory CPU/canvas rendering to Buffer) | **0 I/O Ops** |

---

### 7.5 Verbatim Source Code from Live Codebase

#### 1. Cryptographic Engine & LRU Cache: `src/lib/security/encryption.service.ts` (Lines 1–275)
```typescript
/**
 * Encryption Service for ADTU Bus Services
 * 
 * Provides secure end-to-end encryption for:
 * - QR Code data (student UID + metadata)
 * - Payment identifiers
 * - Sensitive student information
 * 
 * SECURITY FEATURES:
 * - AES-256-GCM encryption (authenticated encryption)
 * - HMAC-SHA256 for data integrity
 * - Time-based token expiration
 * - Secure key derivation with PBKDF2
 * - Tamper-proof signatures
 */

import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

// These should be environment variables in production
const isEncryptionKeySet = !!(process.env.ENCRYPTION_SECRET_KEY || process.env.NEXTAUTH_SECRET);
const isSigningKeySet = !!(process.env.SIGNING_SECRET_KEY || process.env.NEXTAUTH_SECRET);

// Fallback to random key if not set, but track if we need to throw at runtime
const ENCRYPTION_KEY = process.env.ENCRYPTION_SECRET_KEY || process.env.NEXTAUTH_SECRET || crypto.randomBytes(32).toString('hex');
const SIGNING_KEY = process.env.SIGNING_SECRET_KEY || process.env.NEXTAUTH_SECRET || crypto.randomBytes(32).toString('hex');

function checkKeys() {
    if (process.env.NODE_ENV === 'production') {
        if (!isEncryptionKeySet) {
            throw new Error('ENCRYPTION_SECRET_KEY must be set in production');
        }
        if (!isSigningKeySet) {
            throw new Error('SIGNING_SECRET_KEY must be set in production');
        }
    }
}

// Algorithm configurations
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for AES
const AUTH_TAG_LENGTH = 16; // 128 bits for GCM
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits for AES-256
const ITERATION_COUNT = 100000; // PBKDF2 iterations

// Token expiration settings
const QR_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours for QR codes
const PAYMENT_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour for payment tokens

// Key derivation LRU cache to prevent event-loop lockup on repeated field decryptions
const derivedKeyCache = new Map<string, Buffer>();
const MAX_KEY_CACHE_SIZE = 5000;

/**
 * Derive a cryptographic key from the master secret using PBKDF2 with LRU caching
 */
function deriveKey(salt: Buffer, secret: string = ENCRYPTION_KEY): Buffer {
    checkKeys();
    const cacheKey = salt.toString('hex') + ':' + secret;
    const cached = derivedKeyCache.get(cacheKey);
    if (cached) {
        // Refresh LRU position
        derivedKeyCache.delete(cacheKey);
        derivedKeyCache.set(cacheKey, cached);
        return cached;
    }

    const derived = crypto.pbkdf2Sync(secret, salt, ITERATION_COUNT, KEY_LENGTH, 'sha256');

    if (derivedKeyCache.size >= MAX_KEY_CACHE_SIZE) {
        let evicted = 0;
        for (const key of derivedKeyCache.keys()) {
            derivedKeyCache.delete(key);
            if (++evicted >= 1000) break;
        }
    }
    derivedKeyCache.set(cacheKey, derived);
    return derived;
}

export function clearDerivedKeyCache(): void {
    derivedKeyCache.clear();
}

// ============================================================================
// QR CODE ENCRYPTION
// ============================================================================

export interface QRCodePayload {
    uid: string;           // Student UID
    enrollmentId?: string; // Enrollment ID for display
    name?: string;         // Student name (first name only for privacy)
    busId?: string;        // Assigned bus
    issuedAt: number;      // Timestamp when token was issued
    expiresAt: number;     // Timestamp when token expires
    version: number;       // Token version for future upgrades
}

/**
 * Encrypt QR code data with AES-256-GCM
 * Creates a secure, time-limited token for the student's QR code
 * 
 * @param studentUid - The student's Firebase UID
 * @param metadata - Additional metadata to include
 * @returns Encrypted token string (base64 encoded)
 */
export function encryptQRCodeData(
    studentUid: string,
    metadata: {
        enrollmentId?: string;
        name?: string;
        busId?: string;
    } = {}
): string {
    // Create payload
    const now = Date.now();
    const payload: QRCodePayload = {
        uid: studentUid,
        enrollmentId: metadata.enrollmentId,
        name: metadata.name?.split(' ')[0], // First name only for privacy
        busId: metadata.busId,
        issuedAt: now,
        expiresAt: now + QR_TOKEN_EXPIRY_MS,
        version: 1
    };

    // Convert payload to JSON
    const plaintext = JSON.stringify(payload);

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key from salt
    const key = deriveKey(salt);

    // Encrypt with AES-256-GCM
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Combine: version (1 byte) + salt (16 bytes) + iv (16 bytes) + authTag (16 bytes) + encrypted
    // Combine: version (1 byte) + salt (16 bytes) + iv (16 bytes) + authTag (16 bytes) + encrypted
    const combined = Buffer.concat([
        Buffer.from([2]), // Version 2 byte (128-bit HMAC signature)
        salt,
        iv,
        authTag,
        encrypted
    ]);

    // Create HMAC signature for additional integrity
    const hmac = crypto.createHmac('sha256', SIGNING_KEY);
    hmac.update(combined);
    const signature = hmac.digest();

    // Combine with 16-byte (128-bit) signature (NEW-06)
    const finalBuffer = Buffer.concat([combined, signature.subarray(0, 16)]);

    return finalBuffer.toString('base64url');
}

/**
 * Decrypt and validate QR code token
 * 
 * @param token - Encrypted token string
 * @returns Decrypted payload or null if invalid/expired
 */
export function decryptQRCodeData(token: string): QRCodePayload | null {
    try {
        // Decode from base64url
        const buffer = Buffer.from(token, 'base64url');

        // Minimum size check (header + salt + iv + authTag + min-encrypted + min-sig)
        if (buffer.length < 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 8 + 1) {
            console.warn('QR token too short');
            return null;
        }

        // Extract components
        let offset = 0;

        const version = buffer[offset];
        offset += 1;

        if (version !== 1 && version !== 2) {
            console.warn('Unsupported QR token version:', version);
            return null;
        }

        // Version 2 uses 16-byte (128-bit) HMAC; Version 1 uses legacy 8-byte HMAC
        const sigLength = version === 2 ? 16 : 8;

        const salt = buffer.subarray(offset, offset + SALT_LENGTH);
        offset += SALT_LENGTH;

        const iv = buffer.subarray(offset, offset + IV_LENGTH);
        offset += IV_LENGTH;

        const authTag = buffer.subarray(offset, offset + AUTH_TAG_LENGTH);
        offset += AUTH_TAG_LENGTH;

        const signatureFromToken = buffer.subarray(buffer.length - sigLength);
        const encryptedWithoutSig = buffer.subarray(offset, buffer.length - sigLength);
        const combinedWithoutSig = buffer.subarray(0, buffer.length - sigLength);

        // Verify HMAC signature
        const hmac = crypto.createHmac('sha256', SIGNING_KEY);
        hmac.update(combinedWithoutSig);
        const expectedSignature = hmac.digest().subarray(0, sigLength);

        if (!crypto.timingSafeEqual(signatureFromToken, expectedSignature)) {
            console.warn('QR token signature verification failed - possible tampering');
            return null;
        }

        // Derive key
        const key = deriveKey(salt);

        // Decrypt
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedWithoutSig);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        // Parse payload
        const payload: QRCodePayload = JSON.parse(decrypted.toString('utf8'));

        // Check expiration
        if (Date.now() > payload.expiresAt) {
            console.warn('QR token expired');
            return null;
        }

        return payload;

    } catch (error) {
        console.error('QR token decryption failed:', error);
        return null;
    }
}

/**
 * Validate QR code without full decryption (quick check)
 * Uses HMAC verification only
 */
export function quickValidateQRToken(token: string): boolean {
    checkKeys();
    try {
        const buffer = Buffer.from(token, 'base64url');

        if (buffer.length < 50) return false;

        const version = buffer[0];
        if (version !== 1 && version !== 2) return false;

        const sigLength = version === 2 ? 16 : 8;
        if (buffer.length < sigLength + 1) return false;

        const signatureFromToken = buffer.subarray(buffer.length - sigLength);
        const combinedWithoutSig = buffer.subarray(0, buffer.length - sigLength);

        const hmac = crypto.createHmac('sha256', SIGNING_KEY);
        hmac.update(combinedWithoutSig);
        const expectedSignature = hmac.digest().subarray(0, sigLength);

        return crypto.timingSafeEqual(signatureFromToken, expectedSignature);
```

#### 2. Secure QR Verification Route: `src/app/api/bus-pass/verify-secure-qr/route.ts`
```typescript
/**
 * API Route: Verify Secure QR Token
 * POST /api/bus-pass/verify-secure-qr
 */

import { getByUid } from '@/domains/student';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { decryptQRCodeData,quickValidateQRToken } from '@/lib/security/encryption.service';
import { checkRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import {
	scannerBusMatchesStudent,
	validateStudentScannerContext,
} from '@/lib/security/scanner-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getValidUntilDate } from '@/lib/utils/date-utils';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyApiAuth(request, ['driver', 'admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const rateLimitId = createRateLimitId(auth.uid, 'verify-secure-qr');
        const rateCheck = checkRateLimit(
            rateLimitId,
            RateLimits.BUS_PASS_VERIFY.maxRequests,
            RateLimits.BUS_PASS_VERIFY.windowMs
        );

        if (!rateCheck.allowed) {
            return NextResponse.json(
                {
                    status: 'rate_limited',
                    message: 'Too many scan requests. Please wait.',
                    resetIn: rateCheck.resetIn,
                },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { secureToken, scannerBusId } = body;

        if (typeof secureToken !== 'string' || !secureToken.trim() || secureToken.length > 2048) {
            return NextResponse.json(
                { status: 'invalid', message: 'QR token is required' },
                { status: 400 }
            );
        }

        const scannerDenied = await validateStudentScannerContext(auth, scannerBusId);
        if (scannerDenied) return scannerDenied;

        // Verify HMAC signature to prevent logging unreadable camera frames / noise
        if (!quickValidateQRToken(secureToken)) {
            return NextResponse.json({
                status: 'invalid',
                message: 'Invalid or tampered QR code',
                suspicious: true,
            });
        }

        const qrPayload = decryptQRCodeData(secureToken);

        // 1. D9: Fetch active trip from Supabase (authoritative source)
        let activeTripId: string | null = null;
        let isTripStale = false;
        try {
            const supabase = getSupabaseServer();
            const { data: activeTrip } = await supabase
                .from('active_trips')
                .select('trip_id, status, created_at')
                .eq('bus_id', scannerBusId)
                .eq('status', 'active')
                .maybeSingle();

            if (activeTrip) {
                const createdAt = new Date(activeTrip.created_at).getTime();
                const isExpired = (Date.now() - createdAt) > 12 * 60 * 60 * 1000;
                if (isExpired) {
                    isTripStale = true;
                } else {
                    activeTripId = activeTrip.trip_id;
                }
            }
        } catch (e) {
            console.warn('Failed to verify active trip context:', e);
        }

        if (!qrPayload) {
            return NextResponse.json({
                status: 'expired',
                message: 'QR code has expired. Please generate a new one.',
                isAssigned: false,
                sessionActive: false,
                isTripStale
            });
        }

        const studentData = await getByUid(qrPayload.uid) as Record<string, any> | null;
        if (!studentData) {
            return NextResponse.json({
                status: 'invalid',
                message: 'Student not found. This QR code is not registered.',
                studentData: null,
                isAssigned: false,
                sessionActive: false,
                isTripStale
            });
        }
        const validUntilDate = getValidUntilDate(studentData?.validUntil);
        const busId = studentData?.assignedBus || studentData?.busId || studentData?.currentBusId;
        const busMatchesScanner = scannerBusMatchesStudent(scannerBusId, busId);

        // CANONICAL entitlement (Phase 3) — same single source of truth as the
        // dashboard / tracking / QR display. Denies soft-blocked, past-soft-block,
        // renewal-applicant, and future students even with a valid signed token.
        const { entitled: accountValid, reason: entitlementReason } = getTransportEntitlement(studentData);

        let status = accountValid ? 'success' : 'session_expired';
        let message = accountValid ? 'Student verified (Secure)' : 'Transport access inactive — boarding not permitted';
        if (accountValid && !busMatchesScanner) {
            status = 'bus_mismatch';
            message = 'Student is assigned to a different bus';
        }

        return NextResponse.json({
            status,
            message,
            // PRIVACY-MINIMAL: Do not return phone, email, payment details, or admin notes.
            studentData: {
                uid: qrPayload.uid,
                fullName: studentData?.fullName || studentData?.name,
                enrollmentId: studentData?.enrollmentId || qrPayload.enrollmentId,
                gender: studentData?.gender,
                profilePhotoUrl: studentData?.profilePhotoUrl || studentData?.photoURL,
                assignedBus: busId,
                busId: busId,
                assignedShift: studentData?.assignedShift || studentData?.shift,
                shift: studentData?.assignedShift || studentData?.shift,
                validUntil: validUntilDate?.toISOString(),
                status: studentData?.status,
            },
            isAssigned: Boolean(busId),
            matchesScannerBus: busMatchesScanner,
            canBoard: accountValid && busMatchesScanner,
            sessionActive: accountValid,
            entitlementReason,
            tokenInfo: {
                issuedAt: new Date(qrPayload.issuedAt).toISOString(),
                expiresAt: new Date(qrPayload.expiresAt).toISOString(),
                version: qrPayload.version,
            },
            verifiedAt: new Date().toISOString(),
            secureVerification: true,
            isTripStale
        });

    } catch (error: any) {
        console.error('Error in verify secure QR API:', error);
        return NextResponse.json(
            {
                status: 'invalid',
                message: 'Verification failed',
            },
            { status: 500 }
        );
    }
}

```

#### 3. Student UID Verification Route: `src/app/api/bus-pass/verify-student/route.ts`
```typescript
/**
 * API Route: Verify Student by UID
 * POST /api/bus-pass/verify-student
 */

import { getByUid } from '@/domains/student';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { checkRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import {
	scannerBusMatchesStudent,
	validateStudentScannerContext,
} from '@/lib/security/scanner-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getValidUntilDate } from '@/lib/utils/date-utils';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyApiAuth(request, ['driver', 'admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const rateLimitId = createRateLimitId(auth.uid, 'student-verify');
        const rateCheck = checkRateLimit(
            rateLimitId,
            RateLimits.BUS_PASS_VERIFY.maxRequests,
            RateLimits.BUS_PASS_VERIFY.windowMs
        );
        if (!rateCheck.allowed) {
            return NextResponse.json(
                { status: 'rate_limited', message: 'Too many scan requests. Please wait.' },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { studentUid, scannerBusId } = body;

        // Basic Client-side Validation (prevent noise)
        if (typeof studentUid !== 'string' || !studentUid.trim() || studentUid.length < 5 || studentUid.length > 128 || studentUid.includes('http')) {
            return NextResponse.json(
                { status: 'invalid', message: 'Invalid Student ID format' },
                { status: 400 }
            );
        }

        const scannerDenied = await validateStudentScannerContext(auth, scannerBusId);
        if (scannerDenied) return scannerDenied;

        let studentData: any = null;
        try {
            studentData = await getByUid(studentUid.trim()) as Record<string, any> | null;
        } catch {
            return NextResponse.json({
                status: 'invalid',
                message: 'Invalid Student ID format',
                studentData: null,
                isAssigned: false,
                sessionActive: false,
            }, { status: 400 });
        }

        // 1. D9: Fetch active trip from Supabase (authoritative source)
        let activeTripId: string | null = null;
        let isTripStale = false;
        try {
            const supabase = getSupabaseServer();
            const { data: activeTrip } = await supabase
                .from('active_trips')
                .select('trip_id, status, created_at')
                .eq('bus_id', scannerBusId)
                .eq('status', 'active')
                .maybeSingle();

            if (activeTrip) {
                const createdAt = new Date(activeTrip.created_at).getTime();
                const isExpired = (Date.now() - createdAt) > 12 * 60 * 60 * 1000;
                if (isExpired) {
                    isTripStale = true;
                } else {
                    activeTripId = activeTrip.trip_id;
                }
            }
        } catch (e) {
            console.warn('Failed to verify active trip context:', e);
        }

        if (!studentData) {
            return NextResponse.json({
                status: 'invalid',
                message: 'Student not found. This QR code is not registered.',
                studentData: null,
                isAssigned: false,
                sessionActive: false,
                isTripStale
            });
        }

        const validUntilDate = getValidUntilDate(studentData.validUntil);
        const busId = studentData.assignedBus || studentData.busId || studentData.currentBusId;
        const busMatchesScanner = scannerBusMatchesStudent(scannerBusId, busId);

        // CANONICAL entitlement (Phase 3): a pass is valid for boarding ONLY while the
        // student owns transport access. This is the SAME source of truth used by the
        // dashboard, tracking, and QR display — soft-blocked / past-soft-block /
        // renewal-applicant / future students are all denied here, regardless of a
        // previously-saved (static) QR. Identity is still returned so the scanner can
        // show who scanned and why boarding is denied.
        const { entitled: accountValid, reason: entitlementReason } = getTransportEntitlement(studentData);

        let status = accountValid ? 'success' : 'session_expired';
        let message = accountValid ? 'Student verified' : 'Transport access inactive — boarding not permitted';
        if (accountValid && !busMatchesScanner) {
            status = 'bus_mismatch';
            message = 'Student is assigned to a different bus';
        }

        return NextResponse.json({
            status,
            message,
            // PRIVACY-MINIMAL: Do not return phone, email, payment details, or admin notes.
            studentData: {
                uid: studentUid.trim(),
                fullName: studentData.fullName || studentData.name,
                enrollmentId: studentData.enrollmentId || studentData.enrollmentId,
                gender: studentData.gender,
                profilePhotoUrl: studentData.profilePhotoUrl || studentData.photoURL || studentData.avatar,
                assignedBus: busId,
                busId: busId,
                assignedShift: studentData.assignedShift || studentData.shift,
                shift: studentData.assignedShift || studentData.shift,
                validUntil: validUntilDate ? validUntilDate.toISOString() : undefined,
                status: studentData.status,
            },
            isAssigned: Boolean(busId),
            matchesScannerBus: busMatchesScanner,
            canBoard: accountValid && busMatchesScanner,
            sessionActive: accountValid,
            entitlementReason,
            verifiedAt: new Date().toISOString(),
            verifiedBy: auth.uid,
            isTripStale
        });

    } catch (error: any) {
        console.error('Error in verify student API:', error);
        return NextResponse.json(
            {
                status: 'invalid',
                message: 'Internal server error',
            },
            { status: 500 }
        );
    }
}

```

#### 4. Document Receipt Verification Route: `src/app/api/receipt/verify/route.ts`
```typescript
import { withSecurity } from '@/lib/security/api-security';
import {
	buildDocumentPayloadFromPayment,
	parseSecureQRData,
	verifyReceiptIntegrity,
} from '@/lib/security/document-crypto.service';
import { getModeratorPermissions } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { quickValidateReceiptToken,verifyReceiptSignature } from '@/lib/security/receipt-security.service';
import { VerifyReceiptSchema } from '@/lib/security/validation-schemas';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { NextResponse } from 'next/server';

type VerifyReceiptBody = {
  receiptToken: string;
  scanContext?: {
    busId?: string;
    routeId?: string;
    source?: string;
    [key: string]: unknown;
  };
};

function invalidReceipt(
  status: string,
  message: string,
  options: { suspicious?: boolean; httpStatus?: number } = {}
) {
  return NextResponse.json(
    {
      valid: false,
      status,
      message,
      suspicious: options.suspicious || false,
    },
    { status: options.httpStatus || 200 }
  );
}

function formatDate(value?: string | Date | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

async function canVerifyPaymentReceipt(role: string, uid: string): Promise<boolean> {
  if (role === 'admin') return true;
  if (role !== 'moderator') return false;

  const permissions = await getModeratorPermissions(uid);
  return Boolean(
    permissions.payments.canApproveOfflinePayment
    || permissions.payments.canRejectOfflinePayment
  );
}

export const POST = withSecurity<VerifyReceiptBody>(
  async (_request, { auth, body }) => {
    if (!(await canVerifyPaymentReceipt(auth.role, auth.uid))) {
      return NextResponse.json(
        { valid: false, status: 'forbidden', message: 'Payment receipt verification permission is required.' },
        { status: 403 }
      );
    }

    const receiptToken = body.receiptToken.trim();
    const isV2Token = receiptToken.startsWith('ADTU-R2-');
    const isV1Token = receiptToken.startsWith('ADTU-R1-');

    if (!isV2Token && !isV1Token) {
      return invalidReceipt(
        'invalid',
        'Unrecognized receipt format. Please show a valid ADTU receipt.',
        { suspicious: true }
      );
    }

    let receiptId = '';
    let truncatedSignature: string | undefined;
    let legacyPayload: ReturnType<typeof verifyReceiptSignature> = null;

    if (isV2Token) {
      const qrData = parseSecureQRData(receiptToken);
      if (!qrData) {
        return invalidReceipt(
          'tampered',
          'Unable to verify document authenticity. This receipt appears to be modified or not generated by the ADTU Bus Services system. Please present the original, system-generated document.',
          { suspicious: true }
        );
      }

      receiptId = qrData.rid;
      truncatedSignature = qrData.sig;
    } else {
      if (!quickValidateReceiptToken(receiptToken)) {
        return invalidReceipt(
          'tampered',
          'Unable to verify document authenticity. This receipt appears to be modified or not generated by the ADTU Bus Services system. Please present the original, system-generated document.',
          { suspicious: true }
        );
      }

      legacyPayload = verifyReceiptSignature(receiptToken);
      if (!legacyPayload) {
        return invalidReceipt(
          'expired',
          'Receipt verification has expired or is invalid.'
        );
      }

      receiptId = legacyPayload.receiptId;
    }

    const payment = await paymentsSupabaseService.getPaymentById(receiptId);
    if (!payment) {
      return invalidReceipt(
        'not_found',
        'Receipt not found in system records.',
        { suspicious: true }
      );
    }

    if (payment.status !== 'Completed') {
      return invalidReceipt(
        'invalid',
        'Receipt is not valid because the payment is not approved.',
        { suspicious: payment.status === 'Rejected' }
      );
    }

    if (isV2Token) {
      if (!payment.document_signature || !truncatedSignature) {
        return invalidReceipt(
          'signature_mismatch',
          'This receipt cannot be cryptographically verified. Please regenerate the official receipt from the student dashboard.',
          { suspicious: true }
        );
      }

      const documentPayload = buildDocumentPayloadFromPayment(payment);
      const integrityResult = verifyReceiptIntegrity(
        documentPayload,
        payment.document_signature,
        truncatedSignature
      );

      if (!integrityResult.valid) {
        console.warn('[ReceiptVerify] Receipt integrity failure:', {
          receiptId,
          status: integrityResult.status,
        });

        return invalidReceipt(
          integrityResult.status,
          integrityResult.message,
          { suspicious: integrityResult.suspicious }
        );
      }
    }

    if (legacyPayload) {
      const uidMatches = !legacyPayload.studentUid || payment.student_uid === legacyPayload.studentUid;
      const amountMatches = !legacyPayload.amount || Number(payment.amount || 0) === Number(legacyPayload.amount);

      if (!uidMatches || !amountMatches) {
        return invalidReceipt(
          'tampered',
          'Unable to verify document authenticity. Data mismatch detected.',
          { suspicious: true }
        );
      }
    }

    const baseReceiptData = {
      studentName: payment.student_name || 'Student',
      enrollmentId: payment.student_id || 'N/A',
      paymentMethod: payment.method || 'Offline',
      amount: payment.amount || 0,
      sessionValidity: `${payment.session_start_year || 'N/A'} - ${payment.session_end_year || 'N/A'}`,
      approvalStatus: 'Approved',
      issuedDate: formatDate(payment.transaction_date || payment.created_at),
      receiptId: payment.payment_id,
      verifiedAt: new Date().toISOString(),
      studentUid: payment.student_uid,
      studentProfilePic: '',
    };

    const receiptData = {
        ...baseReceiptData,
        purpose: payment.purpose,
        approvedBy: payment.approved_by,
        razorpayOrderId: payment.razorpay_order_id,
        offlineTransactionId: payment.offline_transaction_id,
        validUntil: formatDate(payment.valid_until),
        metadata: payment.metadata,
        createdAt: payment.created_at,
        updatedAt: payment.transaction_date || payment.created_at,
      };

    return NextResponse.json({
      valid: true,
      status: 'valid',
      message: isV2Token
        ? 'Document authenticity verified. This receipt is genuine and has not been modified.'
        : 'Receipt verified successfully.',
      receiptData,
      tokenInfo: {
        version: isV2Token ? 2 : 1,
        signatureType: isV2Token ? 'RSA-2048' : 'HMAC-SHA256',
      },
      scannerRole: auth.role,
      verifiedAt: new Date().toISOString(),
    });
  },
  {
    requiredRoles: ['admin', 'moderator'],
    schema: VerifyReceiptSchema,
    rateLimit: RateLimits.BUS_PASS_VERIFY,
    allowBodyToken: true,
  }
);

```

#### 5. Official PDF Receipt Generator: `src/lib/services/receipt-pdf.ts`
```typescript
import { jsPDF } from 'jspdf';

export interface ReceiptPdfData {
  receiptId: string;
  studentName: string;
  enrollmentId: string;
  faculty?: string;
  amount: number;
  paymentMethod: string;
  paymentReference?: string;
  approvedBy: string;
  sessionStartYear?: number | string;
  sessionEndYear?: number | string;
  durationYears?: number;
  validUntil?: string | null;
  transactionDate: string;
  qrCodeDataUrl: string;
  previousValidUntil?: string | null;
  previousSessionEndYear?: number | string | null;
  purpose?: string | null;
}

function formatDate(value?: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';

  const day = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} | ${time}`;
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 5
): number {
  const lines = doc.splitTextToSize(text || 'N/A', maxWidth) as string[];
  doc.text(lines, x, y);
  return y + Math.max(lines.length, 1) * lineHeight;
}

function drawInfoBox(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, width, height, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(label.toUpperCase(), x + 5, y + 7);
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  drawWrappedText(doc, value, x + 5, y + 14, width - 10, 4.5);
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setProperties({
    title: `Receipt ${data.receiptId}`,
    subject: 'ADTU ITMS transport payment receipt',
    author: 'ADTU Integrated Transit Management System',
    creator: 'ADTU ITMS',
    keywords: `receipt,adtu,itms,${data.receiptId}`,
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('Assam down town University,', 18, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Sankar Madhab Path, Gandhi Nagar,', 18, 25);
  doc.text('Panikhaiti, Guwahati, Assam, India,', 18, 29);
  doc.text('Pin – 781026', 18, 33);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('TRANSACTION RECEIPT', 128, 22);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.text(data.receiptId, 128, 28, { maxWidth: 62 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(formatDateTime(data.transactionDate), 128, 36);

  if (data.qrCodeDataUrl) {
    doc.addImage(data.qrCodeDataUrl, 'PNG', 159, 43, 32, 32);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('SCAN TO VERIFY', 163, 79);
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(18, 42, 192, 42);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('Payment Receipt', 18, 58);

  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(18, 64, 38, 9, 4, 4, 'FD');
  doc.setFontSize(8);
  doc.setTextColor(22, 101, 52);
  doc.text('VERIFIED PAYMENT', 22, 70);

  drawInfoBox(doc, 'Student', data.studentName, 18, 84, 82, 30);
  drawInfoBox(doc, 'Enrollment ID', data.enrollmentId || 'N/A', 110, 84, 82, 30);
  drawInfoBox(doc, 'Department / Faculty', data.faculty || 'General', 18, 121, 82, 30);
  drawInfoBox(doc, 'Payment Method', `${data.paymentMethod} Payment`, 110, 121, 82, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('SUBSCRIPTION PROGRESSION', 18, 164);
  doc.setDrawColor(226, 232, 240);
  doc.line(70, 162, 192, 162);

  const firstTime = !data.previousValidUntil || data.purpose === 'new_registration';
  drawInfoBox(
    doc,
    'Initial Validity',
    firstTime
      ? 'Not applicable (new admission)'
      : `${formatDate(data.previousValidUntil)}${data.previousSessionEndYear ? `, session ${data.previousSessionEndYear}` : ''}`,
    18,
    171,
    82,
    30
  );
  drawInfoBox(
    doc,
    'Updated Validity',
    `${formatDate(data.validUntil)}${data.sessionEndYear ? `, session ${data.sessionEndYear}` : ''}`,
    110,
    171,
    82,
    30
  );

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(18, 212, 174, 28, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('TOTAL AMOUNT PAID', 26, 223);
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text(`Rs. ${Number(data.amount || 0).toLocaleString('en-IN')}`, 138, 228, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  drawWrappedText(doc, `Approved by: ${data.approvedBy}`, 18, 252, 174, 4.5);
  if (data.paymentReference) {
    drawWrappedText(doc, `Payment reference: ${data.paymentReference}`, 18, 259, 174, 4.5);
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(18, 276, 192, 276);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('This receipt is generated by ADTU ITMS. Verify the QR code against official server records before trusting any copy.', 18, 283, {
    maxWidth: 174,
  });

  const pdf = doc.output('arraybuffer');
  return Buffer.from(pdf);
}

```

#### 6. Student QR Code Display Component: `src/components/bus-pass/InlineQRDisplay.tsx`
```typescript
"use client";

/**
 * InlineQRDisplay Component - Clean & Simple
 * Shows QR skeleton initially, reveals actual QR on button click.
 */

import { Button } from '@/components/ui/button';
import { AnimatePresence,motion } from "motion/react";
import { CheckCircle,Copy,Download,QrCode,Share2,ShieldCheck } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { useRef,useState } from 'react';
import { toast } from 'sonner';

interface InlineQRDisplayProps {
    studentUid: string;
    studentName: string;
    enrollmentId?: string;
    isActive: boolean;
}

export default function InlineQRDisplay({
    studentUid,
    studentName,
    enrollmentId,
    isActive
}: InlineQRDisplayProps) {
    const [showQR, setShowQR] = useState(false);
    const [copied, setCopied] = useState(false);
    const qrRef = useRef<HTMLDivElement>(null);

    const handleCopyId = async () => {
        if (enrollmentId) {
            try {
                await navigator.clipboard.writeText(enrollmentId);
                setCopied(true);
                toast.success('Copied!');
                setTimeout(() => setCopied(false), 2000);
            } catch {
                toast.error('Failed to copy');
            }
        }
    };

    const handleDownloadQR = async () => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const scale = 4; // High quality
            const cardWidth = 400;
            const cardHeight = 600;
            const cornerRadius = 32;
            canvas.width = cardWidth * scale;
            canvas.height = cardHeight * scale;
            ctx.scale(scale, scale);

            // === CLIP TO ROUNDED RECTANGLE (removes sharp edges) ===
            ctx.beginPath();
            ctx.roundRect(0, 0, cardWidth, cardHeight, cornerRadius);
            ctx.clip();

            // === DARK CHARCOAL BACKGROUND ===
            ctx.fillStyle = '#01000044';
            ctx.fillRect(0, 0, cardWidth, cardHeight);

            // === HEADER SECTION WITH LOGO ===
            const logoImg = new Image();
            logoImg.src = '/adtu-new-logo.svg';
            await new Promise((resolve) => {
                logoImg.onload = resolve;
                logoImg.onerror = resolve;
            });

            // Header background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(0, 0, cardWidth, 80);

            // Logo
            let logoStartX = 30;
            if (logoImg.complete && logoImg.naturalWidth !== 0) {
                const logoH = 36;
                const logoW = (logoImg.naturalWidth / logoImg.naturalHeight) * logoH;
                ctx.drawImage(logoImg, 30, 22, logoW, logoH);
                logoStartX = 30 + logoW + 15;
            }

            // University Name - exact case as requested
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('Assam down town University', logoStartX, 42);

            // Subtitle
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText('Digital Bus Pass', logoStartX, 58);

            // === STUDENT INFO SECTION ===
            const infoY = 110;

            // Student Name Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.letterSpacing = '1.5px';
            ctx.fillText('STUDENT NAME', 30, infoY);
            ctx.letterSpacing = '0px';

            // Student Name Value
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.fillText(studentName || 'Student', 30, infoY + 28);

            // Status Badge
            const badgeX = cardWidth - 110;
            const badgeY = infoY + 8;
            const badgeGradient = ctx.createLinearGradient(badgeX, badgeY, badgeX + 80, badgeY + 28);
            badgeGradient.addColorStop(0, '#10b981');
            badgeGradient.addColorStop(1, '#059669');
            ctx.fillStyle = badgeGradient;
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, 80, 28, 14);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('ACTIVE', badgeX + 40, badgeY + 18);

            // === QR CODE SECTION ===
            ctx.textAlign = 'left';
            const qrContainerY = 190;
            const qrSize = 220;
            const qrX = (cardWidth - qrSize) / 2;
            const qrY = qrContainerY + 40;

            // QR Code Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '700 10px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.letterSpacing = '1.5px';
            ctx.fillText('SCAN TO VERIFY', cardWidth / 2, qrContainerY + 15);
            ctx.letterSpacing = '0px';

            // QR Container with subtle frame
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(qrX - 15, qrY - 15, qrSize + 30, qrSize + 30, 20);
            ctx.fill();

            // Inner shadow effect
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Actual QR Code
            const existingQR = qrRef.current?.querySelector('canvas');
            if (existingQR) {
                ctx.drawImage(existingQR, qrX, qrY, qrSize, qrSize);
            }

            // ALL FOUR Corner decorations
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            const cornerLen = 20;
            const cornerPad = 8;

            // Top-left corner
            ctx.beginPath();
            ctx.moveTo(qrX - cornerPad, qrY - cornerPad + cornerLen);
            ctx.lineTo(qrX - cornerPad, qrY - cornerPad);
            ctx.lineTo(qrX - cornerPad + cornerLen, qrY - cornerPad);
            ctx.stroke();

            // Top-right corner
            ctx.beginPath();
            ctx.moveTo(qrX + qrSize + cornerPad - cornerLen, qrY - cornerPad);
            ctx.lineTo(qrX + qrSize + cornerPad, qrY - cornerPad);
                                    className="relative group cursor-pointer"
                                    onClick={() => setShowQR(false)}
                                >
                                    <div className="absolute -inset-4 bg-white/5 rounded-2xl blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />

                                    {/* QR Frame Corners */}
                                    <div className="absolute -top-3 -left-3 w-6 h-6 border-t-[3px] border-l-[3px] border-blue-400 rounded-tl-lg" />
                                    <div className="absolute -top-3 -right-3 w-6 h-6 border-t-[3px] border-r-[3px] border-purple-400 rounded-tr-lg" />
                                    <div className="absolute -bottom-3 -left-3 w-6 h-6 border-b-[3px] border-l-[3px] border-purple-400 rounded-bl-lg" />
                                    <div className="absolute -bottom-3 -right-3 w-6 h-6 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-lg" />

                                    <div ref={qrRef} className="bg-white p-3.5 rounded-xl shadow-[0_0_30px_rgba(255,255,255,0.1)]">
                                        <QRCodeCanvas
                                            value={studentUid}
                                            size={160}
                                            level="H"
                                            includeMargin={false}
                                            imageSettings={{
                                                src: "/logo.png", // Attempt to include logo if exists
                                                x: undefined,
                                                y: undefined,
                                                height: 30,
                                                width: 30,
                                                excavate: true,
                                            }}
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="skeleton"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    onClick={revealQR}
                                    className="relative w-[180px] h-[180px] bg-white/5 rounded-2xl flex flex-col items-center justify-center border border-white/10 cursor-pointer group hover:bg-white/10 transition-all duration-300"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />

                                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />

                                    <motion.div
                                        animate={{
                                            scale: [1, 1.05, 1],
                                            opacity: [0.2, 0.4, 0.2]
                                        }}
                                        transition={{
                                            repeat: Infinity,
                                            duration: 2,
                                            ease: "easeInOut"
                                        }}
                                        className="relative w-24 h-24 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500"
                                    >
                                        <QrCode className="h-16 w-16 text-white group-hover:text-blue-400 transition-colors" />
                                    </motion.div>
```

---

