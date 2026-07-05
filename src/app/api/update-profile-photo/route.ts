/**
 * POST /api/update-profile-photo — Update User Profile Photo
 * ───────────────────────────────────────────────────────────
 * Updates the profilePhotoUrl in Firestore and deletes the old Cloudinary
 * image via the SDK.
 *
 * SECURITY HARDENING (March 2026):
 *  - Uses centralised cloudinary-server module (no more duplicate config)
 *  - Deletes old images via SDK (no api_secret in form data)
 *  - Rate-limited via withSecurity
 *  - Input validation on targetType and URL format
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { withSecurity } from '@/lib/security/api-security';
import { extractPublicId, deleteAsset } from '@/lib/cloudinary-server';
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

            // Authorization check
            const { adminDb } = await import('@/lib/firebase-admin');
            if (!adminDb) {
                return NextResponse.json({ success: false, error: 'Server SDK not available' }, { status: 500 });
            }

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

            const collectionName = targetType === 'student' ? 'students' : targetType === 'driver' ? 'drivers' : 'moderators';
            const targetDoc = await adminDb.collection(collectionName).doc(targetId).get();
            if (!targetDoc.exists) {
                return NextResponse.json({ success: false, error: `${targetType} not found` }, { status: 404 });
            }

            const currentData = targetDoc.data();
            const currentImageUrl = oldImageUrl || currentData?.profilePhotoUrl;

            // Delete old Cloudinary image via SDK
            if (currentImageUrl && currentImageUrl !== newImageUrl) {
                const publicId = extractPublicId(currentImageUrl);
                if (publicId) {
                    await deleteAsset(publicId);
                }
            }

            // Update Firestore
            await adminDb.collection(collectionName).doc(targetId).update({
                profilePhotoUrl: newImageUrl,
                updatedAt: FieldValue.serverTimestamp(),
            });

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
