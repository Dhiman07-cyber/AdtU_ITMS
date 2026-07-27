import * as Application from '@/domains/application';
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
    const { requestId, rejectorName, rejectorId, reason } = body;

    if (!requestId || !rejectorName || !rejectorId || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify user is admin or moderator
    const { getUserById } = await import('@/domains/identity');
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
    const result = await Application.reject(
      requestId,
      {
        uid,
        name: userProfile.fullName || userProfile.name || rejectorName,
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
