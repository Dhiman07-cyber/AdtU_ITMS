import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { decrementBusCapacity } from '@/domains/fleet';
import { withSecurity } from '@/lib/security/api-security';
import { DeleteStudentSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { createAuditEvent, resolveAuditActor } from '@/domains/audit';
import { getStudentById, deleteStudent, deleteUser } from '@/domains/identity';

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { uid } = body as any;

        // Get the student data from PostgreSQL (canonical source of truth)
        const studentData = await getStudentById(uid);

        if (!studentData) {
            return NextResponse.json({ success: false, error: 'Student not found' }, { status: 404 });
        }

        const busId = studentData.busId || studentData.currentBusId || studentData.assignedBusId || null;
        // DEDUP GUARD: skip the bus decrement if the seat was already released at soft block.
        const shouldDecrement = !!busId && !wasSeatReleased(studentData);

        // Resolve the acting admin BEFORE opening the transaction (it performs reads).
        const actor = await resolveAuditActor(auth.uid);

        // ── Step 1: PG delete — delete student and user from PostgreSQL (canonical source of truth)
        //    If this succeeds but the PG decrement fails, a retry sees the student
        //    already deleted (404) and skips the PG touch — preventing double-decrement.
        await deleteStudent(uid);
        await deleteUser(uid);

        // ── Step 2: PG capacity decrement — source of truth for bus capacity.
        //    If this fails, sync-bus-counts corrects the over-counted capacity
        //    by recounting from student docs (the student is already deleted from
        //    PostgreSQL, so the recount won't include this student).
        if (shouldDecrement && busId) {
            const shift = studentData.shift || 'Morning';
            let pgDecrementOk = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await decrementBusCapacity(busId, shift);
                    pgDecrementOk = true;
                    break;
                } catch (pgErr) {
                    console.error(`PG decrement attempt ${attempt}/3 failed for bus ${busId}:`, pgErr);
                    if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
                }
            }
            if (!pgDecrementOk) {
                console.error(`CRITICAL: PG decrement failed after 3 attempts for bus ${busId}. Student ${uid} deleted but capacity over-counted — run sync-bus-counts to correct.`);
            }
        }

        void createAuditEvent({
            category: 'system',
            action: 'student_deleted',
            summary: `Student deleted: ${studentData.fullName || studentData.name || ''}`,
            severity: 'high',
            actor_id: auth.uid,
            actor_name: actor.name,
            actor_role: actor.role as any,
            target_type: 'student',
            target_id: uid,
            target_name: studentData.fullName || studentData.name || '',
            metadata: {
                reason: 'admin_manual_delete',
                before: {
                    enrollmentId: studentData.enrollmentId || null,
                    busId: busId || null,
                    shift: studentData.shift || null,
                    status: studentData.status || null,
                    validUntil: studentData.validUntil || null,
                    sessionEndYear: studentData.sessionEndYear || null,
                    seatReleasedAt: studentData.seatReleasedAt || null,
                },
                after: { deleted: true },
                details: { seatDecremented: shouldDecrement, busId: busId || null },
            },
        });

        // Post-commit best-effort cleanup of NON-ownership data (external systems and
        // bulk sub-collections). These never affect the committed deletion/capacity
        // invariant; failures are isolated and surfaced via Promise.allSettled.
        const cleanupTasks = [
            (async () => {
                if (studentData.profilePhotoUrl) {
                    const publicId = extractPublicId(studentData.profilePhotoUrl);
                    if (publicId) await deleteAsset(publicId);
                }
            })(),
            (async () => {
                if (adminDb) {
                    const snapshot = await adminDb.collection('fcm_tokens').where('userUid', '==', uid).limit(400).get();
                    const batch = adminDb.batch();
                    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
                    await batch.commit();
                }
            })(),
            (async () => {
                if (adminDb) {
                    const snapshot = await adminDb.collection('waiting_flags').where('student_uid', '==', uid).limit(400).get();
                    const batch = adminDb.batch();
                    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
                    await batch.commit();
                }
            })(),
            (async () => {
                try {
                    await adminAuth.deleteUser(uid);
                } catch (authError: any) {
                    if (authError.code !== 'auth/user-not-found') console.error('Auth deletion error:', authError);
                }
            })(),
        ];

        await Promise.allSettled(cleanupTasks);

        return NextResponse.json({ success: true, message: 'Student deleted successfully' });
    },
    {
        requiredRoles: ['admin'],
        schema: DeleteStudentSchema,
        rateLimit: RateLimits.ADMIN,
        allowBodyToken: true
    }
);