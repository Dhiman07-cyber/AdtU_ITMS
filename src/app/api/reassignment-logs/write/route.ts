import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ReassignmentLogWriteSchema = z.object({
  operationId: z.string().min(1).max(200),
  type: z.enum(['driver_reassignment', 'student_reassignment', 'route_reassignment', 'rollback']),
  actorLabel: z.string().min(1).max(200).optional(),
  status: z.enum(['pending', 'committed', 'rolled_back', 'failed', 'no-op']),
  summary: z.string().max(1000).optional(),
  changes: z.array(z.unknown()).max(1000).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  rollbackOf: z.string().max(200).optional(),
});

type ReassignmentLogWriteBody = z.infer<typeof ReassignmentLogWriteSchema>;

export const POST = withSecurity<ReassignmentLogWriteBody>(
  async (_request, { auth, body }) => {
    const supabase = getSupabaseServer();

    if (body.type !== 'rollback') {
      const { error: deleteError } = await supabase
        .from('reassignment_logs')
        .delete()
        .eq('type', body.type);

      if (deleteError) {
        return NextResponse.json({ error: 'Failed to prepare reassignment log' }, { status: 500 });
      }
    }

    const actorLabel = auth.name
      ? `${auth.name} (${auth.role})`
      : body.actorLabel || auth.role;

    const { data, error } = await supabase
      .from('reassignment_logs')
      .insert([{
        operation_id: body.operationId,
        type: body.type,
        actor_id: auth.uid,
        actor_label: actorLabel,
        status: body.status,
        summary: body.summary || null,
        changes: body.changes || [],
        meta: body.meta || {},
        rollback_of: body.rollbackOf || null,
      }])
      .select('id, operation_id')
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to write reassignment log' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  },
  {
    requiredRoles: ['admin', 'moderator'],
    schema: ReassignmentLogWriteSchema,
    rateLimit: RateLimits.CREATE,
  }
);
