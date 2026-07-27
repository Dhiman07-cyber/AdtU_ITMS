import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { NextResponse } from 'next/server';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin']);
    if (!auth.authenticated) return auth.response;

    const { id } = await params;
    
    console.log(`Deleting moderator with ID: ${id}`);
    
    const result = await deleteUserAndData(id, 'moderator');
    
    if (!result.success) {
      return NextResponse.json({ 
        error: result.error || 'Failed to delete moderator' 
      }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Moderator deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting moderator:', error);
    return NextResponse.json({ error: 'Failed to delete moderator' }, { status: 500 });
  }
}
