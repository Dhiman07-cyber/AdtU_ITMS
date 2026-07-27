/**
 * Reassignment Logs Supabase Service
 * 
 * Server-side service for managing reassignment audit logs in Supabase.
 * Handles writing/reading logs and performing rollback operations.
 * 
 * IMPORTANT: Use only with service role key on server side.
 */

import { generatePrefixedId } from '@/lib/security/random-id';
import { getSupabaseServer } from '@/lib/supabase-server';
import { SupabaseClient } from '@supabase/supabase-js';

// ============================================
// TYPES
// ============================================

export interface ChangeRecord {
    docPath: string;           // Firestore document path
    collection: string;        // Collection name (drivers, buses, students, routes)
    docId: string;             // Document ID
    before: Record<string, any> | null;  // State before change
    after: Record<string, any> | null;   // State after change
    precondition?: Record<string, any>;  // Expected state for validation
}

export type ReassignmentType =
    | 'driver_reassignment'
    | 'student_reassignment'
    | 'route_reassignment'
    | 'rollback';

export type ReassignmentStatus =
    | 'pending'
    | 'committed'
    | 'rolled_back'
    | 'failed'
    | 'no-op';

export interface ReassignmentLogPayload {
    operationId: string;
    type: ReassignmentType;
    actorId: string;
    actorLabel: string;
    status: ReassignmentStatus;
    summary?: string;
    changes: ChangeRecord[];
    meta?: Record<string, any>;
    rollbackOf?: string;
}

export interface ReassignmentLogRecord {
    id: string;
    operation_id: string;
    type: ReassignmentType;
    actor_id: string;
    actor_label: string;
    timestamp: string;
    status: ReassignmentStatus;
    summary: string | null;
    changes: ChangeRecord[];
    meta: Record<string, any>;
    rollback_of: string | null;
    created_at: string;
}

export interface QueryOptions {
    type?: ReassignmentType;
    status?: ReassignmentStatus;
    actorId?: string;
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
}

export interface RollbackResult {
    success: boolean;
    message: string;
    rollbackOperationId?: string;
    conflictDetails?: string[];
    revertedDocs?: string[];
}

// ============================================
// SERVICE CLASS
// ============================================

class ReassignmentLogsService {
    private supabase: SupabaseClient | null = null;
    private isInitialized: boolean = false;
    private initAttempted: boolean = false;

    constructor() {
        // Lazy initialization - will initialize on first use
    }

    /**
     * Initialize the service (called on first use)
     */
    private initialize(): void {
        if (this.initAttempted) return;
        this.initAttempted = true;

        try {
            this.supabase = getSupabaseServer();
            this.isInitialized = true;
        } catch (err) {
            // Credentials may not be available in client context
            this.isInitialized = false;
        }
    }

    /**
     * Check if service is initialized (triggers lazy init)
     */
    isReady(): boolean {
        if (!this.initAttempted) {
            this.initialize();
        }
        return this.isInitialized && this.supabase !== null;
    }

    /**
     * Get the Supabase client (initializes if needed)
     */
    private getClient(): SupabaseClient {
        if (!this.isReady()) {
            throw new Error('ReassignmentLogsService not initialized - missing Supabase credentials');
        }
        return this.supabase!;
    }

    generateOperationId(type: ReassignmentType): string {
        return generatePrefixedId(`${type}_`, 8);
    }

    // ============================================
    // WRITE OPERATIONS
    // ============================================

    /**
     * Insert a new reassignment log entry and cleanup old logs of the same type.
     * Only keeps ONE log per reassignment type (driver/student/route).
     * Rollback logs are kept separately.
     */
    async insertLog(payload: ReassignmentLogPayload): Promise<string | null> {
        if (!this.isReady()) {
            console.error('[ReassignmentLogsService] Not initialized');
            return null;
        }

        try {
            // First, delete all existing logs of the same type (except rollbacks)
            // This ensures only ONE doc per reassignment type is stored
            if (payload.type !== 'rollback') {
                const { error: deleteError } = await this.getClient()
                    .from('reassignment_logs')
                    .delete()
                    .eq('type', payload.type);

                if (deleteError) {
                    console.warn(`[ReassignmentLogsService] Cleanup warning for ${payload.type}:`, deleteError);
                } else {
                    console.log(`[ReassignmentLogsService] Cleaned up old ${payload.type} logs`);
                }
            }

            // Now insert the new log
            const { data, error } = await this.getClient()
                .from('reassignment_logs')
                .insert([{
                    operation_id: payload.operationId,
                    type: payload.type,
                    actor_id: payload.actorId,
                    actor_label: payload.actorLabel,
                    status: payload.status,
                    summary: payload.summary || null,
                    changes: payload.changes,
                    meta: payload.meta || {},
                    rollback_of: payload.rollbackOf || null,
                }])
                .select('id')
                .single();

            if (error) {
                console.error('[ReassignmentLogsService] Insert error:', error);
                return null;
            }

            console.log(`[ReassignmentLogsService] Log inserted: ${payload.operationId}`);
            return data?.id || payload.operationId;
        } catch (err) {
            console.error('[ReassignmentLogsService] Insert exception:', err);
            return null;
        }
    }

    /**
     * Update log status after commit/failure
     * Call this AFTER committing changes to update status
     */
    async updateLogStatus(
        operationId: string,
        status: ReassignmentStatus,
        additionalMeta?: Record<string, any>
    ): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const updateData: any = { status };

            if (additionalMeta) {
                // Merge with existing meta
                const { data: existing } = await this.getClient()
                    .from('reassignment_logs')
                    .select('meta')
                    .eq('operation_id', operationId)
                    .single();

                updateData.meta = {
                    ...(existing?.meta || {}),
                    ...additionalMeta,
                    statusUpdatedAt: new Date().toISOString(),
                };
            }

            const { error } = await this.getClient()
                .from('reassignment_logs')
                .update(updateData)
                .eq('operation_id', operationId);

            if (error) {
                console.error('[ReassignmentLogsService] Update error:', error);
                return false;
            }

            console.log(`[ReassignmentLogsService] Log updated: ${operationId} → ${status}`);
            return true;
        } catch (err) {
            console.error('[ReassignmentLogsService] Update exception:', err);
            return false;
        }
    }

    // ============================================
    // READ OPERATIONS
    // ============================================

    /**
     * Get a single log by operation ID
     */
    async getLogByOperationId(operationId: string): Promise<ReassignmentLogRecord | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.getClient()
                .from('reassignment_logs')
                .select('*')
                .eq('operation_id', operationId)
                .single();

            if (error) {
                console.error('[ReassignmentLogsService] Get error:', error);
                return null;
            }

            return data as ReassignmentLogRecord;
        } catch (err) {
            console.error('[ReassignmentLogsService] Get exception:', err);
            return null;
        }
    }

    /**
     * Query logs with filters
     */
    async queryLogs(options: QueryOptions = {}): Promise<ReassignmentLogRecord[]> {
        if (!this.isReady()) return [];

        try {
            let query = this.getClient()
                .from('reassignment_logs')
                .select('*')
                .order('created_at', { ascending: false });

            if (options.type) {
                query = query.eq('type', options.type);
            }
            if (options.status) {
                query = query.eq('status', options.status);
            }
            if (options.actorId) {
                query = query.eq('actor_id', options.actorId);
            }
            if (options.startDate) {
                query = query.gte('created_at', options.startDate.toISOString());
            }
            if (options.endDate) {
                query = query.lte('created_at', options.endDate.toISOString());
            }
            if (options.limit) {
                query = query.limit(options.limit);
            }
            if (options.offset) {
                query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
            }

            const { data, error } = await query;

            if (error) {
                console.error('[ReassignmentLogsService] Query error:', error);
                return [];
            }

            return (data || []) as ReassignmentLogRecord[];
        } catch (err) {
            console.error('[ReassignmentLogsService] Query exception:', err);
            return [];
        }
    }

    /**
     * Get recent logs for a specific type
     */
    async getRecentByType(type: ReassignmentType, limit: number = 10): Promise<ReassignmentLogRecord[]> {
        return this.queryLogs({ type, limit });
    }

    /**
     * Get all rollback-eligible operations (committed status)
     */
    async getRollbackEligible(type?: ReassignmentType, limit: number = 10): Promise<ReassignmentLogRecord[]> {
        return this.queryLogs({
            type,
            status: 'committed',
            limit
        });
    }

    // ============================================
    // ROLLBACK OPERATIONS
    // ============================================

    /**
     * Validate rollback preconditions
     * Checks if current DB state matches the recorded 'after' snapshots
     */
    async validateRollback(
        operationId: string,
        getCurrentState: (collection: string, docId: string) => Promise<Record<string, any> | null>
    ): Promise<{ valid: boolean; conflicts: string[] }> {
        const log = await this.getLogByOperationId(operationId);

        if (!log) {
            return { valid: false, conflicts: ['Operation not found'] };
        }

        if (log.status !== 'committed') {
            return { valid: false, conflicts: [`Cannot rollback: status is '${log.status}', expected 'committed'`] };
        }

        const conflicts: string[] = [];

        for (const change of log.changes) {
            if (!change.after) continue; // Skip if no expected state

            try {
                const currentState = await getCurrentState(change.collection, change.docId);

                if (!currentState) {
                    conflicts.push(`Document ${change.docPath} no longer exists`);
                    continue;
                }

                // Deep compare relevant fields from 'after' snapshot with current state
                for (const key of Object.keys(change.after)) {
                    if (JSON.stringify(currentState[key]) !== JSON.stringify(change.after[key])) {
                        conflicts.push(
                            `${change.docPath}.${key}: expected '${JSON.stringify(change.after[key])}', ` +
                            `found '${JSON.stringify(currentState[key])}'`
                        );
                    }
                }
            } catch (err: any) {
                conflicts.push(`Error checking ${change.docPath}: ${err.message}`);
            }
        }

        return {
            valid: conflicts.length === 0,
            conflicts,
        };
    }

    /**
     * Execute rollback for an operation
     * This creates a new rollback log entry and reverts changes
     * 
     * @param operationId - The operation to rollback
     * @param actorId - Who is performing the rollback
     * @param actorLabel - Human-readable actor label
     * @param applyBefore - Function to apply 'before' state to each document
     */
    async executeRollback(
        operationId: string,
        actorId: string,
        actorLabel: string,
        applyBefore: (collection: string, docId: string, beforeState: Record<string, any>) => Promise<boolean>
    ): Promise<RollbackResult> {
        const log = await this.getLogByOperationId(operationId);

        if (!log) {
            return { success: false, message: 'Operation not found' };
        }

        if (log.status !== 'committed') {
            return {
                success: false,
                message: `Cannot rollback: status is '${log.status}'`
            };
        }

        // Create rollback operation log
        const rollbackOpId = this.generateOperationId('rollback');
        const rollbackChanges: ChangeRecord[] = [];
        const revertedDocs: string[] = [];
        const conflictDetails: string[] = [];

        // Start rollback log as pending
        await this.insertLog({
            operationId: rollbackOpId,
            type: 'rollback',
            actorId,
            actorLabel,
            status: 'pending',
            summary: `Rollback of operation ${operationId}`,
            changes: [],
            meta: { rollbackOf: operationId },
            rollbackOf: operationId,
        });

        try {
            // Apply 'before' states in reverse order
            for (const change of [...log.changes].reverse()) {
                if (!change.before) {
                    // If no 'before' state, we might need to delete
                    console.warn(`[Rollback] No 'before' state for ${change.docPath}, skipping`);
                    continue;
                }

                try {
                    const success = await applyBefore(change.collection, change.docId, change.before);

                    if (success) {
                        revertedDocs.push(change.docPath);
                        rollbackChanges.push({
                            ...change,
                            // Swap before/after for rollback log
                            before: change.after,
                            after: change.before,
                        });
                    } else {
                        conflictDetails.push(`Failed to revert ${change.docPath}`);
                    }
                } catch (err: any) {
                    conflictDetails.push(`Error reverting ${change.docPath}: ${err.message}`);
                }
            }

            if (conflictDetails.length > 0) {
                // Partial failure
                await this.updateLogStatus(rollbackOpId, 'failed', {
                    conflictDetails,
                    revertedDocs,
                });

                return {
                    success: false,
                    message: 'Rollback partially failed',
                    rollbackOperationId: rollbackOpId,
                    conflictDetails,
                    revertedDocs,
                };
            }

            // Update rollback log with changes and mark as committed
            await this.getClient()
                .from('reassignment_logs')
                .update({
                    status: 'committed',
                    changes: rollbackChanges,
                    meta: {
                        rollbackOf: operationId,
                        revertedDocs,
                        completedAt: new Date().toISOString(),
                    },
                })
                .eq('operation_id', rollbackOpId);

            // Mark original operation as rolled_back
            await this.updateLogStatus(operationId, 'rolled_back', {
                rolledBackBy: rollbackOpId,
                rolledBackAt: new Date().toISOString(),
            });

            return {
                success: true,
                message: 'Rollback completed successfully',
                rollbackOperationId: rollbackOpId,
                revertedDocs,
            };

        } catch (err: any) {
            await this.updateLogStatus(rollbackOpId, 'failed', {
                error: err.message
            });

            return {
                success: false,
                message: `Rollback failed: ${err.message}`,
                rollbackOperationId: rollbackOpId,
            };
        }
    }

    // ============================================
    // CLEANUP OPERATIONS
    // ============================================

    /**
     * Cleanup old logs, keeping only the last N per type
     */
    async cleanupOldLogs(keepPerType: number = 3): Promise<number> {
        if (!this.isReady()) return 0;

        try {
            // Use the SQL function we created
            const { data, error } = await this.getClient()
                .rpc('cleanup_old_reassignment_logs');

            if (error) {
                console.error('[ReassignmentLogsService] Cleanup error:', error);

                // Fallback: manual cleanup
                const types: ReassignmentType[] = [
                    'driver_reassignment',
                    'student_reassignment',
                    'route_reassignment',
                    'rollback'
                ];

                let totalDeleted = 0;

                for (const type of types) {
                    const { data: logs } = await this.getClient()
                        .from('reassignment_logs')
                        .select('id')
                        .eq('type', type)
                        .order('created_at', { ascending: false });

                    if (logs && logs.length > keepPerType) {
                        const toDelete = logs.slice(keepPerType).map(l => l.id);

                        const { error: deleteError } = await this.getClient()
                            .from('reassignment_logs')
                            .delete()
                            .in('id', toDelete);

                        if (!deleteError) {
                            totalDeleted += toDelete.length;
                        }
                    }
                }

                return totalDeleted;
            }

            return data || 0;
        } catch (err) {
            console.error('[ReassignmentLogsService] Cleanup exception:', err);
            return 0;
        }
    }
}

// Export singleton instance
export const reassignmentLogsService = new ReassignmentLogsService();

// Export class for custom instantiation
export { ReassignmentLogsService };
