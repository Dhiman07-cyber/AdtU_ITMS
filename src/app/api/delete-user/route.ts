import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { UidOnlySchema } from '@/lib/security/validation-schemas';
import { getUserById } from '@/domains/identity';

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
    requiredRoles: ['admin'],
    schema: UidOnlySchema,
  }
);
