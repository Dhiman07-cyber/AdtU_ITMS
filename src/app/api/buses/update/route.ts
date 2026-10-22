import { getBusById, invalidateBusCache, updateBus } from '@/domains/fleet';
import { getUserById } from '@/domains/identity';
import * as routeService from '@/domains/route';
import { clearStudentAssignmentMemoryCache } from '@/domains/student';
import { adminAuth } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations } from '@/lib/utils';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
    try {
        const headersList = await headers();
        const authHeader = headersList.get('authorization') || headersList.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.substring(7);
        const decodedToken = await adminAuth.verifyIdToken(token);

        // Check if user is admin or moderator via PostgreSQL (canonical source of truth)
        const user = await getUserById(decodedToken.uid);
        if (!user || !['admin', 'moderator'].includes(user.role)) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

        const permissionDenied = await requireModeratorPermission(
            { uid: user.id || decodedToken.uid, role: user.role } as any,
            'buses',
            'canEdit'
        );
        if (permissionDenied) return permissionDenied;

        const body = await request.json();
        const { busId, busNumber, color, capacity, driverUID, routeId, shift, load, status } = body;

        if (!busId) {
            return NextResponse.json({ success: false, error: 'Bus ID is required' }, { status: 400 });
        }

        // Fetch old bus data from PostgreSQL
        const oldBusData = await getBusById(busId);
        if (!oldBusData) {
            return NextResponse.json({ success: false, error: 'Bus not found' }, { status: 404 });
        }

        const supabase = getSupabaseServer();

        // ---------------------------------------------------------
        // 1. Calculate Loads & Capacity Logic (PostgreSQL Authoritative)
        // ---------------------------------------------------------
        const { data: dbBus } = await supabase
            .from('buses')
            .select('morning_load, evening_load, capacity, route_id, bus_number')
            .eq('id', busId)
            .maybeSingle();

        const currentMorning = dbBus?.morning_load ?? (oldBusData.load?.morningCount || 0);
        const currentEvening = dbBus?.evening_load ?? (oldBusData.load?.eveningCount || 0);
        const inputMorning = load?.morningCount !== undefined ? parseInt(load.morningCount) : currentMorning;
        const inputEvening = load?.eveningCount !== undefined ? parseInt(load.eveningCount) : currentEvening;

        const newCurrentMembers = inputMorning + inputEvening;
        const newCapacity = capacity ? parseInt(capacity) : (dbBus?.capacity ?? oldBusData.capacity ?? 0);

        // A. Bus Number Uniqueness Check (Must be unique in PostgreSQL)
        if (busNumber && busNumber !== oldBusData.busNumber) {
            const { data: duplicateBus } = await supabase
                .from('buses')
                .select('id')
                .eq('bus_number', busNumber)
                .neq('id', busId)
                .maybeSingle();

            if (duplicateBus) {
                return NextResponse.json({
                    success: false,
                    error: `Bus Number "${busNumber}" is already in use by another bus.`
                }, { status: 400 });
            }
        }

        // C. Capacity Check (per-shift model): cannot lower capacity below existing passenger load
        if (newCapacity > 0) {
            if (inputMorning > newCapacity) {
                return NextResponse.json({ success: false, error: `Morning load (${inputMorning}) exceeds new bus capacity (${newCapacity}).` }, { status: 409 });
            }
            if (inputEvening > newCapacity) {
                return NextResponse.json({ success: false, error: `Evening load (${inputEvening}) exceeds new bus capacity (${newCapacity}).` }, { status: 409 });
            }
        }

        // D. Shift Validation
        const newShift = shift || oldBusData.shift;
        if (newShift === 'Morning' && inputEvening > 0) {
            return NextResponse.json({ success: false, error: `Cannot set shift to "Morning" while ${inputEvening} students are assigned to the Evening slot.` }, { status: 400 });
        }
        if (newShift === 'Evening' && inputMorning > 0) {
            return NextResponse.json({ success: false, error: `Cannot set shift to "Evening" while ${inputMorning} students are assigned to the Morning slot.` }, { status: 400 });
        }

        // ---------------------------------------------------------
        // 2. Active Trip Guard (Direct PostgreSQL Check)
        // ---------------------------------------------------------
        const busVariations = getBusIdVariations(busId);
        const { data: activeTrips } = await supabase
            .from('active_trips')
            .select('id, status')
            .in('bus_id', busVariations)
            .in('status', ['active', 'SCHEDULED', 'IN_TRANSIT', 'started', 'in_progress'])
            .gt('expires_at', new Date().toISOString())
            .limit(1);

        if ((activeTrips && activeTrips.length > 0) || oldBusData.activeTripId) {
            return NextResponse.json({ success: false, error: 'Cannot update bus configuration during an active trip.' }, { status: 409 });
        }

        // ---------------------------------------------------------
        // 3. Route Logic & Student Profile Route Sync
        // ---------------------------------------------------------
        const newRouteId = routeId || oldBusData.routeId;
        const routeChanged = routeId && routeId !== oldBusData.routeId;
        let routeData = null;

        if (routeChanged) {
            routeData = await routeService.getById(newRouteId);
            if (!routeData) {
                return NextResponse.json({ success: false, error: `Route "${newRouteId}" not found in canonical routes.` }, { status: 404 });
            }

            // Synchronize student_profiles route_id to the new route
            const nowIso = new Date().toISOString();
            await supabase
                .from('student_profiles')
                .update({ route_id: newRouteId, updated_at: nowIso })
                .eq('bus_id', busId);
        }

        // 4. Update Bus in PostgreSQL
        const busUpdates: any = {};
        if (busNumber) busUpdates.busNumber = busNumber;
        if (color) busUpdates.color = color;
        if (capacity) busUpdates.capacity = newCapacity;
        if (status) busUpdates.status = status;
        if (shift) busUpdates.shift = newShift;
        busUpdates.load = { morningCount: inputMorning, eveningCount: inputEvening };
        busUpdates.currentMembers = newCurrentMembers;
        if (routeId) {
            busUpdates.routeId = routeId;
            if (routeData) {
                busUpdates.routeName = routeData.name;
            }
        }

        await updateBus(busId, busUpdates);
        invalidateBusCache(busId);
        invalidateBusCache();
        clearStudentAssignmentMemoryCache();
        const { invalidateCapacityRouteCache } = await import('@/app/api/buses/capacity/route');
        invalidateCapacityRouteCache();

        if (routeChanged) {
            try {
                const { invalidateBusTripSnapshot } = await import('@/lib/services/trip-snapshot-cache');
                invalidateBusTripSnapshot(busId);
            } catch (snapErr) {
                console.warn('[buses/update] Bus snapshot invalidation warning:', snapErr);
            }
            try {
                const { invalidateRouteCache } = await import('@/domains/route');
                invalidateRouteCache();
            } catch (routeErr) {
                console.warn('[buses/update] Route cache invalidation warning:', routeErr);
            }
            try {
                const { invalidateStudentAssignmentCache } = await import('@/domains/student');
                await invalidateStudentAssignmentCache('*');
            } catch (assignErr) {
                console.warn('[buses/update] Wildcard student cache invalidation warning:', assignErr);
            }
        }

        return NextResponse.json({ success: true, message: 'Bus updated successfully' });

    } catch (error: any) {
        console.error('Update bus error:', error);
        return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
    }
}
