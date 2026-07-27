import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { UpdatePermissionsSchema, UIDSchema, validateInput } from '@/lib/security/validation-schemas';
import { updateModeratorPermissions, getModeratorById } from '@/domains/identity';

/**
 * GET /api/moderators/[id]/permissions
 * Fetch a moderator's permissions (reads from PostgreSQL)
 */
export const GET = withSecurity(
    async (request, { auth, requestId }) => {
        try {
            const url = new URL(request.url);
            const pathParts = url.pathname.split('/');
            const id = pathParts[pathParts.length - 2];

            const uidValidation = validateInput(UIDSchema, id);
            if (!uidValidation.success) {
                return NextResponse.json({ error: 'Invalid moderator ID' }, { status: 400 });
            }

            const modData = await getModeratorById(id);

            if (!modData) {
                return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
            }

            return NextResponse.json({
                success: true,
                permissions: modData.permissions || null,
                moderator: {
                    id,
                    name: modData.fullName || modData.name || 'Unknown',
                    email: modData.email || '',
                    employeeId: modData.employeeId || modData.empId || '',
                    status: modData.status || 'active',
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

            const uidValidation = validateInput(UIDSchema, id);
            if (!uidValidation.success) {
                return NextResponse.json({ error: 'Invalid moderator ID' }, { status: 400 });
            }

            const existingMod = await getModeratorById(id);
            if (!existingMod) {
                return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
            }

            const { permissions } = body as { permissions: Record<string, any> };

            await updateModeratorPermissions(id, permissions as any, auth.uid);

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
