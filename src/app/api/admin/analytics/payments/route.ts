import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
    async () => {
        // Get monthly date boundaries for current year
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

        // Fetch Payment Stats and Year Payments concurrently
        const [stats, yearPayments] = await Promise.all([
            paymentsSupabaseService.getPaymentStats(),
            paymentsSupabaseService.getCompletedPaymentsForReporting(startOfYear, endOfYear),
        ]);

        // Aggregate monthly data in a single O(N) pass
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthlyTotals = new Float64Array(12);
        for (const p of yearPayments) {
            const dateStr = p.transaction_date || p.created_at;
            if (dateStr) {
                const month = new Date(dateStr).getMonth();
                if (month >= 0 && month < 12) {
                    monthlyTotals[month] += (p.amount || 0);
                }
            }
        }
        const monthlyData = months.map((name, idx) => ({ name, amount: monthlyTotals[idx] }));

        return NextResponse.json({
            success: true,
            stats: {
                totalRevenue: stats.totalRevenue,
                completedCount: stats.completedPayments,
                pendingCount: stats.pendingPayments,
                monthlyData: monthlyData
            }
        });
    },
    {
        requiredRoles: ['admin'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ
    }
);
