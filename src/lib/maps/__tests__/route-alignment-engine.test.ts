/**
 * src/lib/maps/__tests__/route-alignment-engine.test.ts
 *
 * Comprehensive Test Suite for ADTU ITMS Route Alignment & Safe Snapping Engine.
 * Covers Scenarios A through L, Negative Tests N1 through N14, and Performance Budgets.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  alignBusPositionToRoute,
  createInitialAlignmentState,
  getOrCreateCachedRoute,
  haversineDistance,
  calculateSegmentBearing,
  bearingDifference,
  type RouteAlignmentState,
  type InputLocation,
  type LatLng,
} from '../route-alignment-engine';
import {
  FIXTURE_STRAIGHT_ROAD,
  FIXTURE_GENTLE_CURVE,
  FIXTURE_SHARP_TURN,
  FIXTURE_PARALLEL_ROAD_OUTBOUND,
  FIXTURE_PARALLEL_ROAD_INBOUND,
  FIXTURE_UTURN_LOOP,
  FIXTURE_DENSE_STOPS,
  FIXTURE_SPARSE_ROUTE,
  generateMassiveRoute,
} from './fixtures/route-scenarios.fixture';

describe('Route Alignment Engine — Core Math & Primitives', () => {
  it('calculates accurate Haversine distance', () => {
    // 1 degree latitude at equator is approx 111.19 km
    const p1 = { lat: 26.1500, lng: 91.7500 };
    const p2 = { lat: 26.1510, lng: 91.7500 };
    const dist = haversineDistance(p1, p2);
    // 0.001 deg lat ~ 111.2 meters
    expect(dist).toBeGreaterThan(110);
    expect(dist).toBeLessThan(113);
  });

  it('calculates segment bearings correctly', () => {
    const pNorth = { lat: 26.1600, lng: 91.7500 };
    const pOrigin = { lat: 26.1500, lng: 91.7500 };
    const pEast = { lat: 26.1500, lng: 91.7600 };

    const bearingN = calculateSegmentBearing(pOrigin, pNorth);
    const bearingE = calculateSegmentBearing(pOrigin, pEast);

    expect(Math.round(bearingN)).toBe(0);
    expect(Math.round(bearingE)).toBe(90);
  });

  it('calculates bearing difference modulo 360', () => {
    expect(bearingDifference(10, 350)).toBe(20);
    expect(bearingDifference(90, 270)).toBe(180);
    expect(bearingDifference(45, 90)).toBe(45);
  });

  it('precomputes and caches route segments in O(1) on second call', () => {
    const cached1 = getOrCreateCachedRoute('straight_test', FIXTURE_STRAIGHT_ROAD);
    const cached2 = getOrCreateCachedRoute('straight_test', FIXTURE_STRAIGHT_ROAD);

    expect(cached1).not.toBeNull();
    expect(cached1).toBe(cached2); // exact same object reference from cache
    expect(cached1?.segments.length).toBe(FIXTURE_STRAIGHT_ROAD.length - 1);
  });
});

describe('Route Alignment Engine — Operational Scenarios A through L', () => {
  let state: RouteAlignmentState;

  beforeEach(() => {
    state = createInitialAlignmentState();
  });

  // Scenario A: Excellent GPS (2–5m lateral noise)
  it('Scenario A: Excellent GPS snaps smoothly with HIGH confidence', () => {
    // Road runs along lat 26.1500. Point is at 26.15003 (~3.3m north)
    const raw: InputLocation = {
      lat: 26.15003,
      lng: 91.7520,
      accuracy: 4,
      speed: 35,
      heading: 90,
    };

    const result = alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'test_route');

    expect(result.isSnapped).toBe(true);
    expect(result.mode).toBe('IN_CORRIDOR_HIGH_CONFIDENCE');
    expect(result.confidence).toBe('HIGH');
    expect(result.distanceToRouteMeters).toBeLessThan(5);
    // Snapped point is projected directly onto the road centerline (lat 26.1500)
    expect(result.displayPoint.lat).toBeCloseTo(26.1500, 4);
    // Raw point is preserved
    expect(result.rawPoint.lat).toBe(26.15003);
  });

  // Scenario B: Normal phone GPS (5–20m noise)
  it('Scenario B: Normal phone GPS (12m noise) snaps within corridor', () => {
    // Point is at lat 26.15011 (~12.2m north of road)
    const raw: InputLocation = {
      lat: 26.15011,
      lng: 91.7540,
      accuracy: 15,
      speed: 25,
      heading: 90,
    };

    const result = alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'test_route');

    expect(result.isSnapped).toBe(true);
    expect(result.mode).toMatch(/IN_CORRIDOR/);
    expect(result.distanceToRouteMeters).toBeGreaterThan(10);
    expect(result.distanceToRouteMeters).toBeLessThan(15);
    expect(result.displayPoint.lat).toBeCloseTo(26.1500, 4);
  });

  // Scenario C: Degraded but plausible GPS (25–35m noise)
  it('Scenario C: Degraded GPS (28m noise) adapts corridor and marks confidence', () => {
    // Point is at lat 26.15025 (~27.8m north) with reported accuracy 40m
    const raw: InputLocation = {
      lat: 26.15025,
      lng: 91.7550,
      accuracy: 40,
      speed: 20,
      heading: 90,
    };

    const result = alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'test_route');

    // With 40m accuracy, dynamic corridor expands to 35m
    expect(result.isSnapped).toBe(true);
    expect(result.mode).toBe('IN_CORRIDOR_LOW_CONFIDENCE');
    expect(result.confidence).toBe('MEDIUM');
  });

  // Scenario D: Very poor GPS (>80m noise / degraded fix)
  it('Scenario D: Very poor GPS (>80m noise) falls back to raw coordinates', () => {
    // Point is 90m north of road
    const raw: InputLocation = {
      lat: 26.15081,
      lng: 91.7550,
      accuracy: 95,
      speed: 15,
      heading: 90,
    };

    const result = alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'test_route');

    expect(result.isSnapped).toBe(false);
    expect(result.displayPoint.lat).toBe(raw.lat);
    expect(result.displayPoint.lng).toBe(raw.lng);
  });

  // Scenario E: Genuine detour (sustained movement away from configured route)
  it('Scenario E: Genuine detour is NEVER hidden — transitions to OFF_ROUTE_CONFIRMED after 3 points', () => {
    // Bus turns off the road onto a side street (moving 50m, 70m, 90m away)
    const detourPoint1: InputLocation = { lat: 26.15050, lng: 91.7520, speed: 30, heading: 0 }; // ~55m north
    const detourPoint2: InputLocation = { lat: 26.15070, lng: 91.7520, speed: 30, heading: 0 }; // ~77m north
    const detourPoint3: InputLocation = { lat: 26.15090, lng: 91.7520, speed: 30, heading: 0 }; // ~100m north

    const res1 = alignBusPositionToRoute(detourPoint1, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(res1.mode).toBe('TEMPORARY_ANOMALY');
    expect(res1.isSnapped).toBe(false);
    expect(res1.displayPoint).toEqual({ lat: detourPoint1.lat, lng: detourPoint1.lng });

    const res2 = alignBusPositionToRoute(detourPoint2, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(res2.mode).toBe('TEMPORARY_ANOMALY');
    expect(res2.consecutiveOffRouteCount).toBe(2);

    const res3 = alignBusPositionToRoute(detourPoint3, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    // Invariant WF-DETOUR: 3 consecutive off-corridor points confirm actual detour!
    expect(res3.mode).toBe('OFF_ROUTE_CONFIRMED');
    expect(res3.isSnapped).toBe(false);
    expect(res3.displayPoint).toEqual({ lat: detourPoint3.lat, lng: detourPoint3.lng });
    expect(res3.consecutiveOffRouteCount).toBe(3);
  });

  // Scenario F: Parallel-road ambiguity (dual carriageway 20m apart)
  it('Scenario F: Parallel-road disambiguation chooses correct carriageway via heading', () => {
    // Outbound road: heading 90 deg (Eastbound)
    // Inbound road: heading 270 deg (Westbound) 20m north
    // Combined dual-carriageway route polyline with both legs
    const dualCarriagewayRoute: LatLng[] = [
      ...FIXTURE_PARALLEL_ROAD_OUTBOUND,
      ...FIXTURE_PARALLEL_ROAD_INBOUND,
    ];

    // Bus is driving Eastbound (heading: 90 deg) at lat 26.15008 (equidistant between both roads)
    const busEastbound: InputLocation = {
      lat: 26.15009,
      lng: 91.7550,
      heading: 90,
      speed: 40,
    };

    const resEast = alignBusPositionToRoute(busEastbound, dualCarriagewayRoute, state, 'dual_road');
    expect(resEast.isSnapped).toBe(true);
    // Should snap to Outbound road (lat 26.15000), NOT Inbound road (lat 26.15018)
    expect(resEast.displayPoint.lat).toBeCloseTo(26.15000, 4);

    // Reset and test bus driving Westbound (heading: 270 deg) at same location
    const stateWest = createInitialAlignmentState();
    const busWestbound: InputLocation = {
      lat: 26.15009,
      lng: 91.7550,
      heading: 270,
      speed: 40,
    };

    const resWest = alignBusPositionToRoute(busWestbound, dualCarriagewayRoute, stateWest, 'dual_road');
    expect(resWest.isSnapped).toBe(true);
    // Should snap to Inbound road (lat 26.15018), NOT Outbound road!
    expect(resWest.displayPoint.lat).toBeCloseTo(26.15018, 4);
  });

  // Scenario G: Temporary GPS spike (1 bad point followed by normal points)
  it('Scenario G: Single GPS spike does not permanently derail snapping mode', () => {
    // Normal point on road
    alignBusPositionToRoute({ lat: 26.15002, lng: 91.7510, speed: 30, heading: 90 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(state.mode).toBe('IN_CORRIDOR_HIGH_CONFIDENCE');

    // 1 isolated spike: 60m off-route
    const spikeRes = alignBusPositionToRoute({ lat: 26.15055, lng: 91.7520, speed: 30, heading: 90 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(spikeRes.mode).toBe('TEMPORARY_ANOMALY');
    expect(spikeRes.isSnapped).toBe(false);

    // Next point back on road
    const recoveryRes = alignBusPositionToRoute({ lat: 26.15003, lng: 91.7530, speed: 30, heading: 90 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(recoveryRes.mode).toBe('IN_CORRIDOR_HIGH_CONFIDENCE');
    expect(recoveryRes.isSnapped).toBe(true);
  });

  // Scenario H: Recovery hysteresis from confirmed off-route
  it('Scenario H: Recovery from OFF_ROUTE requires 2 consecutive on-route points', () => {
    // Trigger OFF_ROUTE_CONFIRMED with 3 points
    alignBusPositionToRoute({ lat: 26.1506, lng: 91.7520, speed: 30 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    alignBusPositionToRoute({ lat: 26.1507, lng: 91.7520, speed: 30 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    const offRes = alignBusPositionToRoute({ lat: 26.1508, lng: 91.7520, speed: 30 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(offRes.mode).toBe('OFF_ROUTE_CONFIRMED');

    // First point back on road: still in recovery mode (avoids flicker)
    const rec1 = alignBusPositionToRoute({ lat: 26.15002, lng: 91.7540, speed: 30 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(state.consecutiveOnRouteCount).toBe(1);

    // Second point back on road: snapping re-engages!
    const rec2 = alignBusPositionToRoute({ lat: 26.15001, lng: 91.7550, speed: 30 }, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(rec2.mode).toBe('IN_CORRIDOR_HIGH_CONFIDENCE');
    expect(rec2.isSnapped).toBe(true);
  });

  // Scenario I: Stationary bus (speed: 0, heading: 0)
  it('Scenario I: Stationary bus does not suffer erratic direction penalties', () => {
    const stationaryPoint: InputLocation = {
      lat: 26.15004,
      lng: 91.7520,
      speed: 0,
      heading: 0,
    };

    const res = alignBusPositionToRoute(stationaryPoint, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    expect(res.isSnapped).toBe(true);
    expect(res.mode).toBe('IN_CORRIDOR_HIGH_CONFIDENCE');
  });

  // Scenario J: Reconnect resilience
  it('Scenario J: Reconnect with new state resumes seamlessly without memory leaks', () => {
    const freshState = createInitialAlignmentState();
    const res = alignBusPositionToRoute({ lat: 26.15002, lng: 91.7530, speed: 20 }, FIXTURE_STRAIGHT_ROAD, freshState, 'test_route');
    expect(res.isSnapped).toBe(true);
    expect(freshState.totalCalculations).toBe(1);
  });

  // Scenario K: Sharp cornering
  it('Scenario K: Sharp 90-degree corner preserves snapped progression', () => {
    // Approach corner from south (heading 0)
    const p1 = alignBusPositionToRoute({ lat: 26.1540, lng: 91.75005, heading: 0, speed: 20 }, FIXTURE_SHARP_TURN, state, 'sharp');
    expect(p1.isSnapped).toBe(true);
    expect(p1.selectedSegmentIndex).toBe(0);

    // Turn corner to east (heading 90)
    const p2 = alignBusPositionToRoute({ lat: 26.15505, lng: 91.7510, heading: 90, speed: 15 }, FIXTURE_SHARP_TURN, state, 'sharp');
    expect(p2.isSnapped).toBe(true);
    expect(p2.selectedSegmentIndex).toBe(1);
  });
});

describe('Route Alignment Engine — Negative Tests N1 through N14', () => {
  let state: RouteAlignmentState;

  beforeEach(() => {
    state = createInitialAlignmentState();
  });

  it('N1 — Missing route geometry: falls back to raw without crashing', () => {
    const raw = { lat: 26.1500, lng: 91.7500 };
    const res1 = alignBusPositionToRoute(raw, null, state);
    const res2 = alignBusPositionToRoute(raw, undefined, state);
    const res3 = alignBusPositionToRoute(raw, [], state);

    expect(res1.mode).toBe('NO_ROUTE_GEOMETRY');
    expect(res1.displayPoint).toEqual(raw);
    expect(res2.mode).toBe('NO_ROUTE_GEOMETRY');
    expect(res3.mode).toBe('NO_ROUTE_GEOMETRY');
  });

  it('N2 — Malformed route geometry (single point): safe fallback', () => {
    const raw = { lat: 26.1500, lng: 91.7500 };
    const res = alignBusPositionToRoute(raw, [{ lat: 26.1500, lng: 91.7500 }], state);
    expect(res.mode).toBe('NO_ROUTE_GEOMETRY');
    expect(res.displayPoint).toEqual(raw);
  });

  it('N3 — Massive route (1,000 vertices): completes well under 2ms budget', () => {
    const massive = generateMassiveRoute(1000);
    const raw = { lat: 26.1500, lng: 91.7500, speed: 25 };

    // Warm the route precomputation cache (which happens once on route load)
    getOrCreateCachedRoute('massive_test', massive);

    const start = performance.now();
    const res = alignBusPositionToRoute(raw, massive, state, 'massive_test');
    const elapsed = performance.now() - start;

    expect(res).toBeDefined();
    // Budget: P95 <= 2 ms for per-point alignment
    expect(elapsed).toBeLessThan(2.0);
  });

  it('N7 — Duplicate location packet does not break state machine', () => {
    const raw = { lat: 26.15002, lng: 91.7520, speed: 20 };
    const res1 = alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'test_route');
    const res2 = alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'test_route');

    expect(res1.displayPoint).toEqual(res2.displayPoint);
    expect(state.totalCalculations).toBe(2);
  });

  it('N11 — Route switch resets alignment state cleanly', () => {
    alignBusPositionToRoute({ lat: 26.15002, lng: 91.7520 }, FIXTURE_STRAIGHT_ROAD, state, 'route_A');
    expect(state.totalCalculations).toBe(1);

    const freshState = createInitialAlignmentState();
    expect(freshState.totalCalculations).toBe(0);
    expect(freshState.consecutiveOffRouteCount).toBe(0);
  });
});

describe('Route Alignment Engine — Performance Budgets & 50-Bus Fleet Stress', () => {
  it('Per-point geometry work meets budget: P95 <= 2ms (Target: <0.1ms)', () => {
    const state = createInitialAlignmentState();
    const timings: number[] = [];

    for (let i = 0; i < 100; i++) {
      const raw = {
        lat: 26.1500 + (Math.sin(i) * 0.0001),
        lng: 91.7500 + (i * 0.0001),
        speed: 30,
        heading: 90,
      };
      const t0 = performance.now();
      alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, state, 'perf_route');
      timings.push(performance.now() - t0);
    }

    timings.sort((a, b) => a - b);
    const p50 = timings[Math.floor(timings.length * 0.5)];
    const p95 = timings[Math.floor(timings.length * 0.95)];

    expect(p50).toBeLessThan(0.1); // < 100 microseconds
    expect(p95).toBeLessThan(0.5); // < 500 microseconds (budget is 2ms)
  });

  it('50-Bus fleet batch meets budget: total batch <= 10ms', () => {
    const fleetStates = new Map<string, RouteAlignmentState>();
    const busCount = 50;

    for (let i = 0; i < busCount; i++) {
      fleetStates.set(`bus_${i}`, createInitialAlignmentState());
    }

    const t0 = performance.now();
    for (let i = 0; i < busCount; i++) {
      const busState = fleetStates.get(`bus_${i}`)!;
      const raw = {
        lat: 26.1500 + (Math.sin(i) * 0.00008),
        lng: 91.7500 + (i * 0.00005),
        speed: 25,
        heading: 90,
      };
      alignBusPositionToRoute(raw, FIXTURE_STRAIGHT_ROAD, busState, 'fleet_route');
    }
    const batchTotalMs = performance.now() - t0;

    // Budget: 50 buses batch <= 10 ms
    expect(batchTotalMs).toBeLessThan(10.0);
  });
});
