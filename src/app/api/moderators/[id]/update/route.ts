import { getModeratorById,updateModerator } from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { NextResponse } from 'next/server';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin']);
    if (!auth.authenticated) return auth.response;

    const { id } = await params;
    const requestBody = await request.json();

    const ALLOWED_FIELDS = new Set([
      'fullName', 'name', 'email', 'phone', 'employeeId', 'profilePhotoUrl'
    ]);
    const BLOCKED_FIELDS = new Set([
      'role', 'permissions', 'status'
    ]);

    const updatedModeratorData: Record<string, any> = {};
    for (const [key, value] of Object.entries(requestBody)) {
      if (BLOCKED_FIELDS.has(key)) {
        console.warn(`Blocked attempt to update forbidden field: ${key}`);
        continue;
      }
      if (ALLOWED_FIELDS.has(key)) {
        updatedModeratorData[key] = value;
      }
    }

    const existingMod = await getModeratorById(id);
    if (!existingMod) {
      return NextResponse.json({ error: 'Moderator not found' }, { status: 404 });
    }

    await updateModerator(id, {
      ...updatedModeratorData,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      id,
      ...existingMod,
      ...updatedModeratorData,
    });
  } catch (error: any) {
    console.error('Error updating moderator:', error);
    return NextResponse.json({ error: 'Failed to update moderator' }, { status: 500 });
  }
}
