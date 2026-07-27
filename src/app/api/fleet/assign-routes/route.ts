import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditEvent, type AuditActorRole } from '@/domains/audit';
import crypto from 'crypto';

/**
 * POST /api/fleet/assign-routes
 *
 * Commits net route-assignment changes to PostgreSQL via an atomic RPC.
 * Replaces the Firestore transaction in net-route-assignment-service.ts commitNetRouteChanges().
 *
 * The RPC acquires FOR UPDATE locks on all affected rows, verifies optimistic
 * concurrency, and applies all updates atomically. No TOCTOU race window.
 */

interface RouteChange {
    busId: string;
    busLabel: string;
    prevRouteId: string | null;
    newRouteId: string;
    newRouteName: string;
}

interface AssignRoutesBody {
    netChanges: RouteChange[];
    stagingSnapshot?: unknown[];
    actorInfo?: { name: string; role: string; label?: string };
}

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const permissionDenied = await requireModeratorPermission(auth, 'buses', 'canReassign');
        if (permissionDenied) return permissionDenied;

        const body: AssignRoutesBody = await req.json();
        const { netChanges, stagingSnapshot, actorInfo } = body;

        if (!netChanges || netChanges.length === 0) {
            return NextResponse.json({ success: true, updatedBuses: [] });
        }

        const supabase = getSupabaseServer();

        // ── Phase 1: Pre-validate routes exist and are active (read-only) ──
        const routeIds = [...new Set(netChanges.map(c => c.newRouteId))];
        const { data: routeRows, error: routeErr } = await supabase
            .from('routes')
            .select('id, status')
            .in('id', routeIds);

        if (routeErr) {
            return NextResponse.json({ success: false, message: `Failed to read routes: ${routeErr.message}` }, { status: 500 });
        }

        const routeMap = new Map((routeRows || []).map((r: any) => [r.id, r]));
        for (const change of netChanges) {
            const routeRow = routeMap.get(change.newRouteId);
            if (!routeRow) {
                return NextResponse.json({
                    success: false,
                    message: `Route ${change.newRouteName} (${change.newRouteId}) not found`,
                }, { status: 404 });
            }
            if (routeRow.status === 'inactive') {
                return NextResponse.json({
                    success: false,
                    message: `Route ${change.newRouteName} is not active`,
                }, { status: 400 });
            }
        }

        // ── Phase 2: Atomic commit via RPC ──
        const busUpdates = netChanges.map(c => ({
            bus_id: c.busId,
            bus_label: c.busLabel,
            prev_route_id: c.prevRouteId,
            new_route_id: c.newRouteId,
            new_route_name: c.newRouteName,
        }));

        const { data: rpcResult, error: rpcError } = await supabase
            .rpc('assign_routes_atomically', {
                p_bus_updates: busUpdates,
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

        // ── Phase 3: Audit log (non-blocking) ──
        try {
            const operationId = `route_reassignment_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
            const actorLabel = actorInfo?.label || `${auth.name || 'Admin'} (${auth.role})`;

            let summary = `Committed ${updatedBuses.length} route assignment(s)`;
            if (netChanges.length === 1) {
                const bc = netChanges[0];
                const prev = bc.prevRouteId ? bc.busLabel : 'No Route';
                summary = `Reassigned ${bc.busLabel}: ${prev} → ${bc.newRouteName}`;
            }

            const changes = netChanges.map(bc => ({
                docPath: `buses/${bc.busId}`,
                collection: 'buses',
                docId: bc.busId,
                before: { route_id: bc.prevRouteId },
                after: { route_id: bc.newRouteId, route_name: bc.newRouteName },
            }));

            await supabase.from('reassignment_logs').insert([{
                operation_id: operationId,
                type: 'route_reassignment',
                actor_id: auth.uid,
                actor_label: actorLabel,
                status: 'committed',
                summary,
                changes,
                meta: {
                    busesAffected: updatedBuses,
                    stagingSnapshot: stagingSnapshot || [],
                },
            }]);
        } catch (auditError) {
            console.error('Audit log write failed (non-critical):', auditError);
        }

        void createAuditEvent({
            action: 'routes_reassigned',
            actor_id: auth.uid,
            actor_name: actorInfo?.label || auth.name || 'Unknown',
            actor_role: (auth.role as AuditActorRole) || 'admin',
            target_id: updatedBuses[0] || '',
            target_type: 'bus',
            target_name: '',
            category: 'reassignments',
            summary: `Reassigned ${updatedBuses.length} bus(es) to new routes`,
            severity: 'medium',
            metadata: { updatedBuses },
        });

        return NextResponse.json({ success: true, updatedBuses });

    } catch (error: any) {
        console.error('assign-routes error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Internal error' }, { status: 500 });
    }
}
