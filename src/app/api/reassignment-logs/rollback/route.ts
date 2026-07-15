/**
 * Rollback API Route
 * 
 * POST /api/reassignment-logs/rollback - Execute rollback of a committed operation
 * GET /api/reassignment-logs/rollback?operationId=xxx - Validate rollback feasibility
 * 
 * SECURITY: Uses withSecurity wrapper. Admin-only access for rollback operations.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { createAuditEvent, type AuditActorRole } from '@/domains/audit';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReassignmentLogsDatabase } from '@/lib/types/reassignment-logs';
import crypto from 'crypto';

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
// SUPABASE CLIENT (via canonical singleton)
// ============================================================================

function getSupabase() {
    return getSupabaseServer();
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

            try {
                const docRef = adminDb.collection(change.collection).doc(change.docId);
                const docSnap = await docRef.get();

                if (!docSnap.exists) {
                    conflicts.push(`Document ${change.docPath} no longer exists`);
                    continue;
                }

                const currentData = docSnap.data();

                // Compare relevant fields
                for (const key of Object.keys(change.after)) {
                    const expected = JSON.stringify(change.after[key]);
                    const actual = JSON.stringify(currentData?.[key]);

                    if (expected !== actual) {
                        conflicts.push(
                            `${change.docPath}.${key}: expected '${expected}', found '${actual}'`
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

        // Create pending rollback log
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

        // ── ATOMIC rollback: every 'before' snapshot is re-applied in ONE Firestore
        //    transaction, so a partial failure can no longer leave a broken rollback
        //    chain (the former loop applied doc-by-doc and could stop half-way). Each
        //    target doc is re-read inside the transaction; a missing doc OR a state
        //    that no longer matches the recorded 'after' aborts the WHOLE rollback
        //    (409) instead of clobbering a newer reassignment. A durable Tier A audit
        //    row commits atomically with the revert.
        try {
            await adminDb.runTransaction(async (transaction) => {
                const refs = reverts.map((c) => adminDb.collection(c.collection).doc(c.docId));
                const snaps = await Promise.all(refs.map((r) => transaction.get(r)));

                // Validate ALL preconditions before writing anything.
                snaps.forEach((snap, i) => {
                    const change = reverts[i];
                    if (!snap.exists) {
                        throw new RollbackConflictError(`Document ${change.docPath} no longer exists`);
                    }
                    const currentData = snap.data() || {};
                    for (const key of Object.keys(change.after || {})) {
                        const expected = JSON.stringify((change.after as Record<string, unknown>)[key]);
                        const actual = JSON.stringify(getByPath(currentData, key));
                        if (expected !== actual) {
                            throw new RollbackConflictError(
                                `${change.docPath}.${key} changed since the operation (expected ${expected}, found ${actual}); rollback aborted`,
                            );
                        }
                    }
                });

                // All preconditions satisfied → apply the reverts atomically.
                snaps.forEach((snap, i) => {
                    const change = reverts[i];
                    transaction.update(refs[i], change.before as Record<string, unknown>);
                    revertedDocs.push(change.docPath);
                    rollbackChanges.push({ ...change, before: change.after, after: change.before });
                });


            });
        } catch (err: unknown) {
            const message = err instanceof RollbackConflictError
                ? err.message
                : (err instanceof Error ? err.message : 'unknown error');
            // Nothing was reverted (atomic). Mark the pending rollback log failed.
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

        // Firestore rollback committed atomically. Finalize the
        // Supabase audit logs best-effort — failures here do NOT undo the rollback.
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
                : 'Rollback committed (Firestore + durable audit); Supabase log update had errors',
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
