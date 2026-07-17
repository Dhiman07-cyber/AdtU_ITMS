import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminAuth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getUserById, updateDriver } from '@/domains/identity';
import { getBusById, updateBus } from '@/domains/fleet';
import * as routeService from '@/domains/route';

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
        // 2. Driver Logic
        // ---------------------------------------------------------
        const newDriverId = driverUID;
        const currentDriverId = oldBusData.assignedDriverId || oldBusData.driverUID;

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

        // ─── COMMIT TO POSTGRESQL (Canonical Source of Truth) ───

        // 1. Unassign Old Driver in PostgreSQL (if driver changed)
        if (newDriverId && newDriverId !== currentDriverId && currentDriverId) {
            try {
                await updateDriver(currentDriverId, {
                    assignedBusId: null,
                    busId: null,
                    assignedRouteId: null,
                    routeId: null
                });
            } catch (err) {
                console.error(`⚠️ Failed to unassign old driver ${currentDriverId} in PG:`, err);
            }
        }

        // 2. Assign New Driver in PostgreSQL (if driver changed)
        if (newDriverId && newDriverId !== currentDriverId) {
            const finalRouteId = routeChanged ? newRouteId : oldBusData.routeId;
            try {
                await updateDriver(newDriverId, {
                    assignedBusId: busId,
                    busId: busId,
                    assignedRouteId: finalRouteId,
                    routeId: finalRouteId,
                    status: 'active'
                });
            } catch (err) {
                console.error(`⚠️ Failed to assign new driver ${newDriverId} in PG:`, err);
            }
        } else if (routeChanged && currentDriverId) {
            // If driver didn't change but route did, update existing driver's route
            try {
                await updateDriver(currentDriverId, {
                    assignedRouteId: newRouteId,
                    routeId: newRouteId
                });
            } catch (err) {
                console.error(`⚠️ Failed to update existing driver ${currentDriverId} route in PG:`, err);
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
        if (newDriverId !== undefined) {
            busUpdates.assignedDriverId = newDriverId || null;
            busUpdates.activeDriverId = newDriverId || null;
            busUpdates.driverUID = newDriverId || null;
        }
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
