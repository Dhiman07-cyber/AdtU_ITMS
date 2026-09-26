import { getDriverById, updateDriver } from '@/domains/identity';
import { withSecurity } from '@/lib/security/api-security';
import { invalidateCachedRole } from '@/lib/security/role-cache';
import { UIDSchema, validateInput } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const DriverStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'inactive']),
});

/**
 * PATCH /api/drivers/[id]/status
 * Update a driver's active/suspended status (admin only)
 */
export const PATCH = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/');
      // /api/drivers/[id]/status -> pathParts[length - 2] is [id]
      const id = pathParts[pathParts.length - 2];

      const uidValidation = validateInput(UIDSchema, id);
      if (!uidValidation.success) {
        return NextResponse.json({ error: 'Invalid driver ID' }, { status: 400 });
      }

      const bodyValidation = validateInput(DriverStatusSchema, body);
      if (!bodyValidation.success) {
        return NextResponse.json({ error: 'Invalid status. Must be active, suspended, or inactive' }, { status: 400 });
      }

      const existingDriver = await getDriverById(id);
      if (!existingDriver) {
        return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
      }

      const { status } = body as { status: 'active' | 'suspended' | 'inactive' };

      await updateDriver(id, {
        status,
        updatedAt: new Date().toISOString(),
      });

      invalidateCachedRole(id);

      console.log(`Driver ${id} status updated to ${status} by admin ${auth.uid}`);

      return NextResponse.json({
        success: true,
        status,
        message: `Driver status updated to ${status} successfully`,
      });
    } catch (error: any) {
      console.error('Error updating driver status:', error);
      return NextResponse.json({ error: 'Failed to update driver status' }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin'],
  }
);
