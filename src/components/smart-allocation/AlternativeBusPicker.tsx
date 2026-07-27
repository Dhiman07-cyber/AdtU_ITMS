"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Bus,
  MapPin,
  ArrowRight,
  AlertCircle,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { normalizeShift, type CanonicalShift } from "@/lib/utils/shift-utils";

// ── Types (compatible with ReassignmentPanel) ─────────────────────────────────

export interface AlternativeBusData {
  id: string;
  busNumber: string;
  routeId?: string;
  routeName?: string;
  capacity: number;
  shift: string;
  load?: {
    morningCount?: number;
    eveningCount?: number;
  };
  currentMembers?: number;
}

export interface AlternativeBusPickerProps {
  applicantName: string;
  applicantStopName: string;
  applicantShift: string;
  currentBus: AlternativeBusData;
  alternatives: AlternativeBusData[];
  onSelect: (busId: string) => Promise<void>;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getShiftLoad(
  bus: AlternativeBusData,
  shift: CanonicalShift
): number {
  const load = bus.load || {};
  const morning = Number((bus as any).morningLoad ?? (bus as any).morning_load ?? load.morningCount ?? 0);
  const evening = Number((bus as any).eveningLoad ?? (bus as any).evening_load ?? load.eveningCount ?? 0);
  if (shift === "Both") return Math.max(morning, evening);
  if (shift === "Evening") return evening;
  return morning;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AlternativeBusPicker({
  applicantName,
  applicantStopName,
  applicantShift,
  currentBus,
  alternatives,
  onSelect,
  onClose,
}: AlternativeBusPickerProps) {
  const shift = normalizeShift(applicantShift);
  const [selectedBusId, setSelectedBusId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Sort alternatives: most available seats first
  const sortedAlternatives = useMemo(() => {
    return [...alternatives].sort((a, b) => {
      const seatsA = Math.max(0, (a.capacity || 55) - getShiftLoad(a, shift));
      const seatsB = Math.max(0, (b.capacity || 55) - getShiftLoad(b, shift));
      return seatsB - seatsA;
    });
  }, [alternatives, shift]);

  const handleSelect = async (busId: string) => {
    if (submitting) return;
    setSelectedBusId(busId);
    setSubmitting(true);
    try {
      await onSelect(busId);
    } catch (err: any) {
      toast.error(err?.message || "Failed to approve with alternative bus");
      setSubmitting(false);
      setSelectedBusId(null);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent 
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-xl bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 p-0 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
      >
        {/* Header — same gradient as ReassignmentPanel */}
        <DialogHeader className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/30 dark:via-pink-950/30 dark:to-purple-950/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <Bus className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-zinc-900 dark:text-white">
                Select Alternative Bus
              </DialogTitle>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">{currentBus.busNumber}</span> is full for{" "}
                <span className="font-semibold">{applicantName}</span>
                {applicantStopName ? <> at <MapPin className="w-3 h-3 inline text-purple-500" /> {applicantStopName}</> : ""}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Full-bus banner */}
        <div className="px-5 py-3 border-b border-amber-100 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {currentBus.busNumber} is at full capacity ({currentBus.capacity}/{currentBus.capacity})
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
              {sortedAlternatives.length} alternative bus{sortedAlternatives.length !== 1 ? "es" : ""} serve this stop with available {shift.toLowerCase()} seats.
              Select one to approve this application.
            </p>
          </div>
        </div>

        {/* Alternative bus cards */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4">
            {sortedAlternatives.map((bus, idx) => {
              const currentLoad = getShiftLoad(bus, shift);
              const capacity = bus.capacity || 55;
              const availableSeats = Math.max(0, capacity - currentLoad);
              const loadPercent = Math.min(100, (currentLoad / capacity) * 100);

              return (
                <motion.div
                  key={bus.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={cn(
                    "group relative transition-all duration-300 rounded-xl p-4 shadow-lg border cursor-pointer",
                    selectedBusId === bus.id
                      ? "border-purple-500 bg-purple-500/5 shadow-[0_0_20px_-5px_rgba(168,85,247,0.25)] dark:bg-purple-950/20 dark:border-purple-500"
                      : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800/80 hover:border-purple-500/50 hover:shadow-[0_0_20px_-5px_rgba(168,85,247,0.15)]"
                  )}
                  onClick={() => !submitting && handleSelect(bus.id)}
                >
                  {/* Bus header — matches ReassignmentPanel card structure */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg border transition-colors",
                        selectedBusId === bus.id
                          ? "bg-purple-500 border-purple-400 text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-purple-500 group-hover:text-purple-400"
                      )}>
                        {selectedBusId === bus.id ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <Bus className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-base text-zinc-900 dark:text-white tracking-tight">
                            {bus.busNumber}
                          </h4>
                          {bus.routeName && (
                            <Badge variant="outline" className="text-[10px] h-5 border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 font-normal">
                              {bus.routeName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={cn(
                            "text-[10px] px-1.5 h-4 border",
                            normalizeShift(bus.shift) === "Morning"
                              ? "bg-amber-500/10 border-amber-500/30 text-amber-500"
                              : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                          )}>
                            {normalizeShift(bus.shift)}
                          </Badge>
                          <div className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                            availableSeats > 5
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          )}>
                            {availableSeats} seat{availableSeats !== 1 ? "s" : ""} left
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Select button */}
                    <Button
                      size="sm"
                      variant={selectedBusId === bus.id ? "default" : "outline"}
                      disabled={submitting}
                      className={cn(
                        "h-8 text-[11px] font-bold shadow-sm transition-all",
                        selectedBusId === bus.id
                          ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white border-0"
                          : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400"
                      )}
                    >
                      {selectedBusId === bus.id ? "Staging…" : "Select"}
                      {selectedBusId !== bus.id && <ArrowRight className="w-3 h-3 ml-1" />}
                    </Button>
                  </div>

                  {/* Load stats — matches ReassignmentPanel card structure */}
                  <div className="grid grid-cols-2 gap-4 mb-3 px-1">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-bold mb-1">
                        Current {shift} Load
                      </div>
                      <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {loadPercent.toFixed(0)}%{" "}
                        <span className="text-zinc-400 dark:text-zinc-500 text-xs">({currentLoad}/{capacity})</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-emerald-500 font-bold mb-1">
                        Available
                      </div>
                      <div className="text-sm font-bold text-zinc-900 dark:text-white">
                        {availableSeats} <span className="text-zinc-400 dark:text-zinc-500 text-xs font-normal">free</span>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar — same dimensions as ReassignmentPanel */}
                  <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden border border-zinc-200 dark:border-zinc-700/50">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${loadPercent}%` }}
                      transition={{ duration: 0.6, delay: idx * 0.05 }}
                      className={cn(
                        "h-full rounded-full",
                        loadPercent > 90
                          ? "bg-red-500"
                          : loadPercent > 70
                            ? "bg-amber-500"
                            : "bg-gradient-to-r from-purple-600 to-pink-500"
                      )}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
