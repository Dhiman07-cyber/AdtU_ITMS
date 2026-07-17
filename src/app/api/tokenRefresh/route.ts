/**
 * POST /api/tokenRefresh
 * 
 * Accepts a refreshed FCM token from the client.
 * Called when the FCM SDK on the client returns a new token
 * (e.g. after onTokenRefresh event).
 * 
 * Body: { token: string, platform?: string }
 * Auth: Bearer <Firebase ID Token>
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { saveToken, isValidTokenFormat } from '@/lib/services/fcm-token-service';
import { resolveUserRole } from '@/lib/security/role-cache';

export async function POST(request: NextRequest) {
  try {
    // 1. Extract Bearer token
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Authorization header required' },
        { status: 401 }
      );
    }

    const idToken = authHeader.substring(7);

    // 2. Verify ID token
    if (!adminAuth || !adminDb) {
      return NextResponse.json(
        { success: false, error: 'Server not initialized' },
        { status: 500 }
      );
    }

    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const uid = decodedToken.uid;

    // 3. Parse body
    const { token, platform } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Missing FCM token' },
        { status: 400 }
      );
    }

    if (!isValidTokenFormat(token)) {
      return NextResponse.json(
        { success: false, error: 'Invalid FCM token format' },
        { status: 400 }
      );
    }

    // 4. Determine user collection from role
    const roleData = await resolveUserRole(uid);
    const roleToCollection: Record<string, string> = {
      student: 'students',
      driver: 'drivers',
      moderator: 'moderators',
      admin: 'admins',
    };
    const targetCollection = roleToCollection[roleData.role] || null;

    if (!targetCollection) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 5. Save refreshed token
    const result = await saveToken(uid, targetCollection, token, platform || 'web');

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // 6. Also update legacy field
    await adminDb.collection(targetCollection).doc(uid).set({
      fcmToken: token,
      fcmPlatform: platform || 'web',
      fcmUpdatedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`🔄 FCM token refreshed for ${targetCollection}/${uid}`);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error in tokenRefresh:', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh token' },
      { status: 500 }
    );
  }
}
