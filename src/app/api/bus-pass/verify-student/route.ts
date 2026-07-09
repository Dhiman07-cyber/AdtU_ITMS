/**
 * API Route: Verify Student by UID
 * POST /api/bus-pass/verify-student
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
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

        const rateLimitId = createRateLimitId(auth.uid, 'student-verify');
        const rateCheck = checkRateLimit(
            rateLimitId,
            RateLimits.BUS_PASS_VERIFY.maxRequests,
            RateLimits.BUS_PASS_VERIFY.windowMs
        );
        if (!rateCheck.allowed) {
            return NextResponse.json(
                { status: 'rate_limited', message: 'Too many scan requests. Please wait.' },
                { status: 429 }
            );
        }

        const body = await request.json();
        const { studentUid, scannerBusId } = body;

        // Basic Client-side Validation (prevent noise)
        if (typeof studentUid !== 'string' || !studentUid.trim() || studentUid.length < 5 || studentUid.length > 128 || studentUid.includes('http')) {
            return NextResponse.json(
                { status: 'invalid', message: 'Invalid Student ID format' },
                { status: 400 }
            );
        }

        const scannerDenied = await validateStudentScannerContext(auth, scannerBusId);
        if (scannerDenied) return scannerDenied;

        let studentData: any = null;
        try {
            studentData = await getByUid(studentUid.trim()) as Record<string, any> | null;
        } catch {
            return NextResponse.json({
                status: 'invalid',
                message: 'Invalid Student ID format',
                studentData: null,
                isAssigned: false,
                sessionActive: false,
            }, { status: 400 });
        }

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

        const validUntilDate = getValidUntilDate(studentData.validUntil);
        const assignedBusId = studentData.assignedBus || studentData.busId || studentData.currentBusId;
        const busMatchesScanner = scannerBusMatchesStudent(scannerBusId, assignedBusId);

        // CANONICAL entitlement (Phase 3): a pass is valid for boarding ONLY while the
        // student owns transport access. This is the SAME source of truth used by the
        // dashboard, tracking, and QR display — soft-blocked / past-soft-block /
        // renewal-applicant / future students are all denied here, regardless of a
        // previously-saved (static) QR. Identity is still returned so the scanner can
        // show who scanned and why boarding is denied.
        const { entitled: accountValid, reason: entitlementReason } = getTransportEntitlement(studentData);

        let status = accountValid ? 'success' : 'session_expired';
        let message = accountValid ? 'Student verified' : 'Transport access inactive — boarding not permitted';
        if (accountValid && !busMatchesScanner) {
            status = 'bus_mismatch';
            message = 'Student is assigned to a different bus';
        }

        return NextResponse.json({
            status,
            message,
            // PRIVACY-MINIMAL: Do not return phone, email, payment details, or admin notes.
            studentData: {
                uid: studentUid.trim(),
                fullName: studentData.fullName || studentData.name,
                enrollmentId: studentData.enrollmentId || studentData.enrollmentNo,
                gender: studentData.gender,
                profilePhotoUrl: studentData.profilePhotoUrl || studentData.photoURL || studentData.avatar,
                assignedBus: assignedBusId,
                busId: assignedBusId,
                assignedShift: studentData.assignedShift || studentData.shift,
                shift: studentData.assignedShift || studentData.shift,
                validUntil: validUntilDate ? validUntilDate.toISOString() : undefined,
                status: studentData.status,
            },
            isAssigned: Boolean(assignedBusId),
            matchesScannerBus: busMatchesScanner,
            canBoard: accountValid && busMatchesScanner,
            sessionActive: accountValid,
            entitlementReason,
            verifiedAt: new Date().toISOString(),
            verifiedBy: auth.uid,
            isTripStale
        });

    } catch (error: any) {
        console.error('Error in verify student API:', error);
        return NextResponse.json(
            {
                status: 'invalid',
                message: 'Internal server error',
            },
            { status: 500 }
        );
    }
}
