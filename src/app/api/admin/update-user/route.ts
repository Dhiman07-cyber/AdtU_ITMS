import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Transaction, DocumentSnapshot } from 'firebase-admin/firestore';
import { withSecurity } from '@/lib/security/api-security';
import { UpdateStudentSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { buildCapacityDelta } from '@/lib/busCapacityService';
import { getShiftDeltas } from '@/lib/utils/shift-utils';

/**
 * POST /api/admin/update-user
 * 
 * Optimized:
 * - Parallelized transaction reads (Current Student, Old Bus, New Bus)
 * - Atomic capacity reconciliation
 * - Robust cleanup of undefined update fields
 */

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { uid, ...updateData } = body as any;

        // SECURITY: Moderators cannot modify sensitive fields that affect
        // entitlement, capacity, or financial state. Only admins can.
        const SENSITIVE_FIELDS = [
            'validUntil', 'status', 'sessionStartYear', 'sessionEndYear',
            'durationYears', 'paymentAmount', 'paid_on', 'softBlock', 'hardBlock',
            'role', 'busId', 'routeId', 'shift', 'seatReleasedAt',
            'softBlockedAt', 'hardDeleteScheduledAt', 'approvedBy', 'approvedById',
        ];

        if (auth.role === 'moderator') {
            const attemptedSensitiveFields = SENSITIVE_FIELDS.filter(f => f in updateData);
            if (attemptedSensitiveFields.length > 0) {
                return NextResponse.json({
                    success: false,
                    error: `Moderators cannot modify sensitive fields: ${attemptedSensitiveFields.join(', ')}`
                }, { status: 403 });
            }
        }

        try {
            const deadlineConfig = await getDeadlineConfig();
            await adminDb.runTransaction(async (transaction: Transaction) => {
                const studentRef = adminDb.collection('students').doc(uid) as any;
                const studentDoc = (await transaction.get(studentRef)) as any as DocumentSnapshot;

                if (!studentDoc.exists) throw new Error('Student not found');

                const currentData = studentDoc.data() || {};
                const oldBusId = currentData.busId;
                const oldShift = currentData.shift || 'Morning';

                const newBusId = updateData.busId !== undefined ? updateData.busId : oldBusId;
                const newShift = updateData.shift !== undefined ? updateData.shift : oldShift;

                const busChanged = oldBusId !== newBusId;
                const shiftChanged = oldShift !== newShift;

                // Prepare bus references if needed
                const refs: any[] = [];
                if ((busChanged || shiftChanged) && oldBusId) refs.push(adminDb.collection('buses').doc(oldBusId));
                if ((busChanged || shiftChanged) && newBusId && newBusId !== oldBusId) refs.push(adminDb.collection('buses').doc(newBusId));

                // Parallelize all dependent reads in the transaction with explicit casting via any
                const snapshots = (await Promise.all(refs.map(ref => transaction.get(ref)))) as any as DocumentSnapshot[];
                const busSnaps = new Map(snapshots.map(s => [s.id, s]));

                if (busChanged || shiftChanged) {
                    // 1. Decrement old bus capacity
                    // SKIP if seat was already released at soft-block — the bus was
                    // already decremented once; decrementing again would undercount.
                    const seatAlreadyReleased = wasSeatReleased(currentData);
                    if (oldBusId && !seatAlreadyReleased) {
                        const oldBusSnap = busSnaps.get(oldBusId);
                        if (oldBusSnap?.exists) {
                            if (busChanged) {
                                // Bus changed → full decrement (currentMembers + shift bucket)
                                // buildCapacityDelta maintains currentMembers = morningCount + eveningCount.
                                const delta = buildCapacityDelta(oldBusSnap.data(), oldShift, -1);
                                transaction.update(oldBusSnap.ref, delta.updates);
                            } else {
                                // Shift changed on the SAME bus → only swap the shift bucket.
                                // currentMembers is the total occupancy and does NOT change.
                                // Applying buildCapacityDelta twice on the same snapshot would
                                // produce conflicting absolute-value writes; use FieldValue for
                                // the bucket-only change so Firestore merges them safely.
                                const shiftOnlyUpdates: Record<string, unknown> = {};
                                const oldDeltas = getShiftDeltas(oldShift);
                                const newDeltas = getShiftDeltas(newShift);
                                if (oldDeltas.affectsMorning) shiftOnlyUpdates['load.morningCount'] = FieldValue.increment(-1);
                                if (oldDeltas.affectsEvening) shiftOnlyUpdates['load.eveningCount'] = FieldValue.increment(-1);
                                if (newDeltas.affectsMorning) shiftOnlyUpdates['load.morningCount'] = FieldValue.increment(1);
                                if (newDeltas.affectsEvening) shiftOnlyUpdates['load.eveningCount'] = FieldValue.increment(1);
                                transaction.update(oldBusSnap.ref, shiftOnlyUpdates);
                            }
                        }
                    }

                    // 2. Increment new bus capacity (only when bus actually changed)
                    if (busChanged && newBusId) {
                        const newBusSnap = busSnaps.get(newBusId);
                        if (newBusSnap?.exists) {
                            const delta = buildCapacityDelta(newBusSnap.data(), newShift, 1);
                            transaction.update(newBusSnap.ref, delta.updates);
                        }
                    }
                }

                // Clean update data
                const cleanedUpdateData = Object.entries(updateData).reduce((acc, [key, value]) => {
                    if (value !== undefined && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
                        acc[key] = value;
                    }
                    return acc;
                }, { updatedAt: new Date().toISOString() } as any);

                if (updateData.validUntil) {
                    const blockDates = computeBlockDatesFromValidUntil(updateData.validUntil, deadlineConfig);
                    cleanedUpdateData.softBlock = blockDates.softBlock;
                    cleanedUpdateData.hardBlock = blockDates.hardBlock;
                }

                transaction.update(studentRef, cleanedUpdateData);
            });

            return NextResponse.json({ success: true, message: 'Student updated successfully' });
        } catch (error: any) {
            const msg = error instanceof Error ? error.message : '';
            return NextResponse.json({
                success: false,
                error: safeErrorMessage(error, 'Internal Server Error')
            }, { status: msg === 'Student not found' ? 404 : 500 });
        }
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: UpdateStudentSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
