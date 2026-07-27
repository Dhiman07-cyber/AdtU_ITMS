import { readFeedback,updateFeedback } from '@/lib/feedback-utils';
import { adminDb,auth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextRequest,NextResponse } from 'next/server';

/**
 * PATCH /api/feedback/:id/mark-read
 * Mark feedback as read (admin & moderator only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Properly await params if it's a promise
    const resolvedParams = params instanceof Promise ? await params : params;
    const feedbackId = resolvedParams.id;

    // Get token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Verify Firebase ID token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid authentication token' },
        { status: 401 }
      );
    }

    const userId = decodedToken.uid;

    // Get user role from PostgreSQL
    const userRole = await resolveUserRole(userId);

    if (!userRole.role || (userRole.role !== 'admin' && userRole.role !== 'moderator')) {
      return NextResponse.json(
        { error: 'Access denied. Admin or Moderator role required.' },
        { status: 403 }
      );
    }

    // Determine read_by string
    const updaterInfo = await getUpdaterInfo(adminDb, userId);
    let readByString = userId;
    if (userRole.role === 'admin') {
      readByString = `${updaterInfo.name} (Admin)`;
    } else {
      readByString = `${updaterInfo.name} ( ${updaterInfo.roleOrEmployeeId} )`;
    }

    // Read feedback
    const entries = await readFeedback();

    // Find entry to mark as read
    const entry = entries.find(e => e.id === feedbackId);

    if (!entry) {
      return NextResponse.json(
        { error: 'Feedback not found' },
        { status: 404 }
      );
    }

    // Mark as read using updateFeedback
    const updates = {
      read: true,
      read_at: new Date().toISOString(),
      read_by: readByString
    };

    await updateFeedback(feedbackId, updates);

    // Log action
    console.log('👁️ Feedback marked as read:', {
      id: feedbackId,
      marked_by: userId,
      feedback_entry: {
        user_id: entry.user_id,
        role: entry.role
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Feedback marked as read',
      feedback: { ...entry, ...updates }
    });

  } catch (error: any) {
    console.error('❌ Error marking feedback as read:', error);
    return NextResponse.json(
      { error: 'Failed to mark feedback as read' },
      { status: 500 }
    );
  }
}