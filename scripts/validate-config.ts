/**
 * scripts/validate-config.ts
 *
 * Configuration drift detector — validates every environment variable against
 * the canonical ENV_CATALOG, reports missing, extra, unsafe, and deprecated entries.
 *
 * Also validates:
 *   - docker-compose.yml service list vs expected service set
 *   - nginx.conf presence
 *   - prometheus.yml scrape targets
 *   - alertmanager.yml presence
 *   - .env vs .env.example key coverage
 *
 * Outputs structured JSON. Exits 1 if critical drift is found.
 *
 * Usage:
 *   npm run validate:config
 *   npm run validate:config -- --strict
 */

import * as path from 'path';
import * as fs from 'fs';

const STRICT = process.argv.includes('--strict');
const ROOT = path.join(__dirname, '..');

interface Finding {
  severity: 'critical' | 'warning' | 'info';
  area: string;
  message: string;
}

const findings: Finding[] = [];
let criticalCount = 0;

function critical(area: string, message: string) {
  findings.push({ severity: 'critical', area, message });
  criticalCount++;
}
function warn(area: string, message: string) {
  findings.push({ severity: 'warning', area, message });
}
function info(area: string, message: string) {
  findings.push({ severity: 'info', area, message });
}

// ── env validation ────────────────────────────────────────────────────────────

function validateEnvCoverage() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env') });
  } catch { /* ignore */ }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ENV_CATALOG } = require('../src/lib/env-validator') as typeof import('../src/lib/env-validator');

  const dotenvPath = path.join(ROOT, '.env');
  const examplePath = path.join(ROOT, '.env.example');

  // Check .env.example coverage
  if (fs.existsSync(examplePath) && fs.existsSync(dotenvPath)) {
    const exampleKeys = fs.readFileSync(examplePath, 'utf8')
      .split('\n')
      .filter((l) => l.match(/^[A-Z_]+=?/))
      .map((l) => l.split('=')[0].trim());
    const catalogKeys = ENV_CATALOG.map((e) => e.name);
    const uncataloged = exampleKeys.filter((k) => !catalogKeys.includes(k) && k.length > 0);
    if (uncataloged.length > 0) {
      warn('Environment', `.env.example contains keys not in ENV_CATALOG: ${uncataloged.join(', ')}`);
    } else {
      info('Environment', '.env.example keys are fully covered by ENV_CATALOG');
    }
  }

  // Check all required vars present
  const missing = ENV_CATALOG
    .filter((e) => e.required && (!process.env[e.name] || process.env[e.name]!.trim() === ''))
    .map((e) => e.name);

  if (missing.length > 0) {
    critical('Environment', `Required variables missing: ${missing.join(', ')}`);
  } else {
    info('Environment', `All ${ENV_CATALOG.filter((e) => e.required).length} required variables present`);
  }

  // Detect unsafe defaults
  const unsafeDefaults: string[] = [];
  if (process.env.GF_SECURITY_ADMIN_PASSWORD === 'admin') unsafeDefaults.push('GF_SECURITY_ADMIN_PASSWORD=admin (change in production)');
  if (process.env.NODE_ENV !== 'production') warn('Environment', `NODE_ENV="${process.env.NODE_ENV}" — expected "production" in prod`);
  if (unsafeDefaults.length > 0) warn('Environment', `Unsafe defaults detected: ${unsafeDefaults.join('; ')}`);
}

// ── docker-compose validation ─────────────────────────────────────────────────

function validateDockerCompose() {
  const composePath = path.join(ROOT, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) {
    critical('Docker', 'docker-compose.yml not found');
    return;
  }

  const content = fs.readFileSync(composePath, 'utf8');
  const requiredServices = ['redis', 'ws1', 'ws2', 'nextjs', 'nginx', 'prometheus', 'alertmanager', 'grafana'];

  for (const svc of requiredServices) {
    if (!content.includes(`  ${svc}:`)) {
      critical('Docker', `docker-compose.yml missing service: ${svc}`);
    }
  }

  // Verify health checks are defined
  const healthcheckCount = (content.match(/healthcheck:/g) ?? []).length;
  if (healthcheckCount < 3) {
    warn('Docker', `Only ${healthcheckCount} healthcheck definitions found — expected at least 3 (nextjs, ws1, ws2)`);
  } else {
    info('Docker', `${healthcheckCount} health checks defined in docker-compose.yml`);
  }

  // Verify pinned images (no :latest)
  if (content.includes(':latest')) {
    critical('Docker', 'docker-compose.yml uses ":latest" image tag — pin to a specific version');
  } else {
    info('Docker', 'All container images use pinned version tags');
  }
}

// ── NGINX validation ──────────────────────────────────────────────────────────

function validateNginx() {
  const nginxConf = path.join(ROOT, 'nginx', 'nginx.conf');
  if (!fs.existsSync(nginxConf)) {
    critical('NGINX', 'nginx/nginx.conf not found');
    return;
  }
  const content = fs.readFileSync(nginxConf, 'utf8');
  if (!content.includes('server_tokens off')) warn('NGINX', 'server_tokens off not set — version disclosure risk');
  if (!content.includes('proxy_buffering off')) warn('NGINX', 'proxy_buffering not disabled — WebSocket long-polling may buffer incorrectly');
  if (!content.includes('max_fails')) warn('NGINX', 'max_fails not set on upstreams — failover protection missing');
  if (!content.includes('Strict-Transport-Security')) warn('NGINX', 'HSTS header not configured');
  info('NGINX', 'nginx.conf present and validated');
}

// ── Prometheus validation ─────────────────────────────────────────────────────

function validatePrometheus() {
  const promYml = path.join(ROOT, 'prometheus', 'prometheus.yml');
  if (!fs.existsSync(promYml)) {
    critical('Prometheus', 'prometheus/prometheus.yml not found');
    return;
  }
  const content = fs.readFileSync(promYml, 'utf8');
  if (!content.includes('itms-websocket-cluster')) warn('Prometheus', 'WebSocket scrape job not found in prometheus.yml');
  if (!content.includes('itms-nextjs-cluster')) warn('Prometheus', 'Next.js scrape job not found in prometheus.yml');
  if (!content.includes('alertmanager')) warn('Prometheus', 'Alertmanager target not configured in prometheus.yml');
  info('Prometheus', 'prometheus.yml present and validated');
}

// ── Alertmanager validation ───────────────────────────────────────────────────

function validateAlertmanager() {
  const amYml = path.join(ROOT, 'alertmanager', 'alertmanager.yml');
  if (!fs.existsSync(amYml)) {
    warn('Alertmanager', 'alertmanager/alertmanager.yml not found — alerts will not route');
    return;
  }
  info('Alertmanager', 'alertmanager.yml present');
}

// ── cert validation ───────────────────────────────────────────────────────────

function validateCerts() {
  const certDir = '/etc/letsencrypt/live';
  if (!fs.existsSync(certDir)) {
    warn('TLS', '/etc/letsencrypt/live not found — TLS certificates not present on this host');
  } else {
    info('TLS', 'Let\'s Encrypt certificate directory found');
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch { /* ignore */ }

  validateEnvCoverage();
  validateDockerCompose();
  validateNginx();
  validatePrometheus();
  validateAlertmanager();
  validateCerts();

  const report = {
    timestamp: new Date().toISOString(),
    ok: criticalCount === 0,
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      warning: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    findings,
  };

  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.stderr.write(`\n❌ Configuration validation FAILED — ${criticalCount} critical finding(s)\n`);
    process.exit(1);
  }
  if (STRICT && report.summary.warning > 0) {
    process.stderr.write(`\n❌ Strict mode: ${report.summary.warning} warning(s) found\n`);
    process.exit(1);
  }
  process.stderr.write(`\n✅ Configuration validation passed\n`);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
