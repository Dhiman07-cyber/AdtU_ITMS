/**
 * Rollback API Route
 * 
 * POST /api/reassignment-logs/rollback - Execute rollback of a committed operation
 * GET /api/reassignment-logs/rollback?operationId=xxx - Validate rollback feasibility
 * 
 * SECURITY: Uses withSecurity wrapper. Admin-only access for rollback operations.
 */

import { createAuditEvent,type AuditActorRole } from '@/domains/audit';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** Thrown inside the rollback transaction when current state no longer matches the recorded snapshot. */
class RollbackConflictError extends Error {}

/**
 * Resolve a value by key that may be a dot-path (e.g. 'load.morningCount') OR an
 * exact key. Reassignment snapshots store bus counters as dot-path keys but student
 * fields as plain keys, so precondition comparison must handle both.
 */
function getByPath(obj: Record<string, unknown> | undefined, path: string): unknown {
    if (!obj) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
    return path.split('.').reduce<unknown>(
        (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
        obj,
    );
}

// ============================================================================
// TYPES & SCHEMAS

interface ChangeRecord {
    docPath: string;
    collection: string;
    docId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    precondition?: Record<string, unknown>;
}

interface ReassignmentLog {
    id: string;
    operation_id: string;
    type: string;
    actor_id: string;
    actor_label: string;
    logged_at: string;
    status: string;
    summary: string | null;
    changes: ChangeRecord[];
    meta: Record<string, unknown>;
    rollback_of: string | null;
    created_at: string;
}

const RollbackSchema = z.object({
    operationId: z.string().min(1).max(200),
    actorId: z.string().min(1).max(128).optional(),
    actorLabel: z.string().min(1).max(200).optional(),
});

// ============================================================================
// SUPABASE CLIENT & MAPPERS
// ============================================================================

function getSupabase() {
    return getSupabaseServer();
}

/**
 * Retrieve the current PostgreSQL/Supabase state of an entity.
 * Maps columns back to client-expected keys (busId, studentName, shift, etc.).
 */
async function getCurrentPostgresState(collection: string, docId: string): Promise<Record<string, any> | null> {
    const supabase = getSupabase();
    if (!supabase) {
        throw new Error('Supabase client not initialized');
    }

    if (collection === 'students') {
        const { data, error } = await supabase
            .from('student_profiles')
            .select('bus_id, full_name, shift, stop_name')
            .eq('uid', docId)
            .maybeSingle();

        if (error || !data) return null;
        return {
            busId: data.bus_id,
            bus_id: data.bus_id,
            studentName: data.full_name,
            shift: data.shift,
            stopName: data.stop_name || '',
            stop_name: data.stop_name || ''
        };
    } else if (collection === 'buses') {
        const { data, error } = await supabase
            .from('buses')
            .select('morning_load, evening_load, route_id, route_name')
            .eq('id', docId)
            .maybeSingle();

        if (error || !data) return null;
        const morning = data.morning_load ?? 0;
        const evening = data.evening_load ?? 0;
        return {
            morningLoad: morning,
            morning_load: morning,
            eveningLoad: evening,
            evening_load: evening,
            currentMembers: morning + evening,
            current_members: morning + evening,
            route_id: data.route_id,
            route_name: data.route_name
        };
    } else if (collection === 'drivers') {
        const { data, error } = await supabase
            .from('driver_profiles')
            .select('is_reserved')
            .eq('uid', docId)
            .maybeSingle();

        if (error || !data) return null;
        return {
            is_reserved: data.is_reserved
        };
    }
    return null;
}

// ============================================================================
// GET - Validate if rollback is possible
// ============================================================================

export const GET = withSecurity(
    async (request) => {
        const supabase = getSupabase();
        if (!supabase) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const url = new URL(request.url);
        const operationId = url.searchParams.get('operationId');

        if (!operationId) {
            return NextResponse.json({ error: 'operationId required' }, { status: 400 });
        }

        // Get the operation log
        const { data: log, error } = await supabase
            .from('reassignment_logs')
            .select('*')
            .eq('operation_id', operationId)
            .single();

        if (error || !log) {
            return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
        }

        const typedLog = log as unknown as ReassignmentLog;

        // Check if rollback is possible
        if (typedLog.status !== 'committed') {
            return NextResponse.json({
                canRollback: false,
                reason: `Cannot rollback: status is '${typedLog.status}', expected 'committed'`,
                log: typedLog,
            });
        }

        // Validate current state matches 'after' snapshots
        const conflicts: string[] = [];
        const changes = typedLog.changes;

        for (const change of changes) {
            if (!change.after || !change.collection || !change.docId) continue;
            // Bus counters fluctuate automatically; precondition validation focuses on student records
            if (change.collection === 'buses') continue;

            try {
                const currentState = await getCurrentPostgresState(change.collection, change.docId);

                if (!currentState) {
                    conflicts.push(`Document ${change.docPath} no longer exists`);
                    continue;
                }

                // For student profile check, verify student's bus_id matches the target bus from the reassignment
                if (change.collection === 'students') {
                    const expectedBusId = (change.after.busId || change.after.bus_id) as string;
                    if (expectedBusId && currentState.busId !== expectedBusId) {
                        conflicts.push(
                            `${change.docPath}.busId: expected '${expectedBusId}', found '${currentState.busId}'`
                        );
                    }
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'unknown error';
                conflicts.push(`Error checking ${change.docPath}: ${message}`);
            }
        }

        return NextResponse.json({
            canRollback: conflicts.length === 0,
            conflicts,
            log: {
                operation_id: typedLog.operation_id,
                type: typedLog.type,
                actor_label: typedLog.actor_label,
                timestamp: typedLog.logged_at,
                summary: typedLog.summary,
                changesCount: changes.length,
            },
        });
    },
    {
        requiredRoles: ['admin'],
        rateLimit: RateLimits.READ,
    }
);

// ============================================================================
// POST - Execute rollback
// ============================================================================

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const supabase = getSupabase();
        if (!supabase) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const { operationId } = body as z.infer<typeof RollbackSchema>;
        const actorLabel = auth.name ? `${auth.name} (${auth.role})` : auth.role;

        // Get the original operation
        const { data: originalLog, error: fetchError } = await supabase
            .from('reassignment_logs')
            .select('*')
            .eq('operation_id', operationId)
            .single();

        if (fetchError || !originalLog) {
            return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
        }

        const typedOriginalLog = originalLog as unknown as ReassignmentLog;

        if (typedOriginalLog.status !== 'committed') {
            return NextResponse.json({
                success: false,
                error: `Cannot rollback: status is '${typedOriginalLog.status}'`,
            }, { status: 400 });
        }

        const changes = typedOriginalLog.changes;
        const rollbackOpId = `rollback_${Date.now()}_${crypto.randomUUID()}`;

        // Create pending rollback log in PostgreSQL
        await supabase
            .from('reassignment_logs')
            .insert([{
                operation_id: rollbackOpId,
                type: 'rollback',
                actor_id: auth.uid,
                actor_label: actorLabel,
                status: 'pending',
                summary: `Rollback of operation ${operationId}`,
                changes: [],
                meta: { rollbackOf: operationId },
                rollback_of: operationId,
            }]);

        const reverts = changes.filter((c) => c.before && c.collection && c.docId);
        const revertedDocs: string[] = [];
        const rollbackChanges: ChangeRecord[] = [];

        // Execute rollback transactionally on PostgreSQL via custom execute_reassignment_rollback RPC
        try {
            const { data: rpcResult, error: rpcError } = await supabase.rpc('execute_reassignment_rollback', {
                p_operation_id: operationId,
                p_actor_id: auth.uid,
                p_actor_label: actorLabel,
                p_changes: reverts
            });

            if (rpcError) {
                throw new RollbackConflictError(rpcError.message);
            }

            if (!rpcResult || !rpcResult.success) {
                throw new RollbackConflictError(rpcResult?.error || 'Rollback failed precondition checks');
            }

            revertedDocs.push(...(rpcResult.reverted_docs || []));
            for (const change of reverts) {
                rollbackChanges.push({ ...change, before: change.after, after: change.before });
            }
        } catch (err: unknown) {
            const message = err instanceof RollbackConflictError
                ? err.message
                : (err instanceof Error ? err.message : 'unknown error');

            // Nothing was reverted (atomic transaction rollback). Mark the pending rollback log failed in PostgreSQL.
            await supabase
                .from('reassignment_logs')
                .update({
                    status: 'failed',
                    meta: { rollbackOf: operationId, error: message, failedAt: new Date().toISOString() },
                })
                .eq('operation_id', rollbackOpId);

            return NextResponse.json({
                success: false,
                error: `Rollback aborted: ${message}`,
                rollbackOperationId: rollbackOpId,
            }, { status: 409 });
        }

        void createAuditEvent({
            action: 'reassignment_rolled_back',
            actor_id: auth.uid,
            actor_name: actorLabel,
            actor_role: (auth.role as AuditActorRole) || 'admin',
            target_id: operationId,
            target_type: 'reassignment',
            target_name: operationId,
            category: 'reassignments',
            summary: `Rolled back operation ${operationId}`,
            severity: 'high',
            metadata: {
                before: { rolledBackOperation: operationId, status: 'committed' },
                after: { status: 'rolled_back', revertedDocCount: reverts.length },
                rollbackOperationId: rollbackOpId,
                revertedDocs: reverts.map((c) => c.docPath),
                correlationId: operationId,
            },
        });

        // Finalize the Supabase reassignment logs
        const postErrors: string[] = [];

        const { error: updateRollbackError } = await supabase
            .from('reassignment_logs')
            .update({
                status: 'committed',
                changes: rollbackChanges,
                meta: { rollbackOf: operationId, revertedDocs, completedAt: new Date().toISOString() },
            })
            .eq('operation_id', rollbackOpId);

        if (updateRollbackError) {
            console.error('Failed to update rollback log:', updateRollbackError);
            postErrors.push(`Failed to finalize rollback audit log (${updateRollbackError.message})`);
        }

        const { error: updateOriginalError } = await supabase
            .from('reassignment_logs')
            .update({
                status: 'rolled_back',
                meta: { ...typedOriginalLog.meta, rolledBackBy: rollbackOpId, rolledBackAt: new Date().toISOString() },
            })
            .eq('operation_id', operationId);

        if (updateOriginalError) {
            console.error('Failed to update original log status:', updateOriginalError);
            postErrors.push(`Rollback succeeded but original log status could not be updated (${updateOriginalError.message})`);
        }

        return NextResponse.json({
            success: true,
            message: postErrors.length === 0
                ? 'Rollback completed successfully'
                : 'Rollback committed; Supabase log update had errors',
            rollbackOperationId: rollbackOpId,
            revertedDocs,
            errors: postErrors.length > 0 ? postErrors : undefined,
        });
    },
    {
        requiredRoles: ['admin'],
        schema: RollbackSchema,
        rateLimit: RateLimits.BULK_OPERATION,
    }
);
