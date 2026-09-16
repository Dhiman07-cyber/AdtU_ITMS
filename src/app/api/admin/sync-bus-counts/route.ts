import { getAllBuses,updateBus } from '@/domains/fleet';
import { getBusOccupancyStats } from '@/domains/identity';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
    async () => {
        console.log('🔄 Starting bus count synchronization...');

        // Get all buses from PG (source of truth for bus data)
        const buses = await getAllBuses();

        console.log(`📊 Found ${buses.length} buses to process`);

        // Database-aggregated lookup
        const { occupancy, stops } = await getBusOccupancyStats();

        let totalSeatOccupyingStudents = 0;
        const updates: any[] = [];
        const pendingUpdates: {
            busId: string;
            busNumber: string;
            oldCounts: any;
            newCounts: any;
            promise: Promise<any>;
        }[] = [];

        for (const bus of buses) {
            const busId = bus.busId || bus.id || '';
            const counts = occupancy[busId] || { total: 0, morning: 0, evening: 0 };
            const stopCounts = stops[busId] || {};

            totalSeatOccupyingStudents += counts.total;

            const oldCounts = {
                currentMembers: bus.currentMembers || 0,
                morningCount: bus.morningLoad || 0,
                eveningCount: bus.eveningLoad || 0,
                stopCounts: (bus as any).stopCounts || {}
            };

            const newCounts = {
                currentMembers: counts.total,
                morningCount: counts.morning,
                eveningCount: counts.evening,
                stopCounts: stopCounts
            };

            if (
                oldCounts.currentMembers !== newCounts.currentMembers ||
                oldCounts.morningCount !== newCounts.morningCount ||
                oldCounts.eveningCount !== newCounts.eveningCount ||
                JSON.stringify(oldCounts.stopCounts) !== JSON.stringify(newCounts.stopCounts)
            ) {
                pendingUpdates.push({
                    busId,
                    busNumber: bus.busNumber || busId,
                    oldCounts,
                    newCounts,
                    promise: updateBus(busId, {
                        currentMembers: newCounts.currentMembers,
                        morningLoad: newCounts.morningCount,
                        eveningLoad: newCounts.eveningCount,
                        stopCounts: newCounts.stopCounts,
                    } as any),
                });
            }
        }

        const settled = await Promise.allSettled(pendingUpdates.map(p => p.promise));
        settled.forEach((res, i) => {
            const p = pendingUpdates[i];
            if (res.status === 'fulfilled') {
                updates.push({
                    busId: p.busId,
                    busNumber: p.busNumber,
                    old: p.oldCounts,
                    new: p.newCounts,
                });
            } else {
                console.error(`Failed to update bus ${p.busId}:`, res.reason);
            }
        });

        return NextResponse.json({
            success: true,
            message: `Synchronized ${updates.length} bus(es) with student data`,
            totalBuses: buses.length,
            totalStudents: totalSeatOccupyingStudents,
            updatedBuses: updates,
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
