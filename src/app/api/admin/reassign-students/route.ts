import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { ReassignStudentsSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { createAuditEvent, type AuditActorRole } from '@/domains/audit';
import { getShiftDeltas, normalizeShift } from '@/lib/utils/shift-utils';
import crypto from 'crypto';

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
type FirestoreSnapshot = FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;

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

        const busRefs = Array.from(busIdsToLoad).map(id => adminDb.collection('buses').doc(id));
        const studentRefs = assignments.map((assignment) => adminDb.collection('students').doc(assignment.studentId));
        
        // Fetch actor info, students, and all buses in parallel
        const actorInfoPromise = (async () => {
            let label = auth.name || 'System';
            if (currentUserRole === 'admin') {
                const adminDoc = await adminDb.collection('admins').doc(currentUserUid).get();
                if (adminDoc.exists) {
                    const data = adminDoc.data();
                    label = `${data?.fullName || data?.name || auth.name || 'Admin'} (Admin)`;
                }
            } else if (currentUserRole === 'moderator') {
                const modDoc = await adminDb.collection('moderators').doc(currentUserUid).get();
                if (modDoc.exists) {
                    const modData = modDoc.data();
                    label = `${modData?.fullName || modData?.name || auth.name || 'Moderator'} (${modData?.employeeId || 'Moderator'})`;
                }
            }
            return label;
        })();

        const actorLabel = await actorInfoPromise;
        const busSnapshots = new Map<string, FirestoreSnapshot>();
        const busLoadChanges = new Map<string, BusLoadDeltas>();
        const effectiveAssignments: ReassignmentAssignment[] = [];
        // Generated up-front so the in-transaction Firestore audit and the Supabase
        // rollback snapshot share ONE correlation id.
        const operationId = `student_reassignment_${Date.now()}_${crypto.randomUUID()}`;

        try {
            await adminDb.runTransaction(async (transaction) => {
                const busSnapsList = await Promise.all(busRefs.map((ref) => transaction.get(ref)));
                const studentSnapsList = await Promise.all(studentRefs.map((ref) => transaction.get(ref)));

                busSnapshots.clear();
                busSnapsList.forEach((snap) => {
                    if (snap.exists) busSnapshots.set(snap.id, snap);
                });

                const studentSnapshots = new Map<string, FirestoreSnapshot>();
                studentSnapsList.forEach((snap) => {
                    if (snap.exists) studentSnapshots.set(snap.id, snap);
                });

                busLoadChanges.clear();
                effectiveAssignments.length = 0;

                for (const assignment of assignments) {
                    const { studentId, fromBusId, toBusId, shift: targetShift } = assignment;
                    const studentRef = adminDb.collection('students').doc(studentId);
                    const studentSnap = studentSnapshots.get(studentId);

                    if (!studentSnap?.exists) {
                        throw new ReassignmentValidationError(`Student ${studentId} not found`, 404);
                    }

                    const studentData = studentSnap.data()!;
                    const currentBusId = studentData.busId || '';

                    if (currentBusId === toBusId && studentData.shift === targetShift) {
                        // Already on the target bus with the correct shift — pure no-op
                        continue;
                    }

                    if (currentBusId && currentBusId !== fromBusId) {
                        throw new ReassignmentValidationError(
                            `Stale reassignment data for ${assignment.studentName || studentId}. Refresh and try again.`,
                            409
                        );
                    }

                    const targetBusSnap = busSnapshots.get(toBusId);
                    if (!targetBusSnap?.exists) {
                        throw new ReassignmentValidationError(`Target bus ${toBusId} not found`, 404);
                    }
                    const targetBusData = targetBusSnap.data()!;

                    // ── Original Shift: what is currently stored on the student in Firestore.
                    // MUST be used for source-bus decrement.
                    // Normalise to canonical form; default to 'Morning' if missing.
                    const originalShift = normalizeShift(studentData.shift || 'Morning') as 'Morning' | 'Evening';

                    // ── Target Shift: what the moderator has selected for the student.
                    // MUST be persisted on the student document and used for dest-bus increment.
                    const studentUpdateData: Record<string, unknown> = {
                        busId: toBusId,
                        shift: targetShift,          // ← persist the new shift
                        routeId: targetBusData.route?.routeId || targetBusData.routeId || '',
                        updatedAt: FieldValue.serverTimestamp(),
                    };
                    if (assignment.stopId) studentUpdateData.stopId = assignment.stopId;
                    if (assignment.stopName) studentUpdateData.stopName = assignment.stopName;
                    transaction.update(studentRef, studentUpdateData);

                    // Source bus: DECREMENT using ORIGINAL shift
                    // Only decrement if the student was actually on the source bus
                    // (skip if student has no current bus assignment)
                    if (currentBusId && currentBusId === fromBusId) {
                        if (!busLoadChanges.has(fromBusId)) busLoadChanges.set(fromBusId, { morningDelta: 0, eveningDelta: 0 });
                        const sourceChanges = busLoadChanges.get(fromBusId)!;
                        const srcDeltas = getShiftDeltas(originalShift);
                        if (srcDeltas.affectsMorning) sourceChanges.morningDelta--;
                        if (srcDeltas.affectsEvening) sourceChanges.eveningDelta--;
                    }

                    // Destination bus: INCREMENT using TARGET shift
                    if (!busLoadChanges.has(toBusId)) busLoadChanges.set(toBusId, { morningDelta: 0, eveningDelta: 0 });
                    const targetChanges = busLoadChanges.get(toBusId)!;
                    const dstDeltas = getShiftDeltas(targetShift);
                    if (dstDeltas.affectsMorning) targetChanges.morningDelta++;
                    if (dstDeltas.affectsEvening) targetChanges.eveningDelta++;

                    effectiveAssignments.push({ ...assignment, _originalShift: originalShift } as any);
                }

                for (const [busId, deltas] of busLoadChanges.entries()) {
                    const busRef = adminDb.collection('buses').doc(busId);
                    const busSnap = busSnapshots.get(busId);
                    if (!busSnap?.exists) {
                        throw new ReassignmentValidationError(`Bus ${busId} not found`, 404);
                    }

                    const busData = busSnap.data()!;
                    const currentLoad = busData.load || { morningCount: 0, eveningCount: 0 };
                    const newMorning = Math.max(0, (currentLoad.morningCount || 0) + deltas.morningDelta);
                    const newEvening = Math.max(0, (currentLoad.eveningCount || 0) + deltas.eveningDelta);
                    const capacity = Number(busData.capacity || busData.capacitySeats || 0);

                    // ── CANONICAL CAPACITY MODEL (per-shift, independent trips) ──
                    // Morning and Evening are separate physical trips sharing the same
                    // seat count. Each shift is gated INDEPENDENTLY against capacity.
                    // NEVER gate on morningCount + eveningCount > capacity.
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

                    // currentMembers is a DERIVED statistic: always morningCount + eveningCount.
                    transaction.update(busRef, {
                        'load.morningCount': newMorning,
                        'load.eveningCount': newEvening,
                        currentMembers: newMorning + newEvening,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }

            });
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
                const bSnap = busSnapshots.get(bId);
                if (bSnap?.exists) {
                    const bData = bSnap.data()!;
                    const bNum = bId.replace(/[^0-9]/g, '') || '?';
                    busLabels.set(bId, `Bus-${bNum} (${bData.busNumber || bData.registrationNumber || 'N/A'})`);
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
                const busSnap = busSnapshots.get(busId);
                if (busSnap?.exists) {
                    const busData = busSnap.data()!;
                    const currentLoad = busData.load || { morningCount: 0, eveningCount: 0 };
                    const beforeMorning = currentLoad.morningCount || 0;
                    const beforeEvening = currentLoad.eveningCount || 0;
                    const afterMorning = Math.max(0, beforeMorning + deltas.morningDelta);
                    const afterEvening = Math.max(0, beforeEvening + deltas.eveningDelta);
                    changes.push({
                        docPath: `buses/${busId}`,
                        collection: 'buses',
                        docId: busId,
                        before: { 'load.morningCount': beforeMorning, 'load.eveningCount': beforeEvening, currentMembers: beforeMorning + beforeEvening },
                        after: { 'load.morningCount': afterMorning, 'load.eveningCount': afterEvening, currentMembers: afterMorning + afterEvening },
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
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: ReassignStudentsSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
