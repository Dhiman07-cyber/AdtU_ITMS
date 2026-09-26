"use client";

import Avatar from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { normalizeShift } from "@/lib/utils/shift-utils";
import { motion } from "motion/react";
import {
  ArrowRightLeft,
  Bus,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
  Trash2,
  User,
  UserCog,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { toast } from "react-hot-toast";

// Assignment components and services
import { AssignmentFinalizeCard } from "@/components/assignment/AssignmentFinalizeCard";
import { DriverConfirmationModal } from "@/components/assignment/DriverConfirmationModal";
import { DriverStagingAreaV2, type StagedDriverChange } from "@/components/assignment/DriverStagingAreaV2";
import { ShiftSlotPrompt, type DriverSlotInfo, type ShiftSlotPayload } from "@/components/assignment/ShiftSlotPrompt";
import {
  formatDriverCode,
  getDriverStatus,
  type StagedDriverAssignment,
} from "@/lib/services/assignment-service";
import {
  computeNetAssignments,
  validateStagingPreCheck,
  type ComputeNetAssignmentsResult,
  type DbSnapshot,
  type StagedOperation,
} from "@/lib/services/net-assignment-service";

export interface DriverReassignmentTabRef {
  exportData: () => void;
  openCommitModal: () => void;
  getStagedCount: () => number;
}

interface DriverData {
  id: string;
  fullName?: string;
  name?: string;
  email?: string;
  phone?: string;
  driverId?: string;
  employeeId?: string;
  busId?: string;
  routeId?: string;
  shift?: string;
  status?: string;
  profilePhotoUrl?: string;
  isReserved?: boolean;
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
  stops?: Array<{ name: string; stop_name?: string; sequence: number }>;
}

interface RouteData {
  id: string;
  routeId: string;
  routeName: string;
  totalStops: number;
  stops?: Array<{ name: string; sequence: number; stop_name?: string }>;
  estimatedTime?: string;
}

function getDriversForBusSlots(bus: BusData, drivers: DriverData[]): DriverSlotInfo[] {
  const result: DriverSlotInfo[] = [];
  const driverIds = new Set<string>();
  if (bus.assignedDriverId) driverIds.add(bus.assignedDriverId);
  if (bus.activeDriverId && bus.activeDriverId !== bus.assignedDriverId) driverIds.add(bus.activeDriverId);

  drivers.forEach((d) => {
    const dBusId = d.busId;
    if (dBusId === bus.id || dBusId === bus.busId) {
      driverIds.add(d.id);
    }
  });

  driverIds.forEach((dId) => {
    const driver = drivers.find((d) => d.id === dId);
    if (driver) {
      result.push({
        id: driver.id,
        name: driver.fullName || driver.name || "Unknown",
        code: formatDriverCode(driver.driverId || driver.employeeId || driver.id),
        shift: driver.shift || "",
        photoUrl: driver.profilePhotoUrl,
      });
    }
  });

  return result;
}

interface DriverReassignmentTabProps {
  onStagedCountChange?: (count: number) => void;
  onOpenHistory?: () => void;
}

export const DriverReassignmentTab = forwardRef<DriverReassignmentTabRef, DriverReassignmentTabProps>(
  function DriverReassignmentTab({ onStagedCountChange, onOpenHistory }, ref) {
    const { currentUser, userData } = useAuth();
    const busesScrollRef = useRef<HTMLDivElement>(null);

    // Data State
    const [drivers, setDrivers] = useState<DriverData[]>([]);
    const [buses, setBuses] = useState<BusData[]>([]);
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [loading, setLoading] = useState(true);

    // Selection State
    const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

    // Staging State
    const [stagedChanges, setStagedChanges] = useState<StagedDriverChange[]>([]);
    const [stagedAssignments, setStagedAssignments] = useState<StagedDriverAssignment[]>([]);

    // Search and filters
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [busSearchTerm, setBusSearchTerm] = useState("");

    // Modal state
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showFinalizeCard, setShowFinalizeCard] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [netAssignmentResult, setNetAssignmentResult] = useState<ComputeNetAssignmentsResult | null>(null);

    // Shift slot prompt
    const [showSlotPrompt, setShowSlotPrompt] = useState(false);
    const [slotPromptBus, setSlotPromptBus] = useState<BusData | null>(null);

    // Sync staged count
    useEffect(() => {
      onStagedCountChange?.(stagedChanges.length);
    }, [stagedChanges.length, onStagedCountChange]);

    // Data fetching
    const fetchAllData = useCallback(async () => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const token = await currentUser.getIdToken();
        const [driversRes, busesRes, routesRes] = await Promise.all([
          fetch("/api/drivers", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/buses", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/routes", { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        const driversJson = await driversRes.json();
        const driversData = (Array.isArray(driversJson) ? driversJson : driversJson.drivers || []).map((d: any) => ({
          id: d.id || d.uid,
          ...d,
        })) as DriverData[];
        const busesJson = await busesRes.json();
        const busesData = (busesJson.buses || []).map((b: any) => ({ ...b, id: b.busId || b.id })) as BusData[];
        const routesJson = await routesRes.json();
        const routesData = (Array.isArray(routesJson) ? routesJson : routesJson.routes || []).map((r: any) => ({
          id: r.id || r.routeId,
          ...r,
        })) as RouteData[];

        setDrivers(driversData);
        setBuses(busesData);
        setRoutes(routesData);
      } catch (error) {
        console.error("Error loading driver data:", error);
        toast.error("Failed to load driver/fleet data");
      } finally {
        setLoading(false);
      }
    }, [currentUser]);

    useEffect(() => {
      fetchAllData();
    }, [fetchAllData]);

    // Computed values
    const filteredDrivers = useMemo(() => {
      return drivers
        .filter((driver) => {
          const name = driver.fullName || driver.name || "";
          const code = driver.driverId || driver.employeeId || "";
          const matchesSearch =
            name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            code.toLowerCase().includes(searchTerm.toLowerCase());

          const status = getDriverStatus(driver);
          const matchesStatus =
            statusFilter === "all" ||
            (statusFilter === "assigned" && status === "Assigned") ||
            (statusFilter === "reserved" && status === "Reserved");

          return matchesSearch && matchesStatus;
        })
        .sort((a, b) => {
          const aNum = parseInt((a.driverId || a.employeeId || "").replace(/\D/g, ""), 10) || 0;
          const bNum = parseInt((b.driverId || b.employeeId || "").replace(/\D/g, ""), 10) || 0;
          return aNum - bNum;
        });
    }, [drivers, searchTerm, statusFilter]);

    const selectedDriver = useMemo(
      () => (selectedDriverId ? drivers.find((d) => d.id === selectedDriverId) || null : null),
      [selectedDriverId, drivers]
    );

    const getBusForDriver = useCallback(
      (driver: DriverData): BusData | null => {
        const busId = driver.busId;
        if (!busId) return null;
        return buses.find((b) => b.id === busId || b.busId === busId) || null;
      },
      [buses]
    );

    const getRouteForBus = useCallback(
      (bus: BusData): RouteData | null => {
        if (!bus.routeId) return null;
        return routes.find((r) => r.id === bus.routeId || r.routeId === bus.routeId) || null;
      },
      [routes]
    );

    const getDriverForBus = useCallback(
      (bus: BusData): DriverData | null => {
        const driverId = bus.activeDriverId || bus.assignedDriverId;
        if (driverId) {
          const driver = drivers.find((d) => d.id === driverId);
          if (driver) return driver;
        }
        return drivers.find((d) => d.busId === bus.id || d.busId === bus.busId) || null;
      },
      [drivers]
    );

    const selectedDriverBus = useMemo(
      () => (selectedDriver ? getBusForDriver(selectedDriver) : null),
      [selectedDriver, getBusForDriver]
    );

    const getMergedBusForDriver = useCallback(
      (driver: DriverData): { bus: BusData | null; isStaged: boolean; isReserved: boolean; stagedBusNumber?: string } => {
        const asNewDriver = stagedChanges.find(
          (s) => s.newDriver.id === driver.id && s.action !== "make_reserved"
        );
        if (asNewDriver) {
          const stagedBus = buses.find((b) => b.id === asNewDriver.busId);
          return { bus: stagedBus || null, isStaged: true, isReserved: false, stagedBusNumber: asNewDriver.busNumber };
        }

        const asDisplaced = stagedChanges.find((s) =>
          s.oldDrivers.some((od) => od.id === driver.id && (od.impact === "reserved" || od.impact === "split"))
        );
        if (asDisplaced) return { bus: null, isStaged: true, isReserved: true };

        const asMakeReserved = stagedChanges.find(
          (s) => s.action === "make_reserved" && s.newDriver.id === driver.id
        );
        if (asMakeReserved) return { bus: null, isStaged: true, isReserved: true };

        const asSwapped = stagedChanges.find((s) =>
          s.oldDrivers.some((od) => od.id === driver.id && od.impact === "swapped")
        );
        if (asSwapped) {
          const newDriverOldBus = getBusForDriver({ id: asSwapped.newDriver.id } as DriverData);
          return { bus: newDriverOldBus || null, isStaged: true, isReserved: false };
        }

        const liveBus = getBusForDriver(driver);
        return { bus: liveBus, isStaged: false, isReserved: !liveBus };
      },
      [stagedChanges, buses, getBusForDriver]
    );

    const getMergedDriverForBus = useCallback(
      (bus: BusData): { driver: DriverData | null; isStaged: boolean; stagedDriverName?: string } => {
        const stagedToBus = stagedChanges.find((s) => s.busId === bus.id && s.action !== "make_reserved");
        if (stagedToBus) {
          const newDriver = drivers.find((d) => d.id === stagedToBus.newDriver.id);
          return { driver: newDriver || null, isStaged: true, stagedDriverName: stagedToBus.newDriver.name };
        }

        const liveDriver = getDriverForBus(bus);
        if (liveDriver) {
          const driverBeingMoved = stagedChanges.find(
            (s) => s.newDriver.id === liveDriver.id && s.busId !== bus.id
          );
          if (driverBeingMoved) return { driver: null, isStaged: true };

          const driverDisplaced = stagedChanges.find((s) =>
            s.oldDrivers.some((od) => od.id === liveDriver.id && (od.impact === "reserved" || od.impact === "split"))
          );
          if (driverDisplaced) return { driver: null, isStaged: true };

          const driverMadeReserved = stagedChanges.find(
            (s) => s.action === "make_reserved" && s.newDriver.id === liveDriver.id
          );
          if (driverMadeReserved) return { driver: null, isStaged: true };
        }

        return { driver: liveDriver, isStaged: false };
      },
      [stagedChanges, drivers, getDriverForBus]
    );

    const sortedBuses = useMemo(() => {
      let result = buses;
      if (busSearchTerm.trim()) {
        const term = busSearchTerm.toLowerCase();
        result = result.filter(
          (b) =>
            b.busNumber.toLowerCase().includes(term) ||
            (b.routeName && b.routeName.toLowerCase().includes(term))
        );
      }
      if (!selectedDriverBus) return result;
      return [...result].sort((a, b) => {
        if (a.id === selectedDriverBus.id) return -1;
        if (b.id === selectedDriverBus.id) return 1;
        return 0;
      });
    }, [buses, busSearchTerm, selectedDriverBus]);

    // Handlers
    const handleDriverSelect = (driverId: string) => {
      setSelectedDriverId((prev) => (prev === driverId ? null : driverId));
      if (busesScrollRef.current) {
        busesScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    };

    const handleMakeReserved = () => {
      if (!selectedDriverId || !selectedDriver) {
        toast.error("No driver selected");
        return;
      }
      const currentBus = getBusForDriver(selectedDriver);
      const driverCode = formatDriverCode(selectedDriver.driverId || selectedDriver.employeeId || selectedDriver.id);

      const change: StagedDriverChange = {
        id: `stg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        busId: currentBus?.id || "",
        busNumber: currentBus?.busNumber || "N/A",
        busShift: currentBus ? normalizeShift(currentBus.shift) : "Both",
        action: "make_reserved",
        newDriver: {
          id: selectedDriver.id,
          name: selectedDriver.fullName || selectedDriver.name || "Unknown",
          code: driverCode,
          shift: selectedDriver.shift || "",
        },
        oldDrivers: [],
        targetSlot: "Both",
        status: "pending",
      };

      const existingIdx = stagedChanges.findIndex(
        (s) => s.newDriver.id === selectedDriver.id || s.oldDrivers.some((od) => od.id === selectedDriver.id)
      );

      if (existingIdx >= 0) {
        const updated = [...stagedChanges];
        updated[existingIdx] = change;
        setStagedChanges(updated);
      } else {
        setStagedChanges((prev) => [...prev, change]);
      }
      toast.success(`${selectedDriver.fullName || selectedDriver.name} staged as Reserved`);
    };

    const handleBusSelect = (bus: BusData) => {
      if (!selectedDriverId) {
        toast.error("Please select a driver first");
        return;
      }
      if (bus.activeTripId) {
        toast.error(`Bus ${bus.busNumber} has an active trip. Cannot assign.`);
        return;
      }
      const driver = drivers.find((d) => d.id === selectedDriverId);
      if (!driver) return;

      const mergedBusInfo = getMergedBusForDriver(driver);
      if (mergedBusInfo.bus?.id === bus.id) {
        toast("This bus is already assigned to the selected driver", { icon: "ℹ️" });
        return;
      }

      setSlotPromptBus(bus);
      setShowSlotPrompt(true);
    };

    const handleSlotStage = (payload: ShiftSlotPayload) => {
      const driver = drivers.find((d) => d.id === payload.newDriver.id);
      if (!driver) return;

      const driverCode = formatDriverCode(driver.driverId || driver.employeeId || driver.id);

      const change: StagedDriverChange = {
        id: `stg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        busId: payload.busId,
        busNumber: payload.busNumber,
        busShift: payload.busShift,
        action: payload.action,
        newDriver: {
          id: driver.id,
          name: driver.fullName || driver.name || "Unknown",
          code: driverCode,
          shift: driver.shift || "",
        },
        oldDrivers: payload.oldDrivers,
        targetSlot: payload.targetSlot,
        status: "pending",
      };

      const existingIdx = stagedChanges.findIndex((s) => s.newDriver.id === driver.id);
      if (existingIdx >= 0) {
        const updated = [...stagedChanges];
        updated[existingIdx] = change;
        setStagedChanges(updated);
      } else {
        setStagedChanges((prev) => [...prev, change]);
      }

      toast.success(`Staged: ${driver.fullName || driver.name} → ${payload.busNumber} (${payload.targetSlot})`);
      setSelectedDriverId(null);
    };

    const removeFromStaging = (id: string) => {
      setStagedChanges((prev) => prev.filter((s) => s.id !== id));
      toast.success("Removed from staging");
    };

    const clearAllStaging = () => {
      setStagedChanges([]);
      toast.success("All staged changes cleared");
    };

    const openConfirmModal = () => {
      if (stagedChanges.length === 0) {
        toast.error("No changes to confirm");
        return;
      }

      const legacyAssignments: StagedDriverAssignment[] = stagedChanges.map((change) => {
        const currentBus =
          change.action !== "make_reserved" ? getBusForDriver({ id: change.newDriver.id } as DriverData) : null;

        return {
          id: change.id,
          driverId: change.newDriver.id,
          driverName: change.newDriver.name,
          driverCode: change.newDriver.code,
          newBusId: change.action === "make_reserved" ? "" : change.busId,
          newBusNumber: change.action === "make_reserved" ? "Reserved" : change.busNumber,
          newRouteId: "",
          newRouteName: "",
          oldBusId: currentBus?.id || null,
          oldBusNumber: currentBus?.busNumber || null,
          previousOperatorId: change.oldDrivers[0]?.id || null,
          previousOperatorName: change.oldDrivers[0]?.name || null,
          previousOperatorCode: change.oldDrivers[0]?.code || null,
          affectOnPreviousOperator:
            change.action === "swap"
              ? "swapped"
              : change.action === "split"
              ? "reserved"
              : change.oldDrivers.length > 0
              ? "reserved"
              : "none",
          swappedToBusId: change.action === "swap" ? currentBus?.id || null : null,
          swappedToBusNumber: change.action === "swap" ? currentBus?.busNumber || null : null,
          driverPreviousState: currentBus ? "assigned" : "reserved",
          status: "pending",
        } as StagedDriverAssignment;
      });

      setStagedAssignments(legacyAssignments);

      const dbSnapshot: DbSnapshot = {
        drivers: drivers.map((d) => ({
          id: d.id,
          name: d.fullName || d.name || "Unknown",
          employeeId: d.driverId || d.employeeId || d.id,
          busId: d.busId || null,
          isReserved: d.isReserved || !d.busId,
        })),
        buses: buses.map((b) => ({
          id: b.id,
          busNumber: b.busNumber,
          registrationNumber: b.busNumber,
          assignedDriverId: b.assignedDriverId || null,
          activeDriverId: b.activeDriverId || null,
          routeId: b.routeId || null,
        })),
      };

      const stagedOps: StagedOperation[] = legacyAssignments.map((s, i) => {
        let type: "assign" | "swap" | "markReserved" = "assign";
        if (s.affectOnPreviousOperator === "swapped") type = "swap";
        if (s.newBusNumber === "Reserved") type = "markReserved";

        return {
          id: s.id,
          type,
          driverId: s.driverId,
          driverName: s.driverName,
          driverCode: s.driverCode,
          busId: s.newBusId || null,
          busNumber: s.newBusNumber,
          swapDriverId: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorId : null,
          swapDriverName: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorName : null,
          stagedAt: Date.now() + i,
          oldBusNumber: s.oldBusNumber,
        };
      });

      const result = computeNetAssignments(stagedOps, dbSnapshot);
      setNetAssignmentResult(result);

      const validation = validateStagingPreCheck(stagedOps, dbSnapshot);
      if (validation.warnings.length > 0) validation.warnings.forEach((w) => toast(w, { icon: "⚠️" }));
      if (!validation.isValid) {
        validation.errors.forEach((e) => toast.error(e));
        return;
      }

      setShowConfirmModal(true);
    };

    const handleRevert = useCallback(() => {
      setShowConfirmModal(false);
      setShowFinalizeCard(false);
      setNetAssignmentResult(null);
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
      if (!netAssignmentResult || !netAssignmentResult.hasChanges) {
        toast.success("No net changes to apply");
        setStagedChanges([]);
        setStagedAssignments([]);
        setShowFinalizeCard(false);
        setNetAssignmentResult(null);
        return;
      }

      setProcessing(true);
      try {
        const stagedOps: StagedOperation[] = stagedAssignments.map((s, i) => {
          let type: "assign" | "swap" | "markReserved" = "assign";
          if (s.affectOnPreviousOperator === "swapped") type = "swap";
          if (s.newBusNumber === "Reserved") type = "markReserved";
          return {
            id: s.id,
            type,
            driverId: s.driverId,
            driverName: s.driverName,
            driverCode: s.driverCode,
            busId: s.newBusId || null,
            busNumber: s.newBusNumber,
            swapDriverId: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorId : null,
            swapDriverName: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorName : null,
            stagedAt: Date.now() + i,
            oldBusNumber: s.oldBusNumber,
          };
        });

        const adminName = userData?.fullName || userData?.name || "Admin";
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/fleet/assign-drivers", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            netChanges: Array.from(netAssignmentResult.netChanges.values()),
            driverFinalState: Array.from(netAssignmentResult.driverFinalState.values()),
            stagingSnapshot: stagedOps,
            actorInfo: { name: adminName, role: "admin", label: `${adminName} (Admin)` },
          }),
        });

        const result = await response.json();
        if (result.success) {
          toast.success(`✅ Successfully assigned ${result.updatedDrivers.length} driver(s)`);
          fetchAllData();
          setTimeout(() => {
            setStagedChanges([]);
            setStagedAssignments([]);
            setShowFinalizeCard(false);
            setNetAssignmentResult(null);
          }, 1000);
        } else {
          toast.error(result.conflictDetails ? `Conflict: ${result.conflictDetails}` : result.message || "Failed to commit");
        }
      } catch (error) {
        console.error("Commit error:", error);
        toast.error("Failed to commit assignments");
      } finally {
        setProcessing(false);
      }
    };

    // Export handler
    const handleExport = useCallback(() => {
      const rows = drivers.map((d) => {
        const mergedBus = getMergedBusForDriver(d);
        return {
          "Driver ID": d.driverId || d.employeeId || d.id,
          "Full Name": d.fullName || d.name || "",
          Phone: d.phone || "",
          Status: getDriverStatus(d),
          "Assigned Bus": mergedBus.bus ? mergedBus.bus.busNumber : "Reserved",
          Shift: d.shift || "Both",
        };
      });

      const csvHeader = "Driver ID,Full Name,Phone,Status,Assigned Bus,Shift\n";
      const csvBody = rows
        .map((r) =>
          `"${r["Driver ID"]}","${r["Full Name"]}","${r.Phone}","${r.Status}","${r["Assigned Bus"]}","${r.Shift}"`
        )
        .join("\n");
      const blob = new Blob([csvHeader + csvBody], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `driver_assignments_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Driver assignments exported");
    }, [drivers, getMergedBusForDriver]);

    // Expose ref methods
    useImperativeHandle(ref, () => ({
      exportData: handleExport,
      openCommitModal: openConfirmModal,
      getStagedCount: () => stagedChanges.length,
    }));

    const promptNewDriver: DriverSlotInfo | null = selectedDriver
      ? {
          id: selectedDriver.id,
          name: selectedDriver.fullName || selectedDriver.name || "Unknown",
          code: formatDriverCode(selectedDriver.driverId || selectedDriver.employeeId || selectedDriver.id),
          shift: selectedDriver.shift || "",
          photoUrl: selectedDriver.profilePhotoUrl,
        }
      : null;

    return (
      <>
        {/* LEFT COLUMN: DRIVER ROSTER */}
        <div className="lg:col-span-4 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            <CardHeader className="p-3.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <UserCog className="w-4 h-4 text-blue-500" />
                  <span>Drivers Roster</span>
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                >
                  {filteredDrivers.length} Drivers
                </Badge>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name or ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-xs bg-white dark:bg-zinc-900/80 border-zinc-200 dark:border-zinc-700"
                />
              </div>

              {/* Status Filters */}
              <div className="flex items-center gap-1">
                {[
                  { key: "all", label: "All" },
                  { key: "assigned", label: "Assigned" },
                  { key: "reserved", label: "Reserved" },
                ].map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setStatusFilter(f.key)}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer",
                      statusFilter === f.key
                        ? "bg-blue-600 text-white shadow-xs"
                        : "bg-slate-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-foreground"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </CardHeader>

            {/* Scrollable Driver List */}
            <div className={cn(
              "flex-1 min-h-0 p-2.5",
              loading && drivers.length === 0
                ? "overflow-y-auto no-scrollbar space-y-2"
                : filteredDrivers.length === 0
                ? "flex flex-col items-center justify-center h-full"
                : "overflow-y-auto no-scrollbar space-y-2"
            )}>
              {loading && drivers.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="w-full h-16 rounded-xl bg-slate-100 dark:bg-zinc-800/50 animate-pulse border border-zinc-200 dark:border-zinc-800 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-zinc-700/60" />
                      <div className="space-y-1.5">
                        <div className="h-3 w-28 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                        <div className="h-2.5 w-16 bg-slate-200 dark:bg-zinc-700/60 rounded" />
                      </div>
                    </div>
                    <div className="h-4 w-16 bg-slate-200 dark:bg-zinc-700/60 rounded-md" />
                  </div>
                ))
              ) : filteredDrivers.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center my-auto p-6 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 text-muted-foreground flex items-center justify-center mb-1">
                    <Users className="h-6 w-6" />
                  </div>
                  <p className="text-xs font-bold text-foreground">No Drivers Match</p>
                  <p className="text-[11px] text-muted-foreground">Try adjusting search query or status filter.</p>
                </div>
              ) : (
                filteredDrivers.map((driver) => {
                  const mergedBusInfo = getMergedBusForDriver(driver);
                  const isSelected = selectedDriverId === driver.id;
                  const driverCode = formatDriverCode(driver.driverId || driver.employeeId || driver.id);

                  return (
                    <motion.div
                      key={driver.id}
                      onClick={() => handleDriverSelect(driver.id)}
                      className={cn(
                        "p-3 px-3.5 rounded-xl cursor-pointer transition-all border text-left",
                        isSelected
                          ? "bg-blue-500/10 dark:bg-blue-950/30 border-blue-500 shadow-sm ring-1 ring-blue-500/30"
                          : "bg-white dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-800/70"
                      )}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar src={driver.profilePhotoUrl} name={driver.fullName || driver.name} size="sm" />
                          <div className="min-w-0">
                            <p
                              className={cn(
                                "font-bold text-xs truncate",
                                isSelected ? "text-blue-600 dark:text-blue-400" : "text-foreground"
                              )}
                            >
                              {driver.fullName || driver.name || "Unknown"}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono">{driverCode}</p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {mergedBusInfo.bus ? (
                            <Badge
                              className={cn(
                                "text-[9px] px-1.5 py-0 border-none font-mono",
                                mergedBusInfo.isStaged
                                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold"
                                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              )}
                            >
                              <Bus className="w-2.5 h-2.5 mr-1 inline" />
                              {mergedBusInfo.stagedBusNumber || mergedBusInfo.bus.busNumber}
                            </Badge>
                          ) : (
                            <Badge
                              className={cn(
                                "text-[9px] px-1.5 py-0 border-none",
                                mergedBusInfo.isStaged
                                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold"
                                  : "bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                              )}
                            >
                              Reserved
                            </Badge>
                          )}
                          {driver.shift && (
                            <span className="text-[9px] text-muted-foreground">{driver.shift}</span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN: BUS SELECTION & STAGING */}
        <div className="lg:col-span-8 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            <CardHeader className="p-3.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-600/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    <Bus className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">
                      {selectedDriver
                        ? `Assign ${selectedDriver.fullName || selectedDriver.name} to:`
                        : "Operational Fleet Buses"}
                    </h3>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">
                      {selectedDriver
                        ? "Click an available bus to select a shift slot and stage assignment"
                        : "Select a driver from the roster to start assigning"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {selectedDriver && (
                    <Button
                      size="sm"
                      onClick={handleMakeReserved}
                      className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold px-2.5 gap-1 shadow-xs cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                      <span>Make Reserved</span>
                    </Button>
                  )}
                  <div className="relative w-36 sm:w-44">
                    <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                    <Input
                      placeholder="Filter buses..."
                      value={busSearchTerm}
                      onChange={(e) => setBusSearchTerm(e.target.value)}
                      className="pl-7 h-7 text-xs bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>

            {/* Scrollable Bus Content */}
            <div
              className={cn(
                "flex-1 min-h-0 p-3",
                selectedDriver ? "overflow-y-auto no-scrollbar space-y-3" : "flex flex-col items-center justify-center h-full"
              )}
              ref={busesScrollRef}
            >
              {selectedDriver ? (
                <>
                  {/* Currently Assigned Card if assigned */}
                  {selectedDriverBus && (
                    <div className="p-2.5 rounded-xl border border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-blue-600 text-white text-[9px] px-1.5 py-0">Current</Badge>
                          <span className="font-bold text-foreground">{selectedDriverBus.busNumber}</span>
                          <span className="text-muted-foreground text-[11px]">
                            {getRouteForBus(selectedDriverBus)?.routeName || "No Route"}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          Cap: {selectedDriverBus.currentMembers || 0}/{selectedDriverBus.capacity || 0}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Available Buses Grid */}
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Available Buses ({sortedBuses.length})
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {sortedBuses
                        .filter((bus) => bus.id !== selectedDriverBus?.id)
                        .map((bus) => {
                          const hasActiveTrip = !!bus.activeTripId;
                          const mergedDriverInfo = getMergedDriverForBus(bus);
                          const route = getRouteForBus(bus);
                          const displayedDriver = mergedDriverInfo.driver;
                          const displayedDriverName =
                            mergedDriverInfo.stagedDriverName || displayedDriver?.fullName || displayedDriver?.name;
                          const busShift = normalizeShift(bus.shift);

                          return (
                            <motion.div
                              key={bus.id}
                              whileHover={!hasActiveTrip ? { scale: 1.01 } : {}}
                              whileTap={!hasActiveTrip ? { scale: 0.99 } : {}}
                              onClick={() => !hasActiveTrip && handleBusSelect(bus)}
                              className={cn(
                                "p-3 rounded-xl border transition-all cursor-pointer relative text-left",
                                hasActiveTrip
                                  ? "opacity-50 cursor-not-allowed bg-slate-50 dark:bg-zinc-800/30 border-red-500/30"
                                  : mergedDriverInfo.isStaged
                                  ? "border-amber-500/60 bg-amber-500/5 dark:bg-amber-950/20 shadow-xs"
                                  : "bg-white dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800/80 hover:border-blue-500/40 hover:bg-slate-50 dark:hover:bg-zinc-800/70"
                              )}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2.5">
                                  <div
                                    className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold",
                                      hasActiveTrip
                                        ? "bg-red-500"
                                        : displayedDriver
                                        ? mergedDriverInfo.isStaged
                                          ? "bg-amber-500"
                                          : "bg-indigo-600"
                                        : "bg-emerald-600"
                                    )}
                                  >
                                    <Bus className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <p className="font-bold text-xs text-foreground">{bus.busNumber}</p>
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                      <MapPin className="w-2.5 h-2.5 text-blue-500" />
                                      <span className="truncate max-w-[130px]">
                                        {route?.routeName || bus.routeName || "No Route"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-1">
                                  {hasActiveTrip ? (
                                    <Badge className="bg-red-500 text-white text-[8px] h-4">IN TRIP</Badge>
                                  ) : displayedDriver ? (
                                    <Badge
                                      className={cn(
                                        "text-[8px] h-4 border-none",
                                        mergedDriverInfo.isStaged
                                          ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold"
                                          : "bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
                                      )}
                                    >
                                      {mergedDriverInfo.isStaged ? "STAGED" : "OCCUPIED"}
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[8px] h-4 border-none">
                                      AVAILABLE
                                    </Badge>
                                  )}
                                  <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                                    <Clock className="w-2.5 h-2.5" />
                                    {busShift}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-[10px]">
                                <div className="flex items-center gap-1 text-muted-foreground truncate max-w-[150px]">
                                  <User className="w-3 h-3 text-blue-500" />
                                  <span className="truncate">{displayedDriverName || "No driver"}</span>
                                </div>
                                <span className="font-mono text-muted-foreground">
                                  {bus.currentMembers || 0}/{bus.capacity || 0}
                                </span>
                              </div>
                            </motion.div>
                          );
                        })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-center space-y-2.5 my-auto max-w-sm">
                  <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center mb-1">
                    <ArrowRightLeft className="w-7 h-7" />
                  </div>
                  <h4 className="text-base font-bold text-foreground">Select a Driver to Assign</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Choose any driver from the left roster to view current route status and stage a new bus or shift
                    assignment.
                  </p>
                </div>
              )}
            </div>

            {/* DOCKED STAGING FOOTER BAR */}
            {stagedChanges.length > 0 && (
              <div className="p-2.5 px-3 border-t border-zinc-200 dark:border-zinc-800 bg-amber-500/5 dark:bg-amber-950/20 shrink-0 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-amber-500 text-black font-bold text-[10px] px-1.5 py-0.5">
                    {stagedChanges.length} Staged
                  </Badge>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    Pending driver assignment updates ready for commit
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
                    className="h-7 text-xs bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold px-3 shadow-xs cursor-pointer gap-1"
                  >
                    <Zap className="w-3 h-3" />
                    <span>Review & Commit ({stagedChanges.length})</span>
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Modals & Dialogs */}
        {promptNewDriver && slotPromptBus && (
          <ShiftSlotPrompt
            isOpen={showSlotPrompt}
            onClose={() => {
              setShowSlotPrompt(false);
              setSlotPromptBus(null);
            }}
            onStage={handleSlotStage}
            busId={slotPromptBus.id}
            busNumber={slotPromptBus.busNumber}
            busShift={normalizeShift(slotPromptBus.shift)}
            routeName={getRouteForBus(slotPromptBus)?.routeName || slotPromptBus.routeName}
            existingDrivers={getDriversForBusSlots(slotPromptBus, drivers)}
            newDriver={promptNewDriver}
          />
        )}

        <DriverConfirmationModal
          isOpen={showConfirmModal}
          onClose={() => {
            setShowConfirmModal(false);
            setNetAssignmentResult(null);
          }}
          onFinalConfirm={handleFinalizeInitiate}
          onRevert={handleRevert}
          confirmationRows={netAssignmentResult?.confirmationRows || []}
          driverCount={netAssignmentResult?.driverFinalState.size || 0}
          hasNoNetChanges={!netAssignmentResult?.hasChanges}
          removedNoOpCount={netAssignmentResult?.removedNoOpCount || 0}
          removedNoOpInfo={netAssignmentResult?.removedNoOpInfo || []}
          processing={processing}
        />

        <AssignmentFinalizeCard
          isVisible={showFinalizeCard}
          count={netAssignmentResult?.driverFinalState.size || 0}
          entityType="driver"
          onConfirm={performCommit}
          onRevert={handleRevert}
          processing={processing}
          timerDuration={120}
        />
      </>
    );
  }
);
