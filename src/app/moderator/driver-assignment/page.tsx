"use client";

import { useRouter } from "next/navigation";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";


import Avatar from "@/components/Avatar";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { PermissionDeniedCard } from "@/components/PermissionDeniedCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	TooltipProvider
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/auth-context";
import { useModeratorPermissions } from "@/hooks/useModeratorPermissions";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { cn } from "@/lib/utils";
import { AnimatePresence,motion } from "motion/react";
import {
	ArrowRightLeft,
	Bus,
	History,
	MapPin,
	Search,
	User,
	UserCog,
	Users
} from "lucide-react";
import { toast } from "react-hot-toast";

// Assignment components and services
import { AssignmentFinalizeCard } from "@/components/assignment/AssignmentFinalizeCard";
import { DriverConfirmationModal } from "@/components/assignment/DriverConfirmationModal";
import { ReassignmentHistoryModal } from "@/components/assignment/ReassignmentHistoryModal";
import { DriverStagingArea } from "@/components/assignment/StagingArea";
import {
	formatDriverCode,
	generateStagingId,
	getDriverStatus,
	type StagedDriverAssignment,
} from "@/lib/services/assignment-service";
import {
	computeNetAssignments,
	validateStagingPreCheck,
	type ComputeNetAssignmentsResult,
	type DbSnapshot,
	type StagedOperation
} from "@/lib/services/net-assignment-service";

// ============================================
// DESIGN TOKENS
// ============================================
const tokens = {
    primaryPurple: "#2563EB",
    primaryPink: "#4F46E5",
    primaryOrange: "#F97316",
    deepPurple: "#4338CA",
    darkBg: "#020617",
    cardBg: "#0B1222",
    cardHeader: "linear-gradient(to right, rgba(37, 99, 235, 0.08), rgba(79, 70, 229, 0.08))",
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

type ConflictChoice = "reserve" | "swap" | "cancel";

interface ConflictState {
    busId: string;
    existingDriverId: string;
    existingDriverName: string;
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function SmartDriverAssignmentPage() {
    const { currentUser, userData, loading: authLoading } = useAuth();
    const { canDriverReassign, loading: permsLoading } = useModeratorPermissions();
    const router = useRouter();

    // Refs
    const busesScrollRef = useRef<HTMLDivElement>(null);

    // Core Data State
    const [drivers, setDrivers] = useState<DriverData[]>([]);
    const [buses, setBuses] = useState<BusData[]>([]);
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [loading, setLoading] = useState(true);

    // Selection State - support multi-select
    const [selectedDriverIds, setSelectedDriverIds] = useState<Set<string>>(new Set());
    const [lastSelectedDriverId, setLastSelectedDriverId] = useState<string | null>(null);

    // Staging State
    const [stagedAssignments, setStagedAssignments] = useState<StagedDriverAssignment[]>([]);

    // UI State
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [shiftFilter, setShiftFilter] = useState("all");

    // Confirmation Modal State
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showFinalizeCard, setShowFinalizeCard] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Net Assignment State (for the new confirmation modal)
    const [netAssignmentResult, setNetAssignmentResult] = useState<ComputeNetAssignmentsResult | null>(null);

    // Conflict handling state
    const [conflictState, setConflictState] = useState<ConflictState | null>(null);
    const [pendingBusSelection, setPendingBusSelection] = useState<BusData | null>(null);
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // ============================================
    // PERMISSION CHECK
    // ============================================

    useEffect(() => {
        if (authLoading) return;

        if (
            !currentUser ||
            (userData?.role !== "admin" && userData?.role !== "moderator")
        ) {
            router.push("/login");
        }
    }, [currentUser, userData, authLoading, router]);

    // ============================================
    // DATA LOADING
    // SPARK PLAN SAFETY: Using getDocs (one-time) instead of onSnapshot (realtime)
    // onSnapshot on entire collections was causing 8.9K+ reads!
    // ============================================

    const fetchAllData = useCallback(async () => {
        if (!currentUser) return;

        setLoading(true);
        try {
            // Fetch all three collections via API (PostgreSQL)
            const [driversRes, busesRes, routesRes] = await Promise.all([
                fetch('/api/drivers'),
                fetch('/api/buses'),
                fetch('/api/routes'),
            ]);

            const driversJson = await driversRes.json();
            const driversData: DriverData[] = (Array.isArray(driversJson) ? driversJson : driversJson.drivers || []).map((d: any) => ({
                id: d.id || d.uid,
                ...d,
            })) as DriverData[];
            setDrivers(driversData);

            const busesJson = await busesRes.json();
            const busesData: BusData[] = (busesJson.buses || []).map((b: any) => ({
                id: b.busId || b.id,
                ...b,
            })) as BusData[];
            setBuses(busesData);

            const routesJson = await routesRes.json();
            const routesData: RouteData[] = (Array.isArray(routesJson) ? routesJson : routesJson.routes || []).map((r: any) => ({
                id: r.id || r.routeId,
                ...r,
            })) as RouteData[];
            setRoutes(routesData);

            console.log(`[DriverAssignment] Loaded: ${driversData.length} drivers, ${busesData.length} buses, ${routesData.length} routes`);
        } catch (error: any) {
            console.error("Error loading data:", error);
            toast.error("Failed to load data. Please refresh.");
        } finally {
            setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        fetchAllData();
    }, [fetchAllData]);

    // ============================================
    // COMPUTED VALUES
    // ============================================

    // Filter and sort drivers by driverId ascending
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

                const driverShift = (driver.shift || "").toLowerCase();
                const matchesShift =
                    shiftFilter === "all" ||
                    driverShift.includes(shiftFilter);

                return matchesSearch && matchesStatus && matchesShift;
            })
            .sort((a, b) => {
                // Sort strictly by driverId (DB-00, DB-01, DB-02...)
                const aCode = a.driverId || a.employeeId || "";
                const bCode = b.driverId || b.employeeId || "";
                const aNum = parseInt(aCode.replace(/\D/g, ""), 10) || 0;
                const bNum = parseInt(bCode.replace(/\D/g, ""), 10) || 0;
                return aNum - bNum;
            });
    }, [drivers, searchTerm, statusFilter, shiftFilter]);

    // Get bus info for a driver
    const getBusForDriver = useCallback((driver: DriverData): BusData | null => {
        const busId = driver.busId || driver.busId;
        if (!busId) return null;
        return buses.find((b) => b.id === busId || b.busId === busId) || null;
    }, [buses]);

    // Get route info for a bus
    const getRouteForBus = useCallback((bus: BusData): RouteData | null => {
        if (!bus.routeId) return null;
        return routes.find((r) => r.id === bus.routeId || r.routeId === bus.routeId) || null;
    }, [routes]);

    // Get driver for a bus
    const getDriverForBus = useCallback((bus: BusData): DriverData | null => {
        const driverId = bus.activeDriverId || bus.assignedDriverId;
        if (driverId) {
            const driver = drivers.find((d) => d.id === driverId);
            if (driver) return driver;
        }

        // Fallback: search drivers for anyone assigned to this bus (handles data inconsistencies)
        // Check both 'busId' and 'busId' fields on the driver document
        const falloutDriver = drivers.find((d) => d.busId === bus.id || d.busId === bus.id);
        return falloutDriver || null;
    }, [drivers]);

    // Selected driver(s) - for single selection display
    const selectedDriver = useMemo(() => {
        const ids = Array.from(selectedDriverIds);
        if (ids.length === 1) {
            return drivers.find((d) => d.id === ids[0]) || null;
        }
        return null;
    }, [selectedDriverIds, drivers]);

    // Get the assigned bus for selected driver
    const selectedDriverBus = useMemo(() => {
        if (!selectedDriver) return null;
        return getBusForDriver(selectedDriver);
    }, [selectedDriver, getBusForDriver]);

    // Buses sorted: currently assigned bus first, then rest
    const sortedBuses = useMemo(() => {
        if (!selectedDriverBus) return buses;

        return [...buses].sort((a, b) => {
            if (a.id === selectedDriverBus.id) return -1;
            if (b.id === selectedDriverBus.id) return 1;
            return 0;
        });
    }, [buses, selectedDriverBus]);

    // Compute merged bus assignment for a driver (considering staged changes)
    const getMergedBusForDriver = useCallback((driver: DriverData): { bus: BusData | null; isStaged: boolean; isReserved: boolean; stagedBusNumber?: string } => {
        // First check if this driver is in any staged assignment
        // Case 1: Driver is being assigned to a new bus
        const asNewOperator = stagedAssignments.find(s => s.driverId === driver.id);
        if (asNewOperator) {
            const stagedBus = buses.find(b => b.id === asNewOperator.newBusId);
            return {
                bus: stagedBus || null,
                isStaged: true,
                isReserved: false,
                stagedBusNumber: asNewOperator.newBusNumber
            };
        }

        // Case 2: Driver was previous operator and is being displaced (marked as reserved)
        const asDisplacedOperator = stagedAssignments.find(
            s => s.previousOperatorId === driver.id && s.affectOnPreviousOperator === 'reserved'
        );
        if (asDisplacedOperator) {
            return { bus: null, isStaged: true, isReserved: true };
        }

        // Case 3: Driver was previous operator and is being swapped to another bus
        const asSwappedOperator = stagedAssignments.find(
            s => s.previousOperatorId === driver.id && s.affectOnPreviousOperator === 'swapped'
        );
        if (asSwappedOperator && asSwappedOperator.swappedToBusId) {
            const swappedBus = buses.find(b => b.id === asSwappedOperator.swappedToBusId);
            return {
                bus: swappedBus || null,
                isStaged: true,
                isReserved: false,
                stagedBusNumber: asSwappedOperator.swappedToBusNumber || undefined
            };
        }

        // Case 4: No staging affects this driver, use live data
        const liveBus = getBusForDriver(driver);
        return { bus: liveBus, isStaged: false, isReserved: !liveBus };
    }, [stagedAssignments, buses, getBusForDriver]);

    // Compute merged driver for a bus (considering staged changes)
    // This is used through display on bus cards in the right panel
    const getMergedDriverForBus = useCallback((bus: BusData): { driver: DriverData | null; isStaged: boolean; stagedDriverName?: string } => {
        // Check if a new driver is being assigned to this bus (staged)
        const stagedToBus = stagedAssignments.find(s => s.newBusId === bus.id);
        if (stagedToBus) {
            const newDriver = drivers.find(d => d.id === stagedToBus.driverId);
            return {
                driver: newDriver || null,
                isStaged: true,
                stagedDriverName: stagedToBus.driverName
            };
        }

        // Check if the current driver of this bus is being moved away
        const liveDriver = getDriverForBus(bus);
        if (liveDriver) {
            // Is liveDriver being moved to another bus?
            const driverBeingMoved = stagedAssignments.find(s => s.driverId === liveDriver.id);
            if (driverBeingMoved && driverBeingMoved.newBusId !== bus.id) {
                // Driver is being moved to different bus, so this bus will have no driver
                return { driver: null, isStaged: true };
            }

            // Is liveDriver being marked as reserved (displaced) from another staging?
            const driverDisplaced = stagedAssignments.find(
                s => s.previousOperatorId === liveDriver.id && s.affectOnPreviousOperator === 'reserved'
            );
            if (driverDisplaced) {
                // Driver is being marked as reserved, so this bus will have no driver
                return { driver: null, isStaged: true };
            }

            // Is liveDriver being swapped somewhere else?
            const driverSwapped = stagedAssignments.find(
                s => s.previousOperatorId === liveDriver.id && s.affectOnPreviousOperator === 'swapped'
            );
            if (driverSwapped) {
                // Driver is being swapped, check what's happening
                // The new driver should come from another staging that swaps into this bus
                const incomingSwap = stagedAssignments.find(s => s.swappedToBusId === bus.id);
                if (incomingSwap) {
                    const incomingDriver = drivers.find(d => d.id === incomingSwap.previousOperatorId);
                    return {
                        driver: incomingDriver || null,
                        isStaged: true,
                        stagedDriverName: incomingSwap.previousOperatorName || undefined
                    };
                }
                return { driver: null, isStaged: true };
            }
        }

        // No staging affects this bus, use live data
        return { driver: liveDriver, isStaged: false };
    }, [stagedAssignments, drivers, getDriverForBus]);

    // ============================================
    // HANDLERS
    // ============================================

    // Handle driver selection - single-select
    const handleDriverSelect = (driverId: string, event: React.MouseEvent) => {
        // Only allow selecting one driver at a time
        const newSelection = new Set([driverId]);

        setSelectedDriverIds(newSelection);
        setLastSelectedDriverId(driverId);

        // Scroll to assigned bus if selection exists
        if (newSelection.size === 1) {
            const driver = drivers.find((d) => d.id === driverId);
            if (driver && busesScrollRef.current) {
                busesScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
            }
        }
    };

    // Handle checkbox toggle - disabled for now as we use single select
    const handleCheckboxToggle = (driverId: string, checked: boolean) => {
        handleDriverSelect(driverId, {} as React.MouseEvent);
    };

    // Handle make reserved for selected driver
    const handleMakeReserved = () => {
        if (selectedDriverIds.size === 0) {
            toast.error("No driver selected");
            return;
        }

        selectedDriverIds.forEach(driverId => {
            const driver = drivers.find(d => d.id === driverId);
            if (!driver) return;

            const mergedBusInfo = getMergedBusForDriver(driver);
            if (mergedBusInfo.isReserved && !mergedBusInfo.isStaged) {
                toast("Driver is already reserved", { icon: "ℹ️" });
                return;
            }

            const currentBus = getBusForDriver(driver);

            const assignment: StagedDriverAssignment = {
                id: generateStagingId(),
                driverId: driver.id,
                driverName: driver.fullName || driver.name || "Unknown",
                driverCode: formatDriverCode(driver.driverId || driver.employeeId || driver.id),
                newBusId: "",
                newBusNumber: "Reserved",
                newRouteId: "",
                newRouteName: "None",
                oldBusId: currentBus?.id || null,
                oldBusNumber: currentBus?.busNumber || null,
                previousOperatorId: null,
                previousOperatorName: null,
                previousOperatorCode: null,
                affectOnPreviousOperator: "none",
                driverPreviousState: currentBus ? "assigned" : "reserved",
                status: "pending",
            };

            const existingIndex = stagedAssignments.findIndex(s => s.driverId === driver.id);
            if (existingIndex >= 0) {
                const updated = [...stagedAssignments];
                updated[existingIndex] = assignment;
                setStagedAssignments(updated);
            } else {
                setStagedAssignments(prev => [...prev, assignment]);
            }
            toast.success(`${driver.fullName || driver.name} staged as Reserved`);
        });
    };

    // Handle bus card click
    const handleBusSelect = (bus: BusData) => {
        if (selectedDriverIds.size === 0) {
            toast.error("Please select a driver first");
            return;
        }

        if (bus.activeTripId) {
            toast.error(`Bus ${bus.busNumber} has an active trip. Cannot assign.`);
            return;
        }

        // Check if selected driver(s) are already assigned to this bus (considering staging)
        for (const driverId of selectedDriverIds) {
            const driver = drivers.find((d) => d.id === driverId);
            if (driver) {
                const mergedBusInfo = getMergedBusForDriver(driver);
                if (mergedBusInfo.bus?.id === bus.id) {
                    toast("This bus is already assigned to the selected driver", { icon: "ℹ️" });
                    return;
                }
            }
        }

        // Check for conflicts using merged driver info (considers staging)
        const mergedDriverInfo = getMergedDriverForBus(bus);
        const existingDriver = mergedDriverInfo.driver;
        if (existingDriver && !selectedDriverIds.has(existingDriver.id)) {
            setConflictState({
                busId: bus.id,
                existingDriverId: existingDriver.id,
                existingDriverName: mergedDriverInfo.stagedDriverName || existingDriver.fullName || existingDriver.name || "Unknown",
            });
            setPendingBusSelection(bus);
            return;
        }

        // No conflict - stage assignments for all selected drivers
        stageAssignmentsForSelectedDrivers(bus);
    };

    // Handle conflict resolution
    const handleConflictChoice = (choice: ConflictChoice) => {
        if (!pendingBusSelection || !conflictState) return;

        if (choice === "cancel") {
            setConflictState(null);
            setPendingBusSelection(null);
            return;
        }

        stageAssignmentsForSelectedDrivers(pendingBusSelection, choice);
        setConflictState(null);
        setPendingBusSelection(null);
    };

    // Stage assignments for all selected drivers
    const stageAssignmentsForSelectedDrivers = (bus: BusData, conflictResolution?: ConflictChoice) => {
        const route = getRouteForBus(bus);
        const existingDriver = getDriverForBus(bus);

        selectedDriverIds.forEach((driverId) => {
            const driver = drivers.find((d) => d.id === driverId);
            if (!driver) return;

            const existingIndex = stagedAssignments.findIndex((s) => s.driverId === driverId);
            const currentBus = getBusForDriver(driver);

            // Determine driver's previous state
            const driverPreviousState = currentBus ? "assigned" : "reserved";

            // Determine what happens to the previous operator
            let affectOnPreviousOperator: "reserved" | "swapped" | "none" = "none";
            let swappedToBusId: string | null = null;
            let swappedToBusNumber: string | null = null;

            if (existingDriver && existingDriver.id !== driverId) {
                if (conflictResolution === "swap" && currentBus) {
                    affectOnPreviousOperator = "swapped";
                    swappedToBusId = currentBus.id;
                    swappedToBusNumber = currentBus.busNumber;
                } else {
                    affectOnPreviousOperator = "reserved";
                }
            }

            const assignment: StagedDriverAssignment = {
                id: generateStagingId(),
                driverId: driver.id,
                driverName: driver.fullName || driver.name || "Unknown",
                driverCode: formatDriverCode(driver.driverId || driver.employeeId || driver.id),
                newBusId: bus.id,
                newBusNumber: bus.busNumber,
                newRouteId: route?.routeId || route?.id,
                newRouteName: route?.routeName || bus.routeName,
                oldBusId: currentBus?.id,
                oldBusNumber: currentBus?.busNumber,
                // New fields for enhanced staging table
                previousOperatorId: existingDriver?.id || null,
                previousOperatorName: existingDriver ? (existingDriver.fullName || existingDriver.name || "Unknown") : null,
                previousOperatorCode: existingDriver ? formatDriverCode(existingDriver.driverId || existingDriver.employeeId || existingDriver.id) : null,
                affectOnPreviousOperator,
                swappedToBusId,
                swappedToBusNumber,
                driverPreviousState,
                driverPreviousBusId: currentBus?.id || null,
                driverPreviousBusNumber: currentBus?.busNumber || null,
                status: "pending",
            };

            if (existingIndex >= 0) {
                const updated = [...stagedAssignments];
                updated[existingIndex] = assignment;
                setStagedAssignments(updated);
            } else {
                setStagedAssignments((prev) => [...prev, assignment]);
            }
        });

        toast.success(`Staged ${selectedDriverIds.size} assignment(s) → ${bus.busNumber}`);
        setSelectedDriverIds(new Set());
    };

    // Remove from staging
    const removeFromStaging = (stagingId: string) => {
        setStagedAssignments((prev) => prev.filter((s) => s.id !== stagingId));
        toast.success("Removed from staging");
    };

    // Clear all staging
    const clearAllStaging = () => {
        setStagedAssignments([]);
        toast.success("All staged changes cleared");
    };

    // Open confirmation modal - computes net assignments first
    const openConfirmModal = () => {
        if (stagedAssignments.length === 0) {
            toast.error("No changes to confirm");
            return;
        }

        // Build the database snapshot for net computation
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

        // Convert staged assignments to StagedOperation format
        const stagedOperations: StagedOperation[] = stagedAssignments.map((s, index) => {
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
                stagedAt: Date.now() + index,
                oldBusNumber: s.oldBusNumber,
            };
        });

        // Compute net assignments
        const result = computeNetAssignments(stagedOperations, dbSnapshot);
        setNetAssignmentResult(result);

        // Validate staging pre-check
        const validation = validateStagingPreCheck(stagedOperations, dbSnapshot);
        if (validation.warnings.length > 0) {
            validation.warnings.forEach(w => toast(w, { icon: "⚠️" }));
        }

        if (!validation.isValid) {
            validation.errors.forEach(e => toast.error(e));
            return;
        }

        setShowConfirmModal(true);
    };

    // Handle revert - close modal and keep staging
    const handleRevert = useCallback(() => {
        setShowConfirmModal(false);
        setShowFinalizeCard(false);
        setNetAssignmentResult(null);
        toast.success("Action reverted. No changes applied.");
    }, []);

    // Initiates the finalization phase (closes modal, shows floating card)
    const handleFinalizeInitiate = useCallback(() => {
        setShowConfirmModal(false);
        setShowFinalizeCard(true);
    }, []);

    // Performs the actual Firestore commit
    const performCommit = async () => {
        if (!currentUser?.uid) {
            toast.error("Not authenticated");
            return;
        }

        if (!netAssignmentResult || !netAssignmentResult.hasChanges) {
            toast.success("No net changes to apply");
            setStagedAssignments([]);
            setShowFinalizeCard(false);
            setNetAssignmentResult(null);
            return;
        }

        setProcessing(true);

        try {
            // Build staged operations for audit log
            const stagedOps: StagedOperation[] = stagedAssignments.map((s, index) => {
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
                    stagedAt: Date.now() + index,
                    oldBusNumber: s.oldBusNumber,
                };
            });

            // Commit using the new API route
            const modId = userData?.employeeId || userData?.staffId || userData?.uid?.substring(0, 6).toUpperCase() || "Unknown ID";
            const modName = userData?.fullName || userData?.name || "Moderator";

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
                    actorInfo: { name: modName, role: "moderator", label: `${modName} (${modId})` },
                }),
            });

            const result = await response.json();

            if (result.success) {
                toast.success(`✅ Successfully assigned ${result.updatedDrivers.length} driver(s)`);
                fetchAllData(); // REFETCH to reflect changes
                setTimeout(() => {
                    setStagedAssignments([]);
                    setShowFinalizeCard(false);
                    setNetAssignmentResult(null);
                }, 1000);
            } else {
                if (result.conflictDetails) {
                    toast.error(`Conflict detected: ${result.conflictDetails}`);
                } else {
                    toast.error(result.message || "Failed to commit assignments");
                }
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

    if (!permsLoading && !canDriverReassign) {
        return <PermissionDeniedCard title="Driver Assignment Restricted" actionName="Reassigning Drivers" />;
    }

    return (
        <TooltipProvider>
            <div className="mt-20 sm:mt-8 space-y-6 px-2 sm:px-4 ml-0">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 flex-shrink-0">
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">
                            Smart Driver Assignment
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Shift-aware driver reassignment with staging workflow
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
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
                </div>

                {/* Main Grid - Two Equal Cards with Fixed Height */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch w-full">

                    {/* Left Panel - Driver List */}
                    <div
                        className="lg:col-span-4 rounded-2xl border overflow-hidden flex flex-col h-[465px]"
                        style={{ backgroundColor: '#0F172A', borderColor: tokens.borderDark }}
                    >
                        {/* Header - No top whitespace */}
                        <div
                            className="px-4 py-3 rounded-t-2xl flex-shrink-0"
                            style={{ background: tokens.cardHeader }}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-500"
                                    >
                                        <Users className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold" style={{ color: tokens.textPrimary }}>Drivers</h3>
                                        <p className="text-xs" style={{ color: tokens.textMuted }}>Sorted by Driver ID</p>
                                    </div>
                                </div>
                                <Badge
                                    className="text-xs"
                                    style={{ backgroundColor: `${tokens.success}20`, color: tokens.success }}
                                >
                                    {filteredDrivers.length} shown
                                </Badge>
                            </div>
                        </div>

                        {/* Search and Filters */}
                        <div className="px-3 pt-3 pb-2">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5" style={{ color: tokens.textMuted }} />
                                <Input
                                    placeholder="Search drivers..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-8 h-8 text-xs border-0 w-full"
                                    style={{
                                        backgroundColor: '#1E293B',
                                        color: tokens.textPrimary,
                                    }}
                                />
                            </div>
                        </div>
                        <ScrollArea className="flex-1">
                            <div className="px-3 pb-3 space-y-2">
                                {filteredDrivers.map((driver) => {
                                    const mergedBusInfo = getMergedBusForDriver(driver);
                                    const isSelected = selectedDriverIds.has(driver.id);
                                    const driverCode = formatDriverCode(driver.driverId || driver.employeeId || driver.id);

                                    return (
                                        <motion.div
                                            key={driver.id}
                                            onClick={(e) => handleDriverSelect(driver.id, e)}
                                            className={cn(
                                                "h-20 p-3 rounded-xl cursor-pointer transition-all duration-200 border",
                                                isSelected
                                                    ? "border-opacity-100 shadow-md"
                                                    : "border-transparent hover:border-opacity-30"
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
                                                    {/* Checkbox removed as per single-select requirement */}
                                                    <Avatar
                                                        src={safeImageSrc(driver.profilePhotoUrl)}
                                                        name={driver.fullName || driver.name}
                                                        size="sm"
                                                    />
                                                    <div>
                                                        <p className="font-medium text-sm" style={{ color: tokens.textPrimary }}>
                                                            {driver.fullName || driver.name || "Unknown"}
                                                        </p>
                                                        <p className="text-xs" style={{ color: tokens.textMuted }}>
                                                            {driverCode}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    {mergedBusInfo.bus ? (
                                                        <Badge
                                                            className="text-[9px] px-1.5 py-0"
                                                            style={{
                                                                backgroundColor: mergedBusInfo.isStaged
                                                                    ? `${tokens.primaryOrange}20`
                                                                    : `${tokens.success}20`,
                                                                color: mergedBusInfo.isStaged
                                                                    ? tokens.primaryOrange
                                                                    : tokens.success,
                                                                border: `1px solid ${mergedBusInfo.isStaged ? tokens.primaryOrange : tokens.success}40`
                                                            }}
                                                        >
                                                            <Bus className="w-2.5 h-2.5 mr-1" />
                                                            {mergedBusInfo.stagedBusNumber || mergedBusInfo.bus.busNumber}
                                                        </Badge>
                                                    ) : (
                                                        <Badge
                                                            className="text-[9px] px-1.5 py-0"
                                                            style={{
                                                                backgroundColor: mergedBusInfo.isStaged
                                                                    ? `${tokens.primaryOrange}20`
                                                                    : `${tokens.reserved}20`,
                                                                color: mergedBusInfo.isStaged
                                                                    ? tokens.primaryOrange
                                                                    : tokens.reserved,
                                                                border: `1px solid ${mergedBusInfo.isStaged ? tokens.primaryOrange : tokens.reserved}40`
                                                            }}
                                                        >
                                                            Reserved
                                                        </Badge>
                                                    )}
                                                    {driver.shift && (
                                                        <span className="text-[9px]" style={{ color: tokens.textMuted }}>
                                                            {driver.shift}
                                                        </span>
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
                        <div
                            className="px-4 py-3 rounded-t-2xl flex-shrink-0"
                            style={{ background: tokens.cardHeader }}
                        >
                            <div className="flex items-center justify-between pt-3 pb-3">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-500"
                                    >
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
                                                ? "Select a bus below to stage assignment"
                                                : "Select a driver from the left panel to see available buses"}
                                        </p>
                                    </div>
                                </div>
                                {selectedDriverIds.size >= 1 ? (
                                    <Button
                                        size="sm"
                                        className="h-8 text-xs text-white px-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 transition-all active:scale-95"
                                        onClick={handleMakeReserved}
                                    >
                                        Make Reserved
                                    </Button>
                                ) : (
                                    <Badge
                                        className="text-xs"
                                        style={{ backgroundColor: `${tokens.primaryPurple}20`, color: tokens.primaryPurple, border: `1px solid ${tokens.primaryPurple}40` }}
                                    >
                                        {buses.length} Buses
                                    </Badge>
                                )}
                            </div>
                        </div>

                        {/* Bus Content */}
                        <ScrollArea className="flex-1" ref={busesScrollRef}>
                            {selectedDriverIds.size === 1 ? (
                                <div className="p-3 space-y-4">
                                    {/* Currently Assigned (only for single selection) */}
                                    {selectedDriverBus && selectedDriver && (
                                        <div>
                                            <p className="text-xs font-medium mb-2 px-1" style={{ color: tokens.textMuted }}>
                                                Currently Assigned
                                            </p>
                                            <CurrentAssignmentCard
                                                bus={selectedDriverBus}
                                                route={getRouteForBus(selectedDriverBus)}
                                                driver={selectedDriver}
                                            />
                                        </div>
                                    )}

                                    {/* Available Buses */}
                                    <div>
                                        <p className="text-xs font-medium mb-2 px-1" style={{ color: tokens.textMuted }}>
                                            Available Buses
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {sortedBuses
                                                .filter((bus) => bus.id !== selectedDriverBus?.id)
                                                .map((bus) => {
                                                    const hasActiveTrip = !!bus.activeTripId;
                                                    const mergedDriverInfo = getMergedDriverForBus(bus);
                                                    const route = getRouteForBus(bus);
                                                    const isConflictTarget = conflictState?.busId === bus.id;
                                                    const displayedDriver = mergedDriverInfo.driver;
                                                    const displayedDriverName = mergedDriverInfo.stagedDriverName || displayedDriver?.fullName || displayedDriver?.name;

                                                    return (
                                                        <div key={bus.id} className="relative">
                                                            <motion.div
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
                                                                {/* Interactive Glow Effect */}
                                                                {!hasActiveTrip && (
                                                                    <div className="absolute -inset-1 opacity-0 group-hover:opacity-10 transition-opacity duration-500 bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-500 blur-xl" />
                                                                )}

                                                                <div className="flex items-start justify-between relative z-10">
                                                                    <div className="flex items-center gap-3">
                                                                        <div
                                                                            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110"
                                                                            style={{
                                                                                background: hasActiveTrip
                                                                                    ? 'linear-gradient(135deg, #EF4444, #991B1B)'
                                                                                    : displayedDriver
                                                                                        ? mergedDriverInfo.isStaged
                                                                                            ? 'linear-gradient(135deg, #F97316, #C2410C)'
                                                                                            : 'linear-gradient(135deg, #F59E0B, #B45309)'
                                                                                        : 'linear-gradient(135deg, #F97316, #EA580C)'
                                                                            }}
                                                                        >
                                                                            <Bus className="w-5 h-5 text-white" />
                                                                        </div>
                                                                        <div>
                                                                            <p className="font-bold text-sm tracking-tight" style={{ color: tokens.textPrimary }}>
                                                                                {bus.busNumber}
                                                                            </p>
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
                                                                            <Badge className="bg-red-500 text-white text-[9px] h-5">
                                                                                IN TRIP
                                                                            </Badge>
                                                                        ) : displayedDriver ? (
                                                                            <Badge
                                                                                className="text-[9px] h-5 border-none"
                                                                                style={{
                                                                                    backgroundColor: mergedDriverInfo.isStaged
                                                                                        ? `${tokens.primaryOrange}25`
                                                                                        : `${tokens.occupied}25`,
                                                                                    color: mergedDriverInfo.isStaged
                                                                                        ? tokens.primaryOrange
                                                                                        : tokens.occupied,
                                                                                }}
                                                                            >
                                                                                {mergedDriverInfo.isStaged ? "STAGED" : "OCCUPIED"}
                                                                            </Badge>
                                                                        ) : (
                                                                            <Badge
                                                                                className="text-[9px] h-5 border-none"
                                                                                style={{
                                                                                    backgroundColor: `${tokens.success}25`,
                                                                                    color: tokens.success,
                                                                                }}
                                                                            >
                                                                                AVAILABLE
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Compact Route Stops Preview */}
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
                                                                        <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: mergedDriverInfo.isStaged ? tokens.primaryOrange : tokens.textMuted }}>
                                                                            <User className="w-3 h-3" />
                                                                            <span className="truncate max-w-[120px]">{displayedDriverName}</span>
                                                                            {mergedDriverInfo.isStaged && (
                                                                                <Badge className="text-[7px] p-0 px-1 bg-orange-500/20 text-orange-500 border-none scale-90">STG</Badge>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <span className="text-[10px] text-slate-500 font-medium">No operator assigned</span>
                                                                    )}
                                                                    <div className="flex items-center gap-1 opacity-60">
                                                                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: displayedDriver ? (mergedDriverInfo.isStaged ? tokens.primaryOrange : tokens.occupied) : tokens.success }}></div>
                                                                        <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest">{bus.capacity} CAP</span>
                                                                    </div>
                                                                </div>
                                                            </motion.div>

                                                            {/* Inline Conflict Resolution */}
                                                            <AnimatePresence>
                                                                {isConflictTarget && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0, scale: 0.95 }}
                                                                        animate={{ opacity: 1, scale: 1 }}
                                                                        exit={{ opacity: 0, scale: 0.95 }}
                                                                        className="absolute inset-0 rounded-xl p-4 flex flex-col justify-center z-10 backdrop-blur-sm"
                                                                        style={{ backgroundColor: 'rgba(11, 18, 32, 0.97)' }}
                                                                    >
                                                                        <p className="text-xs text-center mb-3" style={{ color: tokens.textPrimary }}>
                                                                            Bus has driver: <span style={{ color: tokens.occupied }}>{conflictState.existingDriverName}</span>
                                                                        </p>
                                                                        <div className="flex flex-row gap-2 justify-center flex-wrap">
                                                                            <Button
                                                                                size="sm"
                                                                                className="h-7 text-xs text-white px-3"
                                                                                style={{ backgroundColor: tokens.reserved }}
                                                                                onClick={() => handleConflictChoice("reserve")}
                                                                            >
                                                                                Move to Reserved
                                                                            </Button>
                                                                            {selectedDriverBus && (
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant="outline"
                                                                                    className="h-7 text-xs px-3"
                                                                                    style={{ borderColor: `${tokens.deepPurple}50`, color: tokens.deepPurple }}
                                                                                    onClick={() => handleConflictChoice("swap")}
                                                                                >
                                                                                    Swap Drivers
                                                                                </Button>
                                                                            )}
                                                                            <Button
                                                                                size="sm"
                                                                                variant="ghost"
                                                                                className="h-7 text-xs px-3"
                                                                                style={{ color: tokens.textMuted }}
                                                                                onClick={() => handleConflictChoice("cancel")}
                                                                            >
                                                                                Cancel
                                                                            </Button>
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                </div>
                            ) : selectedDriverIds.size > 1 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                                    <div
                                        className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                                        style={{ backgroundColor: `${tokens.reserved}15` }}
                                    >
                                        <Users className="w-10 h-10" style={{ color: tokens.reserved }} />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2" style={{ color: tokens.textPrimary }}>
                                        Multiple Drivers Selected
                                    </h3>
                                    <p className="text-sm max-w-xs mb-4" style={{ color: tokens.textMuted }}>
                                        {selectedDriverIds.size} drivers selected. Use the "Make Reserved" button to mark them as reserved.
                                    </p>
                                    <Button
                                        className="text-white"
                                        style={{ backgroundColor: tokens.reserved }}
                                        onClick={handleMakeReserved}
                                    >
                                        Make Reserved
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center p-6 mt-14">
                                    <div
                                        className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                                        style={{ backgroundColor: `${tokens.primaryOrange}15` }}
                                    >
                                        <ArrowRightLeft className="w-10 h-10" style={{ color: tokens.primaryOrange }} />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2" style={{ color: tokens.textPrimary }}>
                                        Select a Driver
                                    </h3>
                                    <p className="text-sm max-w-xs" style={{ color: tokens.textMuted }}>
                                        Choose a driver from the left panel to view their current assignment and stage a new one
                                    </p>
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                </div>

                {/* Staging Area */}
                <div className="w-full">
                    <DriverStagingArea
                        stagedAssignments={stagedAssignments}
                        onRemove={removeFromStaging}
                        onClearAll={clearAllStaging}
                        onConfirm={openConfirmModal}
                    />
                </div>

                {/* Confirmation Modal */}
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
            </div>
            <ReassignmentHistoryModal
                open={showHistoryModal}
                onOpenChange={setShowHistoryModal}
                defaultType="driver_reassignment"
                onRefresh={fetchAllData}
            />
        </TooltipProvider>
    );
}

// ============================================
// CURRENT ASSIGNMENT CARD COMPONENT
// ============================================

interface CurrentAssignmentCardProps {
    bus: BusData;
    route: RouteData | null;
    driver: DriverData;
}

function CurrentAssignmentCard({ bus, route, driver }: CurrentAssignmentCardProps) {
    return (
        <div
            className="p-4 rounded-xl border"
            style={{
                backgroundColor: `${tokens.success}10`,
                borderColor: `${tokens.success}50`
            }}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: tokens.success }}
                    >
                        <Bus className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <p className="font-semibold text-base" style={{ color: tokens.textPrimary }}>
                            {bus.busNumber}
                        </p>
                        <p className="text-xs" style={{ color: tokens.textMuted }}>
                            {route?.routeName || bus.routeName || "No Route"}
                        </p>
                    </div>
                </div>
                <Badge
                    className="text-xs"
                    style={{ backgroundColor: tokens.success, color: 'white' }}
                >
                    Current Assignment
                </Badge>
            </div>

            {/* Route Stops Pills */}
            {route?.stops && route.stops.length > 0 && (
                <div className="mb-3">
                    <p className="text-[10px] font-medium mb-1.5" style={{ color: tokens.textMuted }}>
                        Route Stops
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {route.stops.slice(0, 6).map((stop, idx) => (
                            <Badge
                                key={idx}
                                variant="outline"
                                className="text-[9px] px-2 py-0.5"
                                style={{
                                    backgroundColor: `${tokens.success}15`,
                                    borderColor: `${tokens.success}30`,
                                    color: tokens.textPrimary
                                }}
                            >
                                <MapPin className="w-2.5 h-2.5 mr-1" style={{ color: tokens.success }} />
                                {stop.name}
                            </Badge>
                        ))}
                        {route.stops.length > 6 && (
                            <Badge
                                variant="outline"
                                className="text-[9px] px-2 py-0.5"
                                style={{ borderColor: tokens.borderDark, color: tokens.textMuted }}
                            >
                                +{route.stops.length - 6} more
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Driver Info */}
            <div
                className="flex items-center gap-2 text-xs pt-2 border-t"
                style={{ borderColor: `${tokens.success}30`, color: tokens.textMuted }}
            >
                <User className="w-3.5 h-3.5" />
                <span>Driver: <strong style={{ color: tokens.textPrimary }}>{driver.fullName || driver.name}</strong></span>
                {driver.shift && (
                    <Badge
                        variant="outline"
                        className="text-[9px] ml-2"
                        style={{ borderColor: tokens.borderDark, color: tokens.textMuted }}
                    >
                        {driver.shift}
                    </Badge>
                )}
            </div>
        </div>
    );
}
