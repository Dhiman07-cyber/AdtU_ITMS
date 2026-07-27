import { createAuditEvent,resolveAuditActor } from '@/domains/audit';
import { getStudentById } from '@/domains/identity';
import { deleteUserAndData } from '@/lib/cleanup-helpers';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { DeleteStudentSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { uid } = body as any;

        // Get the student data from PostgreSQL (canonical source of truth)
        const studentData = await getStudentById(uid);

        if (!studentData) {
            return NextResponse.json({ success: false, error: 'Student not found' }, { status: 404 });
        }

        const busId = studentData.busId || studentData.currentBusId || studentData.busId || null;
        const shouldDecrement = !!busId && !wasSeatReleased(studentData);

        // Resolve the acting admin BEFORE deletion
        const actor = await resolveAuditActor(auth.uid);

        // Call the consolidated canonical deletion flow
        const result = await deleteUserAndData(uid, 'student');

        if (!result.success) {
            return NextResponse.json({ success: false, error: result.error || 'Deletion failed' }, { status: 500 });
        }

        // Emit audit event only after the entire deletion workflow completes successfully
        void createAuditEvent({
            category: 'system',
            action: 'student_deleted',
            summary: `Student deleted: ${studentData.fullName || studentData.name || ''}`,
            severity: 'high',
            actor_id: auth.uid,
            actor_name: actor.name,
            actor_role: actor.role as any,
            target_type: 'student',
            target_id: uid,
            target_name: studentData.fullName || studentData.name || '',
            metadata: {
                reason: 'admin_manual_delete',
                before: {
                    enrollmentId: studentData.enrollmentId || null,
                    busId: busId || null,
                    shift: studentData.shift || null,
                    status: studentData.status || null,
                    validUntil: studentData.validUntil || null,
                    sessionEndYear: studentData.sessionEndYear || null,
                    seatReleasedAt: studentData.seatReleasedAt || null,
                },
                after: { deleted: true },
                details: { seatDecremented: shouldDecrement, busId: busId || null },
            },
        });

        return NextResponse.json({ success: true, message: 'Student deleted successfully' });
    },
    {
        requiredRoles: ['admin'],
        schema: DeleteStudentSchema,
        rateLimit: RateLimits.ADMIN,
        allowBodyToken: true
    }
);