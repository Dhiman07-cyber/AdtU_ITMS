import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { getUserById, updateUser } from '@/domains/identity';

/**
 * GET /api/auth/user
 *
 * Returns the current user's data from PostgreSQL.
 * Replaces client-side Firestore reads in auth-context.tsx and user-service.ts.
 */
export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const uid = auth.uid;

      const user = await getUserById(uid);

      if (!user) {
        return NextResponse.json({
          success: true,
          exists: false,
          message: 'User not found',
        });
      }

      // Update last_login_at in background asynchronously
      updateUser(uid, { lastLoginAt: new Date().toISOString() }).catch(() => {});

      return NextResponse.json({
        success: true,
        exists: true,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          ...user,
        },
      });
    } catch (error: any) {
      console.error('Error fetching user:', error);
      return NextResponse.json(
        { error: 'Failed to fetch user' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: [],
  }
);
