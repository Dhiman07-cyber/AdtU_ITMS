import { getAllDrivers } from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextRequest,NextResponse } from 'next/server';

// D6 Fleet — Drivers list API. Runtime owner: PostgreSQL (driver_profiles table).
// Ponytail: drivers are a finite staff set — no pagination needed.

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // FIX-04b (RBAC-02): Enforce moderator permission gate for driver list.
    const permDenied = await requireModeratorPermission(auth, 'drivers', 'canView');
    if (permDenied) return permDenied;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'drivers-list'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || searchParams.get('q');

    let drivers: any[] = [];

    if (search && search.trim()) {
      const { getSupabaseServer } = await import('@/lib/supabase-server');
      const db = getSupabaseServer();
      const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      const { data, error } = await db
        .from('driver_profiles')
        .select('*')
        .or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},employee_id.ilike.${pattern},license_number.ilike.${pattern},bus_id.ilike.${pattern},route_id.ilike.${pattern}`)
        .order('full_name', { ascending: true });

      if (!error && data) {
        drivers = data.map((row: any) => ({
          ...row,
          id: row.uid || row.id,
          fullName: row.full_name || row.name || '',
          name: row.full_name || row.name || '',
          assignedBusId: row.assigned_bus_id || row.bus_id || '',
          assignedRouteId: row.assigned_route_id || row.route_id || '',
        }));
      } else {
        drivers = await getAllDrivers();
      }
    } else {
      drivers = await getAllDrivers();
    }

    return NextResponse.json(drivers, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return NextResponse.json(handleApiError(error, 'drivers-get', 'Failed to fetch drivers'), { status: 500 });
  }
}