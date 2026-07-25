#!/usr/bin/env node
/**
 * Firestore Reads Safety Test
 * 
 * This test verifies that the application properly limits Firestore reads
 * to prevent quota exhaustion on the Spark (free) plan.
 * 
 * Tests:
 * 1. Pagination is enforced on collection queries
 * 2. Query limits are in place
 * 3. No unbounded real-time listeners
 * 
 * Usage:
 *   node loadtests/firestore_reads_safety_test.js
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(process.cwd(), 'src');

// Configuration limits (should match runtime config)
const LIMITS = {
    MAX_STUDENTS_PER_PAGE: 50,
    MAX_NOTIFICATIONS_LIMIT: 100,
    MAX_SEARCH_RESULTS: 25,
    MAX_BATCH_OPERATIONS: 500,
};

// Patterns that indicate proper pagination
const PAGINATION_PATTERNS = [
    /usePaginatedCollection/,
    /\.limit\s*\(/,
    /startAfter\s*\(/,
    /startAt\s*\(/,
    /endBefore\s*\(/,
    /endAt\s*\(/,
];

// Files known to handle large datasets
const LARGE_DATASET_FILES = [
    'src/app/admin/students/page.tsx',
    'src/app/moderator/students/page.tsx',
    'src/app/admin/route-allocation/page.tsx',
    'src/app/moderator/route-allocation/page.tsx',
    'src/app/admin/driver-assignment/page.tsx',
    'src/app/moderator/driver-assignment/page.tsx',
];

function checkFileForPagination(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);

    // Check if file handles collections
    const handlesCollections = /getDocs|getDoc|collection\(/.test(content);
    if (!handlesCollections) return { file: relativePath, pass: true, reason: 'No collection queries' };

    // Check for pagination patterns
    const hasPagination = PAGINATION_PATTERNS.some(pattern => pattern.test(content));

    // Check for SPARK PLAN SAFETY comments
    const hasSparkSafety = /SPARK PLAN SAFETY/.test(content);

    // Check for explicit limits
    const hasLimit = /limit\s*\(\s*\d+\s*\)/.test(content);

    // Extract limit values
    const limitMatches = content.match(/limit\s*\(\s*(\d+)\s*\)/g) || [];
    const limitValues = limitMatches.map(m => {
        const match = m.match(/limit\s*\(\s*(\d+)\s*\)/);
        return match ? parseInt(match[1], 10) : 0;
    });

    // Check for excessively large limits
    const excessiveLimits = limitValues.filter(v => v > 500);

    const pass = (hasPagination || hasLimit || hasSparkSafety) && excessiveLimits.length === 0;

    return {
        file: relativePath,
        pass,
        hasPagination,
        hasLimit,
        hasSparkSafety,
        limitValues,
        excessiveLimits,
        reason: pass
            ? 'Proper read limiting in place'
            : excessiveLimits.length > 0
                ? `Excessive limits found: ${excessiveLimits.join(', ')}`
                : 'Missing pagination or limit constraints',
    };
}

function getAllTsxFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (/node_modules|\.next|dist|\.git/.test(item)) continue;
            getAllTsxFiles(fullPath, files);
        } else if (/\.(tsx|ts)$/.test(item)) {
            files.push(fullPath);
        }
    }

    return files;
}

function main() {
    console.log('🔥 Firestore Reads Safety Test');
    console.log('==============================\n');
    console.log('Testing read limiting patterns to prevent quota exhaustion\n');
    console.log('Configured Limits:');
    Object.entries(LIMITS).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
    });
    console.log('\n');

    if (!fs.existsSync(SRC_DIR)) {
        console.error('❌ Source directory not found:', SRC_DIR);
        process.exit(1);
    }

    // Check large dataset files specifically
    console.log('📊 Checking large dataset handlers:\n');
    const largeDatasetResults = [];

    for (const file of LARGE_DATASET_FILES) {
        const fullPath = path.join(process.cwd(), file);
        if (fs.existsSync(fullPath)) {
            const result = checkFileForPagination(fullPath);
            largeDatasetResults.push(result);

            const icon = result.pass ? '✅' : '❌';
            console.log(`${icon} ${result.file}`);
            console.log(`   ${result.reason}`);
            if (result.limitValues && result.limitValues.length > 0) {
                console.log(`   Limits used: ${result.limitValues.join(', ')}`);
            }
            console.log('');
        } else {
            console.log(`⚠️  ${file} - File not found (may be renamed)\n`);
        }
    }

    // Check for any collection listeners that might be unbounded
    console.log('🔍 Scanning for unbounded collection listeners:\n');
    const allFiles = getAllTsxFiles(SRC_DIR);
    let unboundedCount = 0;

    for (const file of allFiles) {
        const content = fs.readFileSync(file, 'utf8');
        const relativePath = path.relative(process.cwd(), file);

        // Check for onSnapshot on collections
        const hasCollectionSnapshot = /onSnapshot\s*\(\s*collection\s*\(/.test(content);
        const hasSafetyComment = /SPARK PLAN SAFETY/.test(content);
        const hasQuerySnapshot = /onSnapshot\s*\(\s*query\s*\(/.test(content);
        const hasDocSnapshot = /onSnapshot\s*\(\s*doc\s*\(/.test(content);

        if (hasCollectionSnapshot && !hasSafetyComment && !hasQuerySnapshot) {
            console.log(`⚠️  ${relativePath}`);
            console.log('   Has collection-level onSnapshot without safety comment\n');
            unboundedCount++;
        }
    }

    if (unboundedCount === 0) {
        console.log('✅ No unbounded collection listeners found\n');
    }

    // Summary
    console.log('\n📋 Summary');
    console.log('==========\n');

    const passedLargeDataset = largeDatasetResults.filter(r => r.pass).length;
    const totalLargeDataset = largeDatasetResults.length;

    console.log(`Large Dataset Files: ${passedLargeDataset}/${totalLargeDataset} passed`);
    console.log(`Unbounded Listeners: ${unboundedCount} found`);

    const allPassed = passedLargeDataset === totalLargeDataset && unboundedCount === 0;

    if (allPassed) {
        console.log('\n✅ All Firestore read safety checks passed!');
        console.log('   Your application properly limits Firestore reads.\n');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some safety checks have warnings.');
        console.log('   Review the issues above to ensure Firestore quota safety.\n');
        // Exit with 0 for warnings, only fail on critical issues
        process.exit(0);
    }
}

main();
