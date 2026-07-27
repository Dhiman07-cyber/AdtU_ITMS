/**
 * Cloudinary Server-Side Configuration (Singleton)
 * ─────────────────────────────────────────────────
 * SECURITY: This module MUST only be imported in server-side code (API routes).
 * It configures the Cloudinary v2 SDK with API_SECRET which must NEVER be
 * sent to the client.
 *
 * The v2 SDK is used for:
 *  - Generating upload signatures  (cloudinary.utils.api_sign_request)
 *  - Generating signed/authenticated delivery URLs
 *  - Admin operations  (destroy malicious assets detected post-upload)
 *
 * Every API route that needs Cloudinary should import from HERE instead of
 * duplicating cloudinary.config() calls.
 */

import { v2 as cloudinary } from 'cloudinary';

// ── Env Validation ──────────────────────────────────────────────────────────
const CLOUD_NAME =
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ??
    process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        console.error(
            '[cloudinary-server] ⚠️ Missing env var(s): ' +
            'CLOUDINARY_CLOUD_NAME | CLOUDINARY_API_KEY | CLOUDINARY_API_SECRET'
        );
    }
}

// ── Configure SDK (idempotent — safe to call multiple times) ────────────────
cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true, // Always use HTTPS URLs
});

// ── Allowed upload targets ──────────────────────────────────────────────────
/** Only these folders are valid Cloudinary destinations */
export const ALLOWED_FOLDERS = ['adtu', 'ADTU', 'profiles', 'receipts'] as const;

/** MIME-types we accept */
export const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);

/** File extensions for post-upload webhook validation */
export const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** 5 MB for images (matches existing behaviour) */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate & sanitise a folder name from client input.
 * Returns a safe folder or the default 'adtu'.
 */
export function sanitizeFolder(folder: string | null | undefined): string {
    if (!folder) return 'adtu';
    return (ALLOWED_FOLDERS as readonly string[]).includes(folder) ? folder : 'adtu';
}

/**
 * Validate MIME type against the server allowlist.
 */
export function isAllowedMimeType(mime: string): boolean {
    return ALLOWED_MIME_TYPES.has(mime);
}

/**
 * Validate file size (bytes).
 */
export function isAllowedSize(bytes: number): boolean {
    return bytes > 0 && bytes <= MAX_FILE_SIZE;
}

/**
 * Delete a Cloudinary asset by its public_id using the SDK.
 * Server-only — never expose this to the client.
 */
export async function deleteAsset(
    publicId: string,
    resourceType: 'image' | 'raw' | 'video' = 'image'
): Promise<boolean> {
    try {
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
        });
        return result.result === 'ok';
    } catch (err) {
        console.error('[cloudinary-server] deleteAsset failed:', err);
        return false;
    }
}

/**
 * Extract the Cloudinary public_id from a secure_url.
 * e.g. https://res.cloudinary.com/<cloud>/image/upload/v123/ADTU/profile_123.jpg
 *   → "ADTU/profile_123"
 */
export function extractPublicId(url: string): string | null {
    if (!url?.includes('cloudinary')) return null;
    try {
        const pathname = new URL(url).pathname;
        const parts = pathname.split('/');
        const uploadIdx = parts.indexOf('upload');
        if (uploadIdx === -1 || parts.length < uploadIdx + 3) return null;
        // Skip "upload" and version segment
        const tail = parts.slice(uploadIdx + 2).join('/');
        return tail.replace(/\.[^/.]+$/, '') || null;
    } catch {
        return null;
    }
}

export default cloudinary;
export { API_KEY,CLOUD_NAME };
// SECURITY: API_SECRET is NOT exported — consumers use the SDK which has it
// configured internally.
