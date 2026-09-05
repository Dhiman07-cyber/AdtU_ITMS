import { getUserById } from '@/domains/identity';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { UidOnlySchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const DELETE = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const { uid } = body as { uid: string };

      const targetUser = await getUserById(uid);
      if (!targetUser) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }

      if (targetUser.role === 'admin') {
        return NextResponse.json({ success: false, error: 'Cannot delete admin users' }, { status: 403 });
      }

      if (auth.role === 'moderator') {
        if (targetUser.role !== 'student') {
          return NextResponse.json({ success: false, error: 'Moderators can only delete student accounts' }, { status: 403 });
        }
        const permissionDenied = await requireModeratorPermission(auth, 'students', 'canDelete');
        if (permissionDenied) return permissionDenied;
      }

      const userType = targetUser.role as 'student' | 'driver' | 'moderator';
      const result = await deleteUserAndData(uid, userType);

      if (!result.success) {
        return NextResponse.json({ success: false, error: result.error || 'Failed to delete user' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'User and all associated data deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      return NextResponse.json({ success: false, error: 'Failed to delete user' }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    schema: UidOnlySchema,
  }
);
