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
import { adminAuth } from '@/lib/firebase-admin';
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
    if (!adminAuth) {
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

    // 4. Determine user role
    const roleData = await resolveUserRole(uid);

    if (!roleData.role) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 5. Save refreshed token
    const result = await saveToken(uid, 'students', token, platform || 'web');

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    console.log(`FCM token refreshed for ${uid}`);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error in tokenRefresh:', error?.message || error);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh token' },
      { status: 500 }
    );
  }
}
