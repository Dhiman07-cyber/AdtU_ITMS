import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { createUnauthUser, getUnauthUserById, getUserById, updateUnauthUser } from '@/domains/identity';

/**
 * Create or update an unauthenticated user entry
 * This is called when a new user signs in with Google but doesn't have a user doc yet
 */
export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const uid = auth.uid;
      const email = auth.email;

      if (!email) {
        return NextResponse.json({ error: 'Email not found in token' }, { status: 400 });
      }

      const existingUser = await getUserById(uid);
      if (existingUser) {
        return NextResponse.json({
          success: false,
          message: 'User already exists in users table',
          hasUserDoc: true
        });
      }

      const existingPgUser = await getUnauthUserById(uid);
      if (existingPgUser) {
        // Existing row: bump last_login_at (an insert here PK-violates)
        await updateUnauthUser(uid, { lastLoginAt: new Date().toISOString() });

        return NextResponse.json({
          success: true,
          message: 'Unauthenticated user record updated',
          isNewUser: false
        });
      }

      const now = new Date().toISOString();
      const unauthUserData = {
        uid,
        email,
        displayName: auth.name || email.split('@')[0],
        photoURL: null,
        createdAt: now,
        lastLoginAt: now,
        status: 'pending_application',
        needsApplication: true
      };

      await createUnauthUser(unauthUserData);

      return NextResponse.json({
        success: true,
        message: 'Unauthenticated user created',
        isNewUser: true
      });
    } catch (error: any) {
      console.error('Error creating unauthenticated user:', error);
      return NextResponse.json(
        { error: 'Failed to create unauthenticated user' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: [],
    rateLimit: { maxRequests: 5, windowMs: 60_000 },
  }
);
