import { getDriverById,getUserById } from '@/domains/identity';
import { getModeratorPermissions } from '@/lib/security/moderator-permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations } from '@/lib/utils';
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
  // If scannerBusId is not specified (e.g. Admin or Moderator desk verification), there is no vehicle-specific mismatch
  if (scannerBusId === undefined || scannerBusId === null || (typeof scannerBusId === 'string' && !scannerBusId.trim())) {
    return true;
  }
  if (typeof busId !== 'string' || !busId.trim()) return false;
  const sStr = String(scannerBusId).trim().toLowerCase();
  const bStr = busId.trim().toLowerCase();
  if (sStr === bStr) return true;
  const sVariations = getBusIdVariations(sStr).map(v => v.toLowerCase());
  return sVariations.includes(bStr);
}

export async function validateStudentScannerContext(
  auth: ScannerAuth,
  scannerBusId: unknown
): Promise<NextResponse | null> {
  const role = (auth.role || '').toLowerCase();

  if (role === 'admin') return null;

  if (role === 'moderator') {
    const permissions = await getModeratorPermissions(auth.uid);
    if (permissions?.students?.canView === true) return null;

    return NextResponse.json(
      { status: 'invalid', message: 'Moderator student verification permission is required.' },
      { status: 403 }
    );
  }

  if (role !== 'driver') {
    return NextResponse.json(
      { status: 'invalid', message: 'Only authorized personnel can verify students' },
      { status: 403 }
    );
  }

  // Driver role — allow verification if valid scannerBusId string is provided or driver has assigned context
  if (typeof scannerBusId === 'string' && scannerBusId.trim()) {
    return null;
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
    const { data: activeTrips } = await supabase
      .from('active_trips')
      .select('bus_id')
      .eq('driver_id', auth.uid);

    if (activeTrips && activeTrips.length > 0) {
      activeTrips.forEach(t => {
        if (t.bus_id) assignedIds.add(t.bus_id.trim());
      });
    }
  } catch (err) {
    console.warn('Failed to query active_trips for scanner validation:', err);
  }

  return null;
}

export interface ResolvedScannerContext {
  scannerBusId: string | null;
  activeTripId: string | null;
  tripShift: string | null;
  isTripStale: boolean;
}

const SCANNER_BUS_CACHE_TTL_MS = 15 * 1000; // 15 seconds
const MAX_SCANNER_BUS_CACHE = 500;

interface CachedScannerBus {
  context: ResolvedScannerContext;
  expiresAtMs: number;
}

const scannerBusCache = new Map<string, CachedScannerBus>();

export function invalidateScannerBusCache(driverUid?: string): void {
  if (driverUid) {
    scannerBusCache.delete(driverUid);
    for (const k of Array.from(scannerBusCache.keys())) {
      if (k.startsWith(`${driverUid}:`)) {
        scannerBusCache.delete(k);
      }
    }
  } else {
    scannerBusCache.clear();
  }
}

export async function resolveScannerBusId(
  auth: { uid: string; role: string },
  inputScannerBusId?: string | null
): Promise<ResolvedScannerContext> {
  const normalizedInput = typeof inputScannerBusId === 'string' && inputScannerBusId.trim()
    ? inputScannerBusId.trim()
    : null;

  // 1. Non-driver role (desk verification / admin / moderator)
  if (auth.role !== 'driver') {
    return {
      scannerBusId: normalizedInput,
      activeTripId: null,
      tripShift: null,
      isTripStale: false,
    };
  }

  // 2. Driver role: check L1 15-second cache
  const cacheKey = `${auth.uid}:${normalizedInput || 'auto'}`;
  const now = Date.now();
  const cached = scannerBusCache.get(cacheKey);
  if (cached && now < cached.expiresAtMs) {
    return cached.context;
  }

  const supabase = getSupabaseServer();
  let scannerBusId: string | null = normalizedInput;
  let activeTripId: string | null = null;
  let tripShift: string | null = null;
  let isTripStale = false;

  try {
    const { data: driverActiveTrip } = await supabase
      .from('active_trips')
      .select('trip_id, bus_id, status, created_at, shift, expires_at')
      .eq('driver_id', auth.uid)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (driverActiveTrip?.bus_id) {
      scannerBusId = driverActiveTrip.bus_id;
      const createdAt = new Date(driverActiveTrip.created_at).getTime();
      const isExpired = Date.now() - createdAt > 12 * 60 * 60 * 1000;
      if (isExpired) {
        isTripStale = true;
      } else {
        activeTripId = driverActiveTrip.trip_id;
        tripShift = driverActiveTrip.shift || null;
      }
    }
  } catch (e) {
    console.warn('Failed to resolve active trip for driver scanner:', e);
  }

  // Fallback: If no active trip, check primary bus
  if (!scannerBusId) {
    try {
      const { data: driverBus } = await supabase
        .from('buses')
        .select('id')
        .or(`primary_driver_uid.eq.${auth.uid},driver_uid.eq.${auth.uid}`)
        .maybeSingle();

      if (driverBus?.id) {
        scannerBusId = driverBus.id;
      } else {
        const { data: driverProfile } = await supabase
          .from('driver_profiles')
          .select('bus_id, assigned_bus_id')
          .eq('uid', auth.uid)
          .maybeSingle();
        scannerBusId = driverProfile?.bus_id || driverProfile?.assigned_bus_id || null;
      }
    } catch (e) {
      console.warn('Failed to resolve driver primary bus fallback for scanner:', e);
    }
  }

  const result: ResolvedScannerContext = {
    scannerBusId,
    activeTripId,
    tripShift,
    isTripStale,
  };

  if (scannerBusCache.size >= MAX_SCANNER_BUS_CACHE) {
    const oldestKey = scannerBusCache.keys().next().value;
    if (oldestKey) scannerBusCache.delete(oldestKey);
  }
  scannerBusCache.set(cacheKey, { context: result, expiresAtMs: now + SCANNER_BUS_CACHE_TTL_MS });

  return result;
}

