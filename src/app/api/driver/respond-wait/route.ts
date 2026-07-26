import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { RespondWaitSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { emitEvent } from '@/domains/realtime/event-emitter';

export const POST = withSecurity(
    async (request, { body }) => {
        const { studentId, response, busId } = body as any;

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
