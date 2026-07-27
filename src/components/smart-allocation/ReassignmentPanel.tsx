"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { isStudentBusShiftCompatible,normalizeShift,type CanonicalShift } from "@/lib/utils/shift-utils";
import { AnimatePresence,motion } from "framer-motion";
import {
	AlertCircle,
	ArrowRight,
	Bus,
	Check,
	ListRestart,
	Loader2,
	MapPin,
	Users,
	X
} from "lucide-react";
import { useCallback,useEffect,useMemo,useState } from "react";
import { toast } from "react-hot-toast";

// =============================================================================
// TYPES
// =============================================================================

export interface StudentData {
  id: string;
  fullName: string;
  enrollmentId?: string;
  stop_name: string;
  busId: string;
  shift?: string;
  semester?: string;
  phone?: string;
  photoURL?: string;
}

interface BusStop {
  stop_name: string;
  name: string;
  sequence: number;
}

export interface BusData {
  id: string;
  busNumber: string;
  routeId?: string;
  routeName?: string;
  driverId?: string;
  driverName?: string;
  driverPhoto?: string;
  currentMembers: number;
  capacity: number;
  shift: "morning" | "evening" | "both" | string;
  stops: Array<{ id: string; name: string; sequence: number }>;
  load?: {
    morningCount?: number;
    eveningCount?: number;
  };
  route?: {
    routeId: string;
    routeName: string;
    stops: BusStop[];
  };
}

interface ReassignmentPanelProps {
  selectedStudents: StudentData[];
  allBuses: BusData[];
  currentBus: BusData;
  onClose: () => void;
  onSuccess: (result: ReassignmentResult) => void;
}

export interface ReassignmentAssignment {
  studentId: string;
  studentName: string;
  targetBusId: string;
  targetBusNumber: string;
  stop_name: string;
  shift: CanonicalShift;
}

export interface ReassignmentResult {
  success: boolean;
  movedCount: number;
  fromBusId: string;
  fromBusNumber: string;
  assignments: ReassignmentAssignment[];
  operationId: string;
}

// Internal types for the algorithm
interface AssignmentDetails {
  busId: string;
  stop_name: string;
  shift?: CanonicalShift;
}

interface ProcessedStudent {
  student: StudentData;
  normalizedShift: CanonicalShift;
  eligibleBuses: BusData[];
  assignment?: AssignmentDetails;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isShiftCompatible(
  studentShift: CanonicalShift,
  busShift: string | undefined,
): boolean {
  return isStudentBusShiftCompatible(studentShift, busShift);
}

/**
 * Helper to normalize stop IDs for comparison
 * Handles variations like "adtu_campus" vs "adtu campus" vs "ADTU Campus"
 */
function normalizeStopIdForComparison(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\-\s]+/g, "") // Remove underscores, hyphens, spaces
    .replace(/[^a-z0-9]/g, ""); // Keep only alphanumeric
}

function busCoversStop(bus: BusData, stop_name: string): boolean {
  if (!stop_name) return false;
  const normalizedStopId = normalizeStopIdForComparison(stop_name);

  console.log(`🔍 busCoversStop: Checking if bus ${bus.busNumber} covers stop "${stop_name}" (normalized: "${normalizedStopId}")`);

  // Check route.stops (primary source)
  const route_stops = bus.route?.stops || [];
  const foundInRoute = route_stops.some((stop) => {
    const busStopId = normalizeStopIdForComparison(stop.stop_name || "");
    const busStopName = normalizeStopIdForComparison(stop.name || "");
    const matches = busStopId === normalizedStopId || busStopName === normalizedStopId;
    if (matches) {
      console.log(`   ✅ Match found in route.stops: stop_name="${stop.stop_name}", name="${stop.name}"`);
    }
    return matches;
  });
  if (foundInRoute) return true;

  // Fallback: check stops array
  const uiStops = bus.stops || [];
  const foundInUI = uiStops.some((stop) => {
    const busStopId = normalizeStopIdForComparison(stop.id || "");
    const busStopName = normalizeStopIdForComparison(stop.name || "");
    const matches = busStopId === normalizedStopId || busStopName === normalizedStopId;
    if (matches) {
      console.log(`   ✅ Match found in stops array: id="${stop.id}", name="${stop.name}"`);
    }
    return matches;
  });

  if (!foundInRoute && !foundInUI) {
    console.log(`   ❌ No match found for stop "${stop_name}" in bus ${bus.busNumber}`);
    console.log(`      Route stops: ${route_stops.map(s => s.stop_name || s.name).join(", ")}`);
  }

  return foundInUI;
}

function getShiftLoad(bus: BusData, shift: "Morning" | "Evening"): number {
  const load = bus.load || {};
  const morning = Number((bus as any).morningLoad ?? (bus as any).morning_load ?? load.morningCount ?? 0);
  const evening = Number((bus as any).eveningLoad ?? (bus as any).evening_load ?? load.eveningCount ?? 0);
  return shift === "Morning" ? morning : evening;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ReassignmentPanel({
  selectedStudents,
  allBuses,
  currentBus,
  onClose,
  onSuccess,
}: ReassignmentPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Student Assignment State
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [assignmentTab, setAssignmentTab] = useState<"current" | "other">("current");
  const [otherShiftTab, setOtherShiftTab] = useState<"Morning" | "Evening">("Morning");
  const [busStopSelections, setBusStopSelections] = useState<Record<string, string>>({});

  // Draft Assignments Map<StudentId, AssignmentDetails>
  const [draftAssignments, setDraftAssignments] = useState<Record<string, AssignmentDetails>>({});
  const [busShiftSelections, setBusShiftSelections] = useState<Record<string, "Morning" | "Evening">>({});

  const activeStudent = useMemo(() =>
    selectedStudents.find(s => s.id === activeStudentId),
    [selectedStudents, activeStudentId]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ALGORITHM: Pre-Analysis & Load-Balanced Distribution
  // ─────────────────────────────────────────────────────────────────────────


  // 1. Pre-Analysis: Calculate Compatibility Map (Static for session)
  // This tells us for each student, WHICH buses are physically possible (Route/Shift)
  // We do NOT check capacity here, because capacity changes dynamically during edits.
  const { studentOptions, assignableStudents, unassignable } = useMemo(() => {
    const options = new Map<string, BusData[]>();
    const assignable: ProcessedStudent[] = [];
    const unassignableList: { student: StudentData; reason: string }[] = [];

    selectedStudents.forEach((student) => {
      const shift = normalizeShift(student.shift);
      const stop_name = (student.stop_name || "").toLowerCase().trim();

      // Find compatible buses (Strict Constraints Only: Stop & Shift)
      const eligible = allBuses.filter((bus) => {
        if (bus.id === currentBus.id) return false;
        if (!isShiftCompatible(shift, bus.shift)) return false;
        if (!busCoversStop(bus, stop_name)) return false;
        return true;
      });

      if (eligible.length === 0) {
        let reason = "No alternative buses available";
        const coversStop = allBuses.some(b => b.id !== currentBus.id && busCoversStop(b, stop_name));
        const compatibleShift = allBuses.some(b => b.id !== currentBus.id && isShiftCompatible(shift, b.shift));

        if (!coversStop) reason = `Only current bus serves this stop`;
        else if (!compatibleShift) reason = `No other buses support ${shift} shift`;

        unassignableList.push({ student, reason });
      } else {
        options.set(student.id, eligible);
        assignable.push({
          student,
          normalizedShift: shift,
          eligibleBuses: eligible,
        });
      }
    });

    return { studentOptions: options, assignableStudents: assignable, unassignable: unassignableList };
  }, [selectedStudents, allBuses, currentBus]);


  // 3. Initial Allocation (Run once on mount)
  useEffect(() => {
    const initialMap: Record<string, AssignmentDetails> = {};

    // Simulation state for the greedy algorithm
    const busSimulationState = new Map<string, { morningLoad: number; eveningLoad: number; capacity: number }>();
    allBuses.forEach((bus) => {
      if (bus.id === currentBus.id) return;
      busSimulationState.set(bus.id, {
        morningLoad: bus.load?.morningCount || 0,
        eveningLoad: bus.load?.eveningCount || 0,
        capacity: bus.capacity || bus.currentMembers || 50,
      });
    });

    // Run Greedy Allocation
    assignableStudents.forEach((pStudent) => {
      const shift = pStudent.normalizedShift;

      // Sort eligible buses by current projected load (ASC)
      const sortedCandidates = [...pStudent.eligibleBuses].sort((a, b) => {
        const stateA = busSimulationState.get(a.id)!;
        const stateB = busSimulationState.get(b.id)!;

        const loadA = shift === "Morning" ? stateA.morningLoad : stateA.eveningLoad;
        const loadB = shift === "Morning" ? stateB.morningLoad : stateB.eveningLoad;

        return (loadA / stateA.capacity) - (loadB / stateB.capacity);
      });

      // Try to assign
      for (const candidate of sortedCandidates) {
        const state = busSimulationState.get(candidate.id)!;
        const currentLoad = shift === "Morning" ? state.morningLoad : state.eveningLoad;

        if (currentLoad < state.capacity) {
          initialMap[pStudent.student.id] = {
            busId: candidate.id,
            stop_name: pStudent.student.stop_name || "",
            shift: shift
          };

          // Update simulation
          if (shift === "Morning") state.morningLoad++;
          else state.eveningLoad++;
          break;
        }
      }
    });

    setDraftAssignments(initialMap);
  }, [assignableStudents, allBuses, currentBus]);

  // 4. Derived State: Live Plan & Loads
  const { plan, busLoadImpacts, liveBusLoads } = useMemo(() => {
    const planMap = new Map<string, { bus: BusData; students: (StudentData & { overrideStopId?: string; overrideStopName?: string; overrideShift?: CanonicalShift })[] }>();

    // Helper to get base loads
    const currentLoads = new Map<string, { morning: number; evening: number; capacity: number }>();
    allBuses.forEach(b => {
      currentLoads.set(b.id, {
        morning: b.load?.morningCount || 0,
        evening: b.load?.eveningCount || 0,
        capacity: b.capacity || b.currentMembers || 50
      });
    });

    // Build Plan & Add Impacts
    Object.entries(draftAssignments).forEach(([studentId, details]) => {
      const student = selectedStudents.find(s => s.id === studentId);
      const bus = allBuses.find(b => b.id === details.busId);

      if (student && bus) {
        if (!planMap.has(details.busId)) {
          planMap.set(details.busId, { bus, students: [] });
        }
        planMap.get(details.busId)!.students.push({
          ...student,
          overrideStopId: details.stop_name,
          overrideStopName: details.stop_name,
          overrideShift: details.shift
        });

        // Update live load
        const load = currentLoads.get(details.busId)!;
        const shift = details.shift || normalizeShift(student.shift);
        if (shift === "Morning") load.morning++;
        else load.evening++;
      }
    });

    // Calculate UI Impacts
    const impacts = new Map<string, { addedMorning: number; addedEvening: number }>();
    planMap.forEach((data, busId) => {
      let m = 0, e = 0;
      data.students.forEach(s => {
        if ((s.overrideShift || normalizeShift(s.shift)) === "Morning") m++; else e++;
      });
      impacts.set(busId, { addedMorning: m, addedEvening: e });
    });

    return {
      plan: Array.from(planMap.values()),
      busLoadImpacts: impacts,
      liveBusLoads: currentLoads
    };
  }, [draftAssignments, selectedStudents, allBuses]);

  // Total students being moved
  const totalMoving = plan.reduce((sum, item) => sum + item.students.length, 0);

  // Get auth context for API call
  const { currentUser, userData } = useAuth();

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLERS
  // ─────────────────────────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    if (totalMoving === 0 || isProcessing) return;

    setIsProcessing(true);

    try {
      // Get the current user's token for authentication
      if (!currentUser) {
        throw new Error("You must be logged in to perform reassignments");
      }

      const token = await currentUser.getIdToken();

      // Build assignments array for API
      const apiAssignments: Array<{
        studentId: string;
        studentName: string;
        fromBusId: string;
        toBusId: string;
        toBusNumber: string;
        shift: CanonicalShift;
        stop_name: string;
        studentShift?: string; // Add this
      }> = [];

      for (const item of plan) {
        for (const student of item.students) {
          const shift = student.overrideShift || normalizeShift(student.shift);
          apiAssignments.push({
            studentId: student.id,
            studentName: student.fullName,
            fromBusId: currentBus.id,
            toBusId: item.bus.id,
            toBusNumber: item.bus.busNumber,
            shift: shift,
            stop_name: student.overrideStopName || student.overrideStopId || student.stop_name,
            studentShift: shift, // Pass the shift here
          });
        }
      }

      // Call the server-side API endpoint
      const response = await fetch("/api/admin/reassign-students", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          assignments: apiAssignments,
          sourceBusId: currentBus.id,
          actorId: currentUser.uid,
          actorName: userData?.fullName || userData?.name || currentUser.email || "Unknown",
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to reassign students");
      }

      // Success!
      toast.success(
        `Successfully reassigned ${totalMoving} student${totalMoving > 1 ? "s" : ""}`,
      );

      // Build final assignments for callback
      const finalAssignments: ReassignmentAssignment[] = apiAssignments.map(a => ({
        studentId: a.studentId,
        studentName: a.studentName,
        targetBusId: a.toBusId,
        targetBusNumber: a.toBusNumber,
        stop_name: a.stop_name || "",
        shift: a.shift,
      }));

      onSuccess({
        success: true,
        movedCount: totalMoving,
        fromBusId: currentBus.id,
        fromBusNumber: currentBus.busNumber,
        assignments: finalAssignments,
        operationId: result.operationId,
      });
      onClose();

    } catch (error: any) {
      console.error("Reassignment failed:", error);

      // Provide more helpful error messages
      let errorMessage = error.message || "Unknown error";

      if (error.code === "permission-denied" || errorMessage.includes("permission") || errorMessage.includes("Insufficient")) {
        errorMessage = "Permission denied. Please verify you are logged in as an admin or moderator.";
        console.error("🔒 Permission Error Details:", {
          code: error.code,
          message: error.message,
        });
      }

      toast.error(`Reassignment failed: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  }, [plan, currentBus, totalMoving, onSuccess, onClose, isProcessing, currentUser, userData]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent 
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-2xl bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 p-0 shadow-2xl flex flex-col h-[90vh] overflow-hidden sm:max-h-[90vh] mt-5"
      >
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-purple-50 via-pink-50 to-purple-50 dark:from-purple-950/30 dark:via-pink-950/30 dark:to-purple-950/30 flex-shrink-0">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                <Bus className="w-5 h-5 text-white" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-zinc-900 dark:text-white">
                  {activeStudent ? `Reassign ${activeStudent.fullName}` : "Reassignment Plan"}
                </DialogTitle>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {activeStudent
                    ? `Choosing a new bus for ${activeStudent.fullName}`
                    : `AI-Optimized Distribution for ${selectedStudents.length} Students`}
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <AnimatePresence mode="wait">
            {!activeStudent ? (
              <motion.div
                key="plan-view"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex-1 overflow-y-auto"
              >
                {/* 1. Unassignable Warning (if any) */}
                {unassignable.length > 0 && (
                  <div className="px-5 py-3 border-b border-red-100 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/10">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <h4 className="text-sm font-semibold text-red-800 dark:text-red-300">
                          {unassignable.length} student{unassignable.length !== 1 ? "s" : ""} cannot be reassigned
                        </h4>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-2">
                          They will remain on <span className="font-bold">{currentBus.busNumber}</span>.
                        </p>

                        <div className="mt-2">
                          <button
                            onClick={() => setShowDetails(!showDetails)}
                            className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1"
                          >
                            {showDetails ? "Hide details" : "View details"}
                          </button>

                          {showDetails && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              className="mt-2 space-y-3"
                            >
                              {Array.from(
                                unassignable.reduce((acc, item) => {
                                  if (!acc.has(item.reason)) acc.set(item.reason, []);
                                  acc.get(item.reason)!.push(item.student);
                                  return acc;
                                }, new Map<string, StudentData[]>())
                              ).map(([reason, students], i) => (
                                <div key={i} className="bg-white dark:bg-red-950/20 p-2 rounded border border-red-100 dark:border-red-900/30">
                                  <div className="flex items-start gap-2 mb-1.5">
                                    <div className="w-1 h-1 bg-red-400 rounded-full mt-1.5 flex-shrink-0" />
                                    <span className="text-xs font-semibold text-red-700 dark:text-red-400 italic">
                                      Reason: {reason}
                                    </span>
                                  </div>
                                  <div className="pl-3 flex flex-wrap gap-1.5">
                                    {students.map(s => (
                                      <Badge key={s.id} variant="outline" className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-[10px] border-red-100 dark:border-red-800/50 py-0 h-4 font-normal">
                                        {s.fullName}
                                        <span className="opacity-70 ml-1">({s.stop_name})</span>
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Proposed Plan */}
                <div className="flex-1 p-5 scroll-smooth relative">
                  {plan.length === 0 ? (
                    <div className="text-center py-10 opacity-70">
                      <ListRestart className="w-12 h-12 mx-auto text-zinc-300 mb-3" />
                      <p className="text-zinc-500 font-medium">No valid reassignment options found.</p>
                    </div>
                  ) : (
                    <div className="space-y-4 pb-10">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                          <span className="w-2 h-6 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full" />
                          Proposed Assignment
                        </h3>
                        <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                          Moving {totalMoving} students
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        {plan.map((item, idx) => {
                          const impact = busLoadImpacts.get(item.bus.id);
                          const liveLoad = liveBusLoads.get(item.bus.id)!;

                          const capacity = item.bus.capacity || 50;
                          const baseTotal = (item.bus.load?.morningCount || 0) + (item.bus.load?.eveningCount || 0);
                          const projectedTotal = liveLoad.morning + liveLoad.evening;

                          const currentPercent = Math.min(100, (baseTotal / capacity) * 100);
                          const projectedPercent = Math.min(100, (projectedTotal / capacity) * 100);
                          const availableSeats = Math.max(0, capacity - projectedTotal);
                          const addedCount = item.students.length;

                          return (
                            <motion.div
                              key={item.bus.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.05 }}
                              className="group relative transition-all duration-300 rounded-xl p-4 shadow-lg border bg-zinc-900 border-zinc-800/80 hover:border-purple-500/50 hover:shadow-[0_0_20px_-5px_rgba(168,85,247,0.15)]"
                            >
                              {/* Bus Header */}
                              <div className="flex items-start justify-between mb-4 relative z-10">
                                <div className="flex items-start gap-3">
                                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg border bg-zinc-800 border-zinc-700 text-purple-400 group-hover:text-purple-300">
                                    <Bus className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2 mb-1">
                                      <h4 className="font-bold text-lg text-white tracking-tight">{item.bus.busNumber}</h4>
                                      <Badge variant="outline" className="text-[10px] h-5 border-zinc-700 text-zinc-400 font-normal">
                                        {item.bus.routeName}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge className={cn("text-[10px] px-1.5 h-4 border", normalizeShift(item.bus.shift) === "Morning" ? "bg-amber-500/10 border-amber-500/30 text-amber-500" : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400")}>
                                        {normalizeShift(item.bus.shift)}
                                      </Badge>
                                      <div className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold border", availableSeats > 5 ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20")}>
                                        {availableSeats} seats left
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Progress Stats */}
                              <div className="grid grid-cols-2 gap-4 mb-3 px-1">
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">Current Load</div>
                                  <div className="text-sm font-medium text-zinc-300">
                                    {currentPercent.toFixed(0)}% <span className="text-zinc-500 text-xs">({baseTotal})</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[10px] uppercase tracking-wider text-purple-400 font-bold mb-1">Projected</div>
                                  <div className="text-sm font-bold text-white">
                                    {projectedPercent.toFixed(0)}% <span className="text-zinc-500 text-xs font-normal">({projectedTotal})</span>
                                  </div>
                                </div>
                              </div>

                              <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden mb-4 border border-zinc-700/50">
                                <motion.div
                                  initial={{ width: `${currentPercent}%` }}
                                  animate={{ width: `${projectedPercent}%` }}
                                  className={cn("h-full rounded-full transition-all duration-1000", projectedPercent > 90 ? "bg-red-500" : "bg-gradient-to-r from-purple-600 to-pink-500")}
                                />
                              </div>

                              {/* Students List */}
                              <div className="space-y-2">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest flex items-center gap-2 pl-1 mb-1">
                                  <Users className="w-3 h-3" />
                                  Receiving {addedCount} student{addedCount > 1 ? "s" : ""}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {item.students.map((s) => (
                                    <Badge
                                      key={s.id}
                                      variant="secondary"
                                      onClick={() => {
                                        setActiveStudentId(s.id);
                                        setBusStopSelections({});
                                      }}
                                      className="py-1 px-2.5 bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 text-zinc-200 text-[11px] font-bold shadow-sm transition-all duration-200 cursor-pointer hover:scale-[1.02] active:scale-100"
                                    >
                                      {s.fullName}
                                      {s.overrideStopName && (
                                        <span className="text-[9px] text-purple-400 bg-purple-500/10 px-1 rounded ml-1">
                                          {s.overrideStopName}
                                        </span>
                                      )}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="manual-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <div className="px-5 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                  <div className="flex gap-4">
                    <button
                      onClick={() => { setAssignmentTab("current"); setBusStopSelections({}); }}
                      className={cn(
                        "py-2.5 text-sm font-bold transition-all relative px-3 rounded-t-lg hover:bg-white/50 dark:hover:bg-zinc-800/70 cursor-pointer",
                        assignmentTab === "current"
                          ? "text-purple-600 dark:text-purple-400 border-b-2 border-purple-600 dark:border-purple-400"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                      )}
                    >
                      Current Stop
                    </button>
                    <button
                      onClick={() => { setAssignmentTab("other"); setBusStopSelections({}); }}
                      className={cn(
                        "py-2.5 text-sm font-bold transition-all relative px-3 rounded-t-lg hover:bg-white/50 dark:hover:bg-zinc-800/70 cursor-pointer",
                        assignmentTab === "other"
                          ? "text-purple-600 dark:text-purple-400 border-b-2 border-purple-600 dark:border-purple-400"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                      )}
                    >
                      Other Buses
                    </button>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setActiveStudentId(null);
                      setBusStopSelections({});
                    }}
                    className="h-8 text-[11px] font-bold bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 shadow-sm transition-all"
                  >
                    <ArrowRight className="w-3 h-3 mr-1.5 rotate-180" />
                    Back to Plan
                  </Button>
                </div>

                {assignmentTab === "other" && (
                  <div className="px-5 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 flex items-center gap-2">
                    <button
                      onClick={() => { setOtherShiftTab("Morning"); setBusStopSelections({}); }}
                      className={cn(
                        "py-1 px-4 text-[11px] uppercase tracking-wider font-bold rounded-full transition-all cursor-pointer border",
                        otherShiftTab === "Morning"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 shadow-sm"
                          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      )}
                    >
                      Morning
                    </button>
                    <button
                      onClick={() => { setOtherShiftTab("Evening"); setBusStopSelections({}); }}
                      className={cn(
                        "py-1 px-4 text-[11px] uppercase tracking-wider font-bold rounded-full transition-all cursor-pointer border",
                        otherShiftTab === "Evening"
                          ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 shadow-sm"
                          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      )}
                    >
                      Evening
                    </button>
                  </div>
                )}

                <ScrollArea className="flex-1">
                  <div className="p-5 space-y-4">
                    {allBuses
                      .filter(bus => bus.id !== currentBus.id)
                      .filter(bus => {
                        if (assignmentTab === "current") {
                          const stop_name = activeStudent?.stop_name || "";
                          return normalizeShift(activeStudent?.shift) === normalizeShift(bus.shift) || bus.shift === "both"
                            ? busCoversStop(bus, stop_name)
                            : false;
                        } else {
                          // Filter for "Other Buses" using otherShiftTab
                          const busShift = normalizeShift(bus.shift);
                          return busShift === otherShiftTab || bus.shift?.toLowerCase() === "both";
                        }
                      })
                      .map((bus, idx) => {
                        const shift = normalizeShift(activeStudent?.shift);
                        const busLoad = liveBusLoads.get(bus.id)!;
                        const capacity = bus.capacity || 50;
                        const baseTotal = (bus.load?.morningCount || 0) + (bus.load?.eveningCount || 0);
                        const currentLiveTotal = busLoad.morning + busLoad.evening;

                        // Check if active student is currently assigned to this bus in draft
                        const isCurrentlyAssigned = draftAssignments[activeStudent!.id]?.busId === bus.id;

                        // If not assigned, show what happens if we add them
                        const projectedTotal = isCurrentlyAssigned ? currentLiveTotal : currentLiveTotal + 1;

                        const currentPercent = Math.min(100, (baseTotal / capacity) * 100);
                        const projectedPercent = Math.min(100, (projectedTotal / capacity) * 100);

                        const availableSeats = Math.max(0, capacity - projectedTotal);
                        const isFull = (shift === "Morning" ? busLoad.morning : busLoad.evening) >= capacity;

                        // Combined stops for the bus, normalized properties
                        const busStops = (bus.route?.stops || bus.stops || []).map((s: any) => ({
                          id: s.stop_name || s.id,
                          name: s.name as string
                        }));

                        return (
                          <motion.div
                            key={bus.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.03 }}
                            className={cn(
                              "group relative transition-all duration-300 rounded-xl p-4 shadow-lg border bg-zinc-900 border-zinc-700/60 hover:border-purple-500/50 hover:shadow-[0_0_20px_-5px_rgba(168,85,247,0.1)]",
                              isFull && "opacity-60 cursor-not-allowed"
                            )}
                          >
                            {/* Bus Header */}
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-start gap-3">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-zinc-800 border border-zinc-700 text-purple-400 group-hover:text-purple-300 shadow-lg">
                                  <Bus className="w-5 h-5" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <h4 className="font-bold text-white tracking-tight">{bus.busNumber}</h4>
                                    <Badge variant="outline" className="text-[10px] h-4 border-zinc-700 text-zinc-400 font-normal">
                                      {bus.routeName}
                                    </Badge>
                                  </div>
                                  <Badge className={cn("text-[10px] px-1.5 h-3.5 border", normalizeShift(bus.shift) === "Morning" ? "bg-amber-500/10 border-amber-500/30 text-amber-500" : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400")}>
                                    {normalizeShift(bus.shift)}
                                  </Badge>
                                </div>
                              </div>
                              <div className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold border", availableSeats > 5 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20")}>
                                {availableSeats} seats left
                              </div>
                            </div>

                            {/* Progress Stats */}
                            <div className="grid grid-cols-2 gap-4 mb-3 px-1">
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1">Current Load</div>
                                <div className="text-sm font-medium text-zinc-300">
                                  {currentPercent.toFixed(0)}% <span className="text-zinc-500 text-xs">({baseTotal})</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[10px] uppercase tracking-wider text-purple-400 font-bold mb-1">Projected</div>
                                <div className="text-sm font-bold text-white">
                                  {projectedPercent.toFixed(0)}% <span className="text-zinc-500 text-xs font-normal">({projectedTotal})</span>
                                </div>
                              </div>
                            </div>

                            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden mb-4 border border-zinc-700/50">
                              <motion.div
                                initial={{ width: `${currentPercent}%` }}
                                animate={{ width: `${projectedPercent}%` }}
                                className={cn("h-full rounded-full transition-all duration-1000", projectedPercent > 90 ? "bg-red-500" : "bg-gradient-to-r from-purple-600 to-pink-500")}
                              />
                            </div>

                            {/* Selection Logic */}
                            <div className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
                              {assignmentTab === "current" && (
                                <div className="mb-3">
                                  <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-1.5 pl-0.5 mb-1.5">
                                    Shift Option
                                  </label>
                                  {bus.shift?.toLowerCase() === "both" ? (
                                    <Select
                                      value={busShiftSelections[bus.id] || "Morning"}
                                      onValueChange={(val: "Morning"|"Evening") => setBusShiftSelections(prev => ({ ...prev, [bus.id]: val }))}
                                    >
                                      <SelectTrigger 
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="w-full h-9 bg-zinc-800 border-zinc-700 text-zinc-200 cursor-pointer"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent 
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        className="bg-zinc-900 border-zinc-800 text-zinc-100"
                                      >
                                        <SelectItem value="Morning">Morning</SelectItem>
                                        <SelectItem value="Evening">Evening</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input 
                                      readOnly 
                                      value={bus.shift?.toLowerCase() === "evening" ? "Evening" : "Morning"} 
                                      className="h-9 w-full bg-zinc-800/50 border-zinc-700 text-zinc-400 cursor-not-allowed font-medium text-sm" 
                                    />
                                  )}
                                </div>
                              )}

                              {assignmentTab === "other" ? (
                                <div className="space-y-3">
                                  <div className="space-y-1.5 ">
                                    <label className="text-[10px] uppercase font-bold text-zinc-500 flex items-center gap-1.5 pl-0.5">
                                      <MapPin className="w-3 h-3" />
                                      Select Stop (Compulsory)
                                    </label>
                                    <Select
                                      value={busStopSelections[bus.id] || ""}
                                      onValueChange={(value) => setBusStopSelections({ [bus.id]: value })}
                                    >
                                      <SelectTrigger 
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="w-full h-9 bg-zinc-800 border-zinc-700 text-zinc-200 focus:ring-purple-500 transition-all cursor-pointer"
                                      >
                                        <SelectValue placeholder="Choose a destination stop..." />
                                      </SelectTrigger>
                                      <SelectContent 
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        className="bg-zinc-900 border-zinc-800 text-zinc-100"
                                      >
                                        {busStops.map(stop => (
                                          <SelectItem key={stop.id} value={stop.id} className="focus:bg-zinc-800 focus:text-white cursor-pointer">
                                            {stop.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <Button
                                    disabled={isFull || !busStopSelections[bus.id]}
                                    onClick={() => {
                                      const selected_stop_name = busStopSelections[bus.id];
                                      const selectedStop = busStops.find(s => s.id === selected_stop_name);
                                      setDraftAssignments(prev => ({
                                        ...prev,
                                        [activeStudent!.id]: {
                                          busId: bus.id,
                                          stop_name: selectedStop?.name || selected_stop_name || "",
                                          shift: otherShiftTab
                                        }
                                      }));
                                      setActiveStudentId(null);
                                      setBusStopSelections({});
                                      toast.success(`Assigned to ${bus.busNumber} at ${selectedStop?.name}`);
                                    }}
                                    className="w-full bg-purple-600/90 hover:bg-purple-600 text-white h-9 shadow-lg shadow-purple-500/10 font-bold text-xs transition-all duration-300"
                                  >
                                    Assign to this Bus
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  disabled={isFull}
                                  onClick={() => {
                                    setDraftAssignments(prev => ({
                                      ...prev,
                                      [activeStudent!.id]: {
                                        busId: bus.id,
                                        stop_name: activeStudent!.stop_name || "",
                                        shift: bus.shift?.toLowerCase() === "both" ? (busShiftSelections[bus.id] || "Morning") : (bus.shift?.toLowerCase() === "evening" ? "Evening" : "Morning")
                                      }
                                    }));
                                    setActiveStudentId(null);
                                    toast.success(`Assigned to ${bus.busNumber}`);
                                  }}
                                  className="w-full bg-purple-600/90 hover:bg-purple-600 text-white h-9 shadow-lg shadow-purple-500/10 font-bold text-xs transition-all duration-300"
                                >
                                  Select Bus
                                </Button>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex-shrink-0 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {activeStudent ? (
              <span>Editing assignment for <strong>{activeStudent.fullName}</strong></span>
            ) : totalMoving > 0 ? (
              <span>
                Moving <strong className="text-zinc-900 dark:text-zinc-200">{totalMoving}</strong> students to <strong className="text-zinc-900 dark:text-zinc-200">{plan.length}</strong> buses
              </span>
            ) : (
              <span>No action to be taken</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!activeStudent ? (
              <>
                <Button variant="outline" onClick={onClose} disabled={isProcessing} className="h-9">
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={totalMoving === 0 || isProcessing}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white h-9 min-w-[120px]"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-2" /> Confirm All
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setActiveStudentId(null);
                  setBusStopSelections({});
                }}
                className="h-9 bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20 hover:text-red-400 font-bold transition-all"
              >
                Cancel Edit
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog >
  );
}
