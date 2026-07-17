/**
 * POST /api/missed-bus/driver-response
 * 
 * Driver accepts or rejects a missed-bus pickup request.
 * 
 * Features:
 * - Atomic accept (first driver wins)
 * - Verifies driver has active trip
 * - Checks driver heartbeat freshness
 * - Validates driver is a candidate for the request
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { missedBusService } from '@/lib/services/missed-bus-service';
import { getDriverById } from '@/domains/identity';

export async function POST(request: Request) {
    const startTime = Date.now();

    try {
        const body = await request.json();
        const { idToken, requestId, decision } = body;

        // Validate required fields
        if (!idToken || !requestId || !decision) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Missing required fields',
                    required: ['idToken', 'requestId', 'decision']
                },
                { status: 400 }
            );
        }

        // Validate decision value
        if (decision !== 'accept' && decision !== 'reject') {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Invalid decision. Must be "accept" or "reject"'
                },
                { status: 400 }
            );
        }

        // Verify Firebase token
        const decodedToken = await auth.verifyIdToken(idToken);
        const driverId = decodedToken.uid;

        // SECURITY: Verify the caller is actually a driver.
        const driverData = await getDriverById(driverId);
        if (!driverData) {
            return NextResponse.json(
                { success: false, error: 'Only drivers can respond to missed-bus requests' },
                { status: 403 }
            );
        }

        // Call the service
        const result = await missedBusService.driverResponse({
            driverId,
            requestId,
            decision
        });

        // Log the operation
        const elapsed = Date.now() - startTime;
        console.log(`📝 Missed-bus driver-response completed in ${elapsed}ms:`, {
            driverId,
            requestId,
            decision,
            result: result.result
        });

        // Determine response status
        if (!result.success) {
            switch (result.result) {
                case 'not_active':
                    return NextResponse.json({
                        success: false,
                        result: 'not_active',
                        message: result.message
                    }, { status: 403 });

                case 'not_authorized':
                    return NextResponse.json({
                        success: false,
                        result: 'not_authorized',
                        message: result.message
                    }, { status: 403 });

                case 'already_handled':
                    return NextResponse.json({
                        success: false,
                        result: 'already_handled',
                        message: result.message
                    }, { status: 409 });

                default:
                    return NextResponse.json({
                        success: false,
                        error: result.message
                    }, { status: 500 });
            }
        }

        // Success
        return NextResponse.json({
            success: true,
            result: result.result,
            message: result.message
        });

    } catch (error: any) {
        console.error('❌ Error in missed-bus/driver-response:', error);

        // Check if it's an auth error
        if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
            return NextResponse.json(
                { success: false, error: 'Invalid or expired token' },
                { status: 401 }
            );
        }

        return NextResponse.json(
            {
                success: false,
                error: 'Internal server error'
            },
            { status: 500 }
        );
    }
}
