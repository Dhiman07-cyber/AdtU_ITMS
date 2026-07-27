import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { checkBusCapacity, getAllBuses } from '@/domains/fleet/services/fleet.service';
import { getAll as getAllRoutes } from '@/domains/route/services/route.service';
import { normalizeShift, areShiftsCompatible, getShiftLoad } from '@/lib/utils/shift-utils';

/**
 * GET /api/buses/capacity?busId=xxx&shift=Morning
 * Simple single-bus capacity check.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'buses-capacity'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const busId = searchParams.get('busId');
    const shift = searchParams.get('shift') || undefined;

    if (!busId) {
      return NextResponse.json({ error: 'busId is required' }, { status: 400 });
    }

    const result = await checkBusCapacity(busId, shift || undefined);

    return NextResponse.json({
      busId,
      busNumber: busId,
      capacity: result.capacity,
      currentMembers: result.shiftLoad,
      availableSeats: result.capacity - result.shiftLoad,
      isFull: !result.available,
      shiftLoad: result.shiftLoad,
      shift: shift || 'Morning',
    }, { headers: rl.headers });
  } catch (error: any) {
    return NextResponse.json(handleApiError(error, 'buses-capacity-get', 'Failed to check capacity'), { status: 500 });
  }
}

/**
 * POST /api/buses/capacity
 * Body: { routeId, stop_name, stop_name, busId?, shift? }
 * Comprehensive capacity check for application flow.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'buses-capacity-check'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const body = await request.json();
    const { routeId, stop_name, busId: selectedBusId, shift } = body;
    const resolved_stop_name = stop_name || body.stop_name || body.stop_name;

    if (!routeId || !resolved_stop_name) {
      return NextResponse.json({ error: 'routeId and stop_name are required' }, { status: 400 });
    }

    const normalizedShift = normalizeShift(shift);

    // Find all routes that contain this stop
    const allRoutes = await getAllRoutes();
    const matchingRouteIds = allRoutes
      .filter(route => {
        const stops = route.stops || [];
        return stops.some((stop: any) => {
          const name = (stop.stop_name || stop.name || '').toLowerCase().trim();
          const target = resolved_stop_name.toLowerCase().trim();
          return name === target;
        });
      })
      .map(route => route.routeId || route.id)
      .filter(Boolean);

    if (matchingRouteIds.length === 0) {
      return NextResponse.json({
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'No buses found for this stop. Your application will be reviewed by the managing team.',
        requiresAdminNotification: true,
        needsCapacityReview: true,
        isNearCapacity: false,
        capacityPercentage: 0,
      }, { headers: rl.headers });
    }

    // Get all buses and filter by matching routes + shift
    const allBuses = await getAllBuses();
    const candidateBuses = allBuses.filter(bus => matchingRouteIds.includes(bus.routeId || ''));

    // Filter by shift compatibility
    const filteredBuses = shift
      ? candidateBuses.filter(bus => {
          const busShift = bus.shift || 'Both';
          return areShiftsCompatible(shift, busShift);
        })
      : candidateBuses;

    // Compute capacity for each candidate
    const matchingBuses = filteredBuses.map(bus => {
      const totalCapacity = bus.capacity || 0;
      const shiftLoad = getShiftLoad(bus, normalizedShift);
      const availableSeats = totalCapacity - shiftLoad;

      return {
        busId: bus.busId || bus.id || '',
        busNumber: bus.busNumber || bus.id || '',
        capacity: totalCapacity,
        currentMembers: shiftLoad,
        availableSeats,
        isFull: availableSeats <= 0,
        routeId: bus.routeId || '',
        routeName: bus.routeName || '',
      };
    }).sort((a, b) => b.availableSeats - a.availableSeats);

    if (matchingBuses.length === 0) {
      return NextResponse.json({
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'No buses found for this stop. Your application will be reviewed by the managing team.',
        requiresAdminNotification: true,
        needsCapacityReview: true,
        isNearCapacity: false,
        capacityPercentage: 0,
      }, { headers: rl.headers });
    }

    // Find primary bus
    const primaryBus = selectedBusId
      ? matchingBuses.find(bus => bus.busId === selectedBusId)
      : (matchingBuses.find(bus => bus.routeId === routeId) || matchingBuses[0]);

    if (!primaryBus) {
      return NextResponse.json({
        selectedBus: null,
        isFull: false,
        alternativeBuses: matchingBuses,
        hasAlternatives: true,
        canProceed: false,
        message: 'Selected bus does not stop here. Please choose another stop or bus.',
        requiresAdminNotification: false,
        needsCapacityReview: false,
        isNearCapacity: false,
        capacityPercentage: 0,
      }, { headers: rl.headers });
    }

    const currentCapacityPercentage = primaryBus.capacity > 0
      ? (primaryBus.currentMembers / primaryBus.capacity) * 100
      : 0;
    const futureCapacityPercentage = primaryBus.capacity > 0
      ? ((primaryBus.currentMembers + 1) / primaryBus.capacity) * 100
      : 0;
    const isNearCapacity = currentCapacityPercentage > 95;

    const alternativeBuses = matchingBuses.filter(bus =>
      bus.busId !== primaryBus.busId && bus.availableSeats > 0
    );

    if (primaryBus.isFull) {
      if (alternativeBuses.length > 0) {
        return NextResponse.json({
          selectedBus: primaryBus,
          isFull: true,
          alternativeBuses,
          hasAlternatives: true,
          canProceed: true,
          message: alternativeBuses.length === 1
            ? `The selected bus (${primaryBus.busNumber}) is full. You will be assigned to ${alternativeBuses[0].busNumber} which has ${alternativeBuses[0].availableSeats} available seat(s).`
            : `The selected bus (${primaryBus.busNumber}) is full. Please select from available buses: ${alternativeBuses.map(b => `${b.busNumber} (${b.availableSeats} seats)`).join(', ')}.`,
          requiresAdminNotification: false,
          needsCapacityReview: true,
          isNearCapacity: false,
          capacityPercentage: 100,
          reassignmentReason: 'bus_full_alternatives_exist',
        }, { headers: rl.headers });
      } else {
        return NextResponse.json({
          selectedBus: primaryBus,
          isFull: true,
          alternativeBuses: [],
          hasAlternatives: false,
          canProceed: true,
          message: `The bus (${primaryBus.busNumber}) for your stop is currently full and this is the only bus serving this stop. Your application will be reviewed by the managing team for seat availability after submission.`,
          requiresAdminNotification: true,
          needsCapacityReview: true,
          isNearCapacity: false,
          capacityPercentage: 100,
          reassignmentReason: 'bus_full_only_option',
        }, { headers: rl.headers });
      }
    }

    return NextResponse.json({
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
      reassignmentReason: 'no_issue',
    }, { headers: rl.headers });
  } catch (error: any) {
    return NextResponse.json(handleApiError(error, 'buses-capacity-post', 'Failed to check capacity'), { status: 500 });
  }
}
