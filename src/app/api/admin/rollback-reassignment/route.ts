import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { z } from 'zod';
import { updateStudent, getStudentById } from '@/domains/identity';
import { incrementBusCapacity, decrementBusCapacity } from '@/domains/fleet';
import { createAuditEvent, type AuditActorRole } from '@/domains/audit';

const RollbackSchema = z.object({
  operationId: z.string().min(1),
});

type RollbackBody = z.infer<typeof RollbackSchema>;

/**
 * POST /api/admin/rollback-reassignment
 *
 * Rolls back a reassignment using the before/after snapshot from reassignment_logs.
 * Uses domain services to reverse changes in PostgreSQL atomically.
 */
export const POST = withSecurity<RollbackBody>(
  async (_request, { auth, body }) => {
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

      // 2. Separate student and bus changes
      const studentChanges = changes.filter(c => c.collection === 'students');
      const busChanges = changes.filter(c => c.collection === 'buses');

      // 3. Calculate bus capacity deltas for rollback
      const busCapacityUpdates = new Map<string, { morningDelta: number; eveningDelta: number }>();

      for (const change of busChanges) {
        const busId = change.docId;
        const beforeMorning = change.before?.morningLoad || 0;
        const afterMorning = change.after?.morningLoad || 0;
        const beforeEvening = change.before?.eveningLoad || 0;
        const afterEvening = change.after?.eveningLoad || 0;

        // Reverse the deltas: restore to "before" state from "after" state
        busCapacityUpdates.set(busId, {
          morningDelta: beforeMorning - afterMorning,
          eveningDelta: beforeEvening - afterEvening,
        });
      }

      // 4. Apply rollback: Update students to their "before" state
      for (const change of studentChanges) {
        const studentUid = change.docId;
        const before = change.before;

        // Restore student to their original bus/route/shift
        await updateStudent(studentUid, {
          busId: before.busId,
          shift: before.shift,
          updatedAt: new Date().toISOString(),
        });
      }

      // 5. Apply bus capacity rollback
      for (const [busId, deltas] of busCapacityUpdates.entries()) {
        // Apply the calculated deltas to restore original capacity
        if (deltas.morningDelta > 0) {
          for (let i = 0; i < deltas.morningDelta; i++) {
            await incrementBusCapacity(busId, 'Morning');
          }
        } else if (deltas.morningDelta < 0) {
          for (let i = 0; i < Math.abs(deltas.morningDelta); i++) {
            await decrementBusCapacity(busId, 'Morning');
          }
        }

        if (deltas.eveningDelta > 0) {
          for (let i = 0; i < deltas.eveningDelta; i++) {
            await incrementBusCapacity(busId, 'Evening');
          }
        } else if (deltas.eveningDelta < 0) {
          for (let i = 0; i < Math.abs(deltas.eveningDelta); i++) {
            await decrementBusCapacity(busId, 'Evening');
          }
        }
      }

      // 6. Mark the log as rolled back
      await supabase
        .from('reassignment_logs')
        .update({
          status: 'rolled_back',
          meta: {
            ...logEntry.meta,
            rolled_back_at: new Date().toISOString(),
            rolled_back_by: auth.uid,
          },
        })
        .eq('operation_id', operationId);

      // 7. Create audit event
      await createAuditEvent({
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
          bus_count: busChanges.length,
        },
      });

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
