"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { Bell, MapPin, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function FloatingPermissionBanner() {
  const pathname = usePathname();
  const { userData, currentUser } = useAuth();

  const [notificationState, setNotificationState] = useState<NotificationPermission | 'unsupported'>('granted');
  const [geoState, setGeoState] = useState<PermissionState | 'unsupported'>('granted');
  const [dismissed, setDismissed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [showBlockedGuide, setShowBlockedGuide] = useState(false);

  // Check current permission statuses
  const checkStatus = useCallback(async () => {
    if (typeof window === 'undefined') return;

    // Check Notifications
    if ('Notification' in window) {
      setNotificationState(Notification.permission);
    } else {
      setNotificationState('unsupported');
    }

    // Check Geolocation
    if ('permissions' in navigator && navigator.permissions.query) {
      try {
        const geoPermission = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        setGeoState(geoPermission.state);
        geoPermission.onchange = () => {
          setGeoState(geoPermission.state);
        };
      } catch {
        setGeoState('prompt');
      }
    } else if ('geolocation' in navigator) {
      setGeoState('prompt');
    } else {
      setGeoState('unsupported');
    }
  }, []);

  useEffect(() => {
    checkStatus();
    if (typeof window !== 'undefined') {
      const isDismissed = sessionStorage.getItem('itms_perm_banner_dismissed');
      if (isDismissed === 'true') {
        setDismissed(true);
      }
    }
  }, [checkStatus]);

  // Don't render on public landing / login / legal pages
  const isPublicPage = pathname === '/' || pathname === '/login' || pathname?.startsWith('/(marketing)');
  if (isPublicPage || !currentUser) return null;

  // If already granted for both, or dismissed for this session, hide card
  const notificationsNeeded = notificationState === 'default';
  const geoNeeded = geoState === 'prompt';
  const isBlocked = notificationState === 'denied' || geoState === 'denied';

  // If both permissions are granted, or user dismissed non-blocked prompt, don't show
  if (!notificationsNeeded && !geoNeeded && !isBlocked) return null;
  if (dismissed && !isBlocked) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem('itms_perm_banner_dismissed', 'true');
    } catch {
      /* ignore */
    }
  };

  const handleAllowPermissions = async () => {
    setRequesting(true);
    setShowBlockedGuide(false);

    try {
      // 1. Trigger Native Notification Permission Prompt
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch (e) {
          console.warn('Native notification request error:', e);
        }
      }

      // 2. Trigger Native Device Geolocation Prompt
      if ('geolocation' in navigator) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            (err) => {
              if (err.code === err.PERMISSION_DENIED) {
                setShowBlockedGuide(true);
              }
              resolve();
            },
            { enableHighAccuracy: true, timeout: 8000 }
          );
        });
      }

      // Re-evaluate permissions after native prompts complete
      await checkStatus();
    } finally {
      setRequesting(false);
    }
  };

  const role = userData?.role || 'student';

  // Role-specific natural English phrasing
  const roleCopy = {
    driver: {
      title: "Live Trip & Passenger Sync",
      description: "For smooth communication between you and your passengers, please allow location sharing and notifications so your live trip updates stay synchronized.",
    },
    student: {
      title: "Live Pilot & Bus Updates",
      description: "For smooth communication between you and your pilot, it's recommended to allow location and notifications to receive live bus alerts and tracking.",
    },
    general: {
      title: "Real-Time Transit Alerts",
      description: "For smooth communication and accurate transit tracking, it's recommended to enable location and notification permissions.",
    }
  };

  const currentCopy = role === 'driver' ? roleCopy.driver : role === 'student' ? roleCopy.student : roleCopy.general;

  return (
    <div
      id="floating-permission-banner"
      className="fixed left-3 right-3 sm:left-6 sm:right-6 md:left-auto md:right-6 max-w-lg z-[10000] pointer-events-auto transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
      style={{
        // On mobile, straddles the bottom navigation bar (half above, half below the top edge of navbar)
        bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
      }}
      suppressHydrationWarning
    >
      <div className="relative overflow-hidden rounded-2xl bg-zinc-950/95 dark:bg-zinc-900/95 border border-blue-500/40 shadow-2xl shadow-blue-950/50 backdrop-blur-xl p-3.5 sm:p-4 text-white">
        {/* Ambient Top Glow */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-10 bg-blue-500/20 rounded-full blur-xl pointer-events-none" />

        <div className="flex items-start gap-3">
          {/* Icon Badge */}
          <div className="flex-shrink-0 mt-0.5 p-2 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md shadow-blue-500/30 text-white">
            {role === 'driver' ? (
              <MapPin className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
          </div>

          {/* Body Content */}
          <div className="flex-1 min-w-0 pr-6">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-tight text-white uppercase">
                {currentCopy.title}
              </span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Recommended
              </span>
            </div>

            <p className="mt-1 text-[11px] sm:text-xs text-zinc-300 leading-relaxed">
              {currentCopy.description}
            </p>

            {/* Blocked Guide helper if user previously blocked permissions */}
            {(isBlocked || showBlockedGuide) && (
              <p className="mt-2 text-[11px] text-amber-300 bg-amber-950/50 border border-amber-500/30 rounded-lg p-2 leading-tight">
                🔒 Permissions are currently blocked in your browser. Tap the lock/tune icon in your address bar to toggle <strong>Location</strong> and <strong>Notifications</strong> to <em>Allow</em>, then refresh.
              </p>
            )}

            {/* Actions */}
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleAllowPermissions}
                disabled={requesting}
                className="h-8 px-3.5 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-600/30 rounded-xl"
              >
                {requesting ? "Requesting..." : "Allow Permissions"}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                className="h-8 px-2.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl"
              >
                Later
              </Button>
            </div>
          </div>

          {/* Close / Dismiss Cross */}
          <button
            onClick={handleDismiss}
            className="absolute top-2.5 right-2.5 p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
            aria-label="Dismiss permission prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
