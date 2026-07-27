import { NextResponse } from 'next/server';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canDelete');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    
    console.log(`Deleting driver with ID: ${id}`);
    
    const result = await deleteUserAndData(id, 'driver');
    
    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to delete driver' 
      }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Driver deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting driver:', error);
    return NextResponse.json({ error: 'Failed to delete driver' }, { status: 500 });
  }
}
