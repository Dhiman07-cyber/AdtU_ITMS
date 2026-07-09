import { NextResponse } from 'next/server';
import { getModeratorPermissions } from '@/lib/security/moderator-permissions';
import { getDriverById, getUserById } from '@/domains/identity';

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
  addBusId(ids, data.assignedBusId);
  addBusId(ids, data.activeBusId);
  addBusId(ids, data.currentBusId);

  const assignedBusIds = data.assignedBusIds;
  if (Array.isArray(assignedBusIds)) {
    assignedBusIds.forEach((busId) => addBusId(ids, busId));
  }

  return ids;
}

export function scannerBusMatchesStudent(scannerBusId: unknown, assignedBusId: unknown): boolean {
  if (typeof scannerBusId !== 'string' || !scannerBusId.trim()) return true;
  if (typeof assignedBusId !== 'string' || !assignedBusId.trim()) return false;
  return scannerBusId.trim() === assignedBusId.trim();
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

  if (assignedIds.size === 0) {
    return NextResponse.json(
      { status: 'invalid', message: 'No bus assigned to this driver' },
      { status: 403 }
    );
  }

  if (!assignedIds.has(scannerBusId.trim())) {
    return NextResponse.json(
      { status: 'invalid', message: 'Scanner bus does not belong to this driver' },
      { status: 403 }
    );
  }

  return null;
}
