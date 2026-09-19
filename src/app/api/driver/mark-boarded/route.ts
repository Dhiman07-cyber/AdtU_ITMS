import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { MarkBoardedSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

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

        // 1. Fetch waiting flag and driver active trip in parallel
        const [flagRes, tripRes] = await Promise.all([
            supabase.from('waiting_flags').select('id, bus_id, status, student_uid').eq('id', flagId).single(),
            supabase.from('active_trips').select('trip_id, bus_id').eq('driver_id', driverUid).eq('status', 'active').maybeSingle(),
        ]);

        const flagData = flagRes.data;
        if (flagRes.error || !flagData) {
            return NextResponse.json({ error: 'Waiting flag not found' }, { status: 404 });
        }

        const activeTrip = tripRes.data;
        if (!activeTrip || activeTrip.bus_id !== flagData.bus_id) {
            return NextResponse.json(
                { error: 'Driver is not assigned to this bus' },
                { status: 403 }
            );
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
                status: 'boarded',
                ack_by_driver_uid: driverUid
            })
            .eq('id', flagId)
            .in('status', ['raised', 'acknowledged', 'waiting'])
            .select('id');

        if (updateError) {
            return NextResponse.json({ error: 'Failed to update flag status' }, { status: 500 });
        }

        if (!updatedData || updatedData.length === 0) {
            return NextResponse.json({ success: true, message: 'Student already boarded or processed', data: { flagId, studentUid: flagData.student_uid } });
        }

        // 3. Parallel Broadcasts via WebSocket
        const ts = new Date().toISOString();
        await Promise.allSettled([
            emitEvent(`waiting_flags_${flagData.bus_id}`, 'waiting_flag_boarded', { flagId, studentUid: flagData.student_uid, status: 'boarded', timestamp: ts }),
            emitEvent(`student_${flagData.student_uid}`, 'flag_acknowledged', { flagId, busId: flagData.bus_id, status: 'boarded', ackByDriverUid: driverUid, timestamp: ts, message: 'Driver has arrived!' }),
        ]);

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
