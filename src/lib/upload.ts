/**
 * Client-Side Upload Helper
 * ─────────────────────────
 * SECURITY HARDENING (March 2026):
 *  - Sends Firebase ID token in Authorization header so /api/upload can
 *    verify the user server-side.
 *  - Client-side pre-validation of type and size before wasting bandwidth.
 *  - Mobile compression for large images.
 */

import { isMobileDevice, compressImageForMobile } from './mobile-utils';
import { getAuth } from 'firebase/auth';

/** Allowed MIME types (must match server allowlist) */
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/** Max file size in bytes (5 MB, must match server) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Get the current user's Firebase ID token.
 * Returns null if the user is not signed in.
 */
async function getIdToken(): Promise<string | null> {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * Upload an image to Cloudinary via `/api/upload`.
 * The server handles all Cloudinary communication — the client never
 * touches API keys or secrets.
 */
export const uploadImage = async (
  file: File,
  folder: string = 'adtu'
): Promise<string | null> => {
  try {

    // ── Client-side pre-validation ────────────────────────────────────────
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error(
        'Invalid file type. Only JPEG, PNG, and WebP images are allowed.'
      );
    }

    // ── Image compression (compress if size is > 1MB on mobile/desktop to save bandwidth and prevent connection resets) ──
    let processedFile = file;
    if (file.size > 1 * 1024 * 1024) {
      processedFile = await compressImageForMobile(file, 2);
    }

    if (processedFile.size > MAX_FILE_SIZE) {
      throw new Error('File size too large. Maximum file size is 5 MB.');
    }

    // ── Get auth token ────────────────────────────────────────────────────
    const token = await getIdToken();
    if (!token) {
      throw new Error('You must be signed in to upload files.');
    }

    const formData = new FormData();
    formData.append('file', processedFile);
    formData.append('folder', folder);

    // ── Upload with retry ─────────────────────────────────────────────────
    const maxRetries = isMobileDevice() ? 2 : 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {

        if (attempt > 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * attempt)
          );
        }

        const response = (await Promise.race([
          fetch('/api/upload', {
            method: 'POST',
            headers: {
              // SECURITY: Send Firebase token so the server can verify identity
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Upload timeout')),
              30_000
            )
          ),
        ])) as Response;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Upload failed with status ${response.status}`
          );
        }

        const data = await response.json();
        return data.url;
      } catch (uploadError: any) {
        console.error(`❌ Upload attempt ${attempt} failed:`, uploadError);
        lastError = uploadError;

        if (uploadError.message === 'Upload timeout') {
          lastError = new Error(
            'Upload timed out. Please try with a smaller image or better network connection.'
          );
        } else if (
          uploadError.name === 'TypeError' &&
          uploadError.message.includes('fetch')
        ) {
          lastError = new Error(
            'Network error during upload. Please check your internet connection and try again.'
          );
        }

        // Don't retry on validation errors
        if (
          uploadError.message?.includes('File size too large') ||
          uploadError.message?.includes('Invalid file type') ||
          uploadError.message?.includes('Authentication') ||
          uploadError.message?.includes('Too many uploads')
        ) {
          break;
        }
      }
    }

    if (lastError) {
      console.error(
        '❌ [uploadImage] All upload attempts failed:',
        lastError.message
      );
      throw lastError;
    }

    return null;
  } catch (error: any) {
    console.error('❌ [uploadImage] Error:', error);
    throw error;
  }
};

export const uploadImageWithPreset = async (
  file: File,
  preset: string
): Promise<string | null> => {
  // Preset-based uploads go through the same secure route
  return uploadImage(file, 'adtu');
};