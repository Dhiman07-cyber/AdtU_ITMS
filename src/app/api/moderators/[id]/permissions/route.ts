import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { adminDb } from '@/lib/firebase-admin';
import { UpdatePermissionsSchema, UIDSchema, validateInput } from '@/lib/security/validation-schemas';

/**
 * GET /api/moderators/[id]/permissions
 * Fetch a moderator's permissions
 */
export const GET = withSecurity(
    async (request, { auth, requestId }) => {
        try {
            const url = new URL(request.url);
            const pathParts = url.pathname.split('/');
            const id = pathParts[pathParts.length - 2];

            if (!adminDb) {
                return NextResponse.json({ error: 'Database not available' }, { status: 500 });
            }

            const uidValidation = validateInput(UIDSchema, id);
            if (!uidValidation.success) {
                return NextResponse.json({ error: 'Invalid moderator ID' }, { status: 400 });
            }

            const modDoc = await adminDb.collection('moderators').doc(id).get();
            if (!modDoc.exists) {
                return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
            }

            const modData = modDoc.data();
            return NextResponse.json({
                success: true,
                permissions: modData?.permissions || null,
                moderator: {
                    id: modDoc.id,
                    name: modData?.fullName || modData?.name || 'Unknown',
                    email: modData?.email || '',
                    employeeId: modData?.employeeId || modData?.empId || '',
                    status: modData?.status || 'active',
                },
            });
        } catch (error: any) {
            console.error('Error fetching moderator permissions:', error);
            return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
        }
    },
    {
        requiredRoles: ['admin'],
    }
);

/**
 * PUT /api/moderators/[id]/permissions
 * Update a moderator's permissions (admin only)
 */
export const PUT = withSecurity(
    async (request, { auth, body, requestId }) => {
        try {
            const url = new URL(request.url);
            const pathParts = url.pathname.split('/');
            const id = pathParts[pathParts.length - 2];

            if (!adminDb) {
                return NextResponse.json({ error: 'Database not available' }, { status: 500 });
            }

            const uidValidation = validateInput(UIDSchema, id);
            if (!uidValidation.success) {
                return NextResponse.json({ error: 'Invalid moderator ID' }, { status: 400 });
            }

            const modDoc = await adminDb.collection('moderators').doc(id).get();
            if (!modDoc.exists) {
                return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
            }

            const { permissions } = body as { permissions: Record<string, any> };

            await adminDb.collection('moderators').doc(id).update({
                permissions,
                permissionsUpdatedAt: new Date().toISOString(),
                permissionsUpdatedBy: auth.uid,
            });

            console.log(`Permissions updated for moderator ${id} by admin ${auth.uid}`);

            return NextResponse.json({
                success: true,
                message: 'Moderator permissions updated successfully',
            });
        } catch (error: any) {
            console.error('Error updating moderator permissions:', error);
            return NextResponse.json({ error: 'Failed to update permissions' }, { status: 500 });
        }
    },
    {
        requiredRoles: ['admin'],
        schema: UpdatePermissionsSchema,
    }
);
