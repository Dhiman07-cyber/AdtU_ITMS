"use client";

import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Bell,MapPin,Maximize2,Minimize2,Moon,ScanLine,Sun,Users,X } from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import GuwahatiMap,{ type MapPoint } from "./GuwahatiMap";
import MapFallbackUI from "./MapFallbackUI";

interface WaitingStudent {
  id: string;
  student_uid: string;
  student_name: string;
  student_profile_photo?: string | null;
  bus_id: string;
  stop_lat?: number;
  stop_lng?: number;
  accuracy: number;
  stop_name?: string;
  message?: string;
  status: "waiting" | "acknowledged" | "boarded" | "raised";
  created_at: string;
  distance?: number;
  queue_number?: number;
}

interface GuwahatiDriverMapProps {
  driverLocation: { lat: number; lng: number; accuracy: number } | null;
  waitingStudents: WaitingStudent[];
  tripActive: boolean;
  busNumber?: string;
  routeName?: string;
  speed?: number;
  accuracy?: number;
  onAcknowledgeStudent?: (studentId: string) => void;
  onMarkBoarded?: (studentId: string) => void;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  showStatsOnMobile?: boolean; // legacy
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  primaryActionColor?: "red" | "blue" | "green";
  onQrScan?: () => void;
}

export default function GuwahatiDriverMap({
  driverLocation,
  waitingStudents = [],
  tripActive,
  busNumber,
  routeName,
  speed,
  isFullScreen = false,
  onToggleFullScreen,
  primaryActionLabel,
  onPrimaryAction,
  primaryActionColor = "red",
  onQrScan,
  onAcknowledgeStudent,
  onMarkBoarded,
}: GuwahatiDriverMapProps) {
  const [fatal, setFatal] = useState(false);
  const [fatalMsg, setFatalMsg] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mapTheme, setMapTheme] = useState<"light" | "dark">("dark");
  const { theme: globalTheme } = useTheme();

  const mapRef = useRef<any>(null);

  const [etaTimer, setEtaTimer] = useState(15);

  // Calculate ETA to University based on Haversine and current speed
  useEffect(() => {
    if (!driverLocation) return;

    const calculateEta = () => {
      const ADTU_COORDS = { lat: 26.2019, lng: 91.8615 };
      const R = 6371; // km
      const dLat = (ADTU_COORDS.lat - driverLocation.lat) * Math.PI / 180;
      const dLng = (ADTU_COORDS.lng - driverLocation.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(driverLocation.lat * Math.PI / 180) *
        Math.cos(ADTU_COORDS.lat * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = R * c;

      // Convert speed from m/s to km/h, fallback to average speed if 0
      const currentSpeedKmH = (speed || 5) * 3.6;
      const minutes = (distanceKm / Math.max(currentSpeedKmH, 12)) * 60; // 12km/h floor
      setEtaTimer(Math.max(1, Math.round(minutes)));
    };

    calculateEta();
    const int = setInterval(calculateEta, 15000);
    return () => clearInterval(int);
  }, [driverLocation?.lat, driverLocation?.lng, speed]);

  const handleToggleTheme = () => setMapTheme(prev => prev === "dark" ? "light" : "dark");

  // Reset fatal state when trip state changes to ensure fresh map mount
  useEffect(() => {
    if (!tripActive && fatal) {
      setFatal(false);
      setFatalMsg(null);
    }
  }, [tripActive, fatal]);

  const points: MapPoint[] = useMemo(() => {
    const list: MapPoint[] = [];
    waitingStudents.forEach((s) => {
      if (s.stop_lat && s.stop_lng) {
        list.push({
          id: `student-${s.id}`,
          lat: s.stop_lat,
          lng: s.stop_lng,
          kind: "waiting",
          label: s.student_name,
          emphasis: s.status === "acknowledged" ? "secondary" : "primary",
        });
      }
    });
    return list;
  }, [waitingStudents]);

  const handleFatal = useCallback((msg: string) => {
    setFatal(true);
    setFatalMsg(msg);
  }, []);

  if (!tripActive) {
    return (
      <div className="dark w-full h-full bg-[#0a0f1e] rounded-3xl flex items-center justify-center relative overflow-hidden border border-white/5 group">
        {/* Decorative Background Elements */}
        <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-emerald-500/5 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] bg-blue-500/5 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '3s' }} />

        <div className="text-center p-8 relative z-10">
          <div className="relative w-20 h-20 mx-auto mb-6">
            {/* Spinning decorative orbit */}
            <div className="absolute inset-0 rounded-full border border-white/5 border-t-emerald-500/30 animate-spin" />
            {/* Pulse effect */}
            <div className="absolute inset-0 rounded-full bg-emerald-500/5 animate-pulse" />
            {/* Main Icon Container */}
            <div className="absolute inset-1.5 rounded-[1.5rem] bg-gradient-to-br from-[#1a2236] to-[#0a0f1e] border border-white/10 flex items-center justify-center shadow-2xl group-hover:scale-105 transition-transform duration-500">
              <Users className="w-8 h-8 text-emerald-500" />
            </div>
          </div>

          <h3 className="text-2xl font-black text-white mb-2 tracking-tight">
            Standby Mode
          </h3>
          <p className="text-slate-400 text-[11px] font-bold uppercase tracking-[0.2em] opacity-60">
            System ready for trip signals
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="px-5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest animate-pulse">
              Waiting for Departure
            </div>
            <p className="text-slate-500 text-[10px] max-w-[180px] leading-relaxed mx-auto">
              Start your trip from the main panel to begin real-time broadcasting.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="dark relative w-full h-full min-h-[400px] rounded-3xl overflow-hidden bg-slate-950">

        <MapFallbackUI onRetry={() => window.location.reload()} message={fatalMsg ?? undefined} />
      </div>
    );
  }

  return (
    <div className="dark relative w-full h-full rounded-3xl overflow-hidden shadow-2xl bg-slate-900 border border-white/5 flex flex-col">

      {/* Map is positioned absolute so UI overlays float on top perfectly */}
      <div className="absolute inset-0 z-0">
        <GuwahatiMap
          ref={mapRef}
          theme={mapTheme}

          busPosition={(driverLocation && (driverLocation.lat !== 0 || driverLocation.lng !== 0)) ? { lat: driverLocation.lat, lng: driverLocation.lng } : null}
          primaryKind="driver"
          points={points}
          restrictToGuwahati={true}
          onFatalError={handleFatal}
          className="w-full h-full !rounded-none"
        />
      </div>

      {isFullScreen ? (
        <>
          {/* Full Screen mode driver UI */}
          <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none gap-4">
            {/* Left: Bus Details Card - Height matches the 3-button stack on right */}
            <div className="pointer-events-auto flex-1 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-2xl rounded-[2rem] p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/40 dark:border-white/40 h-[168px] flex flex-col justify-between transition-all">
              <div className="border-b border-black/5 dark:border-white/20 pb-3">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-500 dark:text-blue-400 mb-1">Bus Asset</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white truncate uppercase tracking-tight -mt-1">
                  {busNumber || "AS-01-XXXX"}
                </p>
              </div>

              <div className="flex gap-3 mt-3">
                <div className="flex-1 bg-slate-100/80 dark:bg-slate-900/60 p-3 rounded-3xl border border-black/5 dark:border-white/10 flex flex-col justify-center min-w-0">
                  <p className="text-[9px] font-black uppercase text-slate-400/80 mb-0.5">Route</p>
                  <p className="text-[13px] font-black text-slate-700 dark:text-slate-100 truncate">
                    {routeName ? routeName.replace(/^route[_-]/i, 'Route-') : "Route-X"}
                  </p>
                </div>
                <div className="flex-1 bg-blue-500/10 p-3 rounded-2xl border border-blue-500/20 flex flex-col justify-center min-w-0">
                  <p className="text-[9px] font-black uppercase text-blue-600/60 dark:text-blue-400/60 mb-0.5">Speed</p>
                  <p className="text-[13px] font-black text-blue-600 dark:text-blue-300">
                    {speed ? `${Math.round(speed * 3.6)} km/h` : "0 km/h"}
                  </p>
                </div>
              </div>
            </div>

            {/* Right Buttons: Small Screen, Notification, Scanner (Stacked Vertically) */}
            <div className="flex flex-col gap-3 pointer-events-auto">
              {onToggleFullScreen && (
                <button title="Small Screen" onClick={onToggleFullScreen} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-600 dark:text-slate-100">
                  <Minimize2 className="w-5 h-5" />
                </button>
              )}
              <button title="Notifications" onClick={() => setPanelOpen(true)} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all relative text-slate-600 dark:text-slate-100 group">
                <Bell className="w-5 h-5 group-hover:animate-swing" />
                {waitingStudents.length > 0 && <span className="absolute -top-1 -right-1 flex h-6 w-6 bg-emerald-500 text-white rounded-full text-[10px] items-center justify-center font-black shadow-lg shadow-emerald-500/40 border-2 border-white dark:border-[#1a2236]">{waitingStudents.length}</span>}
              </button>
              {onQrScan && (
                <button title="Scan QR" onClick={onQrScan} className="w-12 h-12 bg-blue-600 rounded-2xl shadow-xl flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-white border border-blue-400/30">
                  <ScanLine className="w-6 h-6" />
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

            {/* Sub-bottom row 2: Theme & Zooms */}
            <div className="flex justify-between items-end mb-4">
              <button onClick={handleToggleTheme} className="pointer-events-auto w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all outline-none">
                {mapTheme === "dark" ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-500" />}

              </button>
              <div className="flex flex-col gap-2 pointer-events-auto">
                <button onClick={() => mapRef.current?.zoomIn()} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-600 dark:text-slate-100 font-black text-xl">+</button>
                <button onClick={() => mapRef.current?.zoomOut()} className="w-12 h-12 bg-white/95 dark:bg-[#1a2236]/95 backdrop-blur-xl rounded-2xl shadow-xl border border-white/20 dark:border-white/40 flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-600 dark:text-slate-100 font-black text-xl">−</button>
              </div>
            </div>

            {/* Bottom Action Button (End Trip) */}
            {primaryActionLabel && (
              <div className="pointer-events-auto w-full">
                <Button onClick={onPrimaryAction} className={`w-full h-16 text-xl font-black rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-b-4 border-black/20 transition-all active:translate-y-1 active:border-b-0 uppercase tracking-widest ${primaryActionColor === "red" ? "bg-red-600 hover:bg-red-700 text-white" :
                  primaryActionColor === "blue" ? "bg-blue-600 hover:bg-blue-700 text-white" :
                    "bg-emerald-600 hover:bg-emerald-700 text-white"
                  }`}>
                  {primaryActionLabel}
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Small Screen mode driver UI */}
          <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
            <button onClick={handleToggleTheme} className="pointer-events-auto w-10 h-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-all outline-none">
              {mapTheme === "dark" ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-500" />}

            </button>
            <div className="pointer-events-auto px-3 py-1.5 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md shadow-lg border border-black/5 dark:border-white/10 rounded-xl text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-widest">
              AdtU ITMS
            </div>
          </div>

          <div className="absolute bottom-4 right-4 z-20 flex flex-col gap-3 pointer-events-none">
            <button onClick={() => mapRef.current?.recenter()} className="pointer-events-auto w-10 h-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-blue-500">
              <MapPin className="w-4 h-4" />
            </button>
            {onToggleFullScreen && (
              <button onClick={onToggleFullScreen} className="pointer-events-auto w-10 h-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-2xl shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-slate-600 dark:text-slate-300">
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </>
      )}

      {/* Student Panel Overlay (Only for full screen) */}
      {panelOpen && isFullScreen && (
        <div
          role="presentation"
          className="absolute inset-0 bg-slate-950/60 z-[100] backdrop-blur-sm transition-all duration-300"
          onClick={() => setPanelOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 z-[101] bg-white dark:bg-slate-900 rounded-t-[2.5rem] shadow-2xl border-t border-white/5 p-8 transition-transform duration-500 ease-out"
            style={{ maxHeight: "70vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Active Queue</h3>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">{waitingStudents.length} Students Pending</p>
                </div>
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center hover:scale-110 active:scale-90 transition-all text-slate-500 outline-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto max-h-[45vh] pb-10 custom-scrollbar pr-2">
              {waitingStudents.length === 0 ? (
                <div className="text-center py-20 opacity-30 select-none">
                  <Users className="w-16 h-16 mx-auto mb-4" />
                  <p className="font-bold">No students waiting</p>
                </div>
              ) : (
                waitingStudents.map((student) => (
                  <div key={student.id} className="group flex items-center gap-4 p-5 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-3xl border border-black/5 dark:border-white/5 transition-all">
                    <div className="flex-1">
                      <p className="font-black text-slate-900 dark:text-white">{student.student_name}</p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{student.stop_name || 'Current Location'}</p>
                    </div>
                    <Button
                      onClick={() => {
                        if (student.status === "acknowledged") {
                          onMarkBoarded?.(student.id);
                        } else {
                          onAcknowledgeStudent?.(student.id);
                        }
                      }}
                      className={`rounded-xl px-6 font-bold shadow-lg transition-all active:scale-90 ${student.status === "acknowledged"
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                    >
                      {student.status === "acknowledged" ? "Picked" : "Recieved"}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
