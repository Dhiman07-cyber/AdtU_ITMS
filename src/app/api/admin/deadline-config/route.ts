import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
    async () => {
        const config = await getDeadlineConfig();
        return NextResponse.json({
            success: true,
            config,
        });
    },
    {
        requiredRoles: [], // Authenticated users (admin/mod/student/driver) can view config
        schema: EmptySchema,
        rateLimit: RateLimits.READ
    }
);
