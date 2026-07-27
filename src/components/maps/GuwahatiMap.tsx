"use client";

import { getGuwahatiPmtilesUrl } from "@/lib/maps/guwahati-pmtiles";
import { ensurePmtilesProtocolRegistered } from "@/lib/maps/pmtiles-protocol";
import maplibregl,{ type Map as MapLibreMap,Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import React,{ forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState } from "react";

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

function makeMarkerEl(kind: MapPoint["kind"], theme: MapTheme, label?: string) {
  const isDark = theme === "dark";
  const isBus = kind === "bus" || kind === "driver";
  const isUni = kind === "university";
  const size = isBus ? 52 : (isUni ? 48 : 36);
  const innerSize = isBus ? 40 : (isUni ? 36 : 28);

  const container = document.createElement("div");
  container.className = "flex flex-col items-center group";
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "50%";
  el.style.display = "grid";
  el.style.placeItems = "center";
  el.style.position = "relative";
  el.style.boxShadow = isDark ? "0 10px 25px rgba(0,0,0,0.6)" : "0 10px 25px rgba(0,0,0,0.15)";
  el.style.border = isDark ? "2px solid rgba(255,255,255,0.1)" : "2px solid rgba(255,255,255,0.8)";
  el.style.backgroundColor = isDark ? "#1e293b" : "#ffffff";

  if (isBus) {
    const ring = document.createElement("div");
    ring.className = "absolute inset-0 rounded-full animate-ping pointer-events-none";
    ring.style.backgroundColor = isDark ? "rgba(59, 130, 246, 0.4)" : "rgba(37, 99, 235, 0.3)";
    el.appendChild(ring);
  }

  const inner = document.createElement("div");
  inner.style.width = `${innerSize}px`;
  inner.style.height = `${innerSize}px`;
  inner.style.borderRadius = "50%";
  inner.style.display = "grid";
  inner.style.placeItems = "center";
  inner.style.fontWeight = "800";
  inner.style.fontSize = isBus ? "20px" : (isUni ? "18px" : "14px");
  inner.style.color = "white";

  if (kind === "bus") { inner.style.background = "linear-gradient(135deg, #2563eb, #7c3aed)"; inner.textContent = "🚌"; }
  else if (kind === "driver") { inner.style.background = "linear-gradient(135deg, #0891b2, #2563eb)"; inner.textContent = "🚐"; }
  else if (kind === "university") { inner.style.background = "linear-gradient(135deg, #dc2626, #991b1b)"; inner.textContent = "🎓"; }
  else if (kind === "student" || kind === "waiting") { inner.style.background = "linear-gradient(135deg, #f97316, #db2777)"; inner.textContent = "📍"; }
  else { inner.style.background = "linear-gradient(135deg, #64748b, #94a3b8)"; inner.textContent = "•"; }

  el.appendChild(inner);
  container.appendChild(el);
  if (label) {
    const labelEl = document.createElement("div");
    labelEl.className = "mt-2 px-2.5 py-1 bg-white dark:bg-slate-900 shadow-xl rounded-lg text-[10px] font-bold border border-black/5 dark:border-white/10 whitespace-nowrap";
    labelEl.style.color = isDark ? "#cbd5e1" : "#1e293b";
    labelEl.textContent = label;
    container.appendChild(labelEl);
  }
  return container;
}

function animateMarkerTo(
  marker: MapLibreMarker,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  rafRef: React.MutableRefObject<number | null>
) {
  // Cancel any in-flight animation so overlapping updates don't fight each other
  if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  const start = performance.now();
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / 1000);
    const e = 1 - Math.pow(1 - p, 4);
    marker.setLngLat([from.lng + (to.lng - from.lng) * e, from.lat + (to.lat - from.lat) * e]);
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
  busPosition: { lat: number; lng: number } | null;
  primaryKind?: "bus" | "driver";
  points?: MapPoint[];
  restrictToGuwahati?: boolean;
  className?: string;
  onFatalError?: (message: string) => void;
};

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
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const busMarkerRef = useRef<MapLibreMarker | null>(null);
  const busAnimationRef = useRef<number | null>(null);
  const markersRef = useRef<Map<string, MapLibreMarker>>(new Map());

  const [fatal, setFatal] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const isDark = theme === "dark";

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    recenter: () => {
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

  const pmtilesUrl = useMemo(() => getGuwahatiPmtilesUrl(), []);
  const effectiveCenter = useMemo<[number, number]>(() => {
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
  }, [center, busPosition, points, restrictToGuwahati]);

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
      return;
    }

    const pos = restrictToGuwahati ? clampLatLngToBounds(busPosition.lat, busPosition.lng) : busPosition;
    const themeChanged = lastThemeRef.current !== theme;
    const kindChanged = lastKindRef.current !== primaryKind;

    if (themeChanged || kindChanged || !busMarkerRef.current) {
      if (busAnimationRef.current != null) { cancelAnimationFrame(busAnimationRef.current); busAnimationRef.current = null; }
      if (busMarkerRef.current) busMarkerRef.current.remove();
      busMarkerRef.current = new maplibregl.Marker({ element: makeMarkerEl(primaryKind, theme) })
        .setLngLat([pos.lng, pos.lat])
        .addTo(mapRef.current);
      lastThemeRef.current = theme;
      lastKindRef.current = primaryKind;
    } else {
      animateMarkerTo(busMarkerRef.current, busMarkerRef.current.getLngLat() as any, pos, busAnimationRef);
    }
  }, [busPosition?.lat, busPosition?.lng, theme, primaryKind, mapLoaded]);

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
