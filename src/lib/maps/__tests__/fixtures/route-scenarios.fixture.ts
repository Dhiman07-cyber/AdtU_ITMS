/**
 * src/lib/maps/__tests__/fixtures/route-scenarios.fixture.ts
 *
 * Comprehensive route fixtures and synthetic GPS point streams for verifying
 * route alignment, parallel-road disambiguation, detour hysteresis, and performance budgets.
 */

import type { LatLng } from '@/lib/maps/route-alignment-engine';

/**
 * 1. Straight Road Corridor (1 km east-west along 26.1500N)
 */
export const FIXTURE_STRAIGHT_ROAD: LatLng[] = [
  { lat: 26.1500, lng: 91.7500 },
  { lat: 26.1500, lng: 91.7530 },
  { lat: 26.1500, lng: 91.7560 },
  { lat: 26.1500, lng: 91.7600 },
];

/**
 * 2. Gentle Curve (arc from north to east)
 */
export const FIXTURE_GENTLE_CURVE: LatLng[] = [
  { lat: 26.1500, lng: 91.7500 },
  { lat: 26.1520, lng: 91.7515 },
  { lat: 26.1535, lng: 91.7535 },
  { lat: 26.1545, lng: 91.7560 },
  { lat: 26.1550, lng: 91.7590 },
];

/**
 * 3. Sharp 90-degree Turn (heading North, turns sharply East)
 */
export const FIXTURE_SHARP_TURN: LatLng[] = [
  { lat: 26.1500, lng: 91.7500 },
  { lat: 26.1550, lng: 91.7500 }, // Northward segment
  { lat: 26.1550, lng: 91.7550 }, // Eastward segment after 90 deg corner
];

/**
 * 4. 4-Way Intersection
 */
export const FIXTURE_INTERSECTION_NORTH_SOUTH: LatLng[] = [
  { lat: 26.1450, lng: 91.7500 },
  { lat: 26.1550, lng: 91.7500 },
];
export const FIXTURE_INTERSECTION_EAST_WEST: LatLng[] = [
  { lat: 26.1500, lng: 91.7450 },
  { lat: 26.1500, lng: 91.7550 },
];

/**
 * 5. Parallel Roads (Dual Carriageway / Parallel Service Lane)
 * Road 1: West -> East at lat 26.15000 (~0 heading = 90 deg)
 * Road 2: East -> West at lat 26.15018 (~20m North of Road 1, heading = 270 deg)
 */
export const FIXTURE_PARALLEL_ROAD_OUTBOUND: LatLng[] = [
  { lat: 26.15000, lng: 91.7500 },
  { lat: 26.15000, lng: 91.7550 },
  { lat: 26.15000, lng: 91.7600 },
];
export const FIXTURE_PARALLEL_ROAD_INBOUND: LatLng[] = [
  { lat: 26.15018, lng: 91.7600 },
  { lat: 26.15018, lng: 91.7550 },
  { lat: 26.15018, lng: 91.7500 },
];

/**
 * 6. Loop / U-turn Rotary (e.g. Jalukbari Rotary)
 */
export const FIXTURE_UTURN_LOOP: LatLng[] = [
  { lat: 26.1500, lng: 91.7500 }, // approach northbound
  { lat: 26.1540, lng: 91.7500 },
  { lat: 26.1550, lng: 91.7510 }, // loop crest
  { lat: 26.1540, lng: 91.7520 },
  { lat: 26.1500, lng: 91.7520 }, // return southbound (20m east)
];

/**
 * 7. Dense Stop Sequence (stops spaced ~40m apart)
 */
export const FIXTURE_DENSE_STOPS: LatLng[] = [
  { lat: 26.1500, lng: 91.7500 },
  { lat: 26.1500, lng: 91.7504 },
  { lat: 26.1500, lng: 91.7508 },
  { lat: 26.1500, lng: 91.7512 },
  { lat: 26.1500, lng: 91.7516 },
];

/**
 * 8. Sparse Route Geometry (points spaced 2 km apart)
 */
export const FIXTURE_SPARSE_ROUTE: LatLng[] = [
  { lat: 26.1400, lng: 91.7300 },
  { lat: 26.1580, lng: 91.7500 },
  { lat: 26.1760, lng: 91.7700 },
];

/**
 * 9. Massive 1,000-vertex route for stress testing and performance budgets
 */
export function generateMassiveRoute(verticesCount = 1000): LatLng[] {
  const points: LatLng[] = [];
  const baseLat = 26.1400;
  const baseLng = 91.7300;
  for (let i = 0; i < verticesCount; i++) {
    points.push({
      lat: baseLat + (i * 0.0001) + (Math.sin(i / 10) * 0.00005),
      lng: baseLng + (i * 0.0001) + (Math.cos(i / 10) * 0.00005),
    });
  }
  return points;
}
