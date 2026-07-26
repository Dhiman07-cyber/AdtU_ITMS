import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { MarkBoardedSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { emitEvent } from '@/domains/realtime/event-emitter';

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
                status: 'boarded',
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
