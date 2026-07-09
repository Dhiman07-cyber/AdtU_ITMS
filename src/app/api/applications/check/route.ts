import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { checkApplication } from '@/domains/application';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const result = await checkApplication(uid);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error checking application:', error);
    return NextResponse.json(
      { error: 'Failed to check application' },
      { status: 500 }
    );
  }
}
