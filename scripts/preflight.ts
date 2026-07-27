/**
 * scripts/preflight.ts
 *
 * Production pre-flight dependency check.
 * Verifies every external dependency is reachable before startup is declared safe.
 * Outputs structured JSON to stdout; exits 1 on any critical failure.
 *
 * Usage:
 *   npm run preflight           -- non-blocking (warns only)
 *   npm run preflight -- --strict -- exits 1 on any failure
 */

import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const STRICT = process.argv.includes('--strict');
const ROOT = path.join(__dirname, '..');

interface CheckResult {
  name: string;
  category: 'critical' | 'warning';
  ok: boolean;
  detail: string;
  durationMs: number;
}

const results: CheckResult[] = [];

// ── helpers ──────────────────────────────────────────────────────────────────

function httpGet(url: string, timeoutMs = 5000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const t = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    lib.get(url, (res) => {
      clearTimeout(t);
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function record(name: string, category: CheckResult['category'], ok: boolean, detail: string, durationMs: number) {
  results.push({ name, category, ok, detail, durationMs });
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

// ── checks ───────────────────────────────────────────────────────────────────

async function checkEnv() {
  // Reuse the existing validator — import dynamically so dotenv is loaded first.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { validateEnvironment } = require('../src/lib/env-validator') as typeof import('../src/lib/env-validator');
    const start = Date.now();
    const r = validateEnvironment();
    const ms = Date.now() - start;
    record(
      'Environment Variables',
      'critical',
      r.valid,
      r.valid ? `All ${Object.keys(r.summary).length} vars present` : `Missing: ${r.missing.join(', ')}`,
      ms,
    );
  } catch (e) {
    record('Environment Variables', 'critical', false, `validator error: ${(e as Error).message}`, 0);
  }
}

async function checkHttpEndpoint(name: string, url: string, category: CheckResult['category'], expectedStatus = 200) {
  try {
    const { result, ms } = await timed(() => httpGet(url));
    record(
      name,
      category,
      result.status === expectedStatus,
      `HTTP ${result.status} (expected ${expectedStatus})`,
      ms,
    );
  } catch (e) {
    record(name, category, false, (e as Error).message, 0);
  }
}

async function checkPort(name: string, host: string, port: number, category: CheckResult['category']) {
  const { createConnection } = await import('net');
  const start = Date.now();
  return new Promise<void>((resolve) => {
    const sock = createConnection({ host, port, timeout: 4000 }, () => {
      sock.destroy();
      record(name, category, true, `port ${port} open`, Date.now() - start);
      resolve();
    });
    sock.on('error', (e) => {
      record(name, category, false, `port ${port} refused: ${e.message}`, Date.now() - start);
      resolve();
    });
    sock.on('timeout', () => {
      sock.destroy();
      record(name, category, false, `port ${port} timeout`, Date.now() - start);
      resolve();
    });
  });
}

async function checkNodeVersion() {
  const start = Date.now();
  const major = parseInt(process.version.slice(1));
  record(
    'Node.js Version',
    'critical',
    major >= 22,
    `${process.version} (required: v22+)`,
    Date.now() - start,
  );
}

async function checkDiskSpace() {
  const start = Date.now();
  try {
    const out = execSync('df -k .').toString().trim().split('\n');
    const parts = out[1].trim().split(/\s+/);
    const availKb = parseInt(parts[3]);
    const availMb = Math.round(availKb / 1024);
    // Warn below 500 MB
    record('Disk Space', 'warning', availMb > 500, `${availMb} MB available`, Date.now() - start);
  } catch {
    record('Disk Space', 'warning', true, 'check skipped (non-Linux)', Date.now() - start);
  }
}

async function checkEnvFile() {
  const start = Date.now();
  const exists = fs.existsSync(path.join(ROOT, '.env'));
  record('.env File Present', 'critical', exists, exists ? 'found' : 'not found — env vars must come from runtime', Date.now() - start);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write('');
  // Load dotenv early
  try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch { /* ignore */ }

  await checkNodeVersion();
  await checkEnvFile();
  await checkEnv();
  await checkDiskSpace();

  // Application health endpoints (optional during bare pre-flight — warn only)
  await checkHttpEndpoint('Next.js Health', 'http://localhost:3000/api/health', 'warning');
  await checkHttpEndpoint('WS Server Liveness', 'http://localhost:9090/health/live', 'warning');
  await checkHttpEndpoint('WS Server Readiness', 'http://localhost:9090/health/ready', 'warning');
  await checkHttpEndpoint('Prometheus', 'http://localhost:9090', 'warning', 200);
  await checkHttpEndpoint('Grafana', 'http://localhost:3002/api/health', 'warning');

  // Redis port check
  const redisUrl = process.env.REDIS_URL ?? '';
  if (redisUrl) {
    try {
      const u = new URL(redisUrl);
      await checkPort('Redis', u.hostname, parseInt(u.port || '6379'), 'warning');
    } catch {
      record('Redis', 'warning', false, 'invalid REDIS_URL', 0);
    }
  } else {
    record('Redis', 'warning', true, 'REDIS_URL not set — WS will use in-process transport', 0);
  }

  // ── output ────────────────────────────────────────────────────────────────
  const criticalFails = results.filter((r) => !r.ok && r.category === 'critical');
  const warningFails = results.filter((r) => !r.ok && r.category === 'warning');
  const allOk = criticalFails.length === 0;

  const report = {
    timestamp: new Date().toISOString(),
    ok: allOk,
    strictOk: allOk && warningFails.length === 0,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.ok).length,
      criticalFails: criticalFails.length,
      warningFails: warningFails.length,
    },
    checks: results,
  };

  console.log(JSON.stringify(report, null, 2));

  if (STRICT && !report.strictOk) process.exit(1);
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
