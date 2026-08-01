// Firebase Cloud Messaging service (client-side)
import { app } from '@/lib/firebase';
import { getMessaging,getToken,onMessage } from 'firebase/messaging';

// ─── Constants ───────────────────────────────────────────────────────────────
const SW_SCOPE = '/';

// Initialize Firebase Messaging (only in browser)
let messaging: ReturnType<typeof getMessaging> | null = null;
try {
  if (typeof window !== 'undefined') {
    messaging = getMessaging(app);
  }
} catch (error) {
  console.warn('Firebase Messaging not available:', error);
}

/**
 * Request notification permission from the user.
 * Returns true if granted, false otherwise.
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
};

/**
 * Register the Firebase Messaging service worker and get an FCM token.
 * 
 * The service worker is registered with Firebase config passed as URL params
 * so it can initialize Firebase independently (service workers can't access
 * the main thread's Firebase instance).
 * 
 * Token Stability:
 * - Firebase's getToken() returns a STABLE token for the same browser+SW pair
 * - Token only changes on SW deletion, IndexedDB clear, or Firebase rotation
 * - Calling getToken() periodically is safe and recommended to prevent staleness
 */
export const getFCMToken = async (): Promise<string | null> => {
  if (!messaging) return null;

  try {
    // Build service worker URL with Firebase config
    const swUrl = new URL('/firebase-messaging-sw.js', window.location.origin);
    swUrl.searchParams.set('apiKey', process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '');
    swUrl.searchParams.set('authDomain', process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '');
    swUrl.searchParams.set('projectId', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '');
    swUrl.searchParams.set('storageBucket', process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '');
    swUrl.searchParams.set('messagingSenderId', process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '');
    swUrl.searchParams.set('appId', process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '');

    // Register or update the service worker
    let swRegistration: ServiceWorkerRegistration | undefined;
    try {
      swRegistration = await navigator.serviceWorker.register(swUrl.toString(), { scope: SW_SCOPE });
      await navigator.serviceWorker.ready;
    } catch (swError) {
      console.warn('Service worker registration failed, trying without:', swError);
    }

    const tokenOptions: Parameters<typeof getToken>[1] = {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    };

    if (swRegistration) {
      tokenOptions.serviceWorkerRegistration = swRegistration;
    }

    const currentToken = await getToken(messaging, tokenOptions);
    return currentToken || null;
  } catch (error: any) {
    const msg = error?.message || '';
    // Gracefully handle push service errors (common in dev/localhost)
    if (msg.includes('push service') || msg.includes('AbortError') || msg.includes('Failed to register')) {
      console.warn('⚠️ FCM push service unavailable (normal in dev):', msg);
    } else {
      console.error('Error retrieving FCM token:', error);
    }
    return null;
  }
};

/**
 * Save FCM token to Firestore via the authenticated API endpoint.
 * Uses the user's Firebase ID token for authentication.
 */
export const saveFCMToken = async (
  userUid: string,
  fcmToken: string,
  platform: string = 'web',
  idToken: string
): Promise<boolean> => {
  try {
    const response = await fetch('/api/save-fcm-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ userUid, token: fcmToken, platform }),
    });

    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch { /* ignore */ }
      console.error(
        `❌ [saveFCMToken] HTTP ${response.status} — token NOT saved.`,
        { status: response.status, body: errorBody, tokenLength: fcmToken.length, platform }
      );
      return false;
    }

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('❌ [saveFCMToken] Network error saving FCM token:', error);
    return false;
  }
};


/**
 * Listen for FCM messages received while the app is in the foreground.
 * Returns an unsubscribe function.
 * 
 * NOTE: When the app is in the foreground, the service worker does NOT show
 * notifications — messages are delivered here instead. The caller is
 * responsible for showing a toast or in-app notification.
 */
export const onForegroundMessage = (callback: (payload: any) => void): (() => void) => {
  if (!messaging) return () => {};

  try {
    return onMessage(messaging, (payload) => {
      console.log('📩 Foreground message:', payload);
      callback(payload);
    });
  } catch {
    return () => {};
  }
};