/**
 * Payment Details API Route
 * 
 * GET /api/payments/[paymentId]
 * Returns detailed payment information for the modal view.
 * 
 * Authentication: Required (Admin, Moderator, or owning Student)
 */

import { getUserById } from '@/domains/identity';
import { verifyToken } from '@/lib/firebase-admin';
import { getPaymentDetails } from '@/lib/payment/payment.service';
import { NextRequest,NextResponse } from 'next/server';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ paymentId: string }> }
) {
    try {
        // Verify authentication
        const token = request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const decodedToken = await verifyToken(token);
        const userId = decodedToken.uid;

        // Get user data via Identity domain API
        const user = await getUserById(userId);
        const userData = user as any;

        if (!userData) {
            return NextResponse.json(
                { success: false, error: 'User not found' },
                { status: 404 }
            );
        }

        const { paymentId } = await params;

        if (!paymentId) {
            return NextResponse.json(
                { success: false, error: 'Payment ID is required' },
                { status: 400 }
            );
        }

        // Fetch payment details
        const details = await getPaymentDetails(paymentId);

        if (!details) {
            return NextResponse.json(
                { success: false, error: 'Payment not found' },
                { status: 404 }
            );
        }

        // Authorization check: Students can only view their own payments
        if (userData.role === 'student' && details.studentUid !== userId) {
            return NextResponse.json(
                { success: false, error: 'Access denied' },
                { status: 403 }
            );
        }

        // Serialize dates to ISO strings for JSON response
        const serializedDetails = {
            ...details,
            validUntil: details.validUntil.toISOString(),
            createdAt: details.createdAt.toISOString(),
            updatedAt: details.updatedAt.toISOString(),
            approver: details.approver ? {
                ...details.approver,
                approvedAt: details.approver.approvedAt.toISOString()
            } : undefined
        };

        return NextResponse.json({
            success: true,
            data: serializedDetails
        });

    } catch (error) {
        console.error('Error fetching payment details:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch payment details'
            },
            { status: 500 }
        );
    }
}
