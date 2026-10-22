/**
 * API Route: Verify Secure QR Token
 * POST /api/bus-pass/verify-secure-qr
 */

import { getByUid, getCachedStudentAssignment } from '@/domains/student';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { decryptQRCodeData,quickValidateQRToken } from '@/lib/security/encryption.service';
import { checkRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import {
	resolveScannerBusId,
	scannerBusMatchesStudent,
	validateStudentScannerContext,
} from '@/lib/security/scanner-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations } from '@/lib/utils';
import { getValidUntilDate } from '@/lib/utils/date-utils';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyApiAuth(request, ['driver', 'admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        const rateLimitId = createRateLimitId(auth.uid, 'verify-secure-qr');
        const rateCheck = checkRateLimit(
            rateLimitId,
            RateLimits.BUS_PASS_VERIFY.maxRequests,
            RateLimits.BUS_PASS_VERIFY.windowMs
        );

        if (!rateCheck.allowed) {
            return NextResponse.json(
                {
                    status: 'rate_limited',
                    message: 'Too many scan requests. Please wait.',
                    resetIn: rateCheck.resetIn,
                },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { secureToken, scannerBusId: inputScannerBusId } = body;

        if (typeof secureToken !== 'string' || !secureToken.trim() || secureToken.length > 2048) {
            return NextResponse.json(
                { status: 'invalid', message: 'QR token is required' },
                { status: 400 }
            );
        }

        // 1. Resolve operating bus and active trip context with L1 15-second burst caching
        const {
            scannerBusId,
            activeTripId: resolvedActiveTripId,
            tripShift: resolvedTripShift,
            isTripStale: resolvedTripStale,
        } = await resolveScannerBusId(auth, inputScannerBusId);

        let activeTripId: string | null = resolvedActiveTripId;
        let isTripStale = resolvedTripStale;
        let tripShift: string | null = resolvedTripShift;

        const scannerDenied = await validateStudentScannerContext(auth, scannerBusId);
        if (scannerDenied) return scannerDenied;

        // Verify HMAC signature to prevent logging unreadable camera frames / noise
        if (!quickValidateQRToken(secureToken)) {
            return NextResponse.json({
                status: 'invalid',
                rejectionCode: 'INVALID_TOKEN',
                message: 'Invalid or tampered QR code',
                suspicious: true,
                canBoard: false,
                isAssigned: false,
                sessionActive: false,
            });
        }

        const qrPayload = decryptQRCodeData(secureToken);

        // Fetch active trip context for desk verification with specific bus if not resolved
        if (!activeTripId && scannerBusId && auth.role !== 'driver') {
            try {
                const supabase = getSupabaseServer();
                const busVariations = getBusIdVariations(scannerBusId);
                const { data: activeTrip } = await supabase
                    .from('active_trips')
                    .select('trip_id, status, created_at, shift')
                    .in('bus_id', busVariations)
                    .eq('status', 'active')
                    .gt('expires_at', new Date().toISOString())
                    .maybeSingle();

                if (activeTrip) {
                    const createdAt = new Date(activeTrip.created_at).getTime();
                    const isExpired = (Date.now() - createdAt) > 12 * 60 * 60 * 1000;
                    if (isExpired) {
                        isTripStale = true;
                    } else {
                        activeTripId = activeTrip.trip_id;
                        tripShift = activeTrip.shift || null;
                    }
                }
            } catch (e) {
                console.warn('Failed to verify active trip context:', e);
            }
        }

        if (!qrPayload) {
            return NextResponse.json({
                status: 'expired',
                rejectionCode: 'EXPIRED_PASS',
                message: 'QR code has expired. Please generate a new one.',
                isAssigned: false,
                sessionActive: false,
                canBoard: false,
                isTripStale
            });
        }

        // Check L1/L2 student assignment cache first for 0-DB-read burst scanning
        const cachedStudent = await getCachedStudentAssignment(qrPayload.uid);
        let studentData: Record<string, any> | null = null;

        if (cachedStudent) {
            studentData = {
                uid: cachedStudent.uid,
                fullName: cachedStudent.fullName,
                name: cachedStudent.fullName,
                enrollmentId: cachedStudent.enrollmentId,
                gender: cachedStudent.gender,
                profilePhotoUrl: cachedStudent.profilePhotoUrl,
                photoURL: cachedStudent.profilePhotoUrl,
                assignedBus: cachedStudent.busId,
                busId: cachedStudent.busId,
                currentBusId: cachedStudent.busId,
                routeId: cachedStudent.routeId,
                route_id: cachedStudent.routeId,
                assignedShift: cachedStudent.shift,
                shift: cachedStudent.shift,
                assignedStop: cachedStudent.stopName,
                stop_name: cachedStudent.stopName,
                status: cachedStudent.status,
                softBlock: cachedStudent.softBlock,
                validUntil: cachedStudent.validUntil,
                hardBlock: cachedStudent.hardBlock,
            };
        } else {
            studentData = await getByUid(qrPayload.uid) as Record<string, any> | null;
        }

        if (!studentData) {
            return NextResponse.json({
                status: 'invalid',
                rejectionCode: 'EXPIRED_PASS',
                message: 'Student not found. This QR code is not registered.',
                studentData: null,
                isAssigned: false,
                sessionActive: false,
                canBoard: false,
                isTripStale
            });
        }
        const validUntilDate = getValidUntilDate(studentData?.validUntil);
        const busId = studentData?.assignedBus || studentData?.busId || studentData?.currentBusId;
        const isDeskCheckpointMode = (auth.role === 'admin' || auth.role === 'moderator') && !inputScannerBusId;
        const busMatchesScanner = isDeskCheckpointMode ? true : scannerBusMatchesStudent(scannerBusId, busId);

        // CANONICAL entitlement (Phase 3) — same single source of truth as the
        // dashboard / tracking / QR display. Denies soft-blocked, past-soft-block,
        // renewal-applicant, and future students even with a valid signed token.
        const { entitled: accountValid, reason: entitlementReason } = getTransportEntitlement(studentData);

        const studentShiftRaw = String(studentData?.assignedShift || studentData?.shift || 'Morning');
        const studentShift = studentShiftRaw.toLowerCase();
        const tripShiftNorm = tripShift ? tripShift.toLowerCase() : null;
        const isShiftMismatch = isDeskCheckpointMode ? false : Boolean(tripShiftNorm && studentShift !== 'both' && studentShift !== tripShiftNorm);

        let rejectionCode: 'EXPIRED_PASS' | 'SOFT_BLOCKED' | 'WRONG_BUS' | 'SHIFT_MISMATCH' | null = null;

        if (studentData?.status === 'soft_blocked' || entitlementReason === 'past_soft_block') {
            rejectionCode = 'SOFT_BLOCKED';
        } else if (
            studentData?.status !== 'active' ||
            (validUntilDate && validUntilDate.getTime() < Date.now()) ||
            !accountValid
        ) {
            rejectionCode = 'EXPIRED_PASS';
        } else if (!busMatchesScanner) {
            rejectionCode = 'WRONG_BUS';
        } else if (isShiftMismatch) {
            rejectionCode = 'SHIFT_MISMATCH';
        }

        let status = 'success';
        let message = 'Student verified (Secure)';

        if (rejectionCode === 'SOFT_BLOCKED') {
            status = 'soft_blocked';
            message = 'Service expired — access to dashboard and live bus tracking restricted until renewal.';
        } else if (rejectionCode === 'EXPIRED_PASS') {
            status = 'session_expired';
            message = 'Transport pass has expired or is inactive. Boarding not permitted.';
        } else if (rejectionCode === 'WRONG_BUS') {
            status = 'bus_mismatch';
            message = 'Student is assigned to a different bus.';
        } else if (rejectionCode === 'SHIFT_MISMATCH') {
            status = 'shift_mismatch';
            message = `Student shift (${studentShiftRaw}) does not match active trip shift (${tripShift}).`;
        }

        return NextResponse.json({
            status,
            message,
            // PRIVACY-MINIMAL: Do not return phone, email, payment details, or admin notes.
            studentData: {
                uid: qrPayload.uid,
                fullName: studentData?.fullName || studentData?.name,
                enrollmentId: studentData?.enrollmentId || qrPayload.enrollmentId,
                gender: studentData?.gender,
                profilePhotoUrl: studentData?.profilePhotoUrl || studentData?.photoURL,
                assignedBus: busId,
                busId: busId,
                routeId: studentData?.routeId || studentData?.route_id || null,
                assignedShift: studentData?.assignedShift || studentData?.shift,
                shift: studentData?.assignedShift || studentData?.shift,
                validUntil: validUntilDate?.toISOString(),
                status: studentData?.status,
            },
            isAssigned: Boolean(busId),
            matchesScannerBus: busMatchesScanner,
            rejectionCode,
            canBoard: !rejectionCode,
            sessionActive: accountValid && !rejectionCode,
            entitlementReason,
            tokenInfo: {
                issuedAt: new Date(qrPayload.issuedAt).toISOString(),
                expiresAt: new Date(qrPayload.expiresAt).toISOString(),
                version: qrPayload.version,
            },
            verifiedAt: new Date().toISOString(),
            secureVerification: true,
            isTripStale
        });

    } catch (error: any) {
        console.error('Error in verify secure QR API:', error);
        return NextResponse.json(
            {
                status: 'invalid',
                message: 'Verification failed',
            },
            { status: 500 }
        );
    }
}
