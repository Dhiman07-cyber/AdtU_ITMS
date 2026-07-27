/**
 * Payment Rejection API Route
 * 
 * POST /api/payments/reject
 * Rejects an offline pending payment.
 * 
 * SECURITY:
 * - withSecurity wrapper: auth, RBAC, rate limiting, CSRF, Zod validation
 * - ATOMIC: Supabase WHERE status='Pending' prevents double-rejection
 * - IMMUTABLE: Payment record preserved with 'Rejected' status (no deletions)
 * - IDEMPOTENT: Already-rejected payments return success
 */

import { getUserById } from '@/domains/identity';
import { rejectOfflinePayment } from '@/lib/payment/payment.service';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RejectPaymentSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
    async (request, { auth, body, requestId }) => {
        const { paymentId } = body as { paymentId: string };
        const userId = auth.uid;

        const permissionDenied = await requireModeratorPermission(
            auth,
            'payments',
            'canRejectOfflinePayment',
            requestId
        );
        if (permissionDenied) return permissionDenied;

        // Get rejector details via Identity domain API
        let rejectorEmpId = '';
        let rejectorName = auth.name || '';

        const user = await getUserById(userId);
        if (user) {
            const userData = user as any;
            rejectorEmpId = userData.empId || '';
            rejectorName = userData.name || userData.fullName || rejectorName;
        }

        // Reject the payment (ATOMIC + IDEMPOTENT)
        const result = await rejectOfflinePayment({
            paymentId,
            rejectorUserId: userId,
            rejectorEmpId,
            rejectorName,
            rejectorRole: auth.role === 'admin' ? 'Admin' : 'Moderator',
        });

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error, requestId },
                { status: 400 }
            );
        }

        console.log(`🗑️ [${requestId}] Payment ${paymentId?.substring(0,8)}... rejected by ${rejectorName?.substring(0,8) || 'admin'}... (${rejectorEmpId?.substring(0,8) || 'N/A'}...)`);

        return NextResponse.json({
            success: true,
            message: 'Payment rejected successfully',
            requestId,
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: RejectPaymentSchema,
        rateLimit: RateLimits.PAYMENT_CREATE,
    }
);
