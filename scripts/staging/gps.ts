/**
 * Deterministic route-following GPS generator.
 *
 * ponytail: the DB stores only stop NAMES (no canonical stop coordinates exist
 * anywhere in the system — the production app uses device GPS + a campus
 * constant). So we generate a deterministic road-like polyline per route seed,
 * bounded inside the Guwahati map box (same bounds the client enforces).
 * Determinism = every run of a given busId traverses the identical path,
 * which is what makes driver/student trace correlation exact.
 */

// Guwahati bounds enforced by src/components/maps/GuwahatiMap.tsx
const LAT_MIN = 26.02, LAT_MAX = 26.27;
const LNG_MIN = 91.45, LNG_MAX = 91.9;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Haversine distance in meters. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const dy = to.lat - from.lat;
  const dx = (to.lng - from.lng) * Math.cos(from.lat * Math.PI / 180);
  const deg = Math.atan2(dx, dy) * 180 / Math.PI;
  return (deg + 360) % 360;
}

export interface GpsFix { lat: number; lng: number; speedMs: number; headingDeg: number; accuracyM: number; }

/**
 * A bus route: a deterministic polyline, traversed forward at realistic speed,
 * with dwell pauses at waypoints (stops). Ends by teleport is never emitted —
 * on reaching the end the track reverses (out-and-back, like a real shift).
 */
export class RouteGps {
  private points: { lat: number; lng: number }[] = [];
  private cumulative: number[] = []; // meters from start
  private totalMeters = 0;
  private posMeters = 0;
  private dir = 1;
  private dwellUntilMs = 0;
  private rand: () => number;

  constructor(seedKey: string, waypointCount = 6) {
    const rand = mulberry32(hashSeed(seedKey));
    this.rand = rand;
    // Anchor inside bounds, then chain waypoints 0.5–1.5 km apart.
    let lat = LAT_MIN + 0.02 + rand() * (LAT_MAX - LAT_MIN - 0.04);
    let lng = LNG_MIN + 0.03 + rand() * (LNG_MAX - LNG_MIN - 0.06);
    this.points.push({ lat, lng });
    for (let i = 1; i < waypointCount; i++) {
      const distM = 500 + rand() * 1000;
      const bearing = rand() * 2 * Math.PI;
      lat = clamp(lat + (distM * Math.cos(bearing)) / 111320, LAT_MIN + 0.01, LAT_MAX - 0.01);
      lng = clamp(lng + (distM * Math.sin(bearing)) / (111320 * Math.cos(lat * Math.PI / 180)), LNG_MIN + 0.01, LNG_MAX - 0.01);
      this.points.push({ lat, lng });
    }
    let acc = 0;
    this.cumulative.push(0);
    for (let i = 1; i < this.points.length; i++) {
      acc += haversineM(this.points[i - 1], this.points[i]);
      this.cumulative.push(acc);
    }
    this.totalMeters = acc;
  }

  /**
   * Advance by elapsed wall-clock time. Returns the fix for `nowMs`.
   * Bus dwells at each waypoint for 10–30 s (stop behavior).
   */
  fix(nowMs: number, previousFix?: GpsFix): GpsFix {
    if (nowMs < this.dwellUntilMs) {
      // Dwelling at a stop: stay put, report ~0 speed, and don't let the
      // dwell time leak into the next advance step.
      this.lastAdvanceMs = nowMs;
      const at = this.locate(this.posMeters);
      return { lat: at.lat, lng: at.lng, speedMs: 0, headingDeg: previousFix?.headingDeg ?? 0, accuracyM: this.accuracy() };
    }
    // Cruise 25–40 km/h with ±15% wobble (previous speed kept implicitly by caller interval).
    const speedMs = 7 + this.rand() * 4;
    return { ...this.advance(nowMs, speedMs), speedMs, accuracyM: this.accuracy() };
  }

  private lastAdvanceMs = 0;
  private lastDwelledWaypoint = -1;
  private advance(nowMs: number, speedMs: number): { lat: number; lng: number; headingDeg: number } {
    const dtMs = this.lastAdvanceMs ? Math.max(0, nowMs - this.lastAdvanceMs) : 0;
    this.lastAdvanceMs = nowMs;
    this.posMeters += (speedMs * dtMs) / 1000 * this.dir;

    if (this.posMeters >= this.totalMeters) { this.posMeters = this.totalMeters; this.dir = -1; this.dwell(nowMs); }
    if (this.posMeters <= 0) { this.posMeters = 0; this.dir = 1; this.dwell(nowMs); }

    // Dwell when crossing an exact waypoint (arriving at a stop).
    // lastDwelledAt prevents re-triggering on the same waypoint forever.
    let dwelledWaypoint = -1;
    for (let i = 1; i < this.cumulative.length - 1; i++) {
      if (Math.abs(this.posMeters - this.cumulative[i]) < speedMs * 2) { dwelledWaypoint = i; break; }
    }
    if (dwelledWaypoint >= 0 && this.lastDwelledWaypoint !== dwelledWaypoint) {
      this.lastDwelledWaypoint = dwelledWaypoint;
      this.dwell(nowMs);
    } else if (dwelledWaypoint < 0) {
      this.lastDwelledWaypoint = -1;
    }

    const at = this.locate(this.posMeters);
    const ahead = this.locate(this.posMeters + 25 * this.dir);
    return { lat: at.lat, lng: at.lng, headingDeg: bearingDeg(at, ahead) };
  }

  private dwell(nowMs: number) {
    this.dwellUntilMs = nowMs + 10000 + this.rand() * 20000;
  }

  private accuracy(): number {
    return 5 + this.rand() * 20; // 5–25 m, inside the <=150 m HTTP guard
  }

  private locate(distM: number): { lat: number; lng: number } {
    const d = Math.max(0, Math.min(this.totalMeters, distM));
    let i = this.cumulative.findIndex((c) => c >= d);
    if (i < 0) i = this.cumulative.length - 1;
    if (i === 0) return this.points[0];
    const segStart = this.cumulative[i - 1];
    const segLen = this.cumulative[i] - segStart || 1;
    const t = (d - segStart) / segLen;
    const a = this.points[i - 1], b = this.points[i];
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }

  get distanceTotalM(): number { return this.totalMeters; }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
