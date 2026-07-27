/**
 * scripts/maintenance-mode.ts
 *
 * Maintenance mode toggle — enables/disables an operator maintenance flag
 * by writing/removing a sentinel file at .maintenance-active.
 *
 * The Next.js middleware can check this file to return 503 during planned maintenance.
 * This avoids modifying NGINX config during routine maintenance.
 *
 * Design:
 *   - enable:  writes .maintenance-active with metadata JSON
 *   - disable: removes .maintenance-active
 *   - status:  reports current state
 *   - Neither action touches running processes — it is purely a flag file.
 *
 * Usage:
 *   npm run maintenance:on  -- --reason "DB migration"
 *   npm run maintenance:off
 *   npm run maintenance:status
 */

import * as path from 'path';
import * as fs from 'fs';

const ACTION = process.argv[2] ?? 'status';  // on | off | status
const REASON_IDX = process.argv.indexOf('--reason');
const REASON = REASON_IDX !== -1 ? process.argv[REASON_IDX + 1] : 'Scheduled maintenance';
const ROOT = path.join(__dirname, '..');
const FLAG_FILE = path.join(ROOT, '.maintenance-active');

interface MaintenanceFlag {
  active: boolean;
  reason: string;
  enabledAt: string;
  enabledBy: string;
}

function enable() {
  if (fs.existsSync(FLAG_FILE)) {
    const existing: MaintenanceFlag = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8'));
    process.stdout.write(`⚠️  Maintenance mode already active since ${existing.enabledAt}\n`);
    process.stdout.write(`   Reason: ${existing.reason}\n`);
    process.stdout.write(`   Use "npm run maintenance:off" to disable first.\n`);
    return;
  }

  const flag: MaintenanceFlag = {
    active: true,
    reason: REASON,
    enabledAt: new Date().toISOString(),
    enabledBy: process.env.USER ?? 'operator',
  };

  fs.writeFileSync(FLAG_FILE, JSON.stringify(flag, null, 2), 'utf8');

  process.stdout.write(JSON.stringify({ action: 'enabled', flag }, null, 2));
  process.stdout.write(`\n\n✅ Maintenance mode ENABLED.\n`);
  process.stdout.write(`   Reason: ${REASON}\n`);
  process.stdout.write(`   Flag:   ${FLAG_FILE}\n`);
  process.stdout.write(`\n   ⚠️  Remember to run "npm run maintenance:off" after maintenance completes.\n`);
}

function disable() {
  if (!fs.existsSync(FLAG_FILE)) {
    process.stdout.write(`ℹ️  Maintenance mode is not active.\n`);
    return;
  }

  const existing: MaintenanceFlag = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8'));
  fs.rmSync(FLAG_FILE);

  const report = {
    action: 'disabled',
    wasActiveFor: `${Math.round((Date.now() - new Date(existing.enabledAt).getTime()) / 60000)} minutes`,
    reason: existing.reason,
  };

  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write(`\n\n✅ Maintenance mode DISABLED.\n`);
  process.stdout.write(`   Was active for: ${report.wasActiveFor}\n`);
  process.stdout.write(`\n   ✅ Run "npm run health:check" to verify platform is fully operational.\n`);
}

function status() {
  if (!fs.existsSync(FLAG_FILE)) {
    const report = { active: false, timestamp: new Date().toISOString() };
    process.stdout.write(JSON.stringify(report, null, 2));
    process.stdout.write(`\n\nℹ️  Maintenance mode: INACTIVE — platform is serving traffic normally.\n`);
    return;
  }

  const flag: MaintenanceFlag = JSON.parse(fs.readFileSync(FLAG_FILE, 'utf8'));
  const activeForMs = Date.now() - new Date(flag.enabledAt).getTime();
  const report = {
    active: true,
    reason: flag.reason,
    enabledAt: flag.enabledAt,
    enabledBy: flag.enabledBy,
    activeForMinutes: Math.round(activeForMs / 60000),
  };

  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write(`\n\n⚠️  Maintenance mode: ACTIVE\n`);
  process.stdout.write(`   Reason:     ${flag.reason}\n`);
  process.stdout.write(`   Active for: ${report.activeForMinutes} minutes\n`);
}

switch (ACTION) {
  case 'on':    enable();  break;
  case 'off':   disable(); break;
  case 'status': status(); break;
  default:
    process.stderr.write(`Unknown action: "${ACTION}". Use: on | off | status\n`);
    process.exit(1);
}
