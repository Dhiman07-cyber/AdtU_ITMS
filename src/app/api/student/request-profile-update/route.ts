import { getById,update } from '@/domains/student';
import { db as adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RequestProfileUpdateSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

/**
 * POST /api/student/request-profile-update
 * 
 * Creates a profile update request from a student, to be approved by their bus driver.
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { newImageUrl, fullName } = body as any;
        const studentUid = auth.uid;

        // Check if the student record exists in PostgreSQL
        const student = await getById(studentUid);
        if (!student) {
            return NextResponse.json(
                { error: 'Student record not found' },
                { status: 404 }
            );
        }

        const currentImageUrl = student.profilePhotoUrl || '';
        const currentName = student.fullName || student.name || '';
        const busId = student.busId || student.busId || null;

        // Create a profile update request document
        const requestId = `profile_update_${studentUid}_${Date.now()}`;
        const requestData = {
            requestId,
            studentUid,
            studentName: currentName,
            currentImageUrl,
            newImageUrl,
            currentName,
            newName: fullName || currentName,
            busId, // Store the bus ID so drivers can filter requests
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save review request to Firestore (driver approval queue belongs to Driver domain)
        const requestRef = adminDb.collection('profile_update_requests').doc(requestId);
        await requestRef.set(requestData);

        // Update the student profile's pending flag in PostgreSQL
        await update(studentUid, {
            pendingProfileUpdate: requestId,
        });

        console.log(`Profile update request created for student ${studentUid}: ${requestId}`);

        return NextResponse.json({
            success: true,
            message: 'Profile update request sent to driver for approval',
            requestId
        });
    },
    {
        requiredRoles: ['student'],
        schema: RequestProfileUpdateSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);