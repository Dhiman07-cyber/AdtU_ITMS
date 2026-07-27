/**
 * POST /api/update-profile-photo — Update User Profile Photo
 * ───────────────────────────────────────────────────────────
 * Updates the profilePhotoUrl in PostgreSQL (canonical) and deletes the old Cloudinary
 * image via the SDK.
 *
 * SECURITY HARDENING (March 2026):
 *  - Uses centralised cloudinary-server module (no more duplicate config)
 *  - Deletes old images via SDK (no api_secret in form data)
 *  - Rate-limited via withSecurity
 *  - Input validation on targetType and URL format
 */

import {
	getDriverById,
	getModeratorById,
	getStudentById,
	updateDriver,
	updateModerator,
	updateStudent
} from '@/domains/identity';
import { deleteAsset,extractPublicId } from '@/lib/cloudinary-server';
import { withSecurity } from '@/lib/security/api-security';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const UpdateProfilePhotoSchema = z.object({
    targetType: z.enum(['student', 'driver', 'moderator']),
    targetId: z.string().min(1).max(128),
    newImageUrl: z.string().url().max(2000).refine(
        (url) => url.startsWith('https://') || url.startsWith('http://localhost'),
        'Image URL must use HTTPS'
    ),
    oldImageUrl: z.string().url().max(2000).optional(),
});

export const POST = withSecurity(
    async (request, { auth, body, requestId }) => {
        try {
            const { targetType, targetId, newImageUrl, oldImageUrl } = body as z.infer<typeof UpdateProfilePhotoSchema>;
            const requesterUid = auth.uid;
            const requesterRole = auth.role;

            let isAuthorized = false;
            if (requesterRole === 'admin') {
                isAuthorized = true;
            } else if (requesterRole === 'moderator') {
                isAuthorized = ['student', 'driver'].includes(targetType) || (targetType === 'moderator' && targetId === requesterUid);
            } else if (requesterRole === 'driver' && targetType === 'driver' && targetId === requesterUid) {
                isAuthorized = true;
            }

            if (!isAuthorized) {
                return NextResponse.json({ success: false, error: 'Unauthorized to update this profile' }, { status: 403 });
            }

            // Fetch target details from PostgreSQL (canonical source of truth)
            let currentData: any = null;
            if (targetType === 'student') {
                currentData = await getStudentById(targetId);
            } else if (targetType === 'driver') {
                currentData = await getDriverById(targetId);
            } else if (targetType === 'moderator') {
                currentData = await getModeratorById(targetId);
            }

            if (!currentData) {
                return NextResponse.json({ success: false, error: `${targetType} not found` }, { status: 404 });
            }

            const currentImageUrl = oldImageUrl || currentData.profilePhotoUrl;

            // Delete old Cloudinary image via SDK
            if (currentImageUrl && currentImageUrl !== newImageUrl) {
                const publicId = extractPublicId(currentImageUrl);
                if (publicId) {
                    await deleteAsset(publicId);
                }
            }

            // Update PostgreSQL (canonical source of truth)
            if (targetType === 'student') {
                await updateStudent(targetId, { profilePhotoUrl: newImageUrl });
            } else if (targetType === 'driver') {
                await updateDriver(targetId, { profilePhotoUrl: newImageUrl });
            } else if (targetType === 'moderator') {
                await updateModerator(targetId, { profilePhotoUrl: newImageUrl });
            }

            return NextResponse.json({
                success: true,
                message: 'Profile photo updated successfully',
            });
        } catch (error: any) {
            console.error('Error updating profile photo:', error);
            return NextResponse.json({ success: false, error: 'Failed to update profile photo' }, { status: 500 });
        }
    },
    {
        requiredRoles: ['admin', 'moderator', 'driver'],
        schema: UpdateProfilePhotoSchema,
        rateLimit: { maxRequests: 5, windowMs: 60_000 },
    }
);
