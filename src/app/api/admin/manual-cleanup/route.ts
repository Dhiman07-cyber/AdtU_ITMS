import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { CleanupService } from '@/lib/cleanup-service';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';

export const POST = withSecurity(
    async (request, { auth }) => {
        console.log('🧹 Manual cleanup initiated by admin:', auth.uid);

        // Run opportunistic cleanup (swaps and audit logs only)
        await CleanupService.runOpportunisticCleanup();

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            initiatedBy: auth.uid,
            message: 'Manual cleanup completed. Note: The QR system now uses student UID directly - no token cleanup needed.'
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);

export const GET = withSecurity(
    async () => {
        // Get collection counts for monitoring (remaining relevant collections)
        const [studentsSnapshot, driversSnapshot, busesSnapshot] = await Promise.all([
            adminDb.collection('students').get(),
            adminDb.collection('drivers').get(),
            adminDb.collection('buses').get()
        ]);

        // Get active students count
        const activeStudentsSnapshot = await adminDb.collection('students')
            .where('status', '==', 'active')
            .get();

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            collectionStats: {
                students: {
                    total: studentsSnapshot.size,
                    active: activeStudentsSnapshot.size
                },
                drivers: {
                    total: driversSnapshot.size
                },
                buses: {
                    total: busesSnapshot.size
                }
            },
            message: 'Collection statistics retrieved.'
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ
    }
);
