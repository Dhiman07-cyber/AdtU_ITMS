import { NextResponse } from 'next/server';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'students', 'canDelete');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    
    console.log(`Deleting student with ID: ${id}`);
    
    const result = await deleteUserAndData(id, 'student');
    
    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to delete student' 
      }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Student deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting student:', error);
    return NextResponse.json({ error: 'Failed to delete student' }, { status: 500 });
  }
}
