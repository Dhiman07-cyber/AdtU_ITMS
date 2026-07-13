import { NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { DriverSwapSupabaseService } from '@/lib/driver-swap-supabase';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Await params in Next.js 13+ App Router
    const resolvedParams = await params;
    const requestId = resolvedParams.id;

    // Get authentication token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decodedToken = await auth.verifyIdToken(token);
    const adminUID = decodedToken.uid;

    // Verify user is an admin or moderator via Supabase users table
    const supabase = getSupabaseServer();
    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('uid', adminUID)
      .maybeSingle();

    if (!userProfile || !['admin', 'moderator'].includes(userProfile.role)) {
      return NextResponse.json(
        { error: 'Admin or moderator privileges required' },
        { status: 403 }
      );
    }

    const userRole = userProfile.role;
    console.log('📥 Revert swap request: %s by %s %s', requestId, userRole, adminUID.substring(0, 8));

    // Revert the swap using 'system' to allow trip check bypass for admin actions
    // Using 'system' ensures the endSwap function doesn't reject based on driver UID check
    const result = await DriverSwapSupabaseService.endSwap(requestId, 'system');

    if (!result.success && !result.pendingTripEnd) {
      return NextResponse.json(
        { error: result.error || 'Failed to revert swap' },
        { status: 400 }
      );
    }

    // Handle pending revert case (trip in progress)
    if (result.pendingTripEnd) {
      console.log('⏳ Swap %s marked for pending revert by %s (trip in progress)', requestId, userRole);
      return NextResponse.json({
        success: true,
        pendingTripEnd: true,
        message: 'Swap marked for revert. It will complete automatically when the current trip(s) finish. Drivers who have completed their trips are now set to reserved.'
      });
    }

    return NextResponse.json({
      success: true,
      pendingTripEnd: false,
      message: 'Swap reverted successfully. Drivers restored to original assignments.'
    });

  } catch (error: any) {
    console.error('Error reverting swap:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
