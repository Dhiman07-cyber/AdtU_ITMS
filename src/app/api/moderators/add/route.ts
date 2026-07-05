import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { AddModeratorSchema, validateInput } from '@/lib/security/validation-schemas';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      if (!adminDb) {
        return NextResponse.json({ error: 'Database not available' }, { status: 500 });
      }

      const validated = body as { email: string; name: string; phone?: string; faculty?: string; employeeId?: string };

      const newModerator = {
        email: validated.email,
        fullName: validated.name,
        name: validated.name,
        phone: validated.phone || '',
        faculty: validated.faculty || '',
        employeeId: validated.employeeId || '',
        role: 'moderator',
        status: 'active',
        createdAt: new Date().toISOString(),
        permissions: {
          students: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
          drivers: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
          buses: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
          routes: { canView: false, canAdd: false, canEdit: false, canDelete: false },
          applications: { canView: false, canApprove: false, canReject: false, canGenerateVerificationCode: false, canAppearInModeratorList: false },
          payments: { canApproveOfflinePayment: false, canRejectOfflinePayment: false },
        },
        createdBy: auth.uid,
        createdAtServer: FieldValue.serverTimestamp(),
      };

      const docRef = await adminDb.collection('moderators').add(newModerator);

      return NextResponse.json({ id: docRef.id, ...newModerator }, { status: 201 });
    } catch (error) {
      console.error('Error adding moderator:', error);
      return NextResponse.json({ error: 'Failed to add moderator' }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin'],
    schema: AddModeratorSchema,
  }
);
