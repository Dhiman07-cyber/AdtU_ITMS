"use client";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { MapPin,Maximize2,Minimize2,Moon,QrCode,Sun } from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import GuwahatiMap,{ type MapPoint } from "./GuwahatiMap";
import MapFallbackUI from "./MapFallbackUI";

interface GuwahatiBusMapProps {
  busId: string;
  busNumber?: string;
  routeName?: string;
  speed?: number;
  accuracy?: number;
  journeyActive?: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  showStatsOnMobile?: boolean; // legacy
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  primaryActionColor?: "red" | "blue" | "green" | "orange" | "yellow";
  primaryActionDisabled?: boolean;
  studentLocation?: { lat: number; lng: number; accuracy?: number } | null;
  onShowQrCode?: () => void;
  currentLocation?: { lat: number; lng: number; accuracy?: number; timestamp?: string; busId?: string } | null;
  loading?: boolean;
}

function getDistanceText(pos1: { lat: number, lng: number } | null | undefined, pos2: { lat: number, lng: number } | null | undefined) {
  if (!pos2 || (pos2.lat === 0 && pos2.lng === 0)) return "Locating Bus...";
  if (!pos1 || (pos1.lat === 0 && pos1.lng === 0)) return "Locating You...";
  const R = 6371e3; // metres
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return d > 1000 ? `${(d / 1000).toFixed(1)} km away` : `${Math.round(d)} m away`;
}

export default function GuwahatiBusMap({
  busId,
  busNumber,
  routeName,
  speed,
  accuracy,
  journeyActive = false,
  isFullScreen = false,
  onToggleFullScreen,
  primaryActionLabel,
  onPrimaryAction,
  primaryActionColor = "orange",
  primaryActionDisabled = false,
  studentLocation = null,
  onShowQrCode,
  currentLocation: busLocation,
  loading = false,
}: GuwahatiBusMapProps) {
  const [fatal, setFatal] = useState(false);
  const [fatalMsg, setFatalMsg] = useState<string | null>(null);
  const [mapTheme, setMapTheme] = useState<"light" | "dark">("dark");
  const { theme: globalTheme } = useTheme();

  const mapRef = useRef<any>(null);

  // Haversine distance display for students
  const [etaTimer, setEtaTimer] = useState("Locating...");

  useEffect(() => {
    const text = getDistanceText(studentLocation, busLocation);
    setEtaTimer(text);

    const interval = setInterval(() => {
      setEtaTimer(getDistanceText(studentLocation, busLocation));
    }, 15000); // 15s refresh cycle as requested

    return () => clearInterval(interval);
  }, [studentLocation?.lat, studentLocation?.lng, busLocation?.lat, busLocation?.lng]);

  const handleToggleTheme = () => setMapTheme(prev => prev === "dark" ? "light" : "dark");

  // Reset fatal state when journey state changes to ensure fresh map mount
  useEffect(() => {
    if (!journeyActive && fatal) {
      setFatal(false);
      setFatalMsg(null);
    }
  }, [journeyActive, fatal]);

  const points: MapPoint[] = useMemo(() => {
    const list: MapPoint[] = [];
    const lat = Number(studentLocation?.lat);
    const lng = Number(studentLocation?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      list.push({ id: "student", lat, lng, kind: "student", label: "Me" });
    }
    return list;
  }, [studentLocation?.lat, studentLocation?.lng]);

  const handleFatal = useCallback((msg: string) => {
    setFatal(true);
    setFatalMsg(msg);
  }, []);

  if (!journeyActive) {
    return (
      <div className="dark w-full h-full bg-[#0a0f1e] rounded-3xl flex items-center justify-center relative overflow-hidden border border-white/5 group">
        {/* Animated Background Gradients */}
        <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '2s' }} />

        <div className="text-center p-6 relative z-10 max-w-sm mx-auto">
          <div className="relative w-20 h-20 mx-auto mb-6">
            {/* Outer spinning ring */}
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-blue-500/20 animate-[spin_10s_linear_infinite]" />
            {/* Inner pulsing glow */}
            <div className="absolute inset-4 rounded-full bg-blue-500/10 animate-pulse" />
            {/* Icon container */}
            <div className="absolute inset-3 rounded-[1.5rem] bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-blue-500/20 group-hover:scale-110 transition-transform duration-500">
              <MapPin className="w-8 h-8 text-white" />
            </div>
          </div>

          <h3 className="text-xl font-black text-white mb-2 tracking-tight">
            No Active Journey
          </h3>
          <p className="text-slate-400 text-xs font-medium leading-relaxed">
            Live tracking will automatically begin once the bus starts its trip and goes en-route.
          </p>

          <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
            <div className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">System Inactive</span>
          </div>
        </div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="dark relative w-full h-full rounded-3xl overflow-hidden min-h-[400px] bg-slate-950">

        <MapFallbackUI onRetry={() => window.location.reload()} message={fatalMsg ?? undefined} />
      </div>
    );
  }

  return (
    <div className="dark relative w-full h-full rounded-3xl overflow-hidden shadow-2xl bg-slate-900 border border-white/5 flex flex-col">

      {/* Absolute positioning so overlay UI floats perfectly */}
      <div className="absolute inset-0 z-0">
        <GuwahatiMap
          ref={mapRef}
          theme={mapTheme}
          center={
            !(busLocation && (busLocation.lat !== 0 || busLocation.lng !== 0)) && (studentLocation && (studentLocation.lat !== 0 || studentLocation.lng !== 0))
              ? [studentLocation.lat, studentLocation.lng]
              : undefined
          }
          busPosition={(busLocation && (busLocation.lat !== 0 || busLocation.lng !== 0)) ? { lat: busLocation.lat, lng: busLocation.lng } : null}
          points={points}
          restrictToGuwahati={true}
          onFatalError={handleFatal}
          className="w-full h-full !rounded-none"
        />
      </div>

      {isFullScreen ? (
        <>
          {/* Full Screen Layout - Student */}
          <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none gap-4">
            {/* Left: Bus Details Card */}
            <div className="pointer-events-auto flex-1 bg-[#1a2236]/95 backdrop-blur-2xl rounded-[1.5rem] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/20 min-h-[168px] flex flex-col justify-between transition-all">


              <div className="border-b border-black/5 dark:border-white/20 pb-3">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500 mb-0.5">Bus Tracker</p>

                <p className="text-2xl font-black text-slate-900 dark:text-white truncate uppercase tracking-tight -mt-1">
                  {busNumber || busLocation?.busId || busId || "AS-01-XXXX"}
                </p>
              </div>

              <div className="flex gap-4 mt-3">

                <div className="flex-1 bg-emerald-500/10 p-2.5 rounded-2xl border border-emerald-500/20 flex flex-col justify-center min-w-0">

                  <p className="text-[9px] font-black uppercase text-emerald-600/60 dark:text-emerald-400/60 mb-0.5">ETA</p>
                  <p className="text-[13px] font-black text-emerald-600 dark:text-emerald-300">
                    {etaTimer}
                  </p>
                </div>
                <div className="flex-1 bg-blue-500/10 p-2.5 rounded-2xl border border-blue-500/20 flex flex-col justify-center min-w-0">

                  <p className="text-[9px] font-black uppercase text-blue-600/60 dark:text-blue-400/60 mb-0.5">Speed</p>
                  <p className="text-[13px] font-black text-blue-600 dark:text-blue-300">
                    {speed ? `${Math.round(speed * 3.6)} km/h` : "0 km/h"}
                  </p>
                </div>
              </div>
            </div>

            {/* Right buttons: Small screen, Theme Toggle, Bus Pass (Stacked Vertically) */}
            <div className="flex flex-col gap-3 pointer-events-auto">
              {onToggleFullScreen && (
                <button title="Small Screen" onClick={onToggleFullScreen} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-600 dark:text-slate-100">
                  <Minimize2 className="w-5 h-5" />
                </button>
              )}
              <button title="Theme Switcher" onClick={handleToggleTheme} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all outline-none">
                {mapTheme === "dark" ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-500" />}

              </button>
              {onShowQrCode && (
                <button title="My Bus Pass" onClick={onShowQrCode} className="w-12 h-12 bg-blue-600 rounded-2xl shadow-xl flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-white border border-blue-400/30">
                  <QrCode className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>

          <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-col pointer-events-none">
            {/* Sub-bottom row 1: Current Location */}
            <div className="flex justify-end mb-3">
              <button onClick={() => mapRef.current?.recenter()} className="pointer-events-auto w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-blue-500">
                <MapPin className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-bottom row 2: Zoom Controls */}
            <div className="flex justify-end mb-4">
              <div className="flex flex-col gap-2 pointer-events-auto">
                <button onClick={() => mapRef.current?.zoomIn()} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-600 dark:text-slate-100 font-black text-xl">+</button>
                <button onClick={() => mapRef.current?.zoomOut()} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-600 dark:text-slate-100 font-black text-xl">−</button>
              </div>
            </div>

            {/* Bottom Action Button (Raise Waiting Flag) */}
            {primaryActionLabel && (
              <div className="pointer-events-auto w-full">
                <Button onClick={primaryActionDisabled ? undefined : onPrimaryAction} disabled={primaryActionDisabled} className={`w-full h-16 text-xl font-black rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-b-4 border-black/20 transition-all active:translate-y-1 active:border-b-0 ${primaryActionColor === "red" ? "bg-red-600 hover:bg-red-700 text-white" :


                  primaryActionColor === "blue" ? "bg-blue-600 hover:bg-blue-700 text-white" :
                    primaryActionColor === "green" ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
                      primaryActionColor === "yellow" ? "bg-amber-400 text-slate-900" :
                        "bg-orange-500 hover:bg-orange-600 text-white"
                  }`}>
                  {loading ? "Initializing..." : primaryActionLabel}
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Small Screen Layout - Student */}
          {/* Top Left: Theme Toggle */}
          <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
            <button onClick={handleToggleTheme} className="pointer-events-auto w-10 h-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-all outline-none">
              {mapTheme === "dark" ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-500" />}

            </button>
            {/* Right Top intentionally left blank per spec */}
          </div>

          <div className="absolute bottom-4 left-4 right-4 z-20 flex justify-between items-end pointer-events-none">
            {/* Bottom Left: Distance Text */}
            <div className="pointer-events-auto px-4 py-2 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md shadow-lg border border-black/5 dark:border-white/10 rounded-2xl text-sm font-black text-slate-700 dark:text-slate-200 tracking-wider">
              {etaTimer}
            </div>

            {/* Right Bottom: Current Location & Fullscreen */}
            <div className="flex flex-col gap-3 pointer-events-none">
              <button onClick={() => mapRef.current?.recenter()} className="pointer-events-auto w-10 h-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-blue-500">
                <MapPin className="w-4 h-4" />
              </button>
              {onToggleFullScreen && (
                <button onClick={onToggleFullScreen} className="pointer-events-auto w-10 h-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-slate-600 dark:text-slate-300">
                  <Maximize2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
