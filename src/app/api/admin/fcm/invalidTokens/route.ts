import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { InvalidTokensQuerySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
    async (request, { body }) => {
        const olderThanDays = body.olderThan || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);

        const db = getSupabaseServer();
        const cutoffIso = cutoff.toISOString();

        // Push filter to SQL and fetch counts concurrently
        const [totalRes, validRes, staleRes] = await Promise.all([
            db.from('fcm_tokens').select('*', { count: 'exact', head: true }),
            db.from('fcm_tokens').select('*', { count: 'exact', head: true }).eq('valid', true),
            db.from('fcm_tokens')
                .select('user_id, token_hash, platform, last_seen, valid', { count: 'exact' })
                .or(`valid.eq.false,last_seen.lt.${cutoffIso}`)
                .order('last_seen', { ascending: true })
                .limit(100),
        ]);

        if (staleRes.error) {
            console.error('Failed to fetch FCM tokens:', staleRes.error.message);
            return NextResponse.json(
                { error: 'Failed to fetch tokens' },
                { status: 500 }
            );
        }

        const totalTokens = totalRes.count ?? 0;
        const validTokens = validRes.count ?? 0;
        const staleOrInvalidTokens = staleRes.count ?? (staleRes.data?.length || 0);

        const staleTokens = (staleRes.data || []).map((token) => ({
            studentId: token.user_id,
            tokenHash: token.token_hash,
            platform: token.platform || 'unknown',
            lastSeen: new Date(token.last_seen).toISOString(),
            valid: token.valid,
        }));

        return NextResponse.json({
            summary: {
                totalTokens,
                validTokens,
                staleOrInvalidTokens,
                olderThanDays,
            },
            staleTokens,
        });
    },
    {
        requiredRoles: ['admin'],
        schema: InvalidTokensQuerySchema,
        rateLimit: RateLimits.READ
    }
);
