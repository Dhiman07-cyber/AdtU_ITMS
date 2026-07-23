import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditEvent, type AuditActorRole } from '@/domains/audit';
import crypto from 'crypto';

/**
 * POST /api/fleet/assign-drivers
 *
 * Commits net driver-assignment changes to PostgreSQL via an atomic RPC.
 * Replaces the Firestore transaction in net-assignment-service.ts commitNetChanges().
 *
 * Accepts the same shapes the client already computes:
 *   - netChanges: array of { busId, prevAssignedDriverId, newAssignedDriverId }
 *   - driverFinalState: array of { driverId, finalBusId, finalRouteId, isReserved }
 *   - stagingSnapshot: staged operations for audit trail
 *   - actorInfo: { name, role, label }
 *
 * The RPC acquires FOR UPDATE locks on all affected rows, verifies optimistic
 * concurrency, and applies all updates atomically. No TOCTOU race window.
 */

interface BusChange {
    busId: string;
    busLabel: string;
    prevAssignedDriverId: string | null;
    newAssignedDriverId: string | null;
}

interface DriverFinal {
    driverId: string;
    driverName: string;
    finalBusId: string | null;
    finalRouteId: string | null;
    isReserved: boolean;
}

interface AssignDriversBody {
    netChanges: BusChange[];
    driverFinalState: DriverFinal[];
    stagingSnapshot?: unknown[];
    actorInfo?: { name: string; role: string; label?: string };
}

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canReassign');
        if (permissionDenied) return permissionDenied;

        const body: AssignDriversBody = await req.json();
        const { netChanges, driverFinalState, stagingSnapshot, actorInfo } = body;

        if (!netChanges || netChanges.length === 0) {
            return NextResponse.json({ success: true, updatedBuses: [], updatedDrivers: [] });
        }

        const supabase = getSupabaseServer();

        // ── Phase 1: Pre-validate driver existence (read-only, no lock needed) ──
        if (driverFinalState.length > 0) {
            const driverIds = driverFinalState.map(d => d.driverId);
            const { data: driverRows, error: driverErr } = await supabase
                .from('driver_profiles')
                .select('uid')
                .in('uid', driverIds);

            if (driverErr) {
                return NextResponse.json({ success: false, message: `Failed to read drivers: ${driverErr.message}` }, { status: 500 });
            }

            const driverSet = new Set((driverRows || []).map((r: any) => r.uid));
            for (const df of driverFinalState) {
                if (!driverSet.has(df.driverId)) {
                    return NextResponse.json({
                        success: false,
                        message: `Driver ${df.driverName} has been deleted`,
                    }, { status: 409 });
                }
            }
        }

        // ── Phase 2: Atomic commit via RPC ──
        const busUpdates = netChanges.map(c => ({
            bus_id: c.busId,
            bus_label: c.busLabel,
            prev_driver_uid: c.prevAssignedDriverId,
            new_driver_uid: c.newAssignedDriverId,
        }));

        const driverUpdates = driverFinalState.map(d => ({
            driver_uid: d.driverId,
            new_bus_id: d.finalBusId,
            new_route_id: d.finalRouteId,
            is_reserved: d.isReserved,
        }));

        const { data: rpcResult, error: rpcError } = await supabase
            .rpc('assign_drivers_atomically', {
                p_bus_updates: busUpdates,
                p_driver_updates: driverUpdates,
            });

        if (rpcError) {
            return NextResponse.json({ success: false, message: `RPC failed: ${rpcError.message}` }, { status: 500 });
        }

        if (!rpcResult?.success) {
            const status = rpcResult?.status || 409;
            return NextResponse.json({
                success: false,
                message: rpcResult?.error || 'Assignment failed',
                conflictDetails: rpcResult?.error,
            }, { status });
        }

        const updatedBuses: string[] = rpcResult.updatedBuses || [];
        const updatedDrivers: string[] = rpcResult.updatedDrivers || [];

        // ── Phase 3: Audit log (non-blocking) ──
        try {
            const operationId = `driver_reassignment_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
            const actorLabel = actorInfo?.label || `${auth.name || 'Admin'} (${auth.role})`;

            let summary = `Committed ${updatedDrivers.length} driver assignment(s) affecting ${updatedBuses.length} bus(es)`;
            if (netChanges.length === 1) {
                const bc = netChanges[0];
                const prevDriver = bc.prevAssignedDriverId || 'Vacant';
                const nextDriver = bc.newAssignedDriverId || 'Vacant';
                summary = `Reassigned ${bc.busLabel}: ${prevDriver} → ${nextDriver}`;
            }

            const changes = [
                ...netChanges.map(bc => ({
                    docPath: `buses/${bc.busId}`,
                    collection: 'buses',
                    docId: bc.busId,
                    before: { driver_uid: bc.prevAssignedDriverId },
                    after: { driver_uid: bc.newAssignedDriverId },
                })),
                ...driverFinalState.map(df => ({
                    docPath: `drivers/${df.driverId}`,
                    collection: 'drivers',
                    docId: df.driverId,
                    before: { bus_id: null, is_reserved: true },
                    after: { bus_id: df.finalBusId, is_reserved: df.isReserved },
                })),
            ];

            await supabase.from('reassignment_logs').insert([{
                operation_id: operationId,
                type: 'driver_reassignment',
                actor_id: auth.uid,
                actor_label: actorLabel,
                status: 'committed',
                summary,
                changes,
                meta: {
                    busesAffected: updatedBuses,
                    driversAffected: updatedDrivers,
                    stagingSnapshot: stagingSnapshot || [],
                },
            }]);
        } catch (auditError) {
            console.error('Audit log write failed (non-critical):', auditError);
        }

        void createAuditEvent({
            action: 'drivers_reassigned',
            actor_id: auth.uid,
            actor_name: actorInfo?.label || auth.name || 'Unknown',
            actor_role: (auth.role as AuditActorRole) || 'admin',
            target_id: updatedBuses[0] || '',
            target_type: 'bus',
            target_name: '',
            category: 'reassignments',
            summary: `Reassigned ${updatedDrivers.length} driver(s) across ${updatedBuses.length} bus(es)`,
            severity: 'medium',
            metadata: { updatedBuses, updatedDrivers },
        });

        return NextResponse.json({ success: true, updatedBuses, updatedDrivers });

    } catch (error: any) {
        console.error('assign-drivers error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Internal error' }, { status: 500 });
    }
}
