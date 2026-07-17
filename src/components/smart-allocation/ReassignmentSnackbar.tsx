"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, RotateCcw, X, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Revert buffer data structure for storing reassignment state
 */
import type { CanonicalShift } from '@/lib/utils/shift-utils';

export interface RevertBufferData {
  operationId: string;
  affectedStudents: Array<{
    uid: string;
    oldBusId: string;
    newBusId: string;
    oldRouteId: string;
    newRouteId: string;
    /** Original Stop ID — restored on revert */
    stopId: string;
    /** Original Stop Name — restored on revert */
    stopName: string;
    /** Target Shift — shift persisted on the student after reassignment */
    shift: CanonicalShift;
    /** Original Shift — shift the student had BEFORE reassignment. Used to correctly reverse source-bus counters and restore student.shift. */
    oldShift: CanonicalShift;
  }>;
  busUpdates: Array<{
    busId: string;
    morningCountBefore: number;
    morningCountAfter: number;
    eveningCountBefore: number;
    eveningCountAfter: number;
  }>;
  timestamp: Date;
}

interface ReassignmentSnackbarProps {
  isVisible: boolean;
  studentCount: number;
  revertBuffer: RevertBufferData | null;
  onRevert: () => Promise<void>;
  onConfirm: () => void;
  onDismiss: () => void;
  autoDismissSeconds?: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REASSIGNMENT SNACKBAR COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A beautiful, animated 120-second countdown popup that allows users to:
 * - Confirm the reassignment immediately
 * - Revert to restore the previous state
 * - Auto-dismiss after countdown (finalizes changes)
 *
 * Features:
 * - Neon purple animated progress bar
 * - Dark glassmorphism design
 * - Smooth entrance/exit animations
 * - Clear countdown timer
 */
export default function ReassignmentSnackbar({
  isVisible,
  studentCount,
  revertBuffer,
  onRevert,
  onConfirm,
  onDismiss,
  autoDismissSeconds = 120,
}: ReassignmentSnackbarProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(autoDismissSeconds);
  const [isReverting, setIsReverting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Start countdown when visible
  useEffect(() => {
    if (isVisible) {
      setSecondsRemaining(autoDismissSeconds);

      timerRef.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            // Auto-confirm when timer reaches 0
            if (timerRef.current) {
              clearInterval(timerRef.current);
            }
            onConfirm();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }
  }, [isVisible, autoDismissSeconds, onConfirm]);

  // Handle revert action
  const handleRevert = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setIsReverting(true);
    try {
      await onRevert();
    } finally {
      setIsReverting(false);
      onDismiss();
    }
  }, [onRevert, onDismiss]);

  // Handle confirm action
  const handleConfirm = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    onConfirm();
  }, [onConfirm]);

  // Calculate progress percentage
  const progressPercentage = (secondsRemaining / autoDismissSeconds) * 100;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 100, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 100, scale: 0.9 }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 30,
          }}
          className="fixed bottom-6 right-6 z-[9999]"
        >
          {/* Backdrop blur glow */}
          <div className="absolute inset-0 bg-purple-500/20 blur-xl rounded-2xl" />

          {/* Main Card */}
          <div className="relative bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/50 rounded-2xl shadow-2xl shadow-purple-500/10 overflow-hidden min-w-[380px]">
            {/* Animated Progress Bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-zinc-800">
              <motion.div
                className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 relative overflow-hidden"
                initial={{ width: "100%" }}
                animate={{ width: `${progressPercentage}%` }}
                transition={{ duration: 1, ease: "linear" }}
              >
                {/* Shimmer effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
              </motion.div>
            </div>

            {/* Content */}
            <div className="p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      Reassignment Complete
                    </h4>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {studentCount} student{studentCount !== 1 ? "s" : ""}{" "}
                      reassigned
                    </p>
                  </div>
                </div>

                {/* Timer */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800/80 rounded-lg border border-zinc-700/50">
                  <Clock className="w-3.5 h-3.5 text-purple-400" />
                  <motion.span
                    className="text-sm font-mono font-bold text-purple-400 min-w-[2.5rem] text-center"
                    key={secondsRemaining}
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {Math.floor(secondsRemaining / 60)}:
                    {String(secondsRemaining % 60).padStart(2, "0")}
                  </motion.span>
                </div>
              </div>

              {/* Message */}
              <div className="bg-zinc-800/50 rounded-lg px-3 py-2 mb-4 border border-zinc-700/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Changes auto-finalize in{" "}
                    <span className="font-bold text-purple-400">
                      {Math.floor(secondsRemaining / 60)}:
                      {String(secondsRemaining % 60).padStart(2, "0")}
                    </span>
                    . Click{" "}
                    <span className="font-semibold text-red-400">Revert</span>{" "}
                    to undo all changes.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRevert}
                  disabled={isReverting}
                  className={cn(
                    "flex-1 h-9 text-xs font-semibold",
                    "bg-red-500/10 border-red-500/30 text-red-400",
                    "hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-300",
                    "transition-all duration-200",
                  )}
                >
                  {isReverting ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Reverting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      Revert
                    </>
                  )}
                </Button>

                <Button
                  size="sm"
                  onClick={handleConfirm}
                  disabled={isReverting}
                  className={cn(
                    "flex-1 h-9 text-xs font-semibold",
                    "bg-gradient-to-r from-purple-600 to-pink-600",
                    "hover:from-purple-700 hover:to-pink-700",
                    "text-white shadow-lg shadow-purple-500/20",
                    "transition-all duration-200",
                  )}
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" />
                  Confirm
                </Button>
              </div>
            </div>

            {/* Decorative corner glow */}
            <div className="absolute -top-8 -right-8 w-24 h-24 bg-purple-500/20 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-8 -left-8 w-20 h-20 bg-pink-500/15 rounded-full blur-2xl pointer-events-none" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
