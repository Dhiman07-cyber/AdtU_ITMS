"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";



import { useAuth } from "@/contexts/auth-context";
import { toast } from "react-hot-toast";
import {
    Bus,
    Route as RouteIcon,
    Search,
    Filter,
    ArrowRightLeft,
    MapPin,
    CheckCircle2,
    Navigation,
    Clock,
    X,
    Plus,
    Check,
    UserCog,
    Sparkles,
    History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// Assignment components and services
import { RouteStagingArea } from "@/components/assignment/StagingArea";
import { RouteConfirmationModal } from "@/components/assignment/RouteConfirmationModal";
import { AssignmentFinalizeCard } from "@/components/assignment/AssignmentFinalizeCard";
import { ReassignmentHistoryModal } from "@/components/assignment/ReassignmentHistoryModal";
import {
    generateStagingId,
    type StagedRouteAssignment,
} from "@/lib/services/assignment-service";
import {
    computeNetRouteAssignments,
    validateRouteStagingPreCheck,
    type StagedRouteOperation,
    type DbRouteSnapshot,
    type RouteConfirmationTableRow,
    type ComputeNetRouteAssignmentsResult,
} from "@/lib/services/net-route-assignment-service";

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
    stops: Array<{ name: string; sequence: number; stopId?: string }>;
    status?: string;
    active?: boolean;
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function SmartRouteAllocationPage() {
    const { currentUser, userData, loading: authLoading } = useAuth();
    const router = useRouter();

    // Refs
    const routesScrollRef = useRef<HTMLDivElement>(null);

    // Core Data State
    const [buses, setBuses] = useState<BusData[]>([]);
    const [routes, setRoutes] = useState<RouteData[]>([]);
    const [loading, setLoading] = useState(true);

    // Selection State - support multi-select
    const [selectedBusIds, setSelectedBusIds] = useState<Set<string>>(new Set());
    const [lastSelectedBusId, setLastSelectedBusId] = useState<string | null>(null);

    // Staging State
    const [stagedAssignments, setStagedAssignments] = useState<StagedRouteAssignment[]>([]);

    // UI State
    const [searchTerm, setSearchTerm] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    // Confirmation Modal State
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showFinalizeCard, setShowFinalizeCard] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Net Route Assignment State (for the new confirmation modal)
    const [netRouteAssignmentResult, setNetRouteAssignmentResult] = useState<ComputeNetRouteAssignmentsResult | null>(null);

    // History Modal State
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
    // PERF: Session-cached to avoid re-fetch on back-navigation
    // ============================================

    const ROUTE_CACHE_KEY = 'adtu_route_allocation_cache';
    const ROUTE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    const fetchAllData = useCallback(async (skipCache = false) => {
        if (!currentUser) return;

        // Try cache first
        if (!skipCache) {
            try {
                const raw = sessionStorage.getItem(ROUTE_CACHE_KEY);
                if (raw) {
                    const { data, expires } = JSON.parse(raw);
                    if (Date.now() < expires) {
                        setBuses(data.buses);
                        setRoutes(data.routes);
                        setLoading(false);
                        return;
                    }
                    sessionStorage.removeItem(ROUTE_CACHE_KEY);
                }
            } catch { }
        }

        setLoading(true);
        try {
            // Fetch both collections via API (PostgreSQL)
            const [busesRes, routesRes] = await Promise.all([
                fetch('/api/buses'),
                fetch('/api/routes'),
            ]);

            const busesJson = await busesRes.json();
            const busesData: BusData[] = (busesJson.buses || []).map((b: any) => ({
                ...b,
                id: b.busId || b.id,
            })) as BusData[];
            setBuses(busesData);

            const routesJson = await routesRes.json();
            const routesData: RouteData[] = (Array.isArray(routesJson) ? routesJson : routesJson.routes || []).map((r: any) => ({
                id: r.id || r.routeId,
                ...r,
            })) as RouteData[];
            setRoutes(routesData);

            // Cache for back-navigation
            try {
                sessionStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify({
                    data: { buses: busesData, routes: routesData },
                    expires: Date.now() + ROUTE_CACHE_TTL,
                }));
            } catch { }
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

    // Filter and sort buses
    const filteredBuses = useMemo(() => {
        return buses
            .filter((bus) => {
                const matchesSearch =
                    (bus.busNumber || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (bus.busId || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (bus.routeName || "").toLowerCase().includes(searchTerm.toLowerCase());

                const matchesStatus =
                    statusFilter === "all" ||
                    (statusFilter === "assigned" && bus.routeId) ||
                    (statusFilter === "unassigned" && !bus.routeId);

                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => {
                const numA = parseInt((a.busId || a.id).replace(/\D/g, "") || "999");
                const numB = parseInt((b.busId || b.id).replace(/\D/g, "") || "999");
                return numA - numB;
            });
    }, [buses, searchTerm, statusFilter]);

    // Get route for bus
    const getRouteForBus = useCallback((bus: BusData): RouteData | null => {
        if (!bus.routeId) return null;
        return routes.find(
            (r) => r.id === bus.routeId || r.routeId === bus.routeId
        ) || null;
    }, [routes]);

    // Get buses for route
    const getBusesForRoute = useCallback((route: RouteData): BusData[] => {
        return buses.filter(
            (b) => b.routeId === route.id || b.routeId === route.routeId
        );
    }, [buses]);

    // Selected bus object (for single selection display)
    const selectedBus = useMemo(() => {
        const ids = Array.from(selectedBusIds);
        if (ids.length === 1) {
            return buses.find((b) => b.id === ids[0]) || null;
        }
        return null;
    }, [selectedBusIds, buses]);

    // Get current route for selected bus
    const selectedBusRoute = useMemo(() => {
        if (!selectedBus) return null;
        return getRouteForBus(selectedBus);
    }, [selectedBus, getRouteForBus]);

    // Routes sorted: currently assigned route first, then rest
    const sortedRoutes = useMemo(() => {
        if (!selectedBusRoute) return routes;

        return [...routes].sort((a, b) => {
            if (a.id === selectedBusRoute.id || a.routeId === selectedBusRoute.routeId) return -1;
            if (b.id === selectedBusRoute.id || b.routeId === selectedBusRoute.routeId) return 1;
            return 0;
        });
    }, [routes, selectedBusRoute]);

    // Compute merged route for a bus (considering staged changes)
    const getMergedRouteForBus = useCallback((bus: BusData): { route: RouteData | null; isStaged: boolean; stagedRouteName?: string } => {
        // Check if this bus has a staged assignment
        const stagedForBus = stagedAssignments.find(s => s.busId === bus.id);
        if (stagedForBus) {
            const stagedRoute = routes.find(r => r.id === stagedForBus.newRouteId || r.routeId === stagedForBus.newRouteId);
            return {
                route: stagedRoute || null,
                isStaged: true,
                stagedRouteName: stagedForBus.newRouteName
            };
        }

        // No staging affects this bus, use live data
        const liveRoute = getRouteForBus(bus);
        return { route: liveRoute, isStaged: false };
    }, [stagedAssignments, routes, getRouteForBus]);

    // ============================================
    // HANDLERS
    // ============================================

    // Handle bus selection - single-select
    const handleBusSelect = (busId: string, event: React.MouseEvent) => {
        const bus = buses.find((b) => b.id === busId);
        if (bus?.activeTripId) {
            toast.error(`Bus ${bus.busNumber} has an active trip. Cannot reassign.`);
            return;
        }

        // Only allow selecting one bus at a time
        const newSelection = new Set([busId]);
        setSelectedBusIds(newSelection);
        setLastSelectedBusId(busId);
    };

    // Handle checkbox toggle - disabled for now as we use single select
    const handleCheckboxToggle = (busId: string, checked: boolean) => {
        handleBusSelect(busId, {} as React.MouseEvent);
    };

    // Handle route card click - stage assignments for for selected bus
    const handleRouteSelect = (route: RouteData) => {
        if (selectedBusIds.size === 0) {
            toast.error("Please select a bus first");
            return;
        }

        if (route.active === false || route.status === "inactive") {
            toast.error(`Route ${route.routeName} is not active`);
            return;
        }

        // Check if all selected buses already have this route
        const allAlreadyAssigned = Array.from(selectedBusIds).every((busId) => {
            const bus = buses.find((b) => b.id === busId);
            return bus?.routeId === route.id || bus?.routeId === route.routeId;
        });

        if (allAlreadyAssigned && selectedBusIds.size === 1) {
            toast("This route is already assigned to the selected bus", { icon: "ℹ️" });
            return;
        }

        // Stage assignments for all selected buses
        stageAssignmentsForSelectedBuses(route);
    };

    // Stage assignments for all selected buses
    const stageAssignmentsForSelectedBuses = (route: RouteData) => {
        let stagedCount = 0;

        selectedBusIds.forEach((busId) => {
            const bus = buses.find((b) => b.id === busId);
            if (!bus) return;

            if (bus.activeTripId) {
                toast.error(`Skipped ${bus.busNumber}: has active trip`);
                return;
            }

            const currentRoute = getRouteForBus(bus);

            // Skip if already on this route
            if (currentRoute?.id === route.id || currentRoute?.routeId === route.routeId) {
                return;
            }

            const existingIndex = stagedAssignments.findIndex((s) => s.busId === bus.id);

            const assignment: StagedRouteAssignment = {
                id: generateStagingId(),
                busId: bus.id,
                busNumber: bus.busNumber,
                busCode: bus.busId || bus.id,
                newRouteId: route.routeId || route.id,
                newRouteName: route.routeName,
                newStopCount: route.totalStops || route.stops?.length || 0,
                oldRouteId: currentRoute?.routeId || currentRoute?.id,
                oldRouteName: currentRoute?.routeName,
                status: "pending",
            };

            if (existingIndex >= 0) {
                const updated = [...stagedAssignments];
                updated[existingIndex] = assignment;
                setStagedAssignments(updated);
            } else {
                setStagedAssignments((prev) => [...prev, assignment]);
            }

            stagedCount++;
        });

        if (stagedCount > 0) {
            toast.success(`Staged ${stagedCount} bus(es) → ${route.routeName}`);
        }
        // Note: We intentionally don't deselect buses here so user can continue staging
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

    // Open confirmation modal - computes net route assignments first
    const openConfirmModal = () => {
        if (stagedAssignments.length === 0) {
            toast.error("No changes to confirm");
            return;
        }

        // Build the database snapshot for net computation
        const dbSnapshot: DbRouteSnapshot = {
            buses: buses.map(b => ({
                id: b.id,
                busNumber: b.busNumber,
                busId: b.busId || b.id,
                routeId: b.routeId || null,
                capacity: b.capacity,
                currentMembers: b.currentMembers,
            })),
            routes: routes.map(r => ({
                id: r.id,
                routeId: r.routeId || r.id,
                routeName: r.routeName,
                totalStops: r.totalStops || r.stops?.length || 0,
                stops: r.stops,
            })),
        };

        // Convert staged assignments to StagedRouteOperation format
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

        // Compute net route assignments
        const result = computeNetRouteAssignments(stagedOperations, dbSnapshot);
        setNetRouteAssignmentResult(result);

        // Validate staging pre-check
        const validation = validateRouteStagingPreCheck(stagedOperations, dbSnapshot);
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
        setNetRouteAssignmentResult(null);
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

        if (!netRouteAssignmentResult || !netRouteAssignmentResult.hasChanges) {
            toast.success("No net changes to apply");
            setStagedAssignments([]);
            setShowFinalizeCard(false);
            setNetRouteAssignmentResult(null);
            return;
        }

        setProcessing(true);

        try {
            // Build staged operations for audit log
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

            // Commit using the new API route
            const token = await currentUser.getIdToken();
            const response = await fetch('/api/fleet/assign-routes', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    netChanges: Array.from(netRouteAssignmentResult.netChanges.values()),
                    stagingSnapshot: stagedOps,
                    actorInfo: {
                        name: userData?.fullName || userData?.name || 'Unknown',
                        role: userData?.role || 'admin',
                    },
                }),
            });

            const result = await response.json();


            if (result.success) {
                toast.success(`✅ Successfully assigned ${result.updatedBuses.length} bus(es) to routes`);
                fetchAllData(); // REFTECH to ensure UI reflects CHANGES
                setTimeout(() => {
                    setStagedAssignments([]);
                    setShowFinalizeCard(false);
                    setNetRouteAssignmentResult(null);
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
        return <PremiumPageLoader message="Loading route allocation system..." subMessage="Analyzing routes..." />;
    }

    // ============================================
    // RENDER: MAIN UI
    // ============================================

    return (
        <TooltipProvider>
            <div className="mt-20 sm:mt-8 space-y-6 px-2 sm:px-4">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 flex-shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg bg-gradient-to-br from-purple-500 to-pink-500"
                        >
                            <RouteIcon className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <motion.h1
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-purple-500 bg-clip-text text-transparent"
                            >
                                Smart Route Allocation
                            </motion.h1>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                Reassign buses to different routes permanently
                            </p>
                        </div>
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
                {/* Main Grid - Two Equal Cards with Fixed Height */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch w-full">

                    {/* Left Panel - Bus List */}
                    <div
                        className="lg:col-span-4 rounded-2xl border overflow-hidden flex flex-col h-[468px]"
                        style={{ backgroundColor: tokens.cardBg, borderColor: tokens.borderDark }}
                    >
                        {/* Header */}
                        <div
                            className="px-4 py-3 rounded-t-2xl flex-shrink-0"
                            style={{ background: tokens.cardHeader }}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500"
                                    >
                                        <Bus className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold" style={{ color: tokens.textPrimary }}>Buses</h3>
                                        <p className="text-xs" style={{ color: tokens.textMuted }}>Select a bus to reassign its route</p>
                                    </div>
                                </div>
                                <Badge
                                    className="text-xs"
                                    style={{ backgroundColor: `${tokens.primaryPurple}20`, color: tokens.primaryPurple, border: `1px solid ${tokens.primaryPurple}40` }}
                                >
                                    {filteredBuses.length} shown
                                </Badge>
                            </div>

                            {/* Search and Filters */}
                            <div className="flex gap-2 mt-3">
                                <div className="relative flex-1">
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5" style={{ color: tokens.textMuted }} />
                                    <Input
                                        placeholder="Search buses..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="pl-8 h-8 text-xs border-0"
                                        style={{
                                            backgroundColor: '#162231',
                                            color: tokens.textPrimary,
                                        }}
                                    />
                                </div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger
                                        className="w-[130px] h-8 text-xs border-0"
                                        style={{ backgroundColor: '#162231', color: tokens.textPrimary }}
                                    >
                                        <Filter className="w-3 h-3 mr-1.5" style={{ color: tokens.textMuted }} />
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all" className="text-xs">All Buses</SelectItem>
                                        <SelectItem value="assigned" className="text-xs">With Route</SelectItem>
                                        <SelectItem value="unassigned" className="text-xs">No Route</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Bus List */}
                        <ScrollArea className="flex-1">
                            <div className="p-3 space-y-1">
                                {filteredBuses.map((bus) => {
                                    const mergedRouteInfo = getMergedRouteForBus(bus);
                                    const displayedRoute = mergedRouteInfo.route;
                                    const displayedRouteName = mergedRouteInfo.stagedRouteName || displayedRoute?.routeName;
                                    const isSelected = selectedBusIds.has(bus.id);
                                    const hasActiveTrip = !!bus.activeTripId;

                                    return (
                                        <motion.div
                                            key={bus.id}
                                            onClick={(e) => handleBusSelect(bus.id, e)}
                                            className={cn(
                                                "h-20 p-3 rounded-xl transition-all duration-200 border",
                                                hasActiveTrip
                                                    ? "opacity-50 cursor-not-allowed"
                                                    : "cursor-pointer",
                                                isSelected
                                                    ? "border-opacity-100 shadow-md"
                                                    : "border-transparent hover:border-opacity-30",
                                                mergedRouteInfo.isStaged && "ring-2 ring-orange-500/30"
                                            )}
                                            style={{
                                                backgroundColor: isSelected ? `${tokens.primaryPurple}15` : '#131C2E',
                                                borderColor: hasActiveTrip
                                                    ? '#EF4444'
                                                    : mergedRouteInfo.isStaged
                                                        ? tokens.primaryOrange
                                                        : isSelected
                                                            ? tokens.primaryPurple
                                                            : tokens.borderDark,
                                            }}
                                            whileHover={!hasActiveTrip ? { scale: 1.01 } : {}}
                                            whileTap={!hasActiveTrip ? { scale: 0.99 } : {}}
                                        >
                                            <div className="flex items-center justify-between h-full">
                                                <div className="flex items-center gap-3">
                                                    {/* Checkbox removed as per single-select requirement */}
                                                    <div
                                                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                                                        style={{
                                                            backgroundColor: hasActiveTrip
                                                                ? '#EF4444'
                                                                : mergedRouteInfo.isStaged
                                                                    ? tokens.primaryOrange
                                                                    : isSelected
                                                                        ? tokens.primaryOrange
                                                                        : '#374151'
                                                        }}
                                                    >
                                                        <Bus className="w-5 h-5 text-white" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm" style={{ color: tokens.textPrimary }}>
                                                            {bus.busNumber}
                                                        </p>
                                                        <p className="text-xs" style={{ color: tokens.textMuted }}>
                                                            Bus ID: {bus.busId || bus.id}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    {hasActiveTrip ? (
                                                        <Badge className="bg-red-500 text-white text-[10px]">
                                                            In Trip
                                                        </Badge>
                                                    ) : displayedRoute ? (
                                                        <Badge
                                                            className="text-[9px] px-1.5 py-0"
                                                            style={{
                                                                backgroundColor: mergedRouteInfo.isStaged
                                                                    ? `${tokens.primaryOrange}20`
                                                                    : `${tokens.success}20`,
                                                                color: mergedRouteInfo.isStaged
                                                                    ? tokens.primaryOrange
                                                                    : tokens.success,
                                                                border: `1px solid ${mergedRouteInfo.isStaged ? tokens.primaryOrange : tokens.success}40`
                                                            }}
                                                        >
                                                            <RouteIcon className="w-2.5 h-2.5 mr-1" />
                                                            {displayedRouteName}
                                                            {mergedRouteInfo.isStaged && <span className="ml-1 opacity-70">(staged)</span>}
                                                        </Badge>
                                                    ) : (
                                                        <Badge
                                                            className="text-[9px] px-1.5 py-0"
                                                            style={{
                                                                backgroundColor: `${tokens.reserved}20`,
                                                                color: tokens.reserved,
                                                                border: `1px solid ${tokens.reserved}40`
                                                            }}
                                                        >
                                                            No Route
                                                        </Badge>
                                                    )}
                                                    <span className="text-[10px]" style={{ color: tokens.textMuted }}>
                                                        {bus.currentMembers || 0}/{bus.capacity}
                                                    </span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}

                                {filteredBuses.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <Bus className="h-12 w-12 mb-3" style={{ color: tokens.textMuted }} />
                                        <p className="text-sm" style={{ color: tokens.textMuted }}>No buses found</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Right Panel - Route Selection */}
                    <div
                        className="lg:col-span-8 rounded-2xl border overflow-hidden flex flex-col h-[468px]"
                        style={{ backgroundColor: tokens.cardBg, borderColor: tokens.borderDark }}
                    >
                        {/* Header */}
                        <div
                            className="px-4 py-3 rounded-t-2xl flex-shrink-0"
                            style={{ background: tokens.cardHeader }}
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                                    style={{ backgroundColor: tokens.success }}
                                >
                                    <RouteIcon className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold" style={{ color: tokens.textPrimary }}>
                                        {selectedBus
                                            ? `Assign ${selectedBus.busNumber} to:`
                                            : selectedBusIds.size > 1
                                                ? `Assign ${selectedBusIds.size} buses to:`
                                                : "Routes"}
                                    </h3>
                                    <p className="text-xs" style={{ color: tokens.textMuted }}>
                                        {selectedBusIds.size > 0
                                            ? "Choose a route to assign this bus to"
                                            : "Select a bus from the left panel"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Route Content */}
                        <ScrollArea className="flex-1" ref={routesScrollRef}>
                            {selectedBusIds.size > 0 ? (
                                <div className="p-3 space-y-4">
                                    {/* Currently Assigned Route (only for single selection) */}
                                    {selectedBusRoute && selectedBus && (
                                        <div>
                                            <p className="text-xs font-medium mb-2 px-1" style={{ color: tokens.textMuted }}>
                                                Currently Assigned Route
                                            </p>
                                            <CurrentRouteCard route={selectedBusRoute} bus={selectedBus} />
                                        </div>
                                    )}

                                    {/* Available Routes */}
                                    <div>
                                        <p className="text-xs font-medium mb-2 px-1" style={{ color: tokens.textMuted }}>
                                            {selectedBusRoute ? "Other Routes" : "Available Routes"}
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {sortedRoutes
                                                .filter((route) => {
                                                    if (!selectedBusRoute) return true;
                                                    return route.id !== selectedBusRoute.id &&
                                                        route.routeId !== selectedBusRoute.routeId;
                                                })
                                                .map((route) => {
                                                    const isInactive = route.active === false;
                                                    const busesOnRoute = getBusesForRoute(route);

                                                    return (
                                                        <motion.div
                                                            key={route.id}
                                                            whileHover={!isInactive ? { scale: 1.02, backgroundColor: '#1E293B' } : {}}
                                                            whileTap={!isInactive ? { scale: 0.98 } : {}}
                                                            onClick={() => !isInactive && handleRouteSelect(route)}
                                                            className={cn(
                                                                "min-h-[140px] p-4 rounded-xl border cursor-pointer transition-all duration-300 relative overflow-hidden group",
                                                                isInactive && "opacity-50 cursor-not-allowed"
                                                            )}
                                                            style={{
                                                                backgroundColor: '#131C2E',
                                                                borderColor: isInactive ? '#374151' : tokens.borderDark,
                                                            }}
                                                        >
                                                            {/* Interactive Glow Effect */}
                                                            {!isInactive && (
                                                                <div className="absolute -inset-1 opacity-0 group-hover:opacity-10 transition-opacity duration-500 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 blur-xl" />
                                                            )}

                                                            <div className="flex items-start justify-between mb-3 relative z-10">
                                                                <div className="flex items-center gap-3">
                                                                    <div
                                                                        className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110"
                                                                        style={{
                                                                            background: isInactive
                                                                                ? 'linear-gradient(135deg, #374151, #1F2937)'
                                                                                : 'linear-gradient(135deg, #F97316, #EA580C)'
                                                                        }}
                                                                    >
                                                                        <Navigation className="w-5 h-5 text-white" />
                                                                    </div>
                                                                    <div>
                                                                        <p className="font-bold text-sm tracking-tight" style={{ color: tokens.textPrimary }}>
                                                                            {route.routeName}
                                                                        </p>
                                                                        <div className="flex items-center gap-1.5">
                                                                            <MapPin className="w-2.5 h-2.5" style={{ color: tokens.primaryOrange }} />
                                                                            <p className="text-[10px] font-medium" style={{ color: tokens.textMuted }}>
                                                                                {route.totalStops || route.stops?.length || 0} stops total
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                {!isInactive && (
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                                                                )}
                                                            </div>

                                                            {/* Compact Route Stops Preview */}
                                                            {route.stops && route.stops.length > 0 && (
                                                                <div className="mb-4 py-1.5 px-3 rounded-lg bg-black/20 flex gap-2 items-center group-hover:bg-black/30 transition-colors duration-300 relative z-10">
                                                                    <span className="text-[10px] text-slate-400 font-bold truncate">
                                                                        {route.stops[0].name} — {route.stops[route.stops.length - 1].name}
                                                                    </span>
                                                                    <span className="text-[9px] text-slate-500 font-medium whitespace-nowrap ml-auto">
                                                                        ... Net {route.stops.length} stops
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Route metadata */}
                                                            <div className="flex items-center justify-between text-[10px] relative z-10 border-t border-white/5 pt-3 mt-auto">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Bus className="w-3 h-3 text-orange-500" />
                                                                    <span className="font-semibold" style={{ color: tokens.textPrimary }}>
                                                                        {busesOnRoute.length} <span className="font-medium text-slate-500 ml-0.5">BUS(ES)</span>
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
                                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                                    <div
                                        className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                                        style={{ backgroundColor: `${tokens.primaryOrange}15` }}
                                    >
                                        <ArrowRightLeft className="w-10 h-10" style={{ color: tokens.primaryOrange }} />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2" style={{ color: tokens.textPrimary }}>
                                        Select a Bus
                                    </h3>
                                    <p className="text-sm max-w-xs" style={{ color: tokens.textMuted }}>
                                        Choose a bus from the left panel to view available routes and stage a route assignment
                                    </p>
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                </div>

                {/* Staging Area */}
                <div className="w-full">
                    <RouteStagingArea
                        stagedAssignments={stagedAssignments}
                        onRemove={removeFromStaging}
                        onClearAll={clearAllStaging}
                        onConfirm={openConfirmModal}
                    />
                </div>

                {/* Confirmation Modal */}
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

                {/* Floating Finalization Card */}
                <AssignmentFinalizeCard
                    isVisible={showFinalizeCard}
                    count={netRouteAssignmentResult?.netChanges.size || 0}
                    entityType="bus"
                    onConfirm={performCommit}
                    onRevert={handleRevert}
                    processing={processing}
                    timerDuration={120}
                />

                {/* Reassignment History Modal */}
                <ReassignmentHistoryModal
                    open={showHistoryModal}
                    onOpenChange={setShowHistoryModal}
                    defaultType="route_reassignment"
                    onRefresh={fetchAllData}
                />
            </div>
        </TooltipProvider>
    );
}

// ============================================
// CURRENT ROUTE CARD COMPONENT
// ============================================

interface CurrentRouteCardProps {
    route: RouteData;
    bus: BusData;
}

function CurrentRouteCard({ route, bus }: CurrentRouteCardProps) {
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
                        <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <p className="font-semibold text-base" style={{ color: tokens.textPrimary }}>
                            {route.routeName}
                        </p>
                        <p className="text-xs" style={{ color: tokens.textMuted }}>
                            {route.totalStops || route.stops?.length || 0} stops
                        </p>
                    </div>
                </div>
                <Badge
                    className="text-xs"
                    style={{ backgroundColor: tokens.success, color: 'white' }}
                >
                    Current
                </Badge>
            </div>

            {/* Route Stops as horizontal timeline */}
            {route.stops && route.stops.length > 0 && (
                <div className="mb-3">
                    <p className="text-[10px] font-medium mb-2" style={{ color: tokens.textMuted }}>
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


        </div>
    );
}
