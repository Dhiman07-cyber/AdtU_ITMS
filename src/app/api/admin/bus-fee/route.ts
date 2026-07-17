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

        // Optimized Broadcast Notification (Non-blocking)
        (async () => {
            try {
                const userRole = await resolveUserRole(auth.uid);
                const adminName = userRole.name || 'Admin';

                await notifyAllUsers({
                    title: '🚌 Bus Fee Updated',
                    body: `Bus fee has been updated to ₹${amount.toLocaleString('en-IN')} by ${adminName}`,
                    data: { 
                        type: 'bus_fee_update', 
                        newAmount: amount.toString(),
                        previousAmount: result.previousAmount?.toString() || '0'
                    }
                });

                // Instead of individual docs, we can log a single global announcement
                await adminDb.collection('announcements').add({
                    type: 'bus_fee_update',
                    title: 'Bus Fee Update',
                    content: `New bus fee: ₹${amount.toLocaleString('en-IN')}`,
                    createdBy: auth.uid,
                    createdAt: new Date().toISOString(),
                    priority: 'high'
                });

            } catch (err) {
                console.error('Broadcast notification failed:', err);
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
