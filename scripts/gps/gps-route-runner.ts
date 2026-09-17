/**
 * scripts/gps/gps-route-runner.ts
 *
 * Comprehensive forensic GPS simulation and mathematical deviation benchmark.
 * Run with: npx tsx scripts/gps/gps-route-runner.ts
 */

import {
  ADTU_CANONICAL_ROUTE,
  GpsStreamGenerator,
  haversineDistance,
  NOISE_PROFILES,
  type RoutePoint,
} from './gps-route-fixture';
import {
  findNearestPointOnRoute,
  SafeRouteSnapper,
  type SnappingDecision,
} from './route-deviation-calculator';
import {
  analyzeCadence,
  bucketDeviations,
  computeDistribution,
  type DeviationBuckets,
  type NumericDistribution,
} from './gps-metrics';
import {
  createAuditArtifactDirectory,
  saveCsvArtifact,
  saveJsonArtifact,
} from './gps-report';

export interface ScenarioResult {
  scenarioName: string;
  pointsGenerated: number;
  noiseProfile: string;
  rawDeviationStats: NumericDistribution;
  snappedDeviationStats: NumericDistribution;
  deviationBuckets: DeviationBuckets;
  modes: { RAW: number; SNAPPED: number; OFF_ROUTE: number };
  samplePoints: {
    step: number;
    rawLat: number;
    rawLng: number;
    displayLat: number;
    displayLng: number;
    distanceToRouteM: number;
    mode: string;
    isOffRoute?: boolean;
  }[];
}

export function runForensicGpsBenchmark(): {
  runId: string;
  artifactDir: string;
  scenarios: Record<string, ScenarioResult>;
  allPoints: any[];
} {
  const artifactDir = createAuditArtifactDirectory();
  const runId = artifactDir.split(/[\\/]/).pop()!;
  console.log(`\n======================================================`);
  console.log(`  ADTU ITMS — GPS FORENSIC ROUTE & DEVIATION BENCHMARK`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Artifacts: ${artifactDir}`);
  console.log(`======================================================\n`);

  const generator = new GpsStreamGenerator(ADTU_CANONICAL_ROUTE, 20260917);
  const startEpochMs = Date.now();
  const scenarios: Record<string, ScenarioResult> = {};
  const allComparisonRows: any[] = [];

  // ── Scenario A: On-Route Ideal (No noise) ──────────────────────────────────
  console.log('Running Scenario A: On-Route Ideal (Centerline, Zero Noise)...');
  const idealPoints = generator.generateRouteStream({
    startEpochMs,
    intervalSec: 2,
    totalPoints: 30,
    speedKmh: 35,
    noise: NOISE_PROFILES.NONE,
  });
  scenarios['ideal'] = evaluateScenario('Scenario A — Ideal Route (0m noise)', idealPoints, NOISE_PROFILES.NONE.name);

  // ── Scenario B: Realistic Low GPS Noise (±3–5m) ───────────────────────────
  console.log('Running Scenario B: Realistic Low GPS Noise (±3–5m)...');
  const lowNoisePoints = generator.generateRouteStream({
    startEpochMs: startEpochMs + 100000,
    intervalSec: 2,
    totalPoints: 50,
    speedKmh: 35,
    noise: NOISE_PROFILES.LOW,
  });
  scenarios['low_noise'] = evaluateScenario('Scenario B — Low Noise (±3–5m)', lowNoisePoints, NOISE_PROFILES.LOW.name);

  // ── Scenario C: Moderate Urban GPS Noise (±10–20m) ────────────────────────
  console.log('Running Scenario C: Moderate Urban GPS Noise (±10–20m)...');
  const medNoisePoints = generator.generateRouteStream({
    startEpochMs: startEpochMs + 200000,
    intervalSec: 2,
    totalPoints: 50,
    speedKmh: 35,
    noise: NOISE_PROFILES.MEDIUM,
  });
  scenarios['med_noise'] = evaluateScenario('Scenario C — Moderate Urban Noise (±10–20m)', medNoisePoints, NOISE_PROFILES.MEDIUM.name);

  // ── Scenario D: High Multipath / Canyon Noise (±30–50m) ───────────────────
  console.log('Running Scenario D: High Multipath / Canyon Noise (±30–50m)...');
  const highNoisePoints = generator.generateRouteStream({
    startEpochMs: startEpochMs + 300000,
    intervalSec: 2,
    totalPoints: 50,
    speedKmh: 35,
    noise: NOISE_PROFILES.HIGH,
  });
  scenarios['high_noise'] = evaluateScenario('Scenario D — High Multipath Noise (±30–50m)', highNoisePoints, NOISE_PROFILES.HIGH.name);

  // ── Scenario E: Transient Outlier Spike (+150m for 1 point, then returns) ──
  console.log('Running Scenario E: Transient Outlier Spike (+150m spike at Step 15)...');
  const spikePoints = generator.generateRouteStream({
    startEpochMs: startEpochMs + 400000,
    intervalSec: 2,
    totalPoints: 40,
    speedKmh: 35,
    noise: NOISE_PROFILES.LOW,
    injectSpike: { atStep: 15, offsetM: 150 },
  });
  scenarios['outlier_spike'] = evaluateScenario('Scenario E — Transient Outlier Spike', spikePoints, 'LOW + 150m Spike');

  // ── Scenario F: Genuine Sustained Route Deviation (+120m for 8 consecutive points) ──
  console.log('Running Scenario F: Genuine Sustained Route Deviation (+120m Steps 12-20)...');
  const deviationPoints = generator.generateRouteStream({
    startEpochMs: startEpochMs + 500000,
    intervalSec: 2,
    totalPoints: 40,
    speedKmh: 35,
    noise: NOISE_PROFILES.LOW,
    injectDeviation: { startStep: 12, durationSteps: 8, lateralOffsetM: 120 },
  });
  scenarios['sustained_deviation'] = evaluateScenario('Scenario F — Sustained Route Departure', deviationPoints, 'LOW + 120m Deviation');

  // Collect all comparison rows for CSV export
  for (const [key, sc] of Object.entries(scenarios)) {
    for (const p of sc.samplePoints) {
      allComparisonRows.push({
        scenario: key,
        step: p.step,
        rawLat: p.rawLat,
        rawLng: p.rawLng,
        displayLat: p.displayLat,
        displayLng: p.displayLng,
        distanceToRouteM: p.distanceToRouteM,
        mode: p.mode,
        isOffRoute: p.isOffRoute ? 'YES' : 'NO',
      });
    }
  }

  // Save artifacts
  saveJsonArtifact(artifactDir, 'summary.json', scenarios);
  saveCsvArtifact(artifactDir, 'route-comparison.csv', allComparisonRows);

  console.log('\n✔ Forensic GPS Benchmark Completed.');
  console.log(`  Artifacts persisted to: ${artifactDir}`);

  return { runId, artifactDir, scenarios, allPoints: allComparisonRows };
}

function evaluateScenario(name: string, points: RoutePoint[], noiseProfile: string): ScenarioResult {
  const snapper = new SafeRouteSnapper(25, 3); // 25m corridor, 3 steps hysteresis
  const rawDistances: number[] = [];
  const displayDistances: number[] = [];
  const modes = { RAW: 0, SNAPPED: 0, OFF_ROUTE: 0 };
  const samplePoints: ScenarioResult['samplePoints'] = [];

  for (const p of points) {
    const rawPos = { lat: p.lat, lng: p.lng };
    const decision = snapper.processPoint(rawPos, ADTU_CANONICAL_ROUTE);
    const rawDist = decision.distanceToRouteMeters;
    rawDistances.push(rawDist);

    const displayDist = findNearestPointOnRoute(decision.displayPoint, ADTU_CANONICAL_ROUTE).distanceMeters;
    displayDistances.push(displayDist);

    modes[decision.mode]++;

    samplePoints.push({
      step: p.stepIndex,
      rawLat: p.lat,
      rawLng: p.lng,
      displayLat: Number(decision.displayPoint.lat.toFixed(6)),
      displayLng: Number(decision.displayPoint.lng.toFixed(6)),
      distanceToRouteM: rawDist,
      mode: decision.mode,
      isOffRoute: p.isOffRoute,
    });
  }

  return {
    scenarioName: name,
    pointsGenerated: points.length,
    noiseProfile,
    rawDeviationStats: computeDistribution(rawDistances),
    snappedDeviationStats: computeDistribution(displayDistances),
    deviationBuckets: bucketDeviations(rawDistances),
    modes,
    samplePoints,
  };
}

// Execute directly if run via CLI
if (require.main === module) {
  const res = runForensicGpsBenchmark();
  console.log(JSON.stringify(res.scenarios, null, 2));
}
