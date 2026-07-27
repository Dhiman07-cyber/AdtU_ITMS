/**
 * Payment Approval API Route
 * 
 * POST /api/payments/approve
 * Approves an offline pending payment and updates student validity.
 * 
 * SECURITY:
 * - withSecurity wrapper: auth, RBAC, rate limiting, CSRF, Zod validation
 * - ATOMIC: Supabase WHERE status='Pending' prevents double-approval
 * - IDEMPOTENT: Already-completed payments return success
 */

import { NextResponse } from 'next/server';
import { approveOfflinePayment } from '@/lib/payment/payment.service';
import { withSecurity } from '@/lib/security/api-security';
import { ApprovePaymentSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getUserById } from '@/domains/identity';

export const POST = withSecurity(
    async (request, { auth, body, requestId }) => {
        const { paymentId } = body as { paymentId: string };
        const userId = auth.uid;

        const permissionDenied = await requireModeratorPermission(
            auth,
            'payments',
            'canApproveOfflinePayment',
            requestId
        );
        if (permissionDenied) return permissionDenied;

        // Get approver details via Identity domain API
        let approverEmpId = '';
        let approverName = auth.name || '';

        const user = await getUserById(userId);
        if (user) {
            const userData = user as any;
            approverEmpId = userData.empId || '';
            approverName = userData.name || userData.fullName || approverName;
        }

        // Approve the payment (ATOMIC + IDEMPOTENT)
        const result = await approveOfflinePayment({
            paymentId,
            approverUserId: userId,
            approverEmpId,
            approverName,
            approverRole: auth.role === 'admin' ? 'Admin' : 'Moderator',
        });

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error, requestId },
                { status: 400 }
            );
        }

        console.log(`✅ [${requestId}] Payment ${paymentId?.substring(0,8)}... approved by ${approverName?.substring(0,8) || 'admin'}... (${approverEmpId?.substring(0,8) || 'N/A'}...)`);

        return NextResponse.json({
            success: true,
            message: 'Payment approved successfully',
            payment: result.payment,
            requestId,
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: ApprovePaymentSchema,
        rateLimit: RateLimits.PAYMENT_CREATE,
    }
);
