"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import {
  ArrowRightLeft,
  Bus,
  CheckCircle2,
  Clock,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Search,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { toast } from "react-hot-toast";

// Assignment components and services
import { AssignmentFinalizeCard } from "@/components/assignment/AssignmentFinalizeCard";
import { RouteConfirmationModal } from "@/components/assignment/RouteConfirmationModal";
import {
  generateStagingId,
  type StagedRouteAssignment,
} from "@/lib/services/assignment-service";
import {
  computeNetRouteAssignments,
  validateRouteStagingPreCheck,
  type ComputeNetRouteAssignmentsResult,
  type DbRouteSnapshot,
  type StagedRouteOperation,
} from "@/lib/services/net-route-assignment-service";

export interface BusRouteAllocationTabRef {
  exportData: () => void;
  openCommitModal: () => void;
  getStagedCount: () => number;
}

interface BusData {
  id: string;
  busId: string;
  busNumber: string;
  routeId?: string;
  routeName?: string;
  capacity: number;
  currentMembers?: number;
  activeDriverId?: string;
  assignedDriverId?: string;
  activeTripId?: string;
  status?: string;
  shift?: string;
  load?: {
    morningCount?: number;
    eveningCount?: number;
  };
}

interface RouteData {
  id: string;
  routeId: string;
  routeName: string;
  totalStops: number;
  stops: Array<{ name: string; sequence: number; stop_name?: string }>;
  status?: string;
  active?: boolean;
}

interface BusRouteAllocationTabProps {
  onStagedCountChange?: (count: number) => void;
  onOpenHistory?: () => void;
}

export const BusRouteAllocationTab = forwardRef<BusRouteAllocationTabRef, BusRouteAllocationTabProps>(
  function BusRouteAllocationTab({ onStagedCountChange, onOpenHistory }, ref) {
    const { currentUser, userData } = useAuth();
    const routesScrollRef = useRef<HTMLDivElement>(null);

    // Core Data State
    const [buses, setBuses] = useState<BusData[]>([]);
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [loading, setLoading] = useState(true);

    // Multi-select bus state
    const [selectedBusIds, setSelectedBusIds] = useState<Set<string>>(new Set());

    // Staging State
    const [stagedAssignments, setStagedAssignments] = useState<StagedRouteAssignment[]>([]);

    // Search filters
    const [busSearchTerm, setBusSearchTerm] = useState("");
    const [routeSearchTerm, setRouteSearchTerm] = useState("");
    const [busFilter, setBusFilter] = useState<"all" | "assigned" | "unassigned">("all");

    // Modal and finalize state
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showFinalizeCard, setShowFinalizeCard] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [netRouteAssignmentResult, setNetRouteAssignmentResult] =
      useState<ComputeNetRouteAssignmentsResult | null>(null);

    // Sync staged count with parent
    useEffect(() => {
      onStagedCountChange?.(stagedAssignments.length);
    }, [stagedAssignments.length, onStagedCountChange]);

    // Data fetching
    const fetchAllData = useCallback(async () => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const [busesRes, routesRes] = await Promise.all([
          fetch("/api/buses", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/routes", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const busesJson = await busesRes.json();
        const busesData = (busesJson.buses || []).map((b: any) => ({
          ...b,
          id: b.busId || b.id,
        })) as BusData[];

        const routesJson = await routesRes.json();
        const routesData = (Array.isArray(routesJson) ? routesJson : routesJson.routes || []).map((r: any) => ({
          id: r.id || r.routeId,
          ...r,
        })) as RouteData[];

        setBuses(busesData);
        setRoutes(routesData);
      } catch (error) {
        console.error("Error loading route allocation data:", error);
        toast.error("Failed to load buses or routes");
      } finally {
        setLoading(false);
      }
    }, [currentUser]);

    useEffect(() => {
      fetchAllData();
    }, [fetchAllData]);

    // Computed values
    const filteredBuses = useMemo(() => {
      return buses
        .filter((bus) => {
          const num = bus.busNumber.toLowerCase();
          const rName = (bus.routeName || "").toLowerCase();
          const matchesSearch =
            num.includes(busSearchTerm.toLowerCase()) || rName.includes(busSearchTerm.toLowerCase());

          const isAssigned = !!bus.routeId;
          const matchesFilter =
            busFilter === "all" ||
            (busFilter === "assigned" && isAssigned) ||
            (busFilter === "unassigned" && !isAssigned);

          return matchesSearch && matchesFilter;
        })
        .sort((a, b) => a.busNumber.localeCompare(b.busNumber, undefined, { numeric: true }));
    }, [buses, busSearchTerm, busFilter]);

    const filteredRoutes = useMemo(() => {
      if (!routeSearchTerm.trim()) return routes;
      const term = routeSearchTerm.toLowerCase();
      return routes.filter((r) => r.routeName.toLowerCase().includes(term));
    }, [routes, routeSearchTerm]);

    // Merged route for bus (taking into account in-memory staging)
    const getMergedRouteForBus = useCallback(
      (bus: BusData): { routeName: string; isStaged: boolean; routeId: string | null } => {
        const staged = stagedAssignments.find((s) => s.busId === bus.id);
        if (staged) {
          return { routeName: staged.newRouteName, isStaged: true, routeId: staged.newRouteId };
        }
        return {
          routeName: bus.routeName || "Unassigned",
          isStaged: false,
          routeId: bus.routeId || null,
        };
      },
      [stagedAssignments]
    );

    // Multi-select handlers
    const toggleBusSelection = (busId: string) => {
      setSelectedBusIds((prev) => {
        const next = new Set(prev);
        if (next.has(busId)) next.delete(busId);
        else next.add(busId);
        return next;
      });
    };

    const selectAllBuses = () => {
      setSelectedBusIds(new Set(filteredBuses.map((b) => b.id)));
    };

    const clearBusSelection = () => {
      setSelectedBusIds(new Set());
    };

    // Stage route assignment for all selected buses
    const handleRouteSelect = (route: RouteData) => {
      if (selectedBusIds.size === 0) {
        toast.error("Please select at least one bus from the roster");
        return;
      }

      const selectedBusesList = buses.filter((b) => selectedBusIds.has(b.id));
      let stagedCount = 0;

      selectedBusesList.forEach((bus) => {
        const mergedRoute = getMergedRouteForBus(bus);
        if (mergedRoute.routeId === route.id) {
          return; // already assigned or staged to this route
        }

        const assignment: StagedRouteAssignment = {
          id: generateStagingId(),
          busId: bus.id,
          busNumber: bus.busNumber,
          busCode: bus.busNumber,
          newRouteId: route.id,
          newRouteName: route.routeName,
          newStopCount: route.totalStops || route.stops?.length || 0,
          oldRouteId: bus.routeId || null,
          oldRouteName: bus.routeName || null,
          status: "pending",
        };

        const existingIdx = stagedAssignments.findIndex((s) => s.busId === bus.id);
        if (existingIdx >= 0) {
          const updated = [...stagedAssignments];
          updated[existingIdx] = assignment;
          setStagedAssignments(updated);
        } else {
          setStagedAssignments((prev) => [...prev, assignment]);
        }
        stagedCount++;
      });

      if (stagedCount > 0) {
        toast.success(`Staged ${stagedCount} bus(es) → ${route.routeName}`);
      }
    };

    const removeFromStaging = (stagingId: string) => {
      setStagedAssignments((prev) => prev.filter((s) => s.id !== stagingId));
      toast.success("Removed from staging");
    };

    const clearAllStaging = () => {
      setStagedAssignments([]);
      toast.success("All staged route allocations cleared");
    };

    const openConfirmModal = () => {
      if (stagedAssignments.length === 0) {
        toast.error("No changes to confirm");
        return;
      }

      const dbSnapshot: DbRouteSnapshot = {
        buses: buses.map((b) => ({
          id: b.id,
          busNumber: b.busNumber,
          busId: b.busId || b.id,
          routeId: b.routeId || null,
          capacity: b.capacity,
          currentMembers: b.currentMembers,
        })),
        routes: routes.map((r) => ({
          id: r.id,
          routeId: r.routeId || r.id,
          routeName: r.routeName,
          totalStops: r.totalStops || r.stops?.length || 0,
          stops: r.stops,
        })),
      };

      const stagedOperations: StagedRouteOperation[] = stagedAssignments.map((s, index) => ({
        id: s.id,
        busId: s.busId,
        busNumber: s.busNumber,
        busCode: s.busCode,
        newRouteId: s.newRouteId,
        newRouteName: s.newRouteName,
        newStopCount: s.newStopCount,
        oldRouteId: s.oldRouteId,
        oldRouteName: s.oldRouteName,
        stagedAt: Date.now() + index,
      }));

      const result = computeNetRouteAssignments(stagedOperations, dbSnapshot);
      setNetRouteAssignmentResult(result);

      const validation = validateRouteStagingPreCheck(stagedOperations, dbSnapshot);
      if (validation.warnings.length > 0) {
        validation.warnings.forEach((w) => toast(w, { icon: "⚠️" }));
      }

      if (!validation.isValid) {
        validation.errors.forEach((e) => toast.error(e));
        return;
      }

      setShowConfirmModal(true);
    };

    const handleRevert = useCallback(() => {
      setShowConfirmModal(false);
      setShowFinalizeCard(false);
      setNetRouteAssignmentResult(null);
      toast.success("Action reverted. No changes applied.");
    }, []);

    const handleFinalizeInitiate = useCallback(() => {
      setShowConfirmModal(false);
      setShowFinalizeCard(true);
    }, []);

    const performCommit = async () => {
      if (!currentUser?.uid) {
        toast.error("Not authenticated");
        return;
      }

      if (!netRouteAssignmentResult || !netRouteAssignmentResult.hasChanges) {
        toast.success("No net changes to apply");
        setStagedAssignments([]);
        setShowFinalizeCard(false);
        setNetRouteAssignmentResult(null);
        return;
      }

      setProcessing(true);
      try {
        const stagedOps: StagedRouteOperation[] = stagedAssignments.map((s, index) => ({
          id: s.id,
          busId: s.busId,
          busNumber: s.busNumber,
          busCode: s.busCode,
          newRouteId: s.newRouteId,
          newRouteName: s.newRouteName,
          newStopCount: s.newStopCount,
          oldRouteId: s.oldRouteId,
          oldRouteName: s.oldRouteName,
          stagedAt: Date.now() + index,
        }));

        const token = await currentUser.getIdToken();
        const response = await fetch("/api/fleet/assign-routes", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            netChanges: Array.from(netRouteAssignmentResult.netChanges.values()),
            stagingSnapshot: stagedOps,
            actorInfo: {
              name: userData?.fullName || userData?.name || "Unknown",
              role: userData?.role || "admin",
            },
          }),
        });

        const result = await response.json();
        if (result.success) {
          toast.success(`✅ Successfully assigned ${result.updatedBuses.length} bus(es) to routes`);
          fetchAllData();
          setTimeout(() => {
            setStagedAssignments([]);
            setShowFinalizeCard(false);
            setNetRouteAssignmentResult(null);
          }, 1000);
        } else {
          toast.error(result.conflictDetails ? `Conflict: ${result.conflictDetails}` : result.message || "Failed to commit");
        }
      } catch (error) {
        console.error("Commit error:", error);
        toast.error("Failed to commit route assignments");
      } finally {
        setProcessing(false);
      }
    };

    // Export handler
    const handleExport = useCallback(() => {
      const rows = buses.map((b) => {
        const merged = getMergedRouteForBus(b);
        return {
          "Bus Number": b.busNumber,
          "Assigned Route": merged.routeName,
          Shift: b.shift || "Both",
          Capacity: b.capacity,
          "Current Load": b.currentMembers || 0,
        };
      });

      const csvHeader = "Bus Number,Assigned Route,Shift,Capacity,Current Load\n";
      const csvBody = rows
        .map((r) =>
          `"${r["Bus Number"]}","${r["Assigned Route"]}","${r.Shift}","${r.Capacity}","${r["Current Load"]}"`
        )
        .join("\n");
      const blob = new Blob([csvHeader + csvBody], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bus_route_allocations_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Bus route allocations exported");
    }, [buses, getMergedRouteForBus]);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      exportData: handleExport,
      openCommitModal: openConfirmModal,
      getStagedCount: () => stagedAssignments.length,
    }));

    return (
      <>
        {/* LEFT COLUMN: BUS ROSTER & MULTI-SELECT */}
        <div className="lg:col-span-4 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            <CardHeader className="p-3.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Bus className="w-4 h-4 text-cyan-500" />
                  <span>Fleet Buses</span>
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  {selectedBusIds.size > 0 && (
                    <Badge className="text-[10px] font-mono bg-cyan-500 text-black font-bold">
                      {selectedBusIds.size} Selected
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30"
                  >
                    {filteredBuses.length} Total
                  </Badge>
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search bus number or route..."
                  value={busSearchTerm}
                  onChange={(e) => setBusSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-xs bg-white dark:bg-zinc-900/80 border-zinc-200 dark:border-zinc-700"
                />
              </div>

              {/* Status Filters & Multi-select quick buttons */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {[
                    { key: "all", label: "All" },
                    { key: "assigned", label: "Assigned" },
                    { key: "unassigned", label: "Unassigned" },
                  ].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setBusFilter(f.key as any)}
                      className={cn(
                        "px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer",
                        busFilter === f.key
                          ? "bg-cyan-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-foreground"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={selectAllBuses}
                    className="text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline font-semibold cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-zinc-300 dark:text-zinc-700">•</span>
                  <button
                    type="button"
                    onClick={clearBusSelection}
                    className="text-[10px] text-muted-foreground hover:text-red-500 font-semibold cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </CardHeader>

            {/* Scrollable Bus List */}
            <div className={cn(
              "flex-1 min-h-0 p-2.5",
              loading && buses.length === 0
                ? "overflow-y-auto no-scrollbar space-y-2"
                : filteredBuses.length === 0
                ? "flex flex-col items-center justify-center h-full"
                : "overflow-y-auto no-scrollbar space-y-2"
            )}>
              {loading && buses.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="w-full h-16 rounded-xl bg-slate-100 dark:bg-zinc-800/50 animate-pulse border border-zinc-200 dark:border-zinc-800 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-4 h-4 rounded bg-slate-200 dark:bg-zinc-700/60" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-24 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                        <div className="h-2.5 w-32 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                      </div>
                    </div>
                    <div className="h-4 w-12 bg-slate-200 dark:bg-zinc-700/60 rounded-md" />
                  </div>
                ))
              ) : filteredBuses.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center my-auto p-6 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 text-muted-foreground flex items-center justify-center mb-1">
                    <Bus className="h-6 w-6" />
                  </div>
                  <p className="text-xs font-bold text-foreground">No Buses Match</p>
                  <p className="text-[11px] text-muted-foreground">Try adjusting search query or status filter.</p>
                </div>
              ) : (
                filteredBuses.map((bus) => {
                  const isSelected = selectedBusIds.has(bus.id);
                  const merged = getMergedRouteForBus(bus);

                  return (
                    <motion.div
                      key={bus.id}
                      onClick={() => toggleBusSelection(bus.id)}
                      className={cn(
                        "p-3 px-3.5 rounded-xl cursor-pointer transition-all border text-left flex items-center justify-between gap-3",
                        isSelected
                          ? "bg-cyan-500/10 dark:bg-cyan-950/30 border-cyan-500 shadow-sm ring-1 ring-cyan-500/30"
                          : "bg-white dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-800/70"
                      )}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Custom Checkbox */}
                        <div
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0",
                            isSelected
                              ? "bg-cyan-600 border-cyan-600 text-white"
                              : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                          )}
                        >
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>

                        <div className="min-w-0">
                          <p
                            className={cn(
                              "font-bold text-xs",
                              isSelected ? "text-cyan-600 dark:text-cyan-400" : "text-foreground"
                            )}
                          >
                            {bus.busNumber}
                          </p>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
                            <MapPin className="w-2.5 h-2.5 text-cyan-500 shrink-0" />
                            <span className="truncate max-w-[120px]">{merged.routeName}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {merged.isStaged ? (
                          <Badge className="text-[9px] px-1.5 py-0 border-none bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">
                            STAGED
                          </Badge>
                        ) : bus.routeId ? (
                          <Badge className="text-[9px] px-1.5 py-0 border-none bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                            Assigned
                          </Badge>
                        ) : (
                          <Badge className="text-[9px] px-1.5 py-0 border-none bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                            Unassigned
                          </Badge>
                        )}
                        <span className="text-[9px] font-mono text-muted-foreground">
                          {bus.currentMembers || 0}/{bus.capacity || 0}
                        </span>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: ROUTE SELECTION & STAGING */}
        <div className="lg:col-span-8 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            <CardHeader className="p-3.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-cyan-600/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
                    <RouteIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">
                      {selectedBusIds.size > 0
                        ? `Assign ${selectedBusIds.size} Selected Bus(es) to Route:`
                        : "Operational Routes Directory"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">
                      {selectedBusIds.size > 0
                        ? "Click any route below to stage assignment for all selected buses"
                        : "Select one or more buses from the left panel to stage route assignment"}
                    </p>
                  </div>
                </div>

                <div className="relative w-44 sm:w-56 shrink-0">
                  <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search routes..."
                    value={routeSearchTerm}
                    onChange={(e) => setRouteSearchTerm(e.target.value)}
                    className="pl-7 h-7 text-xs bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
                  />
                </div>
              </div>
            </CardHeader>

            {/* Scrollable Route Content */}
            <div
              className={cn(
                "flex-1 min-h-0 p-3",
                selectedBusIds.size > 0 ? "overflow-y-auto no-scrollbar space-y-3" : "flex flex-col items-center justify-center h-full"
              )}
              ref={routesScrollRef}
            >
              {selectedBusIds.size > 0 ? (
                <div>
                  <div className="p-2 px-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 mb-3 flex items-center justify-between text-xs text-cyan-700 dark:text-cyan-300">
                    <span>
                      🎯 Ready to reassign <strong>{selectedBusIds.size}</strong> bus(es). Click a destination route
                      below:
                    </span>
                    <button
                      type="button"
                      onClick={clearBusSelection}
                      className="text-muted-foreground hover:text-red-500 font-semibold cursor-pointer ml-2"
                    >
                      Cancel selection
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {filteredRoutes.map((route) => {
                      const assignedBuses = buses.filter((b) => b.routeId === route.id);
                      const stops = route.stops || [];

                      return (
                        <motion.div
                          key={route.id}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => handleRouteSelect(route)}
                          className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-800/40 hover:border-cyan-500/50 hover:bg-slate-50 dark:hover:bg-zinc-800/70 transition-all cursor-pointer text-left space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                                <Navigation className="w-3.5 h-3.5" />
                              </div>
                              <div>
                                <p className="font-bold text-xs text-foreground">{route.routeName}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {route.totalStops || stops.length} Stops Scheduled
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[9px] font-mono">
                              {assignedBuses.length} Buses
                            </Badge>
                          </div>

                          {/* Stops Preview */}
                          {stops.length > 0 && (
                            <div className="py-1 px-2 rounded-md bg-slate-50 dark:bg-zinc-900/60 text-[10px] text-muted-foreground flex items-center justify-between">
                              <span className="truncate max-w-[140px] font-medium">
                                {stops[0]?.name || stops[0]?.stop_name}
                              </span>
                              <span>→</span>
                              <span className="truncate max-w-[140px] font-medium">
                                {stops[stops.length - 1]?.name || stops[stops.length - 1]?.stop_name}
                              </span>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center space-y-2.5 my-auto max-w-sm">
                  <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center mb-1">
                    <ArrowRightLeft className="w-7 h-7" />
                  </div>
                  <h4 className="text-base font-bold text-foreground">Select Buses to Reassign</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Choose one or more buses from the left fleet roster to stage and reassign their operational route
                    allocations.
                  </p>
                </div>
              )}
            </div>

            {/* DOCKED STAGING FOOTER BAR */}
            {stagedAssignments.length > 0 && (
              <div className="p-2.5 px-3 border-t border-zinc-200 dark:border-zinc-800 bg-cyan-500/5 dark:bg-cyan-950/20 shrink-0 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-cyan-500 text-black font-bold text-[10px] px-1.5 py-0.5">
                    {stagedAssignments.length} Staged
                  </Badge>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    Pending route assignments ready for commit
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearAllStaging}
                    className="h-7 text-xs text-muted-foreground hover:text-red-500 px-2 cursor-pointer"
                  >
                    Clear All
                  </Button>
                  <Button
                    size="sm"
                    onClick={openConfirmModal}
                    className="h-7 text-xs bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-bold px-3 shadow-xs cursor-pointer gap-1"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Review & Commit ({stagedAssignments.length})</span>
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Modals & Dialogs */}
        <RouteConfirmationModal
          isOpen={showConfirmModal}
          onClose={() => {
            setShowConfirmModal(false);
            setNetRouteAssignmentResult(null);
          }}
          onFinalConfirm={handleFinalizeInitiate}
          onRevert={handleRevert}
          confirmationRows={netRouteAssignmentResult?.confirmationRows || []}
          busCount={netRouteAssignmentResult?.netChanges.size || 0}
          hasNoNetChanges={!netRouteAssignmentResult?.hasChanges}
          removedNoOpCount={netRouteAssignmentResult?.removedNoOpCount || 0}
          removedNoOpInfo={netRouteAssignmentResult?.removedNoOpInfo || []}
          processing={processing}
        />

        <AssignmentFinalizeCard
          isVisible={showFinalizeCard}
          count={netRouteAssignmentResult?.netChanges.size || 0}
          entityType="bus"
          onConfirm={performCommit}
          onRevert={handleRevert}
          processing={processing}
          timerDuration={120}
        />
      </>
    );
  }
);
