/**
 * API Route: Verify Secure QR Token
 * POST /api/bus-pass/verify-secure-qr
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { decryptQRCodeData, quickValidateQRToken } from '@/lib/security/encryption.service';
import { checkRateLimit, RateLimits, createRateLimitId } from '@/lib/security/rate-limiter';
import { verifyApiAuth } from '@/lib/security/api-auth';
import {
    scannerBusMatchesStudent,
    validateStudentScannerContext,
} from '@/lib/security/scanner-auth';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { getByUid } from '@/domains/student';

function getValidUntilDate(validUntil: unknown): Date | null {
    if (!validUntil) return null;
    try {
        if (
            typeof validUntil === 'object' &&
            validUntil !== null &&
            'toDate' in validUntil &&
            typeof validUntil.toDate === 'function'
        ) {
            return validUntil.toDate();
        }
        if (validUntil instanceof Date) return validUntil;

        const date = new Date(String(validUntil));
        return Number.isNaN(date.getTime()) ? null : date;
    } catch {
        return null;
    }
}

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
        const { secureToken, scannerBusId } = body;

        if (typeof secureToken !== 'string' || !secureToken.trim() || secureToken.length > 2048) {
            return NextResponse.json(
                { status: 'invalid', message: 'QR token is required' },
                { status: 400 }
            );
        }

        const scannerDenied = await validateStudentScannerContext(auth, scannerBusId);
        if (scannerDenied) return scannerDenied;

        // Verify HMAC signature to prevent logging unreadable camera frames / noise
        if (!quickValidateQRToken(secureToken)) {
            return NextResponse.json({
                status: 'invalid',
                message: 'Invalid or tampered QR code',
                suspicious: true,
            });
        }

        const qrPayload = decryptQRCodeData(secureToken);

        // 1. Fetch activeTripId from buses collection and verify consistency
        let activeTripId: string | null = null;
        let isTripStale = false;
        try {
            const busDoc = await adminDb.collection('buses').doc(scannerBusId).get();
            if (busDoc.exists) {
                const busData = busDoc.data();
                const possibleTripId = busData?.activeTripId;
                if (possibleTripId) {
                    const tripDoc = await adminDb.collection('trip_sessions').doc(possibleTripId).get();
                    if (tripDoc.exists) {
                        const tripData = tripDoc.data();
                        const isExpired = tripData?.status !== 'active' ||
                            (tripData?.createdAt && (Date.now() - tripData.createdAt.toDate().getTime() > 12 * 60 * 60 * 1000));
                        if (isExpired) {
                            isTripStale = true;
                        } else {
                            activeTripId = possibleTripId;
                        }
                    } else {
                        isTripStale = true;
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to verify active trip context:', e);
        }

        if (!qrPayload) {
            return NextResponse.json({
                status: 'expired',
                message: 'QR code has expired. Please generate a new one.',
                isAssigned: false,
                sessionActive: false,
                isTripStale
            });
        }

        const studentData = await getByUid(qrPayload.uid) as Record<string, any> | null;
        if (!studentData) {
            return NextResponse.json({
                status: 'invalid',
                message: 'Student not found. This QR code is not registered.',
                studentData: null,
                isAssigned: false,
                sessionActive: false,
                isTripStale
            });
        }
        const validUntilDate = getValidUntilDate(studentData?.validUntil);
        const assignedBusId = studentData?.assignedBus || studentData?.busId || studentData?.currentBusId;
        const busMatchesScanner = scannerBusMatchesStudent(scannerBusId, assignedBusId);

        // CANONICAL entitlement (Phase 3) — same single source of truth as the
        // dashboard / tracking / QR display. Denies soft-blocked, past-soft-block,
        // renewal-applicant, and future students even with a valid signed token.
        const { entitled: accountValid, reason: entitlementReason } = getTransportEntitlement(studentData);

        let status = accountValid ? 'success' : 'session_expired';
        let message = accountValid ? 'Student verified (Secure)' : 'Transport access inactive — boarding not permitted';
        if (accountValid && !busMatchesScanner) {
            status = 'bus_mismatch';
            message = 'Student is assigned to a different bus';
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
                assignedBus: assignedBusId,
                busId: assignedBusId,
                assignedShift: studentData?.assignedShift || studentData?.shift,
                shift: studentData?.assignedShift || studentData?.shift,
                validUntil: validUntilDate?.toISOString(),
                status: studentData?.status,
            },
            isAssigned: Boolean(assignedBusId),
            matchesScannerBus: busMatchesScanner,
            canBoard: accountValid && busMatchesScanner,
            sessionActive: accountValid,
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
