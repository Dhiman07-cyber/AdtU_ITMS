import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { ReassignStudentsSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditEvent, type AuditActorRole } from '@/domains/audit';
import { normalizeShift, getShiftDeltas } from '@/lib/utils/shift-utils';
import { decrementBusCapacity, incrementBusCapacity, getAllBuses, getBusById } from '@/domains/fleet';
import crypto from 'crypto';
import { getStudentById, updateStudent } from '@/domains/identity';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';

type ReassignmentAssignment = {
    studentId: string;
    studentName: string;
    fromBusId: string;
    toBusId: string;
    toBusNumber: string;
    shift: 'Morning' | 'Evening' | 'Both';
    stopId?: string;
    stopName?: string;
};

type ReassignStudentsBody = {
    assignments: ReassignmentAssignment[];
    sourceBusId: string;
};

type BusLoadDeltas = { morningDelta: number; eveningDelta: number };

class ReassignmentValidationError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

export const POST = withSecurity<ReassignStudentsBody>(
    async (_request, { auth, body }) => {
        const currentUserUid = auth.uid;
        const currentUserRole = auth.role;
        const { assignments, sourceBusId } = body;

        const permissionDenied = await requireModeratorPermission(auth, 'students', 'canReassign');
        if (permissionDenied) return permissionDenied;

        if (!assignments || assignments.length === 0) {
            return NextResponse.json({ success: false, error: 'No assignments provided' }, { status: 400 });
        }

        // 1. Parallel Initial Data Fetching
        const busIdsToLoad = new Set<string>();
        for (const assignment of assignments) {
            busIdsToLoad.add(assignment.toBusId);
            busIdsToLoad.add(assignment.fromBusId);
        }
        if (sourceBusId) busIdsToLoad.add(sourceBusId);
        
        // Fetch actor info, students, and buses (PG) in parallel
        const actorInfoPromise = (async () => {
            let label = auth.name || 'System';
            if (currentUserRole === 'admin' || currentUserRole === 'moderator') {
                const info = await getUpdaterInfo(adminDb, currentUserUid);
                label = currentUserRole === 'admin'
                    ? `${info.name} (Admin)`
                    : `${info.name} (${info.roleOrEmployeeId})`;
            }
            return label;
        })();

        const actorLabel = await actorInfoPromise;
        const busPgData = new Map<string, any>();
        const busLoadChanges = new Map<string, BusLoadDeltas>();
        const effectiveAssignments: ReassignmentAssignment[] = [];
        const operationId = `student_reassignment_${Date.now()}_${crypto.randomUUID()}`;

        try {
            // ── Phase 1: Read student docs from PostgreSQL + bus docs from PG ──
            const pgStudentsList = await Promise.all(assignments.map((a) => getStudentById(a.studentId)));
            const pgBuses = await getAllBuses();

            const busIdSet = new Set(busIdsToLoad);
            for (const bus of pgBuses) {
                const busId = bus.busId || bus.id || '';
                if (busIdSet.has(busId)) {
                    busPgData.set(busId, bus);
                }
            }

            const studentRecords = new Map<string, any>();
            pgStudentsList.forEach((student) => {
                if (student && student.uid) studentRecords.set(student.uid, student);
            });

            busLoadChanges.clear();
            effectiveAssignments.length = 0;

            // ── Phase 2: Validate + compute deltas ──
            for (const assignment of assignments) {
                const { studentId, fromBusId, toBusId, shift: targetShift } = assignment;
                const studentData = studentRecords.get(studentId);

                if (!studentData) {
                    throw new ReassignmentValidationError(`Student ${studentId} not found`, 404);
                }

                const currentBusId = studentData.busId || studentData.assignedBusId || '';

                if (currentBusId === toBusId && studentData.shift === targetShift) {
                    continue;
                }

                if (currentBusId && currentBusId !== fromBusId) {
                    throw new ReassignmentValidationError(
                        `Stale reassignment data for ${assignment.studentName || studentId}. Refresh and try again.`,
                        409
                    );
                }

                const targetBusData = busPgData.get(toBusId);
                if (!targetBusData) {
                    throw new ReassignmentValidationError(`Target bus ${toBusId} not found`, 404);
                }

                const originalShift = normalizeShift(studentData.shift || 'Morning');

                const studentUpdateData: Record<string, unknown> = {
                    busId: toBusId,
                    assignedBusId: toBusId,
                    shift: targetShift,
                    routeId: (targetBusData as any).routeId || '',
                    assignedRouteId: (targetBusData as any).routeId || '',
                    updatedAt: new Date().toISOString(),
                };
                if (assignment.stopId) studentUpdateData.stopId = assignment.stopId;
                if (assignment.stopName) studentUpdateData.stopName = assignment.stopName;

                if (currentBusId && currentBusId === fromBusId) {
                    if (!busLoadChanges.has(fromBusId)) busLoadChanges.set(fromBusId, { morningDelta: 0, eveningDelta: 0 });
                    const sourceChanges = busLoadChanges.get(fromBusId)!;
                    const srcDeltas = getShiftDeltas(originalShift);
                    if (srcDeltas.affectsMorning) sourceChanges.morningDelta--;
                    if (srcDeltas.affectsEvening) sourceChanges.eveningDelta--;
                }

                if (!busLoadChanges.has(toBusId)) busLoadChanges.set(toBusId, { morningDelta: 0, eveningDelta: 0 });
                const targetChanges = busLoadChanges.get(toBusId)!;
                const dstDeltas = getShiftDeltas(targetShift);
                if (dstDeltas.affectsMorning) targetChanges.morningDelta++;
                if (dstDeltas.affectsEvening) targetChanges.eveningDelta++;

                effectiveAssignments.push({ ...assignment, _originalShift: originalShift, _studentUpdateData: studentUpdateData } as any);
            }

            // ── Phase 2b: Validate capacity per bus using accumulated deltas (PG bus data) ──
            for (const [busId, deltas] of busLoadChanges.entries()) {
                const busData = busPgData.get(busId);
                if (!busData) {
                    throw new ReassignmentValidationError(`Bus ${busId} not found`, 404);
                }
                const newMorning = Math.max(0, (busData.morningLoad || 0) + deltas.morningDelta);
                const newEvening = Math.max(0, (busData.eveningLoad || 0) + deltas.eveningDelta);
                const capacity = busData.capacity || 0;

                if (capacity > 0) {
                    if (deltas.morningDelta > 0 && newMorning > capacity) {
                        throw new ReassignmentValidationError(
                            `Bus ${busData.busNumber || busId} Morning trip would exceed capacity (${newMorning}/${capacity})`,
                            409
                        );
                    }
                    if (deltas.eveningDelta > 0 && newEvening > capacity) {
                        throw new ReassignmentValidationError(
                            `Bus ${busData.busNumber || busId} Evening trip would exceed capacity (${newEvening}/${capacity})`,
                            409
                        );
                    }
                }
            }

            // ── Phase 3: PG capacity mutations (source of truth) ──
            const pgCompensations: Array<() => Promise<any>> = [];

            for (const a of effectiveAssignments) {
                const anyA = a as any;
                const originalShift = anyA._originalShift;
                const currentBusId = (studentRecords.get(a.studentId) || {}).busId || (studentRecords.get(a.studentId) || {}).assignedBusId || '';

                if (currentBusId && currentBusId === a.fromBusId) {
                    await decrementBusCapacity(a.fromBusId, originalShift);
                    pgCompensations.push(() => incrementBusCapacity(a.fromBusId, originalShift));
                }

                await incrementBusCapacity(a.toBusId, a.shift);
                pgCompensations.push(() => decrementBusCapacity(a.toBusId, a.shift));
            }

            // ── Phase 4: PostgreSQL updates ──
            try {
                for (const a of effectiveAssignments) {
                    const anyA = a as any;
                    await updateStudent(a.studentId, anyA._studentUpdateData);
                }
            } catch (updErr) {
                // Compensate all PG capacity mutations
                for (const comp of pgCompensations.reverse()) {
                    await comp().catch(() => {});
                }
                throw updErr;
            }

        } catch (error) {
            if (error instanceof ReassignmentValidationError) {
                return NextResponse.json(
                    { success: false, error: error.message },
                    { status: error.status }
                );
            }
            throw error;
        }

        if (effectiveAssignments.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No reassignment changes were needed',
                movedCount: 0,
                assignments: [],
            });
        }

        // Supabase Audit Logging (detailed before/after snapshot used for ROLLBACK)
        try {
            const targetBuses = [...new Set(effectiveAssignments.map((a) => a.toBusId))];
            const uniqueBusIds = [...new Set([sourceBusId, ...targetBuses])];
            const busLabels = new Map<string, string>();

            for (const bId of uniqueBusIds) {
                const bData = busPgData.get(bId);
                if (bData) {
                    const bNum = bId.replace(/[^0-9]/g, '') || '?';
                    busLabels.set(bId, `Bus-${bNum} (${bData.busNumber || 'N/A'})`);
                } else busLabels.set(bId, bId);
            }

            const sourceLabel = busLabels.get(sourceBusId) || sourceBusId;
            const destLabels = (targetBuses as string[]).map(id => busLabels.get(id) || id).join(', ');

            const changes: Array<Record<string, unknown>> = [];
            for (const a of effectiveAssignments) {
                const anyA = a as any;
                changes.push({
                    docPath: `students/${a.studentId}`,
                    collection: 'students',
                    docId: a.studentId,
                    // before: original state (oldShift = what was in Firestore before this op)
                    before: { busId: a.fromBusId, studentName: a.studentName, shift: anyA._originalShift || a.shift },
                    // after: new state (shift = targetShift persisted in transaction)
                    after: { busId: a.toBusId, studentName: a.studentName, shift: a.shift },
                });
            }

            for (const [busId, deltas] of busLoadChanges.entries()) {
                const busData = busPgData.get(busId);
                if (busData) {
                    const beforeMorning = busData.morningLoad || 0;
                    const beforeEvening = busData.eveningLoad || 0;
                    const afterMorning = Math.max(0, beforeMorning + deltas.morningDelta);
                    const afterEvening = Math.max(0, beforeEvening + deltas.eveningDelta);
                    changes.push({
                        docPath: `buses/${busId}`,
                        collection: 'buses',
                        docId: busId,
                        before: { morningLoad: beforeMorning, eveningLoad: beforeEvening, currentMembers: beforeMorning + beforeEvening },
                        after: { morningLoad: afterMorning, eveningLoad: afterEvening, currentMembers: afterMorning + afterEvening },
                    });
                }
            }

            const supabase = getSupabaseServer();

            // Retry the Supabase audit write with exponential backoff — this is the
            // rollback snapshot. If it fails, admins can only reverse manually.
            let auditWritten = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await supabase.from('reassignment_logs').insert([{
                        operation_id: operationId,
                        type: 'student_reassignment',
                        actor_id: currentUserUid,
                        actor_label: actorLabel,
                        status: 'committed',
                        summary: `Reassigned ${effectiveAssignments.length} student(s) from ${sourceLabel} to ${destLabels}`,
                        changes: changes,
                        meta: { studentCount: effectiveAssignments.length, sourceBusId, targetBuses, busLoadChanges: Object.fromEntries(busLoadChanges) },
                    }]);
                    auditWritten = true;
                    break;
                } catch (retryErr) {
                    if (attempt < 3) {
                        await new Promise(r => setTimeout(r, 500 * attempt));
                    }
                }
            }

            if (!auditWritten) {
                throw new Error('Supabase audit write failed after 3 attempts');
            }
        } catch (auditError) {
            // The detailed Supabase snapshot is what ROLLBACK depends on. If it fails,
            // the durable in-tx Firestore audit still exists, but rollback for this
            // operationId would be impossible — so make the gap DETECTABLE (Tier B)
            // rather than swallowing it in a console warning.
            console.error('Failed to create Supabase reassignment rollback snapshot:', auditError);
            await createAuditEvent({
                action: 'reassignment_rollback_snapshot_failed',
                actor_id: currentUserUid,
                actor_name: actorLabel,
                actor_role: (currentUserRole as AuditActorRole) || 'system',
                target_id: sourceBusId || '',
                target_type: 'bus',
                target_name: '',
                category: 'reassignments',
                summary: 'Reassignment rollback snapshot failed',
                severity: 'medium',
                metadata: {
                    operationId,
                    movedCount: effectiveAssignments.length,
                    error: auditError instanceof Error ? auditError.message : String(auditError),
                    impact: 'reassignment committed but rollback snapshot missing — manual reversal only',
                    correlationId: operationId,
                },
            });
        }

        void createAuditEvent({
            action: 'students_reassigned',
            actor_id: currentUserUid,
            actor_name: actorLabel,
            actor_role: (currentUserRole as AuditActorRole) || 'system',
            target_id: sourceBusId || effectiveAssignments[0].fromBusId,
            target_type: 'bus',
            target_name: sourceBusId || '',
            category: 'reassignments',
            summary: `Reassigned ${effectiveAssignments.length} student(s) from ${sourceBusId || ''}`,
            severity: 'medium',
            metadata: {
                before: { sourceBusId },
                after: { movedCount: effectiveAssignments.length },
                operationId,
                sourceBusId,
                assignments: effectiveAssignments.map((a) => ({
                    studentId: a.studentId,
                    from: a.fromBusId,
                    to: a.toBusId,
                    shift: a.shift,
                })),
                correlationId: operationId,
            },
        });

        return NextResponse.json({
            success: true,
            message: `Successfully reassigned ${effectiveAssignments.length} student(s)`,
            movedCount: effectiveAssignments.length,
            assignments: effectiveAssignments,
            operationId: operationId,
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: ReassignStudentsSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
