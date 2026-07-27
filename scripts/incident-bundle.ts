/**
 * scripts/incident-bundle.ts
 *
 * Incident bundle collector — automates evidence gathering for active incidents.
 * Run as the FIRST ACTION when an incident is declared.
 *
 * Calls diagnose.ts internally and writes a timestamped bundle to:
 *   incident-bundles/YYYY-MM-DDTHH-MM-SS-incident.json
 *
 * Also appends a plain-text summary to the same directory for quick human reading.
 *
 * Usage:
 *   npm run incident:bundle
 *   npm run incident:bundle -- --label "WS crash SEV-1"
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const LABEL_IDX = process.argv.indexOf('--label');
const LABEL = LABEL_IDX !== -1 ? process.argv[LABEL_IDX + 1] : 'unspecified';
const ROOT = path.join(__dirname, '..');
const BUNDLE_DIR = path.join(ROOT, 'incident-bundles');

function tryExec(cmd: string): string {
  try { return execSync(cmd, { timeout: 10000 }).toString().trim(); }
  catch (e) { return `(error: ${(e as Error).message.slice(0, 120)})`; }
}

async function main() {
  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bundlePath = path.join(BUNDLE_DIR, `${stamp}-incident.json`);
  const summaryPath = path.join(BUNDLE_DIR, `${stamp}-summary.txt`);

  process.stderr.write(`[incident-bundle] Collecting bundle for: "${LABEL}"\n`);
  process.stderr.write(`[incident-bundle] Output: ${bundlePath}\n`);

  // Run the full diagnostic collection
  try {
    execSync(`npx tsx ${path.join(__dirname, 'diagnose.ts')} --out "${bundlePath}"`, {
      stdio: ['ignore', 'ignore', 'inherit'],
      cwd: ROOT,
      timeout: 60000,
    });
  } catch (e) {
    process.stderr.write(`[incident-bundle] diagnose step errored: ${(e as Error).message}\n`);
  }

  // Collect additional incident-specific data not in diagnose
  const extra = {
    label: LABEL,
    timestamp: new Date().toISOString(),
    nginxErrors: tryExec('tail -n 100 /var/log/nginx/error.log 2>/dev/null'),
    nginxAccess: tryExec('tail -n 50 /var/log/nginx/access.log 2>/dev/null'),
    pm2Logs: tryExec('pm2 logs --lines 100 --nostream 2>&1'),
    activeConnections: tryExec('ss -tnp | grep -E "3000|3001|9090" 2>/dev/null'),
    openFileCount: tryExec('lsof -c node 2>/dev/null | wc -l'),
    meminfo: tryExec('cat /proc/meminfo 2>/dev/null | head -10'),
  };

  // Merge extra into bundle JSON if bundle was written
  if (fs.existsSync(bundlePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
      existing.incidentContext = extra;
      fs.writeFileSync(bundlePath, JSON.stringify(existing, null, 2), 'utf8');
    } catch { /* write separately */ }
  } else {
    fs.writeFileSync(bundlePath, JSON.stringify({ incidentContext: extra }, null, 2), 'utf8');
  }

  // Plain-text summary for operators who prefer terminal reading
  const summary = [
    `ITMS INCIDENT BUNDLE`,
    `Label:     ${LABEL}`,
    `Timestamp: ${extra.timestamp}`,
    `Bundle:    ${bundlePath}`,
    ``,
    `--- Active Network Connections (ports 3000/3001/9090) ---`,
    extra.activeConnections || '(none detected)',
    ``,
    `--- PM2 Process Logs (last 100 lines) ---`,
    extra.pm2Logs.slice(0, 3000),
    ``,
    `--- NGINX Errors (last 100 lines) ---`,
    extra.nginxErrors.slice(0, 2000),
  ].join('\n');

  fs.writeFileSync(summaryPath, summary, 'utf8');

  process.stdout.write(`\n✅ Incident bundle complete.\n`);
  process.stdout.write(`   JSON:    ${bundlePath}\n`);
  process.stdout.write(`   Summary: ${summaryPath}\n`);
  process.stdout.write(`\n   Share the JSON bundle with the engineering team for root cause analysis.\n`);
}

main().catch((e) => {
  process.stderr.write(`[incident-bundle] Fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
