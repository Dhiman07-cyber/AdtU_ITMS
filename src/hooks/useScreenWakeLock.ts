"use client";

import { useEffect, useRef } from 'react';

/**
 * Custom hook to keep device screen awake (prevent auto-off / screen lock)
 * whenever the user is viewing the map or live tracking.
 * Automatically re-acquires WakeLock on app resume / tab visibility change.
 */
export function useScreenWakeLock(enabled: boolean = true) {
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let isMounted = true;

    const requestWakeLock = async () => {
      // Don't request if document is hidden (browser will throw NotAllowedError)
      if (document.hidden) return;

      try {
        if ('wakeLock' in navigator) {
          // Release existing if any
          if (wakeLockRef.current) {
            try {
              await wakeLockRef.current.release();
            } catch (_) {}
          }
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
          console.log('🔒 [WakeLock] Screen WakeLock acquired — screen will remain ON');

          wakeLockRef.current.addEventListener('release', () => {
            console.log('🔓 [WakeLock] Screen WakeLock released');
            wakeLockRef.current = null;
          });
        }
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          console.warn('⚠️ [WakeLock] Acquisition note:', err.message);
        }
      }
    };

    // Acquire initial lock
    requestWakeLock();

    // Re-acquire lock when phone screen turns back on / app comes to foreground
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isMounted && enabled) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release();
        } catch (_) {}
        wakeLockRef.current = null;
      }
    };
  }, [enabled]);
}
