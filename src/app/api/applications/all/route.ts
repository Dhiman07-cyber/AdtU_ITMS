import { getAllPaginated } from '@/domains/application';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { NextRequest,NextResponse } from 'next/server';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const userRole = await resolveUserRole(uid);
    if (userRole.role !== 'admin' && userRole.role !== 'moderator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const applications = await getAllPaginated(limit, offset);

    return NextResponse.json({ applications });
  } catch (error: any) {
    console.error('Error fetching applications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
      { status: 500 }
    );
  }
}
