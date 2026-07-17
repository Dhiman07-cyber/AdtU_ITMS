import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { readFeedback, updateFeedback } from '@/lib/feedback-utils';

/**
 * PATCH /api/feedback/:id/mark-forwarded
 * Mark feedback as forwarded (admin & moderator only)
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> | { id: string } }
) {
    try {
        // Properly await params if it's a promise
        const resolvedParams = params instanceof Promise ? await params : params;
        const feedbackId = resolvedParams.id;

        // Get token from Authorization header
        const authHeader = request.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 }
            );
        }

        const token = authHeader.substring(7);

        // Verify Firebase ID token
        let decodedToken;
        try {
            decodedToken = await auth.verifyIdToken(token);
        } catch (error) {
            return NextResponse.json(
                { error: 'Invalid authentication token' },
                { status: 401 }
            );
        }

        const userId = decodedToken.uid;

        // Get user role
        const userRole = await resolveUserRole(userId);
        if (userRole.role !== 'admin' && userRole.role !== 'moderator') {
            return NextResponse.json(
                { error: 'Access denied. Admin or Moderator role required.' },
                { status: 403 }
            );
        }

        // Read feedback to verify existence
        const entries = await readFeedback();
        const entry = entries.find(e => e.id === feedbackId);

        if (!entry) {
            return NextResponse.json(
                { error: 'Feedback not found' },
                { status: 404 }
            );
        }

        // Mark as forwarded
        await updateFeedback(feedbackId, { forwarded: true });

        console.log('📨 Feedback marked as forwarded:', {
            id: feedbackId,
            forwarded_by: userId
        });

        return NextResponse.json({
            success: true,
            message: 'Feedback marked as forwarded'
        });

    } catch (error: any) {
        console.error('❌ Error marking feedback as forwarded:', error);
        return NextResponse.json(
            { error: 'Failed to mark feedback as forwarded' },
            { status: 500 }
        );
    }
}
