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
 *  9. ✅ Old image deleted (via SDK, not by sending API_SECRET in a form!)
 * 10. ✅ Error messages sanitised in production
 *
 * Accepts multipart/form-data with fields:
 *   file        – the image file (required)
 *   folder      – target folder, validated against allow-list (default: "adtu")
 *   oldImageUrl – previous Cloudinary URL to delete (optional)
 */

import cloudinary,{
	deleteAsset,
	extractPublicId,
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
    const oldImageUrl = (formData.get('oldImageUrl') as string) || '';

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

    // ── 7. Delete Old Image (if provided) ─────────────────────────────────
    // SECURITY: Deletion is done via the SDK which keeps API_SECRET on the
    // server — the old route sent api_secret in a FormData POST (bad!).
    if (oldImageUrl) {
      const oldPublicId = extractPublicId(oldImageUrl);
      if (oldPublicId) {
        const deleted = await deleteAsset(oldPublicId);
        if (deleted) {
          console.log(`✅ [Upload] Deleted old image: ${oldPublicId}`);
        } else {
          console.warn(`⚠️ [Upload] Could not delete old image: ${oldPublicId}`);
        }
      }
    }

    // ── 8. Upload to Cloudinary (server-side SDK) ─────────────────────────
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