import { validateEnvironment } from '../src/lib/env-validator';

function main() {
    console.log('🔍 Running Infrastructure Environment Validation...');
    const result = validateEnvironment();

    console.log('\n--- Environment Summary ---');
    for (const [key, status] of Object.entries(result.summary)) {
        console.log(`  ${key}: ${status}`);
    }

    if (!result.valid) {
        console.error(`\n❌ Environment validation FAILED. Missing: ${result.missing.join(', ')}`);
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    } else {
        console.log('\n✅ All environment requirements satisfied.');
    }
}

main();
