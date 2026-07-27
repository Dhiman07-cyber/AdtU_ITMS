import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getMyApplication } from '@/domains/application';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ application: null, authenticated: false });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const application = await getMyApplication(uid);

    return NextResponse.json({ application, authenticated: true });
  } catch (error: any) {
    return NextResponse.json({ application: null, authenticated: false });
  }
}
