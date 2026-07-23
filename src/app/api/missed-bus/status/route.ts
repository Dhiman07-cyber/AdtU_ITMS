// @ts-nocheck
/**
 * GET /api/missed-bus/status
 * 
 * Get the current missed-bus request status for a student.
 * Used to show if the student has an active request and its status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { missedBusService, MESSAGES } from '@/lib/services/missed-bus-service';

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
        const studentId = decodedToken.uid;

        // Get student's current request status
        const requestStatus = await missedBusService.getStatus(studentId);

        if (!requestStatus) {
            return NextResponse.json({
                success: true,
                hasActiveRequest: false,
                request: null
            });
        }

        // Determine the message to show based on status
        let statusMessage = '';
        switch (requestStatus.status) {
            case 'pending':
                statusMessage = MESSAGES.REQUEST_PENDING;
                break;
            case 'approved':
                // Try to get bus info from trip_candidates
                const candidates = requestStatus.trip_candidates || [];
                const acceptedCandidate = candidates.find(
                    (c: any) => c.tripId === requestStatus.candidate_trip_id
                );
                statusMessage = acceptedCandidate
                    ? MESSAGES.REQUEST_ACCEPTED(acceptedCandidate.busId, requestStatus.stop_name)
                    : 'Your pickup request has been accepted.';
                break;
        }

        return NextResponse.json({
            success: true,
            hasActiveRequest: true,
            request: {
                id: requestStatus.id,
                status: requestStatus.status,
                routeId: requestStatus.route_id,
                stop_name: requestStatus.stop_name,
                candidateTripId: requestStatus.candidate_trip_id,
                createdAt: requestStatus.created_at,
                expiresAt: requestStatus.expires_at,
                message: statusMessage
            }
        });

    } catch (error: any) {
        console.error('❌ Error in missed-bus/status:', error);

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
