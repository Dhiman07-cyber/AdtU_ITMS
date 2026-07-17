import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { MarkBoardedSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';

/**
 * POST /api/driver/mark-boarded
 * 
 * Body: { flagId }
 * 
 * Optimized:
 * - Parallel broadcasts to all channels
 * - Atomic Supabase update
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { flagId } = body as any;
        const driverUid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Fetch waiting flag data
        const { data: flagData, error: flagError } = await supabase
            .from('waiting_flags')
            .select('*')
            .eq('id', flagId)
            .single();

        if (flagError || !flagData) {
            return NextResponse.json({ error: 'Waiting flag not found' }, { status: 404 });
        }

        if (flagData.status === 'picked_up' || flagData.status === 'boarded') {
            return NextResponse.json({ success: true, message: 'Student already boarded', data: { flagId, studentUid: flagData.student_uid } });
        }

        if (flagData.status === 'cancelled' || flagData.status === 'expired') {
            return NextResponse.json({ error: `Cannot mark boarded: flag is ${flagData.status}` }, { status: 400 });
        }

        // 2. Atomic update in Supabase
        const { data: updatedData, error: updateError } = await supabase
            .from('waiting_flags')
            .update({
                status: 'picked_up',
                boarded_at: new Date().toISOString(),
                ack_by_driver_uid: driverUid
            })
            .eq('id', flagId)
            .in('status', ['raised', 'acknowledged', 'waiting'])
            .select();

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update flag status' }, { status: 500 });
        }

        if (!updatedData || updatedData.length === 0) {
            return NextResponse.json({ success: true, message: 'Student already boarded or processed', data: { flagId, studentUid: flagData.student_uid } });
        }

        // 3. Parallel Broadcasts for instant UI feedback
        // Note: Using channel().send() without removing channel immediately for speed
        const broadcastTask = Promise.allSettled([
            supabase.channel(`waiting_flags_${flagData.bus_id}`).send({
                type: 'broadcast',
                event: 'waiting_flag_updated',
                payload: { flagId, studentUid: flagData.student_uid, status: 'picked_up', timestamp: new Date().toISOString() }
            }),
            supabase.channel(`student_${flagData.student_uid}`).send({
                type: 'broadcast',
                event: 'flag_acknowledged',
                payload: { flagId, busId: flagData.bus_id, status: 'picked_up', ackByDriverUid: driverUid, timestamp: new Date().toISOString(), message: 'Driver has arrived!' }
            }),
            supabase.channel(`route_${flagData.route_id}`).send({
                type: 'broadcast',
                event: 'waiting_flag_updated',
                payload: { flagId, studentUid: flagData.student_uid, busId: flagData.bus_id, routeId: flagData.route_id, status: 'picked_up', timestamp: new Date().toISOString() }
            })
        ]);

        // Await broadcasts briefly to ensure they are initiated
        await broadcastTask;

        return NextResponse.json({
            success: true,
            message: 'Student boarded successfully',
            data: { flagId, studentUid: flagData.student_uid }
        });
    },
    {
        requiredRoles: ['driver'],
        schema: MarkBoardedSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
