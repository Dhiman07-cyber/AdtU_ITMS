"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  Activity,
  ArrowRightLeft,
  Bus,
  ChevronRight,
  Download,
  History,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";

// Premium UI Components
import { ReassignmentHistoryModal } from "@/components/assignment/ReassignmentHistoryModal";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import ReassignmentPanel from "@/components/smart-allocation/ReassignmentPanel";
import ReassignmentSnackbar, {
  type RevertBufferData,
} from "@/components/smart-allocation/ReassignmentSnackbar";
import RouteVisualization from "@/components/smart-allocation/RouteVisualization";
import StudentRoster from "@/components/smart-allocation/StudentRoster";

// Hooks
// Data fetching via server-side API (PostgreSQL)
import { useApiCollection } from '@/hooks/useApiCollection';

// Services
import { AllocationRanker } from "@/lib/services/allocation-ranker";
import { StopBusMapper } from "@/lib/services/stop-bus-mapper";

import {
  detectOverloadedShift,
  getShiftDisplayName,
  type OverloadedShift
} from "@/lib/utils/overload-detection";
import { type CanonicalShift } from "@/lib/utils/shift-utils";


// Types
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
  shift?: string;
}

export interface ReassignmentPlan {
  studentId: string;
  studentName: string;
  fromBusId: string;
  toBusId: string;
  toBusNumber: string;
  stop_name: string;
  reason?: string;
  studentShift?: string; // Optimized: pass shift to avoid extra reads
}

export default function SmartAllocationPage() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const router = useRouter();

  // Core State
  const [buses, setBuses] = useState<BusData[]>([]);
  const [selectedBus, setSelectedBus] = useState<BusData | null>(null);
  const [students, setStudents] = useState<StudentData[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [isRefreshingCards, setIsRefreshingCards] = useState(false);

  // UI State
  const [overloadThreshold, setOverloadThreshold] = useState(0); // Default 0 = show all
  const [shiftFilter, setShiftFilter] = useState<string>("morning"); // Default to morning tab
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [overloadedShift, setOverloadedShift] = useState<OverloadedShift>(null); // Track which shift is overloaded

  // Reassignment State (simplified - panel handles its own state now)

  // Snackbar State for 10-second undo
  const [showSnackbar, setShowSnackbar] = useState(false);
  const [snackbarStudentCount, setSnackbarStudentCount] = useState(0);
  const [revertBuffer, setRevertBuffer] = useState<RevertBufferData | null>(
    null,
  );

  // History Modal State
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Services
  const stopBusMapper = useRef(new StopBusMapper());
  const ranker = useRef(new AllocationRanker());

  // Data Fetching
  const { data: routesData, refresh: refreshRoutes } = useApiCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc', autoRefresh: false,
  });

  // Permission Check
  useEffect(() => {
    if (authLoading) return;

    if (
      !currentUser ||
      (userData?.role !== "admin" && userData?.role !== "moderator")
    ) {
      router.push("/login");
    }
  }, [currentUser, userData, authLoading, router]);

  // Load Buses - One-time fetch
  // Server-side API reads from PostgreSQL — no Firestore client reads
  const fetchBusData = useCallback(async (silent = false): Promise<BusData[]> => {
    if (!currentUser) return [];

    if (silent) {
      setIsRefreshingCards(true);
    } else {
      setLoading(true);
    }
    try {
      const token = await currentUser.getIdToken();
      const [busesRes, driversRes, routesRes] = await Promise.all([
        fetch('/api/buses', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/drivers', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/routes', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const busesJson = await busesRes.json();
      const busesRaw = busesJson.buses || [];
      const driversJson = await driversRes.json();
      const driversRaw = Array.isArray(driversJson) ? driversJson : driversJson.drivers || [];
      const routesJson = await routesRes.json();
      const fetchedRoutes = routesJson.routes || (Array.isArray(routesJson) ? routesJson : []);
      const allAvailableRoutes = [...fetchedRoutes, ...routesData];

      const busData: BusData[] = [];
      const driverMap = new Map<string, any>();
      const stopCountsByBus = new Map<string, Map<string, number>>();

      for (const d of driversRaw) {
        const id = d.id || d.uid;
        driverMap.set(id, d);
      }

      for (const data of busesRaw) {
        const busId = data.busId || data.id;

        // Get driver info if exists
        let driverData = {};
        const driverId = data.activeDriverId || data.assignedDriverId;
        if (driverId) {
          const driver = driverMap.get(driverId);
          if (driver) {
            driverData = {
              driverName: driver.fullName,
              driverPhoto: driver.photoURL,
            };
          }
        }

        // JOIN DATA: Resolve Route from fetched routes using routeId
        let routeInfo = null;
        let route_stops: Array<{
          id: string;
          name: string;
          sequence: number;
          coordinates?: { lat: number; lng: number };
        }> = [];

        if (data.routeId && allAvailableRoutes.length > 0) {
          const matchedRoute = allAvailableRoutes.find(
            (r: any) =>
              r.id === data.routeId ||
              r.routeId === data.routeId ||
              r.routeName === data.routeId
          );

          if (matchedRoute) {
            routeInfo = matchedRoute;
            // Map stops from matched route
            if (matchedRoute.stops && Array.isArray(matchedRoute.stops)) {
              route_stops = matchedRoute.stops.map(
                (stop: any, index: number) => {
                  if (typeof stop === "string") {
                    return {
                      id: stop,
                      name: stop,
                      sequence: index + 1,
                    };
                  } else {
                    return {
                      id:
                        stop.stop_name || stop.id || stop.name || `stop_${index}`,
                      name:
                        stop.name || stop.stop_name || `Stop ${index + 1}`,
                      sequence: stop.sequence || index + 1,
                      coordinates: stop.coordinates,
                    };
                  }
                }
              );
            }
          }
        }

        // 2. Fallback: Check embedded route data (Legacy/Transition support)
        if (!routeInfo && (data.route?.stops || data.stops)) {
          console.warn(
            `⚠️ Bus ${data.busNumber} using embedded route data (Normalize this!)`
          );
          const stopsArray = data.route?.stops || data.stops;
          if (Array.isArray(stopsArray)) {
            route_stops = stopsArray.map((stop: any, index: number) => {
              if (typeof stop === "string") {
                return {
                  id: stop,
                  name: stop,
                  sequence: index + 1,
                };
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

        // Count students per stop - Use pre-calculated stopCounts from Firestore
        const stopCountsMap = new Map<string, number>();
        if (data.stopCounts) {
          Object.entries(data.stopCounts).forEach(([stop_name, count]) => {
            stopCountsMap.set(stop_name, count as number);
          });
        }

        // Format route name properly
        let formattedRouteName =
          routeInfo?.routeName || data.routeName || data.routeId || "Unknown";
        if (formattedRouteName.startsWith("route_")) {
          formattedRouteName =
            "Route-" + formattedRouteName.replace("route_", "");
        } else if (
          !formattedRouteName.toLowerCase().includes("route") &&
          formattedRouteName !== "Unknown"
        ) {
          formattedRouteName = "Route-" + formattedRouteName;
        }

        const morningCount = Number(data.morningLoad ?? data.morning_load ?? data.load?.morningCount ?? data.load?.morning_count ?? 0);
        const eveningCount = Number(data.eveningLoad ?? data.evening_load ?? data.load?.eveningCount ?? data.load?.evening_count ?? 0);
        const currentMembers = Number(data.currentMembers ?? data.current_members ?? (morningCount + eveningCount));

        const busObject = {
          id: busId,
          busNumber: data.busNumber || data.bus_number || "Unknown",
          routeId: data.route?.routeId || data.routeId || data.route_id || "",
          routeName: formattedRouteName,
          driverId: driverId,
          currentMembers: currentMembers,
          capacity: Number(data.capacity || 50),
          shift: data.shift || "both",
          stops: route_stops,
          stopCounts: stopCountsMap,
          load: {
            morningCount,
            eveningCount,
          },
          // Include full route object for ReassignmentPanel
          route: {
            routeId:
              routeInfo?.routeId || routeInfo?.id || data.route?.routeId || data.routeId || data.route_id || "",
            routeName: formattedRouteName,
            stops: route_stops.map((s) => ({
              stop_name: s.id,
              name: s.name,
              sequence: s.sequence,
            })),
          },
          ...driverData,
        };

        busData.push(busObject);
      }

      console.log(`✅ Loaded ${busData.length} buses with joined route data`);
      setBuses(busData);
      stopBusMapper.current.updateMappings(busData);
      return busData;
    } catch (error: any) {
      console.error("Error loading buses:", error);
      toast.error("Failed to load buses. Please refresh.");
      return [];
    } finally {
      setLoading(false);
      setIsRefreshingCards(false);
    }
  }, [currentUser, routesData]);

  useEffect(() => {
    fetchBusData(false);
  }, [currentUser]);

  // Load Students for Selected Bus
  useEffect(() => {
    if (!selectedBus) {
      setStudents([]);
      return;
    }

    const loadStudents = async () => {
      try {
        console.log(
          "🔍 Loading students for bus:",
          selectedBus.id,
          selectedBus.busNumber,
        );

        // Query students with multiple possible field values
        // Students may have busId stored as document ID (bus_6), busNumber (AS-01-SC-1392), or just a number
        // Firestore doesn't support OR queries easily, so we'll do multiple queries
        const possibleBusIds = Array.from(new Set([
          selectedBus.id,
          selectedBus.busNumber,
          (selectedBus as any).busId,
        ].filter(Boolean)));

        console.log("📋 Searching with bus identifiers:", possibleBusIds);

        const allStudents: any[] = [];
        const token = await currentUser.getIdToken();
        for (const busIdParam of possibleBusIds) {
          const res = await fetch(`/api/students?busId=${encodeURIComponent(busIdParam)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const students = await res.json();
            allStudents.push(...students);
          }
        }

        const studentData: StudentData[] = [];
        const processedIds = new Set<string>();

        console.log(`📊 Got ${allStudents.length} students from API`);

        // Deduplicate and map API results
        for (const s of allStudents) {
          const id = s.id;
          if (processedIds.has(id)) continue;
          processedIds.add(id);

          const studentStopId = (s.stop_name || "").toLowerCase();
          const stop = selectedBus.stops.find(
            (st) => (st.id || "").toLowerCase() === studentStopId,
          );

          studentData.push({
            id,
            fullName: s.name || "Unknown",
            enrollmentId: s.enrollmentId || "N/A",
            stop_name: s.stop_name || stop?.name || stop?.id || "Unknown Stop",
            busId: s.busId || s.busId || selectedBus.id,
            semester: s.semester,
            phone: s.phone,
            photoURL: s.profilePhotoUrl,
            shift: s.shift,
          });
        }

        console.log("✅ Loaded students:", studentData.length);
        console.log(
          "📍 Available stops on bus:",
          selectedBus.stops.map((s) => `${s.name} (${s.id})`),
        );

        setStudents(studentData);

        // Update the bus's load counts with actual student counts
        // This ensures the bus card shows the correct count
        // Use includes() to handle variations like "Morning", "Evening Shift", etc.
        const morningStudents = studentData.filter(
          (s) => (s.shift || "morning").toLowerCase().includes("morning")
        ).length;
        const eveningStudents = studentData.filter(
          (s) => (s.shift || "").toLowerCase().includes("evening")
        ).length;

        if (studentData.length > 0) {
          setBuses((prevBuses) =>
            prevBuses.map((b) =>
              b.id === selectedBus.id
                ? {
                  ...b,
                  load: {
                    morningCount: morningStudents,
                    eveningCount: eveningStudents,
                  },
                  currentMembers: studentData.length,
                }
                : b
            )
          );
        }

        console.log(`📊 Updated bus ${selectedBus.busNumber} counts: Morning=${morningStudents}, Evening=${eveningStudents}`);

        // Detect which shift is overloaded
        const overloadShift = detectOverloadedShift(
          { capacity: selectedBus.capacity, load: { morningCount: morningStudents, eveningCount: eveningStudents } },
          100, // 100% threshold to detect actual overload
        );
        setOverloadedShift(overloadShift);

        if (overloadShift) {
          console.log(
            `⚠️ Bus is overloaded in ${getShiftDisplayName(overloadShift)}`,
          );
        }
      } catch (error) {
        console.error("Error loading students:", error);
        toast.error("Failed to load students");
      }
    };

    loadStudents();
  }, [selectedBus]);

  // Display ALL students for the selected bus
  // NOTE: The shift tab filters the BUS LIST only, not the students within a selected bus
  // All students assigned to a bus should be visible regardless of shift tab
  // Each student's shift is shown as a badge in the StudentRoster component
  const displayStudents = useMemo(() => {
    if (!students || students.length === 0) return [];

    // Return all students - don't filter by shift tab
    // The shift filter only applies to which BUSES are shown, not which students
    // Students with different shifts can coexist on the same bus view
    console.log(`📊 Display students: ${students.length} total for selected bus`);

    return students;
  }, [students]);

  // Show buses filtered by shift tab and threshold
  const allBusesByLoad = useMemo(() => {
    let filtered = [...buses];

    // Apply shift filter based on tab selection
    // Morning tab: show buses with shift "morning" or "both"
    // Evening tab: show buses with shift "both" only (Evening students can only be on Both buses)
    if (shiftFilter === "morning") {
      filtered = filtered.filter((bus) => {
        const s = (bus.shift || "both").toLowerCase();
        return s === "morning" || s === "both";
      });
    } else if (shiftFilter === "evening") {
      filtered = filtered.filter((bus) => {
        const s = (bus.shift || "both").toLowerCase();
        return s === "evening" || s === "both";
      });
    }

    // Apply threshold filter (only show buses at or above threshold)
    // Use shift-specific load counts
    if (overloadThreshold > 0) {
      filtered = filtered.filter((bus) => {
        const shiftLoad = shiftFilter === "morning"
          ? (bus.load?.morningCount || 0)
          : (bus.load?.eveningCount || 0);
        const loadPercentage = bus.capacity > 0 ? (shiftLoad / bus.capacity) * 100 : 0;
        return loadPercentage >= overloadThreshold;
      });
    }

    // Sort by load percentage (highest first)
    // Use shift-specific load counts
    return filtered.sort((a, b) => {
      const loadA = shiftFilter === "morning"
        ? (a.load?.morningCount || 0)
        : (a.load?.eveningCount || 0);
      const loadB = shiftFilter === "morning"
        ? (b.load?.morningCount || 0)
        : (b.load?.eveningCount || 0);
      const percentA = a.capacity > 0 ? (loadA / a.capacity) * 100 : 0;
      const percentB = b.capacity > 0 ? (loadB / b.capacity) * 100 : 0;
      return percentB - percentA;
    });
  }, [buses, shiftFilter, overloadThreshold]);

  // Count overloaded buses for stats (above 100%)
  // Use shift-specific load counts
  const overloadedCount = useMemo(() => {
    return allBusesByLoad.filter((bus) => {
      const shiftLoad = shiftFilter === "morning"
        ? (bus.load?.morningCount || 0)
        : (bus.load?.eveningCount || 0);
      const loadPercentage = bus.capacity > 0 ? (shiftLoad / bus.capacity) * 100 : 0;
      return loadPercentage >= 100;
    }).length;
  }, [allBusesByLoad, shiftFilter]);

  // Open reassignment panel
  const openReassignmentPanel = useCallback(() => {
    if (selectedStudents.size === 0 || !selectedBus) {
      return;
    }
    setShowSuggestions(true);
  }, [selectedStudents.size, selectedBus]);

  // Handle Student Selection
  const toggleStudentSelection = (studentId: string) => {
    const newSelection = new Set(selectedStudents);
    if (newSelection.has(studentId)) {
      newSelection.delete(studentId);
    } else {
      newSelection.add(studentId);
    }
    setSelectedStudents(newSelection);
  };

  // Select/Deselect Students by Stop (TOGGLE behavior)
  // Uses case-insensitive stop_name matching for consistency
  // Selects ALL students at this stop regardless of shift (matching displayStudents behavior)
  const selectByStop = (stop_name: string, limit?: number) => {
    const normalizedStopId = (stop_name || "").toLowerCase().trim();

    // Get all students at this stop (no shift filter - show all students on selected bus)
    const stopStudents = students
      .filter((s) => {
        const matchesStop =
          (s.stop_name || "").toLowerCase().trim() === normalizedStopId;
        return matchesStop;
      })
      .slice(0, limit || undefined);

    console.log(`🎯 selectByStop called for "${stop_name}":`, {
      normalizedStopId,
      totalStudentsAtStop: stopStudents.length,
      studentNames: stopStudents.map((s) => s.fullName),
      currentlySelected: selectedStudents.size,
    });

    if (stopStudents.length === 0) {
      console.log(`   ⚠️ No students found at stop "${stop_name}"`);
      return;
    }

    const stopStudentIds = stopStudents.map((s) => s.id);

    // Check if ALL students at this stop are already selected
    const allSelected = stopStudentIds.every((id) => selectedStudents.has(id));
    const someSelected = stopStudentIds.some((id) => selectedStudents.has(id));

    console.log(
      `   📊 Selection state: allSelected=${allSelected}, someSelected=${someSelected}`,
    );

    const newSelection = new Set(selectedStudents);

    if (allSelected && stopStudentIds.length > 0) {
      // DESELECT all students at this stop
      console.log(`   ➖ Deselecting ${stopStudentIds.length} students`);
      stopStudentIds.forEach((id) => newSelection.delete(id));
    } else {
      // SELECT all students at this stop
      console.log(`   ➕ Selecting ${stopStudentIds.length} students`);
      stopStudentIds.forEach((id) => newSelection.add(id));
    }

    console.log(`   ✅ New selection count: ${newSelection.size}`);
    setSelectedStudents(newSelection);
  };

  // Export to CSV
  const exportToCSV = () => {
    const csvData = allBusesByLoad.map((bus: BusData) => {
      const shiftLoad = shiftFilter === "morning"
        ? (bus.load?.morningCount || 0)
        : (bus.load?.eveningCount || 0);
      const loadPercent = bus.capacity > 0 ? (shiftLoad / bus.capacity) * 100 : 0;

      return {
        "Bus Number": bus.busNumber,
        Route: bus.routeName,
        Driver: bus.driverName || "Not Assigned",
        "Current Load": shiftLoad,
        Capacity: bus.capacity,
        "Load %": loadPercent.toFixed(1),
        Shift: shiftFilter === "morning" ? "Morning" : "Evening",
        "Morning Count": bus.load?.morningCount || 0,
        "Evening Count": bus.load?.eveningCount || 0,
      };
    });

    console.log(
      "📤 Exporting buses:",
      allBusesByLoad.map((b: BusData) => ({
        bus: b.busNumber,
        driver: b.driverName,
      })),
    );

    if (csvData.length === 0) {
      toast.error("No data to export");
      return;
    }

    const csv = [
      Object.keys(csvData[0]).join(","),
      ...csvData.map((row: Record<string, any>) =>
        Object.values(row).join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overloaded_buses_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <PremiumPageLoader fullScreen message="Student Reassignment" subMessage="Loading allocation system..." />;
  }

  return (
    <div className="mt-20 sm:mt-10 space-y-6 overflow-x-hidden max-w-full px-2 sm:px-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Student Reassignment
          </h1>
          <p className="text-muted-foreground mt-1">
            Smart stop allocation and bus management system
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Desktop Layout (Hidden on Mobile) */}
          <div className="hidden sm:flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 border rounded-lg bg-white dark:bg-zinc-900 shadow-sm hover:shadow-blue-500/20 hover:border-blue-400/50 transition-all duration-300 group">
              <Label className="text-xs font-medium whitespace-nowrap">
                Threshold:
              </Label>
              <div className="w-24 relative">
                <div className="absolute inset-0 bg-blue-500/10 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg" />
                <Slider
                  value={[overloadThreshold]}
                  onValueChange={([value]) => setOverloadThreshold(value)}
                  min={0}
                  max={100}
                  step={5}
                  className="cursor-pointer relative z-10"
                />
              </div>
              <span className="text-xs font-mono font-bold min-w-[2.5rem] text-right text-blue-600 dark:text-blue-400">
                {overloadThreshold}%
              </span>
            </div>

            <Button
              size="default"
              className="bg-blue-600 hover:bg-blue-700 text-white h-9 text-sm shadow-md"
              onClick={openReassignmentPanel}
              disabled={selectedStudents.size === 0}
              title="Get AI-powered reassignment suggestions"
            >
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Reassign
            </Button>

            <Button
              variant="outline"
              size="default"
              className="h-9 text-sm"
              onClick={exportToCSV}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>

            <Button
              variant="outline"
              size="default"
              className="h-9 text-sm bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 shadow-sm"
              onClick={() => setShowHistoryModal(true)}
            >
              <History className="w-4 h-4 mr-2" />
              View History
            </Button>
          </div>

          {/* Mobile Layout (Hidden on Desktop) */}
          <div className="flex sm:hidden flex-col w-full gap-3">
            {userData?.role === 'moderator' ? (
              /* Moderator Mobile Layout: Threshold | Reassign | Export Icon */
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex flex-1 items-center gap-2 px-2 py-1.5 border rounded-lg bg-white dark:bg-zinc-900 shadow-sm">
                  <span className="text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400">
                    {overloadThreshold}%
                  </span>
                  <div className="flex-1">
                    <Slider
                      value={[overloadThreshold]}
                      onValueChange={([value]) => setOverloadThreshold(value)}
                      min={0}
                      max={100}
                      step={5}
                      className="cursor-pointer"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white h-9 text-xs px-2"
                  onClick={openReassignmentPanel}
                  disabled={selectedStudents.size === 0}
                >
                  Reassign
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={exportToCSV}
                >
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              /* Admin Mobile Layout: Row 1: Threshold | Reassign, Row 2: Export | View History */
              <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2 w-full">
                  <div className="flex-1 flex items-center gap-2 px-2 py-1.5 border rounded-lg bg-white dark:bg-zinc-900 shadow-sm">
                    <span className="text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400">
                      {overloadThreshold}%
                    </span>
                    <div className="flex-1">
                      <Slider
                        value={[overloadThreshold]}
                        onValueChange={([value]) => setOverloadThreshold(value)}
                        min={0}
                        max={100}
                        step={5}
                        className="cursor-pointer"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white h-9 text-xs"
                    onClick={openReassignmentPanel}
                    disabled={selectedStudents.size === 0}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 mr-1" />
                    Reassign
                  </Button>
                </div>
                <div className="flex items-center gap-2 w-full">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs"
                    onClick={exportToCSV}
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs"
                    onClick={() => setShowHistoryModal(true)}
                  >
                    <History className="w-3.5 h-3.5 mr-1.5" />
                    View History
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-6">
        {/* Row 1: Overloaded Buses + Route Visualization */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch min-h-[420px]">
          {/* Left Column - Buses */}
          <div className="lg:col-span-4 flex min-w-0">
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-lg pt-0 flex-1 flex flex-col">
              <CardHeader className="pb-2 pt-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <Bus className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Buses</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {overloadedCount > 0 ? (
                        <>
                          <span className="text-red-600 dark:text-red-400 font-bold">
                            {overloadedCount} overloaded
                          </span>{" "}
                          • {allBusesByLoad.length} shown
                        </>
                      ) : (
                        <>{allBusesByLoad.length} buses shown</>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              {/* Shift Tabs */}
              <div className="flex gap-2 px-3 py-2 bg-zinc-100/50 dark:bg-zinc-800/50 rounded-lg">
                <button
                  onClick={() => setShiftFilter("morning")}
                  className={cn(
                    "flex-1 py-2 px-3 text-sm font-semibold text-center transition-all duration-300 rounded-lg cursor-pointer",
                    shiftFilter === "morning"
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20"
                      : "bg-white dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600/80",
                  )}
                >
                  Morning
                </button>
                <button
                  onClick={() => setShiftFilter("evening")}
                  className={cn(
                    "flex-1 py-2 px-3 text-sm font-semibold text-center transition-all duration-300 rounded-lg cursor-pointer",
                    shiftFilter === "evening"
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20"
                      : "bg-white dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600/80",
                  )}
                >
                  Evening
                </button>
              </div>

              <CardContent className="p-0 flex-1">
                <ScrollArea className="h-full max-h-[260px]">
                  <div className="p-3 space-y-2 pt-0">
                    {allBusesByLoad.map((bus: BusData, index: number) => {
                      // Use shift-specific load count based on selected tab
                      const shiftLoad = shiftFilter === "morning"
                        ? (bus.load?.morningCount || 0)
                        : (bus.load?.eveningCount || 0);
                      const loadPercentage = bus.capacity > 0 ? (shiftLoad / bus.capacity) * 100 : 0;
                      const isSelected = selectedBus?.id === bus.id;

                      return (
                        <motion.div
                          key={bus.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05 }}
                          onClick={() => {
                            console.log("🎯 Bus selected:", {
                              id: bus.id,
                              busNumber: bus.busNumber,
                              stopsCount: bus.stops?.length || 0,
                              stops: bus.stops,
                              shiftLoad,
                              morningCount: bus.load?.morningCount,
                              eveningCount: bus.load?.eveningCount,
                            });
                            setSelectedBus(bus);
                          }}
                          className={cn(
                            "relative p-2 rounded-lg cursor-pointer transition-all border-2 shadow-sm hover:shadow-md",
                            isSelected
                              ? "bg-blue-50/70 dark:bg-blue-950/30 border-blue-500 dark:border-blue-400 shadow-blue-200/50 dark:shadow-blue-950"
                              : "bg-white dark:bg-zinc-800/90 hover:bg-blue-50/30 dark:hover:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700 hover:border-blue-300 dark:hover:border-blue-700",
                          )}
                        >
                          {isRefreshingCards && (
                            <div className="absolute inset-0 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-[1px] rounded-lg flex items-center justify-center z-10">
                              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div
                                className={cn(
                                  "w-7 h-7 rounded-lg flex items-center justify-center shadow-sm",
                                  isSelected
                                    ? "bg-blue-600 text-white"
                                    : "bg-blue-100 dark:bg-blue-900/30",
                                )}
                              >
                                <Bus
                                  className={cn(
                                    "w-3.5 h-3.5",
                                    isSelected
                                      ? "text-white"
                                      : "text-blue-600 dark:text-blue-400",
                                  )}
                                />
                              </div>
                              <div>
                                <h3 className="font-bold text-xs">
                                  {bus.busNumber}
                                </h3>
                                <p className="text-[10px] text-muted-foreground">
                                  {bus.routeName}
                                </p>
                              </div>
                            </div>
                            {bus.driverPhoto && (
                              <img
                                src={bus.driverPhoto}
                                alt={bus.driverName}
                                className="w-7 h-7 rounded-full border-2 border-white dark:border-zinc-700"
                              />
                            )}
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-medium text-muted-foreground">
                                {shiftLoad}/{bus.capacity}{" "}
                                students
                              </span>
                              <Badge
                                variant={
                                  loadPercentage > 95
                                    ? "destructive"
                                    : "secondary"
                                }
                                className="text-[10px] font-bold px-1.5 py-0.5"
                              >
                                {Math.min(loadPercentage, 100).toFixed(0)}%
                              </Badge>
                            </div>
                            <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{
                                  width: `${Math.min(loadPercentage, 100)}%`,
                                }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                                className={cn(
                                  "h-2 rounded-full",
                                  loadPercentage > 95
                                    ? "bg-gradient-to-r from-red-500 to-red-600"
                                    : loadPercentage > 75
                                    ? "bg-gradient-to-r from-amber-500 to-amber-600"
                                    : "bg-gradient-to-r from-blue-500 to-blue-600",
                                )}
                              />
                            </div>
                          </div>

                          {isSelected && (
                            <motion.div
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="absolute right-3 top-3"
                            >
                              <ChevronRight className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-pulse" />
                            </motion.div>
                          )}
                        </motion.div>
                      );
                    })}

                    {allBusesByLoad.length === 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center py-12"
                      >
                        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700 flex items-center justify-center">
                          <Bus className="w-10 h-10 text-muted-foreground" />
                        </div>
                        <p className="text-lg font-bold text-muted-foreground">
                          No Buses Found
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          No buses match your filter criteria
                        </p>
                      </motion.div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Route Visualization */}
          <div className="lg:col-span-8 flex min-w-0">
            {selectedBus ? (
              <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-lg pt-0 flex-1 flex flex-col max-w-full overflow-hidden">
                <CardHeader className="pb-3 pt-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                      <Activity className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        Route Visualization
                        <Badge variant="outline" className="text-xs font-mono">
                          <span className="hidden sm:inline">{selectedBus.busNumber}</span>
                          <span className="sm:hidden">{selectedBus.routeName}</span>
                        </Badge>
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5 hidden sm:block">
                        Click on stops to select students
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/10 dark:to-indigo-950/10 overflow-hidden min-h-0 max-w-full">
                  <RouteVisualization
                    bus={selectedBus}
                    students={students}
                    selectedStudents={selectedStudents}
                    onStopClick={(stop_name) => selectByStop(stop_name)}
                    shiftFilter={shiftFilter}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-lg flex-1 flex flex-col min-h-[420px]">
                <CardContent className="flex items-center justify-center flex-1">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center"
                  >
                    <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700 flex items-center justify-center">
                      <Target className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <p className="text-xl font-bold mb-2 text-foreground">
                      Select a bus to manage
                    </p>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Click on an overloaded bus from the left panel to view
                      route visualization and student roster
                    </p>
                    <div className="mt-6 flex items-center justify-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      <p className="text-xs text-muted-foreground">
                        Choose from{" "}
                        <span className="font-bold">
                          {allBusesByLoad.length}
                        </span>{" "}
                        buses ({overloadedCount} overloaded)
                      </p>
                    </div>
                  </motion.div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Row 2: Student Roster - Full Width */}
        {selectedBus && (
          <div className="grid grid-cols-1">
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-lg pt-0">
              <CardHeader className="pb-3 pt-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                      <Users className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base font-bold">
                          Student Roster
                        </CardTitle>
                        <Badge
                          variant="secondary"
                          className="text-xs font-bold px-2 py-0.5"
                        >
                          {students.length}
                        </Badge>
                        {overloadedShift && (
                          <Badge
                            variant="destructive"
                            className="text-xs font-semibold px-2 py-0.5"
                          >
                            {getShiftDisplayName(overloadedShift)}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-xs mt-0.5">
                        {selectedStudents.size > 0 ? (
                          <>
                            <span className="text-purple-600 dark:text-purple-400 font-semibold">
                              {selectedStudents.size}
                            </span>{" "}
                            selected
                          </>
                        ) : (
                          <span className="hidden sm:inline">
                            Total: {students.length} students
                            {overloadedShift && (
                              <>
                                {" "}
                                | Affected:{" "}
                                <span className="text-red-600 dark:text-red-400 font-bold">
                                  {displayStudents.length}
                                </span>
                              </>
                            )}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center justify-start gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        setSelectedStudents(new Set(students.map((s) => s.id)))
                      }
                      className="text-xs sm:text-sm h-8 sm:h-9 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Select All
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setSelectedStudents(new Set())}
                      className="text-xs sm:text-sm h-8 sm:h-9 bg-red-600 hover:bg-red-700 text-white"
                      disabled={selectedStudents.size === 0}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[500px] overflow-y-auto">
                  <StudentRoster
                    students={displayStudents}
                    selectedStudents={selectedStudents}
                    onToggleSelection={toggleStudentSelection}
                    onSelectByStop={selectByStop}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Right - Suggestions & Reassignment */}
      {showSuggestions && selectedStudents.size > 0 && selectedBus && (
        <ReassignmentPanel
          selectedStudents={Array.from(selectedStudents)
            .map((id) => students.find((s) => s.id === id)!)
            .filter(Boolean)}
          allBuses={buses}
          currentBus={selectedBus}
          onClose={() => {
            setShowSuggestions(false);
            // Don't deselect students when closing the panel
            // setSelectedStudents(new Set()); // Removed this line
          }}
          onSuccess={async (result) => {
            // Store revert buffer for undo
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
                  oldShift: (originalStudent?.shift
                    ? (originalStudent.shift.charAt(0).toUpperCase() + originalStudent.shift.slice(1).toLowerCase()) as CanonicalShift
                    : assignment.shift),
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

            // Silently refresh bus data without triggering full-page reload
            const freshBuses: BusData[] = await fetchBusData(true);
            if (Array.isArray(freshBuses) && freshBuses.length > 0 && selectedBus) {
              const currentBusId = selectedBus.id;
              const updatedBus = freshBuses.find((b: BusData) => b.id === currentBusId);
              if (updatedBus) {
                setSelectedBus(updatedBus);
              }
            }
          }}
        />
      )}

      {/* 120-Second Undo Snackbar */}
      <ReassignmentSnackbar
        isVisible={showSnackbar}
        studentCount={snackbarStudentCount}
        revertBuffer={revertBuffer}
        autoDismissSeconds={120}
        onRevert={async () => {
          if (!revertBuffer || !currentUser) return;

          try {
            // Call the PostgreSQL-based rollback API
            const token = await currentUser.getIdToken();
            const response = await fetch('/api/admin/rollback-reassignment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                operationId: revertBuffer.operationId,
              }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              throw new Error(result.error || 'Rollback failed');
            }

            // Refresh data to reflect the reversion
            const freshBuses = await fetchBusData(true);
            refreshRoutes();

            toast.success(`✅ Rolled back ${result.studentCount || revertBuffer.affectedStudents.length} student(s)`);
            setRevertBuffer(null);
            setShowSnackbar(false);

            // Force refresh the selected bus
            if (selectedBus && freshBuses) {
              const currentBusId = selectedBus.id;
              setSelectedBus(null);
              // Small delay to ensure state update for buses has propagated
              setTimeout(() => {
                const updatedBus = freshBuses.find((b) => b.id === currentBusId);
                if (updatedBus) {
                  setSelectedBus(updatedBus);
                }
              }, 100);
            }
          } catch (error: any) {
            console.error("Revert failed:", error);
            toast.error("Failed to revert: " + error.message);
          }
        }}
        onConfirm={async () => {
          // Finalize the reassignment and trigger card refresh
          toast.success(
            `✅ ${snackbarStudentCount} students reassigned successfully`,
          );
          setRevertBuffer(null);
          setShowSnackbar(false);
          refreshRoutes();
          await fetchBusData(true);
        }}
        onDismiss={() => {
          setShowSnackbar(false);
          setRevertBuffer(null);
        }}
      />

      {/* Reassignment History Modal */}
      <ReassignmentHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
        defaultType="student_reassignment"
        onRefresh={() => {
          refreshRoutes();
          fetchBusData();
        }}
      />
    </div>
  );
}