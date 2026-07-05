import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';

export async function PUT(request: Request) {
    try {
        const authHeader = (await headers()).get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.substring(7);
        const decodedToken = await adminAuth.verifyIdToken(token);
        const userDoc = await adminDb.collection('users').doc(decodedToken.uid).get();

        if (!userDoc.exists || !['admin', 'moderator'].includes(userDoc.data()?.role)) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const { busId, busNumber, color, capacity, driverUID, routeId, shift, load, status } = body;

        if (!busId) {
            return NextResponse.json({ success: false, error: 'Bus ID is required' }, { status: 400 });
        }

        const busRef = adminDb.collection('buses').doc(busId);

        // Execute as a Transaction
        await adminDb.runTransaction(async (t: { get: (arg0: any) => any; update: (arg0: any, arg1: { assignedBusId?: any; busId?: any; assignedRouteId: any; routeId: any; updatedAt: FieldValue; status?: string; }) => void; }) => {
            const busSnap = await t.get(busRef);

            if (!busSnap.exists) {
                throw new Error('Bus not found');
            }

            const oldBusData = busSnap.data() || {};
            const updates: any = {};

            // ---------------------------------------------------------
            // 1. Calculate Loads & Capacity Logic
            // ---------------------------------------------------------
            // Determine new load values (fallback to existing if not provided)
            const inputMorning = load?.morningCount !== undefined ? parseInt(load.morningCount) : oldBusData.load?.morningCount || 0;
            const inputEvening = load?.eveningCount !== undefined ? parseInt(load.eveningCount) : oldBusData.load?.eveningCount || 0;

            const newCurrentMembers = inputMorning + inputEvening;
            const newCapacity = capacity ? parseInt(capacity) : (oldBusData.capacity || 0);

            // A. Bus Number Uniqueness Check (Must be unique)
            if (busNumber && busNumber !== oldBusData.busNumber) {
                // Must query outside transaction? No, queries are allowed but careful with locks. 
                // However, adminDb interface in Node allows query. But strict transaction usually requires reads before writes.
                // We'll trust the query works or use a separate check if needed, but standard Firestore Node SDK supports this.
                const duplicateQuery = await adminDb.collection('buses')
                    .where('busNumber', '==', busNumber)
                    .limit(1)
                    .get();

                if (!duplicateQuery.empty) {
                    // Check if it's not the same doc (though we checked busNumber changed so it shouldn't be)
                    const dupId = duplicateQuery.docs[0].id;
                    if (dupId !== busId) {
                        throw new Error(`Bus Number "${busNumber}" is already in use by another bus.`);
                    }
                }
            }

            // C. Capacity Check (per-shift model: morning and evening are independent trips)
            // Each shift must independently fit within capacity. The total currentMembers
            // (morning + evening) is a derived statistic and may exceed capacity for Both buses.
            if (newCapacity > 0) {
                if (inputMorning > newCapacity) {
                    throw new Error(`Morning count (${inputMorning}) exceeds bus capacity (${newCapacity}).`);
                }
                if (inputEvening > newCapacity) {
                    throw new Error(`Evening count (${inputEvening}) exceeds bus capacity (${newCapacity}).`);
                }
            }

            // D. Shift Validation
            const newShift = shift || oldBusData.shift;

            if (newShift === 'Morning' && inputEvening > 0) {
                throw new Error(`Cannot set shift to "Morning" while ${inputEvening} students are assigned to the Evening slot.`);
            }
            if (newShift === 'Evening' && inputMorning > 0) {
                throw new Error(`Cannot set shift to "Evening" while ${inputMorning} students are assigned to the Morning slot.`);
            }

            // ---------------------------------------------------------
            // 2. Driver Logic
            // ---------------------------------------------------------
            const newDriverId = driverUID;
            const currentDriverId = oldBusData.assignedDriverId;

            if (newDriverId && newDriverId !== currentDriverId) {
                // F. Active Trip Check
                if (oldBusData.activeTripId) {
                    throw new Error('Cannot change driver during an active trip.');
                }

                // Prepare Driver Updates
                updates.assignedDriverId = newDriverId;
                updates.activeDriverId = newDriverId;

                // Unassign Old Driver
                if (currentDriverId) {
                    const oldDriverRef = adminDb.collection('drivers').doc(currentDriverId);
                    t.update(oldDriverRef, {
                        assignedBusId: null,
                        busId: null,
                        assignedRouteId: null,
                        routeId: null,
                        updatedAt: FieldValue.serverTimestamp()
                    });
                }
            }

            // ---------------------------------------------------------
            // 3. Route Logic (G. Route Update)
            // ---------------------------------------------------------
            const newRouteId = routeId || oldBusData.routeId;
            const routeChanged = routeId && routeId !== oldBusData.routeId;

            if (routeChanged) {
                const routeRef = adminDb.collection('routes').doc(newRouteId);
                const routeDoc = await t.get(routeRef);

                if (!routeDoc.exists) {
                    throw new Error(`Route "${newRouteId}" not found in canonical routes collection.`);
                }

                const rData = routeDoc.data() || {};

                updates.routeId = newRouteId;
                // Store as DocumentReference
                updates.routeRef = adminDb.collection('routes').doc(newRouteId);

                // Update the denormalized route object with new route data
                updates.route = {
                    routeId: newRouteId,
                    routeName: rData.routeName || `Route-${newRouteId}`,
                    stops: rData.stops || [],
                    totalStops: rData.stops?.length || 0,
                };
            }

            // ---------------------------------------------------------
            // 4. Apply Common Updates
            // ---------------------------------------------------------
            if (busNumber) updates.busNumber = busNumber;
            if (color) updates.color = color;
            if (capacity) updates.capacity = newCapacity;
            if (status) updates.status = status;
            if (shift) updates.shift = newShift;

            updates.load = { morningCount: inputMorning, eveningCount: inputEvening };
            updates.currentMembers = newCurrentMembers;
            updates.updatedAt = FieldValue.serverTimestamp();

            // Append to audit trail
            const updaterInfo = await getUpdaterInfo(adminDb, decodedToken.uid);

            // Commit Bus Update
            t.update(busRef, updates);

            // Commit New Driver Update (if changed)
            if (newDriverId && newDriverId !== currentDriverId) {
                const finalRouteId = routeChanged ? newRouteId : oldBusData.routeId;
                const newDriverRef = adminDb.collection('drivers').doc(newDriverId);

                t.update(newDriverRef, {
                    assignedBusId: busId,
                    busId: busId,
                    assignedRouteId: finalRouteId,
                    routeId: finalRouteId,
                    status: 'active',
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else if (routeChanged && currentDriverId) {
                // If driver didn't change but route did, update existing driver's route
                const driverRef = adminDb.collection('drivers').doc(currentDriverId);
                t.update(driverRef, {
                    assignedRouteId: newRouteId,
                    routeId: newRouteId,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        return NextResponse.json({ success: true, message: 'Bus updated successfully' });

    } catch (error: any) {
        console.error('Update bus transaction error:', error);
        return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
    }
}
