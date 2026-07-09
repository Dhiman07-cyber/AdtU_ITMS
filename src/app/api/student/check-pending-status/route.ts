import { NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { CheckPendingStatusSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { update } from '@/domains/student';

/**
 * POST /api/student/check-pending-status
 * 
 * Checks the status of a pending profile update request and cleans up
 * the student record if the request is resolved.
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { requestId } = body as any;
        const studentUid = auth.uid;

        // Check the request document in Firestore (profile_update_requests belongs to Driver review domain)
        const requestDoc = await adminDb.collection('profile_update_requests').doc(requestId).get();

        if (!requestDoc.exists) {
            // Request doesn't exist - clean up stale reference from student in PostgreSQL
            await update(studentUid, { pendingProfileUpdate: null });

            return NextResponse.json({
                success: true,
                exists: false,
                status: null,
                cleaned: true
            });
        }

        const requestData = requestDoc.data();

        // If request exists but is not pending (approved/rejected), clean up in PostgreSQL
        if (requestData.status !== 'pending') {
            await update(studentUid, { pendingProfileUpdate: null });

            return NextResponse.json({
                success: true,
                exists: true,
                status: requestData.status,
                cleaned: true
            });
        }

        // Request exists and is pending
        return NextResponse.json({
            success: true,
            exists: true,
            status: 'pending',
            cleaned: false
        });
    },
    {
        requiredRoles: ['student'],
        schema: CheckPendingStatusSchema,
        rateLimit: RateLimits.READ,
        allowBodyToken: true
    }
);
