"use client";

import type { BusData,StudentData } from "@/app/admin/smart-allocation/page";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Bus,MapPin } from "lucide-react";
import React,{ useMemo } from "react";

interface RouteVisualizationProps {
  bus: BusData;
  students: StudentData[];
  selectedStudents: Set<string>;
  onStopClick: (stop_name: string) => void;
  shiftFilter?: string;
}

export default function RouteVisualization({
  bus,
  students,
  selectedStudents,
  onStopClick,
  shiftFilter = "morning",
}: RouteVisualizationProps) {
  // Debug: Check what we're receiving
  console.log("🗺️ RouteVisualization received:", {
    busId: bus.id,
    busNumber: bus.busNumber,
    stopsCount: bus.stops?.length || 0,
    stops: bus.stops?.map((s) => ({ id: s.id, name: s.name })),
    studentsCount: students.length,
    selectedCount: selectedStudents.size,
  });

  // Calculate stats for each stop with case-insensitive stop_name matching
  // Filter students by shift to show only relevant students for the selected tab
  const stopStats = useMemo(() => {
    const stats = new Map<
      string,
      { total: number; selected: number; stop_name: string }
    >();

    // Initialize stats for all stops (using lowercase key for matching)
    bus.stops.forEach((stop) => {
      const normalizedStopId = (stop.id || "").toLowerCase().trim();
      stats.set(normalizedStopId, { total: 0, selected: 0, stop_name: stop.id });
    });

    // Filter students by shift before counting
    const filteredStudents = students.filter((student) => {
      const studentShift = (student.shift || "").toLowerCase().trim();
      if (!studentShift) return true;
      if (shiftFilter === "morning") {
        return studentShift.includes("morning") || studentShift === "both";
      } else if (shiftFilter === "evening") {
        return studentShift.includes("evening") || studentShift === "both";
      }
      return true;
    });

    // Count students per stop (case-insensitive matching with stop_name fallback)
    filteredStudents.forEach((student) => {
      const studentStopId = (student.stop_name || "").toLowerCase().trim();
      let stat = stats.get(studentStopId);

      if (!stat && student.stop_name) {
        const studentStopName = (student.stop_name || "").toLowerCase().trim();
        for (const [key, val] of stats.entries()) {
          const stopObj = bus.stops?.find(s => (s.id || "").toLowerCase().trim() === key);
          if (stopObj && (stopObj.name || "").toLowerCase().trim() === studentStopName) {
            stat = val;
            break;
          }
        }
      }

      if (stat) {
        stat.total++;
        if (selectedStudents.has(student.id)) {
          stat.selected++;
        }
      }
    });

    console.log(
      `📊 Stop stats calculated for ${shiftFilter} shift:`,
      Array.from(stats.entries()).map(
        ([key, val]) => `${key}: ${val.selected}/${val.total}`,
      ),
    );

    return stats;
  }, [bus.stops, students, selectedStudents, shiftFilter]);

  // Helper function to get stats for a stop (case-insensitive)
  const getStopStats = (stop_name: string) => {
    const normalizedStopId = (stop_name || "").toLowerCase().trim();
    return stopStats.get(normalizedStopId) || { total: 0, selected: 0, stop_name };
  };

  return (
    <div className="h-full flex flex-col max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bus className="w-4 h-4 text-purple-500" />
          <span className="font-semibold text-sm text-zinc-800 dark:text-gray-100">
            {bus.busNumber}
          </span>
          <span className="text-xs text-zinc-500 dark:text-gray-400 hidden sm:inline">
            - {bus.routeName}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 bg-purple-500 rounded-full" />
            <span className="text-zinc-500 dark:text-gray-400">Selected</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 bg-zinc-400 dark:bg-zinc-600 rounded-full" />
            <span className="text-zinc-500 dark:text-gray-400">
              Not Selected
            </span>
          </div>
        </div>
      </div>

      {/* Route Flow - Scrollable container with fixed height */}
      <div className="flex-1 min-h-0 max-h-[180px] overflow-hidden">
        <div className="h-full overflow-x-auto overflow-y-hidden pb-5">
          <div className="flex items-start gap-0 min-w-max pt-2 pb-3 px-1">
            {bus.stops.map((stop, index) => {
              const stats = getStopStats(stop.id);
              const hasSelectedStudents = stats.selected > 0;
              const allSelected =
                stats.total > 0 && stats.selected === stats.total;

              return (
                <React.Fragment key={stop.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="flex flex-col items-center w-[90px]"
                  >
                    {/* Stop Node */}
                    <button
                      onClick={() => onStopClick(stop.id)}
                      className="relative group"
                    >
                      {/* Stop Circle */}
                      <div
                        className={cn(
                          "relative w-9 h-9 rounded-full",
                          "border-2 transition-all duration-200",
                          "flex items-center justify-center",
                          "bg-white dark:bg-zinc-950",
                          allSelected
                            ? "border-purple-500 ring-2 ring-purple-500/30"
                            : hasSelectedStudents
                              ? "border-purple-400"
                              : "border-zinc-300 dark:border-zinc-700 hover:border-purple-400/50",
                        )}
                      >
                        <MapPin
                          className={cn(
                            "w-4 h-4",
                            hasSelectedStudents
                              ? "text-purple-500"
                              : "text-zinc-400 dark:text-gray-400",
                          )}
                        />

                        {/* Count Badge - Shows total students at stop */}
                        {stats.total > 0 && (
                          <div
                            className={cn(
                              "absolute -top-1 -right-1",
                              "w-4 h-4 rounded-full",
                              "flex items-center justify-center",
                              "text-[10px] font-bold",
                              hasSelectedStudents
                                ? "bg-purple-500 text-white"
                                : "bg-zinc-400 dark:bg-zinc-700 text-white dark:text-gray-300",
                            )}
                          >
                            {stats.total}
                          </div>
                        )}
                      </div>

                      {/* Tooltip - Simple fade on hover */}
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
                        <div className="bg-zinc-800 dark:bg-zinc-900 text-white px-2.5 py-1.5 rounded-lg whitespace-nowrap border border-zinc-700 text-xs shadow-lg">
                          <div className="font-semibold">{stop.name}</div>
                          <div className="text-gray-400 text-[10px]">
                            {stats.total} students
                            {stats.selected > 0 &&
                              ` (${stats.selected} selected)`}
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Stop Name - Color changes when selected */}
                    <div className="mt-1.5 text-center px-1">
                      <div
                        className={cn(
                          "text-[11px] leading-tight line-clamp-2 min-h-[2em] transition-colors duration-200",
                          hasSelectedStudents
                            ? "text-purple-600 dark:text-purple-300 font-medium"
                            : "text-zinc-600 dark:text-gray-300",
                        )}
                      >
                        {stop.name}
                      </div>
                    </div>

                    {/* Stop Order Label - Default gray, purple when selected */}
                    <div className="mt-0.5 text-center">
                      <span
                        className={cn(
                          "text-[10px] font-medium transition-colors duration-200",
                          hasSelectedStudents
                            ? "text-purple-500 dark:text-purple-400"
                            : "text-zinc-400 dark:text-gray-500",
                        )}
                      >
                        Stop {index + 1}
                      </span>
                    </div>
                  </motion.div>

                  {/* Connecting Line */}
                  {index < bus.stops.length - 1 && (
                    <div className="flex items-center h-9 -mx-2 mt-0">
                      <div className="w-8 h-0.5 bg-zinc-300 dark:bg-zinc-700"></div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tips Section */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex-shrink-0 mt-auto">
        <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-500/30 p-2">
          <div className="text-[10px] font-bold text-purple-600 dark:text-purple-400 mb-0.5 flex items-center gap-1">
            <span>💡</span> Quick Select
          </div>
          <div className="text-[9px] text-zinc-600 dark:text-gray-300 leading-tight">
            Click stops to toggle selection
          </div>
        </div>
        <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-500/30 p-2">
          <div className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-0.5 flex items-center gap-1">
            <span>🔄</span> Reassign
          </div>
          <div className="text-[9px] text-zinc-600 dark:text-gray-300 leading-tight">
            Get AI-powered reassignment
          </div>
        </div>
        <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-500/30 p-2">
          <div className="text-[10px] font-bold text-green-600 dark:text-green-400 mb-0.5 flex items-center gap-1">
            <span>✓</span> Select & Move
          </div>
          <div className="text-[9px] text-zinc-600 dark:text-gray-300 leading-tight">
            Pick students then reassign
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-1.5 p-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-800 flex-shrink-0">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="text-xs">
              <span className="text-zinc-500 dark:text-gray-400">
                Total Stops:
              </span>
              <span className="ml-1 font-semibold text-zinc-800 dark:text-gray-100">
                {bus.stops.length}
              </span>
            </div>
            <div className="text-xs">
              <span className="text-zinc-500 dark:text-gray-400">
                Students:
              </span>
              <span className="ml-1 font-semibold text-zinc-800 dark:text-gray-100">
                {students.length}
              </span>
            </div>
            <div className="text-xs">
              <span className="text-zinc-500 dark:text-gray-400">
                Selected:
              </span>
              <span className="ml-1 font-semibold text-purple-600 dark:text-purple-400">
                {selectedStudents.size}
              </span>
            </div>
          </div>
          <div className="text-[10px] text-purple-600 dark:text-purple-400 hidden sm:block">
            Click on stops to select/deselect students
          </div>
        </div>
      </div>
    </div>
  );
}
