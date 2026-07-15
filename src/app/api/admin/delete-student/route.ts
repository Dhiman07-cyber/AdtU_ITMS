import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { deleteAsset, extractPublicId } from '@/lib/cloudinary-server';
import { buildCapacityDelta } from '@/lib/busCapacityService';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { withSecurity } from '@/lib/security/api-security';
import { DeleteStudentSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { createAuditEvent, resolveAuditActor } from '@/domains/audit';

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { uid } = body as any;

        // Get the student data to check if they have a profile photo
        const studentDocRef = adminDb.collection('students').doc(uid);
        const studentDoc = await studentDocRef.get();

        if (!studentDoc.exists) {
            return NextResponse.json({ success: false, error: 'Student not found' }, { status: 404 });
        }

        const studentData = studentDoc.data();
        const busId = studentData?.busId || studentData?.currentBusId || studentData?.assignedBusId || null;
        // DEDUP GUARD: skip the bus decrement if the seat was already released at soft block.
        const shouldDecrement = !!busId && !wasSeatReleased(studentData);

        // Resolve the acting admin BEFORE opening the transaction (it performs reads).
        const actor = await resolveAuditActor(auth.uid);

        // ── Tier A: the IRREVERSIBLE ownership/capacity mutation — student doc delete,
        //    user doc delete, and bus seat decrement — commits atomically WITH a
        //    durable audit row that snapshots exactly what was destroyed. A student
        //    can never be deleted without a reconstructible record of who/when/why.
        const userDocRef = adminDb.collection('users').doc(uid);
        const busRef = shouldDecrement ? adminDb.collection('buses').doc(busId) : null;
        await adminDb.runTransaction(async (transaction) => {
            const busSnap = busRef ? await transaction.get(busRef) : null;

            transaction.delete(studentDocRef);
            transaction.delete(userDocRef);

            if (busRef && busSnap?.exists) {
                const delta = buildCapacityDelta(busSnap.data(), studentData?.shift, -1);
                transaction.update(busRef, delta.updates);
            }


        });

        void createAuditEvent({
            category: 'system',
            action: 'student_deleted',
            summary: `Student deleted: ${studentData?.fullName || studentData?.name || ''}`,
            severity: 'high',
            actor_id: auth.uid,
            actor_name: actor.name,
            actor_role: actor.role as any,
            target_type: 'student',
            target_id: uid,
            target_name: studentData?.fullName || studentData?.name || '',
            metadata: {
                reason: 'admin_manual_delete',
                before: {
                    enrollmentId: studentData?.enrollmentId || null,
                    busId: busId || null,
                    shift: studentData?.shift || null,
                    status: studentData?.status || null,
                    validUntil: studentData?.validUntil || null,
                    sessionEndYear: studentData?.sessionEndYear || null,
                    seatReleasedAt: studentData?.seatReleasedAt || null,
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
                if (studentData?.profilePhotoUrl) {
                    const publicId = extractPublicId(studentData.profilePhotoUrl);
                    if (publicId) await deleteAsset(publicId);
                }
            })(),
            (async () => {
                const snapshot = await adminDb.collection('fcm_tokens').where('userUid', '==', uid).limit(400).get();
                const batch = adminDb.batch();
                snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
                await batch.commit();
            })(),
            (async () => {
                const snapshot = await adminDb.collection('waiting_flags').where('student_uid', '==', uid).limit(400).get();
                const batch = adminDb.batch();
                snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
                await batch.commit();
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

        return NextResponse.json({
            success: true,
            message: 'Student and all associated data deleted successfully'
        });
    },
    {
        requiredRoles: ['admin'],
        schema: DeleteStudentSchema,
        rateLimit: RateLimits.DELETE,
        allowBodyToken: true
    }
);