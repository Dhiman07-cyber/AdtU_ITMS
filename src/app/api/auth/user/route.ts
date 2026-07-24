import { NextRequest, NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { getUserById, updateUser } from '@/domains/identity';

/**
 * GET /api/auth/user
 *
 * Returns the current user's data from PostgreSQL.
 * Replaces client-side Firestore reads in auth-context.tsx and user-service.ts.
 */
export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const uid = auth.uid;

      let user = await getUserById(uid);

      if (!user) {
        // Fallback check: Check if user has an active application in PostgreSQL (e.g. submitted, verified_upcoming, pending_seat_allocation)
        const { getSupabaseServer } = await import('@/lib/supabase-server');
        const db = getSupabaseServer();
        const { data: appRow } = await db
          .from('applications')
          .select('application_id, applicant_uid, applicant_email, state, form_data')
          .eq('applicant_uid', uid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (appRow && appRow.state !== 'rejected' && appRow.state !== 'draft') {
          return NextResponse.json({
            success: true,
            exists: true,
            user: {
              uid: appRow.applicant_uid,
              email: appRow.applicant_email,
              name: appRow.form_data?.fullName || appRow.applicant_email,
              role: 'student',
              status: appRow.state,
              state: appRow.state,
              applicationId: appRow.application_id,
            },
          });
        }

        return NextResponse.json({
          success: true,
          exists: false,
          message: 'User not found',
        });
      }

      // Update last_login_at in background asynchronously
      updateUser(uid, { lastLoginAt: new Date().toISOString() }).catch(() => {});

      return NextResponse.json({
        success: true,
        exists: true,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          ...user,
        },
      });
    } catch (error: any) {
      console.error('Error fetching user:', error);
      return NextResponse.json(
        { error: 'Failed to fetch user' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: [],
  }
);
