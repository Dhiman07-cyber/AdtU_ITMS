import { getDriverById,getUserById } from '@/domains/identity';
import { getModeratorPermissions } from '@/lib/security/moderator-permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

type ScannerAuth = {
  uid: string;
  role: string;
};

function addBusId(ids: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    ids.add(value.trim());
  }
}

function collectAssignedBusIds(data: Record<string, unknown> | undefined): Set<string> {
  const ids = new Set<string>();
  if (!data) return ids;

  addBusId(ids, data.busId);
  addBusId(ids, data.bus_id);
  addBusId(ids, data.activeBusId);
  addBusId(ids, data.currentBusId);

  const busIds = data.busIds;
  if (Array.isArray(busIds)) {
    busIds.forEach((busId) => addBusId(ids, busId));
  }

  return ids;
}

export function scannerBusMatchesStudent(scannerBusId: unknown, busId: unknown): boolean {
  if (typeof scannerBusId !== 'string' || !scannerBusId.trim()) return false;
  if (typeof busId !== 'string' || !busId.trim()) return false;
  return scannerBusId.trim() === busId.trim();
}

export async function validateStudentScannerContext(
  auth: ScannerAuth,
  scannerBusId: unknown
): Promise<NextResponse | null> {
  if (auth.role === 'admin') return null;

  if (auth.role === 'moderator') {
    const permissions = await getModeratorPermissions(auth.uid);
    if (permissions.students.canView) return null;

    return NextResponse.json(
      { status: 'invalid', message: 'Moderator student verification permission is required.' },
      { status: 403 }
    );
  }

  if (auth.role !== 'driver') {
    return NextResponse.json(
      { status: 'invalid', message: 'Only authorized personnel can verify students' },
      { status: 403 }
    );
  }

  if (typeof scannerBusId !== 'string' || !scannerBusId.trim() || scannerBusId.length > 100) {
    return NextResponse.json(
      { status: 'invalid', message: 'Driver bus context is required for scanning' },
      { status: 400 }
    );
  }

  const [driverData, userData] = await Promise.all([
    getDriverById(auth.uid),
    getUserById(auth.uid),
  ]);

  const assignedIds = new Set<string>([
    ...collectAssignedBusIds(driverData as Record<string, unknown> | undefined),
    ...collectAssignedBusIds(userData as Record<string, unknown> | undefined),
  ]);

  // Check active_trips in PostgreSQL for dynamic trip lock assignment
  try {
    const supabase = getSupabaseServer();
    const { data: activeTrip } = await supabase
      .from('active_trips')
      .select('bus_id')
      .eq('driver_id', auth.uid)
      .eq('status', 'active')
      .maybeSingle();

    if (activeTrip?.bus_id) {
      assignedIds.add(activeTrip.bus_id.trim());
    }
  } catch (err) {
    console.warn('Failed to query active_trips for scanner validation:', err);
  }

  // If driver has an active trip or bus context, permit verification
  if (assignedIds.size > 0 && assignedIds.has(scannerBusId.trim())) {
    return null;
  }

  return NextResponse.json(
    { status: 'invalid', message: 'Scanner bus does not belong to this driver' },
    { status: 403 }
  );
}
