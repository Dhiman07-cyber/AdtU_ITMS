"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { normalizeShift } from "@/lib/utils/shift-utils";
import { AnimatePresence,motion } from "framer-motion";
import {
	ArrowRightLeft,
	Bookmark,
	Bus,
	CheckCircle2,
	User,
	Users,
	X,
	Zap
} from "lucide-react";
import { useEffect,useMemo,useState } from "react";

// ============================================
// DESIGN TOKENS
// ============================================
const tokens = {
    primaryCyan: "#22D3EE",
    primaryBlue: "#3B82F6",
    cyanGradientFrom: "#06B6D4",
    cyanGradientTo: "#3B82F6",
    cyanLight: "rgba(34, 211, 238, 0.1)",
    deepPurple: "#6B46C1",
    darkBg: "#020617",
    cardBg: "#0B1222",
    modalBg: "#0F172A",
    success: "#10B981",

    // Operation specific colors (Premium Palette)
    conflict: "#F43F5E", // Rose 500 for conflict
    reserved: "#F59E0B", // Amber 500 for reserved
    swap: "#6366F1",     // Indigo 500 for swap
    neutral: "#94A3B8",  // Slate 400 for neutral

    textPrimary: "#F8FAFC",
    textSecondary: "#E2E8F0",
    textMuted: "#94A3B8",
    borderDark: "#1E293B",
    borderSelected: "#22D3EE",
    glassBg: "rgba(255, 255, 255, 0.03)",
    lightGreen: "#4ADE80",
};

// ============================================
// TYPES
// ============================================

export interface DriverSlotInfo {
    id: string;
    name: string;
    code: string;
    shift: string;
    photoUrl?: string;
}

export interface ShiftSlotPromptProps {
    isOpen: boolean;
    onClose: () => void;
    onStage: (payload: ShiftSlotPayload) => void;

    // Context
    busId: string;
    busNumber: string;
    busShift: "Morning" | "Evening" | "Both";
    routeName?: string;

    // New driver being assigned
    newDriver: DriverSlotInfo;

    // Existing driver(s) on the bus (0, 1, or 2)
    existingDrivers: DriverSlotInfo[];

    // If no existing drivers, this is a simple assign case (CASE 1)
    // If 1 existing driver, show reserve/swap/cancel (CASE 2.1)
    // If 2 existing drivers, show reserve/swap/cancel (CASE 2.2)
}

export type SlotAction = "assign" | "reserve" | "swap" | "assign_both" | "split";

export interface ShiftSlotPayload {
    action: SlotAction;
    busId: string;
    busNumber: string;
    busShift: string;
    newDriver: DriverSlotInfo;
    targetSlot: "Morning" | "Evening" | "Both";
    oldDrivers: Array<DriverSlotInfo & { impact: "reserved" | "swapped" | "split" }>;
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ShiftSlotPrompt({
    isOpen,
    onClose,
    onStage,
    busId,
    busNumber,
    busShift,
    routeName,
    newDriver,
    existingDrivers,
}: ShiftSlotPromptProps) {
    // Step state: 'choose_action' | 'configure_slot'
    const [step, setStep] = useState<"choose_action" | "configure_slot">("choose_action");
    const [chosenAction, setChosenAction] = useState<"reserve" | "swap" | "split" | null>(null);
    const [selectedCardIndex, setSelectedCardIndex] = useState(0);
    const [newDriverShift, setNewDriverShift] = useState<"Morning" | "Evening">("Morning");
    const [assignBoth, setAssignBoth] = useState(false);

    // Determine the case
    const driverCount = existingDrivers.length;
    const isSimpleAssign = driverCount === 0;

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            if (isSimpleAssign) {
                setStep("configure_slot");
                setChosenAction(null);
            } else {
                setStep("choose_action");
                setChosenAction(null);
            }
            setSelectedCardIndex(0);
            setAssignBoth(false);

            // Set default shift based on bus shift
            if (busShift === "Morning") {
                setNewDriverShift("Morning");
            } else if (busShift === "Evening") {
                setNewDriverShift("Evening");
            } else {
                // 'Both' - default to the first existing driver's shift if available
                const firstExisting = existingDrivers[0];
                if (firstExisting) {
                    const normalizedShift = normalizeShift(firstExisting.shift);
                    setNewDriverShift(normalizedShift === "Evening" ? "Evening" : "Morning");
                } else {
                    setNewDriverShift("Morning");
                }
            }
        }
    }, [isOpen, isSimpleAssign, busShift, existingDrivers]);

    // Available shift options for this bus
    const shiftOptions = useMemo(() => {
        if (busShift === "Morning") return ["Morning"] as const;
        if (busShift === "Evening") return ["Evening"] as const;
        return ["Morning", "Evening"] as const;
    }, [busShift]);

    const isSingleShiftBus = busShift !== "Both";

    // Handle action choice
    const handleActionChoice = (action: "reserve" | "swap" | "split") => {
        setChosenAction(action);
        setStep("configure_slot");
        setAssignBoth(false);

        // Set default shift based on first existing driver
        if (existingDrivers.length > 0) {
            const normalizedFirstShift = normalizeShift(existingDrivers[0].shift);
            if (action === "split") {
                if (normalizedFirstShift === "Morning") setNewDriverShift("Evening");
                else if (normalizedFirstShift === "Evening") setNewDriverShift("Morning");
                else setNewDriverShift("Evening");
            } else {
                if (normalizedFirstShift === "Evening") {
                    setNewDriverShift("Evening");
                } else {
                    setNewDriverShift("Morning");
                }
            }
        }
    };

    // Handle "Assign for both shifts"
    const handleAssignBoth = () => {
        setAssignBoth(true);
    };

    // Handle final stage
    const handleConfirmSlot = () => {
        const targetSlot: "Morning" | "Evening" | "Both" = assignBoth ? "Both" : newDriverShift;

        if (isSimpleAssign) {
            // CASE 1: Simple assign
            onStage({
                action: assignBoth ? "assign_both" : "assign",
                busId,
                busNumber,
                busShift,
                newDriver,
                targetSlot,
                oldDrivers: [],
            });
        } else if (chosenAction === "reserve") {
            // Reserve: old drivers become reserved
            onStage({
                action: assignBoth ? "assign_both" : "reserve",
                busId,
                busNumber,
                busShift,
                newDriver,
                targetSlot,
                oldDrivers: existingDrivers.map(d => ({
                    ...d,
                    impact: "reserved" as const,
                })),
            });
        } else if (chosenAction === "swap") {
            // Swap: the selected old driver swaps with the new driver
            const swapTarget = existingDrivers[selectedCardIndex] || existingDrivers[0];
            onStage({
                action: "swap",
                busId,
                busNumber,
                busShift,
                newDriver,
                targetSlot: newDriverShift,
                oldDrivers: [{
                    ...swapTarget,
                    impact: "swapped" as const,
                }],
            });
        } else if (chosenAction === "split") {
            // Split: old driver takes the alternate shift
            const splitTarget = existingDrivers[0];
            onStage({
                action: "split",
                busId,
                busNumber,
                busShift,
                newDriver,
                targetSlot: newDriverShift,
                oldDrivers: [{
                    ...splitTarget,
                    impact: "split" as const,
                }],
            });
        }

        onClose();
    };

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center px-4"
                style={{ marginTop: "60px" }}
            >
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={onClose}
                />

                {/* Modal Container to allow outside 'X' */}
                <div className="relative w-full max-w-xl md:max-w-2xl px-2 md:px-0">
                    {/* Close button - Positioned OUTSIDE top-right */}
                    <button
                        onClick={onClose}
                        className="absolute -top-10 right-0 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer bg-slate-800/80 hover:bg-red-500/20 group backdrop-blur-md border border-white/10"
                    >
                        <X className="w-5 h-5 text-slate-300 group-hover:text-red-500 transition-colors" />
                    </button>

                    {/* Modal Card */}
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        className="relative w-full rounded-2xl shadow-2xl border overflow-hidden"
                        style={{
                            backgroundColor: tokens.modalBg,
                            borderColor: tokens.borderDark,
                        }}
                    >
                        {/* Assign for both shifts - Top Right (Inner) */}
                        {step === "configure_slot" && busShift === "Both" && chosenAction !== "swap" && chosenAction !== "split" && (
                            <button
                                onClick={() => setAssignBoth(!assignBoth)}
                                className={cn(
                                    "absolute top-3 right-3 z-10 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all duration-300 text-[10px] font-black uppercase tracking-wider border backdrop-blur-md",
                                    assignBoth
                                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                                        : "bg-slate-800/40 text-slate-400 border-white/10 hover:bg-slate-700/50"
                                )}
                            >
                                <Zap className={cn("w-3 h-3 transition-transform duration-500", assignBoth ? "fill-emerald-400 scale-110" : "")} />
                                {assignBoth ? "Full Day Locked" : "Assign Full Day?"}
                            </button>
                        )}

                        {/* Header */}
                        <div
                            className="px-5 py-4 border-b"
                            style={{
                                background: "linear-gradient(135deg, rgba(6, 182, 212, 0.12) 0%, rgba(59, 130, 246, 0.08) 100%)",
                                borderColor: tokens.borderDark,
                            }}
                        >
                            <div className="flex items-center gap-3 pr-8">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg">
                                    <ArrowRightLeft className="w-4.5 h-4.5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold" style={{ color: tokens.textPrimary }}>
                                        {isSimpleAssign ? "Assign Driver" :
                                            step === "choose_action" ? "Driver Conflict" : (
                                                chosenAction === "reserve" ? "Reserved Placement" :
                                                chosenAction === "swap" ? "Swap Operators" : "Split Shifts"
                                            )}
                                    </h3>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <Badge
                                            className="text-[9px] px-1.5 py-0 border-none"
                                            style={{ backgroundColor: `${tokens.primaryCyan}20`, color: tokens.primaryCyan }}
                                        >
                                            <Bus className="w-2.5 h-2.5 mr-1" />
                                            {busNumber}
                                        </Badge>
                                        {routeName && (
                                            <span className="text-[10px]" style={{ color: tokens.textMuted }}>
                                                {routeName}
                                            </span>
                                        )}
                                        <Badge
                                            className="text-[8px] px-1 py-0 border-none"
                                            style={{ backgroundColor: `${tokens.primaryCyan}20`, color: tokens.primaryCyan }}
                                        >
                                            {busShift}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="px-5 py-4">
                            <AnimatePresence mode="wait">
                                {/* STEP 1: Choose Action (reserve/swap/cancel) */}
                                {step === "choose_action" && !isSimpleAssign && (
                                    <motion.div
                                        key="choose_action"
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                    >
                                        <p className="text-xs mb-4" style={{ color: tokens.textMuted }}>
                                            Bus <strong style={{ color: tokens.textPrimary }}>{busNumber}</strong> already has{" "}
                                            <strong style={{ color: tokens.primaryCyan }}>
                                                {driverCount} driver{driverCount > 1 ? "s" : ""}
                                            </strong>{" "}
                                            assigned. Choose an action:
                                        </p>

                                        {/* Existing drivers preview */}
                                        <div className="space-y-2.5 mb-5">
                                            {existingDrivers.map((d) => (
                                                <div
                                                    key={d.id}
                                                    className="flex items-center gap-4 px-4 py-3 rounded-xl border border-white/5 bg-slate-900/40 backdrop-blur-md shadow-inner"
                                                >
                                                    <div
                                                        className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br border shadow-lg"
                                                        style={{
                                                            background: `linear-gradient(135deg, ${tokens.conflict}20 0%, ${tokens.conflict}05 100%)`,
                                                            borderColor: `${tokens.conflict}40`
                                                        }}
                                                    >
                                                        <User className="w-5 h-5" style={{ color: tokens.conflict }} />
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-bold" style={{ color: tokens.textPrimary }}>
                                                            {d.name}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[11px] font-medium" style={{ color: tokens.textMuted }}>
                                                                {d.code}
                                                            </span>
                                                            <div className="w-1 h-1 rounded-full bg-slate-700" />
                                                            <span className="text-[11px] font-semibold" style={{ color: tokens.primaryCyan }}>
                                                                {d.shift || "N/A"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <Badge
                                                        className="text-[9px] font-bold px-2 py-0.5 border-none shadow-lg tracking-wider"
                                                        style={{ backgroundColor: tokens.conflict, color: "white" }}
                                                    >
                                                        OCCUPYING SLOT
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Action buttons - All in one line */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <Button
                                                className="h-16 flex-col gap-2 text-[10px] font-black uppercase tracking-wider transition-all duration-300 border border-amber-500/20 hover:border-amber-500/50 group bg-amber-500/5 hover:bg-amber-500/10"
                                                style={{ color: tokens.reserved }}
                                                onClick={() => handleActionChoice("reserve")}
                                            >
                                                <div className="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors">
                                                    <Bookmark className="w-3 h-3" />
                                                </div>
                                                Reserved
                                            </Button>

                                            <Button
                                                className="h-16 flex-col gap-2 text-[10px] font-black uppercase tracking-wider transition-all duration-300 border border-blue-500/20 hover:border-blue-500/50 group bg-blue-500/5 hover:bg-blue-500/10"
                                                style={{ color: tokens.primaryBlue }}
                                                onClick={() => handleActionChoice("swap")}
                                            >
                                                <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                                    <ArrowRightLeft className="w-3 h-3" />
                                                </div>
                                                Swap
                                            </Button>

                                            {busShift === "Both" && existingDrivers.length === 1 && (
                                                <Button
                                                    className="h-16 flex-col gap-2 text-[10px] font-black uppercase tracking-wider transition-all duration-300 border border-emerald-500/20 hover:border-emerald-500/50 group bg-emerald-500/5 hover:bg-emerald-500/10"
                                                    style={{ color: tokens.success }}
                                                    onClick={() => handleActionChoice("split")}
                                                >
                                                    <div className="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                                                        <Users className="w-3 h-3" />
                                                    </div>
                                                    Split
                                                </Button>
                                            )}
                                        </div>
                                    </motion.div>
                                )}

                                {/* STEP 2: Configure Slot */}
                                {step === "configure_slot" && (
                                    <motion.div
                                        key="configure_slot"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                    >
                                        {/* Card comparison(s) */}
                                        <div className="space-y-3">
                                            {isSimpleAssign ? (
                                                // CASE 1: Simple assign - show new driver card only
                                                <SimpleAssignCard
                                                    newDriver={newDriver}
                                                    busShift={busShift}
                                                    shiftOptions={shiftOptions}
                                                    selectedShift={newDriverShift}
                                                    onShiftChange={setNewDriverShift}
                                                    isSingleShiftBus={isSingleShiftBus}
                                                    assignBoth={assignBoth}
                                                />
                                            ) : chosenAction === "reserve" ? (
                                                // CASE A/C: Move to Reserved
                                                existingDrivers.map((oldDriver, index) => (
                                                    <ComparisonCard
                                                        key={oldDriver.id}
                                                        index={index}
                                                        isSelected={selectedCardIndex === index}
                                                        onSelect={() => setSelectedCardIndex(index)}
                                                        oldDriver={oldDriver}
                                                        newDriver={newDriver}
                                                        mode="reserve"
                                                        busShift={busShift}
                                                        shiftOptions={shiftOptions}
                                                        selectedShift={newDriverShift}
                                                        onShiftChange={setNewDriverShift}
                                                        isSingleShiftBus={isSingleShiftBus}
                                                        assignBoth={assignBoth}
                                                        showShiftControl={driverCount === 1 || index === 0}
                                                    />
                                                ))
                                            ) : chosenAction === "swap" ? (
                                                // CASE B/D: Swap Drivers
                                                existingDrivers.map((oldDriver, index) => (
                                                    <ComparisonCard
                                                        key={oldDriver.id}
                                                        index={index}
                                                        isSelected={selectedCardIndex === index}
                                                        onSelect={() => setSelectedCardIndex(index)}
                                                        oldDriver={oldDriver}
                                                        newDriver={newDriver}
                                                        mode="swap"
                                                        busShift={busShift}
                                                        shiftOptions={shiftOptions}
                                                        selectedShift={newDriverShift}
                                                        onShiftChange={setNewDriverShift}
                                                        isSingleShiftBus={isSingleShiftBus}
                                                        assignBoth={false}
                                                        showShiftControl={true}
                                                    />
                                                ))
                                            ) : chosenAction === "split" ? (
                                                // CASE E: Split Shifts
                                                existingDrivers.map((oldDriver, index) => (
                                                    <ComparisonCard
                                                        key={oldDriver.id}
                                                        index={index}
                                                        isSelected={selectedCardIndex === index}
                                                        onSelect={() => setSelectedCardIndex(index)}
                                                        oldDriver={oldDriver}
                                                        newDriver={newDriver}
                                                        mode="split"
                                                        busShift={busShift}
                                                        shiftOptions={["Morning", "Evening"]}
                                                        selectedShift={newDriverShift}
                                                        onShiftChange={setNewDriverShift}
                                                        isSingleShiftBus={false}
                                                        assignBoth={false}
                                                        showShiftControl={true}
                                                    />
                                                ))
                                            ) : null}
                                        </div>

                                        {/* "Assign for both shifts" button - REMOVED redundant button as requested */}

                                        {/* Footer actions */}
                                        <div className="flex gap-2 mt-4">
                                            {!isSimpleAssign && (
                                                <Button
                                                    variant="outline"
                                                    className="flex-1 h-9 text-xs"
                                                    style={{ borderColor: tokens.borderDark, color: tokens.textMuted }}
                                                    onClick={() => {
                                                        setStep("choose_action");
                                                        setAssignBoth(false);
                                                    }}
                                                >
                                                    Back
                                                </Button>
                                            )}
                                            <Button
                                                className="flex-[2] h-9 text-xs font-bold text-white"
                                                style={{
                                                    background: `linear-gradient(135deg, ${tokens.primaryCyan}, ${tokens.primaryBlue})`,
                                                }}
                                                onClick={handleConfirmSlot}
                                            >
                                                Continue
                                            </Button>
                                            {isSimpleAssign && (
                                                <Button
                                                    variant="ghost"
                                                    className="flex-1 h-9 text-xs font-bold transition-all duration-200 bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20"
                                                    style={{ color: tokens.conflict }}
                                                    onClick={onClose}
                                                >
                                                    Cancel
                                                </Button>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}

// ============================================
// SIMPLE ASSIGN CARD (Case 1: No existing drivers)
// ============================================

function SimpleAssignCard({
    newDriver,
    busShift,
    shiftOptions,
    selectedShift,
    onShiftChange,
    isSingleShiftBus,
    assignBoth,
}: {
    newDriver: DriverSlotInfo;
    busShift: string;
    shiftOptions: readonly string[];
    selectedShift: string;
    onShiftChange: (s: "Morning" | "Evening") => void;
    isSingleShiftBus: boolean;
    assignBoth: boolean;
}) {
    return (
        <div
            className="p-6 md:p-8 rounded-2xl border transition-all duration-300 shadow-2xl relative overflow-hidden"
            style={{
                backgroundColor: tokens.cardBg,
                borderColor: tokens.borderDark,
                boxShadow: `0 10px 40px rgba(0,0,0,0.3)`
            }}
        >
            <div className="absolute -top-12 -right-12 w-24 h-24 blur-3xl rounded-full opacity-20" 
                style={{ backgroundColor: tokens.primaryCyan }} />
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                <div className="flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-slate-800/50 border border-white/5 shadow-lg group">
                        <User className="w-7 h-7 text-cyan-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div>
                        <p className="text-lg font-bold tracking-tight" style={{ color: tokens.textPrimary }}>
                            {newDriver.name}
                        </p>
                        <p className="text-xs font-black uppercase tracking-widest opacity-40" style={{ color: tokens.textMuted }}>
                            {newDriver.code}
                        </p>
                    </div>
                </div>

                {/* Shift selector */}
                {!assignBoth && (
                    <div className="flex flex-col items-end gap-1.5">
                        {isSingleShiftBus ? (
                            <div className="h-9 flex items-center justify-center px-5 rounded-xl bg-slate-800/50 border border-white/5"
                                style={{ color: tokens.primaryCyan }}>
                                <span className="text-[10px] font-black uppercase tracking-widest">
                                    {busShift}
                                </span>
                            </div>
                        ) : (
                            <Select
                                value={selectedShift}
                                onValueChange={(v) => onShiftChange(v as "Morning" | "Evening")}
                            >
                                <SelectTrigger
                                    className="h-9 w-[130px] text-[10px] font-black border-white/10 bg-slate-800/50 rounded-xl"
                                    style={{ color: tokens.textPrimary }}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent
                                    style={{ backgroundColor: tokens.modalBg, borderColor: tokens.borderDark }}
                                    className="rounded-xl border shadow-2xl"
                                >
                                    {shiftOptions.map(s => (
                                        <SelectItem key={s} value={s} className="text-[10px] font-bold" style={{ color: tokens.textPrimary }}>
                                            {s}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                )}
            </div>

            {assignBoth && (
                <div className="mt-4 px-3 py-2 rounded-xl text-center backdrop-blur-md border border-white/5 shadow-inner"
                    style={{ backgroundColor: `${tokens.primaryCyan}20` }}>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: tokens.primaryCyan }}>
                        Full Day Operations • Both Shifts
                    </span>
                </div>
            )}
        </div>
    );
}

// ============================================
// COMPARISON CARD (Cases A, B, C, D)
// ============================================

function ComparisonCard({
    index,
    isSelected,
    onSelect,
    oldDriver,
    newDriver,
    mode,
    busShift,
    shiftOptions,
    selectedShift,
    onShiftChange,
    isSingleShiftBus,
    assignBoth,
    showShiftControl,
}: {
    index: number;
    isSelected: boolean;
    onSelect: () => void;
    oldDriver: DriverSlotInfo;
    newDriver: DriverSlotInfo;
    mode: "reserve" | "swap" | "split";
    busShift: string;
    shiftOptions: readonly string[];
    selectedShift: string;
    onShiftChange: (s: "Morning" | "Evening") => void;
    isSingleShiftBus: boolean;
    assignBoth: boolean;
    showShiftControl: boolean;
}) {
    const isReserveMode = mode === "reserve";
    const isSwapMode = mode === "swap";
    const isSplitMode = mode === "split";

    // Box Styles
    const commonBoxStyles = "h-8 flex items-center justify-center rounded-xl backdrop-blur-md border border-white/5 shadow-inner transition-all duration-300 w-full";
    const textStyles = "text-[10px] font-black tracking-widest uppercase";

    return (
        <motion.div
            onClick={onSelect}
            className={cn(
                "p-5 md:p-6 rounded-2xl border transition-all duration-300 relative overflow-hidden",
                isSelected ? "shadow-xl translate-y-[-2px]" : "opacity-60 hover:opacity-100"
            )}
            style={{
                backgroundColor: tokens.cardBg,
                borderColor: isSelected ? (isReserveMode ? tokens.reserved : isSplitMode ? tokens.success : tokens.swap) : tokens.borderDark,
            }}
            whileHover={{ scale: isSelected ? 1 : 1.005 }}
        >
            {isSelected && (
                <div className="absolute top-0 right-0 p-1 rounded-bl-xl"
                    style={{ backgroundColor: isReserveMode ? tokens.reserved : isSplitMode ? tokens.success : tokens.swap }}>
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                </div>
            )}

            {/* Two-column layout: Previous Operator | New Operator */}
            <div className="grid grid-cols-2 gap-6 relative z-10">
                {/* Old Driver Column */}
                <div className="flex-1 space-y-3">
                    <p className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-0.5" style={{ color: tokens.textMuted }}>
                        Previous Operator
                    </p>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-slate-800/40 border border-white/5">
                            <User className="w-6 h-6 opacity-60" style={{ color: tokens.textPrimary }} />
                        </div>
                        <div>
                            <p className="text-[15px] font-bold" style={{ color: tokens.textPrimary }}>
                                {oldDriver.name}
                            </p>
                            <p className="text-[10px] font-black uppercase tracking-widest opacity-40" style={{ color: tokens.textMuted }}>
                                {oldDriver.code}
                            </p>
                        </div>
                    </div>

                    {/* Old driver shift status status Indicator */}
                    <div className={cn(commonBoxStyles, "border-white/5 bg-slate-800/40")}>
                        {isReserveMode ? (
                            <span className={textStyles} style={{ color: tokens.reserved }}>
                                {oldDriver.shift || "Both"} → Reserved
                            </span>
                        ) : isSplitMode ? (
                            <span className={textStyles} style={{ color: tokens.success }}>
                                {selectedShift === "Morning" ? "Evening" : "Morning"}
                            </span>
                        ) : (
                            <span className={textStyles} style={{ color: tokens.swap }}>
                                {isSelected ? selectedShift : (oldDriver.shift || "Morning")}
                            </span>
                        )}
                    </div>
                </div>

                {/* New Driver Column */}
                <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-widest font-black opacity-40 ml-0.5" style={{ color: tokens.textMuted }}>
                            New Operator
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20 shadow-lg">
                            <User className="w-6 h-6 text-cyan-400" />
                        </div>
                        <div>
                            <p className="text-[15px] font-bold" style={{ color: tokens.textPrimary }}>
                                {newDriver.name}
                            </p>
                            <p className="text-[10px] font-black uppercase tracking-widest opacity-40" style={{ color: tokens.textMuted }}>
                                {newDriver.code}
                            </p>
                        </div>
                    </div>

                    {/* New driver shift selector (FIXED HEIGHT MATCHING LEFT) */}
                    <div className="w-full">
                        {!assignBoth && showShiftControl && isSelected ? (
                            <div className="w-full">
                                {isSingleShiftBus ? (
                                    <div className={commonBoxStyles}
                                        style={{ backgroundColor: `${tokens.primaryCyan}10` }}>
                                        <span className={textStyles} style={{ color: tokens.primaryCyan }}>
                                            {busShift}
                                        </span>
                                    </div>
                                ) : (
                                    <Select
                                        value={selectedShift}
                                        onValueChange={(v) => onShiftChange(v as "Morning" | "Evening")}
                                    >
                                        <SelectTrigger
                                            className="h-8 w-full text-[10px] font-black uppercase tracking-widest border-white/10 bg-slate-800/40 rounded-xl"
                                            style={{ color: tokens.textPrimary }}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent
                                            style={{ backgroundColor: tokens.modalBg, borderColor: tokens.borderDark }}
                                            className="rounded-xl border shadow-2xl"
                                        >
                                            {shiftOptions.map(s => (
                                                <SelectItem key={s} value={s} className={cn("text-[10px] font-black uppercase tracking-widest", isSplitMode && s === selectedShift && "hidden")}
                                                    style={{ color: tokens.textPrimary }}>
                                                    {s}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        ) : (
                            <div className={cn(commonBoxStyles, "border-white/5 bg-slate-800/40")}>
                                <span className={textStyles} style={{
                                    color: assignBoth ? tokens.primaryCyan : isSplitMode ? tokens.success : tokens.textMuted
                                }}>
                                    {assignBoth ? "FULL DAY" : (selectedShift || (newDriver.shift && newDriver.shift !== "Both" ? newDriver.shift.toUpperCase() : "MORNING"))}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

export default ShiftSlotPrompt;
