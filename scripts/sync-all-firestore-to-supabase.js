#!/usr/bin/env node
/**
 * Sync All Firestore Collections to Supabase PostgreSQL
 * 
 * Inspects active entities in Firestore, exports clean raw dumps to `data/`,
 * transforms and extracts schema-compliant fields per `Firestore_to_supabase_migration.sql`,
 * saves prepared JSON files into `data/`, and upserts core domain records into Supabase PostgreSQL.
 * 
 * Target Tables:
 * - student_profiles
 * - driver_profiles
 * - moderator_profiles
 * - admin_profiles
 * - unauth_users
 * - applications
 * - processed_payments
 * - notifications
 * 
 * Note: Calendar & System Settings (settings/config, settings/deadline, settings/privacy, settings/terms)
 * remain exclusively in Firestore as per architectural requirements.
 * 
 * Usage: node scripts/sync-all-firestore-to-supabase.js
 */

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!projectId || !clientEmail || !privateKey || !supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing credentials in environment variables.');
    process.exit(1);
}

// Initialize clients
if (!getApps().length) {
    initializeApp({
        credential: cert({ projectId, clientEmail, privateKey })
    });
}
const db = getFirestore();
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

function toISOString(value) {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') return value;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value._seconds !== undefined) return new Date(value._seconds * 1000).toISOString();
    if (value.seconds !== undefined) return new Date(value.seconds * 1000).toISOString();
    if (value instanceof Date) return value.toISOString();
    return new Date().toISOString();
}

function toISOOrNull(value) {
    if (!value) return null;
    return toISOString(value);
}

function sanitizeFirestoreObject(obj) {
    if (obj === null || obj === undefined) return obj;

    if (obj.constructor && obj.constructor.name === 'DocumentReference') {
        return obj.path || (obj._path && obj._path.segments ? obj._path.segments.join('/') : null);
    }
    if (obj._path && Array.isArray(obj._path.segments)) {
        return obj._path.segments.join('/');
    }

    if (typeof obj.toDate === 'function') {
        return obj.toDate().toISOString();
    }
    if (obj._seconds !== undefined && obj._nanoseconds !== undefined) {
        return new Date(obj._seconds * 1000).toISOString();
    }

    if (Array.isArray(obj)) {
        return obj.map(sanitizeFirestoreObject);
    }

    if (typeof obj === 'object') {
        const cleaned = {};
        for (const [key, val] of Object.entries(obj)) {
            if (key === '_firestore' || key === '_converter') continue;
            cleaned[key] = sanitizeFirestoreObject(val);
        }
        return cleaned;
    }

    return obj;
}

async function dumpFirestoreSettings() {
    const dataDir = path.join(__dirname, '..', 'data');
    console.log(`📌 Exporting Firestore "settings" collection to data/settings_firestore_dump.json...`);
    try {
        const snapshot = await db.collection('settings').get();
        const rawDocs = [];
        snapshot.forEach(doc => {
            rawDocs.push(sanitizeFirestoreObject({ _id: doc.id, ...doc.data() }));
        });
        fs.writeFileSync(
            path.join(dataDir, `settings_firestore_dump.json`),
            JSON.stringify(rawDocs, null, 2)
        );
        console.log(`   💾 Firestore settings exported to data/settings_firestore_dump.json (remains in Firestore)`);
    } catch (err) {
        console.error(`   ❌ Failed to dump settings:`, err.message);
    }
}

async function syncCollection(fsCollectionName, pgTableName, transformFn, pkey = 'uid') {
    const dataDir = path.join(__dirname, '..', 'data');
    console.log(`📌 Processing Firestore collection "${fsCollectionName}" -> Supabase table "${pgTableName}"...`);

    try {
        const snapshot = await db.collection(fsCollectionName).get();
        if (snapshot.empty) {
            console.log(`   ⚠️ Collection "${fsCollectionName}" is empty or does not exist in Firestore.`);
            return 0;
        }

        console.log(`   Found ${snapshot.size} document(s) in "${fsCollectionName}"`);
        const rawDocs = [];
        const preparedRows = [];

        snapshot.forEach(doc => {
            const rawData = doc.data();
            rawDocs.push(sanitizeFirestoreObject({ _id: doc.id, ...rawData }));
            const transformed = transformFn(doc.id, rawData);
            if (transformed) {
                preparedRows.push(transformed);
            }
        });

        // Save JSON artifacts to data/
        fs.writeFileSync(
            path.join(dataDir, `${fsCollectionName}_firestore_dump.json`),
            JSON.stringify(rawDocs, null, 2)
        );
        fs.writeFileSync(
            path.join(dataDir, `${pgTableName}_${fsCollectionName}_prepared.json`),
            JSON.stringify(preparedRows, null, 2)
        );
        console.log(`   💾 Clean dumps written to data/${fsCollectionName}_firestore_dump.json & data/${pgTableName}_${fsCollectionName}_prepared.json`);

        if (preparedRows.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < preparedRows.length; i += BATCH_SIZE) {
                const chunk = preparedRows.slice(i, i + BATCH_SIZE);
                const { error } = await supabase
                    .from(pgTableName)
                    .upsert(chunk, { onConflict: pkey });

                if (error) {
                    console.error(`   ❌ Error upserting chunk into "${pgTableName}":`, error.message);
                    throw error;
                }
            }
            console.log(`   ✅ Synced ${preparedRows.length} record(s) into Supabase "${pgTableName}"`);
        }
        return preparedRows.length;

    } catch (err) {
        console.error(`   ❌ Failed to sync "${fsCollectionName}":`, err.message);
        return 0;
    }
}

async function syncAll() {
    console.log('='.repeat(70));
    console.log('🚀 FULL FIRESTORE TO SUPABASE MIGRATION & SYNC');
    console.log('='.repeat(70));
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log('');

    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const summary = {};

    // Dump settings to data/ for reference (kept in Firestore)
    await dumpFirestoreSettings();

    // 1. Student Profiles
    summary.student_profiles = await syncCollection('students', 'student_profiles', (docId, data) => {
        const uid = data.uid || docId;
        const validShift = ['Morning', 'Evening'].includes(data.shift) ? data.shift : null;
        return {
            uid,
            email: data.email || null,
            full_name: data.fullName || data.name || null,
            phone: data.phone || null,
            alt_phone: data.altPhone || data.alternatePhone || null,
            parent_name: data.parentName || null,
            parent_phone: data.parentPhone || null,
            faculty: data.faculty || null,
            department: data.department || null,
            gender: data.gender || null,
            dob: data.dob || null,
            enrollment_id: data.enrollmentId || null,
            blood_group: data.bloodGroup || null,
            address: data.address || null,
            profile_photo_url: data.profilePhotoUrl || data.photoURL || null,
            bus_id: data.busId || null,
            route_id: data.routeId || null,
            assigned_route_id: data.assignedRouteId || data.routeId || null,
            assigned_bus_id: data.assignedBusId || data.busId || null,
            stop_id: data.stopId || null,
            stop_name: data.stopName || null,
            shift: validShift,
            status: data.status || 'active',
            session_duration: data.sessionDuration || null,
            session_start_year: typeof data.sessionStartYear === 'number' ? data.sessionStartYear : null,
            session_end_year: typeof data.sessionEndYear === 'number' ? data.sessionEndYear : null,
            semester: data.semester ? String(data.semester) : null,
            valid_until: toISOOrNull(data.validUntil),
            soft_block: toISOOrNull(data.softBlock),
            hard_block: toISOOrNull(data.hardBlock),
            approved_by: data.approvedBy || null,
            approved_at: toISOOrNull(data.approvedAt),
            created_at: toISOString(data.createdAt),
            updated_at: toISOString(data.updatedAt)
        };
    }, 'uid');

    // 2. Driver Profiles
    summary.driver_profiles = await syncCollection('drivers', 'driver_profiles', (docId, data) => {
        const uid = data.uid || docId;
        const validShift = ['Morning', 'Evening', 'Both'].includes(data.shift) ? data.shift : 'Both';
        return {
            uid,
            email: data.email || null,
            full_name: data.fullName || data.name || null,
            phone: data.phone || null,
            alternate_phone: data.alternatePhone || null,
            license_number: data.licenseNumber || null,
            aadhar_number: data.aadharNumber || null,
            employee_id: data.employeeId || data.driverId || null,
            address: data.address || null,
            profile_photo_url: data.profilePhotoUrl || null,
            assigned_bus_id: data.assignedBusId || data.busId || null,
            assigned_route_id: data.assignedRouteId || data.routeId || null,
            bus_id: data.busId || null,
            route_id: data.routeId || null,
            bus_assigned: data.busAssigned || null,
            driver_id: data.driverId || null,
            joining_date: data.joiningDate || null,
            shift: validShift,
            status: data.status || 'active',
            trip_active: !!data.tripActive,
            active_trip_id: data.activeTripId || null,
            is_reserved: !!data.isReserved,
            created_at: toISOString(data.createdAt),
            updated_at: toISOString(data.updatedAt)
        };
    }, 'uid');

    // 3. Applications
    summary.applications = await syncCollection('applications', 'applications', (docId, data) => {
        const applicationId = data.applicationId || docId;
        const validShift = ['Morning', 'Evening'].includes(data.shift) ? data.shift : null;
        return {
            application_id: applicationId,
            applicant_uid: data.applicantUid || data.applicantUID || data.uid || '',
            applicant_email: data.applicantEmail || data.email || null,
            email: data.email || data.applicantEmail || null,
            route_id: data.routeId || null,
            bus_id: data.busId || null,
            stop_id: data.stopId || null,
            shift: validShift,
            session_start_year: typeof data.sessionStartYear === 'number' ? data.sessionStartYear : null,
            session_end_year: typeof data.sessionEndYear === 'number' ? data.sessionEndYear : null,
            application_type: data.applicationType || 'fresh',
            form_data: data.formData || data || {},
            state: data.state || 'draft',
            state_history: Array.isArray(data.state_history) ? data.state_history : [],
            verified_at: toISOOrNull(data.verifiedAt),
            verified_by: data.verifiedBy || null,
            submitted_at: toISOOrNull(data.submittedAt),
            submitted_by: data.submittedBy || null,
            approved_at: toISOOrNull(data.approvedAt),
            approved_by: data.approvedBy || null,
            created_at: toISOString(data.createdAt),
            updated_at: toISOString(data.updatedAt),
            created_by: data.createdBy || data.applicantUid || docId
        };
    }, 'application_id');

    console.log('');
    console.log('='.repeat(70));
    console.log('📊 MIGRATION SUMMARY & SYNC RESULTS');
    console.log('='.repeat(70));
    for (const [table, count] of Object.entries(summary)) {
        console.log(`   ${table.padEnd(28)} : ${count} record(s) synced`);
    }
    console.log('='.repeat(70));
    console.log('✅ Core domain collections synced into Supabase!');
    console.log('');
}

syncAll()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('❌ Migration script execution failed:', err);
        process.exit(1);
    });
