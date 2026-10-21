import * as Application from '@/domains/application';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { checkRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { calculateValidUntilDate } from '@/lib/utils/date-utils';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/renewal-requests/approve-v2
 *
 * D8: Renewal approval migrated from Firestore transaction to Application domain API.
 * Standardized auth via verifyApiAuth and RateLimits.UPDATE rate limiting.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const rateLimitId = createRateLimitId(auth.uid, 'renewal:approve-v2');
    const rateCheck = checkRateLimit(rateLimitId, RateLimits.UPDATE.maxRequests, RateLimits.UPDATE.windowMs);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before approving again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)) },
        }
      );
    }

    const body = await request.json();
    const { requestId, overrideBusId } = body;
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 100) {
      return NextResponse.json({ error: 'Request ID required' }, { status: 400 });
    }

    const approverUserId = auth.uid;

    const permissionDenied = await requireModeratorPermission(
      {
        uid: approverUserId,
        email: auth.email || '',
        role: auth.role,
        name: auth.name || 'Admin',
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
        name: auth.name || 'Admin',
        role: auth.role,
      },
      undefined,
      overrideBusId ? { busId: overrideBusId } : undefined
    );

    if (!result.success) {
      return NextResponse.json({
        error: result.error,
        needsCapacityReview: (result as any).needsCapacityReview,
      }, { status: result.status || 500 });
    }

    // ── Post-commit side effects (non-critical) ──────────────────────
    // Note: Cloudinary receipt image is PRESERVED intact on approval for financial audit compliance (Fix 11).
    const postTasks = [
      // Email notification
      (async () => {
        const studentEmail = fd.studentEmail || app.email || app.applicantEmail;
        if (studentEmail) {
          try {
            const deadlineConfig = await getDeadlineConfig().catch(() => null);
            const endYear = ((app.formData as any)?.sessionEndYear as number) || (new Date().getFullYear() + 1);
            const durationYears = Number((app.formData as any)?.durationYears || 1);
            const startYear = endYear - durationYears;
            const computedValidUntil = deadlineConfig
              ? calculateValidUntilDate(startYear, durationYears, deadlineConfig)
              : new Date(Date.UTC(endYear, 5, 30));

            const { sendApplicationApprovedNotification } = await import('@/lib/services/admin-email.service');
            await sendApplicationApprovedNotification({
              studentName,
              studentEmail,
              busNumber: (app.formData?.busId as string)?.replace('bus_', 'Bus-') || 'Assigned Bus',
              routeName: 'Service Renewal',
              shift: (app.formData?.shift as string) || 'Assigned Shift',
              validUntil: computedValidUntil.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
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
