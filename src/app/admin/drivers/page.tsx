"use client";

import Avatar from "@/components/Avatar";
import { ExportButton } from "@/components/ExportButton";
import { MobileActionFAB } from "@/components/layout/MobileActionFAB";
import { TableRowLoader } from "@/components/LoadingSpinner";
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
import { deleteDriver } from "@/lib/dataService";
import { exportToExcel } from "@/lib/export-helpers";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { supabase } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";
import { formatDateDDMMYYYY } from "@/lib/utils/date-utils";
import {
  Bus,
  CheckCircle2,
  Download,
  Edit,
  Eye,
  GitCompareArrows,
  Lock,
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
import { useMemo, useState } from "react";

export default function AdminDriversHub() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  // Load drivers & buses
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

  // Local optimistic overrides for status changes
  const [localOverrides, setLocalOverrides] = useState<Record<string, { status: string }>>({});

  const drivers = useMemo(() => {
    return (rawDrivers || []).map((d: any) => {
      const id = d.id || d.uid;
      const override = localOverrides[id];
      return {
        ...d,
        id,
        status: override?.status || d.status || "active",
      };
    });
  }, [rawDrivers, localOverrides]);

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

  // Status Action Modal State
  const [statusConfirmItem, setStatusConfirmItem] = useState<{
    id: string;
    name: string;
    targetStatus: "active" | "suspended";
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

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

  // Toggle Status directly
  const handleToggleStatus = (driver: any) => {
    const isCurrentlyActive = (driver.status || "active").toLowerCase() === "active";
    setStatusConfirmItem({
      id: driver.id,
      name: driver.name || driver.fullName || "Driver",
      targetStatus: isCurrentlyActive ? "suspended" : "active",
    });
  };

  const executeStatusChange = async () => {
    if (!statusConfirmItem) return;

    try {
      setUpdatingStatus(true);
      const token = await currentUser?.getIdToken();
      if (!token) {
        addToast("Authentication required", "error");
        return;
      }

      const res = await fetch(`/api/drivers/${statusConfirmItem.id}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: statusConfirmItem.targetStatus,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to update driver status");
      }

      setLocalOverrides((prev) => ({
        ...prev,
        [statusConfirmItem.id]: {
          status: statusConfirmItem.targetStatus,
        },
      }));

      invalidateCollectionCache("drivers");
      addToast(
        statusConfirmItem.targetStatus === "active"
          ? `Portal access restored for ${statusConfirmItem.name}.`
          : `Portal access revoked for ${statusConfirmItem.name}.`,
        "success"
      );
    } catch (error: any) {
      console.error("Error toggling driver status:", error);
      addToast(error.message || "Failed to update driver status", "error");
    } finally {
      setUpdatingStatus(false);
      setStatusConfirmItem(null);
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

  // Filtered List
  const filteredDrivers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return drivers.filter((driver) => {
      const assignedBus = busById.get(driver.busId);
      const busText = assignedBus ? `${assignedBus.busNumber} ${assignedBus.routeNumber || ""}` : "reserved";

      const matchesSearch =
        !searchTerm ||
        (driver.name && driver.name.toLowerCase().includes(term)) ||
        (driver.email && driver.email.toLowerCase().includes(term)) ||
        (driver.fullName && driver.fullName.toLowerCase().includes(term)) ||
        (driver.phone && driver.phone.includes(searchTerm)) ||
        (driver.employeeId && driver.employeeId.toLowerCase().includes(term)) ||
        (driver.licenseNumber && driver.licenseNumber.toLowerCase().includes(term)) ||
        busText.toLowerCase().includes(term);

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

      return matchesSearch && matchesStatus && matchesAssignment && matchesExperience;
    });
  }, [drivers, searchTerm, statusFilter, assignmentFilter, experienceFilter, busById]);

  if (authLoading && !currentUser) {
    return (
      <div className="itms-admin-container space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
      </div>
    );
  }

  if (!currentUser || !userData || userData.role !== "admin") {
    return null;
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
            <Link href="/admin/drivers/add">
              <Button className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 cursor-pointer gap-1.5">
                <Plus className="h-4 w-4" />
                <span>Add Driver</span>
              </Button>
            </Link>
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
        </div>

        {/* ── TOP 4 ROLE-SPECIFIC CONTROL CARDS (DRIVERS) ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Drivers
                </p>
                <p className="text-xl md:text-2xl font-black text-foreground mt-0.5">
                  {metrics.total}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                <Users className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Active Access
                </p>
                <p className="text-xl md:text-2xl font-black text-emerald-500 mt-0.5">
                  {metrics.activeCount}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <UserCheck className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Access Suspended
                </p>
                <p className="text-xl md:text-2xl font-black text-rose-500 mt-0.5">
                  {metrics.suspendedCount}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <UserX className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Fleet Assigned
                </p>
                <p className="text-xl md:text-2xl font-black text-purple-500 mt-0.5">
                  {metrics.assignedCount}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-500 border border-purple-500/20">
                <Bus className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── SEARCH & FILTERS ── */}
      <Card className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search drivers by name, phone, employee ID, license, assigned bus..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs w-full bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60 rounded-lg"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Dropdowns */}
            <div className="grid grid-cols-2 md:flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[135px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectItem value="all" className="text-xs">
                    All Statuses
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
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 dark:bg-zinc-800/50">
                  <TableRow className="h-9 border-b border-zinc-200 dark:border-zinc-800">
                    <TableHead className="text-[11px] font-bold py-2">Driver</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Contact Details</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Employee & License</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Fleet Assignment</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Portal Access</TableHead>
                    <TableHead className="text-[11px] font-bold py-2 text-right">Actions</TableHead>
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
                    filteredDrivers.map((driver) => {
                      const isActive =
                        (driver.status || "active").toLowerCase() === "active";
                      const assignedBus = busById.get(driver.busId);

                      return (
                        <TableRow
                          key={driver.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors border-b border-zinc-100 dark:border-zinc-800/60"
                        >
                          {/* Driver Name & Email */}
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar
                                src={safeImageSrc(driver.profilePhotoUrl)}
                                name={driver.name || driver.fullName}
                                size="sm"
                                className="flex-shrink-0 border border-zinc-200 dark:border-zinc-700"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-foreground truncate max-w-[180px] sm:max-w-none">
                                  {driver.name || driver.fullName || "Unnamed Driver"}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate max-w-[180px] sm:max-w-none">
                                  {driver.email}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          {/* Contact */}
                          <TableCell className="py-2.5">
                            <div className="space-y-0.5">
                              <div className="text-[11px] font-medium text-foreground">
                                Ph: {driver.phone || "N/A"}
                              </div>
                              {driver.alternatePhone && (
                                <div className="text-[10px] text-muted-foreground">
                                  Alt: {driver.alternatePhone}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Employee ID & License */}
                          <TableCell className="py-2.5">
                            <div className="space-y-0.5">
                              <div className="font-mono text-[11px] font-semibold text-foreground">
                                {driver.employeeId || driver.empId || "N/A"}
                              </div>
                              <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
                                Lic: {driver.licenseNumber || "N/A"}
                              </div>
                            </div>
                          </TableCell>

                          {/* Fleet Assignment */}
                          <TableCell className="py-2.5">
                            {assignedBus ? (
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1"
                                >
                                  <Bus className="w-3 h-3" />
                                  <span>Bus {assignedBus.busNumber}</span>
                                </Badge>
                                {assignedBus.routeNumber && (
                                  <span className="text-[10px] text-muted-foreground">
                                    (R-{assignedBus.routeNumber})
                                  </span>
                                )}
                              </div>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                              >
                                Reserved Fleet
                              </Badge>
                            )}
                          </TableCell>

                          {/* Access Status */}
                          <TableCell className="py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit",
                                isActive
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                              )}
                            >
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  isActive
                                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                                    : "bg-rose-400"
                                )}
                              />
                              {isActive ? "Active" : "Suspended"}
                            </Badge>
                          </TableCell>

                          {/* Actions Menu */}
                          <TableCell className="py-2.5 text-right">
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
                                  <DropdownMenuItem
                                    onClick={() => handleToggleStatus(driver)}
                                    className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                  >
                                    {isActive ? (
                                      <>
                                        <Lock className="h-3.5 w-3.5 text-rose-400" />
                                        <span className="text-rose-400">Revoke Access</span>
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                        <span className="text-emerald-400">Restore Access</span>
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/admin/drivers/view/${driver.id}`}
                                      className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                    >
                                      <Eye className="h-3.5 w-3.5 text-slate-400" />
                                      View Details
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/admin/drivers/edit/${driver.id}`}
                                      className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                    >
                                      <Edit className="h-3.5 w-3.5 text-amber-400" />
                                      Edit Profile
                                    </Link>
                                  </DropdownMenuItem>
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
          </div>
        </CardContent>
      </Card>

      {/* ── CONFIRM ACCESS REVOCATION / RESTORATION MODAL ── */}
      <Dialog
        open={Boolean(statusConfirmItem)}
        onOpenChange={(open) => !open && setStatusConfirmItem(null)}
      >
        <DialogContent className="bg-slate-900 border-zinc-800 text-slate-100 max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "p-2.5 rounded-xl border",
                  statusConfirmItem?.targetStatus === "suspended"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                )}
              >
                {statusConfirmItem?.targetStatus === "suspended" ? (
                  <UserX className="w-5 h-5" />
                ) : (
                  <UserCheck className="w-5 h-5" />
                )}
              </div>
              <DialogTitle className="text-base font-bold text-white">
                {statusConfirmItem?.targetStatus === "suspended"
                  ? "Revoke Driver Portal Access"
                  : "Restore Driver Portal Access"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 pt-2">
              {statusConfirmItem?.targetStatus === "suspended" ? (
                <>
                  Are you sure you want to temporarily revoke portal access for{" "}
                  <strong className="text-white">{statusConfirmItem?.name}</strong>? They will be
                  immediately blocked from starting trips, scanning passes, or viewing driver interfaces.
                </>
              ) : (
                <>
                  Restore portal access for{" "}
                  <strong className="text-white">{statusConfirmItem?.name}</strong>? Their operational
                  privileges will resume immediately.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStatusConfirmItem(null)}
              disabled={updatingStatus}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-zinc-700 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={executeStatusChange}
              disabled={updatingStatus}
              className={cn(
                "text-xs font-semibold text-white",
                statusConfirmItem?.targetStatus === "suspended"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              )}
            >
              {updatingStatus ? (
                <div className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Updating...</span>
                </div>
              ) : statusConfirmItem?.targetStatus === "suspended" ? (
                "Confirm Revoke"
              ) : (
                "Confirm Restore"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE DRIVER MODAL ── */}
      <Dialog open={Boolean(deleteItem)} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <DialogContent className="bg-slate-900 border-zinc-800 text-slate-100 max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <DialogTitle className="text-base font-bold text-white">Delete Driver Profile</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 pt-2">
              Are you sure you want to permanently delete{" "}
              <strong className="text-white">{deleteItem?.name}</strong>? This action will remove
              all driver profile records and assignments permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteItem(null)}
              disabled={isDeleting}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-zinc-700 text-xs"
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
          {
            label: "Add Driver",
            icon: Plus,
            href: "/admin/drivers/add",
            color: "bg-indigo-600 text-white",
          },
          {
            label: "Reassign Hub",
            icon: GitCompareArrows,
            href: "/admin/smart-allocation?tab=drivers",
            color: "bg-purple-600 text-white",
          },
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
