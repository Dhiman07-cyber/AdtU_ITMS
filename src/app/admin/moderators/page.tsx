"use client";

import Avatar from "@/components/Avatar";
import { ExportButton } from "@/components/ExportButton";
import { MobileActionFAB } from "@/components/layout/MobileActionFAB";
import { TableRowLoader } from "@/components/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import { invalidateCollectionCache, useApiCollection } from "@/hooks/useApiCollection";
import { useEventDrivenRefresh } from "@/hooks/useEventDrivenRefresh";
import { deleteModerator } from "@/lib/dataService";
import { exportToExcel } from "@/lib/export-helpers";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { supabase } from "@/lib/supabase-client";
import {
  DEFAULT_MODERATOR_PERMISSIONS,
  FULL_MODERATOR_PERMISSIONS,
  mergeWithDefaults,
  ModeratorPermissions,
  PERMISSION_CATEGORIES,
  ZERO_MODERATOR_PERMISSIONS,
} from "@/lib/types/moderator-permissions";
import { cn } from "@/lib/utils";
import { formatDateDDMMYYYY } from "@/lib/utils/date-utils";
import {
  AlertTriangle,
  Bus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardCheck,
  CreditCard,
  Download,
  Edit,
  Eye,
  Lock,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
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

// Category icon map for permissions
const categoryIcons: Record<string, any> = {
  students: Users,
  drivers: UserCog,
  buses: Bus,
  routes: MapPin,
  applications: ClipboardCheck,
  payments: CreditCard,
};

// Unified Category Theme styling for clean, professional single-color consistency
// (Similar to blue but distinct from the left selected card, avoiding green/yellow/orange rainbow)
const UNIFIED_PERMISSION_THEME = {
  badgeBg: "bg-indigo-500/15 dark:bg-indigo-950/60",
  badgeBorder: "border-indigo-500/30",
  badgeText: "text-indigo-700 dark:text-indigo-300",
  iconBg: "bg-indigo-500/15 dark:bg-indigo-950/70",
  iconBorder: "border-indigo-500/30",
  iconText: "text-indigo-600 dark:text-indigo-400",
  activeBorder: "border-indigo-500/60 dark:border-indigo-500/50",
  activeBg: "bg-indigo-50/80 dark:bg-indigo-950/30",
  activeRing: "ring-1 ring-indigo-500/30",
  activeDot: "bg-indigo-500 shadow-xs shadow-indigo-500/50",
  switchActive: "data-[state=checked]:bg-indigo-600",
};

const categoryThemeMap: Record<
  string,
  {
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
    iconBg: string;
    iconBorder: string;
    iconText: string;
    activeBorder: string;
    activeBg: string;
    activeRing: string;
    activeDot: string;
    switchActive: string;
  }
> = {
  students: UNIFIED_PERMISSION_THEME,
  drivers: UNIFIED_PERMISSION_THEME,
  buses: UNIFIED_PERMISSION_THEME,
  routes: UNIFIED_PERMISSION_THEME,
  applications: UNIFIED_PERMISSION_THEME,
  payments: UNIFIED_PERMISSION_THEME,
};

// Count active permissions helper
function countActivePermissions(perms: ModeratorPermissions | null | undefined): {
  total: number;
  active: number;
} {
  let total = 0;
  let active = 0;
  if (!perms) return { total: 22, active: 0 };

  for (const category of Object.values(perms)) {
    if (category && typeof category === "object") {
      for (const val of Object.values(category)) {
        total++;
        if (val) active++;
      }
    }
  }
  return { total: total || 22, active };
}

export default function ModeratorManagementHub() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  // Load moderators using collection hook
  const {
    data: rawModerators,
    loading: loadingModerators,
    refresh: refreshModerators,
  } = useApiCollection("moderators", {
    pageSize: 100,
    orderByField: "updatedAt",
    orderDirection: "desc",
    autoRefresh: false,
  });

  useEventDrivenRefresh({
    collectionName: "moderators",
    onRefresh: async () => {
      await refreshModerators();
    },
  });

  // Local optimistic overrides for status & permissions
  const [localOverrides, setLocalOverrides] = useState<
    Record<string, { status?: string; permissions?: ModeratorPermissions }>
  >({});

  const moderators = useMemo(() => {
    return (rawModerators || []).map((m: any) => {
      const id = m.id || m.uid;
      const override = localOverrides[id];
      return {
        ...m,
        id,
        status: override?.status || m.status || "active",
        permissions: override?.permissions || mergeWithDefaults(m.permissions),
      };
    });
  }, [rawModerators, localOverrides]);

  // Selected Moderator for Two-Column Right Panel
  const [selectedModeratorId, setSelectedModeratorId] = useState<string | null>(null);

  // Search & Filters for Left Column
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Editing Permissions State for the active moderator
  const [activePermissions, setActivePermissions] = useState<ModeratorPermissions | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(PERMISSION_CATEGORIES))
  );
  const [savingPermissions, setSavingPermissions] = useState(false);

  // Status Confirmation Modal State
  const [statusConfirmItem, setStatusConfirmItem] = useState<{
    id: string;
    name: string;
    targetStatus: "active" | "suspended";
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Delete Modal State
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isLoading = authLoading || loadingModerators;

  // Filtered list for the left column
  const filteredModerators = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return moderators.filter((m) => {
      const name = (m.name || m.fullName || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      const phone = m.phone || m.phoneNumber || "";
      const emp = (m.employeeId || m.empId || "").toLowerCase();
      const fac = (m.faculty || m.assignedFaculty || "").toLowerCase();

      const matchesSearch =
        !searchTerm ||
        name.includes(term) ||
        email.includes(term) ||
        phone.includes(searchTerm) ||
        emp.includes(term) ||
        fac.includes(term);

      const currentStatus = (m.status || "active").toLowerCase();
      let matchesStatus = true;
      if (statusFilter === "active") matchesStatus = currentStatus === "active";
      else if (statusFilter === "suspended") matchesStatus = currentStatus !== "active";
      else if (statusFilter === "full") {
        const { active, total } = countActivePermissions(m.permissions);
        matchesStatus = active === total && total > 0;
      }

      return matchesSearch && matchesStatus;
    });
  }, [moderators, searchTerm, statusFilter]);

  // Keep first moderator selected if none is selected
  useEffect(() => {
    if (!selectedModeratorId && filteredModerators.length > 0) {
      setSelectedModeratorId(filteredModerators[0].id);
    }
  }, [filteredModerators, selectedModeratorId]);

  // Active selected moderator object
  const selectedModerator = useMemo(() => {
    if (!selectedModeratorId) return null;
    return moderators.find((m) => m.id === selectedModeratorId) || null;
  }, [moderators, selectedModeratorId]);

  // Sync active permissions when selecting a different moderator
  useEffect(() => {
    if (selectedModerator) {
      setActivePermissions(mergeWithDefaults(selectedModerator.permissions));
    } else {
      setActivePermissions(null);
    }
  }, [selectedModeratorId, selectedModerator?.permissions]);

  // Dirty check: has unsaved changes?
  const hasUnsavedChanges = useMemo(() => {
    if (!selectedModerator || !activePermissions) return false;
    const original = mergeWithDefaults(selectedModerator.permissions);
    return JSON.stringify(original) !== JSON.stringify(activePermissions);
  }, [selectedModerator, activePermissions]);

  // Auth routing verification
  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push("/login");
    }
    if (userData && userData.role !== "admin") {
      router.push(`/${userData.role}`);
    }
  }, [currentUser, userData, authLoading, router]);

  // Top 4 Metrics Summary
  const metrics = useMemo(() => {
    let total = moderators.length;
    let activeCount = 0;
    let suspendedCount = 0;
    let fullAuthorityCount = 0;

    for (const m of moderators) {
      const st = (m.status || "active").toLowerCase();
      if (st === "active") activeCount++;
      else suspendedCount++;

      const { active, total: t } = countActivePermissions(m.permissions);
      if (active === t && t > 0) fullAuthorityCount++;
    }

    return { total, activeCount, suspendedCount, fullAuthorityCount };
  }, [moderators]);

  // Refresh action
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache("moderators");
      await refreshModerators();
      addToast("Moderator directory refreshed", "success");
    } catch (error) {
      console.error("Error refreshing moderators:", error);
      addToast("Failed to refresh data", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Toggle single permission directly on page
  const handleTogglePermission = (categoryKey: string, permKey: string) => {
    if (!activePermissions) return;
    setActivePermissions((prev: any) => {
      const cat = prev?.[categoryKey] || {};
      return {
        ...prev,
        [categoryKey]: {
          ...cat,
          [permKey]: !cat[permKey],
        },
      };
    });
  };

  // Toggle entire category
  const handleToggleCategory = (categoryKey: string, enableAll: boolean) => {
    const categoryDef = PERMISSION_CATEGORIES[categoryKey as keyof typeof PERMISSION_CATEGORIES];
    if (!categoryDef) return;

    const updatedCategory: Record<string, boolean> = {};
    for (const key of Object.keys(categoryDef.permissions)) {
      updatedCategory[key] = enableAll;
    }

    setActivePermissions((prev: any) => ({
      ...prev,
      [categoryKey]: updatedCategory,
    }));
  };

  // Apply Authority Presets
  const applyPreset = (preset: "full" | "viewOnly" | "revokeAll") => {
    if (preset === "full") {
      setActivePermissions(FULL_MODERATOR_PERMISSIONS);
    } else if (preset === "viewOnly") {
      setActivePermissions(DEFAULT_MODERATOR_PERMISSIONS);
    } else {
      setActivePermissions(ZERO_MODERATOR_PERMISSIONS);
    }
  };

  // Reset Changes
  const handleResetChanges = () => {
    if (selectedModerator) {
      setActivePermissions(mergeWithDefaults(selectedModerator.permissions));
      addToast("Changes reset to current database state", "info");
    }
  };

  // Save Permissions
  const handleSavePermissions = async () => {
    if (!selectedModerator || !activePermissions) return;

    try {
      setSavingPermissions(true);
      const token = await currentUser?.getIdToken();
      if (!token) {
        addToast("Authentication required", "error");
        return;
      }

      const res = await fetch(`/api/moderators/${selectedModerator.id}/permissions`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ permissions: activePermissions }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save permissions");
      }

      setLocalOverrides((prev) => ({
        ...prev,
        [selectedModerator.id]: {
          ...prev[selectedModerator.id],
          permissions: activePermissions,
        },
      }));

      invalidateCollectionCache("moderators");
      addToast(`Permissions updated for ${selectedModerator.name}`, "success");
    } catch (err: any) {
      console.error("Save error:", err);
      addToast(err.message || "Failed to update permissions", "error");
    } finally {
      setSavingPermissions(false);
    }
  };

  // Toggle Status Prompt
  const handleToggleStatus = (moderator: any) => {
    const isCurrentlyActive = (moderator.status || "active").toLowerCase() === "active";
    setStatusConfirmItem({
      id: moderator.id,
      name: moderator.name || moderator.fullName || "Moderator",
      targetStatus: isCurrentlyActive ? "suspended" : "active",
    });
  };

  // Execute Status Change
  const executeStatusChange = async () => {
    if (!statusConfirmItem) return;

    try {
      setUpdatingStatus(true);
      const token = await currentUser?.getIdToken();
      if (!token) {
        addToast("Authentication required", "error");
        return;
      }

      const res = await fetch(`/api/moderators/${statusConfirmItem.id}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: statusConfirmItem.targetStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update access status");
      }

      setLocalOverrides((prev) => ({
        ...prev,
        [statusConfirmItem.id]: {
          ...prev[statusConfirmItem.id],
          status: statusConfirmItem.targetStatus,
        },
      }));

      invalidateCollectionCache("moderators");
      addToast(
        statusConfirmItem.targetStatus === "active"
          ? `Access restored for ${statusConfirmItem.name}`
          : `Access revoked for ${statusConfirmItem.name}`,
        "success"
      );
    } catch (error: any) {
      console.error("Status error:", error);
      addToast(error.message || "Failed to update status", "error");
    } finally {
      setUpdatingStatus(false);
      setStatusConfirmItem(null);
    }
  };

  // Delete Moderator Execution
  const executeDelete = async () => {
    if (!deleteItem) return;

    try {
      setIsDeleting(true);
      const success = await deleteModerator(deleteItem.id);
      if (success) {
        invalidateCollectionCache("moderators");
        await refreshModerators();
        addToast(`Moderator ${deleteItem.name} removed`, "success");
        if (selectedModeratorId === deleteItem.id) {
          setSelectedModeratorId(null);
        }
      } else {
        addToast("Failed to delete moderator", "error");
      }
    } catch (error) {
      console.error("Error deleting moderator:", error);
      addToast("Error deleting moderator", "error");
    } finally {
      setIsDeleting(false);
      setDeleteItem(null);
    }
  };

  // Export moderators report
  const handleExportModerators = async () => {
    try {
      const dateStr = new Date().toISOString().split("T")[0];

      const { data: modProfiles } = await supabase
        .from("moderator_profiles")
        .select(
          "uid, full_name, email, phone, employee_id, faculty, status, created_at, permissions"
        );

      const rawRows = modProfiles && modProfiles.length > 0 ? modProfiles : moderators;

      const exportData = rawRows.map((mod: any, index: number) => {
        const { active, total } = countActivePermissions(mod.permissions);
        return [
          (index + 1).toString(),
          mod.full_name || mod.name || "N/A",
          mod.email || "N/A",
          mod.phone || mod.phoneNumber || "N/A",
          mod.employee_id || mod.emp_id || mod.employeeId || "N/A",
          mod.faculty || mod.assigned_faculty || "N/A",
          (mod.status || "active").toUpperCase(),
          `${active}/${total} Active`,
          mod.created_at ? formatDateDDMMYYYY(mod.created_at) : "N/A",
        ];
      });

      exportData.unshift([
        "Sl No",
        "Name",
        "Email",
        "Phone",
        "Employee ID",
        "Faculty",
        "Status",
        "Permissions",
        "Joined Date",
      ]);
      exportData.unshift(["MODERATOR GOVERNANCE & ACCESS REPORT"], [""]);

      await exportToExcel(exportData, `ADTU_Moderator_Hub_${dateStr}`, "Moderators");
      addToast(`Exported ${rawRows.length} moderators to Excel`, "success");
    } catch (error) {
      console.error("Export error:", error);
      addToast("Failed to export moderators data", "error");
    }
  };

  if (authLoading && !currentUser) {
    return (
      <div className="itms-admin-container !pt-[60px] space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
      </div>
    );
  }

  if (!currentUser || !userData || userData.role !== "admin") {
    return null;
  }

  return (
    <div className="itms-admin-container h-[100dvh] max-h-[100dvh] !pb-3.5 flex flex-col overflow-hidden gap-3.5">
      {/* ── HEADER ── */}
      <div className="itms-page-header-container !mb-0 shrink-0">
        <div className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-500">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight">
                Moderator Management Hub
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage moderator authority, section permissions, staff roster, and portal access control.
            </p>
          </div>

          {/* Desktop Toolbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Link href="/admin/moderators/add">
              <Button className="bg-pink-600 hover:bg-pink-700 text-white border border-pink-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 cursor-pointer gap-1.5">
                <Plus className="h-4 w-4" />
                <span>Add Moderator</span>
              </Button>
            </Link>
            <ExportButton
              onClick={handleExportModerators}
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

          {/* Mobile Refresh */}
          <div className="flex md:hidden items-center shrink-0">
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 px-3 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 shadow-sm rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-500",
                  isRefreshing ? "animate-spin text-blue-600" : "group-hover:rotate-180"
                )}
              />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ── TWO-COLUMN MASTER-DETAIL WORKSPACE (LIKE SMART-ALLOCATION & FLEET-MAP) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch flex-1 min-h-0 w-full overflow-hidden">
        {/* ── LEFT COLUMN: MODERATOR SELECTION DIRECTORY (4 OF 12 COLS) ── */}
        <div className="lg:col-span-4 flex flex-col min-w-0 h-full overflow-hidden">
          <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
            <CardHeader className="p-3.5 pb-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Moderator Roster</span>
                </CardTitle>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
                >
                  {filteredModerators.length} Staff
                </Badge>
              </div>

              {/* Search Bar */}
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, employee ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 h-8 text-xs w-full bg-white dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60 rounded-lg"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2 top-2 text-muted-foreground hover:text-foreground p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Filter Pills (Full Width with Counts) */}
              <div className="grid grid-cols-4 gap-1 mt-2 p-0.5 rounded-lg bg-slate-100 dark:bg-zinc-800/60 w-full border border-zinc-200/80 dark:border-zinc-700/50">
                {[
                  { id: "all", label: `All (${metrics.total})` },
                  { id: "active", label: `Active (${metrics.activeCount})` },
                  { id: "suspended", label: `Suspended (${metrics.suspendedCount})` },
                  { id: "full", label: `Full Access (${metrics.fullAuthorityCount})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    className={cn(
                      "py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer text-center whitespace-nowrap px-1",
                      statusFilter === f.id
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-white/50 dark:hover:bg-zinc-700/50"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </CardHeader>

            {/* Scrollable List of Moderator Cards */}
            <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 p-2.5 space-y-2">
              {isLoading && filteredModerators.length === 0 ? (
                <div className="p-4">
                  <TableRowLoader rows={5} />
                </div>
              ) : filteredModerators.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground space-y-1">
                  <ShieldAlert className="w-8 h-8 mx-auto text-muted-foreground/60" />
                  <p className="font-semibold text-foreground">No moderators found</p>
                  <p>Try clearing search or filters.</p>
                </div>
              ) : (
                filteredModerators.map((moderator) => {
                  const isSelected = selectedModeratorId === moderator.id;
                  const isActive = (moderator.status || "active").toLowerCase() === "active";
                  const { total, active } = countActivePermissions(moderator.permissions);
                  const isFull = active === total && total > 0;
                  const isZero = active === 0;

                  return (
                    <div
                      key={moderator.id}
                      onClick={() => setSelectedModeratorId(moderator.id)}
                      className={cn(
                        "p-3 rounded-xl border transition-all cursor-pointer select-none text-left relative",
                        isSelected
                          ? "bg-blue-500/10 dark:bg-blue-950/30 border-blue-500 shadow-sm ring-1 ring-blue-500/30"
                          : "bg-white dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800/80 hover:bg-slate-50 dark:hover:bg-zinc-800/80"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={safeImageSrc(moderator.profilePhotoUrl)}
                          name={moderator.name || moderator.fullName}
                          size="sm"
                          className="flex-shrink-0 border border-zinc-200 dark:border-zinc-700"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <p
                              className={cn(
                                "text-xs font-bold truncate",
                                isSelected ? "text-blue-600 dark:text-blue-400" : "text-foreground"
                              )}
                            >
                              {moderator.name || moderator.fullName || "Unnamed Moderator"}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px] font-semibold px-1.5 py-0.2 rounded-full shrink-0",
                                isActive
                                  ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30"
                                  : "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30"
                              )}
                            >
                              {isActive ? "Active" : "Suspended"}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {moderator.email}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 pt-1 border-t border-zinc-100 dark:border-zinc-800/60 font-mono">
                            <span>ID: {moderator.employeeId || moderator.empId || "N/A"}</span>
                            <span
                              className={cn(
                                "font-semibold",
                                isFull
                                  ? "text-emerald-500 dark:text-emerald-400"
                                  : isZero
                                  ? "text-rose-500 dark:text-rose-400"
                                  : "text-blue-500 dark:text-blue-400"
                              )}
                            >
                              {active}/{total} Granted
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* ── RIGHT COLUMN: DIRECT AUTHORITY & PERMISSIONS COMMAND CENTER (8 OF 12 COLS) ── */}
        <div className="lg:col-span-8 flex flex-col min-w-0 h-full overflow-hidden">
          {selectedModerator ? (
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col h-full overflow-hidden !p-0 !gap-0">
              {/* Profile & Master Access Header */}
              <div className="p-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={safeImageSrc(selectedModerator.profilePhotoUrl)}
                    name={selectedModerator.name || selectedModerator.fullName}
                    size="md"
                    className="border-2 border-blue-500/30 shrink-0"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-foreground">
                        {selectedModerator.name || selectedModerator.fullName}
                      </h3>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-semibold px-2 py-0.2 rounded-full",
                          (selectedModerator.status || "active").toLowerCase() === "active"
                            ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30"
                            : "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30"
                        )}
                      >
                        {(selectedModerator.status || "active").toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedModerator.email} • {selectedModerator.phone || "No phone"} •{" "}
                      <span className="font-mono">
                        {selectedModerator.employeeId || selectedModerator.empId || "N/A"}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Master Portal Access Revoke/Restore Button */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleToggleStatus(selectedModerator)}
                    className={cn(
                      "h-8 px-3 text-xs font-semibold rounded-lg cursor-pointer flex items-center gap-1.5",
                      (selectedModerator.status || "active").toLowerCase() === "active"
                        ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 border-rose-500/30"
                        : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    )}
                  >
                    {(selectedModerator.status || "active").toLowerCase() === "active" ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Revoke Access</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Restore Access</span>
                      </>
                    )}
                  </Button>

                  {/* Actions Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-xl rounded-xl w-48 p-1"
                    >
                      <DropdownMenuLabel className="text-[10px] font-bold text-muted-foreground uppercase px-2 py-1">
                        Moderator Options
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator className="bg-zinc-100 dark:bg-zinc-800" />
                      <DropdownMenuItem asChild>
                        <Link
                          href={`/admin/moderators/view/${selectedModerator.id}`}
                          className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-500" />
                          View Details
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link
                          href={`/admin/moderators/edit/${selectedModerator.id}`}
                          className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                        >
                          <Edit className="h-3.5 w-3.5 text-amber-500" />
                          Edit Profile
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="bg-zinc-100 dark:bg-zinc-800" />
                      <DropdownMenuItem
                        onClick={() =>
                          setDeleteItem({
                            id: selectedModerator.id,
                            name: selectedModerator.name || selectedModerator.fullName || "Moderator",
                          })
                        }
                        className="text-xs text-rose-500 hover:!bg-rose-500/10 cursor-pointer flex items-center gap-2 px-2 py-1.5"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Moderator
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Presets & Bulk Controls Bar */}
              <div className="px-4 py-2 bg-slate-100/70 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mr-1">
                    Presets:
                  </span>
                  <button
                    type="button"
                    onClick={() => applyPreset("full")}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-all cursor-pointer"
                  >
                    Full Access (22)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("viewOnly")}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 transition-all cursor-pointer"
                  >
                    View Only
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("revokeAll")}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 transition-all cursor-pointer"
                  >
                    Revoke All (0)
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedCategories(new Set(Object.keys(PERMISSION_CATEGORIES)))
                    }
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-700/80 border border-zinc-200 dark:border-zinc-700/70 shadow-xs transition-all cursor-pointer"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedCategories(new Set())}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-foreground hover:bg-slate-50 dark:hover:bg-zinc-700/80 border border-zinc-200 dark:border-zinc-700/70 shadow-xs transition-all cursor-pointer"
                  >
                    Collapse All
                  </button>
                </div>
              </div>

              {/* Scrollable Live Permissions Matrix (Direct on page!) */}
              <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 p-3 space-y-2.5">
                {Object.entries(PERMISSION_CATEGORIES).map(([catKey, category]) => {
                  const Icon = categoryIcons[catKey] || Shield;
                  const isExpanded = expandedCategories.has(catKey);
                  const permsInCategory = (activePermissions as any)?.[catKey] || {};
                  const catTotal = Object.keys(category.permissions).length;
                  const catActive = Object.values(permsInCategory).filter(Boolean).length;
                  const isAllEnabled = catActive === catTotal && catTotal > 0;

                  const theme = categoryThemeMap[catKey] || categoryThemeMap.students;

                  return (
                    <div
                      key={catKey}
                      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs overflow-hidden transition-all duration-200"
                    >
                      {/* Category Header */}
                      <div
                        onClick={() => {
                          setExpandedCategories((prev) => {
                            const next = new Set(prev);
                            if (next.has(catKey)) next.delete(catKey);
                            else next.add(catKey);
                            return next;
                          });
                        }}
                        className="p-3 px-3.5 flex items-center justify-between cursor-pointer bg-slate-50/70 dark:bg-zinc-800/40 hover:bg-slate-100/80 dark:hover:bg-zinc-800/70 transition-colors select-none border-b border-zinc-200 dark:border-zinc-800"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={cn("p-1.5 rounded-lg border", theme.iconBg, theme.iconBorder, theme.iconText)}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                {category.label}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] font-mono font-semibold px-2 py-0.2",
                                  catActive === catTotal
                                    ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30"
                                    : catActive > 0
                                    ? cn(theme.badgeBg, theme.badgeBorder, theme.badgeText)
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                                )}
                              >
                                {catActive}/{catTotal} Active
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleToggleCategory(catKey, !isAllEnabled)}
                            className={cn(
                              "px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer shadow-2xs",
                              isAllEnabled
                                ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30"
                                : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/30"
                            )}
                          >
                            {isAllEnabled ? "Disable All" : "Enable All"}
                          </button>

                          <div className="p-1 text-muted-foreground hover:text-foreground">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Permissions List with Clean Card Styling */}
                      {isExpanded && (
                        <div className="p-3 bg-slate-50/30 dark:bg-zinc-900/30 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {Object.entries(category.permissions).map(([permKey, permLabel]) => {
                            const isGranted = Boolean(permsInCategory?.[permKey]);

                            return (
                              <div
                                key={permKey}
                                onClick={() => handleTogglePermission(catKey, permKey)}
                                className={cn(
                                  "p-2.5 px-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer select-none",
                                  isGranted
                                    ? cn(
                                        theme.activeBg,
                                        theme.activeBorder,
                                        theme.activeRing,
                                        "shadow-xs"
                                      )
                                    : "bg-white dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800/80"
                                )}
                              >
                                <div className="min-w-0 pr-1 flex-1 flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "w-2 h-2 rounded-full shrink-0 transition-all",
                                      isGranted ? theme.activeDot : "bg-zinc-300 dark:bg-zinc-700"
                                    )}
                                  />
                                  <p
                                    className={cn(
                                      "text-xs truncate transition-colors",
                                      isGranted
                                        ? "font-bold text-zinc-950 dark:text-zinc-50"
                                        : "font-medium text-zinc-600 dark:text-zinc-400"
                                    )}
                                  >
                                    {permLabel}
                                  </p>
                                </div>

                                <Switch
                                  checked={isGranted}
                                  onCheckedChange={() => handleTogglePermission(catKey, permKey)}
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn("shrink-0 scale-90", theme.switchActive)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action Footer */}
              <div className="px-3.5 py-2 border-t border-zinc-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-800/60 flex items-center justify-end gap-2 shrink-0">
                {hasUnsavedChanges && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleResetChanges}
                    disabled={savingPermissions}
                    className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSavePermissions}
                  disabled={savingPermissions || !hasUnsavedChanges}
                  className="h-7 px-3.5 text-xs font-semibold bg-pink-600 hover:bg-pink-700 text-white rounded-lg shadow-sm cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingPermissions ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Permissions</span>
                    </>
                  )}
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 shadow-md flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[400px]">
              <div className="p-4 rounded-2xl bg-blue-500/10 text-blue-500 border border-blue-500/20 mb-3">
                <Shield className="w-8 h-8" />
              </div>
              <h3 className="text-sm font-bold text-foreground">Select a Moderator</h3>
              <p className="text-xs text-muted-foreground max-w-sm mt-1">
                Choose a moderator from the left roster to view their profile, configure all 22 granular permissions, or revoke portal access.
              </p>
            </Card>
          )}
        </div>
      </div>

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
                  ? "Revoke Moderator Portal Access"
                  : "Restore Moderator Portal Access"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 pt-2">
              {statusConfirmItem?.targetStatus === "suspended" ? (
                <>
                  Are you sure you want to temporarily revoke portal access for{" "}
                  <strong className="text-white">{statusConfirmItem?.name}</strong>? They will be
                  immediately blocked from viewing or executing any moderator actions.
                </>
              ) : (
                <>
                  Restore portal access for{" "}
                  <strong className="text-white">{statusConfirmItem?.name}</strong>? Their assigned
                  permissions and portal privileges will resume immediately.
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
                "Revoke Access"
              ) : (
                "Restore Access"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE CONFIRMATION MODAL ── */}
      <Dialog open={Boolean(deleteItem)} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <DialogContent className="bg-slate-900 border-zinc-800 text-slate-100 max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <DialogTitle className="text-base font-bold text-white">Delete Moderator</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 pt-2">
              Are you sure you want to permanently delete{" "}
              <strong className="text-white">{deleteItem?.name}</strong>? This action will remove
              all permissions, assignments, and account records. This action cannot be undone.
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
                "Delete Moderator"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile Floating Action Button (FAB) */}
      <MobileActionFAB
        ariaLabel="Moderator control hub actions"
        actions={[
          {
            label: "Add New Moderator",
            icon: Plus,
            href: "/admin/moderators/add",
            color: "bg-pink-600 text-white",
          },
          {
            label: "Export Directory",
            icon: Download,
            onClick: handleExportModerators,
            color: "bg-emerald-600 text-white",
          },
        ]}
      />
    </div>
  );
}
