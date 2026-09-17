import { createAuditEvent } from '@/domains/audit';
import { deleteStudent,deleteUser,getAllStudents,getStudentById } from '@/domains/identity';
import { decrementBusCapacity } from '@/lib/busCapacityService';
import { isSeatReleaseAtSoftBlockEnabled,wasSeatReleased } from '@/lib/config/capacity-flags';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { adminAuth } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { SimulateDeadlinesSchema } from '@/lib/security/validation-schemas';
import { deleteUserTokens } from '@/lib/services/fcm-token-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import { v2 as cloudinary } from 'cloudinary';
import { NextResponse } from 'next/server';

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

        // Query students from PostgreSQL (canonical source)
        const studentsFromPg = await getAllStudents();
        const allStudents: StudentStatus[] = [];
        const eligibleForSoftBlock: StudentStatus[] = [];
        const eligibleForHardDelete: StudentStatus[] = [];
        const alreadyBlocked: StudentStatus[] = [];

        studentsFromPg.forEach((student: any) => {
            let validUntil: Date | null = null;
            if (student.validUntil) {
                validUntil = new Date(student.validUntil);
            }

            const sessionEndYear = syncSessionYear ? simYear : (validUntil ? validUntil.getFullYear() : null);
            if (!sessionEndYear) {
                allStudents.push({ uid: student.uid, name: student.fullName || student.name || 'Unknown', enrollmentId: student.enrollmentId || 'N/A', email: student.email || 'N/A', validUntil: 'Not Set', sessionEndYear: 0, status: student.status || 'unknown', softBlockDate: 'N/A', hardDeleteDate: 'N/A', shouldSoftBlock: false, shouldHardDelete: false, daysPastSoftBlock: 0, daysPastHardDelete: 0 });
                return;
            }

            const startMonth = config.academicSessionStart?.month ?? 6;
            const startDay = config.academicSessionStart?.day ?? 1;
            const lifecycle = deriveAcademicLifecycle(startMonth, startDay, sessionEndYear);

            const studentSoftBlockDate = student.softBlock ? new Date(student.softBlock) : lifecycle.softBlock;
            const studentHardDeleteDate = student.hardBlock ? new Date(student.hardBlock) : lifecycle.hardDelete;

            const isPastSoftBlock = simDate >= studentSoftBlockDate;
            const isPastHardDelete = simDate >= studentHardDeleteDate;

            const studentStatus: StudentStatus = {
                uid: student.uid, name: student.fullName || student.name || 'Unknown', enrollmentId: student.enrollmentId || 'N/A', email: student.email || 'N/A',
                validUntil: validUntil?.toISOString() || 'N/A', sessionEndYear, status: student.status || 'active',
                softBlockDate: studentSoftBlockDate.toISOString(), hardDeleteDate: studentHardDeleteDate.toISOString(),
                shouldSoftBlock: isPastSoftBlock && !isPastHardDelete, shouldHardDelete: isPastHardDelete,
                daysPastSoftBlock: isPastSoftBlock ? Math.floor((simDate.getTime() - studentSoftBlockDate.getTime()) / 86400000) : 0,
                daysPastHardDelete: isPastHardDelete ? Math.floor((simDate.getTime() - studentHardDeleteDate.getTime()) / 86400000) : 0
            };

            allStudents.push(studentStatus);
            if (!manualMode) {
                if (student.status === 'soft_blocked' || student.status === 'pending_deletion') alreadyBlocked.push(studentStatus);
                else if (isPastHardDelete) eligibleForHardDelete.push(studentStatus);
                else if (isPastSoftBlock) eligibleForSoftBlock.push(studentStatus);
            }
        });

        if (manualMode) {
            const studentMap = new Map(allStudents.map(st => [st.uid, st]));
            const softBlockSet = new Set(eligibleForSoftBlock.map(st => st.uid));
            for (const uid of selectedForSoftBlock) {
                const s = studentMap.get(uid);
                if (s && !softBlockSet.has(uid)) {
                    eligibleForSoftBlock.push(s);
                    softBlockSet.add(uid);
                }
            }
            const hardDeleteSet = new Set(eligibleForHardDelete.map(st => st.uid));
            for (const uid of selectedForHardDelete) {
                const s = studentMap.get(uid);
                if (s && !hardDeleteSet.has(uid)) {
                    eligibleForHardDelete.push(s);
                    hardDeleteSet.add(uid);
                }
            }
        }

        if (execute && !dryRun) {
            const executionResults = { softBlocked: 0, hardDeleted: 0, errors: [] as string[] };
            const releaseSeatAtSoftBlock = isSeatReleaseAtSoftBlockEnabled();
            const BATCH_SIZE = 10;
            
            for (let i = 0; i < eligibleForSoftBlock.length; i += BATCH_SIZE) {
                const chunk = eligibleForSoftBlock.slice(i, i + BATCH_SIZE);
                await Promise.all(chunk.map(async (student) => {
                    try {
                        // Re-read student from PostgreSQL
                        const sbData = await getStudentById(student.uid);
                        if (!sbData) return;
                        
                        // Idempotency: only release/transition a student who is still active.
                        if (sbData.status !== 'active') return;

                        const nowIso = new Date().toISOString();
                        const sbBusId = sbData.busId;
                        const sbShift = sbData.shift;

                        // Call the atomic RPC to soft-block and release the seat
                        const supabase = getSupabaseServer();
                        const { data: rpcResult, error: rpcError } = await supabase.rpc('soft_block_student_with_seat_release', {
                            p_student_uid: student.uid,
                            p_bus_id: releaseSeatAtSoftBlock ? sbBusId : null,
                            p_shift: sbShift,
                            p_release_seat: releaseSeatAtSoftBlock,
                            p_soft_blocked_at: nowIso,
                            p_seat_released_at: nowIso
                        });

                        if (rpcError) {
                            executionResults.errors.push(`Soft block failed for ${student.uid}: ${rpcError.message}`);
                        } else if (!rpcResult || !rpcResult.success) {
                            executionResults.errors.push(`Soft block failed for ${student.uid}: ${rpcResult?.error || 'Unknown RPC warning'}`);
                        } else {
                            executionResults.softBlocked++;

                            if (releaseSeatAtSoftBlock && sbBusId) {
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
                            }
                        }
                    } catch (err: any) { executionResults.errors.push(`Soft block failed for ${student.uid}: ${err.message}`); }
                }));
            }

            for (let i = 0; i < eligibleForHardDelete.length; i += BATCH_SIZE) {
                const chunk = eligibleForHardDelete.slice(i, i + BATCH_SIZE);
                await Promise.all(chunk.map(async (student) => {
                    try {
                        const studentData = await getStudentById(student.uid);
                        if (!studentData) return;

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

                        // Delete FCM tokens from PostgreSQL (hoisted import)
                        await deleteUserTokens(student.uid);

                        // Delete waiting flags from Supabase PostgreSQL
                        const supabase = getSupabaseServer();
                        await supabase.from('waiting_flags').delete().eq('student_uid', student.uid);

                        // DEDUP GUARD: skip decrement if the seat was already released at soft block.
                        const busId = studentData?.busId;
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

                        // Delete from PostgreSQL
                        await deleteStudent(student.uid);
                        await deleteUser(student.uid).catch(() => {});

                        executionResults.hardDeleted++;
                    } catch (err: any) { executionResults.errors.push(`Hard delete failed for ${student.uid}: ${err.message}`); }
                }));
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
