import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { getShiftDeltas } from '@/lib/utils/shift-utils';

export const POST = withSecurity(
    async () => {
        console.log('🔄 Starting bus count synchronization...');

        // Get all buses
        const busesSnapshot = await adminDb.collection('buses').get();
        const buses = busesSnapshot.docs.map((doc: any) => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`📊 Found ${buses.length} buses to process`);

        // Get all students who might occupy seats: active students always occupy,
        // soft_blocked/pending_deletion occupy ONLY when seatReleasedAt is absent
        // (legacy mode). Query all three statuses and filter below.
        const studentsSnapshot = await adminDb.collection('students')
            .where('status', 'in', ['active', 'soft_blocked', 'pending_deletion'])
            .get();

        const students = studentsSnapshot.docs.map((doc: any) => ({
            id: doc.id,
            ...doc.data()
        })).filter((student: any) => {
            // In legacy mode (seatReleasedAt absent), all statuses occupy seats.
            // In new architecture (seatReleasedAt present), only active students occupy.
            // Active students always occupy; soft_blocked/pending_deletion only if no release marker.
            if (student.status === 'active') return true;
            return !wasSeatReleased(student);
        });

        console.log(`👥 Found ${students.length} seat-occupying students`);

        const busCounts = new Map<string, { morningCount: number; eveningCount: number; total: number; stopCounts: Record<string, number> }>();

        buses.forEach((bus: any) => {
            busCounts.set(bus.id, { morningCount: 0, eveningCount: 0, total: 0, stopCounts: {} });
        });

        students.forEach((student: any) => {
            const busId = student.busId || student.assignedBusId || '';
            if (!busId) return;

            let matchedBusId: string | null = null;
            for (const bus of buses) {
                if (bus.id === busId || bus.busId === busId || bus.busNumber === busId) {
                    matchedBusId = bus.id;
                    break;
                }
            }

            if (!matchedBusId) {
                console.log(`⚠️ Student ${student.id.substring(0,8)}... has unknown busId: ${busId}`);
                return;
            }

            const counts = busCounts.get(matchedBusId)!;
            // Use canonical shift-utils for normalization
            const deltas = getShiftDeltas(student.shift || 'morning');

            counts.total++;
            if (deltas.affectsMorning) counts.morningCount++;
            if (deltas.affectsEvening) counts.eveningCount++;

            // Count per stop
            const stopId = student.stopId || '';
            if (stopId) {
                counts.stopCounts[stopId] = (counts.stopCounts[stopId] || 0) + 1;
            }
        });

        const updates: any[] = [];

        for (const bus of buses) {
            const counts = busCounts.get(bus.id) || { morningCount: 0, eveningCount: 0, total: 0, stopCounts: {} };
            const busRef = adminDb.collection('buses').doc(bus.id);

            const oldCounts = {
                currentMembers: bus.currentMembers || 0,
                morningCount: bus.load?.morningCount || 0,
                eveningCount: bus.load?.eveningCount || 0,
                stopCounts: bus.stopCounts || {}
            };

            const newCounts = {
                currentMembers: counts.total,
                morningCount: counts.morningCount,
                eveningCount: counts.eveningCount,
                stopCounts: counts.stopCounts
            };

            if (
                oldCounts.currentMembers !== newCounts.currentMembers ||
                oldCounts.morningCount !== newCounts.morningCount ||
                oldCounts.eveningCount !== newCounts.eveningCount ||
                JSON.stringify(oldCounts.stopCounts) !== JSON.stringify(newCounts.stopCounts)
            ) {
                // Use a transaction per bus to prevent lost updates from concurrent
                // operations (e.g., student approval, reassignment) between the
                // initial read and the write. Each transaction re-reads the bus
                // and only overwrites counts that haven't been changed since the
                // snapshot read.
                await adminDb.runTransaction(async (transaction) => {
                    const freshBus = await transaction.get(busRef);
                    if (!freshBus.exists) return;
                    const freshData = freshBus.data()!;
                    // If the bus was modified since our snapshot read, skip to avoid
                    // overwriting a concurrent change (best-effort reconciliation).
                    if (freshData.currentMembers !== oldCounts.currentMembers) {
                        return;
                    }
                    transaction.update(busRef, {
                        currentMembers: newCounts.currentMembers,
                        'load.morningCount': newCounts.morningCount,
                        'load.eveningCount': newCounts.eveningCount,
                        stopCounts: newCounts.stopCounts,
                        updatedAt: new Date().toISOString(),
                    });
                });

                updates.push({
                    busId: bus.id,
                    busNumber: bus.busNumber || bus.id,
                    old: oldCounts,
                    new: newCounts,
                });
            }
        }

        return NextResponse.json({
            success: true,
            message: `Synchronized ${updates.length} bus(es) with student data`,
            totalBuses: buses.length,
            totalStudents: students.length,
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
