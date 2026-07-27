// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, Messaging } from 'firebase/messaging';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase Client SDK
let app: ReturnType<typeof getApp>;
let auth: ReturnType<typeof getAuth>;
let db: Firestore;
let storage: ReturnType<typeof getStorage>;
let messaging: Messaging;

try {
  if (typeof window !== 'undefined') {
    // Browser environment initialization
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    auth.useDeviceLanguage();

    try {
      db = getFirestore(app);
    } catch (e: any) {
      db = null as any;
    }

    try {
      storage = getStorage(app);
    } catch (e: any) {
      storage = null as any;
    }

    try {
      messaging = getMessaging(app);
    } catch (e: any) {
      messaging = null as any;
    }
  } else {
    // Server-side environment: Client SDK services default to null (server uses firebase-admin)
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    auth = getAuth(app);
    db = null as any;
    storage = null as any;
    messaging = null as any;
  }
} catch (error: any) {
  app = null as any;
  auth = null as any;
  db = null as any;
  storage = null as any;
  messaging = null as any;
}

export { app, auth, db, storage, messaging };