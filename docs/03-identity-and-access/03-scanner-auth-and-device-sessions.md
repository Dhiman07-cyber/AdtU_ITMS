# Digital Student Boarding Pass & 4-Gate Scanner Verification Engine (Forensic Truth)

**Module:** Boarding Pass Generation, Dynamic QR Nonce Rotation, Single-Device Driver Lock & 4-Gate Gatekeeper  
**File Authority:** `src/app/driver/scanner/page.tsx`, `src/lib/services/scanner.service.ts`, `src/app/api/driver/verify-pass/route.ts`  
**Verification Gates:** Gate 1 (Cryptographic Signature), Gate 2 (Route/Bus Match), Gate 3 (Shift Time-Window), Gate 4 (Single-Ride Anti-Passback)  

---

# PART 6: Digital Student Boarding Pass Lifecycle & 4-Gate Scanner Verification

### 6.1 Sub-Domain Architecture & Exact Execution Pipeline

Every student boarding pass is cryptographically generated and signed. To guarantee offline durability and prevent ticket sharing, passes are protected by:
- **AES-256-GCM Authenticated Encryption**
- **PBKDF2 Key Derivation** with an in-memory 5,000-entry LRU cache
- **128-bit HMAC-SHA256 Signatures** (Version 2 payload)
- **4 Strict Verification Gates** (Tamper, Entitlement, 2-Tier Bus Match, Shift Compatibility)

```
Student Passes Mobile Screen to Conductor
                    │
                    ▼
Conductor Scans QR (/api/bus-pass/verify-secure-qr)
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│ GATE 1: Tamper & Integrity Check                      │
│ - quickValidateQRToken: Verifies 128-bit HMAC-SHA256   │
│ - decryptQRCodeData: Decrypts AES-256-GCM payload     │
│ - Validates 24-hour token expiry                       │
└───────────────────────────┬────────────────────────────┘
                            │ PASS
                            ▼
┌────────────────────────────────────────────────────────┐
│ GATE 2: Transport Entitlement Check                   │
│ - getTransportEntitlement(studentData)                 │
│ - Status must be 'active' (denies 'soft_blocked', etc.)│
│ - Checks validUntil date against server time           │
└───────────────────────────┬────────────────────────────┘
                            │ PASS
                            ▼
┌────────────────────────────────────────────────────────┐
│ GATE 3: 2-Tier Bus Match Verification                  │
│ - Resolves conductor's active bus from active_trips   │
│ - Fallback: checks buses.primary_driver_uid            │
│ - Matches student.busId with scannerBusId (or desk)    │
└───────────────────────────┬────────────────────────────┘
                            │ PASS
                            ▼
┌────────────────────────────────────────────────────────┐
│ GATE 4: Shift Compatibility Verification               │
│ - Checks active trip shift (Morning vs Evening)        │
│ - Rejects if student shift does not match trip shift   │
│   (Students with shift='Both' allowed on all trips)    │
└───────────────────────────┬────────────────────────────┘
                            │ PASS
                            ▼
           HTTP 200: { status: 'success', canBoard: true }
```

---

### 6.2 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/lib/security/encryption.service.ts (O(1) LRU & Secret Hash)
// ============================================================================

const derivedKeyCache = new Map<string, Buffer>();
const MAX_KEY_CACHE_SIZE = 5000;
const secretHashCache = new Map<string, string>();

function getSecretHash(secret: string): string {
    let hash = secretHashCache.get(secret);
    if (!hash) {
        hash = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
        secretHashCache.set(secret, hash);
    }
    return hash;
}

/**
 * Derive a cryptographic key from the master secret using PBKDF2 with LRU caching
 */
function deriveKey(salt: Buffer, secret: string = ENCRYPTION_KEY): Buffer {
    checkKeys();
    const cacheKey = `${salt.toString('hex')}:${getSecretHash(secret)}`;
    const cached = derivedKeyCache.get(cacheKey);
    if (cached) {
        // Refresh LRU position
        derivedKeyCache.delete(cacheKey);
        derivedKeyCache.set(cacheKey, cached);
        return cached;
    }

    const derived = crypto.pbkdf2Sync(secret, salt, ITERATION_COUNT, KEY_LENGTH, 'sha256');

    if (derivedKeyCache.size >= MAX_KEY_CACHE_SIZE) {
        const oldest = derivedKeyCache.keys().next().value;
        if (oldest) {
            derivedKeyCache.delete(oldest);
        }
    }
    derivedKeyCache.set(cacheKey, derived);
    return derived;
}

export function quickValidateQRToken(token: string): boolean {
    try {
        const buffer = Buffer.from(token, 'base64url');
        if (buffer.length < 50) return false;

        const version = buffer[0];
        if (version !== 1 && version !== 2) return false;

        const sigLength = version === 2 ? 16 : 8;
        if (buffer.length < sigLength + 1) return false;

        const signatureFromToken = buffer.subarray(buffer.length - sigLength);
        const combinedWithoutSig = buffer.subarray(0, buffer.length - sigLength);

        const hmac = crypto.createHmac('sha256', process.env.SIGNING_SECRET_KEY || '');
        hmac.update(combinedWithoutSig);
        const expectedSignature = hmac.digest().subarray(0, sigLength);

        if (signatureFromToken.length !== expectedSignature.length) return false;
        return crypto.timingSafeEqual(signatureFromToken, expectedSignature);
    } catch {
        return false;
    }
}
```

```typescript
// ============================================================================
// VERBATIM FROM src/lib/security/scanner-auth.ts (15s L1 Scanner Bus Cache)
// ============================================================================

interface CachedScannerBus {
  context: ResolvedScannerContext;
  expiresAtMs: number;
}

const scannerBusCache = new Map<string, CachedScannerBus>();

export function invalidateScannerBusCache(driverUid?: string): void {
  if (driverUid) {
    scannerBusCache.delete(driverUid);
    for (const k of Array.from(scannerBusCache.keys())) {
      if (k.startsWith(`${driverUid}:`)) {
        scannerBusCache.delete(k);
      }
    }
  } else {
    scannerBusCache.clear();
  }
}

export async function resolveScannerBusId(
  auth: { uid: string; role: string },
  inputScannerBusId?: string | null
): Promise<ResolvedScannerContext> {
  const normalizedInput = typeof inputScannerBusId === 'string' && inputScannerBusId.trim()
    ? inputScannerBusId.trim()
    : null;

  if (auth.role !== 'driver') {
    return {
      scannerBusId: normalizedInput,
      activeTripId: null,
      tripShift: null,
      isTripStale: false,
    };
  }

  // 15-second L1 cache: avoids querying active_trips on every burst boarding scan
  const cacheKey = `${auth.uid}:${normalizedInput || 'auto'}`;
  const now = Date.now();
  const cached = scannerBusCache.get(cacheKey);
  if (cached && now < cached.expiresAtMs) {
    return cached.context;
  }

  // ... queries active_trips and falls back to primary bus ...
  // Stores in scannerBusCache with 15s TTL and O(1) eviction
}
```

```typescript
// ============================================================================
// VERBATIM FROM src/app/api/bus-pass/verify-secure-qr/route.ts (Zero-DB Warm Path & 4 Gates)
// ============================================================================

        // 0-DB-READ WARM PATH: Check L1/L2 student assignment cache first
        const cachedStudent = await getCachedStudentAssignment(qrPayload.uid);
        let studentData: Record<string, any> | null = null;

        if (
            cachedStudent &&
            cachedStudent.busId &&
            cachedStudent.routeId &&
            cachedStudent.status
        ) {
            studentData = {
                uid: qrPayload.uid,
                id: qrPayload.uid,
                fullName: cachedStudent.fullName,
                name: cachedStudent.fullName,
                enrollmentId: cachedStudent.enrollmentId,
                gender: cachedStudent.gender,
                profilePhotoUrl: cachedStudent.profilePhotoUrl,
                photoURL: cachedStudent.profilePhotoUrl,
                assignedBus: cachedStudent.busId,
                busId: cachedStudent.busId,
                currentBusId: cachedStudent.busId,
                routeId: cachedStudent.routeId,
                route_id: cachedStudent.routeId,
                assignedShift: cachedStudent.shift,
                shift: cachedStudent.shift,
                assignedStop: cachedStudent.stopName,
                stop_name: cachedStudent.stopName,
                status: cachedStudent.status,
                softBlock: cachedStudent.softBlock,
                validUntil: cachedStudent.validUntil,
                hardBlock: cachedStudent.hardBlock,
            };
        } else {
            studentData = await getByUid(qrPayload.uid) as Record<string, any> | null;
        }

        const { entitled: accountValid, reason: entitlementReason } = getTransportEntitlement(studentData);

        const studentShiftRaw = String(studentData?.assignedShift || studentData?.shift || 'Morning');
        const studentShift = studentShiftRaw.toLowerCase();
        const tripShiftNorm = tripShift ? tripShift.toLowerCase() : null;
        const isShiftMismatch = isDeskCheckpointMode ? false : Boolean(tripShiftNorm && studentShift !== 'both' && studentShift !== tripShiftNorm);

        let rejectionCode: 'EXPIRED_PASS' | 'SOFT_BLOCKED' | 'WRONG_BUS' | 'SHIFT_MISMATCH' | null = null;

        if (studentData?.status === 'soft_blocked' || entitlementReason === 'past_soft_block') {
            rejectionCode = 'SOFT_BLOCKED';
        } else if (
            studentData?.status !== 'active' ||
            (validUntilDate && validUntilDate.getTime() < Date.now()) ||
            !accountValid
        ) {
            rejectionCode = 'EXPIRED_PASS';
        } else if (!busMatchesScanner) {
            rejectionCode = 'WRONG_BUS';
        } else if (isShiftMismatch) {
            rejectionCode = 'SHIFT_MISMATCH';
        }
```

---

