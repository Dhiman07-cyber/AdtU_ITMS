import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/trip-dwell-logs
 *
 * Incontrovertible Stop Dwell Audit Engine (INV-2)
 * Allows Administrators and Moderators to inspect authoritative dwell logs
 * for student-driver dispute adjudication.
 */
export const GET = withSecurity(
  async (request) => {
    try {
      const supabase = getSupabaseServer();
      const url = new URL(request.url);

      const tripId = url.searchParams.get('tripId') || url.searchParams.get('trip_id');
      const busId = url.searchParams.get('busId') || url.searchParams.get('bus_id');
      const routeId = url.searchParams.get('routeId') || url.searchParams.get('route_id');
      const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)), 200);
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

      let query = supabase
        .from('stop_dwell_logs')
        .select('id, trip_id, bus_id, driver_id, route_id, stop_id, stop_name, arrived_at, departed_at, dwell_seconds, created_at', {
          count: 'exact',
        });

      if (tripId) {
        query = query.eq('trip_id', tripId);
      }
      if (busId) {
        query = query.eq('bus_id', busId);
      }
      if (routeId) {
        query = query.eq('route_id', routeId);
      }

      // Order chronologically if inspecting a specific trip, otherwise latest first
      if (tripId) {
        query = query.order('arrived_at', { ascending: true });
      } else {
        query = query.order('arrived_at', { ascending: false });
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        return NextResponse.json(
          { success: false, error: `Failed to fetch stop dwell logs: ${error.message}` },
          { status: 500 }
        );
      }

      const logs = (data || []).map((row: any) => ({
        ...row,
        status: row.dwell_seconds >= 20 ? 'Verified Dwell' : 'Brief Pass-Through',
      }));

      return NextResponse.json({
        success: true,
        logs,
        total: count || 0,
        limit,
        offset,
      });
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: err?.message || 'Internal server error' },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.READ,
  }
);
