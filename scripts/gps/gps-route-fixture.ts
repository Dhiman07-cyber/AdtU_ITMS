/**
 * scripts/gps/gps-route-fixture.ts
 *
 * Deterministic route geometry, waypoint interpolation, and noise profiles
 * for ADTU ITMS GPS forensic audit and Playwright simulation.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutePoint extends LatLng {
  timestamp: string;
  accuracy: number;
  speed: number;
  heading: number;
  stepIndex: number;
  isOffRoute?: boolean;
  deviationMeters?: number;
}

export interface NoiseProfile {
  name: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  lateralErrorMeters: number;
  reportedAccuracyMeters: number;
}

export const NOISE_PROFILES: Record<string, NoiseProfile> = {
  NONE: { name: 'NONE', lateralErrorMeters: 0, reportedAccuracyMeters: 5 },
  LOW: { name: 'LOW', lateralErrorMeters: 4, reportedAccuracyMeters: 8 },      // ±3–5 m
  MEDIUM: { name: 'MEDIUM', lateralErrorMeters: 15, reportedAccuracyMeters: 20 }, // ±10–20 m
  HIGH: { name: 'HIGH', lateralErrorMeters: 40, reportedAccuracyMeters: 60 },   // ±30–50 m
  EXTREME: { name: 'EXTREME', lateralErrorMeters: 180, reportedAccuracyMeters: 180 }, // >150m (exceeds bounds cap)
};

// Earth radius in meters
const R_EARTH = 6371000;

export function haversineDistance(p1: LatLng, p2: LatLng): number {
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const la1 = (p1.lat * Math.PI) / 180;
  const la2 = (p2.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

export function calculateBearing(from: LatLng, to: LatLng): number {
  const dy = to.lat - from.lat;
  const dx = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180);
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function offsetPoint(origin: LatLng, distanceMeters: number, bearingDeg: number): LatLng {
  const δ = distanceMeters / R_EARTH;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (origin.lat * Math.PI) / 180;
  const λ1 = (origin.lng * Math.PI) / 180;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return {
    lat: (φ2 * 180) / Math.PI,
    lng: (λ2 * 180) / Math.PI,
  };
}

/**
 * Deterministic PRNG using Mulberry32 algorithm.
 */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard Guwahati University Route Polyline (Campus to Panikhaiti / Narengi corridor).
 * Real-world GPS corridor within Guwahati map bounds [91.45, 26.02] to [91.90, 26.27].
 */
export const ADTU_CANONICAL_ROUTE: LatLng[] = [
  { lat: 26.1445, lng: 91.7362 }, // Stop 1: Paltan Bazaar transit hub
  { lat: 26.1512, lng: 91.7485 }, // Stop 2: Ulubari
  { lat: 26.1580, lng: 91.7650 }, // Stop 3: Bhangagarh
  { lat: 26.1595, lng: 91.7820 }, // Stop 4: Ganeshguri
  { lat: 26.1620, lng: 91.7990 }, // Stop 5: Dispur Super Market
  { lat: 26.1700, lng: 91.8210 }, // Stop 6: Six Mile
  { lat: 26.1780, lng: 91.8420 }, // Stop 7: Khanapara / Panikhaiti turn
  { lat: 26.1910, lng: 91.8540 }, // Stop 8: Narengi approach
  { lat: 26.2019, lng: 91.8615 }, // Stop 9: Assam down town University Campus
];

export const GUWAHATI_ROUTE_COORDS = ADTU_CANONICAL_ROUTE;

/**
 * Generator that creates a timed series of GPS points along a polyline.
 */
export class GpsStreamGenerator {
  private route: LatLng[];
  private seed: number;
  private rng: () => number;

  constructor(route: LatLng[] = ADTU_CANONICAL_ROUTE, seed: number = 20260917) {
    this.route = route;
    this.seed = seed;
    this.rng = createRng(seed);
  }

  /**
   * Generates a sequence of points along the route with specified duration and cadence.
   */
  generateRouteStream(options: {
    startEpochMs: number;
    intervalSec: number;
    totalPoints: number;
    speedKmh?: number;
    noise?: NoiseProfile;
    injectDeviation?: { startStep: number; durationSteps: number; lateralOffsetM: number };
    injectSpike?: { atStep: number; offsetM: number };
  }): RoutePoint[] {
    const {
      startEpochMs,
      intervalSec,
      totalPoints,
      speedKmh = 30,
      noise = NOISE_PROFILES.NONE,
      injectDeviation,
      injectSpike,
    } = options;

    const points: RoutePoint[] = [];
    let currentSegmentIndex = 0;
    let progressAlongSegment = 0; // 0..1
    const speedMps = (speedKmh * 1000) / 3600;
    const distancePerStepMeters = speedMps * intervalSec;

    for (let step = 0; step < totalPoints; step++) {
      const p1 = this.route[currentSegmentIndex];
      const p2 = this.route[Math.min(currentSegmentIndex + 1, this.route.length - 1)];
      const segmentLength = haversineDistance(p1, p2);
      const heading = calculateBearing(p1, p2);

      // True centerline point on the road
      const t = segmentLength > 0 ? Math.min(1, progressAlongSegment) : 0;
      const trueLat = p1.lat + (p2.lat - p1.lat) * t;
      const trueLng = p1.lng + (p2.lng - p1.lng) * t;
      let point: LatLng = { lat: trueLat, lng: trueLng };
      let isOffRoute = false;
      let totalDeviationMeters = 0;

      // 1. Apply lateral GPS noise if requested
      if (noise.lateralErrorMeters > 0) {
        const errorDist = (this.rng() * 2 - 1) * noise.lateralErrorMeters;
        const errorBearing = (heading + 90) % 360; // perpendicular to direction of travel
        point = offsetPoint(point, errorDist, errorBearing);
        totalDeviationMeters += Math.abs(errorDist);
      }

      // 2. Apply persistent route deviation scenario (vehicle drives off route)
      if (injectDeviation && step >= injectDeviation.startStep && step < injectDeviation.startStep + injectDeviation.durationSteps) {
        const devBearing = (heading + 90) % 360;
        point = offsetPoint(point, injectDeviation.lateralOffsetM, devBearing);
        isOffRoute = true;
        totalDeviationMeters += injectDeviation.lateralOffsetM;
      }

      // 3. Apply single-point outlier spike
      if (injectSpike && step === injectSpike.atStep) {
        point = offsetPoint(point, injectSpike.offsetM, (heading + 90) % 360);
        isOffRoute = true;
        totalDeviationMeters += injectSpike.offsetM;
      }

      const timestamp = new Date(startEpochMs + step * intervalSec * 1000).toISOString();
      const accuracy = noise.reportedAccuracyMeters + (this.rng() * 4 - 2);

      points.push({
        lat: Number(point.lat.toFixed(6)),
        lng: Number(point.lng.toFixed(6)),
        speed: speedKmh,
        heading: Math.round(heading),
        accuracy: Math.max(1, Math.round(accuracy)),
        timestamp,
        stepIndex: step,
        isOffRoute,
        deviationMeters: Math.round(totalDeviationMeters * 10) / 10,
      });

      // Advance position along polyline
      if (segmentLength > 0) {
        progressAlongSegment += distancePerStepMeters / segmentLength;
        while (progressAlongSegment >= 1 && currentSegmentIndex < this.route.length - 2) {
          progressAlongSegment -= 1;
          currentSegmentIndex++;
        }
      }
    }

    return points;
  }
}
