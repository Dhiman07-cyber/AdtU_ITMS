import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
  async (request, { auth }) => {
    const supabase = getSupabaseServer();
    const now = new Date().toISOString();

    const [busesRes, activeTripsRes] = await Promise.all([
      supabase
        .from('buses')
        .select('id, bus_number, status, route_id, route_name, capacity')
        .neq('status', 'inactive')
        .order('bus_number'),
      supabase
        .from('active_trips')
        .select('trip_id, bus_id, driver_id, status, expires_at, start_time')
        .eq('status', 'active')
        .gt('expires_at', now),
    ]);

    if (busesRes.error) {
      console.error('Error fetching available buses:', busesRes.error);
      return NextResponse.json({ buses: [] });
    }

    const activeTripsMap = new Map<string, any>();
    (activeTripsRes.data || []).forEach((trip) => {
      activeTripsMap.set(trip.bus_id, trip);
    });

    const enrichedBuses = (busesRes.data || []).map((bus) => {
      const activeTrip = activeTripsMap.get(bus.id);
      const isInTrip = !!activeTrip;
      const isOperatedByOther = isInTrip && activeTrip.driver_id !== auth.uid;
      const isOperatedByMe = isInTrip && activeTrip.driver_id === auth.uid;

      return {
        ...bus,
        isInTrip,
        is_in_trip: isInTrip,
        isOperatedByOther,
        is_operated_by_other: isOperatedByOther,
        isOperatedByMe,
        is_operated_by_me: isOperatedByMe,
        activeDriverId: activeTrip?.driver_id || null,
        active_driver_id: activeTrip?.driver_id || null,
        tripId: activeTrip?.trip_id || null,
      };
    });

    return NextResponse.json({ buses: enrichedBuses });
  },
  {
    requiredRoles: ['driver'],
    rateLimit: RateLimits.READ,
  },
);
