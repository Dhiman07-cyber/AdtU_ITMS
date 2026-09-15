import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RespondWaitSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { studentId, response, busId } = body as any;

        // Verify the driver holds an active trip on THIS bus before letting
        // them send a wait response to the student.
        const supabase = getSupabaseServer();
        const { data: activeTrip } = await supabase
            .from('active_trips')
            .select('trip_id')
            .eq('driver_id', auth.uid)
            .eq('bus_id', busId)
            .eq('status', 'active')
            .maybeSingle();

        if (!activeTrip) {
            return NextResponse.json(
                { error: 'Driver is not assigned to this bus' },
                { status: 403 }
            );
        }

        // Deliver driver's response through student_{uid} channel (student subscribes to this)
        await emitEvent(`student_${studentId}`, 'wait_response', {
            busId,
            response,
            timestamp: Date.now()
        });

        return NextResponse.json({ success: true });
    },
    {
        requiredRoles: ['driver'],
        schema: RespondWaitSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
