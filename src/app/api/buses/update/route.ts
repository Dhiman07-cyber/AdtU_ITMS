import { getBusById,updateBus } from '@/domains/fleet';
import { assignDriverToBus,getActiveAssignmentByBusId,unassignDriver } from '@/domains/fleet/repositories/driver-assignment.repository';
import { getUserById } from '@/domains/identity';
import * as routeService from '@/domains/route';
import { adminAuth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
    try {
        const authHeader = (await headers()).get('authorization');
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

        // ---------------------------------------------------------
        // 1. Calculate Loads & Capacity Logic
        // ---------------------------------------------------------
        const inputMorning = load?.morningCount !== undefined ? parseInt(load.morningCount) : oldBusData.load?.morningCount || 0;
        const inputEvening = load?.eveningCount !== undefined ? parseInt(load.eveningCount) : oldBusData.load?.eveningCount || 0;

        const newCurrentMembers = inputMorning + inputEvening;
        const newCapacity = capacity ? parseInt(capacity) : (oldBusData.capacity || 0);

        // A. Bus Number Uniqueness Check (Must be unique in PostgreSQL)
        if (busNumber && busNumber !== oldBusData.busNumber) {
            const supabase = getSupabaseServer();
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

        // C. Capacity Check (per-shift model)
        if (newCapacity > 0) {
            if (inputMorning > newCapacity) {
                return NextResponse.json({ success: false, error: `Morning count (${inputMorning}) exceeds bus capacity (${newCapacity}).` }, { status: 400 });
            }
            if (inputEvening > newCapacity) {
                return NextResponse.json({ success: false, error: `Evening count (${inputEvening}) exceeds bus capacity (${newCapacity}).` }, { status: 400 });
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
        // 2. Driver Logic — resolve current driver from canonical source
        // ---------------------------------------------------------
        const newDriverId = driverUID;
        const currentAssignment = await getActiveAssignmentByBusId(busId);
        const currentDriverId = currentAssignment?.driverUid ?? null;

        if (newDriverId && newDriverId !== currentDriverId) {
            if (oldBusData.activeTripId) {
                return NextResponse.json({ success: false, error: 'Cannot change driver during an active trip.' }, { status: 400 });
            }
        }

        // ---------------------------------------------------------
        // 3. Route Logic
        // ---------------------------------------------------------
        const newRouteId = routeId || oldBusData.routeId;
        const routeChanged = routeId && routeId !== oldBusData.routeId;
        let routeData = null;

        if (routeChanged) {
            routeData = await routeService.getById(newRouteId);
            if (!routeData) {
                return NextResponse.json({ success: false, error: `Route "${newRouteId}" not found in canonical routes.` }, { status: 404 });
            }
        }

        // ─── COMMIT — canonical source of truth ───

        // 1. Unassign old driver via canonical repository
        if (newDriverId && newDriverId !== currentDriverId && currentDriverId) {
            try {
                await unassignDriver(currentDriverId, 'admin_reassign');
            } catch (err) {
                console.error(`⚠️ Failed to unassign old driver ${currentDriverId} in driver_assignments:`, err);
            }
        }

        // 2. Assign new driver via canonical repository
        if (newDriverId && newDriverId !== currentDriverId) {
            const finalRouteId = routeChanged ? newRouteId : oldBusData.routeId;
            try {
                await assignDriverToBus(newDriverId, busId, {
                    routeId: finalRouteId,
                    assignedBy: 'admin',
                    reason: 'admin_reassign',
                });
            } catch (err) {
                console.error(`⚠️ Failed to assign new driver ${newDriverId} in driver_assignments:`, err);
            }
        }

        // 3. Update Bus in PostgreSQL
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
        }

        await updateBus(busId, busUpdates);

        return NextResponse.json({ success: true, message: 'Bus updated successfully' });

    } catch (error: any) {
        console.error('Update bus error:', error);
        return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
    }
}
