"use client";

import { readMapPreferences,resolveThemePreference } from "@/lib/maps/map-preferences";
import { ensurePmtilesProtocolRegistered } from "@/lib/maps/pmtiles-protocol";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const TRACKING_ROUTES = ["/student/track-bus", "/driver/live-tracking"];

function isTrackingRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return TRACKING_ROUTES.some((p) => pathname.startsWith(p));
}

/**
 * App-level bootstrap for map runtime.
 *
 * - Keeps registration centralized (not inside individual map components)
 * - Uses dynamic imports so map libraries aren't loaded on unrelated pages
 * - Idempotent (safe with React strict mode / HMR)
 */
export default function MapRuntimeBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isTrackingRoute(pathname)) return;

    // Determine preferred theme preference
    const prefs = readMapPreferences();
    void resolveThemePreference(prefs?.theme);

    // Register vector map protocol
    void ensurePmtilesProtocolRegistered();
  }, [pathname]);

  return null;
}

