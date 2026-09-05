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

const SVG_ICONS = {
  bus: `<svg width="24" height="24" viewBox="0 0 50 50" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.4375 0 3 2.167969 3 8L3 41C3 42.359375 3.398438 43.339844 4 44.0625L4 47C4 48.652344 5.347656 50 7 50L11 50C12.652344 50 14 48.652344 14 47L14 46L36 46L36 47C36 48.652344 37.347656 50 39 50L43 50C44.652344 50 46 48.652344 46 47L46 44.0625C46.601563 43.339844 47 42.359375 47 41L47 9C47 4.644531 46.460938 0 40 0 Z M 15 4L36 4C36.554688 4 37 4.449219 37 5L37 7C37 7.550781 36.554688 8 36 8L15 8C14.449219 8 14 7.550781 14 7L14 5C14 4.449219 14.449219 4 15 4 Z M 11 11L39 11C41 11 42 12 42 14L42 26C42 28 40.046875 28.9375 39 28.9375L11 29C9 29 8 28 8 26L8 14C8 12 9 11 11 11 Z M 2 12C0.898438 12 0 12.898438 0 14L0 22C0 23.101563 0.898438 24 2 24 Z M 48 12L48 24C49.105469 24 50 23.101563 50 22L50 14C50 12.898438 49.105469 12 48 12 Z M 11.5 34C13.433594 34 15 35.566406 15 37.5C15 39.433594 13.433594 41 11.5 41C9.566406 41 8 39.433594 8 37.5C8 35.566406 9.566406 34 11.5 34 Z M 38.5 34C40.433594 34 42 35.566406 42 37.5C42 39.433594 40.433594 41 38.5 41C36.566406 41 35 39.433594 35 37.5C35 35.566406 36.566406 34 38.5 34Z"/></svg>`,
  driver: `<svg width="24" height="24" viewBox="0 0 50 50" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.4375 0 3 2.167969 3 8L3 41C3 42.359375 3.398438 43.339844 4 44.0625L4 47C4 48.652344 5.347656 50 7 50L11 50C12.652344 50 14 48.652344 14 47L14 46L36 46L36 47C36 48.652344 37.347656 50 39 50L43 50C44.652344 50 46 48.652344 46 47L46 44.0625C46.601563 43.339844 47 42.359375 47 41L47 9C47 4.644531 46.460938 0 40 0 Z M 15 4L36 4C36.554688 4 37 4.449219 37 5L37 7C37 7.550781 36.554688 8 36 8L15 8C14.449219 8 14 7.550781 14 7L14 5C14 4.449219 14.449219 4 15 4 Z M 11 11L39 11C41 11 42 12 42 14L42 26C42 28 40.046875 28.9375 39 28.9375L11 29C9 29 8 28 8 26L8 14C8 12 9 11 11 11 Z M 2 12C0.898438 12 0 12.898438 0 14L0 22C0 23.101563 0.898438 24 2 24 Z M 48 12L48 24C49.105469 24 50 23.101563 50 22L50 14C50 12.898438 49.105469 12 48 12 Z M 11.5 34C13.433594 34 15 35.566406 15 37.5C15 39.433594 13.433594 41 11.5 41C9.566406 41 8 39.433594 8 37.5C8 35.566406 9.566406 34 11.5 34 Z M 38.5 34C40.433594 34 42 35.566406 42 37.5C42 39.433594 40.433594 41 38.5 41C36.566406 41 35 39.433594 35 37.5C35 35.566406 36.566406 34 38.5 34Z"/></svg>`,
  university: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
  student: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  waiting: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>`,
  stop: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`,
};

function makeMarkerEl(kind: MapPoint["kind"], theme: MapTheme, label?: string, heading?: number) {
  const isDark = theme === "dark";
  const isBus = kind === "bus" || kind === "driver";
  const isUni = kind === "university";
  const size = isBus ? 52 : (isUni ? 48 : 36);
  const innerSize = isBus ? 40 : (isUni ? 36 : 28);

  const container = document.createElement("div");
  container.className = "flex flex-col items-center group cursor-pointer";
  const el = document.createElement("div");
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

  if (isBus) {
    const ring = document.createElement("div");
    ring.className = "absolute inset-0 rounded-full animate-ping pointer-events-none";
    ring.style.backgroundColor = isDark ? "rgba(59, 130, 246, 0.4)" : "rgba(37, 99, 235, 0.3)";
    el.appendChild(ring);
  }

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

  if (kind === "bus") {
    inner.style.background = "linear-gradient(135deg, #2563eb, #7c3aed)";
    inner.innerHTML = SVG_ICONS.bus;
  } else if (kind === "driver") {
    inner.style.background = "linear-gradient(135deg, #0891b2, #2563eb)";
    inner.innerHTML = SVG_ICONS.driver;
  } else if (kind === "university") {
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

  if (isBus && heading !== undefined && heading > 0) {
    inner.style.transform = `rotate(${heading}deg)`;
  }

  el.appendChild(inner);
  container.appendChild(el);
  if (label) {
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
  const start = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / 1000);
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
  busPosition: { lat: number; lng: number; heading?: number; speed?: number } | null;
  primaryKind?: "bus" | "driver";
  points?: MapPoint[];
  restrictToGuwahati?: boolean;
  className?: string;
  onFatalError?: (message: string) => void;
  followBus?: boolean;
};

import { useScreenWakeLock } from "@/hooks/useScreenWakeLock";

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
        ensurePmtilesProtocolRegistered();
        
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

  useEffect(() => {
    if (mapRef.current && mapLoaded) {
      mapRef.current.setStyle(buildVectorStyle(pmtilesUrl, theme) as any, { diff: true } as any);
    }
  }, [theme, pmtilesUrl, mapLoaded]);

  const lastThemeRef = useRef<MapTheme>(theme);
  const lastKindRef = useRef(primaryKind);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !busPosition) {
      if (busAnimationRef.current != null) { cancelAnimationFrame(busAnimationRef.current); busAnimationRef.current = null; }
      if (busMarkerRef.current) { busMarkerRef.current.remove(); busMarkerRef.current = null; }
      if (typeof window !== 'undefined') (window as any).__itmsMarkerPosition = null;
      return;
    }

    const busLat = Number(busPosition.lat);
    const busLng = Number(busPosition.lng);
    const busHeading = busPosition.heading !== undefined ? Number(busPosition.heading) : 0;

    if (isNaN(busLat) || isNaN(busLng) || (busLat === 0 && busLng === 0)) {
      return;
    }

    const pos = restrictToGuwahati
      ? clampLatLngToBounds(busLat, busLng)
      : { lat: busLat, lng: busLng, heading: busHeading };

    // E2E observability: expose the marker's target position so Playwright
    // can verify the rendered marker follows the accepted GPS state.
    (window as any).__itmsMarkerPosition = { lat: pos.lat, lng: pos.lng, heading: busHeading, atMs: Date.now() };

    const themeChanged = lastThemeRef.current !== theme;
    const kindChanged = lastKindRef.current !== primaryKind;

    if (themeChanged || kindChanged || !busMarkerRef.current) {
      if (busAnimationRef.current != null) { cancelAnimationFrame(busAnimationRef.current); busAnimationRef.current = null; }
      if (busMarkerRef.current) busMarkerRef.current.remove();
      busMarkerRef.current = new maplibregl.Marker({ element: makeMarkerEl(primaryKind, theme, undefined, busHeading) })
        .setLngLat([pos.lng, pos.lat])
        .addTo(mapRef.current);
      lastThemeRef.current = theme;
      lastKindRef.current = primaryKind;
    } else {
      animateMarkerTo(busMarkerRef.current, busMarkerRef.current.getLngLat() as any, pos, busAnimationRef);
      if (busHeading > 0) {
        const el = busMarkerRef.current.getElement();
        const inner = el?.querySelector('.bus-marker-inner') as HTMLElement | null;
        if (inner) inner.style.transform = `rotate(${busHeading}deg)`;
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
  }, [busPosition?.lat, busPosition?.lng, busPosition?.heading, theme, primaryKind, mapLoaded, followBus]);


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
  }, [points, theme, mapLoaded]);

  if (fatal) return <div className="w-full h-full bg-slate-900 flex items-center justify-center text-white">Unavailable</div>;

  return (
    <div className={`w-full h-full relative group ${className ?? ""}`}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

GuwahatiMap.displayName = "GuwahatiMap";
export default GuwahatiMap;
