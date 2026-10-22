"use client";

import { getGuwahatiPmtilesUrl } from "@/lib/maps/guwahati-pmtiles";
import { ensurePmtilesProtocolRegistered } from "@/lib/maps/pmtiles-protocol";
import maplibregl,{ type Map as MapLibreMap,Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import React,{ forwardRef,useEffect,useImperativeHandle,useRef,useState } from "react";

export type MapTheme = "light" | "dark";

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  kind: "bus" | "student" | "stop" | "driver" | "waiting" | "university";
  label?: string;
  emphasis?: "primary" | "secondary";
};

export interface GuwahatiMapHandles {
  zoomIn: () => void;
  zoomOut: () => void;
  recenter: () => void;
}

const GUWAHATI_BOUNDS: [[number, number], [number, number]] = [
  [91.45, 26.02],
  [91.90, 26.27],
];

export const ADTU_COORDS = { lat: 26.2019, lng: 91.8615 };

function clampLatLngToBounds(lat: number, lng: number): { lat: number; lng: number } {
  const [[w, s], [e, n]] = GUWAHATI_BOUNDS;
  return {
    lat: Math.max(s, Math.min(n, lat)),
    lng: Math.max(w, Math.min(e, lng)),
  };
}

function buildVectorStyle(pmtilesUrl: string, theme: MapTheme) {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f7f5f0"; // Warm creamy base
  const water = isDark ? "#1e293b" : "#cbd5e2"; // Muted blue-grey water
  const road = isDark ? "#334155" : "#ffffff";
  const roadCasing = isDark ? "#020617" : "#e2ddd3"; // Warm creamy casing
  const building = isDark ? "#1e293b" : "#e4e9f0";
  const park = isDark ? "#064e3b" : "#e8eee4"; // Muted creamy green
  const placeText = isDark ? "#f8fafc" : "#4a5568"; // Silvery slate-700
  const roadText = isDark ? "#94a3b8" : "#64748b"; // Silvery slate-500
  const haloColor = isDark ? "#020617" : "#ffffff";




  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const absolutePmtilesUrl = pmtilesUrl.startsWith('/') ? `${baseUrl}${pmtilesUrl}` : pmtilesUrl;

  return {
    version: 8,
    name: "Guwahati Premium Vector",
    sources: {
      guwahati: {
        type: "vector",
        url: `pmtiles://${absolutePmtilesUrl}`,
        attribution: "© AdtU",
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": bg } },
      { id: "water", type: "fill", source: "guwahati", "source-layer": "water", paint: { "fill-color": water } },
      { id: "landuse", type: "fill", source: "guwahati", "source-layer": "landuse", filter: ["in", "class", "park", "forest", "grass"], paint: { "fill-color": park, "fill-opacity": isDark ? 0.4 : 0.8 } },
      { id: "buildings", type: "fill", source: "guwahati", "source-layer": "building", paint: { "fill-color": building, "fill-opacity": isDark ? 0.35 : 0.45, "fill-outline-color": isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" } },
      { id: "roads_casing", type: "line", source: "guwahati", "source-layer": "transportation", paint: { "line-color": roadCasing, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 6], "line-opacity": isDark ? 0.5 : 0.4 } },



      { id: "roads", type: "line", source: "guwahati", "source-layer": "transportation", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": road, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 4] } },
      {
        id: "poi-labels", type: "symbol", source: "guwahati", "source-layer": "poi", minzoom: 15,
        layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name_int"], ["get", "name"]], "text-size": 10, "text-font": ["Noto Sans Regular"], "text-variable-anchor": ["top", "bottom", "left", "right"], "text-padding": 4 },
        paint: { "text-color": isDark ? "#94a3b8" : "#64748b", "text-halo-color": haloColor, "text-halo-width": 1 }
      },
      {
        id: "road-labels", type: "symbol", source: "guwahati", "source-layer": "transportation_name", minzoom: 13,
        layout: { "symbol-placement": "line", "symbol-spacing": 250, "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"], ["get", "ref"]], "text-size": 11, "text-font": ["Noto Sans Regular"], "text-transform": "uppercase", "text-letter-spacing": 0.1 },
        paint: { "text-color": roadText, "text-halo-color": haloColor, "text-halo-width": 2 }
      },
      {
        id: "place-labels", type: "symbol", source: "guwahati", "source-layer": "place", minzoom: 11,
        layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name_int"], ["get", "name"]], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 12, 16, 18], "text-font": ["Noto Sans Bold"], "text-letter-spacing": -0.02 },
        paint: { "text-color": placeText, "text-halo-color": haloColor, "text-halo-width": 2.5 }
      }
    ],
  };
}

async function preflightPmtiles(url: string): Promise<void> {
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) throw Object.assign(new Error(`PMTiles file inaccessible`), { status: res.status });
}

const TOP_DOWN_BUS_SVG = `
<svg width="28" height="50" viewBox="0 0 44 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">
  <!-- Vehicle Body Drop Shadow / Ambient -->
  <rect x="5" y="3" width="34" height="74" rx="10" fill="rgba(0,0,0,0.2)"/>
  <!-- Main Bus Chassis (Transit Yellow) -->
  <rect x="6" y="2" width="32" height="72" rx="9" fill="url(#busBodyGradient)" stroke="#0f172a" stroke-width="1.8"/>
  <!-- Front Windshield -->
  <path d="M10 16 C10 11 15 8 22 8 C29 8 34 11 34 16 L33 22 C33 22 28 20 22 20 C16 20 11 22 11 22 Z" fill="#38bdf8"/>
  <!-- Front Windshield Reflection -->
  <path d="M13 14 Q22 10 31 14" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Side Mirrors -->
  <rect x="2" y="16" width="4" height="7" rx="2" fill="#0f172a" stroke="#ffffff" stroke-width="0.8"/>
  <rect x="38" y="16" width="4" height="7" rx="2" fill="#0f172a" stroke="#ffffff" stroke-width="0.8"/>
  <!-- Rooftop A/C unit -->
  <rect x="13" y="29" width="18" height="24" rx="3.5" fill="rgba(0,0,0,0.12)" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
  <!-- Rooftop Vent Slats -->
  <line x1="16" y1="35" x2="28" y2="35" stroke="rgba(0,0,0,0.25)" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="16" y1="41" x2="28" y2="41" stroke="rgba(0,0,0,0.25)" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="16" y1="47" x2="28" y2="47" stroke="rgba(0,0,0,0.25)" stroke-width="1.2" stroke-linecap="round"/>
  <!-- Rear Window -->
  <rect x="11" y="66" width="22" height="4" rx="1.5" fill="#38bdf8" opacity="0.85"/>
  <!-- Front Headlights (Warm White / Bright Glow) -->
  <rect x="8" y="2.5" width="6" height="2" rx="1" fill="#ffffff"/>
  <rect x="30" y="2.5" width="6" height="2" rx="1" fill="#ffffff"/>
  <!-- Tail Lights (Ruby Red) -->
  <rect x="8" y="72.5" width="6" height="2" rx="1" fill="#ef4444"/>
  <rect x="30" y="72.5" width="6" height="2" rx="1" fill="#ef4444"/>
  <!-- Defs for Gradient -->
  <defs>
    <linearGradient id="busBodyGradient" x1="6" y1="2" x2="38" y2="74" gradientUnits="userSpaceOnUse">
      <stop stop-color="#facc15"/>
      <stop offset="1" stop-color="#ca8a04"/>
    </linearGradient>
    <linearGradient id="driverBodyGradient" x1="6" y1="2" x2="38" y2="74" gradientUnits="userSpaceOnUse">
      <stop stop-color="#f59e0b"/>
      <stop offset="1" stop-color="#d97706"/>
    </linearGradient>
  </defs>
</svg>
`;

export function computeShortestRotation(currentTotalAngle: number, newHeading: number): number {
  const currentAngleMod = ((currentTotalAngle % 360) + 360) % 360;
  let diff = newHeading - currentAngleMod;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return currentTotalAngle + diff;
}

const SVG_ICONS = {
  university: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
  student: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  waiting: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>`,
  stop: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`,
};

function makeMarkerEl(kind: MapPoint["kind"], theme: MapTheme, label?: string, heading?: number) {
  const isDark = theme === "dark";
  const isBus = kind === "bus" || kind === "driver";
  const isUni = kind === "university";
  const size = isUni ? 48 : 36;
  const innerSize = isUni ? 36 : 28;

  const container = document.createElement("div");
  container.className = "flex flex-col items-center group cursor-pointer";
  const el = document.createElement("div");

  if (isBus) {
    // Pure top-down vector vehicle icon with NO circular background, NO circular border, NO sphere, and NO aura ring
    container.style.backgroundColor = "transparent";
    container.style.border = "none";
    container.style.boxShadow = "none";
    container.style.borderRadius = "0";
    container.style.overflow = "visible";

    el.style.width = "28px";
    el.style.height = "50px";
    el.style.display = "grid";
    el.style.placeItems = "center";
    el.style.position = "relative";
    el.style.backgroundColor = "transparent";
    el.style.border = "none";
    el.style.boxShadow = "none";
    el.style.borderRadius = "0";
    el.style.overflow = "visible";

    // Uber-style rotating top-down bus graphic container
    const rotator = document.createElement("div");
    rotator.className = "bus-marker-rotator";
    rotator.style.width = "100%";
    rotator.style.height = "100%";
    rotator.style.display = "grid";
    rotator.style.placeItems = "center";
    rotator.style.backgroundColor = "transparent";
    rotator.style.border = "none";
    rotator.style.boxShadow = "none";
    rotator.style.transition = "transform 1.2s ease-out";
    rotator.style.transformOrigin = "center center";
    const initHeading = Number(heading) || 0;
    rotator.style.transform = `rotate(${initHeading}deg)`;

    const busGraphic = kind === "driver"
      ? TOP_DOWN_BUS_SVG.replace('url(#busBodyGradient)', 'url(#driverBodyGradient)')
      : TOP_DOWN_BUS_SVG;
    rotator.innerHTML = busGraphic;
    el.appendChild(rotator);
  } else {
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = "50%";
    el.style.display = "grid";
    el.style.placeItems = "center";
    el.style.position = "relative";
    el.style.boxShadow = isDark ? "0 10px 25px rgba(0,0,0,0.6)" : "0 10px 25px rgba(0,0,0,0.15)";
    el.style.border = isDark ? "2px solid rgba(255,255,255,0.15)" : "2px solid rgba(255,255,255,0.9)";
    el.style.backgroundColor = isDark ? "#1e293b" : "#ffffff";
    el.style.transition = "transform 0.3s ease";
    const inner = document.createElement("div");
    inner.className = "bus-marker-inner";
    inner.style.width = `${innerSize}px`;
    inner.style.height = `${innerSize}px`;
    inner.style.borderRadius = "50%";
    inner.style.display = "grid";
    inner.style.placeItems = "center";
    inner.style.fontWeight = "800";
    inner.style.color = "white";
    inner.style.transition = "transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)";

    if (kind === "university") {
      inner.style.background = "linear-gradient(135deg, #dc2626, #991b1b)";
      inner.innerHTML = SVG_ICONS.university;
    } else if (kind === "student") {
      inner.style.background = "linear-gradient(135deg, #f97316, #db2777)";
      inner.innerHTML = SVG_ICONS.student;
    } else if (kind === "waiting") {
      inner.style.background = "linear-gradient(135deg, #ea580c, #c026d3)";
      inner.innerHTML = SVG_ICONS.waiting;
    } else {
      inner.style.background = "linear-gradient(135deg, #64748b, #94a3b8)";
      inner.innerHTML = SVG_ICONS.stop;
    }
    el.appendChild(inner);
  }

  container.appendChild(el);
  if (!isBus && label) {
    const labelEl = document.createElement("div");
    labelEl.className = "mt-2 px-2.5 py-1 bg-white dark:bg-slate-900 shadow-xl rounded-lg text-[10px] font-black tracking-wider uppercase border border-black/5 dark:border-white/10 whitespace-nowrap";
    labelEl.style.color = isDark ? "#cbd5e1" : "#1e293b";
    labelEl.textContent = label;
    container.appendChild(labelEl);
  }
  return container;
}

function animateMarkerTo(
  marker: MapLibreMarker,
  fromRaw: any,
  to: { lat: number; lng: number },
  rafRef: React.MutableRefObject<number | null>
) {
  if (!marker || !to) return;
  const fromLng = Number(fromRaw?.lng ?? to.lng);
  const fromLat = Number(fromRaw?.lat ?? to.lat);
  const toLng = Number(to.lng);
  const toLat = Number(to.lat);

  if (isNaN(toLng) || isNaN(toLat)) return;

  if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

  // If tab/screen is hidden, do not spin a 60fps RAF loop; jump directly to save battery/GPU
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    marker.setLngLat([toLng, toLat]);
    rafRef.current = null;
    return;
  }

  const start = performance.now();
  const step = (t: number) => {
    // 1800ms quartic ease-out smoothly bridges 3s GPS updates without overshoot or jitter
    const p = Math.min(1, (t - start) / 1800);
    const e = 1 - Math.pow(1 - p, 4);
    const currentLng = fromLng + (toLng - fromLng) * e;
    const currentLat = fromLat + (toLat - fromLat) * e;
    marker.setLngLat([currentLng, currentLat]);
    if (p < 1) {
      rafRef.current = requestAnimationFrame(step);
    } else {
      rafRef.current = null;
    }
  };
  rafRef.current = requestAnimationFrame(step);
}

type Props = {
  theme: MapTheme;
  center?: [number, number];
  zoom?: number;
  busPosition: { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number } | null;
  primaryKind?: "bus" | "driver";
  points?: MapPoint[];
  restrictToGuwahati?: boolean;
  className?: string;
  onFatalError?: (message: string) => void;
  followBus?: boolean;
  routeGeometry?: Array<{ lat: number; lng: number }> | null;
  routeId?: string;
  enableRouteAlignment?: boolean;
};

import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";
import {
  alignBusPositionToRoute,
  createInitialAlignmentState,
  type RouteAlignmentState,
} from "@/lib/maps/route-alignment-engine";
import { getCanonicalRouteGeometry } from "@/domains/route/data/canonical-route-geometries";

const GuwahatiMap = forwardRef<GuwahatiMapHandles, Props>(({
  theme,
  busPosition,
  center,
  zoom = 14.5,
  points = [],
  restrictToGuwahati = true,
  className,
  onFatalError,
  primaryKind = "bus",
  followBus = false,
  routeGeometry,
  routeId,
  enableRouteAlignment = true,
}, ref) => {
  // Prevent screen auto-off whenever map is active / full screened
  useScreenWakeLock(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const busMarkerRef = useRef<MapLibreMarker | null>(null);
  const busAnimationRef = useRef<number | null>(null);
  const markersRef = useRef<Map<string, MapLibreMarker>>(new Map());
  // Tracks whether the user has manually panned the map since last recenter.
  // When true, auto-follow is suspended so we don't fight the driver's intent.
  const userPannedRef = useRef<boolean>(false);

  const [fatal, setFatal] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const isDark = theme === "dark";

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    recenter: () => {
      // Clear pan-interrupt flag so auto-follow resumes after manual recenter
      userPannedRef.current = false;
      let target: [number, number] | null = null;
      if (busPosition && (busPosition.lat !== 0 || busPosition.lng !== 0)) {
        target = [busPosition.lng, busPosition.lat];
      } else if (center && (center[0] !== 0 || center[1] !== 0)) {
        target = [center[1], center[0]];
      } else {
        const userPoint = points?.find((p) => p.kind === "student" || p.kind === "driver" || p.kind === "waiting");
        if (userPoint && (userPoint.lat !== 0 || userPoint.lng !== 0)) {
          target = [userPoint.lng, userPoint.lat];
        }
      }
      if (!target) {
        target = [ADTU_COORDS.lng, ADTU_COORDS.lat];
      }
      mapRef.current?.flyTo({ center: target as any, zoom: 15.5 });
    }
  }));

  const pmtilesUrl = getGuwahatiPmtilesUrl();
  const effectiveCenter = (() => {
    let base: [number, number];
    if (busPosition && (busPosition.lat !== 0 || busPosition.lng !== 0)) {
      base = [busPosition.lat, busPosition.lng];
    } else if (center && (center[0] !== 0 || center[1] !== 0)) {
      base = center;
    } else {
      const userPoint = points?.find((p) => p.kind === "student" || p.kind === "driver" || p.kind === "waiting");
      if (userPoint && (userPoint.lat !== 0 || userPoint.lng !== 0)) {
        base = [userPoint.lat, userPoint.lng];
      } else {
        base = [ADTU_COORDS.lat, ADTU_COORDS.lng];
      }
    }
    return restrictToGuwahati ? [clampLatLngToBounds(base[0], base[1]).lat, clampLatLngToBounds(base[0], base[1]).lng] : base;
  })();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    
    let isMounted = true;

    (async () => {
      try {
        await ensurePmtilesProtocolRegistered();
        
        try {
          await preflightPmtiles(pmtilesUrl);
        } catch (pfErr) {
          console.warn("PMTiles preflight failed, attempting to load map anyway:", pfErr);
        }

        if (!isMounted || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: buildVectorStyle(pmtilesUrl, theme) as any,
          center: [effectiveCenter[1], effectiveCenter[0]] as any,
          zoom,
          minZoom: 10,
          maxZoom: 18,
          attributionControl: false,
          localIdeographFontFamily: 'sans-serif',
        });

        mapRef.current = map;
        map.once('load', () => {
          if (isMounted) setMapLoaded(true);
        });

        // Register drag-start listener to interrupt auto-follow when the driver
        // manually pans the map. The flag is cleared on recenter().
        map.on('dragstart', () => {
          userPannedRef.current = true;
        });
        
        map.on('error', (e) => {
          console.error("MapLibre error:", e);
        });

        if (restrictToGuwahati) map.setMaxBounds(GUWAHATI_BOUNDS as any);
      } catch (e) {
        console.error("Map initialization critical error:", e);
        if (isMounted) {
          setFatal("Load failed");
          onFatalError?.("Map load failed");
        }
      }
    })();
    
    return () => {
      isMounted = false;
      if (busAnimationRef.current != null) {
        cancelAnimationFrame(busAnimationRef.current);
        busAnimationRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const [styleVersion, setStyleVersion] = useState(0);

  useEffect(() => {
    if (mapRef.current && mapLoaded) {
      mapRef.current.setStyle(buildVectorStyle(pmtilesUrl, theme) as any, { diff: true } as any);
      mapRef.current.once('style.load', () => {
        setStyleVersion(v => v + 1);
      });
    }
  }, [theme, pmtilesUrl, mapLoaded]);

  const lastThemeRef = useRef<MapTheme>(theme);
  const lastKindRef = useRef(primaryKind);
  const routeAlignmentStateRef = useRef<RouteAlignmentState>(createInitialAlignmentState());
  const lastValidHeadingRef = useRef<number>(0);
  const cumulativeHeadingRef = useRef<number>(0);

  // Reset alignment state if routeId or routeGeometry changes
  useEffect(() => {
    routeAlignmentStateRef.current = createInitialAlignmentState();
  }, [routeId, routeGeometry]);

  // Clean unmount of animation loop
  useEffect(() => {
    return () => {
      if (busAnimationRef.current != null) {
        cancelAnimationFrame(busAnimationRef.current);
        busAnimationRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !busPosition) {
      if (busAnimationRef.current != null) { cancelAnimationFrame(busAnimationRef.current); busAnimationRef.current = null; }
      if (busMarkerRef.current) { busMarkerRef.current.remove(); busMarkerRef.current = null; }
      if (typeof window !== 'undefined') {
        (window as any).__itmsMarkerPosition = null;
        (window as any).__itmsRouteAlignStats = null;
      }
      routeAlignmentStateRef.current = createInitialAlignmentState();
      return;
    }

    const busLat = Number(busPosition.lat);
    const busLng = Number(busPosition.lng);
    const rawHeading = busPosition.heading !== undefined ? Number(busPosition.heading) : 0;
    // Retain last known valid heading if heading is undefined or 0 (never snap backward or spin when stationary)
    let effectiveHeading = cumulativeHeadingRef.current;
    if (Number.isFinite(rawHeading) && rawHeading >= 0 && (rawHeading > 0 || (busPosition.speed ?? 0) > 0.5)) {
      cumulativeHeadingRef.current = computeShortestRotation(cumulativeHeadingRef.current, rawHeading);
      lastValidHeadingRef.current = rawHeading;
      effectiveHeading = cumulativeHeadingRef.current;
    }

    if (isNaN(busLat) || isNaN(busLng) || (busLat === 0 && busLng === 0)) {
      return;
    }

    // Resolve route geometry: explicitly passed geometry or canonical geometry by routeId
    const activeRouteGeometry = routeGeometry || (routeId ? getCanonicalRouteGeometry(routeId) : null);

    let displayLat = busLat;
    let displayLng = busLng;
    let isAligned = false;

    if (enableRouteAlignment && activeRouteGeometry && activeRouteGeometry.length >= 2) {
      const alignment = alignBusPositionToRoute(
        {
          lat: busLat,
          lng: busLng,
          heading: effectiveHeading,
          speed: busPosition.speed,
          accuracy: busPosition.accuracy,
        },
        activeRouteGeometry,
        routeAlignmentStateRef.current,
        routeId || 'active'
      );

      displayLat = alignment.displayPoint.lat;
      displayLng = alignment.displayPoint.lng;
      isAligned = alignment.isSnapped;

      if (typeof window !== 'undefined') {
        const state = routeAlignmentStateRef.current;
        (window as any).__itmsRouteAlignStats = {
          mode: alignment.mode,
          confidence: alignment.confidence,
          isSnapped: alignment.isSnapped,
          distanceToRouteMeters: alignment.distanceToRouteMeters,
          consecutiveOffRouteCount: alignment.consecutiveOffRouteCount,
          calculationTimeMs: alignment.calculationTimeMs,
          rawPoint: alignment.rawPoint,
          displayPoint: alignment.displayPoint,
          snappedPoint: alignment.snappedPoint,
          totalCalculations: state.totalCalculations,
          avgCalculationTimeMs: state.totalCalculations > 0
            ? Math.round((state.totalCalculationTimeMs / state.totalCalculations) * 1000) / 1000
            : 0,
          maxCalculationTimeMs: state.maxCalculationTimeMs,
        };
      }
    }

    const pos = restrictToGuwahati
      ? clampLatLngToBounds(displayLat, displayLng)
      : { lat: displayLat, lng: displayLng, heading: effectiveHeading };

    // E2E observability: expose the marker's target position so Playwright
    // can verify the rendered marker follows the accepted GPS state.
    (window as any).__itmsMarkerPosition = {
      lat: pos.lat,
      lng: pos.lng,
      heading: effectiveHeading,
      rawHeading: rawHeading,
      atMs: Date.now(),
      isSnapped: isAligned,
      rawLat: busLat,
      rawLng: busLng,
    };

    const themeChanged = lastThemeRef.current !== theme;
    const kindChanged = lastKindRef.current !== primaryKind;

    if (themeChanged || kindChanged || !busMarkerRef.current) {
      if (busAnimationRef.current != null) { cancelAnimationFrame(busAnimationRef.current); busAnimationRef.current = null; }
      if (busMarkerRef.current) busMarkerRef.current.remove();
      busMarkerRef.current = new maplibregl.Marker({ element: makeMarkerEl(primaryKind, theme, undefined, effectiveHeading) })
        .setLngLat([pos.lng, pos.lat])
        .addTo(mapRef.current);
      lastThemeRef.current = theme;
      lastKindRef.current = primaryKind;
    } else {
      animateMarkerTo(busMarkerRef.current, busMarkerRef.current.getLngLat() as any, pos, busAnimationRef);
      // Smoothly rotate bus marker rotator element along road corners and intersections (Uber-style)
      const rotator = busMarkerRef.current.getElement().querySelector('.bus-marker-rotator') as HTMLElement | null;
      if (rotator) {
        rotator.style.transition = 'transform 1.2s ease-out';
        rotator.style.transform = `rotate(${effectiveHeading}deg)`;
      }
    }

    // Auto-follow: smoothly pan camera to bus when followBus=true and driver
    // hasn't manually panned. This runs after every GPS update so the driver
    // always sees the bus without needing to tap recenter.
    if (followBus && !userPannedRef.current) {
      mapRef.current.flyTo({
        center: [pos.lng, pos.lat],
        duration: 1200,
        essential: true,
      });
    }
  }, [busPosition?.lat, busPosition?.lng, busPosition?.heading, busPosition?.speed, busPosition?.accuracy, theme, primaryKind, mapLoaded, followBus, routeId, routeGeometry, enableRouteAlignment]);


  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const all = [...points, { id: "adtu", ...ADTU_COORDS, kind: "university" as const, label: "AdtU Campus" }];
    markersRef.current.forEach(m => m.remove());
    markersRef.current.clear();
    all.forEach(p => {
      const pos = restrictToGuwahati ? clampLatLngToBounds(p.lat, p.lng) : p;
      const m = new maplibregl.Marker({ element: makeMarkerEl(p.kind, theme, p.label) })
        .setLngLat([pos.lng, pos.lat])
        .addTo(mapRef.current!);
      markersRef.current.set(p.id, m);
    });
  }, [points, theme, mapLoaded, styleVersion]);

  if (fatal) return <div className="w-full h-full bg-slate-900 flex items-center justify-center text-white">Unavailable</div>;

  return (
    <div className={`w-full h-full relative group ${className ?? ""}`}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

GuwahatiMap.displayName = "GuwahatiMap";
export default GuwahatiMap;
