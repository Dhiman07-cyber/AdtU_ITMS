"use client";

import Avatar from "@/components/Avatar";
import { ExportButton } from "@/components/ExportButton";
import { MobileActionFAB } from "@/components/layout/MobileActionFAB";
import { TableRowLoader } from "@/components/LoadingSpinner";
import { PermissionDeniedCard } from "@/components/PermissionDeniedCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import { invalidateCollectionCache, useApiCollection } from "@/hooks/useApiCollection";
import { useEventDrivenRefresh } from "@/hooks/useEventDrivenRefresh";
import { useLocalAndServerSearch } from "@/hooks/useLocalAndServerSearch";
import { useModeratorPermissions } from "@/hooks/useModeratorPermissions";
import { deleteDriver } from "@/lib/dataService";
import { exportToExcel } from "@/lib/export-helpers";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { cn } from "@/lib/utils";
import { formatDateDDMMYYYY } from "@/lib/utils/date-utils";
import {
  Bus,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit,
  Eye,
  GitCompareArrows,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function ModeratorDriversHub() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const {
    canDriverView,
    canDriverAdd,
    canDriverEdit,
    canDriverDelete,
    canDriverReassign,
    loading: permsLoading,
  } = useModeratorPermissions();
  const router = useRouter();

  // Load drivers & buses via API collection (PostgreSQL backed)
  const {
    data: rawDrivers,
    loading: loadingDrivers,
    refresh: refreshDrivers,
  } = useApiCollection("drivers", {
    pageSize: 100,
    orderByField: "updatedAt",
    orderDirection: "desc",
    autoRefresh: false,
  });

  const {
    data: buses,
    loading: loadingBuses,
    refresh: refreshBuses,
  } = useApiCollection("buses", {
    pageSize: 100,
    orderByField: "busNumber",
    orderDirection: "asc",
    autoRefresh: false,
  });

  useEventDrivenRefresh({
    collectionName: "drivers",
    onRefresh: async () => {
      await Promise.all([refreshDrivers(), refreshBuses()]);
    },
  });

  const drivers = useMemo(() => {
    return (rawDrivers || []).map((d: any) => {
      const id = d.id || d.uid;
      return {
        ...d,
        id,
        status: d.status || "active",
      };
    });
  }, [rawDrivers]);

  // Index buses for O(1) lookup
  const busById = useMemo(() => {
    const map = new Map<string, any>();
    for (const b of buses || []) {
      if (b.busId) map.set(b.busId, b);
      if (b.id) map.set(b.id, b);
      if (b.busNumber) map.set(b.busNumber, b);
    }
    return map;
  }, [buses]);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Delete Modal State
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isLoading = authLoading || loadingDrivers || loadingBuses;

  // Refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache("drivers");
      invalidateCollectionCache("buses");
      await Promise.all([refreshDrivers(), refreshBuses()]);
      addToast("Driver directory refreshed", "success");
    } catch (error) {
      console.error("Error refreshing drivers:", error);
      addToast("Failed to refresh data", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Delete Driver Execution
  const executeDelete = async () => {
    if (!deleteItem) return;

    try {
      setIsDeleting(true);
      const success = await deleteDriver(deleteItem.id);
      if (success) {
        invalidateCollectionCache("drivers");
        await Promise.all([refreshDrivers(), refreshBuses()]);
        addToast(`Driver ${deleteItem.name} removed successfully`, "success");
      } else {
        addToast("Failed to delete driver", "error");
      }
    } catch (error) {
      console.error("Error deleting driver:", error);
      addToast("Error deleting driver", "error");
    } finally {
      setIsDeleting(false);
      setDeleteItem(null);
    }
  };

  // Export report
  const handleExportDrivers = async () => {
    try {
      const dateStr = new Date().toISOString().split("T")[0];
      const exportData = drivers.map((driver: any, index: number) => {
        const assignedBus = busById.get(driver.busId);
        const busDisplay = assignedBus
          ? `Bus ${assignedBus.busNumber}${assignedBus.routeNumber ? ` (R-${assignedBus.routeNumber})` : ""}`
          : "Reserved";

        return [
          (index + 1).toString(),
          driver.name || driver.fullName || "N/A",
          driver.email || "N/A",
          driver.phone || "N/A",
          driver.employeeId || driver.empId || "N/A",
          driver.licenseNumber || "N/A",
          busDisplay,
          (driver.status || "active").toUpperCase(),
          driver.joiningDate || driver.joinDate ? formatDateDDMMYYYY(driver.joiningDate || driver.joinDate) : "N/A",
        ];
      });

      exportData.unshift([
        "Sl No",
        "Name",
        "Email",
        "Phone",
        "Employee ID",
        "License",
        "Assigned Fleet",
        "Status",
        "Joined Date",
      ]);
      exportData.unshift(["DRIVER OPERATIONS & FLEET REPORT"], [""]);

      await exportToExcel(exportData, `ADTU_Drivers_Report_${dateStr}`, "Drivers");
      addToast(`Exported ${drivers.length} drivers to Excel`, "success");
    } catch (error) {
      console.error("Error exporting drivers:", error);
      addToast("Failed to export drivers data", "error");
    }
  };

  // Role-Specific Metrics: Drivers
  const metrics = useMemo(() => {
    let total = drivers.length;
    let activeCount = 0;
    let suspendedCount = 0;
    let assignedCount = 0;

    for (const d of drivers) {
      const st = (d.status || "active").toLowerCase();
      if (st === "active") activeCount++;
      else suspendedCount++;

      if (d.busId) assignedCount++;
    }

    return { total, activeCount, suspendedCount, assignedCount };
  }, [drivers]);

  // Local matcher for Tier 1 search (0ms, 0 network calls)
  const driverLocalMatcher = useMemo(() => {
    return (driver: any, term: string) => {
      const assignedBus = busById.get(driver.busId);
      const busText = assignedBus ? `${assignedBus.busNumber} ${assignedBus.routeNumber || ""}`.toLowerCase() : "reserved";
      const name = (driver.name || driver.fullName || "").toLowerCase();
      const email = (driver.email || "").toLowerCase();
      const phone = (driver.phone || driver.phoneNumber || "");
      const employeeId = (driver.employeeId || driver.empId || "").toLowerCase();
      const licenseNumber = (driver.licenseNumber || "").toLowerCase();

      return (
        name.includes(term) ||
        email.includes(term) ||
        phone.includes(term) ||
        employeeId.includes(term) ||
        licenseNumber.includes(term) ||
        busText.includes(term)
      );
    };
  }, [busById]);

  const {
    results: searchedDrivers,
    isSearchingServer,
    isServerFallback,
  } = useLocalAndServerSearch(
    drivers,
    searchTerm,
    driverLocalMatcher,
    "/api/drivers",
    {
      extractItems: (json: any) => json.drivers || json.data || [],
    }
  );

  // Filtered List
  const filteredDrivers = useMemo(() => {
    return searchedDrivers.filter((driver) => {
      const currentStatus = (driver.status || "active").toLowerCase();
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && currentStatus === "active") ||
        (statusFilter === "suspended" && currentStatus !== "active");

      const matchesAssignment =
        assignmentFilter === "all" ||
        (assignmentFilter === "assigned" && Boolean(driver.busId)) ||
        (assignmentFilter === "reserved" && !driver.busId);

      let matchesExperience = true;
      if (experienceFilter !== "all") {
        const joinDateStr = driver.joiningDate || driver.joinDate || driver.createdAt;
        if (joinDateStr) {
          const joinDate = new Date(joinDateStr);
          const years = Math.floor((Date.now() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
          if (experienceFilter === "0-2") matchesExperience = years >= 0 && years <= 2;
          else if (experienceFilter === "3-5") matchesExperience = years >= 3 && years <= 5;
          else if (experienceFilter === "6-10") matchesExperience = years >= 6 && years <= 10;
          else if (experienceFilter === "10+") matchesExperience = years > 10;
        } else {
          matchesExperience = false;
        }
      }

      return matchesStatus && matchesAssignment && matchesExperience;
    });
  }, [searchedDrivers, statusFilter, assignmentFilter, experienceFilter]);

  // Section Pagination & Anti-Layout-Shift State
  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const [isPaginating, setIsPaginating] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, assignmentFilter, experienceFilter]);

  const totalPages = Math.max(currentPage, Math.max(1, Math.ceil(filteredDrivers.length / PAGE_SIZE)));
  const validatedPage = Math.max(1, Math.min(currentPage, totalPages));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedDrivers = useMemo(() => {
    const startIndex = (validatedPage - 1) * PAGE_SIZE;
    const slice = filteredDrivers.slice(startIndex, startIndex + PAGE_SIZE);
    if (slice.length === 0 && filteredDrivers.length > 0) {
      const fallbackStart = Math.max(0, filteredDrivers.length - PAGE_SIZE);
      return filteredDrivers.slice(fallbackStart);
    }
    return slice;
  }, [filteredDrivers, validatedPage, PAGE_SIZE]);

  const handleNextPage = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (isPaginating || validatedPage >= totalPages) return;
    setIsPaginating(true);
    setTimeout(() => {
      setCurrentPage((prev) => Math.min(totalPages, prev + 1));
      setIsPaginating(false);
    }, 200);
  };

  const handlePrevPage = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (isPaginating || validatedPage <= 1) return;
    setIsPaginating(true);
    setTimeout(() => {
      setCurrentPage((prev) => Math.max(1, prev - 1));
      setIsPaginating(false);
    }, 180);
  };

  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push("/login");
    }

    if (userData && userData.role !== "admin" && userData.role !== "moderator") {
      router.push(`/${userData.role}`);
    }
  }, [currentUser, userData, authLoading, router]);

  if (authLoading && !currentUser) {
    return (
      <div className="itms-admin-container space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
      </div>
    );
  }

  if (!currentUser || !userData || (userData.role !== "admin" && userData.role !== "moderator")) {
    return null;
  }

  if (!permsLoading && !canDriverView) {
    return (
      <PermissionDeniedCard
        title="Drivers Section Restricted"
        actionName="Viewing Drivers"
        showGoBack={false}
      />
    );
  }

  return (
    <div className="itms-admin-container space-y-6 pb-20">
      {/* ── HEADER ── */}
      <div className="itms-page-header-container">
        <div className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-500">
                <UserCog className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight">
                Driver Management Hub
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage drivers, active vehicle assignments, operational readiness, and portal access control.
            </p>
          </div>

          {/* Desktop Toolbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {canDriverAdd && (
              <Link href="/moderator/drivers/add">
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 cursor-pointer gap-1.5">
                  <Plus className="h-4 w-4" />
                  <span>Add Driver</span>
                </Button>
              </Link>
            )}
            {canDriverReassign && (
              <Link href="/moderator/smart-allocation?tab=drivers">
                <Button className="bg-purple-600/90 hover:bg-purple-600 text-white border border-purple-500/30 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md rounded-lg px-2.5 py-1.5 text-xs h-9 cursor-pointer gap-1.5">
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  <span>Reassign Hub</span>
                </Button>
              </Link>
            )}
            <ExportButton
              onClick={handleExportDrivers}
              label="Export"
              className="h-9 px-3.5 bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/60 shadow-xs text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
            />
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-9 px-3.5 bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/60 shadow-xs text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-500",
                  isRefreshing && "animate-spin"
                )}
              />
              <span>Refresh</span>
            </Button>
          </div>

          {/* Mobile Refresh Button */}
          <div className="flex md:hidden items-center shrink-0">
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 px-3 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 hover:text-indigo-600 dark:hover:text-indigo-400 border border-gray-200 dark:border-zinc-700 shadow-sm rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all shrink-0"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-500",
                  isRefreshing ? "animate-spin text-indigo-600" : "group-hover:rotate-180"
                )}
              />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* ── TOP 4 ROLE-SPECIFIC CONTROL CARDS (DRIVERS) ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 mt-4 sm:mt-5">
          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:justify-between">
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shrink-0 sm:order-2">
                <Users className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 sm:order-1">
                <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                  Total Drivers
                </p>
                <p className="text-base sm:text-xl md:text-2xl font-black text-foreground mt-0.5 leading-tight">
                  {metrics.total}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:justify-between">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0 sm:order-2">
                <UserCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 sm:order-1">
                <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                  Active Access
                </p>
                <p className="text-base sm:text-xl md:text-2xl font-black text-emerald-500 mt-0.5 leading-tight">
                  {metrics.activeCount}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:justify-between">
              <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20 shrink-0 sm:order-2">
                <UserX className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 sm:order-1">
                <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                  Access Suspended
                </p>
                <p className="text-base sm:text-xl md:text-2xl font-black text-rose-500 mt-0.5 leading-tight">
                  {metrics.suspendedCount}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:justify-between">
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20 shrink-0 sm:order-2">
                <Bus className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1 sm:order-1">
                <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                  Fleet Assigned
                </p>
                <p className="text-base sm:text-xl md:text-2xl font-black text-purple-500 mt-0.5 leading-tight">
                  {metrics.assignedCount}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── SEARCH & FILTERS ── */}
      <Card className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              {isSearchingServer ? (
                <Loader2 className="absolute left-3 top-2.5 h-4 w-4 text-blue-500 animate-spin" />
              ) : (
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              )}
              <Input
                placeholder="Search by name, email, phone, employee ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-24 h-9 text-xs bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60 focus:bg-white dark:focus:bg-zinc-900 transition-colors"
              />
              <div className="absolute right-2.5 top-2 flex items-center gap-1.5">
                {isServerFallback && (
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                    Server Match
                  </span>
                )}
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[130px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectItem value="all" className="text-xs">
                    All Status
                  </SelectItem>
                  <SelectItem value="active" className="text-xs text-emerald-400">
                    Active
                  </SelectItem>
                  <SelectItem value="suspended" className="text-xs text-rose-400">
                    Suspended
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={assignmentFilter} onValueChange={setAssignmentFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[145px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Fleet Role" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectItem value="all" className="text-xs">
                    All Drivers
                  </SelectItem>
                  <SelectItem value="assigned" className="text-xs text-purple-400">
                    Bus Assigned
                  </SelectItem>
                  <SelectItem value="reserved" className="text-xs text-emerald-400">
                    Reserved Fleet
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={experienceFilter} onValueChange={setExperienceFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[130px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Experience" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectItem value="all" className="text-xs">
                    All Experience
                  </SelectItem>
                  <SelectItem value="0-2" className="text-xs">
                    0-2 Years
                  </SelectItem>
                  <SelectItem value="3-5" className="text-xs">
                    3-5 Years
                  </SelectItem>
                  <SelectItem value="6-10" className="text-xs">
                    6-10 Years
                  </SelectItem>
                  <SelectItem value="10+" className="text-xs">
                    10+ Years
                  </SelectItem>
                </SelectContent>
              </Select>

              {(statusFilter !== "all" ||
                assignmentFilter !== "all" ||
                experienceFilter !== "all" ||
                searchTerm) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("all");
                    setAssignmentFilter("all");
                    setExperienceFilter("all");
                    setSearchTerm("");
                  }}
                  className="h-9 px-3 text-xs bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg col-span-2 md:col-span-1"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          {/* ── DRIVERS TABLE ── */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs relative">
            {isPaginating && (
              <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-indigo-500/10 dark:bg-indigo-400/10 overflow-hidden">
                <div className="animate-progress w-full h-full bg-indigo-500 dark:bg-indigo-400 origin-left-right" />
              </div>
            )}
            <div
              className={cn(
                "overflow-x-auto min-h-[520px] transition-opacity duration-200",
                isPaginating && "opacity-60 pointer-events-none"
              )}
            >
              <Table className="w-full table-fixed min-w-[850px]">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <TableHeader className="bg-slate-50 dark:bg-zinc-800/50">
                  <TableRow className="h-9 border-b border-zinc-200 dark:border-zinc-800">
                    <TableHead className="w-[26%] text-[11px] font-bold py-2">Driver</TableHead>
                    <TableHead className="w-[18%] text-[11px] font-bold py-2">Contact Details</TableHead>
                    <TableHead className="w-[18%] text-[11px] font-bold py-2">Employee & License</TableHead>
                    <TableHead className="w-[18%] text-[11px] font-bold py-2">Fleet Assignment</TableHead>
                    <TableHead className="w-[12%] text-[11px] font-bold py-2">Portal Access</TableHead>
                    <TableHead className="w-[8%] text-[11px] font-bold py-2 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && filteredDrivers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="p-8">
                        <TableRowLoader rows={5} />
                      </TableCell>
                    </TableRow>
                  ) : filteredDrivers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-44 text-center">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <ShieldAlert className="w-8 h-8 text-muted-foreground/60" />
                          <p className="text-sm font-medium text-foreground">No drivers found</p>
                          <p className="text-xs text-muted-foreground">
                            Try adjusting your search terms or filters.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedDrivers.map((driver) => {
                      const isActive =
                        (driver.status || "active").toLowerCase() === "active";
                      const assignedBus = busById.get(driver.busId);

                      return (
                        <TableRow
                          key={driver.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors border-b border-zinc-100 dark:border-zinc-800/60"
                        >
                          {/* Driver Name & Email */}
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar
                                src={safeImageSrc(driver.profilePhotoUrl)}
                                name={driver.name || driver.fullName}
                                size="sm"
                                className="flex-shrink-0 border border-zinc-200 dark:border-zinc-700"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-foreground truncate">
                                  {driver.name || driver.fullName || "Unnamed Driver"}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {driver.email}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          {/* Contact */}
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="space-y-0.5 truncate">
                              <div className="text-[11px] font-medium text-foreground truncate">
                                Ph: {driver.phone || "N/A"}
                              </div>
                              {driver.alternatePhone && (
                                <div className="text-[10px] text-muted-foreground truncate">
                                  Alt: {driver.alternatePhone}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Employee ID & License */}
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="space-y-0.5 truncate">
                              <div className="font-mono text-[11px] font-semibold text-foreground truncate">
                                {driver.employeeId || driver.empId || "N/A"}
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono truncate">
                                Lic: {driver.licenseNumber || "N/A"}
                              </div>
                            </div>
                          </TableCell>

                          {/* Fleet Assignment */}
                          <TableCell className="py-2.5 overflow-hidden">
                            {assignedBus ? (
                              <div className="flex items-center gap-1.5 truncate">
                                <Badge
                                  variant="outline"
                                  className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0"
                                >
                                  <Bus className="w-3 h-3" />
                                  <span>Bus {assignedBus.busNumber}</span>
                                </Badge>
                                {assignedBus.routeNumber && (
                                  <span className="text-[10px] text-muted-foreground truncate">
                                    (R-{assignedBus.routeNumber})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0"
                              >
                                Reserved Fleet
                              </Badge>
                            )}
                          </TableCell>

                          {/* Access Status */}
                          <TableCell className="py-2.5 overflow-hidden">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit shrink-0",
                                isActive
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              )}
                            >
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full shrink-0",
                                  isActive
                                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                                    : "bg-rose-400"
                                )}
                              />
                              {isActive ? "Active" : "Suspended"}
                            </Badge>
                          </TableCell>

                          {/* Actions Menu */}
                          <TableCell className="py-2.5 text-right overflow-hidden">
                            <div className="flex items-center justify-end gap-1.5">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    className="h-7 w-7 p-0 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
                                  >
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl w-48 p-1"
                                >
                                  <DropdownMenuLabel className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1">
                                    Driver Controls
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator className="bg-zinc-100 dark:bg-zinc-800" />
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/moderator/drivers/view/${driver.id}`}
                                      className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                    >
                                      <Eye className="h-3.5 w-3.5 text-slate-400" />
                                      View Details
                                    </Link>
                                  </DropdownMenuItem>
                                  {canDriverEdit && (
                                    <DropdownMenuItem asChild>
                                      <Link
                                        href={`/moderator/drivers/edit/${driver.id}`}
                                        className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                      >
                                        <Edit className="h-3.5 w-3.5 text-amber-400" />
                                        Edit Profile
                                      </Link>
                                    </DropdownMenuItem>
                                  )}
                                  {canDriverDelete && (
                                    <>
                                      <DropdownMenuSeparator className="bg-zinc-100 dark:bg-zinc-800" />
                                      <DropdownMenuItem
                                        onClick={() =>
                                          setDeleteItem({
                                            id: driver.id,
                                            name: driver.name || driver.fullName || "Driver",
                                          })
                                        }
                                        className="text-xs text-rose-500 hover:!bg-rose-500/10 cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Delete Driver
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Footer */}
            {filteredDrivers.length > 0 && (
              <div className="pt-3 pb-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-200/60 dark:border-zinc-800/60 px-4 bg-white dark:bg-zinc-900/50">
                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                  Showing{" "}
                  <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                    {(validatedPage - 1) * PAGE_SIZE + 1}–{Math.min(validatedPage * PAGE_SIZE, filteredDrivers.length)}
                  </strong>{" "}
                  of{" "}
                  <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                    {filteredDrivers.length}
                  </strong>{" "}
                  drivers
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePrevPage}
                    disabled={validatedPage <= 1 || isPaginating}
                    className="text-xs border bg-white dark:bg-zinc-800 text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-700/80 rounded-lg px-3 h-8 cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Previous</span>
                  </Button>

                  <div className="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800/80 text-[11px] font-medium font-mono text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                    Page {validatedPage} of {totalPages}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={validatedPage >= totalPages || isPaginating}
                    className="text-xs border bg-white dark:bg-zinc-800 text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-700/80 rounded-lg px-3 h-8 cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isPaginating ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Loading...</span>
                      </>
                    ) : (
                      <>
                        <span>Next</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── DELETE DRIVER MODAL ── */}
      <Dialog
        open={Boolean(deleteItem)}
        onOpenChange={(open) => !open && setDeleteItem(null)}
      >
        <DialogContent className="bg-slate-900 border-zinc-800 text-slate-100 max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-white">
                  Delete Driver Profile
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400 mt-1">
                  Are you sure you want to remove{" "}
                  <strong className="text-zinc-200">{deleteItem?.name}</strong>? This will detach
                  their vehicle assignment and revoke authentication.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteItem(null)}
              className="bg-transparent border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={executeDelete}
              disabled={isDeleting}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold"
            >
              {isDeleting ? (
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </div>
              ) : (
                "Delete Driver"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile Floating Action Button (FAB) */}
      <MobileActionFAB
        ariaLabel="Driver control hub actions"
        actions={[
          ...(canDriverAdd
            ? [
                {
                  label: "Add Driver",
                  icon: Plus,
                  href: "/moderator/drivers/add",
                  color: "bg-indigo-600 text-white",
                },
              ]
            : []),
          ...(canDriverReassign
            ? [
                {
                  label: "Reassign Hub",
                  icon: GitCompareArrows,
                  href: "/moderator/smart-allocation?tab=drivers",
                  color: "bg-purple-600 text-white",
                },
              ]
            : []),
          {
            label: "Export",
            icon: Download,
            onClick: handleExportDrivers,
            color: "bg-emerald-600 text-white",
          },
        ]}
      />
    </div>
  );
}
