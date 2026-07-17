import { NextResponse } from 'next/server';
import { CleanupService } from '@/lib/cleanup-service';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getAllBuses } from '@/domains/fleet';
import { getAllStudents, getAllDrivers } from '@/domains/identity';

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
        // Get counts from PostgreSQL (source of truth) via domains
        const [allStudents, allDrivers, allBusesFromPg] = await Promise.all([
            getAllStudents(),
            getAllDrivers(),
            getAllBuses()
        ]);

        const activeStudentsCount = allStudents.filter((s: any) => s.status === 'active').length;

        return NextResponse.json({
            success: true,
            timestamp: new Date().toISOString(),
            collectionStats: {
                students: {
                    total: allStudents.length,
                    active: activeStudentsCount
                },
                drivers: {
                    total: allDrivers.length
                },
                buses: {
                    total: allBusesFromPg.length
                }
            },
            message: 'Collection statistics retrieved from PostgreSQL.'
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ
    }
);
