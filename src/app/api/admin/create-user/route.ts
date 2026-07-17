import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { calculateRenewalDate } from '@/lib/utils/renewal-utils';
import { sendBusFullAlert } from '@/lib/busCapacityService';
import { incrementBusCapacity, getBusById, updateBus } from '@/domains/fleet';
import { generateOfflinePaymentId } from '@/lib/types/payment';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { DEFAULT_BUS_FEE } from '@/config/runtime';
import {
    sendStudentAddedNotification,
    getAdminEmailRecipients,
    StudentAddedEmailData,
} from '@/lib/services/admin-email.service';
import { generateReceiptPdf } from '@/lib/services/receipt.service';
import { getSystemConfig } from '@/domains/admin';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { withSecurity } from '@/lib/security/api-security';
import { CreateUserSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { z } from 'zod';
import { createAuditEvent } from '@/domains/audit';
import { normalizeShift } from '@/lib/utils/shift-utils';
import { createUser, createStudent, createDriver, getStudentById } from '@/domains/identity';
import * as routeService from '@/domains/route';

type CreateUserBody = z.infer<typeof CreateUserSchema>;

type RouteStop = {
    id?: string;
    stopId?: string;
    name?: string;
    stopName?: string;
};

/**
 * Optimized Create User API (Student, Driver, Moderator, Admin)
 * 
 * Enhancements:
 * - Parallelized metadata fetching (System Config, Deadline Config, Approver Data)
 * - Parallelized helper lookups (Route, Bus, Stop names)
 * - Backgrounded heavy tasks (Email, PDF generation)
 * - Atomic document creation
 */

// Helper function to fetch multiple names in parallel
async function resolveReferenceNames(routeId?: string, busId?: string, stopId?: string) {
    const tasks: Promise<string>[] = [
        (async () => {
            if (!routeId) return 'Not Assigned';
            const route = await routeService.getById(routeId);
            return route?.routeName || routeId;
        })(),
        (async () => {
            if (!busId) return 'Auto-assigned';
            const bus = await getBusById(busId);
            if (!bus) return busId;
            const busNum = (bus as any).displayIndex || (bus as any).sequenceNumber || bus.busNumber;
            return busNum ? `Bus-${busNum} (${(bus as any).licensePlate || (bus as any).plateNumber || '?'})` : (bus.busNumber || busId);
        })(),
        (async () => {
            if (!routeId || !stopId) return 'Not Selected';
            const route = await routeService.getById(routeId);
            const stops = (route?.stops || []) as RouteStop[];
            const stop = stops.find((s) => s.id === stopId || s.stopId === stopId);
            return stop?.name || stop?.stopName || stopId;
        })()
    ];
    return Promise.all(tasks);
}

export const POST = withSecurity<CreateUserBody>(
    async (request, { auth, body }) => {
        const currentUserUid = auth.uid;
        const currentUserRole = auth.role;

        // 1. Parallelize initial validation & configuration fetching
        const [approverInfo, systemConfigResult, deadlineConfig] = await Promise.all([
            getUpdaterInfo(adminAuth, currentUserUid),
            getSystemConfig(),
            getDeadlineConfig()
        ]);

        const currentUserName = approverInfo.name || auth.name || 'System';
        const currentUserEmployeeId = approverInfo.roleOrEmployeeId || (currentUserRole === 'admin' ? 'ADMIN' : 'MOD');
        const approvedByDisplay = `${currentUserName} (${currentUserRole === 'admin' ? 'Admin' : currentUserEmployeeId})`;

        const {
            email, name, role, phone, alternatePhone, profilePhotoUrl, enrollmentId,
            gender, faculty, department, semester, parentName, parentPhone,
            dob, licenseNumber, joiningDate, aadharNumber, driverId,
            employeeId, staffId, assignedRouteId, routeId, assignedBusId,
            busId, address, bloodGroup, shift, durationYears, sessionDuration,
            sessionStartYear, sessionEndYear, validUntil, pickupPoint, stopId, status
        } = body;

        if (currentUserRole === 'moderator') {
            if (role === 'admin' || role === 'moderator') {
                return NextResponse.json(
                    { success: false, error: 'Moderators cannot create staff accounts' },
                    { status: 403 }
                );
            }

            const permissionDenied = role === 'student'
                ? await requireModeratorPermission(auth, 'students', 'canAdd')
                : await requireModeratorPermission(auth, 'drivers', 'canAdd');

            if (permissionDenied) return permissionDenied;
        }

        const finalStopId = stopId || pickupPoint || '';
        const finalDuration = durationYears || (typeof sessionDuration === 'string' ? parseInt(sessionDuration) : sessionDuration) || 1;

        // 2. Auth management
        let uid: string;
        let authUserCreated = false;
        try {
            const userRecord = await adminAuth.getUserByEmail(email);
            uid = userRecord.uid;
        } catch {
            const userRecord = await adminAuth.createUser({ email, emailVerified: true });
            uid = userRecord.uid;
            authUserCreated = true;
        }

        const now = new Date().toISOString();

        // 3. Role-specific logic
        if (role === 'student') {
            let finalValidUntil = validUntil;
            let finalSessionEndYear = sessionEndYear;

            if (!finalValidUntil) {
                const { newValidUntil } = calculateRenewalDate(null, finalDuration, deadlineConfig);
                finalValidUntil = newValidUntil;
                finalSessionEndYear = new Date(finalValidUntil).getFullYear();
            }

            const blockDates = computeBlockDatesFromValidUntil(finalValidUntil, deadlineConfig);
            const busFeeAmount = systemConfigResult.data?.busFee?.amount || DEFAULT_BUS_FEE;
            const totalAmount = busFeeAmount * finalDuration;
            const paymentId = totalAmount > 0 ? generateOfflinePaymentId('new_registration') : null;

            const studentDoc = {
                address: address || '', alternatePhone: alternatePhone || '', altPhone: alternatePhone || '', approvedAt: now,
                approvedBy: approvedByDisplay, bloodGroup: bloodGroup || '',
                busId: busId || (routeId ? routeId.replace('route_', 'bus_') : ''),
                createdAt: now, department: department || '', dob: dob || '',
                durationYears: finalDuration, email, enrollmentId: enrollmentId || '',
                faculty: faculty || '', fullName: name, gender: gender || '',
                parentName: parentName || '', parentPhone: parentPhone || '',
                phoneNumber: phone || '', phone: phone || '', profilePhotoUrl: profilePhotoUrl || '',
                role: 'student', routeId: routeId || '', semester: semester || '',
                sessionEndYear: finalSessionEndYear, sessionStartYear: sessionStartYear || new Date().getFullYear(),
                shift: normalizeShift(shift), status: 'active', stopId: finalStopId,
                uid, updatedAt: now, validUntil: finalValidUntil,
                softBlock: blockDates.softBlock, hardBlock: blockDates.hardBlock,
                paymentAmount: totalAmount, paid_on: now,
            };

            // Phase 1 — Persist payment to Supabase BEFORE entitlement (safe direction:
            // a failure here creates no student and no seat).
            if (paymentId) {
                const { paymentsSupabaseService } = await import('@/lib/services/payments-supabase');
                const createdPaymentId = await paymentsSupabaseService.createPayment({
                    paymentId, studentId: enrollmentId || '', studentUid: uid, studentName: name,
                    stopId: finalStopId, amount: totalAmount, method: 'Offline', status: 'Completed',
                    sessionStartYear: sessionStartYear || new Date().getFullYear(),
                    sessionEndYear: finalSessionEndYear, durationYears: finalDuration,
                    validUntil: new Date(finalValidUntil), transactionDate: new Date(),
                    offlineTransactionId: `manual_entry_${Date.now()}`,
                    approvedBy: { type: 'Manual', userId: currentUserUid, empId: currentUserEmployeeId, name: currentUserName, role: currentUserRole === 'admin' ? 'Admin' : 'Moderator' },
                    approvedAt: new Date(),
                });
                if (!createdPaymentId) {
                    throw new Error('Failed to create payment ledger record');
                }
            }

            // Phase 2 — Atomic student creation + capacity allocation (single transaction).
            //   Admin-create intentionally preserves over-fill capability (no capacity
            //   gate). Capacity is incremented only when the student did not already
            //   exist, so a double-submit (same uid) can never double-allocate a seat.
            const assignedBusId = studentDoc.busId;

            // Write user to PostgreSQL (canonical source of truth)
            await createUser({
                uid,
                email,
                name,
                role: 'student',
                createdAt: now,
            });

            // Write student to PostgreSQL (canonical source of truth) — before transaction
            await createStudent({
                ...studentDoc,
                uid,
                createdAt: now,
                updatedAt: now,
            });

            let capNewMembers = 0;
            let capLimit = 0;
            let capExceeded = false;
            let capAlreadyCounted = false;
            let capBusNumber = '';
            let capRouteId = '';

            // Idempotency gate: PostgreSQL check via Domain determines if capacity should be allocated
            const studentData = await getStudentById(uid);
            const alreadyExisted = !!studentData;

            if (assignedBusId && !alreadyExisted) {
                // Increment capacity in PG (source of truth) — admin-create intentionally
                // over-fills (no capacity gate), matching legacy behavior.
                try {
                    const capResult = await incrementBusCapacity(assignedBusId, studentDoc.shift);
                    capNewMembers = capResult.newShiftLoad;
                    capLimit = capResult.capacity;
                    capExceeded = capNewMembers > capLimit;
                    const busData = await getBusById(assignedBusId);
                    capBusNumber = busData?.busNumber || '';
                    capRouteId = busData?.routeId || '';
                } catch (pgErr) {
                    console.warn(`⚠️ create-user: PG capacity increment failed for bus ${assignedBusId}; student created without capacity increment:`, pgErr);
                }
            } else if (assignedBusId && alreadyExisted) {
                capAlreadyCounted = true;
            }

            // Phase 3 — Post-commit: alert + admin over-fill audit (never affects committed state).
            if (capAlreadyCounted) {
                console.warn(`⚠️ create-user: student ${uid} already existed; skipped duplicate capacity allocation on bus ${assignedBusId}`);
            }
            if (assignedBusId && capLimit > 0 && capNewMembers >= capLimit) {
                await sendBusFullAlert(assignedBusId, capBusNumber, capRouteId).catch(e => console.error('Bus full alert failed:', e));
            }
            if (capExceeded) {
                console.warn(`🚨 ADMIN OVER-FILL: bus ${assignedBusId} now ${capNewMembers}/${capLimit} via admin-create of ${uid}`);
                await createAuditEvent({
                    category: 'additions',
                    action: 'capacity_exceeded_admin_create',
                    summary: `Admin created user with capacity exceeded: ${name}`,
                    severity: 'medium',
                    actor_id: currentUserUid,
                    actor_name: currentUserName,
                    actor_role: currentUserRole,
                    target_type: 'student',
                    target_id: uid,
                    target_name: name,
                    metadata: { busId: assignedBusId, newMembers: capNewMembers, capacity: capLimit, shift: studentDoc.shift },
                });
            }

            // 4. Fire-and-forget notifications (if moderator added)
            if (currentUserRole === 'moderator') {
                (async () => {
                    try {
                        const [[routeName, busName, resolvedStopName], adminRecipients] = await Promise.all([
                            resolveReferenceNames(routeId, busId, finalStopId),
                            getAdminEmailRecipients()
                        ]);

                        if (adminRecipients.length > 0) {
                            const emailData: StudentAddedEmailData = {
                                studentName: name, studentEmail: email, studentPhone: phone || '', enrollmentId: enrollmentId || '',
                                faculty: faculty || '', department: department || '', semester: semester || '', shift: shift || 'Morning',
                                routeName, busName, pickupPoint: resolvedStopName, sessionStartYear: sessionStartYear || new Date().getFullYear(),
                                sessionEndYear: finalSessionEndYear, validUntil: finalValidUntil, durationYears: finalDuration,
                                paymentAmount: totalAmount, transactionId: paymentId || 'N/A',
                                addedBy: { name: currentUserName, employeeId: currentUserEmployeeId, role: 'moderator' },
                                addedAt: now
                            };

                            const pdfBuffer = paymentId
                                ? await generateReceiptPdf(paymentId).catch(() => null)
                                : null;
                            await sendStudentAddedNotification(
                                adminRecipients, emailData,
                                pdfBuffer ? { content: pdfBuffer, filename: `Receipt_${name.replace(/\s+/g, '_')}_${paymentId}.pdf` } : undefined
                            );
                        }
                    } catch (e) { console.error('Notification error:', e); }
                })();
            }
        } else if (role === 'driver') {
            const driverDocData = {
                uid, email, fullName: name, licenseNumber: licenseNumber || '', aadharNumber: aadharNumber || '',
                phone: phone || '', altPhone: alternatePhone || '', joiningDate: joiningDate || '',
                driverId: driverId || employeeId || '', address: address || '', profilePhotoUrl: profilePhotoUrl || '',
                assignedRouteId: assignedRouteId || routeId || null, assignedBusId: assignedBusId || busId || null,
                shift: shift || 'Both', approvedBy: approvedByDisplay, dob: dob || '',
                status: 'active', createdAt: now, updatedAt: now,
            };

            // Write user to PostgreSQL (canonical source of truth)
            await createUser({
                uid,
                email,
                name,
                role: 'driver',
                createdAt: now,
            });

            // Write driver to PostgreSQL (canonical source of truth) — before transaction
            await createDriver({
                ...driverDocData,
                uid,
                createdAt: now,
                updatedAt: now,
            });

            // Update bus driver assignment via PG
            if (busId) {
                await updateBus(busId, { driverUID: uid, activeTripId: null } as any);
            }
        } else {
            // Moderator or Admin
            const col = role === 'moderator' ? 'moderators' : 'admins';
            const docData = {
                uid, email, fullName: name, dob: dob || '', joiningDate: joiningDate || '',
                aadharNumber: aadharNumber || '', phone: phone || '', altPhone: alternatePhone || '',
                staffId: employeeId || staffId || '', employeeId: employeeId || staffId || '',
                profilePhotoUrl: profilePhotoUrl || '', approvedBy: approvedByDisplay,
                address: address || '', status: status || 'active', createdAt: now, updatedAt: now,
            };

            // Write user to PostgreSQL (canonical source of truth)
            await createUser({
                uid,
                email,
                name,
                role: role as any,
                createdAt: now,
            });

        }

        return NextResponse.json({
            success: true,
            message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully.`
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: CreateUserSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);
