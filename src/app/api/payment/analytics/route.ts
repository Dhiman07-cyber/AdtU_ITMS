
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
    async (request) => {
        // Get mode from query parameter: 'days' (default) or 'months'
        const { searchParams } = new URL(request.url);
        const mode = searchParams.get('mode') || 'days';

        const stats = await paymentsSupabaseService.getPaymentStats();
        const methodTrend = await paymentsSupabaseService.getPaymentMethodTrend();

        let trend;
        if (mode === 'months') {
            trend = await paymentsSupabaseService.getPaymentTrendMonthly();
        } else {
            trend = await paymentsSupabaseService.getPaymentTrend();
        }

        return NextResponse.json({
            success: true,
            data: {
                ...stats,
                trend,
                methodTrend
            }
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ,
    }
);
