"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  ArrowRightLeft,
  Bus,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Search,
  SlidersHorizontal,
  Target,
  Users,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import React, { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { toast } from "react-hot-toast";

// Smart allocation sub-components
import ReassignmentPanel from "@/components/smart-allocation/ReassignmentPanel";
import ReassignmentSnackbar, { type RevertBufferData } from "@/components/smart-allocation/ReassignmentSnackbar";
import StudentRoster from "@/components/smart-allocation/StudentRoster";

import {
  detectOverloadedShift,
  getShiftDisplayName,
  type OverloadedShift,
} from "@/lib/utils/overload-detection";
import { type CanonicalShift } from "@/lib/utils/shift-utils";

export interface StudentReassignmentTabRef {
  exportData: () => void;
  openSuggestions: () => void;
  getSelectedCount: () => number;
  getOverloadedCount: () => number;
  setThreshold: (val: number) => void;
  threshold: number;
}

export interface BusData {
  id: string;
  busNumber: string;
  routeId: string;
  routeName: string;
  driverId?: string;
  driverName?: string;
  driverPhoto?: string;
  currentMembers: number;
  capacity: number;
  shift: "morning" | "evening" | "both";
  stops: Array<{
    id: string;
    name: string;
    sequence: number;
    coordinates?: { lat: number; lng: number };
  }>;
  stopCounts?: Map<string, number>;
  load?: {
    morningCount?: number;
    eveningCount?: number;
  };
  route?: {
    routeId: string;
    routeName: string;
    stops: Array<{
      stop_name: string;
      name: string;
      sequence: number;
    }>;
  };
}

export interface StudentData {
  id: string;
  fullName: string;
  enrollmentId: string;
  stop_name: string;
  busId: string;
  semester?: string;
  phone?: string;
  photoURL?: string;
  shift?: "Morning" | "Evening" | "both" | "Both";
}

interface StudentReassignmentTabProps {
  onSelectedStudentsChange?: (count: number) => void;
  onOverloadedCountChange?: (count: number) => void;
  onOpenHistory?: () => void;
  initialThreshold?: number;
  onThresholdChange?: (val: number) => void;
}

export const StudentReassignmentTab = forwardRef<StudentReassignmentTabRef, StudentReassignmentTabProps>(
  function StudentReassignmentTab(
    { onSelectedStudentsChange, onOverloadedCountChange, initialThreshold = 0, onThresholdChange },
    ref
  ) {
    const { currentUser } = useAuth();

    // Data state
    const [buses, setBuses] = useState<BusData[]>([]);
    const [students, setStudents] = useState<StudentData[]>([]);
    const [loading, setLoading] = useState(true);
    const [studentsLoading, setStudentsLoading] = useState(false);

    // Filter & selection state
    const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
    const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
    const [threshold, setThreshold] = useState<number>(initialThreshold);
    const [shiftFilter, setShiftFilter] = useState<"morning" | "evening">("morning");
    const [searchTerm, setSearchTerm] = useState("");

    // Modal & snackbar state
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [showSnackbar, setShowSnackbar] = useState(false);
    const [revertBuffer, setRevertBuffer] = useState<RevertBufferData | null>(null);
    const [snackbarStudentCount, setSnackbarStudentCount] = useState(0);

    // Fetch buses with joined routes and drivers
    const fetchBusData = useCallback(async (silent = false): Promise<BusData[]> => {
      if (!currentUser) return [];
      if (!silent) setLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const [busesRes, driversRes, routesRes] = await Promise.all([
          fetch("/api/buses", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/drivers", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/routes", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const busesJson = await busesRes.json();
        const busesRaw = busesJson.buses || (Array.isArray(busesJson) ? busesJson : []);
        const driversJson = await driversRes.json();
        const driversRaw = Array.isArray(driversJson) ? driversJson : driversJson.drivers || [];
        const routesJson = await routesRes.json();
        const fetchedRoutes = routesJson.routes || (Array.isArray(routesJson) ? routesJson : []);

        const driverMap = new Map<string, any>();
        for (const d of driversRaw) {
          const id = d.id || d.uid;
          driverMap.set(id, d);
        }

        const busData: BusData[] = [];
        for (const [index, data] of busesRaw.entries()) {
          const busId = data.busId || data.id;

          let driverData: any = {};
          const driverId = data.activeDriverId || data.assignedDriverId;
          if (driverId) {
            const driver = driverMap.get(driverId);
            if (driver) {
              driverData = {
                driverName: driver.fullName || driver.name,
                driverPhoto: driver.photoURL || driver.profilePhotoUrl,
              };
            }
          }

          let routeInfo: any = null;
          let route_stops: Array<{
            id: string;
            name: string;
            sequence: number;
            coordinates?: { lat: number; lng: number };
          }> = [];

          if (data.routeId && fetchedRoutes.length > 0) {
            const matchedRoute = fetchedRoutes.find(
              (r: any) =>
                r.id === data.routeId ||
                r.routeId === data.routeId ||
                r.routeName === data.routeId
            );

            if (matchedRoute) {
              routeInfo = matchedRoute;
              if (matchedRoute.stops && Array.isArray(matchedRoute.stops)) {
                route_stops = matchedRoute.stops.map((stop: any, index: number) => {
                  if (typeof stop === "string") {
                    return { id: stop, name: stop, sequence: index + 1 };
                  } else {
                    return {
                      id: stop.stop_name || stop.id || stop.name || `stop_${index}`,
                      name: stop.name || stop.stop_name || `Stop ${index + 1}`,
                      sequence: stop.sequence || index + 1,
                      coordinates: stop.coordinates,
                    };
                  }
                });
              }
            }
          }

          if (!routeInfo && (data.route?.stops || data.stops)) {
            const stopsArray = data.route?.stops || data.stops;
            if (Array.isArray(stopsArray)) {
              route_stops = stopsArray.map((stop: any, index: number) => {
                if (typeof stop === "string") {
                  return { id: stop, name: stop, sequence: index + 1 };
                } else {
                  return {
                    id: stop.stop_name || stop.id || stop.name || `stop_${index}`,
                    name: stop.name || stop.stop_name || `Stop ${index + 1}`,
                    sequence: stop.sequence || index + 1,
                    coordinates: stop.coordinates,
                  };
                }
              });
            }
          }

          const stopCountsMap = new Map<string, number>();
          if (data.stopCounts) {
            Object.entries(data.stopCounts).forEach(([stop_name, count]) => {
              stopCountsMap.set(stop_name, count as number);
            });
          }

          const formattedRouteName =
            routeInfo?.routeName || data.routeName || data.routeId || "Unknown";

          const morningCount = Number(data.morningLoad ?? data.morning_load ?? (data.load as any)?.morningCount ?? 0);
          const eveningCount = Number(data.eveningLoad ?? data.evening_load ?? (data.load as any)?.eveningCount ?? 0);
          const currentMembers = Number(data.currentMembers ?? data.current_members ?? (morningCount + eveningCount));

          busData.push({
            id: busId,
            busNumber: data.busNumber || data.bus_number || `Bus ${index + 1}`,
            routeId: data.routeId || data.route_id || "",
            routeName: formattedRouteName,
            ...driverData,
            currentMembers,
            capacity: data.capacity || 55,
            shift: (data.shift || "both").toLowerCase() as any,
            stops: route_stops,
            stopCounts: stopCountsMap,
            load: {
              morningCount,
              eveningCount,
            },
            route: routeInfo
              ? {
                  routeId: routeInfo.id || routeInfo.routeId,
                  routeName: routeInfo.routeName,
                  stops: route_stops.map((s) => ({
                    stop_name: s.name,
                    name: s.name,
                    sequence: s.sequence,
                  })),
                }
              : undefined,
          });
        }

        // Sort buses so buses with enrolled students or higher load appear at the top
        busData.sort((a, b) => {
          const aMax = Math.max(a.load?.morningCount || 0, a.load?.eveningCount || 0, a.currentMembers || 0);
          const bMax = Math.max(b.load?.morningCount || 0, b.load?.eveningCount || 0, b.currentMembers || 0);
          if (bMax !== aMax) return bMax - aMax;
          return a.busNumber.localeCompare(b.busNumber);
        });

        setBuses(busData);
        setSelectedBusId((prev) => (prev && busData.some((b) => b.id === prev) ? prev : null));
        return busData;
      } catch (error) {
        console.error("Error fetching buses:", error);
        toast.error("Failed to load fleet data");
        return [];
      } finally {
        if (!silent) setLoading(false);
      }
    }, [currentUser]);

    useEffect(() => {
      fetchBusData();
    }, [fetchBusData]);

    // Fetch students when a bus is selected
    useEffect(() => {
      if (!selectedBusId || !currentUser) {
        setStudents([]);
        setSelectedStudents(new Set());
        return;
      }

      let isMounted = true;
      setStudentsLoading(true);

      async function fetchStudents() {
        try {
          const token = await currentUser?.getIdToken();
          const res = await fetch(`/api/students?busId=${selectedBusId}&limit=200`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error("Failed to fetch students");
          const data = await res.json();
          if (isMounted) {
            const list: StudentData[] = Array.isArray(data) ? data : data.students || [];
            setStudents(list);
            setSelectedStudents(new Set());
          }
        } catch (err) {
          console.error("Failed to load students for bus:", err);
          if (isMounted) toast.error("Could not load students for this bus");
        } finally {
          if (isMounted) setStudentsLoading(false);
        }
      }

      fetchStudents();
      return () => {
        isMounted = false;
      };
    }, [selectedBusId, currentUser]);

    // Selected bus object
    const selectedBus = useMemo(
      () => (selectedBusId ? buses.find((b) => b.id === selectedBusId) || null : null),
      [selectedBusId, buses]
    );

    // Filter buses by load & search for the selected shift
    const allBusesByLoad = useMemo(() => {
      return buses
        .filter((bus) => {
          // 1. Shift check: bus must serve active shiftFilter
          const busShift = (bus.shift || "both").toLowerCase().trim();
          const servesShift =
            shiftFilter === "morning"
              ? busShift === "morning" || busShift === "both"
              : busShift === "evening" || busShift === "both";
          if (!servesShift) return false;

          // 2. Search check
          const matchesSearch =
            bus.busNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (bus.routeName && bus.routeName.toLowerCase().includes(searchTerm.toLowerCase()));
          if (!matchesSearch) return false;

          // 3. Shift-specific count & threshold check
          const count =
            shiftFilter === "morning"
              ? (bus.load?.morningCount ?? bus.currentMembers)
              : (bus.load?.eveningCount ?? bus.currentMembers);

          const loadPercentage = bus.capacity > 0 ? (count / bus.capacity) * 100 : 0;
          return loadPercentage >= threshold;
        })
        .sort((a, b) => {
          const aCount =
            shiftFilter === "morning"
              ? a.load?.morningCount ?? a.currentMembers
              : a.load?.eveningCount ?? a.currentMembers;
          const bCount =
            shiftFilter === "morning"
              ? b.load?.morningCount ?? b.currentMembers
              : b.load?.eveningCount ?? b.currentMembers;
          const aPct = a.capacity > 0 ? aCount / a.capacity : 0;
          const bPct = b.capacity > 0 ? bCount / b.capacity : 0;
          return bPct - aPct;
        });
    }, [buses, searchTerm, shiftFilter, threshold]);

    // Keep selected bus synchronized when switching shifts or filtering
    useEffect(() => {
      if (allBusesByLoad.length > 0) {
        if (!selectedBusId || !allBusesByLoad.some((b) => b.id === selectedBusId)) {
          setSelectedBusId(allBusesByLoad[0].id);
        }
      } else {
        setSelectedBusId(null);
      }
    }, [allBusesByLoad, selectedBusId]);

    const overloadedCount = useMemo(() => {
      return buses.filter((bus) => {
        const busShift = (bus.shift || "both").toLowerCase().trim();
        const servesShift =
          shiftFilter === "morning"
            ? busShift === "morning" || busShift === "both"
            : busShift === "evening" || busShift === "both";
        if (!servesShift) return false;

        const count =
          shiftFilter === "morning"
            ? (bus.load?.morningCount ?? bus.currentMembers)
            : (bus.load?.eveningCount ?? bus.currentMembers);
        const pct = bus.capacity > 0 ? (count / bus.capacity) * 100 : 0;
        const effectiveThreshold = threshold > 0 ? threshold : 80;
        return pct >= effectiveThreshold;
      }).length;
    }, [buses, shiftFilter, threshold]);

    // Sync counts with parent
    useEffect(() => {
      onSelectedStudentsChange?.(selectedStudents.size);
    }, [selectedStudents.size, onSelectedStudentsChange]);

    useEffect(() => {
      onOverloadedCountChange?.(overloadedCount);
    }, [overloadedCount, onOverloadedCountChange]);

    // Overloaded shift for selected bus
    const overloadedShift: OverloadedShift = useMemo(() => {
      if (!selectedBus) return null;
      return detectOverloadedShift(selectedBus, threshold);
    }, [selectedBus, threshold]);

    // Students to display: show all students assigned to the selected bus
    // Note: The shift filter on the left filters the bus fleet; within the selected bus, all enrolled students
    // are visible in the roster with their shift badges (matching original design).
    const displayStudents = useMemo(() => {
      if (!students || students.length === 0) return [];
      return students;
    }, [students]);

    // Selection handlers
    const toggleStudentSelection = (studentId: string) => {
      setSelectedStudents((prev) => {
        const next = new Set(prev);
        if (next.has(studentId)) next.delete(studentId);
        else next.add(studentId);
        return next;
      });
    };

    const selectByStop = (stopName: string) => {
      const stopStudents = displayStudents.filter(
        (s) => (s.stop_name || "").toLowerCase().trim() === (stopName || "").toLowerCase().trim()
      );
      setSelectedStudents((prev) => {
        const next = new Set(prev);
        const allSelected = stopStudents.length > 0 && stopStudents.every((s) => next.has(s.id));
        stopStudents.forEach((s) => {
          if (allSelected) next.delete(s.id);
          else next.add(s.id);
        });
        return next;
      });
    };

    const handleSelectAll = () => {
      setSelectedStudents(new Set(displayStudents.map((s) => s.id)));
    };

    const handleClearSelection = () => {
      setSelectedStudents(new Set());
    };

    // Export handler
    const handleExport = useCallback(() => {
      const rows = allBusesByLoad.map((b) => {
        const count =
          shiftFilter === "morning"
            ? (b.load?.morningCount ?? b.currentMembers)
            : (b.load?.eveningCount ?? b.currentMembers);
        const loadPct = b.capacity > 0 ? ((count / b.capacity) * 100).toFixed(1) : "0";
        return {
          "Bus Number": b.busNumber,
          Route: b.routeName,
          Capacity: b.capacity,
          [`${shiftFilter === "morning" ? "Morning" : "Evening"} Load`]: count,
          "Load %": `${loadPct}%`,
          Shift: b.shift,
          Status: Number(loadPct) >= threshold ? "Overloaded" : "Normal",
        };
      });

      const csvHeader = `Bus Number,Route,Capacity,${shiftFilter === "morning" ? "Morning" : "Evening"} Load,Load %,Shift,Status\n`;
      const csvBody = rows
        .map((r) =>
          `"${r["Bus Number"]}","${r.Route}","${r.Capacity}","${r[`${shiftFilter === "morning" ? "Morning" : "Evening"} Load`]}","${r["Load %"]}","${r.Shift}","${r.Status}"`
        )
        .join("\n");
      const blob = new Blob([csvHeader + csvBody], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bus_load_analysis_${shiftFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${shiftFilter === "morning" ? "Morning" : "Evening"} load analysis exported`);
    }, [allBusesByLoad, shiftFilter, threshold]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      exportData: handleExport,
      openSuggestions: () => setShowSuggestions(true),
      getSelectedCount: () => selectedStudents.size,
      getOverloadedCount: () => overloadedCount,
      setThreshold: (val: number) => {
        setThreshold(val);
        onThresholdChange?.(val);
      },
      threshold,
    }));

    return (
      <>
        {/* LEFT COLUMN: BUSES RANKED BY LOAD */}
        <div className="lg:col-span-4 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            <CardHeader className="p-3.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Bus className="w-4 h-4 text-blue-500" />
                  <span>Bus Capacity Status</span>
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                  >
                    {allBusesByLoad.length} Buses
                  </Badge>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search bus or route..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-xs bg-white dark:bg-zinc-900/80 border-zinc-200 dark:border-zinc-700"
                />
              </div>

              {/* Shift Filter Buttons */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {[
                    { key: "morning", label: "Morning" },
                    { key: "evening", label: "Evening" },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setShiftFilter(f.key as any)}
                      className={cn(
                        "px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer",
                        shiftFilter === f.key
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-foreground"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Interactive Threshold Popover */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-blue-500 hover:bg-blue-500/10 dark:hover:bg-blue-500/10 border border-zinc-200 dark:border-zinc-700/60 transition-colors cursor-pointer"
                      title="Click to adjust overload threshold"
                    >
                      <SlidersHorizontal className="w-3 h-3 text-blue-500" />
                      <span>≥{threshold}% Threshold</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-3 space-y-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl z-50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-foreground">Overload Threshold</span>
                      <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{threshold}%</span>
                    </div>
                    <Slider
                      value={[threshold]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={([val]) => {
                        setThreshold(val);
                        onThresholdChange?.(val);
                      }}
                      className="w-full py-1 cursor-pointer"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Buses with capacity load at or above this threshold trigger reassignment recommendations.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            </CardHeader>

            {/* Scrollable Buses List (No scrollbar) */}
            <div className={cn(
              "flex-1 min-h-0 p-2.5",
              loading && buses.length === 0
                ? "overflow-y-auto no-scrollbar space-y-2"
                : allBusesByLoad.length === 0
                ? "flex flex-col items-center justify-center h-full"
                : "overflow-y-auto no-scrollbar space-y-2"
            )}>
              {loading && buses.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="w-full h-20 rounded-xl bg-slate-100 dark:bg-zinc-800/50 animate-pulse border border-zinc-200 dark:border-zinc-800 p-3 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <div className="h-3.5 w-24 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                      <div className="h-3.5 w-10 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 dark:bg-zinc-700/60 rounded-full" />
                    <div className="h-3 w-32 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                  </div>
                ))
              ) : allBusesByLoad.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center my-auto p-6 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-1">
                    <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                  </div>
                  <p className="text-xs font-bold text-foreground">All Buses Balanced</p>
                  <p className="text-[11px] text-muted-foreground max-w-[200px] leading-relaxed">
                    No buses exceed {threshold}% load threshold for {shiftFilter} shift.
                  </p>
                </div>
              ) : (
                allBusesByLoad.map((bus) => {
                  const isSelected = selectedBusId === bus.id;
                  const count =
                    shiftFilter === "morning"
                      ? (bus.load?.morningCount ?? bus.currentMembers)
                      : (bus.load?.eveningCount ?? bus.currentMembers);
                  const loadPercentage = bus.capacity > 0 ? (count / bus.capacity) * 100 : 0;
                  const isOverloaded = loadPercentage >= threshold;

                  return (
                    <motion.div
                      key={bus.id}
                      onClick={() => setSelectedBusId(bus.id)}
                      className={cn(
                        "p-3 px-3.5 rounded-xl cursor-pointer transition-all border text-left relative",
                        isSelected
                          ? "bg-blue-500/10 dark:bg-blue-950/30 border-blue-500 shadow-sm ring-1 ring-blue-500/30"
                          : "bg-white dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-800/70"
                      )}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-bold text-xs",
                              isSelected ? "text-blue-600 dark:text-blue-400" : "text-foreground"
                            )}
                          >
                            {bus.busNumber}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                            {bus.routeName}
                          </span>
                        </div>
                        <Badge
                          variant={isOverloaded ? "destructive" : "secondary"}
                          className="text-[9px] font-mono font-bold px-1.5 py-0"
                        >
                          {Math.min(loadPercentage, 100).toFixed(0)}%
                        </Badge>
                      </div>

                      {/* Load Progress Bar */}
                      <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5 overflow-hidden">
                        <div
                          style={{ width: `${Math.min(loadPercentage, 100)}%` }}
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            loadPercentage >= 100
                              ? "bg-red-500"
                              : loadPercentage >= 90
                              ? "bg-amber-500"
                              : "bg-blue-500"
                          )}
                        />
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                        <span>
                          {count} / {bus.capacity} seats ({shiftFilter === "morning" ? "Morning" : "Evening"})
                        </span>
                        {bus.driverName && (
                          <span className="text-zinc-500 dark:text-zinc-400 truncate max-w-[120px]">
                            {bus.driverName}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: INTEGRATED ROSTER + VERTICAL ROUTE STOPS */}
        <div className="lg:col-span-8 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            {selectedBus ? (
              <>
                <CardHeader className="p-3 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    {/* Left: Bus Title & Shift details */}
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold shrink-0 border border-blue-500/20">
                        <Bus className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm sm:text-base font-bold text-foreground tracking-tight">
                            {selectedBus.busNumber}
                          </span>
                          <Badge variant="outline" className="text-xs font-mono px-2 py-0.5 font-medium">
                            {selectedBus.routeName}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-xs px-2 py-0.5 font-semibold capitalize bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                          >
                            {shiftFilter} Shift
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedStudents.size > 0 ? (
                            <span className="text-blue-600 dark:text-blue-400 font-bold">
                              {selectedStudents.size} student(s) selected
                            </span>
                          ) : (
                            <span>{displayStudents.length} students enrolled in {shiftFilter} shift</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right: Quick actions & Reassign button */}
                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                      <Button
                        size="sm"
                        onClick={handleSelectAll}
                        className="h-7 text-xs bg-slate-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-700 font-semibold px-2.5 cursor-pointer border border-zinc-200 dark:border-zinc-700/60"
                      >
                        Select All
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleClearSelection}
                        disabled={selectedStudents.size === 0}
                        className="h-7 text-xs bg-slate-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-red-500/10 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 font-semibold px-2.5 cursor-pointer border border-zinc-200 dark:border-zinc-700/60 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        disabled={selectedStudents.size === 0}
                        onClick={() => setShowSuggestions(true)}
                        className={cn(
                          "h-7 px-3 text-xs gap-1 font-bold shadow-xs cursor-pointer transition-all",
                          selectedStudents.size > 0
                            ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
                            : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed"
                        )}
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>Reassign ({selectedStudents.size})</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* ── ROUTE VISUALIZATION (SEPARATE DEDICATED SECTION) ── */}
                <div className="border-b border-zinc-200 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-900/30 px-3.5 py-2.5 shrink-0">
                  {/* Fixed Header: Does NOT scroll horizontally */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs font-bold text-foreground">Route Stops</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-1.5 py-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                      >
                        {selectedBus.stops?.length || 0} Stops
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">
                      Click any stop circle to select/deselect students
                    </span>
                  </div>

                  {/* Horizontal Circular Stepper (ONLY THIS SCROLLS) */}
                  <div className="overflow-x-auto no-scrollbar scroll-smooth">
                    <div className="flex items-start gap-0 min-w-max py-1 px-1">
                    {!selectedBus.stops || selectedBus.stops.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No stops configured for this route</p>
                    ) : (
                      selectedBus.stops.map((stop, index) => {
                        const stopNameLower = (stop.name || stop.id || "").toLowerCase().trim();
                        const stopStudents = displayStudents.filter(
                          (s) => (s.stop_name || "").toLowerCase().trim() === stopNameLower
                        );
                        const totalAtStop = stopStudents.length;
                        const selectedAtStop = stopStudents.filter((s) => selectedStudents.has(s.id)).length;
                        const isFullySelected = totalAtStop > 0 && selectedAtStop === totalAtStop;
                        const isPartiallySelected = selectedAtStop > 0 && selectedAtStop < totalAtStop;
                        const hasSelectedStudents = selectedAtStop > 0;

                        return (
                          <React.Fragment key={stop.id || index}>
                            <motion.div
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.02 }}
                              className="flex flex-col items-center w-[84px]"
                            >
                              {/* Stop Node Button */}
                              <button
                                type="button"
                                onClick={() => selectByStop(stop.name || stop.id)}
                                className="relative group cursor-pointer outline-none"
                                title={`${stop.name}: ${totalAtStop} student(s) enrolled`}
                              >
                                {/* Stop Circle */}
                                <div
                                  className={cn(
                                    "relative w-9 h-9 rounded-full",
                                    "border-2 transition-all duration-200",
                                    "flex items-center justify-center",
                                    "bg-white dark:bg-zinc-900",
                                    isFullySelected
                                      ? "border-blue-600 ring-2 ring-blue-500/30"
                                      : isPartiallySelected
                                        ? "border-blue-400"
                                        : "border-zinc-300 dark:border-zinc-700 hover:border-blue-400/50"
                                  )}
                                >
                                  <MapPin
                                    className={cn(
                                      "w-4 h-4",
                                      hasSelectedStudents
                                        ? "text-blue-600 dark:text-blue-400"
                                        : "text-zinc-400 dark:text-zinc-500"
                                    )}
                                  />

                                  {/* Count Badge at Top Right of Circle */}
                                  {totalAtStop > 0 && (
                                    <div
                                      className={cn(
                                        "absolute -top-1 -right-1",
                                        "w-4 h-4 rounded-full",
                                        "flex items-center justify-center",
                                        "text-[9px] font-bold shadow-xs",
                                        hasSelectedStudents
                                          ? "bg-blue-600 text-white"
                                          : "bg-zinc-400 dark:bg-zinc-700 text-white dark:text-zinc-200"
                                      )}
                                    >
                                      {totalAtStop}
                                    </div>
                                  )}
                                </div>
                              </button>

                              {/* Stop Name below circle */}
                              <div className="mt-1 text-center px-1">
                                <div
                                  className={cn(
                                    "text-[10.5px] leading-tight line-clamp-2 min-h-[1.8em] transition-colors duration-200",
                                    hasSelectedStudents
                                      ? "text-blue-600 dark:text-blue-400 font-semibold"
                                      : "text-zinc-600 dark:text-zinc-400"
                                  )}
                                >
                                  {stop.name}
                                </div>
                              </div>

                              {/* Stop Order Label */}
                              <div className="mt-0.5 text-center">
                                <span
                                  className={cn(
                                    "text-[9.5px] font-medium transition-colors duration-200",
                                    hasSelectedStudents
                                      ? "text-blue-500 dark:text-blue-400"
                                      : "text-zinc-400 dark:text-zinc-500"
                                  )}
                                >
                                  Stop #{stop.sequence || index + 1}
                                </span>
                              </div>
                            </motion.div>

                            {/* Connecting Line between consecutive circles */}
                            {index < selectedBus.stops.length - 1 && (
                              <div className="flex items-center h-9 -mx-1 mt-0 shrink-0">
                                <div className="w-6 h-0.5 bg-zinc-300 dark:bg-zinc-700" />
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

                {/* ── STUDENT ROSTER (SPACIOUS FULL WIDTH & HEIGHT) ── */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {studentsLoading ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                      <div className="text-center space-y-2">
                        <div className="w-8 h-8 mx-auto border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs text-muted-foreground">Loading student roster...</p>
                      </div>
                    </div>
                  ) : (
                    <StudentRoster
                      students={displayStudents}
                      selectedStudents={selectedStudents}
                      onToggleSelection={toggleStudentSelection}
                      onSelectByStop={selectByStop}
                    />
                  )}
                </div>

                {/* DOCKED REASSIGN ACTION BAR AT BOTTOM OF CARD */}
                {selectedStudents.size > 0 && (
                  <div className="p-2.5 px-3 border-t border-zinc-200 dark:border-zinc-800 bg-blue-500/5 dark:bg-blue-950/20 shrink-0 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-600 text-white font-bold text-[10px] px-1.5 py-0.5">
                        {selectedStudents.size} Selected
                      </Badge>
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        Ready for smart seat reassignment to available buses
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleClearSelection}
                        className="h-7 text-xs text-muted-foreground hover:text-red-500 px-2 cursor-pointer"
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setShowSuggestions(true)}
                        className="h-7 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-3 shadow-xs cursor-pointer gap-1"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>Reassign ({selectedStudents.size})</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 p-8 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                  <Target className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-foreground">Select a Bus to Manage</h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Click on an overloaded bus from the left fleet panel to inspect its assigned students, filter by
                  stops, and trigger smart rebalancing.
                </p>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <span>
                    {allBusesByLoad.length} buses available
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* REASSIGNMENT PANEL MODAL */}
        {showSuggestions && selectedStudents.size > 0 && selectedBus && (
          <ReassignmentPanel
            selectedStudents={Array.from(selectedStudents)
              .map((id) => students.find((s) => s.id === id)!)
              .filter(Boolean)}
            allBuses={buses}
            currentBus={selectedBus}
            onClose={() => setShowSuggestions(false)}
            onSuccess={async (result) => {
              const revertData: RevertBufferData = {
                operationId: result.operationId,
                affectedStudents: result.assignments.map((assignment) => {
                  const originalStudent = students.find((s) => s.id === assignment.studentId);
                  return {
                    uid: assignment.studentId,
                    oldBusId: result.fromBusId,
                    newBusId: assignment.targetBusId,
                    oldRouteId: selectedBus?.routeId || "",
                    newRouteId: "",
                    stop_name: originalStudent?.stop_name || "",
                    shift: assignment.shift,
                    oldShift: originalStudent?.shift
                      ? ((originalStudent.shift.charAt(0).toUpperCase() +
                          originalStudent.shift.slice(1).toLowerCase()) as CanonicalShift)
                      : assignment.shift,
                  };
                }),
                busUpdates: [],
                timestamp: new Date(),
              };

              setRevertBuffer(revertData);
              setSnackbarStudentCount(result.movedCount);
              setShowSnackbar(true);
              setSelectedStudents(new Set());
              setShowSuggestions(false);

              // Refresh bus data
              await fetchBusData(true);
            }}
          />
        )}

        {/* 120-SECOND UNDO SNACKBAR */}
        <ReassignmentSnackbar
          isVisible={showSnackbar}
          studentCount={snackbarStudentCount}
          revertBuffer={revertBuffer}
          autoDismissSeconds={120}
          onRevert={async () => {
            if (!revertBuffer || !currentUser) return;
            try {
              const token = await currentUser.getIdToken();
              const response = await fetch("/api/admin/rollback-reassignment", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  operationId: revertBuffer.operationId,
                }),
              });

              const result = await response.json();
              if (!response.ok || !result.success) {
                throw new Error(result.error || "Rollback failed");
              }

              await fetchBusData(true);
              toast.success(`✅ Rolled back ${result.studentCount || revertBuffer.affectedStudents.length} student(s)`);
              setRevertBuffer(null);
              setShowSnackbar(false);
            } catch (error: any) {
              console.error("Revert failed:", error);
              toast.error("Failed to revert: " + error.message);
            }
          }}
          onConfirm={async () => {
            toast.success(`✅ ${snackbarStudentCount} students reassigned successfully`);
            setRevertBuffer(null);
            setShowSnackbar(false);
            await fetchBusData(true);
          }}
          onDismiss={() => {
            setShowSnackbar(false);
            setRevertBuffer(null);
          }}
        />
      </>
    );
  }
);
