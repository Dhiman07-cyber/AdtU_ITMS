import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { AdminSwapBusSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { notifyRouteTopic } from '@/lib/services/fcm-notification-service';
import { getBusById, updateBus } from '@/domains/fleet';
import * as routeService from '@/domains/route';

/**
 * POST /api/admin/swap-bus
 * 
 * Optimized:
 * - Parallelized metadata fetching (Route, FromBus, ToBus)
 * - Scalable FCM Topic notifications (replaces expensive N+1 token fetching)
 * - Atomic Firestore batch updates
 */

export const POST = withSecurity(
    async (request, { body }) => {
        const { routeId, fromBusId, toBusId } = body as any;
        const supabase = getSupabaseServer();

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

        // 3. Parallelized Realtime & Notifications (Non-blocking response)
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
