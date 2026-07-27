import { createModerator,createUser } from '@/domains/identity';
import { withSecurity } from '@/lib/security/api-security';
import { AddModeratorSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const validated = body as { email: string; name: string; phone?: string; faculty?: string; employeeId?: string };

      const now = new Date().toISOString();
      const uid = `mod_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const newModerator = {
        email: validated.email,
        fullName: validated.name,
        name: validated.name,
        phone: validated.phone || '',
        faculty: validated.faculty || '',
        employeeId: validated.employeeId || '',
        role: 'moderator',
        status: 'active',
        createdAt: now,
        permissions: {
          students: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
          drivers: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
          buses: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
          routes: { canView: false, canAdd: false, canEdit: false, canDelete: false },
          applications: { canView: false, canApprove: false, canReject: false, canGenerateVerificationCode: false, canAppearInModeratorList: false },
          payments: { canApproveOfflinePayment: false, canRejectOfflinePayment: false },
        },
        createdBy: auth.uid,
      };

      await createUser({
        uid,
        email: validated.email,
        name: validated.name,
        role: 'moderator',
        createdAt: now,
      });

      await createModerator({
        uid,
        email: validated.email,
        fullName: validated.name,
        name: validated.name,
        phone: validated.phone || '',
        faculty: validated.faculty || '',
        employeeId: validated.employeeId || '',
        role: 'moderator',
        status: 'active',
        permissions: newModerator.permissions,
        createdBy: auth.uid,
        createdAt: now,
      });

      return NextResponse.json({ id: uid, ...newModerator }, { status: 201 });
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
