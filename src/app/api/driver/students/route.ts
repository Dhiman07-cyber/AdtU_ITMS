import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations, isShiftCompatible } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * GET /api/driver/students
 *
 * 2-Tier Authority Student Manifest for Drivers:
 * - Tier 1 (On-Duty Active Trip Authority):
 *   If the driver has an active trip in active_trips, busId, routeId, and shift
 *   come 100% from active_trips. Relief drivers operating bus_06 immediately see
 *   bus_06's student manifest, filtered by the active trip's shift!
 * - Tier 2 (Off-Duty Primary Bus Fallback):
 *   If no trip is active, falls back to the driver's primary bus (buses.primary_driver_uid
 *   or driver_profiles.bus_id).
 */
export const GET = withSecurity(
  async (request, { auth }) => {
    const uid = auth.uid;
    const supabase = getSupabaseServer();

    // 1. Tier 1: Query active_trips FIRST for on-duty live trip
    const { data: activeTrip } = await supabase
      .from('active_trips')
      .select('trip_id, bus_id, route_id, shift, status, start_time')
      .eq('driver_id', uid)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    let busId: string | null = null;
    let routeId: string | null = null;
    let tripShift: string | null = null;
    let tripId: string | null = null;
    let isLiveTrip = false;
    let isPrimaryBus = false;
    let isReliefPool = false;

    if (activeTrip) {
      busId = activeTrip.bus_id;
      routeId = activeTrip.route_id;
      tripShift = activeTrip.shift;
      tripId = activeTrip.trip_id;
      isLiveTrip = true;
    } else {
      // 2. Tier 2: Off-Duty Primary Bus Fallback
      const { data: driverProfile } = await supabase
        .from('driver_profiles')
        .select('bus_id, route_id')
        .eq('uid', uid)
        .maybeSingle();

      let primaryBus = null;
      if (driverProfile?.bus_id) {
        const { data: b } = await supabase
          .from('buses')
          .select('id, route_id')
          .eq('id', driverProfile.bus_id)
          .maybeSingle();
        primaryBus = b;
      }
      if (!primaryBus) {
        const { data: b } = await supabase
          .from('buses')
          .select('id, route_id')
          .or(`primary_driver_uid.eq.${uid},driver_uid.eq.${uid}`)
          .maybeSingle();
        primaryBus = b;
      }

      if (primaryBus) {
        busId = primaryBus.id;
        routeId = primaryBus.route_id;
        isPrimaryBus = true;
      } else {
        isReliefPool = true;
      }
    }

    if (!busId) {
      return NextResponse.json({
        students: [],
        total: 0,
        busId: null,
        routeId: null,
        tripId: null,
        shift: null,
        isLiveTrip: false,
        isPrimaryBus: false,
        isReliefPool: true,
      });
    }

    // 3. Query active students for the resolved bus (with prefix variation support)
    const busVariations = getBusIdVariations(busId);
    const { data: studentRows, error: studentErr } = await supabase
      .from('student_profiles')
      .select('uid, full_name, email, phone, stop_name, shift, profile_photo_url, enrollment_id, faculty, department, status')
      .in('bus_id', busVariations)
      .eq('status', 'active');

    if (studentErr) {
      return NextResponse.json({ error: `Failed to fetch students: ${studentErr.message}` }, { status: 500 });
    }

    let students = (studentRows || []).map((s: any) => ({
      id: s.uid,
      uid: s.uid,
      studentId: s.uid,
      name: s.full_name || 'Student',
      fullName: s.full_name || 'Student',
      email: s.email,
      phone: s.phone,
      pickupPoint: s.stop_name || 'Assigned Stop',
      stop_name: s.stop_name,
      shift: s.shift || 'Both',
      profilePhotoUrl: s.profile_photo_url,
      enrollmentId: s.enrollment_id,
      faculty: s.faculty,
      department: s.department,
      status: s.status,
    }));

    // If live trip has a shift, filter students to compatible shift
    if (isLiveTrip && tripShift) {
      students = students.filter((s: any) => isShiftCompatible(s.shift, tripShift));
    }

    return NextResponse.json({
      students,
      total: students.length,
      busId,
      routeId,
      tripId,
      shift: tripShift,
      isLiveTrip,
      isPrimaryBus,
      isReliefPool,
    });
  },
  {
    requiredRoles: ['driver', 'admin', 'moderator'],
    rateLimit: RateLimits.READ,
  }
);
