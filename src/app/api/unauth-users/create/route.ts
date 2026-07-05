import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Create or update an unauthenticated user entry
 * This is called when a new user signs in with Google but doesn't have a user doc yet
 */
export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      if (!adminDb) {
        return NextResponse.json({ error: 'Database not available' }, { status: 500 });
      }

      const uid = auth.uid;
      const email = auth.email;

      if (!email) {
        return NextResponse.json({ error: 'Email not found in token' }, { status: 400 });
      }

      // Check if user already exists in users collection
      const userDoc = await adminDb.collection('users').doc(uid).get();

      if (userDoc.exists) {
        return NextResponse.json({
          success: false,
          message: 'User already exists in users collection',
          hasUserDoc: true
        });
      }

      // Check if user already exists in unauthUsers collection
      const unauthUserDoc = await adminDb.collection('unauthUsers').doc(uid).get();

      const now = new Date().toISOString();

      if (unauthUserDoc.exists) {
        await adminDb.collection('unauthUsers').doc(uid).update({
          lastLoginAt: now
        });

        return NextResponse.json({
          success: true,
          message: 'Unauthenticated user record updated',
          isNewUser: false
        });
      }

      // Create new unauthUser document
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

      await adminDb.collection('unauthUsers').doc(uid).set(unauthUserData);

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
