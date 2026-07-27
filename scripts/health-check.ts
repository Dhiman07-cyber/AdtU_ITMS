/**
 * scripts/health-check.ts
 *
 * Post-deployment health verification.
 * Checks all platform health endpoints with retry logic.
 * Outputs structured JSON to stdout.
 * Exits 1 if any critical target fails after all retries.
 *
 * Usage:
 *   npm run health:check
 *   npm run health:check -- --retries 5 --delay 3
 */

import http from 'http';

const RETRIES_IDX = process.argv.indexOf('--retries');
const DELAY_IDX = process.argv.indexOf('--delay');
const MAX_RETRIES = RETRIES_IDX !== -1 ? parseInt(process.argv[RETRIES_IDX + 1]) : 3;
const DELAY_S = DELAY_IDX !== -1 ? parseInt(process.argv[DELAY_IDX + 1]) : 2;

interface HealthTarget {
  name: string;
  url: string;
  expectedStatus: number;
  critical: boolean;
}

const TARGETS: HealthTarget[] = [
  { name: 'Next.js API Health', url: 'http://localhost:3000/api/health', expectedStatus: 200, critical: true },
  { name: 'WS Liveness Probe', url: 'http://localhost:9090/health/live', expectedStatus: 200, critical: true },
  { name: 'WS Readiness Probe', url: 'http://localhost:9090/health/ready', expectedStatus: 200, critical: true },
  { name: 'WS Metrics Endpoint', url: 'http://localhost:9090/metrics', expectedStatus: 200, critical: true },
  { name: 'Prometheus', url: 'http://localhost:9090', expectedStatus: 200, critical: false },
  { name: 'Grafana API Health', url: 'http://localhost:3002/api/health', expectedStatus: 200, critical: false },
  { name: 'Alertmanager', url: 'http://localhost:9093', expectedStatus: 200, critical: false },
];

interface CheckResult {
  name: string;
  url: string;
  critical: boolean;
  ok: boolean;
  finalStatus?: number;
  durationMs: number;
  attempts: number;
  error?: string;
}

function httpGet(url: string): Promise<{ status: number; bodyPreview: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (d) => { if (body.length < 300) body += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, bodyPreview: body.slice(0, 200) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function checkWithRetry(target: HealthTarget): Promise<CheckResult> {
  const start = Date.now();
  let lastError = '';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status } = await httpGet(target.url);
      lastStatus = status;
      if (status === target.expectedStatus) {
        return {
          name: target.name,
          url: target.url,
          critical: target.critical,
          ok: true,
          finalStatus: status,
          durationMs: Date.now() - start,
          attempts: attempt,
        };
      }
      lastError = `HTTP ${status} (expected ${target.expectedStatus})`;
    } catch (e) {
      lastError = (e as Error).message;
    }
    if (attempt < MAX_RETRIES) await sleep(DELAY_S * 1000);
  }

  return {
    name: target.name,
    url: target.url,
    critical: target.critical,
    ok: false,
    finalStatus: lastStatus,
    durationMs: Date.now() - start,
    attempts: MAX_RETRIES,
    error: lastError,
  };
}

async function runHealthCheck() {
  process.stderr.write(`[health-check] Verifying ${TARGETS.length} targets (${MAX_RETRIES} retries, ${DELAY_S}s delay)\n`);

  const results = await Promise.all(TARGETS.map(checkWithRetry));

  const criticalFails = results.filter((r) => !r.ok && r.critical);
  const warningFails = results.filter((r) => !r.ok && !r.critical);
  const passed = results.filter((r) => r.ok);

  const report = {
    timestamp: new Date().toISOString(),
    ok: criticalFails.length === 0,
    summary: {
      total: results.length,
      passed: passed.length,
      criticalFailed: criticalFails.length,
      warningFailed: warningFails.length,
    },
    results,
  };

  console.log(JSON.stringify(report, null, 2));

  if (criticalFails.length > 0) {
    process.stderr.write(`\n❌ Health check FAILED — ${criticalFails.length} critical target(s) down:\n`);
    for (const r of criticalFails) process.stderr.write(`   ✗ ${r.name}: ${r.error}\n`);
    process.exit(1);
  }

  if (warningFails.length > 0) {
    process.stderr.write(`\n⚠️  Health check passed with ${warningFails.length} non-critical warning(s).\n`);
  } else {
    process.stderr.write(`\n✅ All health probes PASSED.\n`);
  }
}

if (require.main === module) {
  runHealthCheck();
}

export { runHealthCheck };
