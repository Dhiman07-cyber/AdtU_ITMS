import { requireTransportEntitlement } from '@/lib/entitlement/require-transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BusIdSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { isShiftCompatible } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * POST /api/student/check-active-trip
 * 
 * Checks if there's an active trip for the student's assigned bus.
 * D9: All reads from Supabase (PostgreSQL) — no Firestore.
 */
export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const { busId } = body as any;

    try {
      let studentShift: string | null = null;

      // SECURITY: Transport entitlement check (students only)
      if (auth.role === 'student') {
        const gate = await requireTransportEntitlement(auth.uid);
        if (!gate.ok) return (gate as any).response;
        
        const student = gate.student;
        const studentBusId = student.busId || student.bus_id || null;
        if (studentBusId && studentBusId !== busId && studentBusId !== busId.replace('bus_', '') && `bus_${studentBusId}` !== busId) {
          return NextResponse.json({ success: false, error: 'Forbidden: You are not assigned to this bus', requestId }, { status: 403 });
        }
        studentShift = student.shift || null;
      }

      const supabase = getSupabaseServer();

      // Parallelize Supabase active trip check and bus metadata fetch
      const [tripRes, busRes] = await Promise.all([
        supabase.from('active_trips').select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, end_time, last_heartbeat').eq('bus_id', busId).eq('status', 'active').maybeSingle(),
        supabase.from('buses').select('status').eq('id', busId).maybeSingle(),
      ]);

      if (tripRes.error) {
        console.error(`[${requestId}] Supabase query error:`, tripRes.error);
        return NextResponse.json({ success: false, error: 'Failed to verify trip status', requestId }, { status: 500 });
      }

      const activeTrip = tripRes.data;
      const busStatus = busRes.data?.status || null;

      if (activeTrip) {
        if (!studentShift || !isShiftCompatible(studentShift, activeTrip.shift)) {
          return NextResponse.json({
            success: true,
            hasActiveTrip: false,
            tripData: null,
            requestId
          });
        }

        return NextResponse.json({
          success: true,
          hasActiveTrip: true,
          tripData: {
            tripId: activeTrip.trip_id,
            ...activeTrip,
            busStatus
          },
          requestId
        });
      }

      return NextResponse.json({
        success: true,
        hasActiveTrip: false,
        tripData: null,
        requestId
      });

    } catch (err) {
      console.error(`[${requestId}] Unexpected error:`, err);
      return NextResponse.json({ success: false, error: 'Internal server error', requestId }, { status: 500 });
    }
  },
  {
    requiredRoles: ['student'],
    schema: BusIdSchema,
    rateLimit: RateLimits.READ,
    allowBodyToken: true
  }
);
