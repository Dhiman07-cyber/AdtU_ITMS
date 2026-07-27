/**
 * POST /api/delete-image — Secure Image Deletion
 * ────────────────────────────────────────────────
 * SECURITY HARDENING (March 2026):
 *  - Previously this route sent CLOUDINARY_API_SECRET in a FormData POST to
 *    Cloudinary's /destroy endpoint — that's a secret leak even though it
 *    went server→Cloudinary (the code pattern was dangerous and could be
 *    copy-pasted to client code).
 *  - Now uses the Cloudinary SDK which keeps the secret internal.
 *  - Requires Firebase authentication.
 *  - Rate-limited (10 deletes / 60 s per user).
 */

import { deleteAsset } from '@/lib/cloudinary-server';
import { verifyTokenOnly } from '@/lib/security/api-auth';
import { checkRateLimit,createRateLimitId } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { NextRequest,NextResponse } from 'next/server';

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
    const rateLimitId = createRateLimitId(user.uid, 'delete-image');
    const rateCheck = checkRateLimit(rateLimitId, 10, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait.' },
        { status: 429 }
      );
    }

    // ── 3. Parse & validate input ─────────────────────────────────────────
    const body = await request.json();
    const { publicId } = body;

    if (!publicId || typeof publicId !== 'string' || publicId.length > 300) {
      return NextResponse.json(
        { error: 'Missing or invalid public ID' },
        { status: 400 }
      );
    }

    // SECURITY: Basic path-traversal prevention — public_id should only
    // contain alphanumerics, slashes, underscores, and hyphens.
    if (!/^[a-zA-Z0-9/_-]+$/.test(publicId)) {
      return NextResponse.json(
        { error: 'Invalid public ID format' },
        { status: 400 }
      );
    }

    // ── 4. Delete via SDK (never send api_secret in a form) ───────────────
    const deleted = await deleteAsset(publicId);

    if (deleted) {
      return NextResponse.json({
        success: true,
        message: 'Image deleted successfully',
      });
    } else {
      return NextResponse.json(
        { success: false, message: 'Image not found or already deleted' },
        { status: 404 }
      );
    }
  } catch (error: any) {
    console.error('❌ [delete-image] Error:', error);
    return NextResponse.json(
      handleApiError(error, 'delete-image', 'Failed to delete image'),
      { status: 500 }
    );
  }
}
