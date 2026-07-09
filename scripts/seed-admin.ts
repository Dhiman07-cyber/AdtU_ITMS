// ponytail: D1 Identity still persists to Firestore this phase (no Postgres
// migration yet, per PHASE 3.2 scope) — this script is intentionally left
// writing directly to Firestore. When D1 migrates persistence, swap the
// admin-document write below for src/domains/identity's IdentityService
// instead of adding a parallel write path here.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

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
    console.log('Seeding admin user...');

    try {
        if (!getApps().length) {
            const serviceAccount = {
                projectId: requireEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
                clientEmail: requireEnv('FIREBASE_CLIENT_EMAIL'),
                privateKey: requireEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
            };

            initializeApp({
                credential: cert(serviceAccount)
            });
            console.log('Firebase Admin initialized');
        }

        const db = getFirestore();
        const auth = getAuth();

        const adminEmail = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
        const adminName = requireEnv('SEED_ADMIN_NAME');
        const adminUsername = process.env.SEED_ADMIN_USERNAME?.trim() || deriveUsername(adminEmail);

        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
            throw new Error('SEED_ADMIN_EMAIL must be a valid email address');
        }

        if (!adminUsername) {
            throw new Error('SEED_ADMIN_USERNAME is required when it cannot be derived from SEED_ADMIN_EMAIL');
        }

        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(adminEmail);
            console.log(`Found existing Auth user for ${maskEmail(adminEmail)}: ${userRecord.uid}`);
        } catch (error: unknown) {
            const errorCode = typeof error === 'object' && error && 'code' in error
                ? (error as { code?: unknown }).code
                : undefined;
            if (errorCode === 'auth/user-not-found') {
                console.log(`Creating Auth user for ${maskEmail(adminEmail)}`);
                userRecord = await auth.createUser({
                    email: adminEmail,
                    emailVerified: true,
                    displayName: adminName
                });
                console.log(`Created Auth user: ${userRecord.uid}`);
            } else {
                throw error;
            }
        }

        const uid = userRecord.uid;
        const now = new Date().toISOString();

        await db.collection('users').doc(uid).set({
            uid,
            email: adminEmail,
            role: 'admin',
            fullName: adminName,
            displayName: adminName,
            createdAt: userRecord.metadata.creationTime || now,
            updatedAt: now
        }, { merge: true });
        console.log(`Updated users collection for ${uid}`);

        await db.collection('admins').doc(uid).set({
            uid,
            email: adminEmail,
            username: adminUsername,
            fullName: adminName,
            role: 'super_admin',
            createdAt: userRecord.metadata.creationTime || now,
            updatedAt: now,
            permissions: ['all']
        }, { merge: true });
        console.log(`Updated admins collection for ${uid}`);

        console.log('Admin seeding completed successfully');
        process.exit(0);

    } catch (error) {
        console.error('Seeding failed:', error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }
}

seedAdmin();
