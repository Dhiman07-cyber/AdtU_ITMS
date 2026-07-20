import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { InvalidTokensQuerySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';

export const GET = withSecurity(
    async (request, { body }) => {
        const olderThanDays = body.olderThan || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);

        const db = getSupabaseServer();

        // Get all tokens from PostgreSQL
        const { data: tokens, error } = await db
            .from('fcm_tokens')
            .select('user_id, token_hash, platform, last_seen, valid');

        if (error) {
            console.error('Failed to fetch FCM tokens:', error.message);
            return NextResponse.json(
                { error: 'Failed to fetch tokens' },
                { status: 500 }
            );
        }

        const staleTokens: Array<{
            studentId: string;
            tokenHash: string;
            platform: string;
            lastSeen: string;
            valid: boolean;
        }> = [];

        let totalTokens = 0;
        let validTokens = 0;

        for (const token of tokens ?? []) {
            totalTokens++;
            if (token.valid) validTokens++;

            const lastSeenDate = new Date(token.last_seen);
            const isStale = lastSeenDate < cutoff;
            const isInvalid = token.valid === false;

            if (isStale || isInvalid) {
                staleTokens.push({
                    studentId: token.user_id,
                    tokenHash: token.token_hash,
                    platform: token.platform || 'unknown',
                    lastSeen: lastSeenDate.toISOString(),
                    valid: token.valid,
                });
            }
        }

        return NextResponse.json({
            summary: {
                totalTokens,
                validTokens,
                staleOrInvalidTokens: staleTokens.length,
                olderThanDays,
            },
            staleTokens: staleTokens.slice(0, 100),
        });
    },
    {
        requiredRoles: ['admin'],
        schema: InvalidTokensQuerySchema,
        rateLimit: RateLimits.READ
    }
);
