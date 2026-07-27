import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RequestWaitSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';

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

        console.log(`📣 Requesting wait for student ${studentId} on bus ${busId}`);

        // Initialize Supabase client
        const supabase = getSupabaseServer();

        // Broadcast to driver channel
        // Channel name: driver_wait_request_{busId}
        const channel = supabase.channel(`driver_wait_request_${busId}`);

        await channel.send({
            type: 'broadcast',
            event: 'wait_request',
            payload: {
                studentId,
                studentName,
                stop_name: resolved_stop_name,
                timestamp: Date.now()
            }
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
