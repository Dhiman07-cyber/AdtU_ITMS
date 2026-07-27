import { getActiveAssignmentByDriverUid,unassignDriver } from '@/domains/fleet/repositories/driver-assignment.repository';
import { getDriverById } from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextRequest,NextResponse } from 'next/server';

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

    const oldAssignment = await getActiveAssignmentByDriverUid(driverUID);
    const oldBusId = oldAssignment?.busId ?? driverData.busId;

    console.log(`🔄 Setting driver ${driverUID.substring(0,8)}... as Reserved`);
    console.log(`   Old bus: ${oldBusId}`);

    try {
      await unassignDriver(driverUID, 'admin_reassign');
    } catch (err) {
      console.error(`⚠️ Failed to unassign driver ${driverUID} in driver_assignments:`, err);
    }

    console.log(`✅ Driver ${driverUID.substring(0,8)}... is now Reserved`);

    return NextResponse.json({
      success: true,
      message: `${driverData?.fullName || 'Driver'} is now Reserved`,
      driver: {
        uid: driverUID,
        name: driverData?.fullName,
        oldBusId,
        newStatus: 'Reserved'
      }
    });

  } catch (error: any) {
    console.error('❌ Error setting driver as reserved:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
