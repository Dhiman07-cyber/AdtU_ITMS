import { NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServer();
    // Get query params
    const { searchParams } = new URL(request.url);
    const forParam = searchParams.get('for');

    // Authenticate
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing authorization token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decodedToken = await auth.verifyIdToken(token);
    const driverUid = decodedToken.uid;

    if (!driverUid || typeof driverUid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(driverUid)) {
      return NextResponse.json({ error: 'Invalid driver UID' }, { status: 400 });
    }

    console.log('📋 Listing swap requests for driver:', driverUid);

    const response: any = {
      incoming: [],
      outgoing: [],
      active: []
    };

    // Get incoming requests (where candidate = me)
    const { data: incomingRequests, error: incomingError } = await supabase
      .from('driver_swap_requests')
      .select('id, requester_driver_uid, requester_name, candidate_driver_uid, candidate_name, bus_id, bus_number, route_id, route_name, secondary_bus_id, secondary_bus_number, secondary_route_id, secondary_route_name, starts_at, ends_at, expires_at, swap_type, reason, status, created_at, accepted_by, accepted_at, rejected_by, rejected_at, cancelled_by, cancelled_at')
      .eq('candidate_driver_uid', driverUid)
      .order('created_at', { ascending: false });

    if (!incomingError && incomingRequests) {
      response.incoming = incomingRequests;
    }

    // Get outgoing requests (where requester = me)
    const { data: outgoingRequests, error: outgoingError } = await supabase
      .from('driver_swap_requests')
      .select('id, requester_driver_uid, requester_name, candidate_driver_uid, candidate_name, bus_id, bus_number, route_id, route_name, secondary_bus_id, secondary_bus_number, secondary_route_id, secondary_route_name, starts_at, ends_at, expires_at, swap_type, reason, status, created_at, accepted_by, accepted_at, rejected_by, rejected_at, cancelled_by, cancelled_at')
      .eq('requester_driver_uid', driverUid)
      .order('created_at', { ascending: false});

    if (!outgoingError && outgoingRequests) {
      response.outgoing = outgoingRequests;
    }

    // Get active assignments (where I'm either original or current driver)
    const { data: activeAssignments, error: assignmentsError } = await supabase
      .from('temporary_assignments')
      .select('id, bus_id, original_driver_uid, current_driver_uid, route_id, starts_at, ends_at, active, created_at, source_request_id, reason')
      .eq('active', true)
      .or(`original_driver_uid.eq.${driverUid},current_driver_uid.eq.${driverUid}`)
      .order('created_at', { ascending: false });

    if (!assignmentsError && activeAssignments) {
      response.active = activeAssignments;
    }

    // Calculate summary stats
    const summary = {
      pendingIncoming: incomingRequests?.filter(r => r.status === 'pending').length || 0,
      pendingOutgoing: outgoingRequests?.filter(r => r.status === 'pending').length || 0,
      activeAssignments: activeAssignments?.length || 0
    };

    return NextResponse.json({
      success: true,
      ...response,
      summary
    });

  } catch (error: any) {
    console.error('❌ Error listing swap requests:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}






