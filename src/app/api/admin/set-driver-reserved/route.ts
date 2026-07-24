import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getAllBuses, updateBus } from '@/domains/fleet';
import { getDriverById } from '@/domains/identity';
import { unassignDriver } from '@/domains/fleet/repositories/driver-assignment.repository';

/**
 * Set a driver as "Reserved" (not assigned to any bus)
 * 
 * Body: { driverUID: string }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await verifyApiAuth(req, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canReassign');
    if (permissionDenied) return permissionDenied;

    const { driverUID } = await req.json();

    if (!driverUID) {
      return NextResponse.json(
        { success: false, error: 'driverUID is required' },
        { status: 400 }
      );
    }

    // Get driver from PostgreSQL (canonical source of truth)
    const driverData = await getDriverById(driverUID);
    
    if (!driverData) {
      return NextResponse.json(
        { success: false, error: 'Driver not found' },
        { status: 404 }
      );
    }

    const oldBusId = driverData.busId || driverData.busId;

    console.log(`🔄 Setting driver ${driverUID.substring(0,8)}... as Reserved`);
    console.log(`   Old bus: ${oldBusId}`);

    // Remove driver from ALL buses that reference them (from PG)
    const allBuses = await getAllBuses();
    const busesToClean = allBuses.filter(b =>
      (b as any).assignedDriverId === driverUID || (b as any).activeDriverId === driverUID
    );

    console.log(`   Found ${busesToClean.length} buses with driver assignment`);

    // ponytail: Combine dual updates and update each bus sequentially to ensure transactional correctness
    const updatedBuses: string[] = [];
    for (const bus of busesToClean) {
      const busId = bus.busId || bus.id || '';
      const updateData: Record<string, any> = { driverUID: null };
      if ((bus as any).assignedDriverId === driverUID) updateData.assignedDriverId = null;
      if ((bus as any).activeDriverId === driverUID) updateData.activeDriverId = null;

      await updateBus(busId, updateData as any);
      updatedBuses.push(bus.busNumber || busId);
      console.log(`   🔄 Removed from bus ${bus.busNumber || busId}`);
    }

    try {
      await unassignDriver(driverUID, 'admin_reassign');
    } catch (err) {
      console.error(`⚠️ Failed to unassign driver ${driverUID} in driver_assignments:`, err);
    }

    console.log(`   ✅ Removed driver from ${updatedBuses.length} bus(es): ${updatedBuses.join(', ')}`);
    console.log(`✅ Driver ${driverUID.substring(0,8)}... is now Reserved`);

    return NextResponse.json({
      success: true,
      message: `${driverData?.fullName || 'Driver'} is now Reserved and available for swap`,
      driver: {
        uid: driverUID,
        name: driverData?.fullName,
        oldBusId,
        newStatus: 'Reserved'
      },
      busesUpdated: updatedBuses.length,
      busesCleaned: updatedBuses
    });

  } catch (error: any) {
    console.error('❌ Error setting driver as reserved:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
