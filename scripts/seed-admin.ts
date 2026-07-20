/**
 * Seed Admin Script
 * 
 * 1. Creates/verifies Firebase Auth user (for Auth/Authorization credentials).
 * 2. Writes canonical user and admin profile records ONLY to Supabase PostgreSQL
 *    (`users` and `admin_profiles` tables per canonical schema).
 * 
 * Default email: dhimansaikia2007@gmail.com
 * Default name:  Dhiman Saikia
 * 
 * Usage: npx tsx scripts/seed-admin.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env and .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '[invalid-email]';
    return `${local.slice(0, 2)}***@${domain}`;
}

function deriveUsername(email: string): string {
    return email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .slice(0, 64);
}

async function seedAdmin() {
    console.log('Seeding admin user into Firebase Auth + Supabase PostgreSQL...');

    try {
        // 1. Initialize Firebase Admin (Auth only)
        if (!getApps().length) {
            const serviceAccount = {
                projectId: requireEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
                clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
                privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
            };

            initializeApp({
                credential: cert(serviceAccount)
            });
            console.log('✅ Firebase Admin Auth initialized');
        }

        // 2. Initialize Supabase Client (Service Role for admin operations)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || requireEnv('SUPABASE_URL');
        const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
        console.log('✅ Supabase Client initialized');

        const auth = getAuth();

        // 3. Admin user parameters
        const adminEmail = (process.env.SEED_ADMIN_EMAIL?.trim() || 'dhimansaikia2007@gmail.com').toLowerCase();
        const adminName = process.env.SEED_ADMIN_NAME?.trim() || 'Dhiman Saikia';
        const adminUsername = process.env.SEED_ADMIN_USERNAME?.trim() || deriveUsername(adminEmail);

        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
            throw new Error('SEED_ADMIN_EMAIL must be a valid email address');
        }

        // 4. Create or fetch Firebase Auth user
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(adminEmail);
            console.log(`👤 Found existing Auth user for ${maskEmail(adminEmail)} (UID: ${userRecord.uid})`);
        } catch (error: unknown) {
            const errorCode = typeof error === 'object' && error && 'code' in error
                ? (error as { code?: unknown }).code
                : undefined;
            if (errorCode === 'auth/user-not-found') {
                console.log(`➕ Creating Auth user for ${maskEmail(adminEmail)}...`);
                userRecord = await auth.createUser({
                    email: adminEmail,
                    emailVerified: true,
                    displayName: adminName
                });
                console.log(`✅ Created Auth user (UID: ${userRecord.uid})`);
            } else {
                throw error;
            }
        }

        const uid = userRecord.uid;
        const createdAt = userRecord.metadata.creationTime
            ? new Date(userRecord.metadata.creationTime).toISOString()
            : new Date().toISOString();
        const now = new Date().toISOString();

        // 5. Upsert into Supabase `users` table
        console.log(`💾 Upserting user into Supabase "users" table...`);
        const { error: userError } = await supabase
            .from('users')
            .upsert({
                uid,
                email: adminEmail,
                name: adminName,
                role: 'admin',
                created_at: createdAt,
                updated_at: now,
            }, { onConflict: 'uid' });

        if (userError) {
            throw new Error(`Failed to upsert into Supabase users table: ${userError.message}`);
        }
        console.log(`✅ Successfully updated Supabase "users" table for UID: ${uid}`);

        // 6. Upsert into Supabase `admin_profiles` table
        console.log(`💾 Upserting admin profile into Supabase "admin_profiles" table...`);
        const { error: adminProfileError } = await supabase
            .from('admin_profiles')
            .upsert({
                uid,
                email: adminEmail,
                full_name: adminName,
                name: adminName,
                username: adminUsername,
                role: 'admin',
                created_at: createdAt,
                updated_at: now,
            }, { onConflict: 'uid' });

        if (adminProfileError) {
            throw new Error(`Failed to upsert into Supabase admin_profiles table: ${adminProfileError.message}`);
        }
        console.log(`✅ Successfully updated Supabase "admin_profiles" table for UID: ${uid}`);

        console.log('🎉 Admin seeding completed successfully!');
        console.log(`   Email:    ${adminEmail}`);
        console.log(`   Name:     ${adminName}`);
        console.log(`   UID:      ${uid}`);
        console.log(`   Username: ${adminUsername}`);
        process.exit(0);

    } catch (error) {
        console.error('❌ Admin seeding failed:', error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }
}

seedAdmin();
