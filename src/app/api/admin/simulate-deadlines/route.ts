import { NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { v2 as cloudinary } from 'cloudinary';
import { decrementBusCapacity } from '@/lib/busCapacityService';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { isSeatReleaseAtSoftBlockEnabled, wasSeatReleased } from '@/lib/config/capacity-flags';
import { withSecurity } from '@/lib/security/api-security';
import { SimulateDeadlinesSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import { createAuditEvent } from '@/domains/audit';

if (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
        cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
}

interface StudentStatus {
    uid: string; name: string; enrollmentId: string; email: string;
    validUntil: string; sessionEndYear: number; status: string;
    softBlockDate: string; hardDeleteDate: string;
    shouldSoftBlock: boolean; shouldHardDelete: boolean;
    daysPastSoftBlock: number; daysPastHardDelete: number;
}

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { simulatedDate, dryRun = true, execute = false, manualMode = false, selectedForSoftBlock = [], selectedForHardDelete = [], customDeadlines = null, syncSessionYear = true } = body as any;

        const simDate = new Date(simulatedDate);
        const simYear = simDate.getFullYear();
        let config: any = await getDeadlineConfig();

        if (customDeadlines) {
            if (customDeadlines.softBlock) config.softBlock = { ...config.softBlock, ...customDeadlines.softBlock };
            if (customDeadlines.hardDelete) config.hardDelete = { ...config.hardDelete, ...customDeadlines.hardDelete };
            if (customDeadlines.renewalDeadline) config.renewalDeadline = { ...config.renewalDeadline, ...customDeadlines.renewalDeadline };
        }

        const studentsSnapshot = await adminDb.collection('students').get();
        const allStudents: StudentStatus[] = [];
        const eligibleForSoftBlock: StudentStatus[] = [];
        const eligibleForHardDelete: StudentStatus[] = [];
        const alreadyBlocked: StudentStatus[] = [];

        studentsSnapshot.docs.forEach((doc: any) => {
            const data = doc.data();
            let validUntil: Date | null = null;
            if (data.validUntil) {
                validUntil = typeof data.validUntil === 'string' ? new Date(data.validUntil) : (data.validUntil.toDate ? data.validUntil.toDate() : null);
            }

            const sessionEndYear = syncSessionYear ? simYear : (validUntil ? validUntil.getFullYear() : null);
            if (!sessionEndYear) {
                allStudents.push({ uid: doc.id, name: data.name || data.fullName || 'Unknown', enrollmentId: data.enrollmentId || data.id || 'N/A', email: data.email || 'N/A', validUntil: 'Not Set', sessionEndYear: 0, status: data.status || 'unknown', softBlockDate: 'N/A', hardDeleteDate: 'N/A', shouldSoftBlock: false, shouldHardDelete: false, daysPastSoftBlock: 0, daysPastHardDelete: 0 });
                return;
            }

            const startMonth = config.academicSessionStart?.month ?? 6;
            const startDay = config.academicSessionStart?.day ?? 1;
            const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);

            const studentSoftBlockDate = data.softBlock ? new Date(data.softBlock) : lifecycle.softBlock;
            const studentHardDeleteDate = data.hardBlock ? new Date(data.hardBlock) : lifecycle.hardDelete;

            const isPastSoftBlock = simDate >= studentSoftBlockDate;
            const isPastHardDelete = simDate >= studentHardDeleteDate;

            const studentStatus: StudentStatus = {
                uid: doc.id, name: data.name || data.fullName || 'Unknown', enrollmentId: data.enrollmentId || data.id || 'N/A', email: data.email || 'N/A',
                validUntil: validUntil?.toISOString() || 'N/A', sessionEndYear, status: data.status || 'active',
                softBlockDate: studentSoftBlockDate.toISOString(), hardDeleteDate: studentHardDeleteDate.toISOString(),
                shouldSoftBlock: isPastSoftBlock && !isPastHardDelete, shouldHardDelete: isPastHardDelete,
                daysPastSoftBlock: isPastSoftBlock ? Math.floor((simDate.getTime() - studentSoftBlockDate.getTime()) / 86400000) : 0,
                daysPastHardDelete: isPastHardDelete ? Math.floor((simDate.getTime() - studentHardDeleteDate.getTime()) / 86400000) : 0
            };

            allStudents.push(studentStatus);
            if (!manualMode) {
                if (data.status === 'soft_blocked' || data.status === 'pending_deletion') alreadyBlocked.push(studentStatus);
                else if (isPastHardDelete) eligibleForHardDelete.push(studentStatus);
                else if (isPastSoftBlock) eligibleForSoftBlock.push(studentStatus);
            }
        });

        if (manualMode) {
            selectedForSoftBlock.forEach((uid: string) => { const s = allStudents.find(st => st.uid === uid); if (s && !eligibleForSoftBlock.find(st => st.uid === uid)) eligibleForSoftBlock.push(s); });
            selectedForHardDelete.forEach((uid: string) => { const s = allStudents.find(st => st.uid === uid); if (s && !eligibleForHardDelete.find(st => st.uid === uid)) eligibleForHardDelete.push(s); });
        }

        if (execute && !dryRun) {
            const executionResults = { softBlocked: 0, hardDeleted: 0, errors: [] as string[] };
            const releaseSeatAtSoftBlock = isSeatReleaseAtSoftBlockEnabled();
            for (const student of eligibleForSoftBlock) {
                try {
                    // Re-read the live doc so we (a) honour the idempotency guard and
                    // (b) have busId/shift for the seat release. The summary objects do
                    // not carry transport fields.
                    const sbDocRef = adminDb.collection('students').doc(student.uid);
                    const sbDoc = await sbDocRef.get();
                    if (!sbDoc.exists) { continue; }
                    const sbData = sbDoc.data() || {};
                    // Idempotency: only release/transition a student who is still active.
                    if (sbData.status !== 'active') { continue; }

                    const nowIso = new Date().toISOString();
                    await sbDocRef.update({
                        status: 'soft_blocked',
                        softBlockedAt: nowIso,
                        ...(releaseSeatAtSoftBlock ? { seatReleasedAt: nowIso } : {})
                    });
                    executionResults.softBlocked++;

                    if (releaseSeatAtSoftBlock) {
                        const sbBusId = sbData.busId || sbData.currentBusId || sbData.assignedBusId;
                        if (sbBusId) {
                            try {
                                await decrementBusCapacity(sbBusId, student.uid, sbData.shift);
                                void createAuditEvent({
                                    action: 'seat_released',
                                    actor_id: 'system',
                                    actor_name: 'System (Simulation)',
                                    actor_role: 'admin',
                                    target_id: student.uid,
                                    target_type: 'student',
                                    target_name: sbData.fullName || '',
                                    category: 'system',
                                    summary: 'Seat released during simulation',
                                    severity: 'low',
                                    metadata: {
                                        reason: 'soft_block_simulation',
                                        busId: sbBusId,
                                        shift: sbData.shift || null,
                                        at: nowIso,
                                    },
                                });
                            } catch (e: any) {
                                executionResults.errors.push(`Soft-block decrement failed for ${student.uid}: ${e.message}`);
                            }
                        }
                    }
                } catch (err: any) { executionResults.errors.push(`Soft block failed for ${student.uid}: ${err.message}`); }
            }

            for (const student of eligibleForHardDelete) {
                try {
                    const studentDoc = await adminDb.collection('students').doc(student.uid).get();
                    const studentData = studentDoc.exists ? studentDoc.data() : null;

                    const profilePhotoUrl = studentData?.profilePhotoUrl || studentData?.profileImage || studentData?.photoUrl;
                    if (profilePhotoUrl && cloudinary.config().api_key) {
                        try {
                            const url = new URL(profilePhotoUrl);
                            const parts = url.pathname.split('/');
                            const uploadIdx = parts.findIndex(p => p === 'upload');
                            if (uploadIdx !== -1) {
                                const after = parts.slice(uploadIdx + 1);
                                const publicIdWithExt = after.filter(p => !p.startsWith('v') || isNaN(Number(p.substring(1)))).join('/');
                                const publicId = publicIdWithExt.split('.').slice(0, -1).join('.');
                                await cloudinary.uploader.destroy(publicId);
                            }
                        } catch (e) {}
                    }

                    const fcmTokens = await adminDb.collection('fcm_tokens').where('userUid', '==', student.uid).limit(400).get();
                    if (!fcmTokens.empty) { const b = adminDb.batch(); fcmTokens.docs.forEach((d: any) => b.delete(d.ref)); await b.commit(); }

                    const waitingFlags = await adminDb.collection('waiting_flags').where('student_uid', '==', student.uid).limit(400).get();
                    if (!waitingFlags.empty) { const b = adminDb.batch(); waitingFlags.docs.forEach((d: any) => b.delete(d.ref)); await b.commit(); }

                    // DEDUP GUARD: skip decrement if the seat was already released at soft block.
                    const busId = studentData?.busId || studentData?.currentBusId || studentData?.assignedBusId;
                    if (busId && !wasSeatReleased(studentData)) {
                        await decrementBusCapacity(busId, student.uid, studentData?.shift).catch(() => {});
                    }

                    try {
                        const userRecord = await adminAuth.getUser(student.uid);
                        if (userRecord.providerData.some((p: any) => p.providerId === 'google.com')) {
                            await adminAuth.updateUser(student.uid, { providerToDelete: 'google.com' });
                        }
                        await adminAuth.deleteUser(student.uid);
                    } catch (e) {}

                    console.log(`🚨 [AUDIT] SIMULATION Hard delete for ${student.uid}. CALLER STACK:`, new Error().stack);
                    await adminDb.collection('students').doc(student.uid).delete();
                    await adminDb.collection('users').doc(student.uid).delete().catch(() => {});
                    executionResults.hardDeleted++;
                } catch (err: any) { executionResults.errors.push(`Hard delete failed for ${student.uid}: ${err.message}`); }
            }

            return NextResponse.json({
                success: true, executed: true,
                result: { simulatedDate: simDate.toISOString(), totalStudents: allStudents.length, allStudents, eligibleForSoftBlock, eligibleForHardDelete, alreadyBlocked, safeStudents: allStudents.length - eligibleForSoftBlock.length - eligibleForHardDelete.length - alreadyBlocked.length, errors: executionResults.errors },
                executionResults
            });
        }

        return NextResponse.json({
            success: true, executed: false,
            result: { simulatedDate: simDate.toISOString(), totalStudents: allStudents.length, allStudents, eligibleForSoftBlock, eligibleForHardDelete, alreadyBlocked, safeStudents: allStudents.length - eligibleForSoftBlock.length - eligibleForHardDelete.length - alreadyBlocked.length, errors: [] }
        });
    },
    {
        requiredRoles: ['admin'],
        schema: SimulateDeadlinesSchema,
        rateLimit: RateLimits.CREATE
    }
);
