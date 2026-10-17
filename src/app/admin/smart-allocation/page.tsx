"use client";

import { Suspense, useRef, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  Bus,
  Download,
  GraduationCap,
  History,
  RefreshCw,
  UserCog,
} from "lucide-react";
import { MobileActionFAB } from "@/components/layout/MobileActionFAB";
import { ReassignmentHistoryModal } from "@/components/assignment/ReassignmentHistoryModal";

// Modular Reassignment Tabs
import {
  StudentReassignmentTab,
  type StudentReassignmentTabRef,
} from "@/components/smart-allocation/StudentReassignmentTab";
import {
  DriverReassignmentTab,
  type DriverReassignmentTabRef,
} from "@/components/smart-allocation/DriverReassignmentTab";
import {
  BusRouteAllocationTab,
  type BusRouteAllocationTabRef,
} from "@/components/smart-allocation/BusRouteAllocationTab";

// Export shared types required by external services & components
export interface BusData {
  id: string;
  busNumber: string;
  routeId: string;
  routeName: string;
  driverId?: string;
  driverName?: string;
  driverPhoto?: string;
  currentMembers: number;
  capacity: number;
  shift: "morning" | "evening" | "both";
  stops: Array<{
    id: string;
    name: string;
    sequence: number;
    coordinates?: { lat: number; lng: number };
  }>;
  stopCounts?: Map<string, number>;
  load?: {
    morningCount?: number;
    eveningCount?: number;
  };
  route?: {
    routeId: string;
    routeName: string;
    stops: Array<{
      stop_name: string;
      name: string;
      sequence: number;
    }>;
  };
}

export interface StudentData {
  id: string;
  fullName: string;
  enrollmentId: string;
  stop_name: string;
  busId: string;
  semester?: string;
  phone?: string;
  photoURL?: string;
  shift?: "Morning" | "Evening" | "both" | "Both" | string;
}

export interface ReassignmentPlan {
  studentId: string;
  studentName: string;
  fromBusId: string;
  toBusId: string;
  toBusNumber: string;
  stop_name: string;
  reason?: string;
  studentShift?: string;
}

type ReassignmentTab = "students" | "drivers" | "buses";

function ReassignmentHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { currentUser, userData, loading: authLoading } = useAuth();

  // Tab State synced with URL (?tab=students | drivers | buses)
  const initialTab = (searchParams.get("tab") as ReassignmentTab) || "students";
  const [activeTab, setActiveTab] = useState<ReassignmentTab>(
    initialTab === "drivers" || initialTab === "buses" ? initialTab : "students"
  );

  // Synchronize when search param changes
  useEffect(() => {
    const tabParam = searchParams.get("tab") as ReassignmentTab;
    if (tabParam === "drivers" || tabParam === "buses" || tabParam === "students") {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Tab switcher handler (respects /admin and /moderator base paths)
  const handleTabChange = (tab: ReassignmentTab) => {
    setActiveTab(tab);
    const basePath = pathname?.startsWith("/moderator")
      ? "/moderator/smart-allocation"
      : "/admin/smart-allocation";
    router.replace(`${basePath}?tab=${tab}`, { scroll: false });
  };

  // Tab Refs for Cross-Header Actions
  const studentTabRef = useRef<StudentReassignmentTabRef>(null);
  const driverTabRef = useRef<DriverReassignmentTabRef>(null);
  const busTabRef = useRef<BusRouteAllocationTabRef>(null);

  // Live Stats for Master Header Badges (default 0 so all fleet buses show)
  const [threshold, setThreshold] = useState<number>(0);
  const [selectedStudentCount, setSelectedStudentCount] = useState<number>(0);
  const [overloadedCount, setOverloadedCount] = useState<number>(0);
  const [driverStagedCount, setDriverStagedCount] = useState<number>(0);
  const [busStagedCount, setBusStagedCount] = useState<number>(0);

  // Refresh State & Universal Handler
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (activeTab === "students") {
        await studentTabRef.current?.refresh?.();
      } else if (activeTab === "drivers") {
        await driverTabRef.current?.refresh?.();
      } else if (activeTab === "buses") {
        await busTabRef.current?.refresh?.();
      }
    } catch (err) {
      console.error("Refresh error:", err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }, [activeTab]);

  // History Modal State
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Universal Export Handler
  const handleExport = useCallback(() => {
    if (activeTab === "students") {
      studentTabRef.current?.exportData();
    } else if (activeTab === "drivers") {
      driverTabRef.current?.exportData();
    } else if (activeTab === "buses") {
      busTabRef.current?.exportData();
    }
  }, [activeTab]);

  // Auth Guard: Admin & Moderator permitted
  const isAuthorized = userData?.role === "admin" || userData?.role === "moderator";
  useEffect(() => {
    if (!authLoading && (!currentUser || !isAuthorized)) {
      router.push("/login");
    }
  }, [currentUser, isAuthorized, authLoading, router]);

  if (authLoading || !currentUser || !isAuthorized) {
    return (
      <div className="itms-admin-container !pt-[60px] !pb-3 !px-4 md:!px-8 h-[100dvh] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-muted-foreground font-medium">Initializing Reassignment Hub...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="itms-admin-container min-h-full h-auto lg:h-[100dvh] lg:max-h-[100dvh] !pb-24 lg:!pb-3.5 flex flex-col overflow-y-auto lg:overflow-hidden gap-3.5">
      {/* ── UNIFIED MASTER HEADER ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        {/* Top/Left Row: Hub Title, reduced icon, and Mobile Refresh Button at rightmost corner */}
        <div className="flex items-center justify-between gap-2 w-full md:w-auto">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-500 dark:text-teal-400 shrink-0">
              <ArrowLeftRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight truncate">
                Reassignment Hub
              </h1>
              <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-1 hidden sm:block">
                {activeTab === "students" && "Analyze bus load imbalances & stage student reassignments"}
                {activeTab === "drivers" && "Allocate & optimize driver shifts across operational fleet"}
                {activeTab === "buses" && "Reassign buses to operational routes with staging & validation"}
              </p>
            </div>
          </div>

          {/* Mobile-Only Refresh Button placed on the same line at the rightmost corner */}
          <div className="flex md:hidden items-center shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 px-2.5 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 shadow-xs rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              aria-label="Refresh Reassignment Hub"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-500",
                  isRefreshing ? "animate-spin text-teal-600 dark:text-teal-400" : "group-hover:rotate-180"
                )}
              />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* Tab Switcher (Full Width on mobile) & Desktop History/Export Buttons */}
        <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
          {/* Segmented Switcher Pills (Takes Full Width on mobile screens) */}
          <div className="w-full md:w-auto flex items-center h-8.5 sm:h-8 p-0.5 rounded-lg bg-slate-900/60 dark:bg-slate-900/80 border border-slate-700/50 backdrop-blur-md shadow-inner">
            {/* Tab: Students */}
            <button
              type="button"
              onClick={() => handleTabChange("students")}
              className={cn(
                "flex-1 md:flex-initial justify-center h-7.5 sm:h-7 flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer",
                activeTab === "students"
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              )}
            >
              <GraduationCap className="w-3.5 h-3.5" />
              <span>Students</span>
            </button>

            {/* Tab: Drivers */}
            <button
              type="button"
              onClick={() => handleTabChange("drivers")}
              className={cn(
                "flex-1 md:flex-initial justify-center h-7.5 sm:h-7 flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer",
                activeTab === "drivers"
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              )}
            >
              <UserCog className="w-3.5 h-3.5" />
              <span>Drivers</span>
              {driverStagedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500 text-black font-bold ml-0.5">
                  {driverStagedCount}
                </span>
              )}
            </button>

            {/* Tab: Buses */}
            <button
              type="button"
              onClick={() => handleTabChange("buses")}
              className={cn(
                "flex-1 md:flex-initial justify-center h-7.5 sm:h-7 flex items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition-all cursor-pointer",
                activeTab === "buses"
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              )}
            >
              <Bus className="w-3.5 h-3.5" />
              <span>Buses</span>
              {busStagedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-cyan-500 text-black font-bold ml-0.5">
                  {busStagedCount}
                </span>
              )}
            </button>
          </div>

          {/* Universal Desktop Action: View History */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistoryModal(true)}
            className="hidden md:inline-flex h-8 px-2.5 text-xs gap-1.5 cursor-pointer bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/60 shadow-xs font-semibold"
          >
            <History className="w-3.5 h-3.5 text-muted-foreground" />
            <span>History</span>
          </Button>

          {/* Universal Desktop Action: Export */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="hidden md:inline-flex h-8 px-2.5 text-xs gap-1.5 cursor-pointer bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/60 shadow-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Export</span>
          </Button>
        </div>
      </div>

      {/* ── UNIFIED 12-COLUMN WORKSPACE (IDENTICAL ACROSS ALL 3 TABS, ZERO SHIFT) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch flex-1 min-h-0 w-full overflow-visible lg:overflow-hidden">
        {activeTab === "students" && (
          <StudentReassignmentTab
            ref={studentTabRef}
            initialThreshold={threshold}
            onThresholdChange={setThreshold}
            onSelectedStudentsChange={setSelectedStudentCount}
            onOverloadedCountChange={setOverloadedCount}
          />
        )}
        {activeTab === "drivers" && (
          <DriverReassignmentTab
            ref={driverTabRef}
            onStagedCountChange={setDriverStagedCount}
          />
        )}
        {activeTab === "buses" && (
          <BusRouteAllocationTab
            ref={busTabRef}
            onStagedCountChange={setBusStagedCount}
          />
        )}
      </div>

      {/* ── UNIVERSAL REASSIGNMENT HISTORY MODAL ── */}
      <ReassignmentHistoryModal
        open={showHistoryModal}
        onOpenChange={setShowHistoryModal}
        defaultType={
          activeTab === "students"
            ? "student_reassignment"
            : activeTab === "drivers"
              ? "driver_reassignment"
              : "route_reassignment"
        }
      />

      {/* ── MOBILE ACTION FAB (History & Export) ── */}
      <MobileActionFAB
        ariaLabel="Reassignment Hub quick actions"
        actions={[
          {
            label: "Reassignment History",
            icon: History,
            onClick: () => setShowHistoryModal(true),
            color: "bg-purple-600 text-white",
          },
          {
            label: "Export Allocations",
            icon: Download,
            onClick: handleExport,
            color: "bg-emerald-600 text-white",
          },
        ]}
      />
    </div>
  );
}

export default function SmartAllocationPage() {
  return (
    <Suspense
      fallback={
        <div className="itms-admin-container h-[100dvh] !pb-3.5 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-muted-foreground font-medium">Loading Reassignment Hub...</p>
          </div>
        </div>
      }
    >
      <ReassignmentHubContent />
    </Suspense>
  );
}