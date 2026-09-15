import { createAuditEvent,type AuditActorRole } from '@/domains/audit';
import { withSecurity } from '@/lib/security/api-security';
import { requireAdminPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const RollbackSchema = z.object({
  operationId: z.string().min(1),
});

type RollbackBody = z.infer<typeof RollbackSchema>;

/**
 * POST /api/admin/rollback-reassignment
 *
 * Rolls back a reassignment using the before/after snapshot from reassignment_logs.
 *
 * Delegates to the atomic `execute_reassignment_rollback` RPC (the same
 * implementation behind POST /api/reassignment-logs/rollback): single
 * transaction, precondition checks, bus-load recount, idempotent on retry.
 * This route preserves the legacy response shape ({ success, studentCount })
 * for the smart-allocation undo snackbar.
 */
export const POST = withSecurity<RollbackBody>(
  async (_request, { auth, body }) => {
    const permissionDenied = await requireAdminPermission(auth);
    if (permissionDenied) return permissionDenied;

    const { operationId } = body;
    const supabase = getSupabaseServer();

    try {
      // 1. Fetch the reassignment log from Supabase
      const { data: logEntry, error: logError } = await supabase
        .from('reassignment_logs')
        .select('*')
        .eq('operation_id', operationId)
        .eq('status', 'committed')
        .single();

      if (logError || !logEntry) {
        return NextResponse.json(
          { success: false, error: 'Reassignment log not found or already rolled back' },
          { status: 404 }
        );
      }

      const changes = logEntry.changes as Array<{
        docPath: string;
        collection: string;
        docId: string;
        before: any;
        after: any;
      }>;

      if (!changes || changes.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No changes found in log' },
          { status: 400 }
        );
      }

      const studentChanges = changes.filter(c => c.collection === 'students');

      // 2. Execute the rollback atomically via RPC (single transaction with
      // precondition checks + bus-load recount). Safe to retry: already-rolled
      // -back logs return success without re-applying changes.
      const actorLabel = auth.name ? `${auth.name} (${auth.role})` : auth.role;
      const { data: rpcResult, error: rpcError } = await supabase.rpc('execute_reassignment_rollback', {
        p_operation_id: operationId,
        p_actor_id: auth.uid,
        p_actor_label: actorLabel,
        p_changes: changes,
      });

      if (rpcError) {
        console.error('Rollback RPC failed:', rpcError);
        return NextResponse.json(
          { success: false, error: 'Rollback failed. Please retry.' },
          { status: 409 }
        );
      }

      if (!rpcResult?.success) {
        return NextResponse.json(
          { success: false, error: rpcResult?.error || 'Rollback failed precondition checks' },
          { status: 409 }
        );
      }

      // 3. Create audit event (non-blocking: the rollback already committed;
      // an audit failure must not misreport success as failure).
      void createAuditEvent({
        action: 'reassignment_rolled_back',
        actor_id: auth.uid,
        actor_name: auth.name || 'Unknown',
        actor_role: (auth.role as AuditActorRole) || 'admin',
        target_id: operationId,
        target_type: 'reassignment',
        target_name: operationId,
        category: 'reassignments',
        summary: `Rolled back reassignment ${operationId} (${studentChanges.length} students)`,
        severity: 'medium',
        metadata: {
          operation_id: operationId,
          student_count: studentChanges.length,
        },
      }).catch((e) => console.error('Rollback audit event failed (non-critical):', e?.message || e));

      return NextResponse.json({
        success: true,
        message: `Successfully rolled back reassignment affecting ${studentChanges.length} student(s)`,
        studentCount: studentChanges.length,
      });
    } catch (error: any) {
      console.error('Rollback failed:', error);
      return NextResponse.json(
        { success: false, error: error.message || 'Rollback failed' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    schema: RollbackSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
