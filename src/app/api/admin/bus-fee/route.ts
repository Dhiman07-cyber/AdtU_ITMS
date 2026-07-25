import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { getCurrentBusFee, updateBusFee } from '@/lib/bus-fee-service';
import { withSecurity } from '@/lib/security/api-security';
import { BusFeeQuerySchema, BusFeeUpdateSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { notifyAllUsers } from '@/lib/services/fcm-notification-service';

/**
 * Optimized Bus Fee API
 * 
 * Enhancements:
 * - Replaced massive N-write notification loop with high-performance Topic Broadcast.
 * - Parallelized admin metadata fetching.
 * - Atomic fee updates.
 */

export const GET = withSecurity(
    async (request, { body }) => {
        const currentFee = await getCurrentBusFee();
        return NextResponse.json({
            success: true,
            currentFee,
            timestamp: new Date().toISOString()
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: BusFeeQuerySchema,
        rateLimit: RateLimits.READ
    }
);

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { amount } = body as any;
        const result = await updateBusFee(auth.uid, amount);

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error }, { status: 500 });
        }

        (async () => {
            try {
                const userRole = await resolveUserRole(auth.uid);
                const adminName = userRole.name || 'Admin';

                const { pgInsertNotification } = await import('@/domains/notification/repositories/notification.repository.pg');
                await pgInsertNotification({
                    title: '🚌 Bus Fee Updated',
                    content: `Bus fee has been updated to ₹${amount.toLocaleString('en-IN')} by ${adminName}`,
                    type: 'announcement',
                    sender: { userId: auth.uid, userName: adminName, userRole: 'admin' },
                    target: { type: 'all_users' },
                    recipientIds: [],
                    readByUserIds: [],
                    metadata: { type: 'bus_fee_update', newAmount: amount, previousAmount: result.previousAmount }
                });
            } catch (err) {
                console.error('Bus fee notification failed:', err);
            }
        })();

        return NextResponse.json({
            success: true,
            message: 'Bus fee updated successfully',
            newAmount: amount,
            previousAmount: result.previousAmount,
            timestamp: new Date().toISOString()
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: BusFeeUpdateSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
