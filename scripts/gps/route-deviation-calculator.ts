/**
 * scripts/gps/route-deviation-calculator.ts
 *
 * Geodetic distance calculations, nearest-point projection onto route polyline,
 * and safe snapping algorithm with corridor threshold and temporal hysteresis.
 */

import { haversineDistance, type LatLng } from './gps-route-fixture';

export interface RouteProjectionResult {
  nearestPoint: LatLng;
  distanceMeters: number;
  segmentIndex: number;
  fractionAlongSegment: number;
}

export interface SnappingDecision {
  rawPoint: LatLng;
  snappedPoint: LatLng;
  displayPoint: LatLng;
  distanceToRouteMeters: number;
  mode: 'RAW' | 'SNAPPED' | 'OFF_ROUTE';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  consecutiveOffRouteCount: number;
}

/**
 * Project point P onto great-circle segment [A, B].
 * Uses cross-track and along-track spherical distance formulas.
 */
export function projectPointToSegment(P: LatLng, A: LatLng, B: LatLng): { nearest: LatLng; distanceM: number; t: number } {
  const dAB = haversineDistance(A, B);
  if (dAB === 0) {
    return { nearest: { ...A }, distanceM: haversineDistance(P, A), t: 0 };
  }

  // Linear planar approximation in equirectangular projection centered at A
  const cosLat = Math.cos(((A.lat + B.lat) / 2 * Math.PI) / 180);
  const ax = A.lng * cosLat;
  const ay = A.lat;
  const bx = B.lng * cosLat;
  const by = B.lat;
  const px = P.lng * cosLat;
  const py = P.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t)); // clamp to segment bounds

  const nearestLng = (ax + t * dx) / cosLat;
  const nearestLat = ay + t * dy;
  const nearest: LatLng = { lat: nearestLat, lng: nearestLng };
  const distanceM = haversineDistance(P, nearest);

  return { nearest, distanceM, t };
}

/**
 * Finds the closest point on an entire polyline to point P.
 */
export function findNearestPointOnRoute(P: LatLng, polyline: LatLng[]): RouteProjectionResult {
  if (polyline.length === 0) {
    return { nearestPoint: P, distanceMeters: 0, segmentIndex: -1, fractionAlongSegment: 0 };
  }
  if (polyline.length === 1) {
    return { nearestPoint: polyline[0], distanceMeters: haversineDistance(P, polyline[0]), segmentIndex: 0, fractionAlongSegment: 0 };
  }

  let minDistance = Infinity;
  let bestNearest = polyline[0];
  let bestSegment = 0;
  let bestFraction = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const proj = projectPointToSegment(P, polyline[i], polyline[i + 1]);
    if (proj.distanceM < minDistance) {
      minDistance = proj.distanceM;
      bestNearest = proj.nearest;
      bestSegment = i;
      bestFraction = proj.t;
    }
  }

  return {
    nearestPoint: bestNearest,
    distanceMeters: minDistance,
    segmentIndex: bestSegment,
    fractionAlongSegment: bestFraction,
  };
}

/**
 * State machine for safe route-constrained positioning.
 * Enforces:
 *  - Route corridor threshold: max 25m lateral deviation allowed for snapping
 *  - Temporal hysteresis: 3 consecutive off-corridor points required before declaring OFF_ROUTE
 *  - 2 consecutive on-corridor points required before re-engaging snapping
 */
export class SafeRouteSnapper {
  private corridorMaxMeters: number;
  private offRouteThresholdSteps: number;
  private consecutiveOffCorridor = 0;
  private consecutiveOnCorridor = 0;
  private isCurrentlyOffRoute = false;

  constructor(corridorMaxMeters = 25, offRouteThresholdSteps = 3) {
    this.corridorMaxMeters = corridorMaxMeters;
    this.offRouteThresholdSteps = offRouteThresholdSteps;
  }

  processPoint(rawPoint: LatLng, routePolyline: LatLng[]): SnappingDecision {
    const projection = findNearestPointOnRoute(rawPoint, routePolyline);
    const dist = projection.distanceMeters;

    if (dist <= this.corridorMaxMeters) {
      this.consecutiveOnCorridor++;
      this.consecutiveOffCorridor = 0;
      if (this.consecutiveOnCorridor >= 2) {
        this.isCurrentlyOffRoute = false;
      }
    } else {
      this.consecutiveOffCorridor++;
      this.consecutiveOnCorridor = 0;
      if (this.consecutiveOffCorridor >= this.offRouteThresholdSteps) {
        this.isCurrentlyOffRoute = true;
      }
    }

    if (this.isCurrentlyOffRoute) {
      // Genuine sustained route deviation: NEVER snap to the wrong road!
      return {
        rawPoint,
        snappedPoint: projection.nearestPoint,
        displayPoint: rawPoint, // PRESERVE RAW COORDINATE
        distanceToRouteMeters: Math.round(dist * 10) / 10,
        mode: 'OFF_ROUTE',
        confidence: 'HIGH',
        consecutiveOffRouteCount: this.consecutiveOffCorridor,
      };
    }

    if (dist <= this.corridorMaxMeters) {
      // Within road corridor: safe to snap
      return {
        rawPoint,
        snappedPoint: projection.nearestPoint,
        displayPoint: projection.nearestPoint, // ROAD-SNAPPED
        distanceToRouteMeters: Math.round(dist * 10) / 10,
        mode: 'SNAPPED',
        confidence: dist < 10 ? 'HIGH' : 'MEDIUM',
        consecutiveOffRouteCount: 0,
      };
    }

    // Ambiguous buffer zone (1-2 points off corridor, awaiting hysteresis confirmation)
    return {
      rawPoint,
      snappedPoint: projection.nearestPoint,
      displayPoint: rawPoint, // preserve raw during uncertainty
      distanceToRouteMeters: Math.round(dist * 10) / 10,
      mode: 'RAW',
      confidence: 'LOW',
      consecutiveOffRouteCount: this.consecutiveOffCorridor,
    };
  }

  reset() {
    this.consecutiveOffCorridor = 0;
    this.consecutiveOnCorridor = 0;
    this.isCurrentlyOffRoute = false;
  }
}
