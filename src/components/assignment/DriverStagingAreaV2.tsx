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
import { cn } from "@/lib/utils";
import { AnimatePresence,motion } from "motion/react";
import {
	ArrowRightLeft,
	Bookmark,
	Bus,
	CheckCircle2,
	Info,
	Shield,
	Trash2,
	XCircle,
	Zap,
} from "lucide-react";

// ============================================
// DESIGN TOKENS
// ============================================
const tokens = {
    primaryOrange: "#FF7A2D",
    primaryOrangeGlow: "rgba(255, 122, 45, 0.12)",
    deepPurple: "#6B46C1",
    primaryPurple: "#9333EA",
    darkBg: "#0F172A",
    cardBg: "#0B1220",
    headerBg: "linear-gradient(135deg, rgba(255, 122, 45, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)",
    success: "#10B981",
    reserved: "#F59E0B",
    swapped: "#8B5CF6",
    swap: "#FB923C",
    info: "#3B82F6",
    textPrimary: "#F8FAFC",
    textSecondary: "#E2E8F0",
    textMuted: "#94A3B8",
    borderDark: "#1E293B",
    borderLight: "rgba(255, 255, 255, 0.06)",
};

// ============================================
// TYPES
// ============================================

export interface StagedDriverChange {
    id: string;
    busId: string;
    busNumber: string;
    busShift: string; // Morning | Evening | Both
    action: "assign" | "reserve" | "swap" | "assign_both" | "make_reserved" | "split";
    newDriver: {
        id: string;
        name: string;
        code: string;
        shift: string;
    };
    oldDrivers: Array<{
        id: string;
        name: string;
        code: string;
        shift: string;
        impact: "reserved" | "swapped" | "split";
    }>;
    targetSlot: "Morning" | "Evening" | "Both";
    status: "pending" | "committed" | "failed";
    errorMessage?: string;
}

// ============================================
// MAIN COMPONENT
// ============================================

interface DriverStagingAreaV2Props {
    stagedChanges: StagedDriverChange[];
    onRemove: (id: string) => void;
    onClearAll: () => void;
    onConfirm: () => void;
    isConfirmDisabled?: boolean;
}

export function DriverStagingAreaV2({
    stagedChanges,
    onRemove,
    onClearAll,
    onConfirm,
    isConfirmDisabled = false,
}: DriverStagingAreaV2Props) {
    const isEmpty = stagedChanges.length === 0;

    const getActionLabel = (action: string): string => {
        switch (action) {
            case "assign": return "Assign";
            case "reserve": return "Move to Reserved";
            case "swap": return "Swap";
            case "assign_both": return "Assign Both Shifts";
            case "make_reserved": return "Make Reserved";
            default: return action;
        }
    };

    const getActionColor = (action: string): string => {
        switch (action) {
            case "assign": return tokens.success;
            case "reserve": return tokens.reserved;
            case "swap": return tokens.swapped;
            case "assign_both": return tokens.primaryOrange;
            case "make_reserved": return tokens.reserved;
            default: return tokens.textMuted;
        }
    };

    const getInfoTooltip = (change: StagedDriverChange): string => {
        if (change.action === "make_reserved") {
            return `Driver ${change.newDriver.name} (${change.newDriver.code}) is being detached from Bus ${change.busNumber} and moved to the Reserved Pool.`;
        }
        if (change.action === "assign" || change.action === "assign_both") {
            return `Driver ${change.newDriver.name} (${change.newDriver.code}) is being assigned to Bus ${change.busNumber} for ${change.targetSlot} shift. The bus was previously vacant.`;
        }
        if (change.action === "reserve") {
            const oldNames = change.oldDrivers.map(d => d.name).join(", ");
            return `Driver ${change.newDriver.name} is replacing ${oldNames} on Bus ${change.busNumber} (${change.targetSlot} shift). Previous operator(s) will be moved to Reserved Pool.`;
        }
        if (change.action === "swap") {
            const swapTarget = change.oldDrivers[0];
            return `Driver ${change.newDriver.name} is swapping with ${swapTarget?.name || "Unknown"} on Bus ${change.busNumber}. Both drivers exchange their assignments.`;
        }
        return "Driver assignment change.";
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
                                <Shield className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                            </div>
                            <div>
                                <h3 className="text-sm sm:text-lg font-bold tracking-tight" style={{ color: tokens.textPrimary }}>
                                    Staging Area
                                </h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: tokens.primaryOrange }} />
                                    <p className="text-xs sm:text-sm font-medium" style={{ color: tokens.textMuted }}>
                                        {stagedChanges.length} {stagedChanges.length === 1 ? 'change' : 'changes'} staged • Not committed yet
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
                                <span>Confirm All</span>
                            </Button>
                        </div>
                    </div>

                    {/* Table */}
                    <ScrollArea className="w-full">
                        <div className="min-w-[700px] max-h-[400px] sm:max-h-[500px]">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent border-b" style={{ borderColor: tokens.borderLight, backgroundColor: "rgba(0,0,0,0.2)" }}>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold w-10 text-center" style={{ color: tokens.textMuted }}>Sl.</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[100px] text-center" style={{ color: tokens.textMuted }}>Bus</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[80px] text-center" style={{ color: tokens.textMuted }}>Action</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[120px] text-center" style={{ color: tokens.textMuted }}>New Driver</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[80px] text-center" style={{ color: tokens.textMuted }}>Shift</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[130px] text-center" style={{ color: tokens.textMuted }}>Old Driver(s)</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold min-w-[80px] text-center" style={{ color: tokens.textMuted }}>Impact</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-1 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-center w-10" style={{ color: tokens.textMuted }}>Info</TableHead>
                                        <TableHead className="py-2 sm:py-3 px-2 text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-center w-14" style={{ color: tokens.textMuted }}>Del</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    <AnimatePresence mode="popLayout">
                                        {stagedChanges.map((change, idx) => {
                                            const actionColor = getActionColor(change.action);

                                            return (
                                                <motion.tr
                                                    key={change.id}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    layout
                                                    className="group transition-colors border-b last:border-0 hover:bg-white/[0.02]"
                                                    style={{ borderColor: tokens.borderLight }}
                                                >
                                                    {/* Sl. */}
                                                    <TableCell className="py-2 sm:py-3 px-2">
                                                        <span className="flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-bold border"
                                                            style={{ borderColor: tokens.borderLight, color: tokens.textMuted, backgroundColor: "rgba(255,255,255,0.03)" }}>
                                                            {idx + 1}
                                                        </span>
                                                    </TableCell>

                                                    {/* Bus */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                                                                style={{ backgroundColor: tokens.primaryOrangeGlow }}>
                                                                <Bus className="w-3 h-3" style={{ color: tokens.primaryOrange }} />
                                                            </div>
                                                            <div>
                                                                <p className="text-[10px] font-semibold whitespace-nowrap" style={{ color: tokens.textPrimary }}>
                                                                    {change.busNumber}
                                                                </p>
                                                                <p className="text-[8px]" style={{ color: tokens.textMuted }}>
                                                                    {change.busShift}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </TableCell>

                                                    {/* Action */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        <Badge
                                                            className="text-[8px] px-1.5 py-0.5 border-none whitespace-nowrap"
                                                            style={{
                                                                backgroundColor: `${actionColor}20`,
                                                                color: actionColor,
                                                            }}
                                                        >
                                                            {change.action === "assign_both" && <Zap className="w-2.5 h-2.5 mr-0.5" />}
                                                            {change.action === "swap" && <ArrowRightLeft className="w-2.5 h-2.5 mr-0.5" />}
                                                            {change.action === "reserve" && <Bookmark className="w-2.5 h-2.5 mr-0.5" />}
                                                            {getActionLabel(change.action)}
                                                        </Badge>
                                                    </TableCell>

                                                    {/* New Driver */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        {change.action === "make_reserved" ? (
                                                            <span className="text-[9px] font-medium italic" style={{ color: tokens.textMuted }}>—</span>
                                                        ) : (
                                                            <div>
                                                                <p className="text-[10px] font-semibold" style={{ color: tokens.success }}>
                                                                    {change.newDriver.name}
                                                                </p>
                                                                <p className="text-[8px]" style={{ color: tokens.textMuted }}>
                                                                    {change.newDriver.code}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </TableCell>

                                                    {/* Target Shift */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        <Badge
                                                            className="text-[8px] px-1.5 py-0 border-none"
                                                            style={{
                                                                backgroundColor: change.targetSlot === "Both"
                                                                    ? `${tokens.primaryOrange}20`
                                                                    : `${tokens.primaryPurple}15`,
                                                                color: change.targetSlot === "Both"
                                                                    ? tokens.primaryOrange
                                                                    : tokens.primaryPurple,
                                                            }}
                                                        >
                                                            {change.targetSlot}
                                                        </Badge>
                                                    </TableCell>

                                                    {/* Old Driver(s) */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        {change.oldDrivers.length === 0 ? (
                                                            <span className="text-[9px] italic" style={{ color: tokens.textMuted }}>
                                                                Vacant
                                                            </span>
                                                        ) : (
                                                            <div className="space-y-0.5">
                                                                {change.oldDrivers.map(d => (
                                                                    <p key={d.id} className="text-[9px] font-medium" style={{ color: tokens.textMuted }}>
                                                                        {d.name} ({d.code})
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </TableCell>

                                                    {/* Impact */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        {change.oldDrivers.length === 0 ? (
                                                            <span className="text-[9px] italic" style={{ color: tokens.textMuted }}>—</span>
                                                        ) : (
                                                            <div className="space-y-0.5">
                                                                {change.oldDrivers.map(d => (
                                                                    <Badge
                                                                        key={d.id}
                                                                        className="text-[7px] px-1 py-0 border-none block mx-auto"
                                                                        style={{
                                                                            backgroundColor: d.impact === "reserved" ? `${tokens.reserved}20` : `${tokens.swapped}20`,
                                                                            color: d.impact === "reserved" ? tokens.reserved : tokens.swapped,
                                                                        }}
                                                                    >
                                                                        {d.impact === "reserved" ? "→ Reserved" : "→ Swapped"}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </TableCell>

                                                    {/* Info */}
                                                    <TableCell className="py-2 sm:py-3 px-1 text-center">
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="inline-flex items-center justify-center w-6 h-6 rounded-full hover:bg-white/5 cursor-help transition-colors">
                                                                        <Info className="w-3 h-3 text-blue-400/60" />
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent side="top" className="w-72 p-3 bg-[#1e293b] border-[#334155] rounded-xl text-xs shadow-2xl">
                                                                    <div className="space-y-1.5">
                                                                        <p className="font-bold text-blue-400 tracking-tight">Assignment Details</p>
                                                                        <p className="leading-relaxed text-slate-300 font-medium">{getInfoTooltip(change)}</p>
                                                                    </div>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </TableCell>

                                                    {/* Delete */}
                                                    <TableCell className="py-2 sm:py-3 px-2 text-center">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => onRemove(change.id)}
                                                            className="h-7 w-7 p-0 rounded-lg hover:bg-red-500/10 group/btn"
                                                        >
                                                            <Trash2 className="w-3 h-3 text-red-500/60 group-hover/btn:text-red-500 transition-colors" />
                                                        </Button>
                                                    </TableCell>
                                                </motion.tr>
                                            );
                                        })}
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

export default DriverStagingAreaV2;
