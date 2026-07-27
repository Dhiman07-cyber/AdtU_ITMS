import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { checkApplication } from '@/domains/application';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ hasApplication: false, authenticated: false });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const result = await checkApplication(uid);

    return NextResponse.json({ ...result, authenticated: true });
  } catch (error: any) {
    return NextResponse.json({ hasApplication: false, authenticated: false });
  }
}
