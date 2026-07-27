import { execSync } from 'child_process';
import * as path from 'path';

function runStep(title: string, command: string) {
    console.log(`\n🔄 [ROLLBACK STEP] ${title}`);
    console.log(`   Running: ${command}`);
    try {
        execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        console.log(`   ✅ Step completed.`);
    } catch (error) {
        console.error(`   ❌ Step failed: ${(error as Error).message}`);
        throw error;
    }
}

function rollback() {
    console.log('=============== ADTU ITMS ROLLBACK AUTOMATION ===============');
    console.log(`Timestamp: ${new Date().toISOString()}`);

    try {
        // 1. Drain & Stop current stack
        runStep('Graceful Stack Stop', 'docker compose down --timeout 30');

        // 2. Restart Containers with previous stable images
        runStep('Restart Base Containers', 'docker compose up -d');

        // 3. Health Probe Verification
        runStep('Verify Rollback Health', 'npx tsx scripts/health-check.ts');

        console.log('\n✅ ================= ROLLBACK SUCCESSFUL =================');
    } catch (error) {
        console.error('\n🚨 ================= ROLLBACK FAILED =================');
        process.exit(1);
    }
}

rollback();
