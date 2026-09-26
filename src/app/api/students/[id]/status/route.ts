import { getById, update } from '@/domains/student';
import { withSecurity } from '@/lib/security/api-security';
import { invalidateCachedRole } from '@/lib/security/role-cache';
import { UIDSchema, validateInput } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const StudentStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'inactive', 'soft_blocked', 'expired']),
});

/**
 * PATCH /api/students/[id]/status
 * Update a student's active/suspended status (admin only)
 */
export const PATCH = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/');
      // /api/students/[id]/status -> pathParts[length - 2] is [id]
      const id = pathParts[pathParts.length - 2];

      const uidValidation = validateInput(UIDSchema, id);
      if (!uidValidation.success) {
        return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
      }

      const bodyValidation = validateInput(StudentStatusSchema, body);
      if (!bodyValidation.success) {
        return NextResponse.json({ error: 'Invalid status provided' }, { status: 400 });
      }

      const existingStudent = await getById(id);
      if (!existingStudent) {
        return NextResponse.json({ error: 'Student not found' }, { status: 404 });
      }

      const { status } = body as { status: string };

      await update(id, {
        status: status as any,
        updatedAt: new Date().toISOString(),
      });

      invalidateCachedRole(id);

      console.log(`Student ${id} status updated to ${status} by admin ${auth.uid}`);

      return NextResponse.json({
        success: true,
        status,
        message: `Student status updated to ${status} successfully`,
      });
    } catch (error: any) {
      console.error('Error updating student status:', error);
      return NextResponse.json({ error: 'Failed to update student status' }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin'],
  }
);
