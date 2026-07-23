// @ts-nocheck
/**
 * GET /api/missed-bus/driver-requests
 * 
 * Get pending missed-bus requests for the current driver's active trip.
 * Drivers poll this to see new pickup requests they can accept.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { missedBusService } from '@/lib/services/missed-bus-service';

export async function GET(request: NextRequest) {
    try {
        // Get token from Authorization header
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { success: false, error: 'Missing authorization header' },
                { status: 401 }
            );
        }

        const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify Firebase token
        const decodedToken = await auth.verifyIdToken(idToken);
        const driverId = decodedToken.uid;

        // Get pending requests for this driver
        const requests = await missedBusService.getPendingRequestsForDriver(driverId);

        return NextResponse.json({
            success: true,
            requests: requests.map(req => ({
                id: req.id,
                studentId: req.student_id,
                routeId: req.route_id,
                stop_name: req.stop_name,
                studentSequence: req.student_sequence,
                createdAt: req.created_at,
                expiresAt: req.expires_at
            }))
        });

    } catch (error: any) {
        console.error('❌ Error in missed-bus/driver-requests:', error);

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
