"use client";

import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { getGuwahatiPmtilesUrl } from "@/lib/maps/guwahati-pmtiles";
import { ensurePmtilesProtocolRegistered } from "@/lib/maps/pmtiles-protocol";
import { getClientWsUrl } from "@/domains/realtime/ws-config";
import type { FleetBusLiveStatus } from "@/app/api/fleet/live-status/route";
import maplibregl, { type Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Activity,
  AlertCircle,
  Bus,
  CheckCircle,
  ChevronRight,
  Clock,
  Compass,
  Gauge,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Moon,
  Navigation,
  Phone,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Sun,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  alignBusPositionToRoute,
  createInitialAlignmentState,
  type RouteAlignmentState,
} from "@/lib/maps/route-alignment-engine";
import { getCanonicalRouteGeometry } from "@/domains/route/data/canonical-route-geometries";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";

// Full extent of Guwahati PMTiles vector dataset
const GUWAHATI_BOUNDS: [[number, number], [number, number]] = [
  [91.45, 26.00],
  [92.05, 26.35],
];

// Operational transit bounds encompassing all AdtU corridors across Guwahati
export const GUWAHATI_METRO_BOUNDS: [[number, number], [number, number]] = [
  [91.64, 26.10],
  [91.88, 26.22],
];

export const ADTU_COORDS = { lat: 26.2019, lng: 91.8615 };

function clampLatLngToBounds(lat: number, lng: number): { lat: number; lng: number } {
  const [[w, s], [e, n]] = GUWAHATI_BOUNDS;
  return {
    lat: Math.max(s, Math.min(n, lat)),
    lng: Math.max(w, Math.min(e, lng)),
  };
}

function getCompassHeading(heading?: number | null): string {
  if (heading == null || isNaN(heading)) return "N/A";
  const normalized = ((heading % 360) + 360) % 360;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(normalized / 22.5) % 16;
  return `${Math.round(normalized)}° ${directions[index]}`;
}

function buildVectorStyle(pmtilesUrl: string, isDark: boolean) {
  // Rich midnight palette: prevents empty black voids by distinguishing land from water
  const bg = isDark ? "#090e1c" : "#f7f5f0";
  const water = isDark ? "#081b30" : "#cbd5e2";
  const roadCasing = isDark ? "#030610" : "#e2ddd3";
  const building = isDark ? "#121a2d" : "#e4e9f0";
  const placeText = isDark ? "#cbd5e1" : "#1e293b";
  const roadText = isDark ? "#64748b" : "#64748b";
  const haloColor = isDark ? "#05060e" : "#ffffff";

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const absolutePmtilesUrl = pmtilesUrl.startsWith("/") ? `${baseUrl}${pmtilesUrl}` : pmtilesUrl;

  return {
    version: 8,
    name: "Guwahati Fleet Vector Dark",
    sources: {
      guwahati: {
        type: "vector",
        url: `pmtiles://${absolutePmtilesUrl}`,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": bg } },
      { id: "water", type: "fill", source: "guwahati", "source-layer": "water", paint: { "fill-color": water } },
      {
        id: "landcover",
        type: "fill",
        source: "guwahati",
        "source-layer": "landcover",
        paint: {
          "fill-color": isDark ? "#061f17" : "#e8eee4",
          "fill-opacity": isDark ? 0.35 : 0.6,
        },
      },
      {
        id: "landuse",
        type: "fill",
        source: "guwahati",
        "source-layer": "landuse",
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            ["park", "forest", "grass"],
            isDark ? "#08291c" : "#e8eee4",
            ["commercial", "industrial"],
            isDark ? "#0e1629" : "#f1f5f9",
            /* default / residential */
            isDark ? "#0a1122" : "#f8fafc",
          ],
          "fill-opacity": isDark ? 0.45 : 0.65,
        },
      },
      {
        id: "buildings",
        type: "fill",
        source: "guwahati",
        "source-layer": "building",
        paint: {
          "fill-color": building,
          "fill-opacity": isDark ? 0.6 : 0.45,
          "fill-outline-color": isDark ? "rgba(56, 189, 248, 0.08)" : "rgba(0,0,0,0.05)",
        },
      },
      {
        id: "roads_casing",
        type: "line",
        source: "guwahati",
        "source-layer": "transportation",
        paint: {
          "line-color": roadCasing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 13, 2.5, 16, 6],
          "line-opacity": isDark ? 0.7 : 0.4,
        },
      },
      {
        id: "roads",
        type: "line",
        source: "guwahati",
        "source-layer": "transportation",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "class"],
            ["motorway", "trunk", "primary"],
            isDark ? "#475569" : "#64748b",
            ["secondary", "tertiary"],
            isDark ? "#334155" : "#94a3b8",
            /* minor, residential, service */
            isDark ? "#1e293b" : "#cbd5e1",
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10, 0.8,
            13, 1.8,
            16, 4.5,
          ],
        },
      },
      {
        id: "poi-labels",
        type: "symbol",
        source: "guwahati",
        "source-layer": "poi",
        minzoom: 14,
        layout: {
          "text-field": ["coalesce", ["get", "name:latin"], ["get", "name_int"], ["get", "name"]],
          "text-size": 9.5,
          "text-font": ["Noto Sans Regular"],
          "text-variable-anchor": ["top", "bottom", "left", "right"],
          "text-padding": 3,
        },
        paint: { "text-color": placeText, "text-halo-color": haloColor, "text-halo-width": 1 },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "guwahati",
        "source-layer": "transportation_name",
        minzoom: 12,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 260,
          "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"], ["get", "ref"]],
          "text-size": 10,
          "text-font": ["Noto Sans Regular"],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.05,
        },
        paint: { "text-color": roadText, "text-halo-color": haloColor, "text-halo-width": 1.5 },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "guwahati",
        "source-layer": "place",
        minzoom: 11,
        layout: {
          "text-field": ["coalesce", ["get", "name:latin"], ["get", "name_int"], ["get", "name"]],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 16],
          "text-font": ["Noto Sans Bold"],
          "text-letter-spacing": -0.01,
        },
        paint: { "text-color": placeText, "text-halo-color": haloColor, "text-halo-width": 2 },
      },
    ],
  };
}

/**
 * Creates high-fidelity animated DOM marker for active bus
 */
function createBusMarkerElement(bus: FleetBusLiveStatus, isSelected: boolean) {
  const container = document.createElement("div");
  container.className = "itms-fleet-bus-marker group cursor-pointer select-none";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";

  const ring = document.createElement("div");
  ring.className = "itms-fleet-marker-bubble";
  ring.style.width = isSelected ? "42px" : "36px";
  ring.style.height = isSelected ? "42px" : "36px";
  ring.style.borderRadius = "50%";
  ring.style.display = "flex";
  ring.style.alignItems = "center";
  ring.style.justifyContent = "center";
  ring.style.position = "relative";
  ring.style.border = isSelected ? "2.5px solid #38bdf8" : "2px solid rgba(255,255,255,0.85)";

  let gradient = "linear-gradient(135deg, #10b981, #059669)"; // Live emerald
  if (bus.locationStatus === "STALE") {
    gradient = "linear-gradient(135deg, #f59e0b, #d97706)"; // Amber
  } else if (bus.locationStatus === "NO_SIGNAL") {
    gradient = "linear-gradient(135deg, #ef4444, #dc2626)"; // Red
  }
  ring.style.background = gradient;
  ring.style.boxShadow = isSelected
    ? "0 0 16px rgba(56, 189, 248, 0.8), 0 2px 8px rgba(0,0,0,0.5)"
    : bus.locationStatus === "LIVE"
    ? "0 0 0 2.5px rgba(52, 211, 153, 0.4), 0 2px 8px rgba(0,0,0,0.4)"
    : "0 2px 8px rgba(0,0,0,0.4)";

  // Heading arrow / bus icon
  const iconWrapper = document.createElement("div");
  iconWrapper.style.zIndex = "2";
  iconWrapper.style.display = "flex";
  iconWrapper.style.alignItems = "center";
  iconWrapper.style.justifyContent = "center";
  iconWrapper.style.color = "#ffffff";
  iconWrapper.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>`;

  if (bus.location?.heading && bus.location.heading > 0) {
    iconWrapper.style.transform = `rotate(${bus.location.heading}deg)`;
  }
  ring.appendChild(iconWrapper);
  container.appendChild(ring);

  // Floating speed tag if moving
  if (bus.location?.speed && bus.location.speed > 0) {
    const speedBadge = document.createElement("div");
    speedBadge.className = "itms-fleet-speed-tag";
    speedBadge.style.position = "absolute";
    speedBadge.style.top = "-8px";
    speedBadge.style.right = "-12px";
    speedBadge.style.background = "#05060e";
    speedBadge.style.color = "#34d399";
    speedBadge.style.border = "1px solid rgba(52, 211, 153, 0.4)";
    speedBadge.style.borderRadius = "9999px";
    speedBadge.style.padding = "1px 4px";
    speedBadge.style.fontSize = "8px";
    speedBadge.style.fontWeight = "900";
    speedBadge.style.fontFamily = "monospace";
    speedBadge.style.boxShadow = "0 2px 4px rgba(0,0,0,0.5)";
    speedBadge.textContent = `${Math.round(bus.location.speed)}k`;
    container.appendChild(speedBadge);
  }

  // Label tag below marker
  const label = document.createElement("div");
  label.className = "itms-fleet-marker-label";
  label.style.marginTop = "4px";
  label.style.padding = "2px 7px";
  label.style.borderRadius = "6px";
  label.style.fontSize = "10px";
  label.style.fontWeight = "800";
  label.style.letterSpacing = "0.03em";
  label.style.whiteSpace = "nowrap";
  label.style.pointerEvents = "none";
  label.style.background = "rgba(5, 6, 14, 0.92)";
  label.style.color = "#f8fafc";
  label.style.border = isSelected ? "1.5px solid #38bdf8" : "1px solid rgba(255,255,255,0.18)";
  label.style.boxShadow = "0 3px 8px rgba(0,0,0,0.6)";
  label.textContent = `Bus ${bus.busNumber}`;
  container.appendChild(label);

  return container;
}

export default function FleetMap({ role = "admin" }: { role?: "admin" | "moderator" }) {
  const { currentUser: user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark" || true; // Always prioritize sleek dark radar

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, MapLibreMarker>>(new Map());
  const campusMarkerRef = useRef<MapLibreMarker | null>(null);
  const fleetAlignmentStatesRef = useRef<Map<string, RouteAlignmentState>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  const [buses, setBuses] = useState<FleetBusLiveStatus[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "MOVING" | "IDLE">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [mapTheme, setMapTheme] = useState<"dark" | "light">("dark");

  // Fetch authoritative fleet status (buses with active trips only)
  const fetchFleetStatus = useCallback(async (isManual = false) => {
    if (!user) return;
    if (isManual) setRefreshing(true);
    const startTime = Date.now();
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/fleet/live-status", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data?.buses)) {
          // Filter strictly for active trips per user requirement
          const activeOnly = json.data.buses.filter((b: FleetBusLiveStatus) => b.tripStatus === "active");
          setBuses(activeOnly);
          setLastRefreshed(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        }
      }
    } catch (err) {
      console.warn("Error fetching fleet status:", err);
    } finally {
      if (isManual) {
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, 600 - elapsed);
        setTimeout(() => {
          setRefreshing(false);
          setLoading(false);
        }, delay);
      } else {
        setLoading(false);
      }
    }
  }, [user]);

  // Initial authoritative fleet fetch + resilient 8-second background polling
  useEffect(() => {
    fetchFleetStatus(false);
    const interval = setInterval(() => {
      fetchFleetStatus(false);
    }, 8000);
    return () => clearInterval(interval);
  }, [fetchFleetStatus]);

  // WebSocket real-time location stream connection with auto-reconnect backoff
  useEffect(() => {
    if (!user) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;

    async function initWs() {
      if (closed) return;
      try {
        const token = await user.getIdToken();
        const wsUrl = getClientWsUrl();
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (closed) return;
          reconnectAttempts = 0;
          setWsConnected(true);
          ws?.send(JSON.stringify({ type: "auth", token }));
        };

        ws.onclose = () => {
          if (closed) return;
          setWsConnected(false);
          if (!closed) {
            const delay = Math.min(30000, 3000 * Math.pow(1.5, reconnectAttempts));
            reconnectAttempts++;
            retryTimer = setTimeout(initWs, delay);
          }
        };

        ws.onerror = () => {
          if (closed) return;
          setWsConnected(false);
        };

        ws.onmessage = (evt) => {
          setTimeout(() => {
            try {
              const data = JSON.parse(evt.data);
              if (data.type === "authenticated") {
                // Subscribe to all active buses
                buses.forEach((b) => {
                  ws?.send(
                    JSON.stringify({
                      type: "subscribe",
                      channel: `bus_location_${b.busId}`,
                    })
                  );
                });
              } else if (data.event === "bus_location_update" && data.payload) {
                const p = data.payload;
                startTransition(() => {
                  setBuses((prev) =>
                    prev.map((b) => {
                      if (b.busId === p.busId || b.busNumber === p.busNumber) {
                        return {
                          ...b,
                          locationStatus: "LIVE",
                          location: {
                            lat: Number(p.lat),
                            lng: Number(p.lng),
                            accuracy: p.accuracy != null ? Number(p.accuracy) : b.location?.accuracy,
                            speed: p.speed != null ? Number(p.speed) : b.location?.speed,
                            heading: p.heading != null ? Number(p.heading) : b.location?.heading,
                            timestamp: p.timestamp || new Date().toISOString(),
                            ageSeconds: 0,
                          },
                        };
                      }
                      return b;
                    })
                  );
                });
              }
            } catch {
              // ignore non-json frames
            }
          }, 0);
        };
      } catch (e) {
        setWsConnected(false);
        if (!closed) {
          retryTimer = setTimeout(initWs, 5000);
        }
      }
    }

    initWs();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    };
  }, [user, buses.length]);

  // Toggle map dark/light vector style
  const toggleMapTheme = useCallback(() => {
    const nextTheme = mapTheme === "dark" ? "light" : "dark";
    setMapTheme(nextTheme);
    if (mapRef.current) {
      const pmtilesUrl = getGuwahatiPmtilesUrl();
      const style = buildVectorStyle(pmtilesUrl, nextTheme === "dark");
      mapRef.current.setStyle(style as any);
    }
  }, [mapTheme]);

  // Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isCancelled = false;
    let mapInstance: MapLibreMap | null = null;
    let ro: ResizeObserver | null = null;
    let timer1: NodeJS.Timeout | null = null;
    let timer2: NodeJS.Timeout | null = null;

    async function initMap() {
      await ensurePmtilesProtocolRegistered();
      if (isCancelled || !mapContainerRef.current) return;

      // Ensure container has valid client dimensions before initializing MapLibre
      if (mapContainerRef.current.clientHeight === 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }
      if (isCancelled || !mapContainerRef.current) return;

      const pmtilesUrl = getGuwahatiPmtilesUrl();
      const style = buildVectorStyle(pmtilesUrl, true);

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: style as any,
        center: [91.80, 26.17],
        zoom: 12.8,
        minZoom: 10,
        maxZoom: 18,
        attributionControl: false,
      });

      mapInstance = map;
      mapRef.current = map;

      map.on("load", () => {
        if (isCancelled) return;
        setMapLoaded(true);
        map.resize();

        // Add Campus Marker (crisp, zero GPU blur/animation overhead)
        const campusEl = document.createElement("div");
        campusEl.className = "flex flex-col items-center select-none pointer-events-none";
        campusEl.innerHTML = `
          <div class="relative flex items-center justify-center">
            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 border-2 border-white shadow-lg flex items-center justify-center text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/></svg>
            </div>
          </div>
          <div class="mt-1 px-2.5 py-0.5 rounded-md bg-[#0c0e1a] border border-indigo-500/40 text-[10px] font-semibold tracking-wide text-indigo-200 shadow-md flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
            AdtU Campus
          </div>
        `;

        campusMarkerRef.current = new maplibregl.Marker({ element: campusEl, anchor: "center" })
          .setLngLat([ADTU_COORDS.lng, ADTU_COORDS.lat])
          .addTo(map);

        // Focus initial view on the active Guwahati transit corridor and campus with enhanced zoom
        map.easeTo({ center: [91.80, 26.17], zoom: 12.8, duration: 0 });
      });

      // ResizeObserver throttled via requestAnimationFrame to prevent WebGL context thrashing
      let rafId: number | null = null;
      ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          map.resize();
        });
      });
      ro.observe(mapContainerRef.current);
    }

    initMap();

    return () => {
      isCancelled = true;
      if (ro) ro.disconnect();
      if (timer1) clearTimeout(timer1);
      if (timer2) clearTimeout(timer2);
      if (mapInstance) {
        mapInstance.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update selected route line layer on MapLibre
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;

    const renderRoute = () => {
      const selectedBus = buses.find((b) => b.busId === selectedBusId);
      const routeGeom = selectedBus?.routeId ? getCanonicalRouteGeometry(selectedBus.routeId) : null;
      const coords = routeGeom && routeGeom.length >= 2 ? routeGeom.map((pt) => [pt.lng, pt.lat]) : [];

      const sourceId = "selected-route-line-source";
      const layerCasingId = "selected-route-casing";
      const layerLineId = "selected-route-line";

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: coords,
            },
          },
        });

        map.addLayer({
          id: layerCasingId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#0369a1",
            "line-width": 7,
            "line-opacity": 0.5,
          },
        });

        map.addLayer({
          id: layerLineId,
          type: "line",
          source: sourceId,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#38bdf8",
            "line-width": 3.5,
            "line-opacity": 0.95,
          },
        });
      } else {
        const src = map.getSource(sourceId) as maplibregl.GeoJSONSource;
        src.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
        });
      }
    };

    if (!map.isStyleLoaded()) {
      map.once("style.load", renderRoute);
    } else {
      renderRoute();
    }
  }, [selectedBusId, buses, mapLoaded, mapTheme]);

  // Update bus markers when telemetry changes
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const currentMarkerIds = new Set<string>();

    buses.forEach((bus) => {
      if (!bus.location || !bus.location.lat || !bus.location.lng) return;

      const markerId = bus.busId;
      currentMarkerIds.add(markerId);

      let alignState = fleetAlignmentStatesRef.current.get(markerId);
      if (!alignState) {
        alignState = createInitialAlignmentState();
        fleetAlignmentStatesRef.current.set(markerId, alignState);
      }

      const routeGeom = getCanonicalRouteGeometry(bus.routeId);
      let targetLat = bus.location.lat;
      let targetLng = bus.location.lng;

      if (routeGeom && routeGeom.length >= 2) {
        const aligned = alignBusPositionToRoute(
          {
            lat: bus.location.lat,
            lng: bus.location.lng,
            heading: bus.location.heading,
            speed: bus.location.speed,
            accuracy: bus.location.accuracy,
          },
          routeGeom,
          alignState,
          bus.routeId || markerId
        );
        targetLat = aligned.displayPoint.lat;
        targetLng = aligned.displayPoint.lng;
      }

      const clamped = clampLatLngToBounds(targetLat, targetLng);
      const isSelected = bus.busId === selectedBusId;

      let marker = markersRef.current.get(markerId);
      if (!marker) {
        const el = createBusMarkerElement(bus, isSelected);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelectedBusId(bus.busId);
          map.flyTo({ center: [clamped.lng, clamped.lat], zoom: 15.5, duration: 800 });
        });

        marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([clamped.lng, clamped.lat])
          .addTo(map);

        markersRef.current.set(markerId, marker);
      } else {
        marker.setLngLat([clamped.lng, clamped.lat]);
        const el = marker.getElement();
        const bubble = el.querySelector(".itms-fleet-marker-bubble") as HTMLElement | null;
        if (bubble) {
          let gradient = "linear-gradient(135deg, #10b981, #059669)";
          if (bus.locationStatus === "STALE") gradient = "linear-gradient(135deg, #f59e0b, #d97706)";
          else if (bus.locationStatus === "NO_SIGNAL") gradient = "linear-gradient(135deg, #ef4444, #dc2626)";
          bubble.style.background = gradient;
          bubble.style.border = isSelected ? "2.5px solid #38bdf8" : "2px solid rgba(255,255,255,0.85)";
        }
      }
    });

    // Remove orphaned markers
    markersRef.current.forEach((marker, id) => {
      if (!currentMarkerIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
        fleetAlignmentStatesRef.current.delete(id);
      }
    });
  }, [buses, selectedBusId, mapLoaded]);

  // Aggregate stats across active units
  const stats = useMemo(() => {
    const totalActive = buses.length;
    const live = buses.filter((b) => b.locationStatus === "LIVE").length;
    const inMotion = buses.filter((b) => (b.location?.speed ?? 0) > 2).length;
    const idle = totalActive - inMotion;

    return {
      activeTrips: totalActive,
      liveSignal: live,
      inMotion,
      idle,
    };
  }, [buses]);

  // Filtered active buses list
  const filteredBuses = useMemo(() => {
    return buses.filter((b) => {
      const isMoving = (b.location?.speed ?? 0) > 2;
      const matchesFilter =
        filter === "ALL" ||
        (filter === "MOVING" && isMoving) ||
        (filter === "IDLE" && !isMoving);

      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        query === "" ||
        b.busNumber.toLowerCase().includes(query) ||
        (b.routeName && b.routeName.toLowerCase().includes(query)) ||
        (b.driverName && b.driverName.toLowerCase().includes(query));

      return matchesFilter && matchesSearch;
    });
  }, [buses, filter, searchQuery]);

  const selectedBus = useMemo(() => {
    return buses.find((b) => b.busId === selectedBusId) || null;
  }, [buses, selectedBusId]);

  // Ensure map canvas resizes smoothly when toggling full-screen mode and toggle body class
  useEffect(() => {
    document.body.classList.toggle("fleet-map-fullscreen", isFullScreen);

    if (mapRef.current) {
      if (isFullScreen) {
        (mapRef.current as any).cooperativeGestures?.disable();
      } else {
        (mapRef.current as any).cooperativeGestures?.enable();
      }
    }

    const rafId = requestAnimationFrame(() => {
      mapRef.current?.resize();
    });
    const timer = setTimeout(() => {
      mapRef.current?.resize();
    }, 100);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
      document.body.classList.remove("fleet-map-fullscreen");
    };
  }, [isFullScreen]);

  const handleRecenterFleet = () => {
    if (!mapRef.current) return;
    const activeLocations = buses
      .filter((b) => b.location && b.location.lat && b.location.lng)
      .map((b) => [b.location!.lng, b.location!.lat] as [number, number]);

    if (activeLocations.length === 0) {
      mapRef.current.easeTo({ center: [91.80, 26.17], zoom: 12.8, duration: 800 });
      return;
    }

    if (activeLocations.length === 1) {
      const bounds = new maplibregl.LngLatBounds(activeLocations[0], [ADTU_COORDS.lng, ADTU_COORDS.lat]);
      mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15.5, duration: 800 });
      return;
    }

    const bounds = new maplibregl.LngLatBounds(activeLocations[0], activeLocations[0]);
    activeLocations.forEach((loc) => bounds.extend(loc));
    bounds.extend([ADTU_COORDS.lng, ADTU_COORDS.lat]);
    mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15.5, duration: 800 });
  };

  return (
    <div
      className={`itms-fleet-map-root relative w-full h-full flex-1 ${
        isFullScreen
          ? "w-full h-full overflow-hidden"
          : "flex flex-col lg:flex-row gap-3 sm:gap-4 min-h-0 overflow-y-auto lg:overflow-hidden no-scrollbar"
      }`}
    >
      {/* SCOPED OVERRIDES: HIDE ALL DEFAULT MAPLIBRE CONTROLS / ATTRIBUTIONS */}
      <style jsx global>{`
        .itms-fleet-map-root .maplibregl-control-container,
        .itms-fleet-map-root .mapboxgl-control-container,
        .itms-fleet-map-root .maplibregl-ctrl,
        .itms-fleet-map-root .maplibregl-ctrl-attrib,
        .itms-fleet-map-root .maplibregl-ctrl-bottom-right,
        .itms-fleet-map-root .maplibregl-ctrl-bottom-left {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `}</style>

      {/* MAP CANVAS (In fullscreen: edge-to-edge, rounded-none, border-none; In normal: left card with rounded-2xl) */}
      <div
        className={`relative bg-[#05060e] flex flex-col overflow-hidden ${
          isFullScreen
            ? "absolute inset-0 w-full h-full rounded-none border-none z-0"
            : "flex-1 h-[60dvh] min-h-[380px] lg:h-full rounded-2xl border border-white/10 shadow-lg shrink-0 lg:shrink"
        }`}
      >
        <div ref={mapContainerRef} className="absolute inset-0 w-full h-full min-h-[380px]" />

        {/* MAP TOP OVERLAY HUD BAR */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute z-20 flex flex-wrap items-center pointer-events-none transition-all duration-200",
            isFullScreen
              ? "top-4 left-4 gap-3 right-4 lg:right-auto lg:max-w-[calc(100vw-420px)] justify-between lg:justify-start"
              : "top-3.5 left-3.5 gap-2 right-3.5 justify-between"
          )}
        >
          {/* Live tracking badge (scales up slightly in fullscreen mode) */}
          <div
            className={cn(
              "flex items-center pointer-events-auto bg-[#0c0e1a] border border-white/10 text-white shadow-lg transition-all duration-200",
              isFullScreen ? "px-4 py-2.5 rounded-2xl gap-3 text-sm" : "px-3.5 py-1.5 rounded-xl gap-2 text-xs"
            )}
          >
            <Radio className={cn("text-emerald-400 shrink-0", isFullScreen ? "w-4.5 h-4.5" : "w-3.5 h-3.5")} />
            <span
              className={cn(
                "font-bold tracking-wide bg-gradient-to-r from-sky-400 to-indigo-300 bg-clip-text text-transparent",
                isFullScreen ? "text-sm" : "text-xs"
              )}
            >
              Live Bus Tracking
            </span>
            <span
              className={cn(
                "text-slate-400 border-l border-white/10 font-medium",
                isFullScreen ? "text-xs pl-3" : "text-[11px] pl-2"
              )}
            >
              {stats.activeTrips} Active {stats.activeTrips === 1 ? "Bus" : "Buses"}
            </span>
            <div className={cn("flex items-center border-l border-white/10", isFullScreen ? "pl-3 gap-2" : "pl-2 gap-1.5")}>
              <span
                className={cn(
                  "rounded-full shrink-0",
                  isFullScreen ? "w-2.5 h-2.5" : "w-2 h-2",
                  wsConnected ? "bg-emerald-400" : loading ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
                )}
              />
              <span className={cn("text-slate-400 font-medium hidden sm:inline", isFullScreen ? "text-xs" : "text-[10px]")}>
                {wsConnected ? "Live GPS" : loading ? "Connecting..." : "Live Sync"}
              </span>
            </div>
          </div>

          {/* Action buttons (Theme toggle & Fullscreen toggle) - hidden on mobile, visible on lg */}
          <div className="hidden lg:flex items-center gap-2 pointer-events-auto">
            {/* Map Theme Toggle Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleMapTheme}
              className={cn(
                "bg-[#0c0e1a] border-white/10 text-slate-200 hover:text-white hover:bg-slate-800 p-0 shadow-lg transition-colors duration-150 cursor-pointer select-none",
                isFullScreen ? "h-9.5 w-9.5 rounded-xl" : "h-8 w-8 rounded-lg"
              )}
              title={mapTheme === "dark" ? "Switch to Light Map Theme" : "Switch to Dark Map Theme"}
              aria-label="Toggle map theme"
            >
              {mapTheme === "dark" ? (
                <Sun className={cn("text-amber-400", isFullScreen ? "w-4.5 h-4.5" : "w-3.5 h-3.5")} />
              ) : (
                <Moon className={cn("text-sky-300", isFullScreen ? "w-4.5 h-4.5" : "w-3.5 h-3.5")} />
              )}
            </Button>

            {/* Fullscreen Toggle Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullScreen((prev) => !prev)}
              className={cn(
                "bg-[#0c0e1a] border-white/10 text-slate-200 hover:text-white hover:bg-slate-800 p-0 shadow-lg transition-colors duration-150 cursor-pointer select-none",
                isFullScreen ? "h-9.5 w-9.5 rounded-xl" : "h-8 w-8 rounded-lg"
              )}
              title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
              aria-label={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullScreen ? (
                <Minimize2 className={isFullScreen ? "w-4.5 h-4.5" : "w-3.5 h-3.5"} />
              ) : (
                <Maximize2 className={isFullScreen ? "w-4.5 h-4.5" : "w-3.5 h-3.5"} />
              )}
            </Button>
          </div>
        </motion.div>

        {/* FLOATING SELECTED BUS TELEMETRY HUD */}
        <AnimatePresence>
          {selectedBus && (
            <motion.div
              key={selectedBus.busId}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute bottom-3.5 left-3.5 right-3.5 sm:right-auto sm:w-96 z-20 pointer-events-auto"
            >
              <Card className="bg-[#0c0e1a] border border-sky-500/40 text-white shadow-xl rounded-2xl overflow-hidden">
                <div className="h-0.5 bg-sky-500/80" />
                <CardContent className="p-4 space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/25 text-sky-400">
                        <Bus className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-base text-white tracking-tight">
                            Bus {selectedBus.busNumber}
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Active Trip
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate max-w-[210px]">
                          {selectedBus.routeName || "In Transit"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      onClick={() => setSelectedBusId(null)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Telemetry Metrics Grid */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                    <div>
                      <span className="text-[10px] text-slate-400 font-medium block">Speed</span>
                      <span className="font-mono text-sm font-bold text-sky-400">
                        {selectedBus.location?.speed != null ? `${Math.round(selectedBus.location.speed)} km/h` : "0 km/h"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-medium block">Direction</span>
                      <span className="font-mono text-xs font-semibold text-slate-200">
                        {getCompassHeading(selectedBus.location?.heading)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 font-medium block">Last Signal</span>
                      <span className="font-mono text-xs font-semibold text-emerald-400">
                        {selectedBus.location ? `${selectedBus.location.ageSeconds}s ago` : "No fix"}
                      </span>
                    </div>
                  </div>

                  {/* Driver & Details */}
                  <div className="space-y-1.5 text-xs border-t border-white/10 pt-2.5 text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Assigned Driver:</span>
                      <span className="font-medium text-white">{selectedBus.driverName || "On Duty"}</span>
                    </div>
                    {selectedBus.driverPhone && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Phone:</span>
                        <a
                          href={`tel:${selectedBus.driverPhone}`}
                          className="font-mono text-sky-400 hover:underline flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3" />
                          {selectedBus.driverPhone}
                        </a>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Occupancy:</span>
                      <span className="font-medium text-slate-200">
                        {selectedBus.currentMembers ?? 0} / {selectedBus.capacity ?? 55} passengers
                      </span>
                    </div>
                    {/* Occupancy Bar */}
                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-sky-500 h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.round(((selectedBus.currentMembers ?? 0) / (selectedBus.capacity ?? 55)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* BOTTOM-RIGHT MAP CONTROLS (RECENTER + ZOOM) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute z-20 flex flex-col items-end gap-2 pointer-events-none transition-all duration-200",
            isFullScreen ? "right-3.5 lg:right-[412px]" : "right-3.5",
            selectedBus ? "bottom-[235px] sm:bottom-4" : "bottom-4"
          )}
        >
          {/* Recenter button */}
          <button
            type="button"
            title="Recenter Map"
            aria-label="Recenter Map"
            onClick={handleRecenterFleet}
            className="pointer-events-auto w-9 h-9 sm:w-10 sm:h-10 bg-[#0c0e1a] rounded-xl shadow-lg border border-white/15 flex items-center justify-center transition-colors duration-150 text-sky-400 hover:text-white hover:bg-slate-800 active:bg-slate-700 select-none cursor-pointer"
          >
            <Compass className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Stacked Zoom Controls (+ and −) */}
          <div className="flex flex-col gap-1.5 pointer-events-auto">
            <button
              type="button"
              title="Zoom In"
              aria-label="Zoom In"
              onClick={() => mapRef.current?.zoomIn()}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[#0c0e1a] rounded-xl shadow-lg border border-white/15 flex items-center justify-center transition-colors duration-150 text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-700 font-bold text-lg leading-none select-none cursor-pointer"
            >
              +
            </button>
            <button
              type="button"
              title="Zoom Out"
              aria-label="Zoom Out"
              onClick={() => mapRef.current?.zoomOut()}
              className="w-9 h-9 sm:w-10 sm:h-10 bg-[#0c0e1a] rounded-xl shadow-lg border border-white/15 flex items-center justify-center transition-colors duration-150 text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-700 font-bold text-lg leading-none select-none cursor-pointer"
            >
              −
            </button>
          </div>
        </motion.div>

        {/* MOBILE BOTTOM-LEFT MAP CONTROLS (THEME TOGGLE + FULLSCREEN) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "lg:hidden absolute left-3.5 z-20 flex flex-col items-start gap-2 pointer-events-none transition-all duration-200",
            selectedBus ? "bottom-[235px]" : "bottom-4"
          )}
        >
          {/* Map Theme Toggle Button */}
          <button
            type="button"
            onClick={toggleMapTheme}
            className="pointer-events-auto w-9 h-9 bg-[#0c0e1a] rounded-xl shadow-lg border border-white/15 flex items-center justify-center transition-colors duration-150 text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-700 select-none cursor-pointer"
            title={mapTheme === "dark" ? "Switch to Light Map Theme" : "Switch to Dark Map Theme"}
            aria-label="Toggle map theme"
          >
            {mapTheme === "dark" ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-sky-300" />
            )}
          </button>

          {/* Fullscreen Toggle Button */}
          <button
            type="button"
            onClick={() => setIsFullScreen((prev) => !prev)}
            className="pointer-events-auto w-9 h-9 bg-[#0c0e1a] rounded-xl shadow-lg border border-white/15 flex items-center justify-center transition-colors duration-150 text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-700 select-none cursor-pointer"
            title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
            aria-label={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullScreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </motion.div>
      </div>

      {/* RIGHT CARD: ACTIVE BUSES PANEL (Hidden on mobile/smaller screens in full screen mode) */}
      <motion.div
        key={isFullScreen ? "active-buses-fs" : "active-buses-normal"}
        initial={{ opacity: 0.85, x: isFullScreen ? 18 : 0 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className={`bg-[#0c0e1a] border border-white/10 shadow-xl rounded-2xl flex-col overflow-hidden shrink-0 z-30 ${
          isFullScreen
            ? "max-lg:!hidden lg:flex absolute top-3.5 right-3.5 bottom-3.5 w-80 sm:w-96 max-w-[calc(100vw-28px)] max-h-[calc(100dvh-76px)]"
            : "flex w-full lg:w-88 xl:w-96 h-[60dvh] min-h-[460px] lg:h-full lg:min-h-0"
        }`}
      >
        {/* PANEL HEADER */}
        <div className="p-4 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <h3 className="font-semibold text-sm text-white tracking-wide">Active Buses</h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchFleetStatus(true)}
              disabled={refreshing}
              className="h-7 px-2.5 bg-white/[0.05] hover:bg-white/10 text-slate-200 hover:text-white border-white/15 text-[11px] font-semibold rounded-lg flex items-center gap-1.5 transition-colors duration-150 shadow-sm cursor-pointer select-none"
              title="Refresh Bus List"
            >
              <RefreshCw className={cn("w-3 h-3 text-sky-400 transition-transform", refreshing && "animate-spin")} />
              <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
            </Button>
          </div>

          {/* SEARCH INPUT */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bus, route, or driver..."
              className="h-8 pl-8.5 text-xs bg-slate-950 border-white/10 text-white placeholder:text-slate-500 rounded-xl focus:border-sky-500"
            />
          </div>

          {/* FILTER TABS */}
          <div className="grid grid-cols-3 gap-1 pt-1">
            {(["ALL", "MOVING", "IDLE"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] py-1.5 rounded-lg font-medium transition-colors duration-150 ${
                  filter === f
                    ? "bg-sky-500 text-white"
                    : "bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08]"
                }`}
              >
                {f === "ALL" ? `All (${stats.activeTrips})` : f === "MOVING" ? `Moving (${stats.inMotion})` : `Idle (${stats.idle})`}
              </button>
            ))}
          </div>
        </div>

        {/* ACTIVE BUSES LIST */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2.5">
          {loading ? (
            <div className="p-6 text-center space-y-3">
              <div className="w-8 h-8 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-400 font-medium">Loading bus locations...</p>
            </div>
          ) : buses.length === 0 ? (
            /* EMPTY STATE: 0 ACTIVE TRIPS (DUPLICATE REFRESH BUTTON REMOVED) */
            <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3 select-none">
              <div className="relative flex items-center justify-center mb-1">
                <div className="w-14 h-14 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                  <Radio className="w-7 h-7 text-sky-400" />
                </div>
              </div>
              <div className="space-y-1.5 max-w-[260px]">
                <h4 className="font-semibold text-sm text-white">No active buses on the road</h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  There are currently no buses on an active trip. Live locations will appear here automatically as soon as a driver starts a journey.
                </p>
              </div>
            </div>
          ) : filteredBuses.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-400">
              No active buses match your search.
            </div>
          ) : (
            filteredBuses.map((bus) => {
              const isSelected = bus.busId === selectedBusId;
              const isMoving = (bus.location?.speed ?? 0) > 2;

              return (
                <div
                  key={bus.busId}
                  onClick={() => {
                    setSelectedBusId(bus.busId);
                    if (bus.location && mapRef.current) {
                      const clamped = clampLatLngToBounds(bus.location.lat, bus.location.lng);
                      mapRef.current.flyTo({ center: [clamped.lng, clamped.lat], zoom: 15.5, duration: 800 });
                    }
                  }}
                  className={`p-3 rounded-xl cursor-pointer transition-colors duration-150 border ${
                    isSelected
                      ? "bg-[#161d36] border-sky-400/80 ring-1 ring-sky-400/40"
                      : "bg-[#0d0f1d] hover:bg-[#13162b] border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-2.5 h-2.5 rounded-full flex items-center justify-center ${
                          bus.locationStatus === "LIVE"
                            ? "bg-emerald-400 animate-pulse"
                            : bus.locationStatus === "STALE"
                            ? "bg-amber-400"
                            : "bg-rose-500"
                        }`}
                      />
                      <span className="font-semibold text-xs text-white">Bus {bus.busNumber}</span>
                    </div>

                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        isMoving
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-slate-800/80 text-slate-400 border border-slate-700/40"
                      }`}
                    >
                      {isMoving ? `${Math.round(bus.location?.speed || 0)} km/h` : "Idle"}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-slate-300 font-medium truncate">
                    {bus.routeName || "Assigned Route"}
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate max-w-[150px]">{bus.driverName || "Driver on duty"}</span>
                    <span className="text-slate-400">
                      {bus.location ? `${bus.location.ageSeconds}s ago` : "Waiting for GPS"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* BOTTOM TELEMETRY STATUS */}
        <div className="p-3 border-t border-white/10 bg-[#070810] flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-medium text-slate-300">Live Telemetry</span>
          </div>
          <span>Updated {lastRefreshed ? `at ${lastRefreshed}` : "just now"}</span>
        </div>
      </motion.div>
    </div>
  );
}
