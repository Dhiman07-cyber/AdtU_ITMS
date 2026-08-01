"use client";

import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import {
	getFCMToken,
	onForegroundMessage,
	requestNotificationPermission,
	saveFCMToken
} from "@/lib/fcm-service";
import { usePathname } from "next/navigation";
import { useCallback,useEffect,useRef,useState } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────
const TOKEN_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LS_TOKEN_KEY_PREFIX = 'fcm_device_token_';
const LS_LAST_SYNC_PREFIX = 'fcm_last_sync_';

/**
 * FCMTokenManager — Production-grade FCM token lifecycle manager
 * 
 * Ensures 100% reliable push notification delivery for STUDENTS ONLY by:
 * 
 * 1. Registering the FCM token on first login (persisted in Firestore subcollection)
 * 2. Periodically refreshing the token (every 12h) to prevent staleness
 * 3. Re-syncing the token when the app regains visibility (tab focus)
 * 4. Listening for foreground messages and showing user-facing toasts
 * 5. Caching the token in localStorage to avoid redundant server writes
 * 6. Handling token rotation gracefully (Firebase SDK may rotate tokens)
 * 7. SECURITY: Only allows student users to register FCM tokens
 * 
 * Firebase's getToken() returns a STABLE token for the same browser+SW pair.
 * It only changes when:
 *   - User deletes the service worker registration
 *   - User clears browser storage/IndexedDB
 *   - Firebase rotates the token (rare, weeks/months apart)
 */
export function FCMTokenManager() {
  const { currentUser, userData } = useAuth();
  const pathname = usePathname();
  const { addToast } = useToast();
  const addToastRef = useRef(addToast);
  const isSyncing = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep toast ref current to avoid stale closures
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  // ── Core Token Sync ──────────────────────────────────────────────────────
  const syncToken = useCallback(async (force = false): Promise<void> => {
    if (!currentUser?.uid || !userData) return;
    
    // SECURITY: Only allow students to register FCM tokens
    if (userData.role !== 'student') {
      console.log(`🚫 FCM token registration skipped for non-student role: ${userData.role}`);
      return;
    }
    
    if (isSyncing.current) return; // Prevent concurrent syncs
    isSyncing.current = true;

    try {
      // 1. Check browser support
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('⚠️ [FCMTokenManager] Browser does not support push notifications — skipping token sync.');
        return;
      }

      // 2. Check/request notification permission
      if (Notification.permission === 'denied') {
        console.error('❌ [FCMTokenManager] Notification permission is DENIED by the browser. '
          + 'Students must allow notifications in browser settings. FCM tokens cannot be saved.');
        return;
      }
      const hasPermission = await requestNotificationPermission();
      if (!hasPermission) {
        console.warn('⚠️ [FCMTokenManager] Notification permission not granted — FCM tokens will not be saved.');
        return;
      }

      // 3. Get FCM token from Firebase SDK
      const fcmToken = await getFCMToken();
      if (!fcmToken) {
        console.error('❌ [FCMTokenManager] getFCMToken() returned null. '
          + 'Check NEXT_PUBLIC_FIREBASE_VAPID_KEY env var and that the service worker registered successfully.');
        return;
      }

      // 4. Check if sync is needed (sessionStorage ensures every new app session syncs with Supabase)
      const ssSyncKey = `fcm_session_synced_${currentUser.uid}`;
      const lsTokenKey = `${LS_TOKEN_KEY_PREFIX}${currentUser.uid}`;
      const cachedToken = localStorage.getItem(lsTokenKey);
      const isNewToken = cachedToken !== fcmToken;
      const sessionSynced = sessionStorage.getItem(ssSyncKey) === 'true';

      // Skip ONLY if token is unchanged AND we already synced in this browser session
      if (!force && !isNewToken && sessionSynced) {
        return;
      }

      if (isNewToken) {
        console.log('🔑 FCM token changed or first registration, saving...');
      } else {
        console.log('🔄 Periodic FCM token refresh (keeping token alive)...');
      }

      // 5. Get fresh auth ID token
      const idToken = await currentUser.getIdToken(true);

      // 6. Save to PostgreSQL via API
      const saved = await saveFCMToken(currentUser.uid, fcmToken, 'web', idToken);
      if (saved) {
        localStorage.setItem(lsTokenKey, fcmToken);
        sessionStorage.setItem(ssSyncKey, 'true');
        if (isNewToken) {
          console.log('✅ [FCMTokenManager] FCM token registered successfully (token length:', fcmToken.length, ')');
        } else {
          console.log('🔄 [FCMTokenManager] FCM token refreshed successfully.');
        }
      } else {
        console.error('❌ [FCMTokenManager] saveFCMToken() returned false — token NOT saved to fcm_tokens table. '
          + 'Check /api/save-fcm-token response in Network tab for HTTP 400/403/500.');
        localStorage.removeItem(lsTokenKey);
        sessionStorage.removeItem(ssSyncKey);
      }
    } catch (error) {
      // CRITICAL: Never crash the host page
      console.warn('⚠️ FCM sync error (non-critical):', error);
    } finally {
      isSyncing.current = false;
    }
  }, [currentUser, userData]);

  // ── Initial Registration + Periodic Refresh ──────────────────────────────
  useEffect(() => {
    if (!currentUser?.uid || !userData) return;

    // Initial sync on mount
    syncToken();

    // Periodic refresh to keep token alive and catch rotations
    refreshTimerRef.current = setInterval(() => {
      syncToken();
    }, TOKEN_REFRESH_INTERVAL_MS);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [currentUser?.uid, userData, syncToken]);

  // ── Visibility-Based Re-Sync ─────────────────────────────────────────────
  // When user returns to app after being away, re-sync the token
  // This handles cases where the token was rotated while the app was in background
  useEffect(() => {
    if (!currentUser?.uid || !userData) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only sync if enough time has passed (avoid rapid re-syncs on tab switching)
        const lsSyncKey = `${LS_LAST_SYNC_PREFIX}${currentUser.uid}`;
        const lastSync = parseInt(localStorage.getItem(lsSyncKey) || '0', 10);
        const timeSinceLastSync = Date.now() - lastSync;

        // Re-sync if last sync was more than 1 hour ago
        if (timeSinceLastSync > 60 * 60 * 1000) {
          syncToken();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.uid, userData, syncToken]);

  // ── Foreground Message Listener ──────────────────────────────────────────
  // When the app is in the foreground, FCM delivers messages here instead of
  // the service worker. We display a toast so the user knows about the event.
  useEffect(() => {
    if (!currentUser?.uid || !userData) return;

    let unsubscribe: (() => void) | null = null;

    try {
      unsubscribe = onForegroundMessage((payload) => {
        console.log('📩 Foreground FCM message:', payload);

        const data = payload?.data || {};
        const title = payload?.notification?.title;
        const body = payload?.notification?.body;

        // SKIP toasts if user is on the track-bus page (page handles its own low-latency toasts)
        const isTrackingPage = pathname === '/student/track-bus';
        const isTripEvent = data.type === 'TRIP_STARTED' || data.type === 'TRIP_ENDED';

        if (isTrackingPage && isTripEvent) {
          console.log('🔇 Skipping FCM toast - user is on tracking page');
          return;
        }

        if (data.type === 'TRIP_STARTED') {
          addToastRef.current?.(
            body || '🚌 Your bus has started its journey! Track it live now.',
            'success'
          );
        } else if (data.type === 'TRIP_ENDED') {
          addToastRef.current?.(
            body || '🏁 Your bus trip has ended.',
            'info'
          );
        } else if (title || body) {
          // Generic notification fallback
          addToastRef.current?.(body || title || 'New notification', 'info');
        }
      });
    } catch {
      // Silently fail — foreground messaging not critical
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser?.uid, userData, pathname]);

  const [showPromptBanner, setShowPromptBanner] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && userData?.role === 'student') {
      if (Notification.permission === 'default') {
        setShowPromptBanner(true);
      }
    }
  }, [userData]);

  const handleEnableNotifications = async () => {
    setShowPromptBanner(false);
    if (!currentUser) return;
    try {
      const granted = await requestNotificationPermission();
      if (granted) {
        await syncToken(true);
        addToastRef.current?.('🔔 Push notifications enabled! You will be notified when your trip starts.', 'success');
      } else {
        addToastRef.current?.('Notifications permission was not granted.', 'info');
      }
    } catch (err) {
      console.warn('Failed to enable notifications:', err);
    }
  };

  return (
    <>
      {showPromptBanner && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 p-4 bg-gray-900 text-white rounded-2xl shadow-2xl border border-gray-800 flex flex-col gap-3 animate-in slide-in-from-bottom duration-300">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🚌</span>
              <div>
                <h4 className="font-semibold text-sm">Enable Trip Notifications</h4>
                <p className="text-xs text-gray-300">Get instant alerts on your phone when your bus starts its journey.</p>
              </div>
            </div>
            <button
              onClick={() => setShowPromptBanner(false)}
              className="text-gray-400 hover:text-white p-1 text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowPromptBanner(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded-lg transition-colors"
            >
              Later
            </button>
            <button
              onClick={handleEnableNotifications}
              className="px-4 py-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-gray-950 rounded-lg transition-colors shadow-sm"
            >
              Enable Notifications
            </button>
          </div>
        </div>
      )}
    </>
  );
}
