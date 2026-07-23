"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";


import { useAuth } from "@/contexts/auth-context";
import { toast } from "react-hot-toast";
import { trackEvent } from "@/components/Analytics";
import {
    Bus,
    Users,
    Search,
    ArrowRightLeft,
    User,
    MapPin,
    UserCog,
    History,
    Clock,
    Bookmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import {
    TooltipProvider,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { normalizeShift } from "@/lib/utils/shift-utils";
import { motion, AnimatePresence } from "framer-motion";
import Avatar from "@/components/Avatar";

// Assignment components and services
import { DriverConfirmationModal } from "@/components/assignment/DriverConfirmationModal";
import { AssignmentFinalizeCard } from "@/components/assignment/AssignmentFinalizeCard";
import { ReassignmentHistoryModal } from "@/components/assignment/ReassignmentHistoryModal";
import { ShiftSlotPrompt, type ShiftSlotPayload, type DriverSlotInfo } from "@/components/assignment/ShiftSlotPrompt";
import { DriverStagingAreaV2, type StagedDriverChange } from "@/components/assignment/DriverStagingAreaV2";
import {
    formatDriverCode,
    getDriverStatus,
    type StagedDriverAssignment,
} from "@/lib/services/assignment-service";
import {
    computeNetAssignments,
    validateStagingPreCheck,
    type StagedOperation,
    type DbSnapshot,
    type ComputeNetAssignmentsResult,
} from "@/lib/services/net-assignment-service";

// ============================================
// DESIGN TOKENS
// ============================================
const tokens = {
    primaryPurple: "#9333EA",
    primaryPink: "#DB2777",
    primaryOrange: "#F97316",
    deepPurple: "#6B46C1",
    darkBg: "#020617",
    cardBg: "#0B1222",
    cardHeader: "linear-gradient(to right, rgba(147, 51, 234, 0.1), rgba(219, 39, 119, 0.1))",
    success: "#10B981",
    reserved: "#F59E0B",
    occupied: "#F59E0B",
    textPrimary: "#F8FAFC",
    textMuted: "#94A3B8",
    borderDark: "#1E293B",
};

// ============================================
// TYPES
// ============================================

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

// ============================================
// HELPER: Get drivers assigned to bus slots
// ============================================
function getDriversForBusSlots(bus: BusData, drivers: DriverData[]): DriverSlotInfo[] {
    const result: DriverSlotInfo[] = [];

    // Check bus's assignedDriverId / activeDriverId
    const driverIds = new Set<string>();
    if (bus.assignedDriverId) driverIds.add(bus.assignedDriverId);
    if (bus.activeDriverId && bus.activeDriverId !== bus.assignedDriverId) driverIds.add(bus.activeDriverId);

    // Also check drivers who reference this bus
    drivers.forEach(d => {
        const dBusId = d.busId || d.busId;
        if (dBusId === bus.id || dBusId === bus.busId) {
            driverIds.add(d.id);
        }
    });

    driverIds.forEach(dId => {
        const driver = drivers.find(d => d.id === dId);
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

// ============================================
// MAIN COMPONENT
// ============================================

export default function SmartDriverAssignmentPage() {
    const { currentUser, userData, loading: authLoading } = useAuth();
    const router = useRouter();
    const busesScrollRef = useRef<HTMLDivElement>(null);

    // Core Data State
    const [drivers, setDrivers] = useState<DriverData[]>([]);
    const [buses, setBuses] = useState<BusData[]>([]);
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [loading, setLoading] = useState(true);

    // Selection State
    const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

    // Staging State (new V2 system)
    const [stagedChanges, setStagedChanges] = useState<StagedDriverChange[]>([]);

    // Legacy staging for commit compatibility
    const [stagedAssignments, setStagedAssignments] = useState<StagedDriverAssignment[]>([]);

    // UI State
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    // Confirmation Modal State
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showFinalizeCard, setShowFinalizeCard] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [netAssignmentResult, setNetAssignmentResult] = useState<ComputeNetAssignmentsResult | null>(null);

    // Shift Slot Prompt State
    const [showSlotPrompt, setShowSlotPrompt] = useState(false);
    const [slotPromptBus, setSlotPromptBus] = useState<BusData | null>(null);

    // History Modal State
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // ============================================
    // PERMISSION CHECK
    // ============================================

    useEffect(() => {
        if (authLoading) return;
        if (!currentUser || (userData?.role !== "admin" && userData?.role !== "moderator")) {
            router.push("/login");
        }
    }, [currentUser, userData, authLoading, router]);

    // ============================================
    // DATA LOADING (getDocs - one-time read, Spark-safe)
    // PERF: Session-cached to avoid re-fetch on back-navigation
    // ============================================

    const ASSIGN_CACHE_KEY = 'adtu_driver_assignment_cache';
    const ASSIGN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    const fetchAllData = useCallback(async (skipCache = false) => {
        if (!currentUser) return;

        // Try cache first
        if (!skipCache) {
            try {
                const raw = sessionStorage.getItem(ASSIGN_CACHE_KEY);
                if (raw) {
                    const { data, expires } = JSON.parse(raw);
                    if (Date.now() < expires) {
                        setDrivers(data.drivers);
                        setBuses(data.buses);
                        setRoutes(data.routes);
                        setLoading(false);
                        return;
                    }
                    sessionStorage.removeItem(ASSIGN_CACHE_KEY);
                }
            } catch { }
        }

        setLoading(true);
        try {


            const [driversRes, busesRes, routesRes] = await Promise.all([
                fetch('/api/drivers'),
                fetch('/api/buses'),
                fetch('/api/routes'),
            ]);

            const driversJson = await driversRes.json();
            const driversData = (Array.isArray(driversJson) ? driversJson : driversJson.drivers || []).map((d: any) => ({ id: d.id || d.uid, ...d })) as DriverData[];
            const busesJson = await busesRes.json();
            const busesData = (busesJson.buses || []).map((b: any) => ({ ...b, id: b.busId || b.id })) as BusData[];
            const routesJson = await routesRes.json();
            const routesData = (Array.isArray(routesJson) ? routesJson : routesJson.routes || []).map((r: any) => ({ id: r.id || r.routeId, ...r })) as RouteData[];

            setDrivers(driversData);
            setBuses(busesData);
            setRoutes(routesData);

            // Cache for back-navigation
            try {
                sessionStorage.setItem(ASSIGN_CACHE_KEY, JSON.stringify({
                    data: { drivers: driversData, buses: busesData, routes: routesData },
                    expires: Date.now() + ASSIGN_CACHE_TTL,
                }));
            } catch { }
        } catch (error: any) {
            console.error("Error loading data:", error);
            toast.error("Failed to load data. Please refresh.");
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => { fetchAllData(); }, [fetchAllData]);

    // ============================================
    // COMPUTED VALUES
    // ============================================

    const filteredDrivers = useMemo(() => {
        return drivers
            .filter(driver => {
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

    const selectedDriver = useMemo(() =>
        selectedDriverId ? drivers.find(d => d.id === selectedDriverId) || null : null
        , [selectedDriverId, drivers]);

    const getBusForDriver = useCallback((driver: DriverData): BusData | null => {
        const busId = driver.busId || driver.busId;
        if (!busId) return null;
        return buses.find(b => b.id === busId || b.busId === busId) || null;
    }, [buses]);

    const getRouteForBus = useCallback((bus: BusData): RouteData | null => {
        if (!bus.routeId) return null;
        return routes.find(r => r.id === bus.routeId || r.routeId === bus.routeId) || null;
    }, [routes]);

    const getDriverForBus = useCallback((bus: BusData): DriverData | null => {
        const driverId = bus.activeDriverId || bus.assignedDriverId;
        if (driverId) {
            const driver = drivers.find(d => d.id === driverId);
            if (driver) return driver;
        }
        return drivers.find(d => d.busId === bus.id || d.busId === bus.id) || null;
    }, [drivers]);

    const selectedDriverBus = useMemo(() =>
        selectedDriver ? getBusForDriver(selectedDriver) : null
        , [selectedDriver, getBusForDriver]);

    const sortedBuses = useMemo(() => {
        if (!selectedDriverBus) return buses;
        return [...buses].sort((a, b) => {
            if (a.id === selectedDriverBus.id) return -1;
            if (b.id === selectedDriverBus.id) return 1;
            return 0;
        });
    }, [buses, selectedDriverBus]);

    // ============================================
    // MERGED STATE (considering staging)
    // ============================================

    const getMergedBusForDriver = useCallback((driver: DriverData): {
        bus: BusData | null; isStaged: boolean; isReserved: boolean; stagedBusNumber?: string
    } => {
        // Check if driver is assigned in staging
        const asNewDriver = stagedChanges.find(s =>
            s.newDriver.id === driver.id && s.action !== "make_reserved"
        );
        if (asNewDriver) {
            const stagedBus = buses.find(b => b.id === asNewDriver.busId);
            return { bus: stagedBus || null, isStaged: true, isReserved: false, stagedBusNumber: asNewDriver.busNumber };
        }

        // Check if driver is being displaced (reserved or split)
        const asDisplaced = stagedChanges.find(s =>
            s.oldDrivers.some(od => od.id === driver.id && (od.impact === "reserved" || od.impact === "split"))
        );
        if (asDisplaced) return { bus: null, isStaged: true, isReserved: true };

        // Check if driver is being made reserved explicitly
        const asMakeReserved = stagedChanges.find(s =>
            s.action === "make_reserved" && s.newDriver.id === driver.id
        );
        if (asMakeReserved) return { bus: null, isStaged: true, isReserved: true };

        // Check if driver is being swapped to another bus
        const asSwapped = stagedChanges.find(s =>
            s.oldDrivers.some(od => od.id === driver.id && od.impact === "swapped")
        );
        if (asSwapped) {
            // Swapped driver goes to the new driver's old bus
            const newDriverOldBus = getBusForDriver({ id: asSwapped.newDriver.id } as DriverData);
            return { bus: newDriverOldBus || null, isStaged: true, isReserved: false };
        }

        // No staging affects this driver
        const liveBus = getBusForDriver(driver);
        return { bus: liveBus, isStaged: false, isReserved: !liveBus };
    }, [stagedChanges, buses, getBusForDriver]);

    const getMergedDriverForBus = useCallback((bus: BusData): {
        driver: DriverData | null; isStaged: boolean; stagedDriverName?: string
    } => {
        // Check if a new driver is staged to this bus
        const stagedToBus = stagedChanges.find(s => s.busId === bus.id && s.action !== "make_reserved");
        if (stagedToBus) {
            const newDriver = drivers.find(d => d.id === stagedToBus.newDriver.id);
            return { driver: newDriver || null, isStaged: true, stagedDriverName: stagedToBus.newDriver.name };
        }

        // Check if the current driver is being moved away
        const liveDriver = getDriverForBus(bus);
        if (liveDriver) {
            const driverBeingMoved = stagedChanges.find(s =>
                s.newDriver.id === liveDriver.id && s.busId !== bus.id
            );
            if (driverBeingMoved) return { driver: null, isStaged: true };

            const driverDisplaced = stagedChanges.find(s =>
                s.oldDrivers.some(od => od.id === liveDriver.id && (od.impact === "reserved" || od.impact === "split"))
            );
            if (driverDisplaced) return { driver: null, isStaged: true };

            const driverMadeReserved = stagedChanges.find(s =>
                s.action === "make_reserved" && s.newDriver.id === liveDriver.id
            );
            if (driverMadeReserved) return { driver: null, isStaged: true };
        }

        return { driver: liveDriver, isStaged: false };
    }, [stagedChanges, drivers, getDriverForBus]);

    // ============================================
    // HANDLERS
    // ============================================

    const handleDriverSelect = (driverId: string) => {
        setSelectedDriverId(prev => prev === driverId ? null : driverId);
        if (busesScrollRef.current) {
            busesScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const handleMakeReserved = () => {
        if (!selectedDriverId) {
            toast.error("No driver selected");
            return;
        }
        const driver = drivers.find(d => d.id === selectedDriverId);
        if (!driver) return;

        const currentBus = getBusForDriver(driver);
        const driverCode = formatDriverCode(driver.driverId || driver.employeeId || driver.id);

        // Check if already staged
        const existingIdx = stagedChanges.findIndex(s =>
            s.newDriver.id === driver.id || s.oldDrivers.some(od => od.id === driver.id)
        );

        const change: StagedDriverChange = {
            id: `stg-${Date.now()}-${typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID().substring(0, 6) : Math.random().toString(36).slice(2, 8)}`,
            busId: currentBus?.id || "",
            busNumber: currentBus?.busNumber || "N/A",
            busShift: currentBus ? normalizeShift(currentBus.shift) : "Both",
            action: "make_reserved",
            newDriver: {
                id: driver.id,
                name: driver.fullName || driver.name || "Unknown",
                code: driverCode,
                shift: driver.shift || "",
            },
            oldDrivers: [],
            targetSlot: "Both",
            status: "pending",
        };

        if (existingIdx >= 0) {
            const updated = [...stagedChanges];
            updated[existingIdx] = change;
            setStagedChanges(updated);
        } else {
            setStagedChanges(prev => [...prev, change]);
        }
        toast.success(`${driver.fullName || driver.name} staged as Reserved`);
    };

    // CENTRALIZED RESOLVER: When a bus card is clicked
    const handleBusSelect = (bus: BusData) => {
        if (!selectedDriverId) {
            toast.error("Please select a driver first");
            return;
        }
        if (bus.activeTripId) {
            toast.error(`Bus ${bus.busNumber} has an active trip. Cannot assign.`);
            return;
        }

        const driver = drivers.find(d => d.id === selectedDriverId);
        if (!driver) return;

        // Check if selected driver is already assigned to this bus
        const mergedBusInfo = getMergedBusForDriver(driver);
        if (mergedBusInfo.bus?.id === bus.id) {
            toast("This bus is already assigned to the selected driver", { icon: "ℹ️" });
            return;
        }

        // Open the ShiftSlotPrompt with bus context
        setSlotPromptBus(bus);
        setShowSlotPrompt(true);
    };

    // Handle ShiftSlotPrompt result
    const handleSlotStage = (payload: ShiftSlotPayload) => {
        const driver = drivers.find(d => d.id === payload.newDriver.id);
        if (!driver) return;

        const driverCode = formatDriverCode(driver.driverId || driver.employeeId || driver.id);

        const change: StagedDriverChange = {
            id: `stg-${Date.now()}-${typeof window !== 'undefined' && window.crypto?.randomUUID ? window.crypto.randomUUID().substring(0, 6) : Math.random().toString(36).slice(2, 8)}`,
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

        // Replace existing staging for this driver if any
        const existingIdx = stagedChanges.findIndex(s =>
            s.newDriver.id === driver.id
        );
        if (existingIdx >= 0) {
            const updated = [...stagedChanges];
            updated[existingIdx] = change;
            setStagedChanges(updated);
        } else {
            setStagedChanges(prev => [...prev, change]);
        }

        toast.success(`Staged: ${driver.fullName || driver.name} → ${payload.busNumber} (${payload.targetSlot})`);
        setSelectedDriverId(null);
    };

    const removeFromStaging = (id: string) => {
        setStagedChanges(prev => prev.filter(s => s.id !== id));
        toast.success("Removed from staging");
    };

    const clearAllStaging = () => {
        setStagedChanges([]);
        toast.success("All staged changes cleared");
    };

    // ============================================
    // CONFIRMATION FLOW (bridge to existing commit system)
    // ============================================

    const openConfirmModal = () => {
        if (stagedChanges.length === 0) {
            toast.error("No changes to confirm");
            return;
        }

        // Convert StagedDriverChange[] to StagedDriverAssignment[] for compatibility
        const legacyAssignments: StagedDriverAssignment[] = stagedChanges.map(change => {
            const currentBus = change.action !== "make_reserved"
                ? getBusForDriver({ id: change.newDriver.id } as DriverData)
                : null;

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
                affectOnPreviousOperator: change.action === "swap" ? "swapped"
                    : change.action === "split" ? "reserved"
                    : change.oldDrivers.length > 0 ? "reserved" : "none",
                swappedToBusId: change.action === "swap" ? (currentBus?.id || null) : null,
                swappedToBusNumber: change.action === "swap" ? (currentBus?.busNumber || null) : null,
                driverPreviousState: currentBus ? "assigned" : "reserved",
                status: "pending",
            } as StagedDriverAssignment;
        });

        setStagedAssignments(legacyAssignments);

        // Build DB snapshot
        const dbSnapshot: DbSnapshot = {
            drivers: drivers.map(d => ({
                id: d.id,
                name: d.fullName || d.name || "Unknown",
                employeeId: d.driverId || d.employeeId || d.id,
                busId: d.busId || d.busId || null,
                isReserved: d.isReserved || (!d.busId && !d.busId),
            })),
            buses: buses.map(b => ({
                id: b.id,
                busNumber: b.busNumber,
                registrationNumber: b.busNumber,
                assignedDriverId: b.assignedDriverId || null,
                activeDriverId: b.activeDriverId || null,
                routeId: b.routeId || null,
            })),
        };

        // Convert to StagedOperation for net computation
        const stagedOps: StagedOperation[] = legacyAssignments.map((s, i) => {
            let type: "assign" | "swap" | "markReserved" = "assign";
            if (s.affectOnPreviousOperator === "swapped") type = "swap";
            if (s.newBusNumber === "Reserved") type = "markReserved";

            return {
                id: s.id, type,
                driverId: s.driverId, driverName: s.driverName, driverCode: s.driverCode,
                busId: s.newBusId || null, busNumber: s.newBusNumber,
                swapDriverId: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorId : null,
                swapDriverName: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorName : null,
                stagedAt: Date.now() + i,
                oldBusNumber: s.oldBusNumber,
            };
        });

        const result = computeNetAssignments(stagedOps, dbSnapshot);
        setNetAssignmentResult(result);

        const validation = validateStagingPreCheck(stagedOps, dbSnapshot);
        if (validation.warnings.length > 0) validation.warnings.forEach(w => toast(w, { icon: "⚠️" }));
        if (!validation.isValid) {
            validation.errors.forEach(e => toast.error(e));
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
        if (!currentUser?.uid) { toast.error("Not authenticated"); return; }
        if (!netAssignmentResult || !netAssignmentResult.hasChanges) {
            toast.success("No net changes to apply");
            setStagedChanges([]); setStagedAssignments([]);
            setShowFinalizeCard(false); setNetAssignmentResult(null);
            return;
        }

        setProcessing(true);
        try {
            const stagedOps: StagedOperation[] = stagedAssignments.map((s, i) => {
                let type: "assign" | "swap" | "markReserved" = "assign";
                if (s.affectOnPreviousOperator === "swapped") type = "swap";
                if (s.newBusNumber === "Reserved") type = "markReserved";
                return {
                    id: s.id, type,
                    driverId: s.driverId, driverName: s.driverName, driverCode: s.driverCode,
                    busId: s.newBusId || null, busNumber: s.newBusNumber,
                    swapDriverId: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorId : null,
                    swapDriverName: s.affectOnPreviousOperator === "swapped" ? s.previousOperatorName : null,
                    stagedAt: Date.now() + i,
                    oldBusNumber: s.oldBusNumber,
                };
            });

            const adminName = userData?.fullName || userData?.name || "Admin";
            const token = await currentUser.getIdToken();
            const response = await fetch('/api/fleet/assign-drivers', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
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
                trackEvent('driver_reassignment');
                toast.success(`✅ Successfully assigned ${result.updatedDrivers.length} driver(s)`);
                fetchAllData();
                setTimeout(() => {
                    setStagedChanges([]); setStagedAssignments([]);
                    setShowFinalizeCard(false); setNetAssignmentResult(null);
                }, 1000);
            } else {
                toast.error(result.conflictDetails ? `Conflict: ${result.conflictDetails}` : (result.message || "Failed to commit"));
            }
        } catch (error: any) {
            console.error("Commit error:", error);
            toast.error("Failed to commit assignments");
        } finally {
            setProcessing(false);
        }
    };

    // ============================================
    // RENDER: LOADING STATE
    // ============================================

    if (loading || authLoading) {
        return <PremiumPageLoader message="Loading driver assignment system..." subMessage="Configuring shift slots..." />;
    }

    // ============================================
    // Prepare ShiftSlotPrompt props
    // ============================================
    const promptNewDriver: DriverSlotInfo | null = selectedDriver ? {
        id: selectedDriver.id,
        name: selectedDriver.fullName || selectedDriver.name || "Unknown",
        code: formatDriverCode(selectedDriver.driverId || selectedDriver.employeeId || selectedDriver.id),
        shift: selectedDriver.shift || "",
        photoUrl: selectedDriver.profilePhotoUrl,
    } : null;

    const promptExistingDrivers: DriverSlotInfo[] = slotPromptBus
        ? getDriversForBusSlots(slotPromptBus, drivers)
            .filter(d => d.id !== selectedDriverId) // exclude self
        : [];

    // ============================================
    // RENDER: MAIN UI
    // ============================================

    return (
        <TooltipProvider>
            <div className="mt-20 sm:mt-8 space-y-6 px-2 sm:px-4 ml-0">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 flex-shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg bg-gradient-to-br from-purple-500 to-pink-500">
                            <UserCog className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <motion.h1
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-500 bg-clip-text text-transparent"
                            >
                                Smart Driver Assignment
                            </motion.h1>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Shift-aware driver reassignment with staging workflow
                            </p>
                        </div>
                    </div>
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

                {/* Main Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch w-full">

                    {/* Left Panel - Driver List */}
                    <div
                        className="lg:col-span-4 rounded-2xl border overflow-hidden flex flex-col h-[465px]"
                        style={{ backgroundColor: '#0F172A', borderColor: tokens.borderDark }}
                    >
                        {/* Header */}
                        <div className="px-4 py-3 rounded-t-2xl flex-shrink-0"
                            style={{ background: 'linear-gradient(to right, rgba(147, 51, 234, 0.08), rgba(219, 39, 119, 0.08))' }}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500">
                                        <Users className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold" style={{ color: tokens.textPrimary }}>Drivers</h3>
                                        <p className="text-xs" style={{ color: tokens.textMuted }}>Sorted by Driver ID</p>
                                    </div>
                                </div>
                                <Badge className="text-xs" style={{ backgroundColor: `${tokens.success}20`, color: tokens.success }}>
                                    {filteredDrivers.length} shown
                                </Badge>
                            </div>
                        </div>

                        {/* Search */}
                        <div className="px-3 pt-3 pb-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5" style={{ color: tokens.textMuted }} />
                                <Input
                                    placeholder="Search drivers..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-8 h-8 text-xs border-0 w-full"
                                    style={{ backgroundColor: '#1E293B', color: tokens.textPrimary }}
                                />
                            </div>
                        </div>

                        <ScrollArea className="flex-1">
                            <div className="px-3 pb-3 space-y-2">
                                {filteredDrivers.map(driver => {
                                    const mergedBusInfo = getMergedBusForDriver(driver);
                                    const isSelected = selectedDriverId === driver.id;
                                    const driverCode = formatDriverCode(driver.driverId || driver.employeeId || driver.id);

                                    return (
                                        <motion.div
                                            key={driver.id}
                                            onClick={() => handleDriverSelect(driver.id)}
                                            className={cn(
                                                "h-20 p-3 rounded-xl cursor-pointer transition-all duration-200 border",
                                                isSelected ? "border-opacity-100 shadow-md" : "border-transparent hover:border-opacity-30"
                                            )}
                                            style={{
                                                backgroundColor: isSelected ? `${tokens.primaryPurple}15` : '#131C2E',
                                                borderColor: isSelected ? tokens.primaryPurple : tokens.borderDark,
                                            }}
                                            whileHover={{ scale: 1.01 }}
                                            whileTap={{ scale: 0.99 }}
                                        >
                                            <div className="flex items-center justify-between h-full">
                                                <div className="flex items-center gap-3">
                                                    <Avatar src={driver.profilePhotoUrl} name={driver.fullName || driver.name} size="sm" />
                                                    <div>
                                                        <p className="font-medium text-sm" style={{ color: tokens.textPrimary }}>
                                                            {driver.fullName || driver.name || "Unknown"}
                                                        </p>
                                                        <p className="text-xs" style={{ color: tokens.textMuted }}>{driverCode}</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    {mergedBusInfo.bus ? (
                                                        <Badge className="text-[9px] px-1.5 py-0" style={{
                                                            backgroundColor: mergedBusInfo.isStaged ? `${tokens.primaryOrange}20` : `${tokens.success}20`,
                                                            color: mergedBusInfo.isStaged ? tokens.primaryOrange : tokens.success,
                                                            border: `1px solid ${mergedBusInfo.isStaged ? tokens.primaryOrange : tokens.success}40`
                                                        }}>
                                                            <Bus className="w-2.5 h-2.5 mr-1" />
                                                            {mergedBusInfo.stagedBusNumber || mergedBusInfo.bus.busNumber}
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="text-[9px] px-1.5 py-0" style={{
                                                            backgroundColor: mergedBusInfo.isStaged ? `${tokens.primaryOrange}20` : `${tokens.reserved}20`,
                                                            color: mergedBusInfo.isStaged ? tokens.primaryOrange : tokens.reserved,
                                                            border: `1px solid ${mergedBusInfo.isStaged ? tokens.primaryOrange : tokens.reserved}40`
                                                        }}>
                                                            Reserved
                                                        </Badge>
                                                    )}
                                                    {driver.shift && (
                                                        <span className="text-[9px]" style={{ color: tokens.textMuted }}>{driver.shift}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                                {filteredDrivers.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <Users className="h-12 w-12 mb-3" style={{ color: tokens.textMuted }} />
                                        <p className="text-sm" style={{ color: tokens.textMuted }}>No drivers found</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Right Panel - Bus Selection */}
                    <div
                        className="lg:col-span-8 rounded-2xl border overflow-hidden flex flex-col h-[465px]"
                        style={{ backgroundColor: tokens.cardBg, borderColor: tokens.borderDark }}
                    >
                        {/* Header */}
                        <div className="px-4 py-3 rounded-t-2xl flex-shrink-0" style={{ background: tokens.cardHeader }}>
                            <div className="flex items-center justify-between pt-3 pb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-500">
                                        <Bus className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold" style={{ color: tokens.textPrimary }}>
                                            {selectedDriver
                                                ? `Assign ${selectedDriver.fullName || selectedDriver.name} to:`
                                                : "Buses"}
                                        </h3>
                                        <p className="text-xs" style={{ color: tokens.textMuted }}>
                                            {selectedDriver
                                                ? "Select a bus below to configure shift & stage assignment"
                                                : "Select a driver from the left panel first"}
                                        </p>
                                    </div>
                                </div>
                                {selectedDriverId ? (
                                    <Button
                                        size="sm"
                                        className="h-8 text-xs text-white px-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 transition-all active:scale-95"
                                        onClick={handleMakeReserved}
                                    >
                                        Make Reserved
                                    </Button>
                                ) : (
                                    <Badge className="text-xs" style={{
                                        backgroundColor: `${tokens.primaryPurple}20`,
                                        color: tokens.primaryPurple,
                                        border: `1px solid ${tokens.primaryPurple}40`
                                    }}>
                                        {buses.length} Buses
                                    </Badge>
                                )}
                            </div>
                        </div>

                        {/* Bus Content */}
                        <ScrollArea className="flex-1" ref={busesScrollRef}>
                            {selectedDriverId && selectedDriver ? (
                                <div className="p-3 space-y-4">
                                    {/* Currently Assigned */}
                                    {selectedDriverBus && (
                                        <div>
                                            <p className="text-xs font-medium mb-2 px-1" style={{ color: tokens.textMuted }}>Currently Assigned</p>
                                            <CurrentAssignmentCard bus={selectedDriverBus} route={getRouteForBus(selectedDriverBus)} driver={selectedDriver} />
                                        </div>
                                    )}

                                    {/* Available Buses */}
                                    <div>
                                        <p className="text-xs font-medium mb-2 px-1" style={{ color: tokens.textMuted }}>Available Buses</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {sortedBuses
                                                .filter(bus => bus.id !== selectedDriverBus?.id)
                                                .map(bus => {
                                                    const hasActiveTrip = !!bus.activeTripId;
                                                    const mergedDriverInfo = getMergedDriverForBus(bus);
                                                    const route = getRouteForBus(bus);
                                                    const displayedDriver = mergedDriverInfo.driver;
                                                    const displayedDriverName = mergedDriverInfo.stagedDriverName || displayedDriver?.fullName || displayedDriver?.name;
                                                    const busShift = normalizeShift(bus.shift);

                                                    return (
                                                        <motion.div
                                                            key={bus.id}
                                                            whileHover={!hasActiveTrip ? { scale: 1.02, backgroundColor: '#1E293B' } : {}}
                                                            whileTap={!hasActiveTrip ? { scale: 0.98 } : {}}
                                                            onClick={() => !hasActiveTrip && handleBusSelect(bus)}
                                                            className={cn(
                                                                "min-h-[120px] p-4 rounded-xl border cursor-pointer transition-all duration-300 relative overflow-hidden group",
                                                                hasActiveTrip && "opacity-50 cursor-not-allowed",
                                                                mergedDriverInfo.isStaged && "ring-2 ring-orange-500/30"
                                                            )}
                                                            style={{
                                                                backgroundColor: '#131C2E',
                                                                borderColor: hasActiveTrip ? '#EF4444' : mergedDriverInfo.isStaged ? tokens.primaryOrange : tokens.borderDark,
                                                            }}
                                                        >
                                                            {!hasActiveTrip && (
                                                                <div className="absolute -inset-1 opacity-0 group-hover:opacity-10 transition-opacity duration-500 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 blur-xl" />
                                                            )}

                                                            <div className="flex items-start justify-between relative z-10">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110"
                                                                        style={{
                                                                            background: hasActiveTrip ? 'linear-gradient(135deg, #EF4444, #991B1B)'
                                                                                : displayedDriver
                                                                                    ? mergedDriverInfo.isStaged
                                                                                        ? 'linear-gradient(135deg, #F97316, #C2410C)'
                                                                                        : 'linear-gradient(135deg, #F59E0B, #B45309)'
                                                                                    : 'linear-gradient(135deg, #F97316, #EA580C)'
                                                                        }}>
                                                                        <Bus className="w-5 h-5 text-white" />
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-bold text-sm tracking-tight" style={{ color: tokens.textPrimary }}>{bus.busNumber}</p>
                                                                        <div className="flex items-center gap-1">
                                                                            <MapPin className="w-2.5 h-2.5" style={{ color: tokens.primaryOrange }} />
                                                                            <p className="text-[10px] font-medium" style={{ color: tokens.textMuted }}>
                                                                                {route?.routeName || bus.routeName || "No Route"}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="flex flex-col items-end gap-1.5">
                                                                    {hasActiveTrip ? (
                                                                        <Badge className="bg-red-500 text-white text-[9px] h-5">IN TRIP</Badge>
                                                                    ) : displayedDriver ? (
                                                                        <Badge className="text-[9px] h-5 border-none" style={{
                                                                            backgroundColor: mergedDriverInfo.isStaged ? `${tokens.primaryOrange}25` : `${tokens.occupied}25`,
                                                                            color: mergedDriverInfo.isStaged ? tokens.primaryOrange : tokens.occupied,
                                                                        }}>
                                                                            {mergedDriverInfo.isStaged ? "STAGED" : "OCCUPIED"}
                                                                        </Badge>
                                                                    ) : (
                                                                        <Badge className="text-[9px] h-5 border-none" style={{
                                                                            backgroundColor: `${tokens.success}25`,
                                                                            color: tokens.success,
                                                                        }}>AVAILABLE</Badge>
                                                                    )}
                                                                    {/* Shift badge */}
                                                                    <Badge className="text-[7px] px-1 py-0 border-none" style={{
                                                                        backgroundColor: `${tokens.primaryPurple}15`,
                                                                        color: tokens.primaryPurple,
                                                                    }}>
                                                                        <Clock className="w-2 h-2 mr-0.5" />
                                                                        {busShift}
                                                                    </Badge>
                                                                </div>
                                                            </div>

                                                            {/* Route stops preview */}
                                                            {route?.stops && route.stops.length > 0 && (
                                                                <div className="mt-3 py-1.5 px-3 rounded-lg bg-black/20 flex gap-2 items-center group-hover:bg-black/30 transition-colors duration-300">
                                                                    <span className="text-[10px] text-slate-400 font-bold truncate">
                                                                        {route.stops[0].name} — {route.stops[route.stops.length - 1].name}
                                                                    </span>
                                                                    <span className="text-[9px] text-slate-500 font-medium whitespace-nowrap ml-auto">
                                                                        ... Net {route.stops.length} stops
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Operator Info */}
                                                            <div className="mt-3 flex items-center justify-between relative z-10 border-t border-white/5 pt-2">
                                                                {displayedDriver ? (
                                                                    <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{
                                                                        color: mergedDriverInfo.isStaged ? tokens.primaryOrange : tokens.textMuted
                                                                    }}>
                                                                        <User className="w-3 h-3" />
                                                                        <span className="truncate max-w-[120px]">{displayedDriverName}</span>
                                                                        {mergedDriverInfo.isStaged && (
                                                                            <Badge className="text-[7px] p-0 px-1 bg-orange-500/20 text-orange-500 border-none scale-90">STG</Badge>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-[10px] text-slate-500 font-medium">No operator assigned</span>
                                                                )}
                                                                <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                                                    <div className="w-1.5 h-1.5 rounded-full" style={{
                                                                        backgroundColor: displayedDriver ? (mergedDriverInfo.isStaged ? tokens.primaryOrange : tokens.occupied) : tokens.success
                                                                    }} />
                                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                                                        Capacity: {bus.currentMembers || 0}/{bus.capacity || 0}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center p-6 mt-14">
                                    <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                                        style={{ backgroundColor: `${tokens.primaryOrange}15` }}>
                                        <ArrowRightLeft className="w-10 h-10" style={{ color: tokens.primaryOrange }} />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2" style={{ color: tokens.textPrimary }}>Select a Driver</h3>
                                    <p className="text-sm max-w-xs" style={{ color: tokens.textMuted }}>
                                        Choose a driver from the left panel to view their current assignment and stage a new one
                                    </p>
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                </div>

                {/* Staging Area V2 */}
                <div className="w-full">
                    <DriverStagingAreaV2
                        stagedChanges={stagedChanges}
                        onRemove={removeFromStaging}
                        onClearAll={clearAllStaging}
                        onConfirm={openConfirmModal}
                    />
                </div>

                {/* Shift Slot Prompt */}
                {promptNewDriver && slotPromptBus && (
                    <ShiftSlotPrompt
                        isOpen={showSlotPrompt}
                        onClose={() => { setShowSlotPrompt(false); setSlotPromptBus(null); }}
                        onStage={handleSlotStage}
                        busId={slotPromptBus.id}
                        busNumber={slotPromptBus.busNumber}
                        busShift={normalizeShift(slotPromptBus.shift)}
                        routeName={getRouteForBus(slotPromptBus)?.routeName || slotPromptBus.routeName}
                        newDriver={promptNewDriver}
                        existingDrivers={promptExistingDrivers}
                    />
                )}

                {/* Confirmation Modal */}
                <DriverConfirmationModal
                    isOpen={showConfirmModal}
                    onClose={() => { setShowConfirmModal(false); setNetAssignmentResult(null); }}
                    onFinalConfirm={handleFinalizeInitiate}
                    onRevert={handleRevert}
                    confirmationRows={netAssignmentResult?.confirmationRows || []}
                    driverCount={netAssignmentResult?.driverFinalState.size || 0}
                    hasNoNetChanges={!netAssignmentResult?.hasChanges}
                    removedNoOpCount={netAssignmentResult?.removedNoOpCount || 0}
                    removedNoOpInfo={netAssignmentResult?.removedNoOpInfo || []}
                    processing={processing}
                />

                {/* Floating Finalization Card */}
                <AssignmentFinalizeCard
                    isVisible={showFinalizeCard}
                    count={netAssignmentResult?.driverFinalState.size || 0}
                    entityType="driver"
                    onConfirm={performCommit}
                    onRevert={handleRevert}
                    processing={processing}
                    timerDuration={120}
                />

                {/* History Modal */}
                <ReassignmentHistoryModal
                    open={showHistoryModal}
                    onOpenChange={setShowHistoryModal}
                    defaultType="driver_reassignment"
                    onRefresh={fetchAllData}
                />
            </div>
        </TooltipProvider>
    );
}

// ============================================
// CURRENT ASSIGNMENT CARD COMPONENT
// ============================================

function CurrentAssignmentCard({ bus, route, driver }: { bus: BusData; route: RouteData | null; driver: DriverData }) {
    const busShift = normalizeShift(bus.shift);
    return (
        <div className="p-4 rounded-xl border" style={{ backgroundColor: `${tokens.success}10`, borderColor: `${tokens.success}50` }}>
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: tokens.success }}>
                        <Bus className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <p className="font-semibold text-base" style={{ color: tokens.textPrimary }}>{bus.busNumber}</p>
                        <p className="text-xs" style={{ color: tokens.textMuted }}>{route?.routeName || bus.routeName || "No Route"}</p>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <Badge className="text-xs" style={{ backgroundColor: tokens.success, color: 'white' }}>Current Assignment</Badge>
                    <Badge className="text-[8px] px-1 py-0 border-none" style={{
                        backgroundColor: `${tokens.primaryPurple}20`, color: tokens.primaryPurple
                    }}>
                        <Clock className="w-2 h-2 mr-0.5" />{busShift}
                    </Badge>
                </div>
            </div>

            {route?.stops && route.stops.length > 0 && (
                <div className="mb-3">
                    <p className="text-[10px] font-medium mb-1.5" style={{ color: tokens.textMuted }}>Route Stops</p>
                    <div className="flex flex-wrap gap-1.5">
                        {route.stops.slice(0, 6).map((stop, idx) => (
                            <Badge key={idx} variant="outline" className="text-[9px] px-2 py-0.5"
                                style={{ backgroundColor: `${tokens.success}15`, borderColor: `${tokens.success}30`, color: tokens.textPrimary }}>
                                <MapPin className="w-2.5 h-2.5 mr-1" style={{ color: tokens.success }} />
                                {stop.name}
                            </Badge>
                        ))}
                        {route.stops.length > 6 && (
                            <Badge variant="outline" className="text-[9px] px-2 py-0.5"
                                style={{ borderColor: tokens.borderDark, color: tokens.textMuted }}>
                                +{route.stops.length - 6} more
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2 text-xs pt-2 border-t"
                style={{ borderColor: `${tokens.success}30`, color: tokens.textMuted }}>
                <User className="w-3.5 h-3.5" />
                <span>Driver: <strong style={{ color: tokens.textPrimary }}>{driver.fullName || driver.name}</strong></span>
                {driver.shift && (
                    <Badge variant="outline" className="text-[9px] ml-2"
                        style={{ borderColor: tokens.borderDark, color: tokens.textMuted }}>
                        {driver.shift}
                    </Badge>
                )}
            </div>
        </div>
    );
}
