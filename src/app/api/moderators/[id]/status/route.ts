import { getModeratorById, updateModerator } from '@/domains/identity';
import { withSecurity } from '@/lib/security/api-security';
import { invalidateModeratorPermissionCache } from '@/lib/security/moderator-permissions';
import { invalidateCachedRole } from '@/lib/security/role-cache';
import { UIDSchema, validateInput } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ModeratorStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'inactive']),
});

/**
 * PATCH /api/moderators/[id]/status
 * Update a moderator's active/suspended status (admin only)
 */
export const PATCH = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/');
      // /api/moderators/[id]/status -> pathParts[length - 2] is [id]
      const id = pathParts[pathParts.length - 2];

      const uidValidation = validateInput(UIDSchema, id);
      if (!uidValidation.success) {
        return NextResponse.json({ error: 'Invalid moderator ID' }, { status: 400 });
      }

      const bodyValidation = validateInput(ModeratorStatusSchema, body);
      if (!bodyValidation.success) {
        return NextResponse.json({ error: 'Invalid status. Must be active, suspended, or inactive' }, { status: 400 });
      }

      const existingMod = await getModeratorById(id);
      if (!existingMod) {
        return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
      }

      const { status } = body as { status: 'active' | 'suspended' | 'inactive' };

      await updateModerator(id, {
        status,
        updatedAt: new Date().toISOString(),
      });

      invalidateCachedRole(id);
      invalidateModeratorPermissionCache(id);

      console.log(`Moderator ${id} status updated to ${status} by admin ${auth.uid}`);

      return NextResponse.json({
        success: true,
        status,
        message: `Moderator status updated to ${status} successfully`,
      });
    } catch (error: any) {
      console.error('Error updating moderator status:', error);
      return NextResponse.json({ error: 'Failed to update moderator status' }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin'],
  }
);
