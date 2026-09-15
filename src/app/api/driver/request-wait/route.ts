import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RequestWaitSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * POST /api/driver/request-wait
 * 
 * Sends a wait request from a student to a driver's live dashboard.
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { busId, studentId, studentName, stop_name } = body as any;
        const resolved_stop_name = stop_name || (body as any).stop_name;

        // Security check: Student can only request wait for themselves
        if (auth.uid !== studentId) {
            return NextResponse.json(
                { error: 'Forbidden: You can only request a wait for your own account' },
                { status: 403 }
            );
        }

        // Security check: Student can only request wait on their assigned bus.
        // Prevents spamming arbitrary buses' driver channels.
        const supabase = getSupabaseServer();
        const { data: profile } = await supabase
            .from('student_profiles')
            .select('bus_id')
            .eq('uid', auth.uid)
            .maybeSingle();

        if (!profile?.bus_id || profile.bus_id !== busId) {
            return NextResponse.json(
                { error: 'Forbidden: You can only request a wait on your assigned bus' },
                { status: 403 }
            );
        }

        console.log(`📣 Requesting wait for student ${studentId} on bus ${busId}`);

        // Broadcast to driver channel via WebSocket
        await emitEvent(`driver_wait_request_${busId}`, 'wait_request', {
            studentId,
            studentName,
            stop_name: resolved_stop_name,
            timestamp: Date.now()
        });

        return NextResponse.json({ success: true });
    },
    {
        requiredRoles: ['student'],
        schema: RequestWaitSchema,
        rateLimit: RateLimits.WAITING_FLAG,
        allowBodyToken: true
    }
);
