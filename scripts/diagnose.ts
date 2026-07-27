/**
 * scripts/diagnose.ts
 *
 * Self-diagnostic framework — collects a full operational snapshot.
 * Run during any incident to instantly capture the platform state.
 *
 * Produces a machine-readable JSON bundle covering:
 *   - Process & runtime state
 *   - Environment variable presence (no values for secrets)
 *   - Health endpoint status for all services
 *   - Redis connectivity & info
 *   - Container status (if Docker is available)
 *   - Active WS metrics snapshot
 *   - Recent log lines (last 100 from pm2 if available)
 *   - Git commit hash
 *
 * Usage:
 *   npm run diagnose
 *   npm run diagnose -- --out ./incident-bundle.json
 *
 * Output: JSON to stdout; optionally written to --out file.
 */

import http from 'http';
import https from 'https';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const OUT_FLAG = process.argv.indexOf('--out');
const OUT_PATH = OUT_FLAG !== -1 ? process.argv[OUT_FLAG + 1] : null;
const ROOT = path.join(__dirname, '..');

// ── helpers ──────────────────────────────────────────────────────────────────

function httpGet(url: string, timeoutMs = 5000): Promise<{ status: number; body: string; durationMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const t = setTimeout(() => resolve({ status: 0, body: '', durationMs: Date.now() - start }), timeoutMs);
    lib.get(url, (res) => {
      clearTimeout(t);
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, durationMs: Date.now() - start }));
    }).on('error', () => { clearTimeout(t); resolve({ status: 0, body: '', durationMs: Date.now() - start }); });
  });
}

function tryExec(cmd: string): string {
  try { return execSync(cmd, { timeout: 8000 }).toString().trim(); }
  catch { return '(unavailable)'; }
}

function redactSecrets(obj: Record<string, string>): Record<string, string> {
  const SECRET_PATTERNS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PRIVATE'];
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SECRET_PATTERNS.some((p) => k.toUpperCase().includes(p)) ? '[REDACTED]' : v,
    ]),
  );
}

// ── collectors ───────────────────────────────────────────────────────────────

async function collectRuntime() {
  const mem = process.memoryUsage();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptime: process.uptime(),
    memoryMb: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    cpuUsage: process.cpuUsage(),
    env: process.env.NODE_ENV ?? 'unknown',
  };
}

async function collectEnvironment() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
  } catch { /* ignore */ }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ENV_CATALOG } = require('../src/lib/env-validator') as typeof import('../src/lib/env-validator');
  const presence: Record<string, string> = {};
  for (const e of ENV_CATALOG) {
    const val = process.env[e.name];
    presence[e.name] = !val || val.trim() === '' ? 'MISSING' : (e.category === 'secret' ? '[PRESENT_SECRET]' : val);
  }
  return { presence: redactSecrets(presence) };
}

async function collectHealthEndpoints() {
  const targets = [
    { name: 'nextjs_health', url: 'http://localhost:3000/api/health' },
    { name: 'ws_liveness', url: 'http://localhost:9090/health/live' },
    { name: 'ws_readiness', url: 'http://localhost:9090/health/ready' },
    { name: 'ws_metrics', url: 'http://localhost:9090/metrics' },
    { name: 'ws_metrics_json', url: 'http://localhost:9090/metrics/json' },
    { name: 'prometheus', url: 'http://localhost:9090' },
    { name: 'grafana', url: 'http://localhost:3002/api/health' },
    { name: 'alertmanager', url: 'http://localhost:9093' },
  ];
  const out: Record<string, unknown> = {};
  await Promise.all(
    targets.map(async (t) => {
      const r = await httpGet(t.url);
      let parsed: unknown = r.body.slice(0, 400);
      try { parsed = JSON.parse(r.body); } catch { /* keep raw */ }
      out[t.name] = { status: r.status, durationMs: r.durationMs, body: parsed };
    }),
  );
  return out;
}

async function collectContainers() {
  return {
    composePs: tryExec('docker compose ps --format json'),
    dockerInfo: tryExec('docker info --format "{{json .}}"').slice(0, 500),
  };
}

async function collectProcesses() {
  return {
    pm2List: tryExec('pm2 jlist'),
    pm2Logs: tryExec('pm2 logs --lines 50 --nostream 2>&1'),
  };
}

async function collectGit() {
  return {
    commit: tryExec('git rev-parse HEAD'),
    branch: tryExec('git rev-parse --abbrev-ref HEAD'),
    tag: tryExec('git describe --tags --abbrev=0 2>/dev/null || echo none'),
    status: tryExec('git status --short'),
  };
}

async function collectSystem() {
  return {
    hostname: tryExec('hostname'),
    uptime: tryExec('uptime'),
    diskUsage: tryExec('df -h .'),
    loadAvg: tryExec('cat /proc/loadavg 2>/dev/null || uptime'),
    openFiles: tryExec('lsof -c node 2>/dev/null | wc -l'),
  };
}

async function collectRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return { status: 'not_configured' };
  const raw = tryExec(`redis-cli -u "${url}" info server 2>&1 | head -20`);
  return { url: url.replace(/:\/\/.*@/, '://[redacted]@'), info: raw };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch { /* ignore */ }

  process.stderr.write('[diagnose] Collecting diagnostic snapshot...\n');

  const [runtime, environment, health, containers, processes, git, system, redis] = await Promise.all([
    collectRuntime(),
    collectEnvironment(),
    collectHealthEndpoints(),
    collectContainers(),
    collectProcesses(),
    collectGit(),
    collectSystem(),
    collectRedis(),
  ]);

  const bundle = {
    meta: {
      tool: 'itms-diagnose',
      version: '007-phase-02',
      timestamp: new Date().toISOString(),
      collectedBy: process.env.USER ?? 'operator',
    },
    runtime,
    environment,
    health,
    containers,
    processes,
    git,
    system,
    redis,
  };

  const json = JSON.stringify(bundle, null, 2);

  if (OUT_PATH) {
    fs.mkdirSync(path.dirname(path.resolve(OUT_PATH)), { recursive: true });
    fs.writeFileSync(path.resolve(OUT_PATH), json, 'utf8');
    process.stderr.write(`[diagnose] Bundle written to: ${path.resolve(OUT_PATH)}\n`);
  }

  console.log(json);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
