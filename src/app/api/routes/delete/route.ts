import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { deleteRouteAndData } from '@/lib/cleanup-helpers';

export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const actorUid = decodedToken.uid;

    // Verify user is admin or moderator
    const userRole = await resolveUserRole(actorUid);
    if (userRole.role !== 'admin' && userRole.role !== 'moderator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const { routeId } = body;

    if (!routeId) {
      return NextResponse.json({ error: 'Route ID required' }, { status: 400 });
    }

    // Delete route and all associated data
    const result = await deleteRouteAndData(routeId);

    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to delete route' 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Route deleted successfully'
    });
  } catch (error: any) {
    console.error('Error in delete route API:', error);
    return NextResponse.json(
      { error: 'Failed to delete route' },
      { status: 500 }
    );
  }
}

