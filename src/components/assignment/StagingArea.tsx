"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea,ScrollBar } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { StagedDriverAssignment,StagedRouteAssignment } from "@/lib/services/assignment-service";
import { cn } from "@/lib/utils";
import { AnimatePresence,motion } from "motion/react";
import {
	ArrowRightLeft,
	Bus,
	CheckCircle2,
	Info,
	MapPin,
	Route,
	Trash2,
	XCircle
} from "lucide-react";

// ============================================
// DESIGN TOKENS
// ============================================
const tokens = {
    primaryOrange: "#FF7A2D",
    primaryOrangeGlow: "rgba(255, 122, 45, 0.12)",
    deepPurple: "#6B46C1",
    darkBg: "#0F172A",
    cardBg: "#0B1220",
    headerBg: "linear-gradient(135deg, rgba(255, 122, 45, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)",
    rowHover: "rgba(255, 255, 255, 0.02)",
    success: "#10B981",
    reserved: "#F59E0B",
    swapped: "#8B5CF6",
    info: "#3B82F6",
    textPrimary: "#F8FAFC",
    textSecondary: "#E2E8F0",
    textMuted: "#94A3B8",
    borderDark: "#1E293B",
    borderLight: "rgba(255, 255, 255, 0.06)",
};

// ============================================
// DRIVER STAGING AREA - PREMIUM REDESIGN
// ============================================
interface DriverStagingAreaProps {
    stagedAssignments: StagedDriverAssignment[];
    onRemove: (id: string) => void;
    onClearAll: () => void;
    onConfirm: () => void;
    isConfirmDisabled?: boolean;
}

export function DriverStagingArea({
    stagedAssignments,
    onRemove,
    onClearAll,
    onConfirm,
    isConfirmDisabled = false,
}: DriverStagingAreaProps) {
    const isEmpty = stagedAssignments.length === 0;

    const getInfoTooltip = (assignment: StagedDriverAssignment): string => {
        const busNumber = assignment.newBusNumber === "Reserved" ? assignment.oldBusNumber : assignment.newBusNumber;
        const driverName = assignment.driverName;
        const driverCode = assignment.driverCode;
        const prevOperator = assignment.previousOperatorName;
        const affect = assignment.affectOnPreviousOperator;

        if (assignment.newBusNumber === "Reserved") {
            return `Driver ${driverName} (${driverCode}) is being detached from Bus ${busNumber} and moved to the Reserved Pool. The bus will now be vacant.`;
        }

        let base = `Driver ${driverName} (${driverCode}) is being assigned to Bus ${busNumber}. `;

        if (prevOperator && prevOperator !== "None") {
            base += `The current operator, ${prevOperator}, will be `;
            if (affect === "reserved") base += "moved to the Reserved Pool.";
            else if (affect === "swapped") base += `swapped to Bus ${assignment.swappedToBusNumber}.`;
            else base += "detached from this bus.";
        } else {
            base += "This bus was previously vacant.";
        }

        return base;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
                "w-full max-sm:max-w-[calc(100vw-3rem)] mx-auto sm:w-full rounded-2xl border backdrop-blur-sm transition-all duration-500 overflow-hidden",
                isEmpty ? "p-4 shadow-sm" : "shadow-2xl"
            )}
            style={{
                backgroundColor: tokens.cardBg,
                borderColor: tokens.borderDark
            }}
        >
            {isEmpty ? (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div
                            className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center shadow-inner"
                            style={{ backgroundColor: tokens.primaryOrangeGlow }}
                        >
                            <ArrowRightLeft className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: tokens.primaryOrange }} />
                        </div>
                        <div>
                            <p className="text-xs sm:text-sm font-medium" style={{ color: tokens.textSecondary }}>
                                No assignments staged
                            </p>
                            <p className="text-[10px] sm:text-xs" style={{ color: tokens.textMuted }}>
                                Select a driver and a bus to start staging changes.
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Header */}
                    <div
                        className="relative flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-5 border-b gap-3"
                        style={{
                            background: tokens.headerBg,
                            borderColor: tokens.borderLight
                        }}
                    >
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div
                                className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg sm:rounded-2xl flex items-center justify-center shadow-lg transform transition-transform hover:scale-105"
                                style={{
                                    backgroundColor: tokens.primaryOrange,
                                    boxShadow: `0 8px 20px ${tokens.primaryOrange}40`
                                }}
                            >
                                <ArrowRightLeft className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-lg font-bold tracking-tight" style={{ color: tokens.textPrimary }}>
                                    Staging Area
                                </h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: tokens.primaryOrange }} />
                                    <p className="text-xs sm:text-sm font-medium" style={{ color: tokens.textMuted }}>
                                        {stagedAssignments.length} {stagedAssignments.length === 1 ? 'assignment' : 'assignments'} staged
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClearAll}
                                className="flex-1 sm:flex-initial h-8 sm:h-10 px-2 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"
                            >
                                <XCircle className="w-4 h-4 mr-2" />
                                <span className="sm:inline">Cancel All</span>
                                <span className="sm:hidden text-[10px]">Cancel</span>
                            </Button>
                            <Button
                                size="sm"
                                onClick={onConfirm}
                                disabled={isConfirmDisabled}
                                className="flex-1 sm:flex-initial h-8 sm:h-10 px-3 sm:px-6 rounded-xl text-xs sm:text-sm font-bold text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: tokens.primaryOrange,
                                    boxShadow: `0 4px 15px ${tokens.primaryOrange}40`
                                }}
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                <span>Confirm</span>
                            </Button>
                        </div>
                    </div>

                    {/* Table */}
                    <ScrollArea className="w-full">
                        <div className="min-w-[800px] max-h-[400px] sm:max-h-[500px]">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent border-b" style={{ borderColor: tokens.borderLight, backgroundColor: "rgba(0,0,0,0.2)" }}>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold w-10 text-center" style={{ color: tokens.textMuted }}>Sl.</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[100px] text-center" style={{ color: tokens.textMuted }}>Bus</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[120px] text-center" style={{ color: tokens.textMuted }}>Initially</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[150px] text-center" style={{ color: tokens.textMuted }}>Initial Impact</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[120px] text-center" style={{ color: tokens.textMuted }}>Finally</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[150px] text-center" style={{ color: tokens.textMuted }}>Final Impact</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-0.5 sm:px-1 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-center w-12" style={{ color: tokens.textMuted }}>Info</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 sm:px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-center w-16" style={{ color: tokens.textMuted }}>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    <AnimatePresence mode="popLayout">
                                        {stagedAssignments.map((assignment, idx) => (
                                            <motion.tr
                                                key={assignment.id}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                layout
                                                className="group transition-colors border-b last:border-0 hover:bg-white/[0.02]"
                                                style={{ borderColor: tokens.borderLight }}
                                            >
                                                {/* Sl. no */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2">
                                                    <span className="flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full text-[8px] sm:text-[9px] font-bold border"
                                                        style={{ borderColor: tokens.borderLight, color: tokens.textMuted, backgroundColor: "rgba(255,255,255,0.03)" }}>
                                                        {idx + 1}
                                                    </span>
                                                </TableCell>

                                                {/* Bus Affected - Format: Bus-X (AS-01-...) */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                                                    <div className="flex items-center justify-center gap-1 sm:gap-2">
                                                        <div
                                                            className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                                                            style={{ backgroundColor: tokens.primaryOrangeGlow }}
                                                        >
                                                            <Bus className="w-3 h-3 sm:w-3.5 sm:h-3.5" style={{ color: tokens.primaryOrange }} />
                                                        </div>
                                                        <p className="text-[10px] sm:text-[11px] font-semibold whitespace-nowrap" style={{ color: tokens.textPrimary }}>
                                                            {assignment.newBusNumber === "Reserved" && assignment.oldBusNumber
                                                                ? assignment.oldBusNumber
                                                                : assignment.newBusNumber}
                                                        </p>
                                                    </div>
                                                </TableCell>

                                                {/* Initially - Bus state before change */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                                                    {(() => {
                                                        const isDetach = assignment.newBusNumber === "Reserved";
                                                        const hasPrevOp = assignment.previousOperatorName && assignment.previousOperatorName !== "None";

                                                        if (isDetach || hasPrevOp) {
                                                            const name = isDetach ? assignment.driverName : assignment.previousOperatorName;
                                                            const code = isDetach ? assignment.driverCode : assignment.previousOperatorCode;
                                                            return (
                                                                <p className="text-[9px] sm:text-[10px]" style={{ color: tokens.textMuted }}>
                                                                    Operated by {name} ({code})
                                                                </p>
                                                            );
                                                        }
                                                        return (
                                                            <Badge
                                                                className="rounded-md px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-medium border-0"
                                                                style={{ backgroundColor: "rgba(107, 114, 128, 0.15)", color: "#9CA3AF" }}
                                                            >
                                                                No operator (Vacant)
                                                            </Badge>
                                                        );
                                                    })()}
                                                </TableCell>

                                                {/* Initial Driver Impact */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                                                    {(() => {
                                                        const busLabel = (assignment.newBusNumber === "Reserved" && assignment.oldBusNumber)
                                                            ? assignment.oldBusNumber
                                                            : assignment.newBusNumber;

                                                        // If making driver reserved (detach)
                                                        if (assignment.newBusNumber === "Reserved" && assignment.oldBusNumber) {
                                                            return (
                                                                <span className="text-[8px] sm:text-[9px] font-medium" style={{ color: tokens.reserved }}>
                                                                    {assignment.oldBusNumber} → Reserved Pool
                                                                </span>
                                                            );
                                                        }

                                                        // If there's a previous operator being displaced
                                                        if (assignment.previousOperatorName && assignment.previousOperatorName !== "None") {
                                                            if (assignment.affectOnPreviousOperator === "reserved") {
                                                                return (
                                                                    <span className="text-[8px] sm:text-[9px] font-medium" style={{ color: tokens.reserved }}>
                                                                        {busLabel} → Reserved Pool
                                                                    </span>
                                                                );
                                                            }
                                                            if (assignment.affectOnPreviousOperator === "swapped") {
                                                                return (
                                                                    <span className="text-[8px] sm:text-[9px] font-medium" style={{ color: tokens.swapped }}>
                                                                        {busLabel} → {assignment.swappedToBusNumber}
                                                                    </span>
                                                                );
                                                            }
                                                        }

                                                        return (
                                                            <span className="text-[8px] sm:text-[9px] font-medium italic" style={{ color: tokens.textMuted }}>
                                                                No change
                                                            </span>
                                                        );
                                                    })()}
                                                </TableCell>

                                                {/* Finally - Bus state after change */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                                                    {assignment.newBusNumber === "Reserved" ? (
                                                        <Badge
                                                            className="rounded-md px-1.5 sm:px-2 py-0.5 text-[8px] sm:text-[9px] font-medium border-0"
                                                            style={{ backgroundColor: "rgba(107, 114, 128, 0.15)", color: "#9CA3AF" }}
                                                        >
                                                            No operator (Vacant)
                                                        </Badge>
                                                    ) : (
                                                        <p className="text-[9px] sm:text-[10px] font-medium" style={{ color: tokens.success }}>
                                                            Operated by {assignment.driverName} ({assignment.driverCode})
                                                        </p>
                                                    )}
                                                </TableCell>

                                                {/* Final Driver Impact */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                                                    {(() => {
                                                        const busLabel = assignment.newBusNumber;

                                                        // If the bus will be vacant
                                                        if (busLabel === "Reserved") {
                                                            return (
                                                                <span className="text-[8px] sm:text-[9px] font-medium italic" style={{ color: tokens.textMuted }}>
                                                                    No change
                                                                </span>
                                                            );
                                                        }

                                                        // Driver origin
                                                        const driverOrigin = assignment.driverPreviousState === "reserved"
                                                            ? "Reserved Pool"
                                                            : assignment.driverPreviousBusNumber || "Reserved Pool";

                                                        return (
                                                            <span className="text-[8px] sm:text-[9px] font-medium" style={{ color: tokens.info }}>
                                                                {driverOrigin} → {busLabel}
                                                            </span>
                                                        );
                                                    })()}
                                                </TableCell>

                                                {/* Final Driver Impact */}
                                                <TableCell className="py-2 sm:py-3 px-0.5 sm:px-1 text-center">
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full hover:bg-white/5 cursor-help transition-colors">
                                                                    <Info className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-400/60" />
                                                                </div>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="w-72 p-3 bg-[#1e293b] border-[#334155] rounded-xl text-xs shadow-2xl">
                                                                <div className="space-y-1.5">
                                                                    <p className="font-bold text-blue-400 tracking-tight">Assignment Details</p>
                                                                    <p className="leading-relaxed text-slate-300 font-medium">{getInfoTooltip(assignment)}</p>
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                </TableCell>

                                                {/* Actions */}
                                                <TableCell className="py-2 sm:py-3 px-1 sm:px-2 text-center">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onRemove(assignment.id)}
                                                        className="h-7 w-7 sm:h-8 sm:w-8 p-0 rounded-lg hover:bg-red-500/10 group/btn"
                                                    >
                                                        <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-500/60 group-hover/btn:text-red-500 transition-colors" />
                                                    </Button>
                                                </TableCell>
                                            </motion.tr>
                                        ))}
                                    </AnimatePresence>
                                </TableBody>
                            </Table>
                        </div>
                        <ScrollBar orientation="horizontal" className="opacity-50" />
                    </ScrollArea>
                </>
            )}
        </motion.div>
    );
}

// ============================================
// ROUTE STAGING AREA - PREMIUM REDESIGN
// ============================================
interface RouteStagingAreaProps {
    stagedAssignments: StagedRouteAssignment[];
    onRemove: (id: string) => void;
    onClearAll: () => void;
    onConfirm: () => void;
    isConfirmDisabled?: boolean;
}

export function RouteStagingArea({
    stagedAssignments,
    onRemove,
    onClearAll,
    onConfirm,
    isConfirmDisabled = false,
}: RouteStagingAreaProps) {
    const isEmpty = stagedAssignments.length === 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
                "w-full max-sm:max-w-[calc(100vw-3rem)] mx-auto sm:w-full rounded-2xl border backdrop-blur-sm transition-all duration-500 overflow-hidden",
                isEmpty ? "p-4 shadow-sm" : "shadow-2xl"
            )}
            style={{
                backgroundColor: tokens.cardBg,
                borderColor: tokens.borderDark
            }}
        >
            {isEmpty ? (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div
                            className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center shadow-inner"
                            style={{ backgroundColor: tokens.primaryOrangeGlow }}
                        >
                            <Route className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: tokens.primaryOrange }} />
                        </div>
                        <div>
                            <p className="text-xs sm:text-sm font-medium" style={{ color: tokens.textSecondary }}>
                                No route changes staged
                            </p>
                            <p className="text-[10px] sm:text-xs" style={{ color: tokens.textMuted }}>
                                Select a bus and a route to start staging updates.
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* Header */}
                    <div
                        className="relative flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-5 border-b gap-3"
                        style={{
                            background: tokens.headerBg,
                            borderColor: tokens.borderLight
                        }}
                    >
                        <div className="flex items-center gap-3 sm:gap-4">
                            <div
                                className="w-8 h-8 sm:w-12 sm:h-12 rounded-lg sm:rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:scale-105"
                                style={{
                                    backgroundColor: tokens.primaryOrange,
                                    boxShadow: `0 8px 20px ${tokens.primaryOrange}40`
                                }}
                            >
                                <Route className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-lg font-bold tracking-tight" style={{ color: tokens.textPrimary }}>
                                    Route Staging Area
                                </h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: tokens.primaryOrange }} />
                                    <p className="text-xs sm:text-sm font-medium" style={{ color: tokens.textMuted }}>
                                        {stagedAssignments.length} {stagedAssignments.length === 1 ? 'update' : 'updates'} staged
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onClearAll}
                                className="flex-1 sm:flex-initial h-8 sm:h-10 px-2 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all overflow-hidden bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20"
                            >
                                <XCircle className="w-4 h-4 mr-2 shrink-0" />
                                <span className="sm:inline">Cancel All</span>
                                <span className="sm:hidden text-[10px]">Cancel</span>
                            </Button>
                            <Button
                                size="sm"
                                onClick={onConfirm}
                                disabled={isConfirmDisabled}
                                className="flex-1 sm:flex-initial h-8 sm:h-10 px-3 sm:px-6 rounded-xl text-xs sm:text-sm font-bold text-white transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: tokens.primaryOrange,
                                    boxShadow: `0 4px 15px ${tokens.primaryOrange}40`
                                }}
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />
                                <span>Confirm</span>
                            </Button>
                        </div>
                    </div>

                    <ScrollArea className="w-full">
                        <div className="min-w-[800px] max-h-[400px] sm:max-h-[500px]">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent border-b" style={{ borderColor: tokens.borderLight, backgroundColor: "rgba(0,0,0,0.2)" }}>
                                        <TableHead className="py-2 sm:py-4 px-2 sm:px-6 text-[10px] sm:text-[11px] uppercase tracking-wider font-bold" style={{ color: tokens.textMuted }}>#</TableHead>
                                        <TableHead className="py-2 sm:py-4 px-2 sm:px-4 text-[10px] sm:text-[11px] uppercase tracking-wider font-bold" style={{ color: tokens.textMuted }}>Vehicle</TableHead>
                                        <TableHead className="py-2 sm:py-4 px-2 sm:px-4 text-[10px] sm:text-[11px] uppercase tracking-wider font-bold" style={{ color: tokens.textMuted }}>From Route</TableHead>
                                        <TableHead className="py-2 sm:py-4 px-2 sm:px-4 text-[10px] sm:text-[11px] uppercase tracking-wider font-bold" style={{ color: tokens.textMuted }}>To Route</TableHead>
                                        <TableHead className="py-2 sm:py-4 px-2 sm:px-4 text-[10px] sm:text-[11px] uppercase tracking-wider font-bold" style={{ color: tokens.textMuted }}>Details</TableHead>
                                        <TableHead className="py-2 sm:py-4 px-2 sm:px-6 text-[10px] sm:text-[11px] uppercase tracking-wider font-bold text-right" style={{ color: tokens.textMuted }}>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    <AnimatePresence mode="popLayout">
                                        {stagedAssignments.map((assignment, idx) => (
                                            <motion.tr
                                                key={assignment.id}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                layout
                                                className="group transition-colors border-b last:border-0 hover:bg-white/[0.02]"
                                                style={{ borderColor: tokens.borderLight }}
                                            >
                                                <TableCell className="py-2.5 sm:py-5 px-2 sm:px-6">
                                                    <span className="flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full text-[9px] sm:text-[10px] font-bold border"
                                                        style={{ borderColor: tokens.borderLight, color: tokens.textMuted, backgroundColor: "rgba(255,255,255,0.03)" }}>
                                                        {idx + 1}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2.5 sm:py-5 px-2 sm:px-4">
                                                    <div className="flex items-center gap-2 sm:gap-3">
                                                        <div
                                                            className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 shadow-inner group-hover:scale-110 transition-transform"
                                                            style={{ backgroundColor: tokens.primaryOrangeGlow }}
                                                        >
                                                            <Bus className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5" style={{ color: tokens.primaryOrange }} />
                                                        </div>
                                                        <div>
                                                            <p className="text-xs sm:text-sm font-bold tracking-tight" style={{ color: tokens.textPrimary }}>{assignment.busNumber}</p>
                                                            <p className="text-[9px] sm:text-[10px] font-medium opacity-50" style={{ color: tokens.textMuted }}>{assignment.busCode}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2.5 sm:py-5 px-2 sm:px-4">
                                                    {assignment.oldRouteName ? (
                                                        <div className="flex items-center px-2 sm:px-3 py-1 bg-red-500/5 border border-red-500/20 rounded-lg">
                                                            <span className="text-[10px] sm:text-xs font-medium text-red-200/60 line-through">
                                                                {assignment.oldRouteName}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] sm:text-xs font-medium italic opacity-30" style={{ color: tokens.textMuted }}>Unassigned</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="py-2.5 sm:py-5 px-2 sm:px-4">
                                                    <div className="flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                                                        <Route className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-400" />
                                                        <span className="text-[10px] sm:text-xs font-bold text-emerald-100">
                                                            {assignment.newRouteName}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2.5 sm:py-5 px-2 sm:px-4">
                                                    <Badge
                                                        className="rounded-lg px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-bold border-0 shadow-sm"
                                                        style={{
                                                            backgroundColor: tokens.primaryOrangeGlow,
                                                            color: tokens.primaryOrange
                                                        }}
                                                    >
                                                        <MapPin className="w-2.5 sm:w-3 h-2.5 sm:h-3 mr-1 sm:mr-1.5" />
                                                        {assignment.newStopCount} stops
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="py-2.5 sm:py-5 px-2 sm:px-6 text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => onRemove(assignment.id)}
                                                        className="h-7 w-7 sm:h-9 sm:w-9 p-0 rounded-xl hover:bg-red-500/10 group/del"
                                                    >
                                                        <Trash2 className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-red-400/60 group-hover/del:text-red-400 transition-colors" />
                                                    </Button>
                                                </TableCell>
                                            </motion.tr>
                                        ))}
                                    </AnimatePresence>
                                </TableBody>
                            </Table>
                        </div>
                        <ScrollBar orientation="horizontal" className="opacity-50" />
                    </ScrollArea>
                </>
            )}
        </motion.div>
    );
}
