import { NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { DriverSwapSupabaseService } from '@/lib/driver-swap-supabase';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServer();
    const body = await request.json();
    const {
      idToken,
      fromDriverUID,
      toDriverUID,
      busId,
      routeId,
      timePeriod
    } = body;

    // Authenticate requester
    let token = idToken;
    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const decodedToken = await auth.verifyIdToken(token);
    const requesterUID = decodedToken.uid;

    // Validate requester is the fromDriver
    if (requesterUID !== fromDriverUID) {
      return NextResponse.json(
        { error: 'You can only create swap requests for yourself' },
        { status: 403 }
      );
    }

    // SECURITY: Verify the requester is actually a driver via Supabase.
    const { data: requesterProfile } = await supabase
      .from('driver_profiles')
      .select('uid')
      .eq('uid', requesterUID)
      .maybeSingle();
    if (!requesterProfile) {
      return NextResponse.json(
        { error: 'Only drivers can create swap requests' },
        { status: 403 }
      );
    }

    // Log received data for debugging
    console.log('📥 Swap request data received:', {
      fromDriverUID,
      toDriverUID,
      busId,
      routeId,
      timePeriod
    });

    // Validate required fields
    if (!toDriverUID || !busId || !routeId) {
      console.error('❌ Missing required fields:', { toDriverUID, busId, routeId });
      return NextResponse.json(
        { error: 'Missing required fields: toDriverUID, busId, routeId' },
        { status: 400 }
      );
    }

    const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
    if (!idPattern.test(fromDriverUID) || !idPattern.test(toDriverUID) || !idPattern.test(busId) || !idPattern.test(routeId)) {
      console.error('❌ Invalid ID formats in swap request:', { fromDriverUID, toDriverUID, busId, routeId });
      return NextResponse.json(
        { error: 'Invalid format for driver, bus, or route identifiers' },
        { status: 400 }
      );
    }

    // Validate time period
    if (!timePeriod || !timePeriod.type) {
      console.error('❌ Invalid time period:', timePeriod);
      return NextResponse.json(
        { error: 'Time period is required' },
        { status: 400 }
      );
    }

    // Check for existing swap requests between these drivers (prevent simultaneous requests)
    const existingSwapQuery = await supabase
      .from('driver_swap_requests')
      .select('*')
      .or(`and(requester_driver_uid.eq.${fromDriverUID},candidate_driver_uid.eq.${toDriverUID}),and(requester_driver_uid.eq.${toDriverUID},candidate_driver_uid.eq.${fromDriverUID})`)
      .in('status', ['pending', 'accepted'])
      .limit(1);

    if (existingSwapQuery.data && existingSwapQuery.data.length > 0) {
      const existingRequest = existingSwapQuery.data[0];
      console.log('🚫 Existing swap request found between drivers:', existingRequest);
      
      if (existingRequest.status === 'pending') {
        if (existingRequest.requester_driver_uid === fromDriverUID) {
          return NextResponse.json(
            { error: 'You already have a pending swap request with this driver. Please wait for their response or cancel the existing request.' },
            { status: 409 }
          );
        } else {
          return NextResponse.json(
            { error: 'This driver already has a pending swap request with you. Please check your incoming requests to respond.' },
            { status: 409 }
          );
        }
      } else if (existingRequest.status === 'accepted') {
        return NextResponse.json(
          { error: 'You already have an active swap with this driver. Please end the current swap before creating a new one.' },
          { status: 409 }
        );
      }
    }

    // Get driver and bus details from Supabase for names
    const [fromDriverResult, toDriverResult, busResult] = await Promise.all([
      supabase.from('driver_profiles').select('full_name').eq('uid', fromDriverUID).maybeSingle(),
      supabase.from('driver_profiles').select('full_name').eq('uid', toDriverUID).maybeSingle(),
      supabase.from('buses').select('bus_number').eq('id', busId).maybeSingle()
    ]);

    const fromDriverName = fromDriverResult.data?.full_name || 'Driver';
    const toDriverName = toDriverResult.data?.full_name || 'Driver';
    const busNumber = busResult.data?.bus_number || busId;

    // Get route name if available
    let routeName = '';
    if (routeId) {
      const { data: routeData } = await supabase
        .from('routes')
        .select('route_name')
        .eq('id', routeId)
        .maybeSingle();
      routeName = routeData?.route_name || '';
    }

    // Check if candidate driver has a bus (for TRUE SWAP)
    let swapType: 'assignment' | 'swap' = 'assignment';
    let secondaryBusId = undefined;
    let secondaryBusNumber = undefined;
    let secondaryRouteId = undefined;
    let secondaryRouteName = undefined;

    // Get candidate driver's assigned bus from driver_profiles
    const { data: candidateProfile } = await supabase
      .from('driver_profiles')
      .select('assigned_bus_id, bus_id')
      .eq('uid', toDriverUID)
      .maybeSingle();
    const candidateBusId = candidateProfile?.assigned_bus_id || candidateProfile?.bus_id;

    // Check if candidate bus is valid (not reserved/unassigned)
    const isCandidateReserved = !candidateBusId ||
      (typeof candidateBusId === 'string' && ['reserved', 'none', 'unassigned'].includes(candidateBusId.toLowerCase()));

    if (!isCandidateReserved) {
      console.log('🔄 Candidate has bus, setting as TRUE SWAP:', candidateBusId);
      swapType = 'swap';
      secondaryBusId = candidateBusId;

      // Get secondary bus details
      const { data: secondaryBusData } = await supabase
        .from('buses')
        .select('bus_number, route_id')
        .eq('id', candidateBusId)
        .maybeSingle();

      secondaryBusNumber = secondaryBusData?.bus_number || candidateBusId;
      secondaryRouteId = secondaryBusData?.route_id;

      if (secondaryRouteId) {
        const { data: secRouteData } = await supabase
          .from('routes')
          .select('route_name')
          .eq('id', secondaryRouteId)
          .maybeSingle();
        secondaryRouteName = secRouteData?.route_name;
      }
    }

    // Create the swap request using Supabase
    const result = await DriverSwapSupabaseService.createSwapRequest({
      fromDriverUID,
      fromDriverName,
      toDriverUID,
      toDriverName,
      busId,
      busNumber,
      routeId,
      routeName,
      secondaryBusId,
      secondaryBusNumber,
      secondaryRouteId,
      secondaryRouteName,
      startTime: timePeriod.startTime,
      endTime: timePeriod.endTime,
      timePeriodType: timePeriod.type,
      swapType
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create swap request' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      requestId: result.requestId,
      message: 'Swap request created successfully'
    });

  } catch (error: any) {
    console.error('Error in driver swap request creation:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    // Get authentication token
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('❌ No authorization header');
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const decodedToken = await auth.verifyIdToken(token);
    const userUID = decodedToken.uid;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const busId = searchParams.get('busId');
    const type = searchParams.get('type') || 'all'; // 'incoming' | 'outgoing' | 'all'

    console.log('📥 GET swap requests query (Supabase):', { userUID: userUID.substring(0, 8), status, busId, type });

    // Use Supabase for fetching
    const result = await DriverSwapSupabaseService.getSwapRequests({
      driverUid: userUID,
      type: type as 'incoming' | 'outgoing' | 'all',
      status: status || undefined
    });

    if (result.error) {
      console.error('❌ Supabase error:', result.error);
      return NextResponse.json(
        { error: result.error, success: false, requests: [] },
        { status: 500 }
      );
    }

    // Filter by busId if provided
    let requests = result.requests;
    if (busId) {
      requests = requests.filter((r: any) => r.busId === busId);
    }

    return NextResponse.json({
      success: true,
      requests
    });

  } catch (error: any) {
    console.error('❌ Error fetching swap requests:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        success: false,
        requests: []
      },
      { status: 500 }
    );
  }
}
