import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { adminDb } from '@/lib/firebase-admin';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { UidOnlySchema } from '@/lib/security/validation-schemas';

export const DELETE = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const { uid } = body as { uid: string };

      if (!adminDb) {
        return NextResponse.json({ success: false, error: 'Database not available' }, { status: 500 });
      }

      // Get the target user to determine type and prevent admin deletion
      const targetDoc = await adminDb.collection('users').doc(uid).get();
      if (!targetDoc.exists) {
        return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
      }

      const targetData = targetDoc.data();
      if (targetData.role === 'admin') {
        return NextResponse.json({ success: false, error: 'Cannot delete admin users' }, { status: 403 });
      }

      const userType = targetData.role as 'student' | 'driver' | 'moderator';
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
