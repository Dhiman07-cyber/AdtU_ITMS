/**
 * scripts/wait-healthy.ts
 *
 * Startup readiness poller — polls health endpoints until all pass or timeout expires.
 * Used in CI/CD pipelines and automated startup sequences to prevent premature
 * traffic routing or test execution against unready services.
 *
 * Exits 0 when all targets become healthy.
 * Exits 1 if timeout is reached before all targets pass.
 *
 * Usage:
 *   npm run wait:healthy
 *   npm run wait:healthy -- --timeout 120   (seconds, default: 90)
 *   npm run wait:healthy -- --interval 3    (seconds, default: 5)
 */

import http from 'http';

const TIMEOUT_IDX = process.argv.indexOf('--timeout');
const INTERVAL_IDX = process.argv.indexOf('--interval');
const TIMEOUT_S = TIMEOUT_IDX !== -1 ? parseInt(process.argv[TIMEOUT_IDX + 1]) : 90;
const INTERVAL_S = INTERVAL_IDX !== -1 ? parseInt(process.argv[INTERVAL_IDX + 1]) : 5;

interface Target {
  name: string;
  url: string;
  expectedStatus: number;
}

const TARGETS: Target[] = [
  { name: 'Next.js API', url: 'http://localhost:3000/api/health', expectedStatus: 200 },
  { name: 'WS Liveness', url: 'http://localhost:9090/health/live', expectedStatus: 200 },
  { name: 'WS Readiness', url: 'http://localhost:9090/health/ready', expectedStatus: 200 },
];

function check(target: Target): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(target.url, { timeout: 4000 }, (res) => {
      resolve(res.statusCode === target.expectedStatus);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function checkAll(): Promise<{ allPass: boolean; results: Record<string, boolean> }> {
  const results: Record<string, boolean> = {};
  await Promise.all(
    TARGETS.map(async (t) => {
      results[t.name] = await check(t);
    }),
  );
  return { allPass: Object.values(results).every(Boolean), results };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let attempt = 0;

  process.stdout.write(`[wait-healthy] Polling up to ${TIMEOUT_S}s (interval: ${INTERVAL_S}s)\n`);

  while (Date.now() < deadline) {
    attempt++;
    const { allPass, results } = await checkAll();

    const lines = Object.entries(results)
      .map(([name, ok]) => `  ${ok ? '✅' : '⏳'} ${name}`)
      .join('\n');

    process.stdout.write(`\n[attempt ${attempt}] ${new Date().toISOString()}\n${lines}\n`);

    if (allPass) {
      process.stdout.write(`\n✅ All services healthy after ${attempt} attempt(s).\n`);
      process.exit(0);
    }

    const remaining = Math.round((deadline - Date.now()) / 1000);
    process.stdout.write(`   ${remaining}s remaining...\n`);
    await sleep(INTERVAL_S * 1000);
  }

  process.stderr.write(`\n❌ Timeout reached (${TIMEOUT_S}s). Services did not become healthy.\n`);
  process.exit(1);
}

main();
