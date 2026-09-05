"use client";

import { Button } from "@/components/ui/button";
import { AnimatePresence,motion } from "motion/react";
import {
	AlertCircle,
	CheckCircle2,
	Clock,
	RefreshCw,
	Undo2
} from "lucide-react";
import { useEffect,useState } from "react";

// ============================================
// DESIGN TOKENS (Matching your system)
// ============================================
const tokens = {
    primaryPurple: "#9333EA",
    primaryPink: "#DB2777",
    primaryOrange: "#FF7A2D",
    success: "#10B981",
    textPrimary: "#F8FAFC",
    textMuted: "#94A3B8",
    cardBg: "#0B1222",
    borderDark: "#1E293B",
};

interface AssignmentFinalizeCardProps {
    isVisible: boolean;
    onConfirm: () => Promise<void>;
    onRevert: () => void;
    count: number;
    entityType?: "driver" | "bus";
    timerDuration?: number; // default 120s
    processing?: boolean;
}

export function AssignmentFinalizeCard({
    isVisible,
    onConfirm,
    onRevert,
    count,
    entityType = "driver",
    timerDuration = 120,
    processing = false
}: AssignmentFinalizeCardProps) {
    const [timeRemaining, setTimeRemaining] = useState(timerDuration);
    const [isTimerActive, setIsTimerActive] = useState(false);

    // Start timer when card becomes visible
    useEffect(() => {
        if (isVisible) {
            setTimeRemaining(timerDuration);
            setIsTimerActive(true);
        } else {
            setIsTimerActive(false);
        }
    }, [isVisible, timerDuration]);

    // Countdown logic
    useEffect(() => {
        if (!isTimerActive || timeRemaining <= 0 || processing) return;

        const interval = setInterval(() => {
            setTimeRemaining((prev) => {
                if (prev <= 1) {
                    // Timer expired - auto finalize
                    setIsTimerActive(false);
                    onConfirm();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isTimerActive, timeRemaining, processing, onConfirm]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const getTimerColor = () => {
        if (timeRemaining > 60) return tokens.success;
        if (timeRemaining > 30) return "#EAB308"; // Yellow-500
        return "#EF4444"; // Red-500
    };

    if (!isVisible) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="fixed bottom-6 right-6 z-[60] w-[400px] overflow-hidden rounded-2xl border shadow-2xl"
                style={{
                    backgroundColor: tokens.cardBg,
                    borderColor: tokens.borderDark,
                }}
            >
                {/* Header Section */}
                <div className="px-5 py-4 flex items-start justify-between bg-gradient-to-r from-purple-500/5 to-pink-500/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20">
                            <CheckCircle2 className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-white tracking-tight">Reassignment Ready</h3>
                            <p className="text-xs text-slate-400 font-medium">
                                {count} {entityType}{count !== 1 ? 's' : ''} staged for move
                            </p>
                        </div>
                    </div>

                    {/* Timer Badge */}
                    <div
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border backdrop-blur-md transition-all duration-300"
                        style={{
                            borderColor: `${getTimerColor()}30`,
                            backgroundColor: `${getTimerColor()}10`
                        }}
                    >
                        <Clock className="w-4 h-4" style={{ color: getTimerColor() }} />
                        <span className="font-mono text-sm font-bold" style={{ color: getTimerColor() }}>
                            {formatTime(timeRemaining)}
                        </span>
                    </div>
                </div>

                {/* Status Bar */}
                <div className="px-5 py-3 border-y border-white/5 bg-slate-900/40">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-orange-400/80" />
                        <p className="text-[11px] text-slate-300">
                            Changes auto-finalize in <span className="font-bold text-white">{formatTime(timeRemaining)}</span>. Click <span className="font-bold text-orange-400 uppercase tracking-wider">Revert</span> to undo all changes.
                        </p>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-5 py-4 flex items-center gap-3 bg-slate-900/20">
                    <Button
                        variant="ghost"
                        onClick={onRevert}
                        disabled={processing}
                        className="flex-1 h-11 border border-white/10 hover:bg-white/5 text-slate-300 text-xs font-semibold uppercase tracking-widest transition-all active:scale-95"
                    >
                        <Undo2 className="w-4 h-4 mr-2 text-slate-400" />
                        Revert
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={processing}
                        className="flex-[1.5] h-11 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold uppercase tracking-widest shadow-lg shadow-purple-500/20 transition-all active:scale-95"
                    >
                        {processing ? (
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                        )}
                        {processing ? "Finalizing..." : "Confirm"}
                    </Button>
                </div>

                {/* Progress bar at the very bottom */}
                <div className="w-full h-1 bg-slate-800">
                    <motion.div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                        initial={{ width: "100%" }}
                        animate={{ width: `${(timeRemaining / timerDuration) * 100}%` }}
                        transition={{ duration: 0.5, ease: "linear" }}
                    />
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
