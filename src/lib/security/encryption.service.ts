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
    if (cached) return cached;

    const derived = crypto.pbkdf2Sync(secret, salt, ITERATION_COUNT, KEY_LENGTH, 'sha256');

    if (derivedKeyCache.size >= MAX_KEY_CACHE_SIZE) {
        const keys = Array.from(derivedKeyCache.keys());
        for (let i = 0; i < 1000; i++) {
            derivedKeyCache.delete(keys[i]);
        }
    }
    derivedKeyCache.set(cacheKey, derived);
    return derived;
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
    const combined = Buffer.concat([
        Buffer.from([1]), // Version byte
        salt,
        iv,
        authTag,
        encrypted
    ]);

    // Create HMAC signature for additional integrity
    const hmac = crypto.createHmac('sha256', SIGNING_KEY);
    hmac.update(combined);
    const signature = hmac.digest();

    // Combine with signature
    const finalBuffer = Buffer.concat([combined, signature.subarray(0, 8)]); // First 8 bytes of HMAC

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

        // Minimum size check
        if (buffer.length < 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 8 + 1) {
            console.warn('QR token too short');
            return null;
        }

        // Extract components
        let offset = 0;

        const version = buffer[offset];
        offset += 1;

        if (version !== 1) {
            console.warn('Unsupported QR token version:', version);
            return null;
        }

        const salt = buffer.subarray(offset, offset + SALT_LENGTH);
        offset += SALT_LENGTH;

        const iv = buffer.subarray(offset, offset + IV_LENGTH);
        offset += IV_LENGTH;

        const authTag = buffer.subarray(offset, offset + AUTH_TAG_LENGTH);
        offset += AUTH_TAG_LENGTH;

        const signatureFromToken = buffer.subarray(buffer.length - 8);
        const encryptedWithoutSig = buffer.subarray(offset, buffer.length - 8);
        const combinedWithoutSig = buffer.subarray(0, buffer.length - 8);

        // Verify HMAC signature
        const hmac = crypto.createHmac('sha256', SIGNING_KEY);
        hmac.update(combinedWithoutSig);
        const expectedSignature = hmac.digest().subarray(0, 8);

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

        const signatureFromToken = buffer.subarray(buffer.length - 8);
        const combinedWithoutSig = buffer.subarray(0, buffer.length - 8);

        const hmac = crypto.createHmac('sha256', SIGNING_KEY);
        hmac.update(combinedWithoutSig);
        const expectedSignature = hmac.digest().subarray(0, 8);

        return crypto.timingSafeEqual(signatureFromToken, expectedSignature);
    } catch {
        return false;
    }
}

// ============================================================================
// PAYMENT DATA ENCRYPTION
// ============================================================================

export interface SecurePaymentData {
    paymentId: string;
    studentUid: string;
    amount: number;
    method: 'Online' | 'Offline';
    status: 'Pending' | 'Completed';
    timestamp: number;
    signature: string; // HMAC for integrity
}

/**
 * Create a secure, signed payment reference
 * This creates a tamper-proof identifier that can be verified
 */
export function createSecurePaymentReference(
    paymentId: string,
    studentUid: string,
    amount: number,
    method: 'Online' | 'Offline'
): string {
    checkKeys();
    const data = {
        paymentId,
        studentUid,
        amount,
        method,
        timestamp: Date.now()
    };

    const dataString = JSON.stringify(data);

    // Create HMAC signature
    const hmac = crypto.createHmac('sha256', SIGNING_KEY);
    hmac.update(dataString);
    const signature = hmac.digest('hex');

    // Combine data with signature
    const signedData = {
        ...data,
        signature: signature.substring(0, 16) // First 16 chars for brevity
    };

    // Encode as base64
    return Buffer.from(JSON.stringify(signedData)).toString('base64url');
}

/**
 * Verify and decode a secure payment reference
 */
export function verifySecurePaymentReference(reference: string): SecurePaymentData | null {
    checkKeys();
    try {
        const decoded = JSON.parse(Buffer.from(reference, 'base64url').toString('utf8'));

        const { signature, ...data } = decoded;

        // Recreate signature
        const hmac = crypto.createHmac('sha256', SIGNING_KEY);
        hmac.update(JSON.stringify(data));
        const expectedSignature = hmac.digest('hex').substring(0, 16);

        if (!crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        )) {
            console.warn('Payment reference signature mismatch');
            return null;
        }

        // Check age (payment references valid for 1 hour)
        if (Date.now() - data.timestamp > PAYMENT_TOKEN_EXPIRY_MS) {
            console.warn('Payment reference expired');
            return null;
        }

        return { ...data, signature } as SecurePaymentData;
    } catch (error) {
        console.error('Payment reference verification failed:', error);
        return null;
    }
}

// ============================================================================
// SENSITIVE DATA HASHING
// ============================================================================

/**
 * Hash sensitive data for storage (one-way)
 * Uses SHA-256 with salt for secure hashing
 */
export function hashSensitiveData(data: string): string {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(data, salt, ITERATION_COUNT, 32, 'sha256');
    return salt.toString('hex') + ':' + hash.toString('hex');
}

/**
 * Verify hashed data
 */
export function verifyHashedData(data: string, storedHash: string): boolean {
    try {
        const [saltHex, hashHex] = storedHash.split(':');
        const salt = Buffer.from(saltHex, 'hex');
        const hash = crypto.pbkdf2Sync(data, salt, ITERATION_COUNT, 32, 'sha256');
        return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
    } catch {
        return false;
    }
}

// ============================================================================
// SECURE ID GENERATION
// ============================================================================

/**
 * Generate a cryptographically secure random ID
 */
export function generateSecureId(length: number = 32): string {
    return crypto.randomBytes(length / 2).toString('hex');
}

/**
 * Generate a secure token with timestamp
 */
export function generateTimestampedToken(prefix: string = ''): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(12).toString('hex');
    return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

// ============================================================================
// DATA INTEGRITY VERIFICATION
// ============================================================================

/**
 * Create HMAC signature for any data
 */
export function signData(data: object | string): string {
    checkKeys();
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', SIGNING_KEY);
    hmac.update(dataString);
    return hmac.digest('hex');
}

/**
 * Verify HMAC signature
 */
export function verifySignature(data: object | string, signature: string): boolean {
    const expectedSignature = signData(data);
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

// ============================================================================
// EXPORT SERVICE OBJECT
// ============================================================================

export const EncryptionService = {
    // QR Code
    encryptQRCodeData,
    decryptQRCodeData,
    quickValidateQRToken,

    // Payment
    createSecurePaymentReference,
    verifySecurePaymentReference,

    // Hashing
    hashSensitiveData,
    verifyHashedData,

    // ID Generation
    generateSecureId,
    generateTimestampedToken,

    // Data Integrity
    signData,
    verifySignature,

    // Generic Data Encryption
    encryptData,
    decryptData
};

export default EncryptionService;

// ============================================================================
// GENERIC DATA ENCRYPTION
// ============================================================================

/**
 * Encrypt any string data with AES-256-GCM
 * Used for storing sensitive fields in database
 */
export function encryptData(text: string): string {
    if (!text) return text;

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key
    const key = deriveKey(salt);

    // Encrypt
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + encrypted
    const combined = Buffer.concat([
        salt,
        iv,
        authTag,
        encrypted
    ]);

    return `enc:v1:${combined.toString('base64url')}`;
}

/**
 * Decrypt string data
 */
export function decryptData(encryptedText: string): string | null {
    if (!encryptedText) return encryptedText;

    // Legacy plaintext values return as-is when no enc:v1: prefix exists
    if (!encryptedText.startsWith('enc:v1:')) {
        return encryptedText;
    }

    try {
        const ciphertext = encryptedText.substring(7);
        const buffer = Buffer.from(ciphertext, 'base64url');

        // Minimum size check
        if (buffer.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
            return null;
        }

        let offset = 0;

        const salt = buffer.subarray(offset, offset + SALT_LENGTH);
        offset += SALT_LENGTH;

        const iv = buffer.subarray(offset, offset + IV_LENGTH);
        offset += IV_LENGTH;

        const authTag = buffer.subarray(offset, offset + AUTH_TAG_LENGTH);
        offset += AUTH_TAG_LENGTH;

        const encrypted = buffer.subarray(offset);

        // Derive key
        const key = deriveKey(salt);

        // Decrypt
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    } catch (error) {
        // Mismatched encryption key or corrupted payload: return null so caller falls back gracefully
        return null;
    }
}
