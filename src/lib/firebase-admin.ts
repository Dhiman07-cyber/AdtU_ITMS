import { cert,getApps,initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue,getFirestore } from 'firebase-admin/firestore';
import { getMessaging,type Messaging } from 'firebase-admin/messaging';

// ─── Env Validation ──────────────────────────────────────────────────────────
// Fail-fast if critical env vars are missing (only check server-side)
const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
] as const;

function validateEnvVars(): void {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    const msg = `❌ Missing required Firebase Admin env vars: ${missing.join(', ')}`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    } else if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      console.warn(msg);
    }
  }
}

let adminApp: any;
let auth: any;
let db: any;
let messaging: Messaging | null = null;

// Try to initialize Firebase Admin SDK
try {
  validateEnvVars();
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    if (!getApps().length) {
      // Process the private key - handle both quoted and unquoted keys, and escaped newlines
      let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';

      // Clean the key: remove literal quotes if they wrap the entire string, and fix newlines
      privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

      adminApp = initializeApp({
        credential: cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
      });
    } else {
      adminApp = getApps()[0];
    }

    auth = getAuth(adminApp);
    db = getFirestore(adminApp);
    try {
      messaging = getMessaging(adminApp);
    } catch (msgError: any) {
      console.warn('⚠️ Firebase Admin Messaging init failed:', msgError.message);
    }
  } else if (!isProduction && !isTest) {
    console.warn('⚠️ Firebase Admin credentials not found');
  }
} catch (error: any) {
  console.error('❌ Firebase Admin SDK initialization failed:', error.message);
}

// Verify token function
export async function verifyToken(token: string) {
  if (!auth) {
    throw new Error('Firebase Admin Auth not initialized');
  }
  return await auth.verifyIdToken(token);
}

// Export with aliases for consistency - only if properly initialized
export const adminAuth = auth || null;
export const adminDb = db || null;
export const admin = adminApp || null;
export const adminMessaging = messaging;

export { adminApp,auth,db,FieldValue,messaging };
