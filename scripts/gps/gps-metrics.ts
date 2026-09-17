/**
 * scripts/gps/gps-metrics.ts
 *
 * Mathematical and statistical aggregator for GPS audit telemetry:
 * percentiles, jitter, cadence, deviation buckets, and latency distributions.
 */

export interface NumericDistribution {
  count: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  stdDev: number;
}

export function computeDistribution(values: number[]): NumericDistribution {
  if (values.length === 0) {
    return { count: 0, min: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))];

  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return {
    count: n,
    min: Math.round(sorted[0] * 100) / 100,
    p25: Math.round(q(25) * 100) / 100,
    p50: Math.round(q(50) * 100) / 100,
    p75: Math.round(q(75) * 100) / 100,
    p90: Math.round(q(90) * 100) / 100,
    p95: Math.round(q(95) * 100) / 100,
    p99: Math.round(q(99) * 100) / 100,
    max: Math.round(sorted[n - 1] * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
  };
}

export interface DeviationBuckets {
  '0-5m': number;
  '5-10m': number;
  '10-20m': number;
  '20-30m': number;
  '30-50m': number;
  '50-100m': number;
  '100m+': number;
  total: number;
}

export function bucketDeviations(distancesMeters: number[]): DeviationBuckets {
  const buckets: DeviationBuckets = {
    '0-5m': 0,
    '5-10m': 0,
    '10-20m': 0,
    '20-30m': 0,
    '30-50m': 0,
    '50-100m': 0,
    '100m+': 0,
    total: distancesMeters.length,
  };

  for (const d of distancesMeters) {
    if (d <= 5) buckets['0-5m']++;
    else if (d <= 10) buckets['5-10m']++;
    else if (d <= 20) buckets['10-20m']++;
    else if (d <= 30) buckets['20-30m']++;
    else if (d <= 50) buckets['30-50m']++;
    else if (d <= 100) buckets['50-100m']++;
    else buckets['100m+']++;
  }

  return buckets;
}

export interface CadenceAnalysis {
  configuredIntervalMs: number;
  observedDistribution: NumericDistribution;
  jitterMs: number; // average absolute difference from configured
}

export function analyzeCadence(timestampsMs: number[], configuredIntervalMs = 2000): CadenceAnalysis {
  if (timestampsMs.length < 2) {
    return {
      configuredIntervalMs,
      observedDistribution: computeDistribution([]),
      jitterMs: 0,
    };
  }

  const deltas: number[] = [];
  for (let i = 1; i < timestampsMs.length; i++) {
    deltas.push(timestampsMs[i] - timestampsMs[i - 1]);
  }

  const dist = computeDistribution(deltas);
  const jitter = deltas.reduce((acc, d) => acc + Math.abs(d - configuredIntervalMs), 0) / deltas.length;

  return {
    configuredIntervalMs,
    observedDistribution: dist,
    jitterMs: Math.round(jitter * 10) / 10,
  };
}
