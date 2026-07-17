import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import crypto from 'crypto';
import { shouldBlockAccessFromStoredDates, shouldHardDeleteFromStoredDates } from '@/lib/utils/renewal-utils';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { v2 as cloudinary } from 'cloudinary';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { isSeatReleaseAtSoftBlockEnabled, wasSeatReleased } from '@/lib/config/capacity-flags';
import { adminReconcileBusLoads } from '@/lib/services/admin-reconcile-bus-loads';
import { createAuditEvent, SYSTEM_ACTOR, type AuditEventInsert } from '@/domains/audit';
import { getCurrentSessionStartYear } from '@/lib/services/session-activation.service';
import { getSupabaseServer } from '@/lib/supabase-server';
import * as Notification from '@/domains/notification';
import { upsertMarker } from '@/domains/admin';
import * as fleetService from '@/domains/fleet/services/fleet.service';
import { getStudentById, updateStudent, deleteStudent, deleteUser, getStudentsByStatuses } from '@/domains/identity';

// Configure Cloudinary
if (process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
        cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
}

/**
 * AUTOMATED CRON JOB for Soft Block & Hard Delete
 * 
 * Scheduled to run daily (or as configured).
 * Uses PRE-STORED softBlock and hardBlock dates from student documents.
 * Migrates legacy students without these fields by computing from validUntil.
 * 
 * - Soft Blocks students who have passed the soft block date.
 * - Hard Deletes students who have passed the hard delete date.
 */
export async function GET(request: NextRequest) {
    try {
        // 1. Authorization Check (CRITICAL)
        const authHeader = request.headers.get('Authorization');
        const cronSecret = process.env.CRON_SECRET;

        // In production, strictly enforce CRON_SECRET. 
        // For dev/testing, you might allow manual overrides or disable this check carefully.
        if (!cronSecret) {
            console.error('🚫 CRON_SECRET not configured — blocking cron request');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }
        const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
        const secretsMatch = providedToken.length === cronSecret.length &&
            crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(cronSecret));
        if (!secretsMatch) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Load deadline config dynamically from Firestore
        const config = await getDeadlineConfig() as any;

        console.log(`🔄 Running Automated Cleanup Cron Job`);
        // Handle config.softBlock potentially being undefined or different structure if casting failed
        const softBlockStr = config.softBlock ? `${config.softBlock.month + 1}/${config.softBlock.day}` : 'Unknown';
        const hardDeleteStr = config.hardDelete ? `${config.hardDelete.month + 1}/${config.hardDelete.day}` : 'Unknown';

        console.log(`   Config: SoftBlock=${softBlockStr}, HardDelete=${hardDeleteStr}`);
        console.log(`   Using PRE-STORED softBlock/hardBlock dates from student documents`);

        // 2. Query target students from PostgreSQL (canonical source) via Domain
        const results = {
            totalChecked: 0,
            softBlocked: 0,
            hardDeleted: 0,
            blockDatesAdded: 0,
            errors: [] as string[]
        };

        const students = await getStudentsByStatuses(['active', 'soft_blocked', 'pending_deletion']);
        results.totalChecked = students.length;

        for (const studentData of students) {
            const uid = studentData.uid;

            try {
                // Parse validUntil
                let validUntilStr: string | null = null;
                if (studentData.validUntil) {
                    if (typeof studentData.validUntil === 'string') {
                        validUntilStr = studentData.validUntil;
                    } else if (studentData.validUntil.toDate) {
                        validUntilStr = studentData.validUntil.toDate().toISOString();
                    }
                }

                // Parse lastRenewalDate
                let lastRenewalDateStr: string | null = null;
                if (studentData.lastRenewalDate) {
                    if (typeof studentData.lastRenewalDate === 'string') {
                        lastRenewalDateStr = studentData.lastRenewalDate;
                    } else if (studentData.lastRenewalDate.toDate) {
                        lastRenewalDateStr = studentData.lastRenewalDate.toDate().toISOString();
                    }
                }

                // MIGRATION: If student has no softBlock/hardBlock fields, compute from validUntil
                let softBlockStr = studentData.softBlock;
                let hardBlockStr = studentData.hardBlock;

                if ((!softBlockStr || !hardBlockStr) && validUntilStr) {
                    // Compute from validUntil date (the single source of truth) with dynamic configuration
                    const blockDates = computeBlockDatesFromValidUntil(validUntilStr, config);

                    // Update student document with computed block dates in PostgreSQL
                    await updateStudent(uid, {
                        softBlock: blockDates.softBlock,
                        hardBlock: blockDates.hardBlock,
                        blockDatesComputedAt: new Date().toISOString()
                    });

                    softBlockStr = blockDates.softBlock;
                    hardBlockStr = blockDates.hardBlock;
                    results.blockDatesAdded++;
                    console.log(`📅 Added block dates for ${uid.substring(0,8)}...: softBlock=${softBlockStr.split('T')[0]}, hardBlock=${hardBlockStr.split('T')[0]}`);
                }

                // Prepare student data object for optimized checks
                const studentCheckData = {
                    softBlock: softBlockStr,
                    hardBlock: hardBlockStr,
                    validUntil: validUntilStr,
                    lastRenewalDate: lastRenewalDateStr,
                    status: studentData.status,
                    sessionEndYear: studentData.sessionEndYear
                };

                // SAFETY CHECK: Skip students without sessionEndYear (likely new/incomplete)
                if (!studentData.sessionEndYear) {
                    console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} has no sessionEndYear. Likely new student - skipping deletion.`);
                    continue;
                }
                
                // Check using optimized stored-date functions with dynamic config override
                const needsSoftBlock = shouldBlockAccessFromStoredDates(studentCheckData, null, config);
                const needsHardDelete = shouldHardDeleteFromStoredDates(studentCheckData, null, config);

                // --- HARD DELETE EXECUTION ---
                if (needsHardDelete) {
                    // SAFETY CHECK: Log before deletion
                    console.log(`🗑️ HARD DELETE triggered for ${uid.substring(0,8)}...`);
                    console.log(`   hardBlock date: ${hardBlockStr}`);
                    console.log(`   validUntil: ${validUntilStr}`);
                    console.log(`   status: ${studentData.status}`);
                    
                    // SAFETY CHECK: Verify student is actually expired
                    const today = new Date();
                    if (validUntilStr) {
                        const validUntilDate = new Date(validUntilStr);
                        if (validUntilDate > today) {
                            console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} has validUntil ${validUntilStr} which is in the future. Skipping deletion.`);
                            continue;
                        }
                    }
                    
                    // SAFETY CHECK: Don't delete if student was recently active (last 30 days)
                    const lastActiveAt = studentData.lastActiveAt || studentData.lastLoginAt || studentData.updatedAt;
                    if (lastActiveAt) {
                        const lastActiveDate = new Date(lastActiveAt);
                        const daysSinceActive = Math.floor((today.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24));
                        if (daysSinceActive < 30) {
                            console.warn(`🛡️ SAFETY CANCELLED: Student ${uid} was active ${daysSinceActive} days ago. Skipping deletion.`);
                            continue;
                        }
                    }

                    // 1. Delete profile photo from Cloudinary
                    const profilePhotoUrl = studentData.profilePhotoUrl || studentData.profileImage || studentData.photoUrl || studentData.imageUrl;
                    if (profilePhotoUrl && cloudinary.config().api_key) {
                        try {
                            const url = new URL(profilePhotoUrl);
                            const pathParts = url.pathname.split('/');
                            const uploadIndex = pathParts.findIndex(part => part === 'upload');
                            if (uploadIndex !== -1) {
                                const afterUpload = pathParts.slice(uploadIndex + 1);
                                const fileName = afterUpload[afterUpload.length - 1];
                                if (fileName) {
                                    const publicIdParts = afterUpload.filter(part => !part.startsWith('v') || isNaN(Number(part.substring(1))));
                                    const lastPart = publicIdParts[publicIdParts.length - 1];
                                    const nameWithoutExtension = lastPart.split('.').slice(0, -1).join('.');
                                    publicIdParts[publicIdParts.length - 1] = nameWithoutExtension;
                                    const publicId = publicIdParts.join('/');
                                    await cloudinary.uploader.destroy(publicId);
                                    console.log(`   ✅ Deleted Cloudinary image: ${publicId}`);
                                }
                            }
                        } catch (cloudErr) {
                            console.warn(`   ⚠️ Cloudinary delete warning for ${uid}:`, cloudErr);
                        }
                    }

                    // 2. Delete FCM tokens
                    const fcmSnapshot = await adminDb.collection('fcm_tokens').where('userUid', '==', uid).limit(400).get();
                    if (!fcmSnapshot.empty) {
                        const batch = adminDb.batch();
                        fcmSnapshot.docs.forEach((d: any) => batch.delete(d.ref));
                        await batch.commit();
                        console.log(`   ✅ Deleted ${fcmSnapshot.size} FCM tokens`);
                    }

                    // 3. Delete waiting flags
                    const waitingSnapshot = await adminDb.collection('waiting_flags').where('student_uid', '==', uid).limit(400).get();
                    if (!waitingSnapshot.empty) {
                        const batch = adminDb.batch();
                        waitingSnapshot.docs.forEach((d: any) => batch.delete(d.ref));
                        await batch.commit();
                        console.log(`   ✅ Deleted ${waitingSnapshot.size} waiting flags`);
                    }

                    // 4. Delete profile update requests
                    const profileRequestsSnapshot = await adminDb.collection('profile_update_requests').where('studentUid', '==', uid).limit(400).get();
                    if (!profileRequestsSnapshot.empty) {
                        const batch = adminDb.batch();
                        profileRequestsSnapshot.docs.forEach((d: any) => batch.delete(d.ref));
                        await batch.commit();
                        console.log(`   ✅ Deleted ${profileRequestsSnapshot.size} profile update requests`);
                    }

                    // 6. Delete from Firebase Auth (best-effort, pre-transaction).
                    //    External system; cannot be part of the Firestore transaction.
                    try {
                        try {
                            const userRecord = await adminAuth.getUser(uid);
                            const hasGoogleProvider = userRecord.providerData.some((provider: any) => provider.providerId === 'google.com');

                            if (hasGoogleProvider) {
                                await adminAuth.updateUser(uid, { providerToDelete: 'google.com' });
                                console.log(`   ℹ️ Disconnected Google provider`);
                            }
                        } catch (getUserErr) {
                            // User might not exist
                        }
                        await adminAuth.deleteUser(uid);
                        console.log(`   ✅ Deleted Auth user`);
                    } catch (authErr: any) {
                        if (!authErr.message?.includes('no user record') && !authErr.code?.includes('user-not-found')) {
                            console.warn(`   ⚠️ Auth delete warning:`, authErr.message);
                        }
                    }

                    // 7. Tier A — hard delete: decrement bus seat via PG, then
                    //    delete student/user from PG and Firestore mirror.
                    let seatDecremented = false;
                    let auditEvent: AuditEventInsert | null = null;
                    let freshBusId: string | null = null;
                    let freshShift: string | null = null;
                    let freshShouldDecrement = false;
                    let fullName = '';

                    try {
                        // Read fresh student data from PG via Domain for capacity decrement
                        const freshStudent = await getStudentById(uid);

                        if (freshStudent) {
                            freshBusId = freshStudent.busId || freshStudent.assignedBusId;
                            freshShift = freshStudent.shift;
                            freshShouldDecrement = !!freshBusId && !wasSeatReleased(freshStudent);
                            fullName = freshStudent.fullName || '';

                            if (freshShouldDecrement) {
                                try {
                                    const decResult = await fleetService.decrementBusCapacity(freshBusId, freshShift);
                                    seatDecremented = decResult.success;
                                } catch (decErr: any) {
                                    console.warn(`   ⚠️ Bus capacity decrement failed for ${uid}:`, decErr.message);
                                }
                            }
                        }
                    } catch (readErr: any) {
                        console.warn(`   ⚠️ Failed to read student for capacity decrement:`, readErr.message);
                    }

                    // Delete student/user from PostgreSQL (canonical datastore)
                    try {
                        await deleteStudent(uid);
                        await deleteUser(uid);
                    } catch (pgDelErr: any) {
                        console.warn(`   ⚠️ PostgreSQL delete warning for ${uid}:`, pgDelErr.message);
                    }

                    auditEvent = {
                        action: 'student_hard_deleted',
                        actor_id: SYSTEM_ACTOR.id,
                        actor_name: SYSTEM_ACTOR.name,
                        actor_role: SYSTEM_ACTOR.role,
                        target_id: uid,
                        target_type: 'student',
                        target_name: fullName,
                        category: 'system',
                        summary: 'Student hard-deleted: ' + fullName,
                        severity: 'high',
                        metadata: {
                            before: {
                                enrollmentId: null,
                                busId: freshBusId || null,
                                shift: freshShift || null,
                                status: null,
                                validUntil: validUntilStr,
                                sessionEndYear: null,
                                hardBlock: hardBlockStr || null,
                                seatReleasedAt: null,
                            },
                            after: { deleted: true },
                            seatDecremented: freshShouldDecrement,
                            busId: freshBusId || null,
                            reason: 'lifecycle_hard_delete_expired',
                            correlationId: uid,
                        },
                    };

                    if (auditEvent) void createAuditEvent(auditEvent);

                    console.log(`   ✅ Hard-deleted student ${uid} (seatDecremented=${seatDecremented})`);

                    results.hardDeleted++;
                    continue; // Skip soft block check since user is gone
                }

                // --- SOFT BLOCK EXECUTION ---
                // Only if not already blocked and not just deleted. The
                // `status === 'active'` guard makes this idempotent: an already
                // soft-blocked student is skipped, so the seat is released at most once.
                if (needsSoftBlock && studentData.status === 'active') {
                    console.log(`🔒 SOFT BLOCK triggered for ${uid.substring(0,8)}...`);
                    console.log(`   softBlock date: ${softBlockStr}`);

                    const releaseSeat = isSeatReleaseAtSoftBlockEnabled();
                    const nowIso = new Date().toISOString();

                    let didBlock = false;
                    let auditEvent: AuditEventInsert | null = null;
                    try {
                        // Read fresh student data from PG via Domain
                        const freshStudent = await getStudentById(uid);

                        const currentStatus = freshStudent?.status || studentData.status;
                        if (currentStatus !== 'active') {
                            didBlock = false;
                        } else {
                            const sbBusId = releaseSeat ? (freshStudent?.busId || freshStudent?.assignedBusId || studentData.busId || null) : null;
                            const sbShift = freshStudent?.shift || studentData.shift;
                            const sbFullName = freshStudent?.fullName || studentData.fullName || '';

                            // Decrement bus capacity via PG if releasing seat
                            let decremented = false;
                            if (releaseSeat && sbBusId) {
                                try {
                                    const decResult = await fleetService.decrementBusCapacity(sbBusId, sbShift);
                                    decremented = decResult.success;
                                } catch (decErr: any) {
                                    console.warn(`   ⚠️ Bus capacity decrement failed for soft block ${uid}:`, decErr.message);
                                }
                            }

                            // Update student status in PG via Domain (canonical)
                            await updateStudent(uid, {
                                status: 'soft_blocked',
                                softBlockedAt: nowIso,
                                ...(releaseSeat ? { seatReleasedAt: nowIso } : {})
                            });

                            auditEvent = {
                                action: releaseSeat ? 'student_soft_blocked_seat_released' : 'student_soft_blocked',
                                actor_id: SYSTEM_ACTOR.id,
                                actor_name: SYSTEM_ACTOR.name,
                                actor_role: SYSTEM_ACTOR.role,
                                target_id: uid,
                                target_type: 'student',
                                target_name: sbFullName,
                                category: 'system',
                                summary: (releaseSeat ? 'Student soft-blocked (seat released): ' : 'Student soft-blocked: ') + sbFullName,
                                severity: 'high',
                                metadata: {
                                    before: { status: 'active', busId: sbBusId, shift: sbShift || null },
                                    after: { status: 'soft_blocked', seatReleased: releaseSeat, seatDecremented: decremented },
                                    busId: sbBusId,
                                    at: nowIso,
                                    reason: 'soft_block',
                                    correlationId: uid,
                                },
                            };
                            didBlock = true;
                        }
                        if (didBlock) {
                            if (auditEvent) void createAuditEvent(auditEvent);
                            results.softBlocked++;
                            console.log(`   ✅ Soft-blocked ${uid}${releaseSeat ? ' (seat released)' : ''}`);
                        }
                    } catch (sbErr) {
                        console.warn(`   ⚠️ Soft-block failed for ${uid} — will retry next run:`, sbErr);
                        results.errors.push(`Soft-block failed for ${uid}`);
                    }
                }

            } catch (err: any) {
                console.error(`❌ Error processing student ${uid}:`, err);
                results.errors.push(`Error processing student ${uid}`);
            }
        }

        // ── UPCOMING (future-session) APPLICATIONS PASS ──────────────────────
        //   Independent of the June renewal calendar. For applications with
        //   applicationType === 'future' still sitting in state 'submitted':
        //     (1) when eligibleApproval has arrived, send a ONE-TIME "eligible now"
        //         reminder to the applicant (idempotent via eligibleReminderSentAt).
        //     (2) expire (state: 'expired') applications left unapproved for longer
        //         than the grace window past their eligibility date, so stale
        //         upcoming applications do not linger forever.
        //   These applications are NOT students and never touch bus capacity, so
        //   this pass only reads/writes the `applications` table in PG.
        const upcomingResults = { reminded: 0, expired: 0, errors: [] as string[] };
        // Grace window after eligibility before an unapproved upcoming application
        // is auto-expired. No dedicated config field exists; this constant is the
        // single tunable. (Days.)
        const UPCOMING_GRACE_DAYS = 60;
        try {
            const nowMs = Date.now();
            const db = getSupabaseServer();

            // Read future/submitted applications from PG
            const { data: upcomingApps, error: pgErr } = await db
                .from('applications')
                .select('*')
                .eq('application_type', 'future')
                .eq('state', 'submitted');

            if (pgErr) {
                console.error('⚠️ Failed to read upcoming applications from PG:', pgErr);
                upcomingResults.errors.push('PG read failed: ' + pgErr.message);
            } else if (upcomingApps) {
                for (const appData of upcomingApps) {
                    const appId = appData.application_id;
                    try {
                        const eligibleIso = appData.eligible_approval;
                        if (!eligibleIso) continue; // no frozen date → leave untouched
                        const eligibleMs = new Date(eligibleIso).getTime();
                        if (Number.isNaN(eligibleMs)) continue;

                        // Not yet eligible → nothing to do this run.
                        if (nowMs < eligibleMs) continue;

                        const graceCutoffMs = eligibleMs + UPCOMING_GRACE_DAYS * 24 * 60 * 60 * 1000;

                        if (nowMs >= graceCutoffMs) {
                            // (2) Past grace window → expire the stale application.
                            await db
                                .from('applications')
                                .update({
                                    state: 'expired',
                                    updated_at: new Date().toISOString(),
                                })
                                .eq('application_id', appId);
                            upcomingResults.expired++;
                        } else if (!appData.eligible_reminder_sent_at) {
                            // (1) Eligible now, within grace, not yet reminded → notify once.
                            await Notification.createNotification(
                                { userId: 'system', userName: 'System', userRole: 'admin' },
                                { type: 'specific_users', specificUserIds: [appData.applicant_uid || appId] },
                                `Seats for your upcoming session (${appData.target_session?.startYear || ''}-${appData.target_session?.endYear || ''}) are now available. Visit the Bus Office to complete your approval.`,
                                'Your application is now eligible',
                                { applicationId: appId, statusPage: `/apply/status/${appId}` }
                            );
                            await db
                                .from('applications')
                                .update({ eligible_reminder_sent_at: new Date().toISOString() })
                                .eq('application_id', appId);
                            upcomingResults.reminded++;
                        }
                    } catch (appErr: any) {
                        console.error(`❌ Error processing upcoming application ${appId}:`, appErr);
                        upcomingResults.errors.push(`Error processing application ${appId}`);
                    }
                }
            }
            console.log(`📅 Upcoming applications pass:`, upcomingResults);
        } catch (upcomingErr: any) {
            console.error('⚠️ Upcoming applications pass failed:', upcomingErr);
            upcomingResults.errors.push(upcomingErr?.message || 'upcoming pass failed');
        }

        // POST-BATCH RECONCILIATION (self-healing tail).
        //   Recounts active seat-owners and repairs any bus left over-counted by a
        //   failed soft-block decrement (or under-counted by any other drift).
        //   Gated on the flag: the active-only recount is authoritative ONLY under
        //   the new seat-release semantics. In legacy (flag-off) mode, soft-blocked
        //   students still own seats, so an active-only recount would wrongly drop
        //   them — therefore we skip the auto-correction entirely when the flag is off.
        let reconciliation: unknown = { skipped: true, reason: 'seat-release flag disabled' };
        if (isSeatReleaseAtSoftBlockEnabled()) {
            try {
                const summary = await adminReconcileBusLoads({ dryRun: false, alertOnLargeDelta: true });
                reconciliation = {
                    busesWithDiscrepancies: summary.busesWithDiscrepancies,
                    busesCorrected: summary.busesCorrected,
                    largeDeltaBuses: summary.largeDeltaBuses,
                    invalidShiftStudents: summary.invalidShiftStudents,
                };
                console.log(`🔧 Cron tail reconciliation:`, reconciliation);
            } catch (reconErr: any) {
                console.error('⚠️ Cron tail reconciliation failed (counts may be stale until next run):', reconErr);
                reconciliation = { error: reconErr?.message || 'reconciliation failed' };
            }
        }

        // Tier B — operational visibility. Surface the run summary (and any healed
        //   drift) into the audit stream so admins can SEE what the cron did without
        //   reading server logs. Best-effort with audit_failure capture on write loss.
        await createAuditEvent({
            action: 'cron_cleanup_expired_students_completed',
            actor_id: SYSTEM_ACTOR.id,
            actor_name: SYSTEM_ACTOR.name,
            actor_role: SYSTEM_ACTOR.role,
            target_id: 'cron:cleanup-expired-students',
            target_type: 'cron',
            target_name: '',
            category: 'system',
            summary: 'Cron cleanup completed',
            severity: 'medium',
            metadata: { results, upcomingApplications: upcomingResults, reconciliation, reason: 'scheduled_run' },
        });

        // Write the Soft Block Completion Marker to allow session activation to proceed
        try {
            const config = await getDeadlineConfig();
            const currentSessionStartYear = getCurrentSessionStartYear(config);
            await upsertMarker(`soft_block_completed_${currentSessionStartYear}`, {
                completedAt: new Date().toISOString(),
                softBlockedCount: results.softBlocked,
                hardDeletedCount: results.hardDeleted,
                reconciliationRun: true
            });
            console.log(`✅ Written Soft Block completion marker 'soft_block_completed_${currentSessionStartYear}'`);
        } catch (markerErr) {
            console.error('⚠️ Failed to write soft block completion marker:', markerErr);
        }

        console.log(`✅ Cron Job Completed:`, results);
        return NextResponse.json({ success: true, results, upcomingApplications: upcomingResults, reconciliation });

    } catch (error: any) {
        console.error('❌ Cron Job Fatal Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
