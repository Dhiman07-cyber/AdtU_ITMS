/**
 * Reassignment Logs API Route
 * 
 * GET /api/reassignment-logs - Query reassignment logs from Supabase
 * POST /api/reassignment-logs - Create new log entry
 * 
 * Query params:
 *   - type: 'driver_reassignment' | 'student_reassignment' | 'route_reassignment' | 'rollback'
 *   - status: 'pending' | 'committed' | 'rolled_back' | 'failed' | 'no-op'
 *   - limit: number (default 10)
 *   - offset: number (default 0)
 * 
 * SECURITY: Uses withSecurity wrapper for consistent auth, rate limiting, and validation.
 */

import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import type { ReassignmentLogsDatabase } from '@/lib/types/reassignment-logs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
export const dynamic = 'force-dynamic';

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const ReassignmentLogCreateSchema = z.object({
    operationId: z.string().min(1).max(200),
    type: z.string().min(1).max(100),
    actorId: z.string().min(1).max(128).optional(),
    actorLabel: z.string().min(1).max(200).optional(),
    status: z.string().min(1).max(50),
    summary: z.string().max(1000).optional(),
    changes: z.array(z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    rollbackOf: z.string().max(200).optional(),
});

// ============================================================================
// SUPABASE CLIENT (via canonical singleton)
// ============================================================================

function getSupabase() {
    return getSupabaseServer() as SupabaseClient<ReassignmentLogsDatabase> | null;
}

// ============================================================================
// GET - Query reassignment logs
// ============================================================================

export const GET = withSecurity(
    async (request) => {
        const supabase = getSupabase();
        if (!supabase) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const url = new URL(request.url);
        const type = url.searchParams.get('type');
        const status = url.searchParams.get('status');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 100);
        const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

        let query = supabase
            .from('reassignment_logs')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false });

        if (type) query = query.eq('type', type);
        if (status) query = query.eq('status', status);
        query = query.range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) {
            return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            data: data || [],
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: (count || 0) > offset + limit,
            },
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        rateLimit: RateLimits.READ,
    }
);

// ============================================================================
// POST - Create new reassignment log
// ============================================================================

export const POST = withSecurity<z.infer<typeof ReassignmentLogCreateSchema>>(
    async (request, { auth, body }) => {
        const supabase = getSupabase();
        if (!supabase) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const { operationId, type, status } = body as z.infer<typeof ReassignmentLogCreateSchema>;
        const actorLabel = auth.name ? `${auth.name} (${auth.role})` : auth.role;

        // Delete old logs of the same type first (keep only ONE per type)
        if (type !== 'rollback') {
            await supabase
                .from('reassignment_logs')
                .delete()
                .eq('type', type);
        }

        const { data, error } = await supabase
            .from('reassignment_logs')
            .insert([{
                operation_id: operationId,
                type,
                actor_id: auth.uid,
                actor_label: actorLabel,
                status,
                summary: body.summary || null,
                changes: body.changes || [],
                meta: body.meta || {},
                rollback_of: body.rollbackOf || null,
            }])
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
        }

        return NextResponse.json({ success: true, data });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: ReassignmentLogCreateSchema,
        rateLimit: RateLimits.CREATE,
    }
);
