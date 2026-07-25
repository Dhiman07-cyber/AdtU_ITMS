/**
 * POST /api/driver/can-operate
 *
 * Check if a driver can operate a specific bus.
 * Returns whether the driver is allowed to open the Track Bus page.
 *
 * D9: Migrated from Firestore to Supabase. Driver-bus assignment check
 * uses Supabase active_trips + buses tables.
 *
 * Request body:
 * - busId: string (bus ID to check)
 *
 * Response:
 * - allowed: boolean
 * - reason?: string (only when denied)
 */

import { NextResponse } from 'next/server';
import { tripLockService } from '@/lib/services/trip-lock-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { BusIdSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getDriverUidByBusId } from '@/domains/fleet/repositories/driver-assignment.repository';

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { busId } = body as any;
        const driverId = auth.uid;

        const supabase = getSupabaseServer();

        // Check driver assignment across driver_assignments, buses, driver_profiles, and active_trips
        const [busResult, assignedDriverUid, driverProfileResult] = await Promise.all([
            supabase.from('buses').select('id, driver_uid').eq('id', busId).maybeSingle(),
            getDriverUidByBusId(busId),
            supabase.from('driver_profiles').select('bus_id').eq('uid', driverId).maybeSingle()
        ]);

        if (!busResult.data) {
            return NextResponse.json(
                { error: 'Bus not found' },
                { status: 404 }
            );
        }

        // Check if driver has an active trip on this bus
        const { data: activeTrip } = await supabase
            .from('active_trips')
            .select('driver_id, bus_id')
            .eq('driver_id', driverId)
            .eq('status', 'active')
            .maybeSingle();

        const driverClaimsBus = activeTrip?.bus_id === busId;
        const busClaimsDriver = assignedDriverUid === driverId || busResult.data.driver_uid === driverId;
        const profileClaimsBus = driverProfileResult.data?.bus_id === busId;

        if (!driverClaimsBus && !busClaimsDriver && !profileClaimsBus) {
            return NextResponse.json({
                allowed: false,
                reason: 'You are not assigned to this bus. Please contact operations.'
            });
        }

        // Check lock status using TripLockService (now PostgreSQL-only)
        const result = await tripLockService.canOperate(driverId, busId);

        return NextResponse.json({
            allowed: result.allowed,
            reason: result.allowed ? undefined : result.reason
        });
    },
    {
        requiredRoles: ['driver'],
        schema: BusIdSchema,
        rateLimit: RateLimits.READ,
        allowBodyToken: true
    }
);
