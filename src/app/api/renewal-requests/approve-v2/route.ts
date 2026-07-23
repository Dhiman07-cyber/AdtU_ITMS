import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/firebase-admin';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { safeErrorMessage } from '@/lib/security/safe-error';
import * as Application from '@/domains/application';

/**
 * POST /api/renewal-requests/approve-v2
 *
 * D8: Renewal approval migrated from Firestore transaction to Application domain API.
 * The Application.approve() method orchestrates:
 *   1. RPC validate + lock
 *   2. Student.update() (renewal path)
 *   3. Seat.assignSeat() (if renewal_after_soft_block)
 *   4. Payment (idempotent)
 *   5. Audit (idempotent)
 *   6. Notification (idempotent)
 *   7. RPC finalize (preserve as approved for renewal)
 *
 * Post-commit side effects (notifications, Cloudinary cleanup, email) remain here.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { requestId } = body;
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 100) {
      return NextResponse.json({ error: 'Request ID required' }, { status: 400 });
    }

    const decodedToken = await verifyToken(token);
    const approverUserId = decodedToken.uid;

    // Auth check — read approver profile from Identity domain
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

    // Read application from PostgreSQL
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

    // ── Core approval via Application domain ──────────────────────────
    const result = await Application.approve(
      requestId,
      {
        uid: approverUserId,
        name: approverProfile.fullName || approverProfile.name || 'Admin',
        role: approverProfile.role,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    // ── Post-commit side effects (non-critical) ──────────────────────
    const postTasks = [
      // Cloudinary cleanup
      (async () => {
        if (receiptImageUrl) {
          const publicId = extractPublicId(receiptImageUrl);
          if (publicId) await deleteAsset(publicId);
        }
      })(),

      // Email notification
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
