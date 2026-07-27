/**
 * API Route: Generate Secure QR Token
 * POST /api/bus-pass/generate-secure-qr
 * 
 * Generates an encrypted, time-limited QR token for student verification.
 * 
 * SECURITY FEATURES:
 * - AES-256-GCM encrypted payload
 * - HMAC signature for integrity
 * - Time-limited tokens (24 hours)
 * - Rate limiting
 * - Authentication required
 */

import { NextRequest, NextResponse } from 'next/server';
import { encryptQRCodeData } from '@/lib/security/encryption.service';
import { checkRateLimit, RateLimits, createRateLimitId } from '@/lib/security/rate-limiter';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { getByUid } from '@/domains/student';

export async function POST(request: NextRequest) {
    try {
        const auth = await verifyApiAuth(request, ['student', 'admin', 'moderator']);
        if (!auth.authenticated) return auth.response;

        // Rate limiting
        const rateLimitId = createRateLimitId(auth.uid, 'generate-qr');
        const rateCheck = checkRateLimit(
            rateLimitId,
            RateLimits.BUS_PASS_GENERATE.maxRequests,
            RateLimits.BUS_PASS_GENERATE.windowMs
        );

        if (!rateCheck.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Too many QR generation requests. Please wait.',
                    resetIn: rateCheck.resetIn
                },
                { status: 429 }
            );
        }

        // Parse request body
        const body = await request.json();
        const { studentUid } = body;

        // Security: Only allow generating QR for self or if admin/moderator
        const targetUid = typeof studentUid === 'string' && studentUid.trim()
            ? studentUid.trim()
            : auth.uid;

        if (targetUid.length > 128) {
            return NextResponse.json(
                { success: false, error: 'Invalid student UID' },
                { status: 400 }
            );
        }

        if (targetUid !== auth.uid && auth.role === 'moderator') {
            const permissionDenied = await requireModeratorPermission(auth, 'students', 'canView');
            if (permissionDenied) return permissionDenied;
        } else if (targetUid !== auth.uid && auth.role !== 'admin') {
            return NextResponse.json(
                { success: false, error: 'Unauthorized to generate QR for other users' },
                { status: 403 }
            );
        }

        // Fetch student data from PostgreSQL
        const studentData = await getByUid(targetUid) as Record<string, any> | null;

        if (!studentData) {
            return NextResponse.json(
                { success: false, error: 'Student not found' },
                { status: 404 }
            );
        }

        // CANONICAL entitlement (Phase 3): a QR may be generated ONLY while the
        // student currently owns transport access. Same single source of truth as
        // the verify endpoints and the in-app QR display.
        const entitlement = getTransportEntitlement(studentData);
        if (!entitlement.entitled) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Transport access is not active. Please renew your service to use your bus pass.',
                    reason: entitlement.reason,
                },
                { status: 403 }
            );
        }

        // Generate encrypted QR token
        const secureToken = encryptQRCodeData(targetUid, {
            enrollmentId: studentData?.enrollmentId,
            name: studentData?.fullName || studentData?.name,
            busId: studentData?.busId || studentData?.busId
        });

        return NextResponse.json({
            success: true,
            token: secureToken,
            expiresIn: 24 * 60 * 60 * 1000, // 24 hours in ms
            studentInfo: {
                name: studentData?.fullName || studentData?.name,
                enrollmentId: studentData?.enrollmentId,
                validUntil: studentData?.validUntil?.toDate
                    ? studentData.validUntil.toDate().toISOString()
                    : (studentData?.validUntil ? new Date(studentData.validUntil).toISOString() : undefined)
            }
        });

    } catch (error: any) {
        console.error('Error generating secure QR:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to generate QR code' },
            { status: 500 }
        );
    }
}
