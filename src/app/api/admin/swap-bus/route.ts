import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { AdminSwapBusSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { notifyRouteTopic } from '@/lib/services/fcm-notification-service';
import { getBusById, updateBus } from '@/domains/fleet';
import * as routeService from '@/domains/route';
import crypto from 'crypto';

/**
 * POST /api/admin/swap-bus
 * 
 * Idempotency: optional `idempotencyKey` in body prevents duplicate swaps.
 * If provided and a swap with that key was already processed, returns the original result.
 */
export const POST = withSecurity(
    async (request, { body, auth }) => {
        const { routeId, fromBusId, toBusId, idempotencyKey } = body as any;
        const supabase = getSupabaseServer();

        // Idempotency check
        if (idempotencyKey) {
            const { data: existing } = await supabase
                .from('reassignment_logs')
                .select('operation_id, meta')
                .eq('meta->>idempotencyKey', idempotencyKey)
                .eq('type', 'bus_swap')
                .maybeSingle();
            
            if (existing) {
                return NextResponse.json({
                    success: true,
                    message: 'Bus swap already processed (idempotent)',
                    idempotent: true,
                    operationId: existing.operation_id,
                });
            }
        }

        // 1. Fetch route from PG + buses from PG
        const [routeData, fromBus, toBus] = await Promise.all([
            routeService.getById(routeId),
            getBusById(fromBusId),
            getBusById(toBusId)
        ]);

        if (!routeData) return NextResponse.json({ error: 'Route not found' }, { status: 404 });
        if (!fromBus) return NextResponse.json({ error: `Bus ${fromBusId} not found` }, { status: 404 });
        if (!toBus) return NextResponse.json({ error: `Bus ${toBusId} not found` }, { status: 404 });

        // 2. Update bus statuses via PG
        await Promise.all([
            updateBus(fromBusId, { status: 'maintenance' }),
            updateBus(toBusId, { status: 'active', routeId: routeId })
        ]);

        const operationId = `bus_swap_${Date.now()}_${crypto.randomUUID()}`;

        // 3. Audit log with idempotency key
        try {
            await supabase.from('reassignment_logs').insert([{
                operation_id: operationId,
                type: 'bus_swap',
                actor_id: auth.uid,
                actor_label: 'Admin Bus Swap',
                status: 'committed',
                summary: `Swapped bus ${fromBusId} to ${toBusId} on route ${routeId}`,
                changes: [{
                    docPath: `buses/${fromBusId}`,
                    collection: 'buses',
                    docId: fromBusId,
                    before: { status: fromBus.status || 'active', routeId: fromBus.routeId },
                    after: { status: 'maintenance', routeId: null },
                }, {
                    docPath: `buses/${toBusId}`,
                    collection: 'buses',
                    docId: toBusId,
                    before: { status: toBus.status, routeId: toBus.routeId },
                    after: { status: 'active', routeId: routeId },
                }],
                meta: { idempotencyKey: idempotencyKey || null },
            }]);
        } catch (auditErr) {
            console.error('Bus swap audit log failed:', auditErr);
        }

        // 4. Parallelized Realtime & Notifications (Non-blocking response)
        const postTasks = [
            // Supabase Broadcast
            supabase.channel(`route_${routeId}`).send({
                type: 'broadcast',
                event: 'bus_swapped',
                payload: { routeId, fromBusId, toBusId, timestamp: new Date().toISOString() }
            }),
            // Scalable FCM Topic Notification
            notifyRouteTopic({
                routeId,
                title: 'Bus Changed',
                body: `Your route bus has been changed to ${toBus.busNumber || toBusId}`,
                data: { type: 'bus_swapped', routeId, newBusId: toBusId },
                eventType: 'BUS_CHANGED'
            })
        ];

        // We await them but could fire-and-forget if absolute speed is needed
        await Promise.allSettled(postTasks);

        return NextResponse.json({
            success: true,
            message: 'Bus swapped successfully',
            operationId,
            idempotent: false,
            data: {
                routeId,
                fromBus: { busId: fromBusId, busNumber: fromBus.busNumber, status: 'maintenance' },
                toBus: { busId: toBusId, busNumber: toBus.busNumber, status: 'active' }
            }
        });
    },
    {
        requiredRoles: ['admin'],
        schema: AdminSwapBusSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
