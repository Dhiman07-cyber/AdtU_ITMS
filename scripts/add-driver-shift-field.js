#!/usr/bin/env node
/**
 * Migration Script: Add 'shift' field to existing drivers
 * 
 * This script adds a 'shift' field to all existing driver documents in Firestore.
 * Default value: "Both" (drivers available for both shifts)
 * 
 * The shift field can have three values:
 * - "Morning" - Driver works morning shift only
 * - "Evening" - Driver works evening shift only
 * - "Both" - Driver works both shifts (default)
 * 
 * Usage: node scripts/add-driver-shift-field.js
 * 
 * Options:
 *   --dry-run    Preview changes without applying them
 *   --shift=X    Set a specific shift value (Morning, Evening, or Both)
 * 
 * Examples:
 *   node scripts/add-driver-shift-field.js
 *   node scripts/add-driver-shift-field.js --dry-run
 *   node scripts/add-driver-shift-field.js --shift=Morning
 * 
 * @version 1.0.0
 * @since 2026-02-09
 */

const admin = require('firebase-admin');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;

if (!projectId || !clientEmail || !privateKey) {
    console.error('❌ Missing Firebase credentials. Check your .env file.');
    console.error('Required: NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    process.exit(1);
}

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
});

const db = admin.firestore();

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const shiftArg = args.find(arg => arg.startsWith('--shift='));
const customShift = shiftArg ? shiftArg.split('=')[1] : null;

// Validate custom shift value
const VALID_SHIFTS = ['Morning', 'Evening', 'Both'];
if (customShift && !VALID_SHIFTS.includes(customShift)) {
    console.error(`❌ Invalid shift value: "${customShift}"`);
    console.error(`   Valid values: ${VALID_SHIFTS.join(', ')}`);
    process.exit(1);
}

const DEFAULT_SHIFT = customShift || 'Both';

/**
 * Add shift field to all drivers
 */
async function addDriverShiftField() {
    console.log('='.repeat(70));
    console.log('🚀 MIGRATION: Add Shift Field to Drivers');
    console.log('='.repeat(70));
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log(`🔧 Mode: ${isDryRun ? 'DRY RUN (no changes will be made)' : 'LIVE UPDATE'}`);
    console.log(`📋 Default shift value: "${DEFAULT_SHIFT}"`);
    console.log('');

    try {
        // Fetch all drivers
        console.log('📊 Fetching drivers from Firestore...');
        const driversSnapshot = await db.collection('drivers').get();

        if (driversSnapshot.empty) {
            console.log('⚠️  No drivers found in the database.');
            console.log('');
            process.exit(0);
        }

        console.log(`   Found ${driversSnapshot.size} driver(s)`);
        console.log('');

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        const batch = db.batch();
        let batchCount = 0;
        const MAX_BATCH_SIZE = 500; // Firestore batch limit

        console.log('📝 Processing drivers...');
        console.log('-'.repeat(70));

        for (const doc of driversSnapshot.docs) {
            const data = doc.data();
            const driverName = data.fullName || data.name || doc.id;

            // Skip if shift field already exists
            if (data.shift !== undefined) {
                console.log(`   ⏭️  ${driverName}: Already has shift field (${data.shift})`);
                skippedCount++;
                continue;
            }

            // Prepare update
            const updateData = {
                shift: DEFAULT_SHIFT,
                updatedAt: new Date().toISOString()
            };

            if (isDryRun) {
                console.log(`   🔍 ${driverName}: Would add shift = "${DEFAULT_SHIFT}"`);
                updatedCount++;
            } else {
                try {
                    batch.update(doc.ref, updateData);
                    console.log(`   ✅ ${driverName}: Adding shift = "${DEFAULT_SHIFT}"`);
                    updatedCount++;
                    batchCount++;

                    // Commit batch if it reaches the limit
                    if (batchCount >= MAX_BATCH_SIZE) {
                        await batch.commit();
                        console.log(`   💾 Committed batch of ${batchCount} updates`);
                        batchCount = 0;
                    }
                } catch (error) {
                    console.error(`   ❌ ${driverName}: Error - ${error.message}`);
                    errorCount++;
                }
            }
        }

        // Commit remaining updates
        if (!isDryRun && batchCount > 0) {
            await batch.commit();
            console.log(`   💾 Committed final batch of ${batchCount} updates`);
        }

        console.log('');
        console.log('='.repeat(70));
        console.log('📊 MIGRATION SUMMARY');
        console.log('='.repeat(70));
        console.log(`   Total drivers found: ${driversSnapshot.size}`);
        console.log(`   Drivers ${isDryRun ? 'to be updated' : 'updated'}: ${updatedCount}`);
        console.log(`   Drivers skipped (already have shift): ${skippedCount}`);
        if (errorCount > 0) {
            console.log(`   Errors encountered: ${errorCount}`);
        }
        console.log('');

        if (isDryRun) {
            console.log('ℹ️  This was a DRY RUN - no changes were made to the database.');
            console.log('   Run without --dry-run to apply changes.');
        } else {
            console.log('✅ Migration completed successfully!');
        }

        console.log('');

    } catch (error) {
        console.error('');
        console.error('❌ Migration failed:', error.message);
        console.error('');
        if (error.stack) {
            console.error('Stack trace:');
            console.error(error.stack);
        }
        process.exit(1);
    }
}

// Run the migration
addDriverShiftField()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    });
