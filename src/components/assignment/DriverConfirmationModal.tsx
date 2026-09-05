"use client";

import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { ScrollArea,ScrollBar } from "@/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ConfirmationTableRow } from "@/lib/services/net-assignment-service";
import { cn } from "@/lib/utils";
import { AnimatePresence,motion } from "motion/react";
import {
	AlertTriangle,
	Bus,
	CheckCircle2,
	Download,
	Info,
	RefreshCw,
	Shield,
	Sparkles,
	X
} from "lucide-react";
import { useEffect } from "react";

// ============================================
// DESIGN TOKENS
// ============================================
const tokens = {
    primaryOrange: "#FF7A2D",
    primaryPurple: "#9333EA",
    primaryPink: "#DB2777",
    deepPurple: "#6B46C1",
    darkBg: "#0F1724",
    cardBg: "#0B1220",
    modalBg: "#0F172A",
    success: "#13A16A",
    warning: "#E6A700",
    error: "#EF4444",
    textPrimary: "#E6EEF2",
    textMuted: "#94A3B8",
    borderDark: "#1E293B",
    gradient: "linear-gradient(135deg, rgba(147, 51, 234, 0.15) 0%, rgba(219, 39, 119, 0.1) 100%)",
};

// ============================================
// TYPES
// ============================================

interface DriverConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onFinalConfirm: () => void;
    onRevert: () => void;
    confirmationRows: ConfirmationTableRow[];
    driverCount: number;
    hasNoNetChanges: boolean;
    removedNoOpCount: number;
    removedNoOpInfo: string[];
    processing?: boolean;
}

// ============================================
// MAIN COMPONENT
// ============================================

export function DriverConfirmationModal({
    isOpen,
    onClose,
    onFinalConfirm,
    onRevert,
    confirmationRows,
    driverCount,
    hasNoNetChanges,
    removedNoOpCount = 0,
    removedNoOpInfo = [],
    processing = false,
}: DriverConfirmationModalProps) {
    // Handle Cancel from review step
    const handleCancel = () => {
        onClose();
    };

    const handleProceed = () => {
        onFinalConfirm();
    };

    const handleDownload = () => {
        if (confirmationRows.length === 0) return;

        // Prepare CSV data
        const headers = ["Sl No", "Bus Affected", "Initially", "Initial Driver Impact", "Finally", "Final Driver Impact", "Status", "Details"];
        const csvRows = confirmationRows.map(row => [
            row.slNo,
            row.busAffected,
            row.initially,
            row.initialDriverImpact,
            row.finally,
            row.finalDriverImpact,
            row.status || "pending",
            row.infoTooltip
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(","));

        const csvContent = [headers.join(","), ...csvRows].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `assignment_review_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                handleCancel();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center"
                style={{ marginTop: "60px" }} // Clear navbar
                role="dialog"
                aria-modal="true"
                aria-labelledby="driver-confirm-modal-title"
            >
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={handleCancel}
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className={cn(
                        "relative flex flex-col rounded-2xl shadow-2xl border overflow-hidden",
                        "w-full max-h-[90vh] max-sm:max-w-[calc(100vw-1rem)]"
                    )}
                    style={{
                        backgroundColor: tokens.modalBg,
                        borderColor: tokens.borderDark,
                        maxWidth: "min(1250px, 95vw)",
                    }}
                >
                    {/* Close button */}
                    <button
                        onClick={handleCancel}
                        className="absolute top-4 right-4 z-10 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="w-5 h-5" style={{ color: tokens.textMuted }} />
                    </button>

                    {/* Header */}
                    <div
                        className="px-4 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0"
                        style={{
                            background: tokens.gradient,
                            borderColor: tokens.borderDark,
                        }}
                    >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:pr-10">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500"
                                >
                                    <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                                </div>
                                <div>
                                    <h2
                                        id="driver-confirm-modal-title"
                                        className="text-lg sm:text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent"
                                    >
                                        Confirm Assignments
                                    </h2>
                                    <p className="text-[10px] sm:text-xs mt-0.5" style={{ color: tokens.textMuted }}>
                                        Review {confirmationRows.length} change(s) before finalizing
                                    </p>
                                </div>
                            </div>

                            {/* Right Side Actions/Stats */}
                            <div className="flex items-center gap-4">
                                {confirmationRows.length > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleDownload}
                                        className="flex items-center gap-2 h-7 sm:h-8 px-2 sm:px-3 rounded-lg border border-white/10 hover:opacity-90 text-[9px] sm:text-[10px] font-medium transition-all shadow-sm text-white bg-gradient-to-r from-[#FF7A2D] to-[#fb923c]"
                                    >
                                        <Download className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                                        <span>Download Report</span>
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Summary Alert */}
                    <div
                        className="mx-3 sm:mx-6 mt-3 sm:mt-4 px-3 sm:px-4 py-2 sm:py-3 rounded-xl border flex-shrink-0"
                        style={{
                            backgroundColor: hasNoNetChanges ? `${tokens.success}10` : `${tokens.primaryOrange}10`,
                            borderColor: hasNoNetChanges ? `${tokens.success}30` : `${tokens.primaryOrange}30`,
                        }}
                    >
                        <div className="flex items-start gap-3">
                            {hasNoNetChanges ? (
                                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: tokens.success }} />
                            ) : (
                                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: tokens.primaryOrange }} />
                            )}
                            <div>
                                <p className="text-sm" style={{ color: tokens.textPrimary }}>
                                    {hasNoNetChanges
                                        ? "No net changes to apply. All staged operations cancel each other out."
                                        : `You are about to reassign ${driverCount} driver(s).`
                                    }
                                </p>
                                {removedNoOpCount > 0 && (
                                    <p className="text-xs mt-1" style={{ color: tokens.textMuted }}>
                                        <strong>Optimized:</strong> {removedNoOpCount} redundant operation(s) removed.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Confirmation Table */}
                    <div className="flex-1 min-h-0 px-3 sm:px-6 py-3 sm:py-4 overflow-hidden">
                        <ScrollArea className="h-full max-h-[calc(70vh-200px)]">
                            {confirmationRows.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 sm:py-12 text-center">
                                    <CheckCircle2 className="w-12 h-12 sm:w-16 sm:h-16 mb-3 sm:mb-4" style={{ color: tokens.success }} />
                                    <h3 className="text-base sm:text-lg font-semibold mb-1 sm:mb-2" style={{ color: tokens.textPrimary }}>
                                        No Net Changes
                                    </h3>
                                    <p className="text-[10px] sm:text-sm max-w-md" style={{ color: tokens.textMuted }}>
                                        All staged operations resulted in no actual changes.
                                        This can happen when drivers are swapped back to their original positions.
                                    </p>
                                    {removedNoOpInfo.length > 0 && (
                                        <div className="mt-4 text-left w-full max-w-md">
                                            <p className="text-[10px] font-semibold mb-1" style={{ color: tokens.textMuted }}>
                                                Eliminated operations:
                                            </p>
                                            <ul className="text-[10px] space-y-1">
                                                {removedNoOpInfo.map((info, idx) => (
                                                    <li key={idx} style={{ color: tokens.textMuted }}>
                                                        • {info}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="min-w-[800px]">
                                    <Table>
                                        <TableHeader>
                                            <TableRow style={{ backgroundColor: '#0D1520' }}>
                                                <TableHead className="text-[9px] font-semibold w-8 px-1 text-center" style={{ color: tokens.textMuted }}>
                                                    Sl.
                                                </TableHead>
                                                <TableHead className="text-[9px] font-semibold min-w-[100px] px-2 text-center" style={{ color: tokens.textMuted }}>
                                                    Bus
                                                </TableHead>
                                                <TableHead className="text-[9px] font-semibold min-w-[120px] px-2 text-center" style={{ color: tokens.textMuted }}>
                                                    Initially
                                                </TableHead>
                                                <TableHead className="text-[9px] font-semibold min-w-[150px] px-2 text-center" style={{ color: tokens.textMuted }}>
                                                    Initial Impact
                                                </TableHead>
                                                <TableHead className="text-[9px] font-semibold min-w-[120px] px-2 text-center" style={{ color: tokens.textMuted }}>
                                                    Finally
                                                </TableHead>
                                                <TableHead className="text-[9px] font-semibold min-w-[150px] px-2 text-center" style={{ color: tokens.textMuted }}>
                                                    Final Impact
                                                </TableHead>
                                                <TableHead className="text-[9px] font-semibold w-8 text-center px-1" style={{ color: tokens.textMuted }}>
                                                    Info
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {confirmationRows.map((row) => (
                                                <TableRow
                                                    key={row.slNo}
                                                    className={cn(
                                                        "transition-colors",
                                                        row.status === "error" && "bg-red-950/20"
                                                    )}
                                                    style={{ borderColor: tokens.borderDark }}
                                                >
                                                    {/* Sl. no */}
                                                    <TableCell className="text-[9px] font-medium px-1 py-3 text-center" style={{ color: tokens.textPrimary }}>
                                                        {row.slNo}
                                                    </TableCell>

                                                    {/* Bus Affected */}
                                                    <TableCell className="px-2 text-center">
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            <div
                                                                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                                                                style={{ backgroundColor: `${tokens.primaryPurple}20` }}
                                                            >
                                                                <Bus className="w-2.5 h-2.5" style={{ color: tokens.primaryPurple }} />
                                                            </div>
                                                            <p className="text-[10px] font-medium whitespace-nowrap" style={{ color: tokens.textPrimary }}>
                                                                {row.busAffected}
                                                            </p>
                                                        </div>
                                                    </TableCell>

                                                    {/* Initially */}
                                                    <TableCell className="px-2 text-center">
                                                        <p className="text-[10px] whitespace-nowrap" style={{ color: tokens.textMuted }}>
                                                            {row.initially}
                                                        </p>
                                                    </TableCell>

                                                    {/* Initial Impact */}
                                                    <TableCell className="px-2 text-center">
                                                        <div className="flex flex-wrap items-center justify-center gap-1 max-w-[200px] mx-auto">
                                                            <span
                                                                className="text-[9px] font-medium leading-tight"
                                                                style={{ color: tokens.primaryPurple }}
                                                            >
                                                                {row.initialDriverImpact}
                                                            </span>
                                                        </div>
                                                    </TableCell>

                                                    {/* Finally */}
                                                    <TableCell className="px-2 text-center">
                                                        <p className="text-[10px] font-medium whitespace-nowrap" style={{ color: tokens.success }}>
                                                            {row.finally}
                                                        </p>
                                                    </TableCell>

                                                    {/* Final Impact */}
                                                    <TableCell className="px-2 text-center">
                                                        <div className="flex flex-wrap items-center justify-center gap-1 max-w-[200px] mx-auto">
                                                            <span
                                                                className="text-[9px] font-medium leading-tight"
                                                                style={{ color: tokens.primaryPurple }}
                                                            >
                                                                {row.finalDriverImpact}
                                                            </span>
                                                        </div>
                                                    </TableCell>

                                                    {/* Info */}
                                                    <TableCell className="text-center px-1">
                                                        <HoverCard openDelay={100} closeDelay={50}>
                                                            <HoverCardTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-5 w-5 p-0 hover:bg-blue-500/20"
                                                                >
                                                                    <Info className="w-3 h-3 text-blue-400" />
                                                                </Button>
                                                            </HoverCardTrigger>
                                                            <HoverCardContent
                                                                side="left"
                                                                className="w-80 text-xs"
                                                                style={{
                                                                    backgroundColor: '#1E293B',
                                                                    color: tokens.textPrimary,
                                                                    borderColor: tokens.borderDark,
                                                                }}
                                                            >
                                                                <div className="space-y-2">
                                                                    <h4 className="font-semibold text-sm" style={{ color: tokens.primaryPurple }}>
                                                                        Assignment Details
                                                                    </h4>
                                                                    <p className="leading-relaxed">{row.infoTooltip}</p>
                                                                </div>
                                                            </HoverCardContent>
                                                        </HoverCard>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                            <ScrollBar orientation="horizontal" className="opacity-50" />
                        </ScrollArea>
                    </div>

                    {/* Footer */}
                    <div
                        className="px-4 sm:px-6 py-3 sm:py-4 border-t flex flex-col sm:flex-row justify-between items-center flex-shrink-0 gap-4"
                        style={{ borderColor: tokens.borderDark }}
                    >
                        <div className="flex items-center gap-2">
                            <Shield className="w-3.5 sm:w-4 h-3.5 sm:h-4" style={{ color: tokens.textMuted }} />
                            <span className="text-[10px] sm:text-xs" style={{ color: tokens.textMuted }}>
                                All changes are atomic and reversible until confirmed
                            </span>
                        </div>

                        <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
                            <Button
                                variant="outline"
                                onClick={handleCancel}
                                className="flex-1 sm:min-w-[100px] h-9 sm:h-10 border-gray-600 text-gray-400 hover:bg-gray-800 text-[11px] sm:text-xs"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleProceed}
                                disabled={hasNoNetChanges || confirmationRows.length === 0 || processing}
                                className="flex-[2] sm:min-w-[180px] h-9 sm:h-10 text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider sm:tracking-widest shadow-lg shadow-purple-500/20 transition-all active:scale-95"
                            >
                                {processing ? (
                                    <>
                                        <RefreshCw className="w-3 sm:w-4 h-3 sm:h-4 mr-1.5 sm:mr-2 animate-spin" />
                                        Committing...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-3 sm:w-4 h-3 sm:h-4 mr-1.5 sm:mr-2" />
                                        Proceed to Finalize
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence >
    );
}

export default DriverConfirmationModal;
