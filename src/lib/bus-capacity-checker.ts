import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { normalizeShift, isStudentBusShiftCompatible } from '@/lib/utils/shift-utils';

async function getDb() {
  const { db } = await import('@/lib/firebase');
  return db;
}

export interface BusCapacityInfo {
  busId: string;
  busNumber: string;
  capacity: number;
  currentMembers: number;
  availableSeats: number;
  isFull: boolean;
  routeId: string;
  routeName: string;
}

export interface CapacityCheckResult {
  selectedBus: BusCapacityInfo | null;
  isFull: boolean;
  alternativeBuses: BusCapacityInfo[];
  hasAlternatives: boolean;
  canProceed: boolean;
  message: string;
  requiresAdminNotification: boolean;
  needsCapacityReview: boolean; // True when bus is full and no alternatives - needs admin to allocate seat
  isNearCapacity: boolean; // >95% capacity
  capacityPercentage: number;
  /**
   * Reassignment reason codes for moderator/admin view:
   * - 'bus_full_only_option': The selected bus is full and only serves the stop (Case 1)
   * - 'bus_full_alternatives_exist': The selected bus is full but other buses also serve it (Case 2)
   * - 'no_issue': The selected bus has seats available (Case 3 - no action needed)
   */
  reassignmentReason?: 'bus_full_only_option' | 'bus_full_alternatives_exist' | 'no_issue';
}

/**
 * Checks if a specific bus has available capacity
 * @param busId - The bus ID to check
 * @param shift - Optional shift to check capacity for ('Morning' or 'Evening')
 * 
 * IMPORTANT LOGIC:
 * - For shift-specific checks, we use morningLoad/eveningLoad against totalCapacity
 * - Each shift has "totalCapacity" number of seats available
 * - If morningLoad >= totalCapacity, morning shift is overloaded
 * - If eveningLoad >= totalCapacity, evening shift is overloaded
 */
export async function checkBusCapacity(busId: string, shift?: string): Promise<BusCapacityInfo | null> {
  try {
    const db = await getDb();
    const busRef = doc(db, 'buses', busId);
    const busSnap = await getDoc(busRef);

    if (!busSnap.exists()) {
      return null;
    }

    const busData = busSnap.data();

    // Get totalCapacity - this is the capacity per shift
    const totalCapacity = busData.totalCapacity || busData.capacity || 0;

    // Get shift-specific load using canonical shift-utils
    let shiftLoad = 0;
    let shiftName = shift || 'unspecified';
    const normalizedShift = normalizeShift(shift);

    if (normalizedShift === 'Morning') {
      shiftLoad = typeof busData.load?.morningCount === 'number' ? busData.load.morningCount : (typeof busData.morningLoad === 'number' ? busData.morningLoad : 0);
      shiftName = 'Morning';
    } else if (normalizedShift === 'Evening') {
      shiftLoad = typeof busData.load?.eveningCount === 'number' ? busData.load.eveningCount : (typeof busData.eveningLoad === 'number' ? busData.eveningLoad : 0);
      shiftName = 'Evening';
    } else if (typeof busData.currentMembers === 'number') {
      // Fallback to generic currentMembers if no shift specified
      shiftLoad = busData.currentMembers;
    } else {
      // Last resort: query students collection (May fail if permissions are restricted)
      try {
        const studentsRef = collection(db, 'students');
        const q = query(studentsRef, where('busId', '==', busId));
        const countSnapshot = await getDocs(q);

        if (shift) {
          const normalizedShiftForQuery = normalizeShift(shift);
          const shiftStudents = countSnapshot.docs.filter(doc => normalizeShift(doc.data().shift) === normalizedShiftForQuery);
          shiftLoad = shiftStudents.length;
        } else {
          shiftLoad = countSnapshot.size;
        }
      } catch (err) {
        console.warn('Could not count students from collection, defaulting to 0:', err);
        shiftLoad = 0;
      }
    }

    // Check compatibility for Evening shift
    if (normalizeShift(shift) === 'Evening') {
      const busShift = busData.shift || 'Both';
      if (normalizeShift(busShift) === 'Morning') {
        // Bus doesn't run in evening
        return {
          busId,
          busNumber: busData.busNumber || busId,
          capacity: totalCapacity,
          currentMembers: totalCapacity,
          availableSeats: 0,
          isFull: true,
          routeId: busData.routeId || '',
          routeName: busData.routeName || ''
        };
      }
    }

    // Calculate available seats: totalCapacity - shiftLoad
    const availableSeats = totalCapacity - shiftLoad;
    const isOverloaded = availableSeats <= 0;

    // CONSOLE LOG FOR ADMINISTRATION: When bus is overloaded for selected shift
    if (isOverloaded && shift) {
      console.log(`🚨 [ADMINISTRATION NOTICE] Bus ${busData.busNumber || busId} is OVERLOADED for ${shiftName} shift.`);
      console.log(`   📊 Capacity: ${totalCapacity}, ${shiftName} Load: ${shiftLoad}, Available: ${availableSeats}`);
      console.log(`   ⚠️  Administration office should look upon this issue as bus selected at chosen shift is full.`);
    }

    return {
      busId,
      busNumber: busData.busNumber || busId,
      capacity: totalCapacity,
      currentMembers: shiftLoad,
      availableSeats,
      isFull: availableSeats <= 0,
      routeId: busData.routeId || '',
      routeName: busData.routeName || ''
    };
  } catch (error) {
    console.error('Error checking bus capacity:', error);
    return null;
  }
}

/**
 * Helper to extract stopId from a stop object (handles various field names)
 * Priority: stopId > id > name
 */
function extractStopId(stop: any): string {
  if (!stop) return '';
  const id = stop.stopId || stop.id || stop.stop_id || stop.name || '';
  return (typeof id === 'string' ? id : '').toLowerCase().trim();
}

/**
 * Finds all buses that cover a specific stop
 * First looks up the routes collection to find which routes have this stop,
 * then finds all buses assigned to those routes.
 * @param stopId - The stop ID
 * @param stopName - The stop name
 * @param shift - Optional shift to filter buses ('Morning' or 'Evening')
 */
export async function findBusesByStop(stopId: string, stopName: string, shift?: string): Promise<BusCapacityInfo[]> {
  try {
    console.log('🔍 findBusesByStop called with:', { stopId, stopName });

    // Normalize search criteria
    const normalizedStopId = stopId.toLowerCase().trim();
    const normalizedStopName = stopName.toLowerCase().trim();

    // Step 1: Find all routes that have this stop via Route Service
    const routeService = await import('@/domains/route');
    const routes = await routeService.getAll();

    const matchingRouteIds: string[] = [];

    for (const route of routes) {
      const stops = route.stops || [];

      const hasStop = stops.some((stop: any) => {
        const routeStopId = extractStopId(stop);
        const routeStopName = (stop.name || stop.stopName || '').toLowerCase().trim();
        return routeStopId === normalizedStopId || routeStopName === normalizedStopName;
      });

      if (hasStop) {
        const routeId = route.routeId || route.id;
        if (routeId) {
          matchingRouteIds.push(routeId);
          console.log('✅ Found route with stop:', routeId);
        }
      }
    }

    console.log('📍 Routes containing stop:', matchingRouteIds);

    if (matchingRouteIds.length === 0) {
      console.log('⚠️ No routes found containing this stop');
      return [];
    }

    const db = await getDb();
    // Step 2: Find all buses assigned to these routes
    const busesRef = collection(db, 'buses');
    const busesSnap = await getDocs(busesRef);

    const candidateBuses: any[] = [];

    for (const busDoc of busesSnap.docs) {
      const busData = busDoc.data();
      const busRouteId = busData.routeId || '';

      // Check if this bus's route is in our matching routes
      if (matchingRouteIds.includes(busRouteId)) {
        candidateBuses.push({ id: busDoc.id, ...busData });
        console.log('🚌 Found bus on matching route:', busDoc.id, busRouteId);
      }

      // Also check embedded route.stops and direct stops arrays (fallback for different schemas)
      if (!matchingRouteIds.includes(busRouteId)) {
        let hasStop = false;

        if (busData.route?.stops) {
          const routeStops = Array.isArray(busData.route.stops) ? busData.route.stops : [];
          hasStop = routeStops.some((stop: any) => {
            const busStopId = extractStopId(stop);
            const busStopName = (stop.name || stop.stopName || '').toLowerCase().trim();
            return busStopId === normalizedStopId || busStopName === normalizedStopName;
          });
        }

        if (!hasStop && busData.stops) {
          const directStops = Array.isArray(busData.stops) ? busData.stops : [];
          hasStop = directStops.some((stop: any) => {
            const busStopId = extractStopId(stop);
            const busStopName = (stop.name || stop.stopName || '').toLowerCase().trim();
            return busStopId === normalizedStopId || busStopName === normalizedStopName;
          });
        }

        if (hasStop) {
          candidateBuses.push({ id: busDoc.id, ...busData });
        }
      }
    }

    console.log('🚌 Total candidate buses found:', candidateBuses.length);

    // Step 3: Filter buses by shift compatibility if shift is specified
    let filteredCandidates = candidateBuses;
    if (shift) {
      filteredCandidates = candidateBuses.filter(busData => {
        const busShift = busData.shift || 'Both';
        return isStudentBusShiftCompatible(shift, busShift);
      });
      console.log(`🚌 Buses after shift filter (${shift}):`, filteredCandidates.length);
    }

    // Step 4: Fetch accurate capacity for valid candidates in parallel (optimized)
    // IMPORTANT: Use totalCapacity for per-shift capacity checks
    const matchingBuses = await Promise.all(filteredCandidates.map(async (busData) => {
      // Get totalCapacity - this is the capacity per shift
      const totalCapacity = busData.totalCapacity || busData.capacity || 0;

      // Get shift-specific load using canonical shift-utils
      let shiftLoad = 0;
      let shiftName = shift || 'unspecified';
      const normalizedShift2 = normalizeShift(shift);

      if (normalizedShift2 === 'Morning') {
        shiftLoad = typeof busData.load?.morningCount === 'number' ? busData.load.morningCount : (typeof busData.morningLoad === 'number' ? busData.morningLoad : 0);
        shiftName = 'Morning';
      } else if (normalizedShift2 === 'Evening') {
        shiftLoad = typeof busData.load?.eveningCount === 'number' ? busData.load.eveningCount : (typeof busData.eveningLoad === 'number' ? busData.eveningLoad : 0);
        shiftName = 'Evening';
      } else if (typeof busData.currentMembers === 'number') {
        shiftLoad = busData.currentMembers;
      } else {
        // Fallback: Query students collection (expensive, risky for permissions)
        try {
          const studentsRef = collection(db, 'students');
          const q = query(studentsRef, where('busId', '==', busData.id));
          const countSnapshot = await getDocs(q);

          if (shift) {
            const normalizedShiftForQuery = normalizeShift(shift);
            const shiftStudents = countSnapshot.docs.filter(doc => normalizeShift(doc.data().shift) === normalizedShiftForQuery);
            shiftLoad = shiftStudents.length;
          } else {
            shiftLoad = countSnapshot.size;
          }
        } catch (err) {
          console.warn(`Could not count students for bus ${busData.id}, defaulting to 0`, err);
          shiftLoad = 0;
        }
      }

      // Calculate available seats: totalCapacity - shiftLoad
      const availableSeats = totalCapacity - shiftLoad;
      const isOverloaded = availableSeats <= 0;

      // CONSOLE LOG FOR ADMINISTRATION: When bus is overloaded for selected shift
      if (isOverloaded && shift) {
        console.log(`🚨 [ADMINISTRATION NOTICE] Bus ${busData.busNumber || busData.id} is OVERLOADED for ${shiftName} shift.`);
        console.log(`   📊 Capacity: ${totalCapacity}, ${shiftName} Load: ${shiftLoad}, Available: ${availableSeats}`);
        console.log(`   ⚠️  Administration office should look upon this issue as bus selected at chosen shift is full.`);
      }

      console.log(`📊 Bus ${busData.id}: totalCapacity=${totalCapacity}, ${shiftName}Load=${shiftLoad}, available=${availableSeats}`);

      return {
        busId: busData.id,
        busNumber: busData.busNumber || busData.id,
        capacity: totalCapacity,
        currentMembers: shiftLoad,
        availableSeats,
        isFull: isOverloaded,
        routeId: busData.routeId || '',
        routeName: busData.routeName || ''
      };
    }));

    // Sort by available seats (descending)
    matchingBuses.sort((a, b) => b.availableSeats - a.availableSeats);

    console.log('✅ Final matching buses:', matchingBuses.map(b => ({ id: b.busId, available: b.availableSeats })));

    return matchingBuses;
  } catch (error) {
    console.error('Error finding buses by stop:', error);
    return [];
  }
}

/**
 * Comprehensive capacity check for new application
 * @param routeId - The route ID
 * @param stopId - The stop ID
 * @param stopName - The stop name
 * @param selectedBusId - Optional selected bus ID
 * @param shift - Optional shift to check capacity for ('Morning' or 'Evening')
 */
export async function checkCapacityForApplication(
  routeId: string,
  stopId: string,
  stopName: string,
  selectedBusId?: string,
  shift?: string
): Promise<CapacityCheckResult> {
  try {
    console.log('🔍 Checking capacity for:', { routeId, stopId, stopName, selectedBusId, shift });

    // Find all buses that cover this stop (with shift filtering if specified)
    const allBuses = await findBusesByStop(stopId, stopName, shift);

    console.log('🚌 Found buses covering this stop:', allBuses.length);

    if (allBuses.length === 0) {
      return {
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'No buses found for this stop. Your application will be reviewed by the managing team.',
        requiresAdminNotification: true,
        needsCapacityReview: true,
        isNearCapacity: false,
        capacityPercentage: 0
      };
    }

    // Find the primary bus: either the specifically selected one, or the first one matching the route
    const primaryBus = selectedBusId
      ? allBuses.find(bus => bus.busId === selectedBusId)
      : (allBuses.find(bus => bus.routeId === routeId) || allBuses[0]);

    if (!primaryBus && selectedBusId) {
      // If selected bus doesn't cover this stop?
      // Fallback to route logic or return error?
      // For now, let's fallback to route matching if specific bus not found at stop
      // No, that might be confusing. If user selected Bus A, and Bus A doesn't stop here, that's an issue.
      // But `findBusesByStop` filters by stop. So if selectedBusId is not in `allBuses`, it means it doesn't stop here.
      return {
        selectedBus: null,
        isFull: false,
        alternativeBuses: allBuses,
        hasAlternatives: true,
        canProceed: false,
        message: 'Selected bus does not stop here. Please choose another stop or bus.',
        requiresAdminNotification: false,
        needsCapacityReview: false,
        isNearCapacity: false,
        capacityPercentage: 0
      };
    }

    if (!primaryBus) {
      // Should not happen given logic above unless allBuses empty (handled)
      return {
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: false,
        message: 'Bus configuration error. Your application will be reviewed by the managing team.',
        requiresAdminNotification: true,
        needsCapacityReview: true,
        isNearCapacity: false,
        capacityPercentage: 0
      };
    }

    // Calculate capacity percentage (current + 1 student)
    const currentCapacityPercentage = primaryBus.capacity > 0
      ? (primaryBus.currentMembers / primaryBus.capacity) * 100
      : 0;
    const futureCapacityPercentage = primaryBus.capacity > 0
      ? ((primaryBus.currentMembers + 1) / primaryBus.capacity) * 100
      : 0;
    const isNearCapacity = currentCapacityPercentage > 95;

    // Get alternative buses (exclude primary bus and only include buses with available seats)
    const alternativeBuses = allBuses.filter(bus =>
      bus.busId !== primaryBus.busId && bus.availableSeats > 0
    );

    console.log('🚌 Primary bus:', primaryBus);
    console.log('🚌 Alternative buses:', alternativeBuses.length);

    if (primaryBus.isFull) {
      if (alternativeBuses.length > 0) {
        // Bus is full but alternatives exist
        // Case 2: Bus is full but alternatives exist - prompt user to select alternative
        // Case 2: Bus is full but alternatives exist - prompt user to select alternative
        return {
          selectedBus: primaryBus,
          isFull: true,
          alternativeBuses,
          hasAlternatives: true,
          canProceed: true,
          message: alternativeBuses.length === 1
            ? `The selected bus (${primaryBus.busNumber}) is full. You will be assigned to ${alternativeBuses[0].busNumber} which has ${alternativeBuses[0].availableSeats} available seat(s).`
            : `The selected bus (${primaryBus.busNumber}) is full. Please select from available buses: ${alternativeBuses.map(b => `${b.busNumber} (${b.availableSeats} seats)`).join(', ')}.`,
          requiresAdminNotification: false,
          needsCapacityReview: true, // Mark for review since bus is full
          isNearCapacity: false,
          capacityPercentage: 100,
          reassignmentReason: 'bus_full_alternatives_exist' // Case 2
        };
      } else {
        // Bus is full and no alternatives exist - critical situation
        // Case 1: Bus is full and no alternatives - needs capacity review by admin
        // Case 1: Bus is full and ONLY serves this stop - critical, needs admin review
        return {
          selectedBus: primaryBus,
          isFull: true,
          alternativeBuses: [],
          hasAlternatives: false,
          canProceed: true, // Allow submission but flag for admin review
          message: `The bus (${primaryBus.busNumber}) for your stop is currently full and this is the only bus serving this stop. Your application will be reviewed by the managing team for seat availability after submission.`,
          requiresAdminNotification: true,
          needsCapacityReview: true, // This tells admin they can't approve directly
          isNearCapacity: false,
          capacityPercentage: 100,
          reassignmentReason: 'bus_full_only_option' // Case 1 - Critical
        };
      }
    } else {
      // Bus has available capacity
      // Case 3: Bus has available capacity - normal flow
      // Case 3: Bus has available capacity - normal flow, no issues
      return {
        selectedBus: primaryBus,
        isFull: false,
        alternativeBuses: alternativeBuses.length > 0 ? alternativeBuses : [],
        hasAlternatives: alternativeBuses.length > 0,
        canProceed: true,
        message: `✓ Bus ${primaryBus.busNumber} has ${primaryBus.availableSeats} available seat(s).`,
        requiresAdminNotification: false,
        needsCapacityReview: false,
        isNearCapacity,
        capacityPercentage: futureCapacityPercentage,
        reassignmentReason: 'no_issue' // Case 3 - No problem
      };
    }
  } catch (error) {
    console.error('Error in capacity check:', error);
    return {
      selectedBus: null,
      isFull: false,
      alternativeBuses: [],
      hasAlternatives: false,
      canProceed: true,
      message: 'Unable to check bus capacity. Please proceed with application.',
      requiresAdminNotification: false,
      needsCapacityReview: false,
      isNearCapacity: false,
      capacityPercentage: 0
    };
  }
}

/**
 * Creates an admin notification for overloaded bus
 */
export async function createOverloadNotification(
  studentName: string,
  enrollmentId: string,
  busInfo: BusCapacityInfo,
  stopName: string
): Promise<boolean> {
  try {
    const db = await getDb();
    // Fetch admin and moderator IDs - NOTE: This will fail for students due to permissions
    const adminsSnap = await getDocs(collection(db, 'admins'));
    const moderatorsSnap = await getDocs(collection(db, 'moderators'));

    const adminIds = adminsSnap.docs.map(doc => doc.id);
    const moderatorIds = moderatorsSnap.docs.map(doc => doc.id);
    const allStaffIds = [...adminIds, ...moderatorIds];

    if (allStaffIds.length === 0) {
      console.warn('No admin/moderator found to notify');
      return false;
    }

    // Create notification
    await fetch('/api/notifications/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        title: '🚨 Bus Capacity Alert - Overloaded Bus Request',
        content: `**Student Application Alert**\n\n` +
          `**Student:** ${studentName} (${enrollmentId})\n` +
          `**Bus:** ${busInfo.busNumber} (${busInfo.busId})\n` +
          `**Stop:** ${stopName}\n` +
          `**Status:** Bus is currently at FULL capacity (${busInfo.currentMembers}/${busInfo.capacity})\n\n` +
          `⚠️ **Critical Issue:** This stop is ONLY covered by ${busInfo.busNumber}. No alternative buses available.\n\n` +
          `**Action Required:** Please review capacity reallocation or consider adding additional bus service for this route.\n\n` +
          `[View Smart Allocation](/admin/smart-allocation)`,
        targetType: 'specific_users',
        target: {
          type: 'specific_users',
          specificUserIds: allStaffIds
        },
        recipientIds: allStaffIds,
        sender: {
          userId: 'system',
          userName: 'System',
          userRole: 'system'
        }
      })
    });

    console.log('✅ Overload notification created for admins/moderators');
    return true;
  } catch (error) {
    console.error('Error creating overload notification:', error);
    return false; // Silent return
  }
}

/**
 * Creates an admin notification for near-capacity bus (>95%)
 */
export async function createNearCapacityNotification(
  studentName: string,
  enrollmentId: string,
  busInfo: BusCapacityInfo,
  stopName: string,
  currentPercentage: number,
  futurePercentage: number
): Promise<boolean> {
  try {
    const db = await getDb();
    // Fetch admin and moderator IDs - NOTE: This will fail for students due to permissions
    const adminsSnap = await getDocs(collection(db, 'admins'));
    const moderatorsSnap = await getDocs(collection(db, 'moderators'));

    const adminIds = adminsSnap.docs.map(doc => doc.id);
    const moderatorIds = moderatorsSnap.docs.map(doc => doc.id);
    const allStaffIds = [...adminIds, ...moderatorIds];

    if (allStaffIds.length === 0) {
      console.warn('No admin/moderator found to notify');
      return false;
    }

    // Calculate future capacity after enrollment
    const futureMembers = busInfo.currentMembers + 1;
    const futureAvailableSeats = busInfo.capacity - futureMembers;

    // Create notification
    await fetch('/api/notifications/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        title: '⚠️ Bus Near Capacity - High Utilization Alert',
        content: `**New Student Enrollment - Capacity Warning**\n\n` +
          `**Student:** ${studentName} (${enrollmentId})\n` +
          `**Bus:** ${busInfo.busNumber} (${busInfo.busId})\n` +
          `**Stop:** ${stopName}\n\n` +
          `**Current Capacity:**\n` +
          `• Occupancy: ${busInfo.currentMembers}/${busInfo.capacity} seats (${currentPercentage.toFixed(1)}%)\n` +
          `• Available: ${busInfo.availableSeats} seat(s)\n\n` +
          `**After Enrollment:**\n` +
          `• Occupancy: ${futureMembers}/${busInfo.capacity} seats (${futurePercentage.toFixed(1)}%)\n` +
          `• Available: ${futureAvailableSeats} seat(s)\n\n` +
          `⚠️ **Notice:** This bus is operating at >95% capacity. Consider:\n` +
          `• Monitoring for potential overload situations\n` +
          `• Planning additional capacity for this route\n` +
          `• Reviewing student distribution across buses\n\n` +
          `**Recommended Action:** Review bus allocation and consider capacity expansion if trend continues.\n\n` +
          `[View Smart Allocation](/admin/smart-allocation)`,
        targetType: 'specific_users',
        target: {
          type: 'specific_users',
          specificUserIds: allStaffIds
        },
        recipientIds: allStaffIds,
        sender: {
          userId: 'system',
          userName: 'System',
          userRole: 'system'
        }
      })
    });

    console.log('✅ Near-capacity notification created for admins/moderators');
    return true;
  } catch (error) {
    console.error('Error creating near-capacity notification:', error);
    return false; // Silent return
  }
}
