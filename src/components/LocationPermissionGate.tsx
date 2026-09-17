"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ArrowLeft, Compass, Lock, MapPin, RefreshCw, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

interface LocationPermissionGateProps {
  role: 'student' | 'driver';
  children: React.ReactNode;
}

/**
 * LocationPermissionGate
 * 
 * Strict access control gate for live-tracking routes (Student: Track Bus; Driver: Live Location Sharing).
 * Completely prevents users from proceeding until native device location permission is granted.
 * Triggers the authentic browser/OS permission prompt on demand.
 */
export default function LocationPermissionGate({
  role,
  children
}: LocationPermissionGateProps) {
  const router = useRouter();
  const [permissionStatus, setPermissionStatus] = useState<'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported'>('checking');
  const [requesting, setRequesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (typeof window === 'undefined') return;

    if (!('geolocation' in navigator)) {
      setPermissionStatus('unsupported');
      return;
    }

    if ('permissions' in navigator && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        setPermissionStatus(result.state);
        result.onchange = () => {
          setPermissionStatus(result.state);
        };
        return;
      } catch {
        // Fallback for browsers with restricted permissions API
      }
    }

    // Default to prompt if cannot be inspected directly
    setPermissionStatus('prompt');
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleRequestNativePermission = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setPermissionStatus('unsupported');
      return;
    }

    setRequesting(true);
    setErrorMessage(null);

    // Call native device/browser geolocation API directly
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setRequesting(false);
        setPermissionStatus('granted');
      },
      (error) => {
        setRequesting(false);
        if (error.code === error.PERMISSION_DENIED) {
          setPermissionStatus('denied');
          setErrorMessage('Location permission was denied. Please update your browser site permissions.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setErrorMessage('Device GPS / Location is currently turned off in your phone settings.');
        } else if (error.code === error.TIMEOUT) {
          setErrorMessage('Location request timed out. Please tap retry.');
        } else {
          setErrorMessage(error.message || 'Failed to obtain location.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      }
    );
  };

  // If permission is already granted, transparently render the protected tracking page
  if (permissionStatus === 'granted') {
    return <>{children}</>;
  }

  // During initial hydration check, render a clean loading placeholder
  if (permissionStatus === 'checking') {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
        <p className="text-sm text-zinc-400 font-medium">Verifying location permissions...</p>
      </div>
    );
  }

  const isDriver = role === 'driver';
  const dashboardPath = isDriver ? '/driver' : '/student';

  const headingText = isDriver
    ? "Location Access Required to Share Trip"
    : "Location Access Required to Track Bus";

  const descriptionText = isDriver
    ? "For smooth communication between you and your passengers, live location sharing is strictly required. This allows the system to broadcast your live route, calculate passenger ETAs, and keep everyone synchronized."
    : "For smooth communication between you and your pilot, location permission is required. This allows the system to identify your nearest pickup point, calculate walking distance, and display live bus arrival alerts.";

  return (
    <div
      id="location-permission-blocking-gate"
      className="fixed inset-0 z-[10005] bg-[#05060e]/95 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      suppressHydrationWarning
    >
      <Card className="max-w-lg w-full bg-zinc-900/95 border-2 border-blue-500/30 shadow-2xl shadow-blue-950/60 rounded-3xl overflow-hidden text-white my-auto">
        {/* Header Ribbon */}
        <CardHeader className="bg-gradient-to-r from-blue-950/60 via-indigo-950/40 to-zinc-900 border-b border-blue-500/20 p-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/20 border border-blue-500/40 shadow-lg shadow-blue-500/20">
            {permissionStatus === 'denied' ? (
              <ShieldAlert className="h-7 w-7 text-amber-400" />
            ) : (
              <MapPin className="h-7 w-7 text-blue-400 animate-pulse" />
            )}
          </div>
          <CardTitle className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            {headingText}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm text-zinc-300 mt-2 leading-relaxed max-w-md mx-auto">
            {descriptionText}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 space-y-5">
          {/* Error / Status Alert */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-950/40 border border-red-500/30 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-snug">{errorMessage}</p>
            </div>
          )}

          {/* Browser Unblock Guide if Denied */}
          {permissionStatus === 'denied' && (
            <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/30 space-y-2 text-zinc-300 text-xs">
              <div className="flex items-center gap-2 text-amber-400 font-semibold">
                <Lock className="h-4 w-4" />
                <span>How to Unblock Location in Your Browser:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11px] leading-relaxed text-zinc-300">
                <li>Tap the <strong>lock icon (🔒)</strong> or site settings button in your browser's address bar.</li>
                <li>Find <strong>Permissions</strong> &rarr; <strong>Location</strong>.</li>
                <li>Change the setting from <em>Block</em> to <strong>Allow</strong>.</li>
                <li>Tap <strong>Reload / Refresh</strong> below to proceed.</li>
              </ol>
            </div>
          )}

          {/* Value Proposition Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-2.5">
              <Compass className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-white">Live Tracking</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">High-accuracy coordinates guarantee real-time route precision.</p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-2.5">
              <MapPin className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-white">Smart Arrival Alerts</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">Accurate distance calculations prevent missed buses and delays.</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2.5 pt-2">
            {permissionStatus === 'denied' ? (
              <Button
                onClick={() => window.location.reload()}
                className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-600/30 rounded-2xl"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Page After Allowing
              </Button>
            ) : (
              <Button
                onClick={handleRequestNativePermission}
                disabled={requesting}
                className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-600/30 rounded-2xl"
              >
                <MapPin className="mr-2 h-4 w-4" />
                {requesting ? "Prompting Device..." : "Allow Location Access"}
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() => router.push(dashboardPath)}
              className="w-full h-10 text-xs font-medium border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-2xl"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
