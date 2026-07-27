import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { UpdateStudentSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { decrementBusCapacity, incrementBusCapacity } from '@/domains/fleet';
import { getStudentById, updateStudent } from '@/domains/identity';

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

            // ── Read student from PostgreSQL (canonical source of truth) ──
            const currentData = await getStudentById(uid);
            if (!currentData) {
                return NextResponse.json({ success: false, error: 'Student not found' }, { status: 404 });
            }

            const oldBusId = currentData.busId || currentData.busId;
            const oldShift = currentData.shift || 'Morning';

            const newBusId = updateData.busId !== undefined ? updateData.busId : oldBusId;
            const newShift = updateData.shift !== undefined ? updateData.shift : oldShift;

            const busChanged = oldBusId !== newBusId;
            const shiftChanged = oldShift !== newShift;

            // ── PG capacity mutations (source of truth) with compensation tracking ──
            const pgCompensations: Array<() => Promise<any>> = [];

            if (busChanged || shiftChanged) {
                const seatAlreadyReleased = wasSeatReleased(currentData);
                if (oldBusId && !seatAlreadyReleased) {
                    if (busChanged) {
                        await decrementBusCapacity(oldBusId, oldShift);
                        pgCompensations.push(() => incrementBusCapacity(oldBusId, oldShift));
                    } else {
                        await decrementBusCapacity(oldBusId, oldShift);
                        pgCompensations.push(() => incrementBusCapacity(oldBusId, oldShift));
                        await incrementBusCapacity(oldBusId, newShift);
                        pgCompensations.push(() => decrementBusCapacity(oldBusId, newShift));
                    }
                }

                if (busChanged && newBusId) {
                    await incrementBusCapacity(newBusId, newShift);
                    pgCompensations.push(() => decrementBusCapacity(newBusId, newShift));
                }
            }

            // ── Clean and Map update data ──
            const cleanedUpdateData = Object.entries(updateData).reduce((acc, [key, value]) => {
                if (value !== undefined && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
                    acc[key] = value;
                }
                return acc;
            }, { updatedAt: new Date().toISOString() } as any);

            // Backward compatible mapping for pgUpdateStudent mapping requirements
            if (updateData.name) {
                cleanedUpdateData.fullName = updateData.name;
            }
            if (updateData.phoneNumber) {
                cleanedUpdateData.phone = updateData.phoneNumber;
                cleanedUpdateData.phoneNumber = updateData.phoneNumber;
            }
            if (updateData.alternatePhone) {
                cleanedUpdateData.altPhone = updateData.alternatePhone;
                cleanedUpdateData.alternatePhone = updateData.alternatePhone;
            }

            if (updateData.validUntil) {
                const blockDates = computeBlockDatesFromValidUntil(updateData.validUntil, deadlineConfig);
                cleanedUpdateData.softBlock = blockDates.softBlock;
                cleanedUpdateData.hardBlock = blockDates.hardBlock;
            }

            // ── PostgreSQL Update ──
            try {
                await updateStudent(uid, cleanedUpdateData);
            } catch (pgUpdErr) {
                for (const comp of pgCompensations.reverse()) {
                    await comp().catch(() => {});
                }
                throw pgUpdErr;
            }

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
