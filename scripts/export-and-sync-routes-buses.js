#!/usr/bin/env node
/**
 * Export and Sync Routes & Buses: Firestore -> data/ -> Supabase PostgreSQL
 * 
 * 1. Connects to Firestore using firebase-admin.
 * 2. Fetches entire 'routes' and 'buses' collections.
 * 3. Sanitizes Firestore objects (converting DocumentReferences to path strings and Timestamps to ISO strings).
 * 4. Saves clean raw Firestore dumps to 'data/routes_firestore_dump.json' and 'data/buses_firestore_dump.json'.
 * 5. Extracts and prepares canonical schema-compliant fields per `supabase/migrations/Firestore_to_supabase_migration.sql`.
 * 6. Saves prepared payloads to 'data/routes_supabase_prepared.json' and 'data/buses_supabase_prepared.json'.
 * 7. Upserts prepared records into Supabase PostgreSQL 'routes' and 'buses' tables.
 * 
 * Usage: node scripts/export-and-sync-routes-buses.js
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

if (!projectId || !clientEmail || !privateKey) {
    console.error('❌ Missing Firebase credentials in .env / .env.local.');
    process.exit(1);
}

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env / .env.local.');
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

// Helper: Convert Timestamps / Date objects to ISO string
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

// Deep sanitize raw Firestore objects for dump files (remove internal SDK circular refs)
function sanitizeFirestoreObject(obj) {
    if (obj === null || obj === undefined) return obj;

    // Handle DocumentReference
    if (obj.constructor && obj.constructor.name === 'DocumentReference') {
        return obj.path || (obj._path && obj._path.segments ? obj._path.segments.join('/') : null);
    }
    if (obj._path && Array.isArray(obj._path.segments)) {
        return obj._path.segments.join('/');
    }

    // Handle Timestamp
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

async function exportAndSyncRoutesAndBuses() {
    console.log('='.repeat(70));
    console.log('🚀 EXPORT & SYNC: Routes & Buses (Cleaned Dump & Supabase Sync)');
    console.log('='.repeat(70));
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);
    console.log('');

    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    try {
        // ─── 1. ROUTES ──────────────────────────────────────────────────────
        console.log('📦 Fetching "routes" collection from Firestore...');
        const routesSnapshot = await db.collection('routes').get();
        console.log(`   Found ${routesSnapshot.size} route(s) in Firestore`);

        const rawRoutes = [];
        const preparedRoutes = [];

        routesSnapshot.forEach(doc => {
            const rawData = doc.data();
            const cleanRaw = sanitizeFirestoreObject({ _id: doc.id, ...rawData });
            rawRoutes.push(cleanRaw);

            const routeId = rawData.id || rawData.routeId || doc.id;

            // Status normalization for check constraint ('active', 'inactive')
            let status = 'active';
            if (rawData.status !== undefined) {
                status = String(rawData.status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
            } else if (rawData.active !== undefined) {
                status = rawData.active ? 'active' : 'inactive';
            }

            const prepared = {
                id: routeId,
                route_name: rawData.routeName || rawData.name || routeId,
                stops: Array.isArray(rawData.stops) ? rawData.stops : [],
                total_stops: typeof rawData.totalStops === 'number'
                    ? rawData.totalStops
                    : (Array.isArray(rawData.stops) ? rawData.stops.length : 0),
                estimated_time: rawData.estimatedTime || null,
                status: status,
                created_at: toISOString(rawData.createdAt),
                updated_at: toISOString(rawData.updatedAt),
            };

            preparedRoutes.push(prepared);
        });

        // Save dumps
        fs.writeFileSync(path.join(dataDir, 'routes_firestore_dump.json'), JSON.stringify(rawRoutes, null, 2));
        fs.writeFileSync(path.join(dataDir, 'routes_supabase_prepared.json'), JSON.stringify(preparedRoutes, null, 2));
        console.log(`   💾 Clean raw dump saved to: data/routes_firestore_dump.json`);
        console.log(`   💾 Prepared routes saved to: data/routes_supabase_prepared.json`);

        // Upsert into Supabase
        if (preparedRoutes.length > 0) {
            console.log('   📤 Upserting routes into Supabase PostgreSQL...');
            const { error: routeError } = await supabase
                .from('routes')
                .upsert(preparedRoutes, { onConflict: 'id' });

            if (routeError) {
                throw new Error(`Failed to upsert routes into Supabase: ${routeError.message}`);
            }
            console.log(`   ✅ Successfully synced ${preparedRoutes.length} route(s) into Supabase "routes" table`);
        }

        console.log('');

        // ─── 2. BUSES ───────────────────────────────────────────────────────
        console.log('🚌 Fetching "buses" collection from Firestore...');
        const busesSnapshot = await db.collection('buses').get();
        console.log(`   Found ${busesSnapshot.size} bus(es) in Firestore`);

        const rawBuses = [];
        const preparedBuses = [];

        const VALID_BUS_STATUSES = new Set(['active', 'inactive', 'maintenance', 'enroute', 'idle']);

        busesSnapshot.forEach(doc => {
            const rawData = doc.data();
            const cleanRaw = sanitizeFirestoreObject({ _id: doc.id, ...rawData });
            rawBuses.push(cleanRaw);

            const busId = rawData.id || rawData.busId || doc.id;
            let status = (rawData.status || 'inactive').toLowerCase();
            if (!VALID_BUS_STATUSES.has(status)) {
                status = 'inactive';
            }

            // Extract loads from nested load object or top-level properties
            let morningLoad = 0;
            let eveningLoad = 0;
            if (rawData.load && typeof rawData.load === 'object') {
                morningLoad = typeof rawData.load.morningCount === 'number' ? rawData.load.morningCount : 0;
                eveningLoad = typeof rawData.load.eveningCount === 'number' ? rawData.load.eveningCount : 0;
            } else {
                morningLoad = typeof rawData.morningLoad === 'number' ? rawData.morningLoad : 0;
                eveningLoad = typeof rawData.eveningLoad === 'number' ? rawData.eveningLoad : 0;
            }

            // Extract driver UID
            const driverUid = rawData.driverUID || rawData.assignedDriverId || rawData.activeDriverId || rawData.driverUid || null;

            // Extract route ID
            let routeId = rawData.routeId || null;
            if (!routeId && rawData.routeRef) {
                if (typeof rawData.routeRef === 'string') {
                    routeId = rawData.routeRef.split('/').pop();
                } else if (rawData.routeRef._path && rawData.routeRef._path.segments) {
                    routeId = rawData.routeRef._path.segments[rawData.routeRef._path.segments.length - 1];
                }
            }

            const prepared = {
                id: busId,
                bus_number: rawData.busNumber || rawData.busNo || busId,
                model: rawData.model || null,
                year: rawData.year ? String(rawData.year) : null,
                capacity: typeof rawData.capacity === 'number' ? rawData.capacity : 0,
                driver_uid: driverUid,
                driver_name: rawData.driverName || null,
                route_id: routeId,
                route_name: rawData.routeName || null,
                status: status,
                morning_load: morningLoad >= 0 ? morningLoad : 0,
                evening_load: eveningLoad >= 0 ? eveningLoad : 0,
                // current_members is GENERATED ALWAYS in Postgres, omitted from INSERT/UPSERT
                last_started_at: toISOOrNull(rawData.lastStartedAt),
                last_ended_at: toISOOrNull(rawData.lastEndedAt),
                created_at: toISOString(rawData.createdAt),
                updated_at: toISOString(rawData.updatedAt),
            };

            preparedBuses.push(prepared);
        });

        // Save dumps
        fs.writeFileSync(path.join(dataDir, 'buses_firestore_dump.json'), JSON.stringify(rawBuses, null, 2));
        fs.writeFileSync(path.join(dataDir, 'buses_supabase_prepared.json'), JSON.stringify(preparedBuses, null, 2));
        console.log(`   💾 Clean raw dump saved to: data/buses_firestore_dump.json`);
        console.log(`   💾 Prepared buses saved to: data/buses_supabase_prepared.json`);

        // Upsert into Supabase
        if (preparedBuses.length > 0) {
            console.log('   📤 Upserting buses into Supabase PostgreSQL...');
            const { error: busError } = await supabase
                .from('buses')
                .upsert(preparedBuses, { onConflict: 'id' });

            if (busError) {
                throw new Error(`Failed to upsert buses into Supabase: ${busError.message}`);
            }
            console.log(`   ✅ Successfully synced ${preparedBuses.length} bus(es) into Supabase "buses" table`);
        }

        console.log('');
        console.log('='.repeat(70));
        console.log('🎉 ROUTES & BUSES EXPORT AND SYNC COMPLETED');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Export and Sync failed:', error.message);
        process.exit(1);
    }
}

exportAndSyncRoutesAndBuses()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('❌ Unexpected error:', err);
        process.exit(1);
    });
