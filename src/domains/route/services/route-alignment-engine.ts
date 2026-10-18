/**
 * src/domains/route/services/route-alignment-engine.ts
 *
 * Route Corridor Alignment & Projection Engine for ADTU ITMS.
 *
 * Provides high-precision projection of student and bus coordinates onto
 * canonical road polylines, calculating:
 * 1. crossTrackDistanceMeters: perpendicular distance from coordinate to road centerline.
 * 2. routeProgressMeters: cumulative distance along the route corridor from start point.
 * 3. nearestStopDistanceMeters: Haversine distance to nearest canonical stop pin.
 *
 * Enforces the 3-Lock Corridor & Approach Window Invariants:
 * - Lock 1: Continuous route corridor (<= 120m from route polyline OR <= 200m from named stop).
 * - Lock 2: Directional approach window (bus not > 150m past student, bus not > 4km upstream).
 */

import {
  LatLng,
  getCanonicalRouteGeometry,
  getCanonicalStopsForRoute,
  CanonicalStop,
} from '../data/canonical-route-geometries';

export interface RouteCorridorProjection {
  crossTrackDistanceMeters: number;
  routeProgressMeters: number;
  totalRouteLengthMeters: number;
  nearestStopDistanceMeters: number;
  nearestStopName: string | null;
  nearestStopLat?: number;
  nearestStopLng?: number;
  isInCorridor: boolean;
}

export interface ApproachingBusWindowResult {
  alreadyPassed: boolean;
  tooFarUpstream: boolean;
  busDeltaMeters: number; // positive = bus is past student; negative = bus is upstream
  signedAheadMeters: number; // positive = bus is upstream (approaching) by this many meters
}

/**
 * Standard Haversine distance in meters between two WGS84 coordinates.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Projects a point onto a single road segment A -> B.
 * Uses flat-earth equirectangular projection centered at segment midpoint.
 */
export function projectPointToSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): { distanceMeters: number; segmentProgressMeters: number; segmentLengthMeters: number } {
  const midLat = (aLat + bLat) / 2;
  const cosFactor = Math.cos((midLat * Math.PI) / 180);

  // Flat-earth offsets in meters from A
  const dx = (bLng - aLng) * cosFactor * 111320;
  const dy = (bLat - aLat) * 110574;
  const segLenSq = dx * dx + dy * dy;
  const segLen = Math.sqrt(segLenSq);

  const px = (pLng - aLng) * cosFactor * 111320;
  const py = (pLat - aLat) * 110574;

  if (segLenSq < 1e-4) {
    // Degenerate segment
    const dist = Math.sqrt(px * px + py * py);
    return { distanceMeters: dist, segmentProgressMeters: 0, segmentLengthMeters: 0 };
  }

  // Projection scalar t on vector AB
  const t = (px * dx + py * dy) / segLenSq;
  const tClamped = Math.max(0, Math.min(1, t));

  const cx = tClamped * dx;
  const cy = tClamped * dy;
  const dist = Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  const segmentProgress = tClamped * segLen;

  return {
    distanceMeters: dist,
    segmentProgressMeters: segmentProgress,
    segmentLengthMeters: segLen,
  };
}

/**
 * Projects a point onto an arbitrary polyline array of coordinates.
 * Returns the closest perpendicular distance and the cumulative distance from the polyline start.
 */
export function projectPointToPolyline(
  point: LatLng,
  polyline: LatLng[]
): { crossTrackDistanceMeters: number; routeProgressMeters: number; totalRouteLengthMeters: number } {
  if (!polyline || polyline.length === 0) {
    return { crossTrackDistanceMeters: Infinity, routeProgressMeters: 0, totalRouteLengthMeters: 0 };
  }

  if (polyline.length === 1) {
    const d = haversineMeters(point.lat, point.lng, polyline[0].lat, polyline[0].lng);
    return { crossTrackDistanceMeters: d, routeProgressMeters: 0, totalRouteLengthMeters: 0 };
  }

  let minDistance = Infinity;
  let bestProgress = 0;
  let cumulativeDistance = 0;
  const segCumulative: number[] = [0];

  // Precompute cumulative lengths
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const seg = projectPointToSegment(point.lat, point.lng, a.lat, a.lng, b.lat, b.lng);
    segCumulative.push(cumulativeDistance + seg.segmentLengthMeters);
    cumulativeDistance += seg.segmentLengthMeters;

    if (seg.distanceMeters < minDistance) {
      minDistance = seg.distanceMeters;
      bestProgress = segCumulative[i] + seg.segmentProgressMeters;
    }
  }

  return {
    crossTrackDistanceMeters: minDistance,
    routeProgressMeters: bestProgress,
    totalRouteLengthMeters: cumulativeDistance,
  };
}

/**
 * High-level helper: projects a coordinate onto the active route corridor.
 * Evaluates both the road polyline (cross-track distance) and named stops.
 */
export function projectPointToRouteCorridor(
  point: LatLng,
  routeId: string | null | undefined,
  customStops?: CanonicalStop[]
): RouteCorridorProjection {
  let polyline = getCanonicalRouteGeometry(routeId);
  const stops = customStops && customStops.length > 0 ? customStops : getCanonicalStopsForRoute(routeId);

  // If no detailed polyline exists, fallback to sequential stop coordinates as polyline
  if (!polyline || polyline.length < 2) {
    if (stops.length >= 2) {
      polyline = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    } else {
      polyline = getCanonicalRouteGeometry('route_1') || [];
    }
  }

  const polyProj = projectPointToPolyline(point, polyline);

  // Check distance to all canonical stops on the route
  let nearestStopDist = Infinity;
  let nearestStopName: string | null = null;
  let nearestStopLat: number | undefined;
  let nearestStopLng: number | undefined;

  for (const stop of stops) {
    const d = haversineMeters(point.lat, point.lng, stop.lat, stop.lng);
    if (d < nearestStopDist) {
      nearestStopDist = d;
      nearestStopName = stop.stop_name || stop.name;
      nearestStopLat = stop.lat;
      nearestStopLng = stop.lng;
    }
  }

  // Lock 1 continuous route corridor rule:
  // Must be <= 120m from route polyline OR <= 200m from a named stop
  const isInCorridor = polyProj.crossTrackDistanceMeters <= 120 || nearestStopDist <= 200;

  return {
    crossTrackDistanceMeters: Math.round(polyProj.crossTrackDistanceMeters * 10) / 10,
    routeProgressMeters: Math.round(polyProj.routeProgressMeters * 10) / 10,
    totalRouteLengthMeters: Math.round(polyProj.totalRouteLengthMeters * 10) / 10,
    nearestStopDistanceMeters: Math.round(nearestStopDist * 10) / 10,
    nearestStopName,
    nearestStopLat,
    nearestStopLng,
    isInCorridor,
  };
}

/**
 * Determines whether a route is operating in the reverse direction
 * (Campus -> City, i.e., Evening return trip vs. Morning outbound toward campus).
 */
export function isReverseRouteDirection(shift?: string | null, heading?: number | null): boolean {
  if (shift) {
    const s = shift.toLowerCase().trim();
    if (s.includes('evening') || s.includes('return') || s.includes('inbound') || s.includes('from_campus')) {
      return true;
    }
  }
  return false;
}

/**
 * Lock 2 Directional Window Guard:
 * Evaluates whether an approaching bus is within the legitimate pickup window for a student.
 * Supports direction-aware evaluation for both Morning (outbound) and Evening (return) shifts.
 *
 * Rules:
 * - Already passed: bus is > 150m downstream of student along the route.
 * - Too far upstream: bus is > 4000m (4 km) upstream from student.
 */
export function checkApproachingBusWindow(
  busProgressMeters: number,
  studentProgressMeters: number,
  shiftOrReverse?: string | boolean | null
): ApproachingBusWindowResult {
  const isReverse = typeof shiftOrReverse === 'boolean'
    ? shiftOrReverse
    : isReverseRouteDirection(shiftOrReverse);

  // signedAheadMeters: positive means bus is upstream (approaching) by this many meters.
  // In outbound (Morning, 0 -> L): student is ahead of bus (studentProgress > busProgress).
  // In return (Evening, L -> 0): student is ahead of bus (busProgress > studentProgress).
  const signedAheadMeters = isReverse
    ? busProgressMeters - studentProgressMeters
    : studentProgressMeters - busProgressMeters;

  // busDeltaMeters: how far past the student the bus has traveled (positive means passed).
  const busDeltaMeters = -signedAheadMeters;

  // busDeltaMeters > 150 means bus has already traveled more than 150m past the student
  const alreadyPassed = busDeltaMeters > 150;

  // signedAheadMeters > 4000 means bus is still > 4km away upstream
  const tooFarUpstream = signedAheadMeters > 4000;

  return {
    alreadyPassed,
    tooFarUpstream,
    busDeltaMeters: Math.round(busDeltaMeters),
    signedAheadMeters: Math.round(signedAheadMeters),
  };
}
