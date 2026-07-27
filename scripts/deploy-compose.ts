/**
 * scripts/deploy-compose.ts
 *
 * Production Docker Compose deployment automation.
 * Replaces the original minimal script with a hardened, validated pipeline.
 *
 * Sequence:
 *   1. Configuration drift validation (validate-config.ts)
 *   2. Environment validation (validate-env.ts)
 *   3. Release manifest generation
 *   4. Docker Compose build (no-cache for reproducibility)
 *   5. Stack start (up -d)
 *   6. Wait for all services to reach healthy state (wait-healthy.ts)
 *   7. Full health verification (health-check.ts)
 *
 * On failure: prints rollback instruction. Does NOT auto-rollback.
 * Operator must evaluate before running rollback.
 *
 * Usage:
 *   npm run deploy:compose
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

function step(title: string, command: string, { allowFail = false } = {}) {
  process.stdout.write(`\n━━━ ${title} ━━━\n`);
  process.stdout.write(`$ ${command}\n`);
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    cwd: ROOT,
    timeout: 300_000,
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`Step "${title}" exited with code ${result.status ?? '(signal)'}`);
  }
  if (result.status !== 0 && allowFail) {
    process.stdout.write(`  ⚠️  Step completed with non-zero exit (allowed): ${result.status}\n`);
  }
}

function deploy() {
  const startedAt = new Date().toISOString();
  process.stdout.write(`\n${'═'.repeat(60)}\n`);
  process.stdout.write(`ITMS PRODUCTION DEPLOYMENT\n`);
  process.stdout.write(`Started: ${startedAt}\n`);
  process.stdout.write(`${'═'.repeat(60)}\n`);

  try {
    // 1. Validate configuration drift first — catches infra issues before any container ops
    step('Configuration Drift Validation', 'npx tsx scripts/validate-config.ts');

    // 2. Environment validation — fail fast on missing secrets
    step('Environment Validation', 'npx tsx scripts/validate-env.ts');

    // 3. Generate release manifest (evidence of what is being deployed)
    step('Release Manifest Generation', 'npx tsx scripts/generate-release-manifest.ts');

    // 4. Build Docker images (always --no-cache to prevent stale layer issues)
    step('Docker Image Build', 'docker compose build --no-cache');

    // 5. Start the stack
    step('Stack Startup', 'docker compose up -d');

    // 6. Wait for services to become healthy (poll health endpoints)
    step('Wait for Services Healthy', 'npx tsx scripts/wait-healthy.ts --timeout 120 --interval 5');

    // 7. Full health verification across all targets with retry
    step('Full Health Verification', 'npx tsx scripts/health-check.ts --retries 3 --delay 3');

    const completedAt = new Date().toISOString();
    process.stdout.write(`\n${'═'.repeat(60)}\n`);
    process.stdout.write(`DEPLOYMENT SUCCESSFUL\n`);
    process.stdout.write(`Completed: ${completedAt}\n`);
    process.stdout.write(`${'═'.repeat(60)}\n`);

  } catch (error) {
    const failedAt = new Date().toISOString();
    process.stderr.write(`\n${'═'.repeat(60)}\n`);
    process.stderr.write(`DEPLOYMENT FAILED\n`);
    process.stderr.write(`Failed at: ${failedAt}\n`);
    process.stderr.write(`Reason: ${(error as Error).message}\n`);
    process.stderr.write(`\nTo collect diagnostic evidence:\n`);
    process.stderr.write(`  npm run diagnose -- --out ./incident-bundles/deploy-failure.json\n`);
    process.stderr.write(`\nTo rollback to previous state:\n`);
    process.stderr.write(`  npm run rollback:compose\n`);
    process.stderr.write(`${'═'.repeat(60)}\n`);
    process.exit(1);
  }
}

deploy();
