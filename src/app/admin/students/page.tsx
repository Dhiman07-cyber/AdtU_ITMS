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
import { deleteStudent } from "@/lib/dataService";
import { exportToExcel } from "@/lib/export-helpers";
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { supabase } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRightLeft,
  Bus,
  CheckCircle2,
  Clock,
  Download,
  Edit,
  Eye,
  GraduationCap,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function AdminStudentsHub() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  // Load students & buses via optimized collections
  const {
    data: rawStudents,
    loading: loadingStudents,
    refresh: refreshStudents,
    fetchNextPage: fetchMoreStudents,
    hasMore: hasMoreStudents,
    totalCount: serverTotalStudents,
  } = useApiCollection("students", {
    pageSize: 50,
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

  // Accurate overall student stats from database
  const [studentStats, setStudentStats] = useState<{
    total: number;
    active: number;
    suspended: number;
    warning: number;
  } | null>(null);

  const fetchStudentStats = async () => {
    try {
      const token = await currentUser?.getIdToken();
      const res = await fetch("/api/students?stats=true", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const stats = await res.json();
        setStudentStats(stats);
      }
    } catch (e) {
      console.error("Failed to load student stats:", e);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchStudentStats();
    }
  }, [currentUser]);

  // Event-driven refresh
  useEventDrivenRefresh({
    collectionName: "students",
    onRefresh: async () => {
      await Promise.all([refreshStudents(), refreshBuses(), fetchStudentStats()]);
    },
  });

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [busFilter, setBusFilter] = useState("all");

  // Local optimistic overrides for instant access status updates
  const [localOverrides, setLocalOverrides] = useState<Record<string, { status: string }>>({});

  // Status Action Modal State
  const [statusConfirmItem, setStatusConfirmItem] = useState<{
    id: string;
    name: string;
    currentStatus: string;
    targetStatus: "active" | "suspended" | "soft_blocked" | "expired";
  } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Delete Modal State
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 450);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Server-side search effect
  useEffect(() => {
    async function performSearch() {
      if (!debouncedSearchTerm || debouncedSearchTerm.trim() === "") {
        setSearchResults(null);
        return;
      }

      setIsSearching(true);
      try {
        const term = debouncedSearchTerm.trim();
        const token = await currentUser?.getIdToken();
        const res = await fetch("/api/students?q=" + encodeURIComponent(term), {
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        const data = await res.json();
        setSearchResults(data.students || []);
      } catch (error) {
        console.error("Search failed:", error);
        addToast("Search failed. Please try again.", "error");
      } finally {
        setIsSearching(false);
      }
    }

    performSearch();
  }, [debouncedSearchTerm, addToast, currentUser]);

  // Auth routing verification
  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push("/login");
    }
    if (userData && userData.role !== "admin") {
      router.push(`/${userData.role}`);
    }
  }, [currentUser, userData, authLoading, router]);

  // Index buses for O(1) lookups
  const busById = useMemo(() => {
    const map = new Map<string, any>();
    for (const b of buses || []) {
      if (b.busId) map.set(b.busId, b);
      if (b.id) map.set(b.id, b);
      if (b.busNumber) map.set(b.busNumber, b);
    }
    return map;
  }, [buses]);

  const getBusDisplay = (busId: string) => {
    if (!busId) return "Not Assigned";
    const bus = busById.get(busId);
    if (!bus) return busId.startsWith("Bus-") ? busId : `Bus-${busId}`;
    const busNum = bus.busNumber || busId.replace(/[^0-9]/g, "") || "?";
    return `Bus ${busNum}${bus.routeNumber ? ` (R-${bus.routeNumber})` : ""}`;
  };

  // Base list merged with local overrides
  const students = useMemo(() => {
    const base = searchResults !== null ? searchResults : rawStudents;
    return (base || []).map((s: any) => {
      const id = s.id || s.uid;
      const override = localOverrides[id];
      return {
        ...s,
        id,
        status: override?.status || s.status || "active",
      };
    });
  }, [rawStudents, searchResults, localOverrides]);

  // Unique buses for filtering
  const uniqueBuses = useMemo(() => {
    return Array.from(new Set(students.map((s) => s.busId).filter(Boolean))).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      return numA - numB;
    });
  }, [students]);

  // Role-Specific Metrics: Top 4 Control Cards for Students
  const metrics = useMemo(() => {
    // Prefer authoritative database statistics if available
    const total = studentStats?.total ?? (serverTotalStudents > 0 ? serverTotalStudents : students.length);
    const activeCount = studentStats?.active ?? (serverTotalStudents > 0 ? serverTotalStudents : students.filter(s => (s.status || "active").toLowerCase() === "active").length);
    const softBlockedOrExpiredCount = studentStats?.warning ?? students.filter(s => {
      const st = (s.status || "active").toLowerCase();
      return st === "soft_blocked" || st === "expired";
    }).length;
    const suspendedCount = studentStats?.suspended ?? students.filter(s => {
      const st = (s.status || "active").toLowerCase();
      return st === "suspended" || st === "inactive";
    }).length;

    return { total, activeCount, softBlockedOrExpiredCount, suspendedCount };
  }, [studentStats, serverTotalStudents, students]);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return students.filter((student) => {
      const name = (student.name || student.fullName || "").toLowerCase();
      const email = (student.email || "").toLowerCase();
      const phone = (student.phone || student.phoneNumber || "");
      const altPhone = (student.alternatePhone || student.altPhone || "");
      const enrollmentId = (student.enrollmentId || student.enrollment_id || student.studentId || "").toLowerCase();
      const assignedBus = busById.get(student.busId);
      const busText = assignedBus ? `${assignedBus.busNumber} ${assignedBus.routeNumber || ""}` : (student.busId || "");

      const matchesSearch =
        !searchTerm ||
        name.includes(term) ||
        email.includes(term) ||
        phone.includes(searchTerm) ||
        altPhone.includes(searchTerm) ||
        enrollmentId.includes(term) ||
        busText.toLowerCase().includes(term);

      const currentStatus = (student.status || "active").toLowerCase();
      let matchesStatus = true;
      if (statusFilter === "active") {
        matchesStatus = currentStatus === "active";
      } else if (statusFilter === "soft_blocked") {
        matchesStatus = currentStatus === "soft_blocked";
      } else if (statusFilter === "expired") {
        matchesStatus = currentStatus === "expired";
      } else if (statusFilter === "suspended") {
        matchesStatus = currentStatus === "suspended" || currentStatus === "inactive";
      }

      const matchesShift =
        shiftFilter === "all" ||
        (student.shift && student.shift.toLowerCase() === shiftFilter.toLowerCase());

      const matchesBus = busFilter === "all" || (student.busId && student.busId === busFilter);

      return matchesSearch && matchesStatus && matchesShift && matchesBus;
    });
  }, [students, searchTerm, statusFilter, shiftFilter, busFilter, busById]);

  // Unique key safety
  const uniqueFilteredStudents = useMemo(() => {
    return filteredStudents.filter(
      (student, index, self) => index === self.findIndex((s) => s.id === student.id)
    );
  }, [filteredStudents]);

  // Refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache("students");
      invalidateCollectionCache("buses");
      await Promise.all([refreshStudents(), refreshBuses(), fetchStudentStats()]);
      addToast("Student directory refreshed", "success");
    } catch (error) {
      console.error("Error refreshing students:", error);
      addToast("Failed to refresh data", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Toggle or change status
  const handleToggleStatus = (student: any) => {
    const current = (student.status || "active").toLowerCase();
    const isCurrentlyActive = current === "active";
    const targetStatus = isCurrentlyActive ? "suspended" : "active";

    setStatusConfirmItem({
      id: student.id,
      name: student.name || student.fullName || "Student",
      currentStatus: current,
      targetStatus,
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

      const res = await fetch(`/api/students/${statusConfirmItem.id}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: statusConfirmItem.targetStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update student access status");
      }

      setLocalOverrides((prev) => ({
        ...prev,
        [statusConfirmItem.id]: { status: statusConfirmItem.targetStatus },
      }));

      invalidateCollectionCache("students");

      const statusLabels: Record<string, string> = {
        active: "Active Access restored",
        suspended: "Transport access revoked",
        soft_blocked: "Account soft-blocked",
        expired: "Pass expired",
      };

      addToast(
        `${statusConfirmItem.name}: ${statusLabels[statusConfirmItem.targetStatus] || statusConfirmItem.targetStatus}`,
        statusConfirmItem.targetStatus === "active" ? "success" : "info"
      );
    } catch (err: any) {
      console.error("Status update error:", err);
      addToast(err.message || "Failed to update student status", "error");
    } finally {
      setUpdatingStatus(false);
      setStatusConfirmItem(null);
    }
  };

  // Delete student
  const executeDelete = async () => {
    if (!deleteItem) return;
    setIsDeleting(true);
    try {
      await deleteStudent(deleteItem.id);
      invalidateCollectionCache("students");
      await refreshStudents();
      addToast("Student record deleted successfully", "success");
    } catch (error) {
      console.error("Error deleting student:", error);
      addToast("Failed to delete student", "error");
    } finally {
      setIsDeleting(false);
      setDeleteItem(null);
    }
  };

  // Export students to Excel
  const handleExportStudents = async () => {
    try {
      const dateStr = new Date().toISOString().split("T")[0];

      const token = await currentUser?.getIdToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

      const [studentsRes, busesRes] = await Promise.all([
        fetch("/api/students?limit=5000", { headers: authHeaders }),
        fetch("/api/buses", { headers: authHeaders }),
      ]);

      if (!studentsRes.ok) throw new Error("Failed to fetch students for export");
      const studentsJson = await studentsRes.json();
      const rawData = studentsJson.students || [];

      const busesJson = busesRes.ok ? await busesRes.json() : { buses: [] };
      const rawBuses = busesJson.buses || [];

      const busMap = new Map(
        (rawBuses || []).map((b: any) => [b.id || b.busId, b.bus_number || b.busNumber || b.registration_number])
      );

      const exportData = (rawData || []).map((student: any, index: number) => {
        const busDisplay =
          busMap.get(student.bus_id) || (student.bus_id ? `Bus-${student.bus_id}` : "Not Assigned");
        const status = (student.status || "N/A").toUpperCase();
        const sessionDuration = student.session_duration
          ? `${student.session_duration} yr${Number(student.session_duration) > 1 ? "s" : ""}`
          : "N/A";

        return [
          (index + 1).toString(),
          student.full_name || student.name || "N/A",
          student.email || "N/A",
          student.phone || student.phoneNumber || "N/A",
          student.faculty || "N/A",
          student.enrollment_id || student.enrollmentId || "N/A",
          busDisplay,
          student.shift ? student.shift.charAt(0).toUpperCase() + student.shift.slice(1) : "N/A",
          student.session_start_year || "N/A",
          student.session_end_year || "N/A",
          sessionDuration,
          status,
        ];
      });

      exportData.unshift([
        "Sl No",
        "Name",
        "Email",
        "Phone",
        "Faculty",
        "Enrollment ID",
        "Bus Assigned",
        "Shift",
        "Session Start",
        "Session End",
        "Duration",
        "Access Status",
      ]);
      exportData.unshift(["STUDENT TRANSPORT ENROLLMENT & CONTROL REPORT"], [""]);

      await exportToExcel(exportData, `ADTU_Students_Report_${dateStr}`, "Students");
      addToast(`Exported ${(rawData || []).length} students to Excel`, "success");
    } catch (error) {
      console.error("❌ Error exporting students:", error);
      addToast("Failed to export students data. Please try again.", "error");
    }
  };

  const isLoading = authLoading || loadingStudents || loadingBuses || isSearching;

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
              <div className="p-2 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-500">
                <GraduationCap className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight">
                Student Management Hub
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage student transport enrollment, digital pass validity, shift distribution, and portal access control.
            </p>
          </div>

          {/* Desktop Toolbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Link href="/admin/students/add">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 cursor-pointer gap-1.5">
                <Plus className="h-4 w-4" />
                <span>Add Student</span>
              </Button>
            </Link>
            <ExportButton
              onClick={handleExportStudents}
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

        {/* ── TOP 4 ROLE-SPECIFIC CONTROL CARDS (STUDENTS) ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          {/* Card 1: Total Enrolled */}
          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Enrolled
                </p>
                <p className="text-xl md:text-2xl font-black text-foreground mt-0.5">
                  {metrics.total.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
                <Users className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Active Access */}
          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Active Access
                </p>
                <p className="text-xl md:text-2xl font-black text-emerald-500 mt-0.5">
                  {metrics.activeCount.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <UserCheck className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Soft Blocked / Expired */}
          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Soft Block / Expired
                </p>
                <p className="text-xl md:text-2xl font-black text-amber-500 mt-0.5">
                  {metrics.softBlockedOrExpiredCount.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <Clock className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>

          {/* Card 4: Access Suspended */}
          <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
            <CardContent className="p-3.5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Access Suspended
                </p>
                <p className="text-xl md:text-2xl font-black text-rose-500 mt-0.5">
                  {metrics.suspendedCount.toLocaleString()}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 border border-rose-500/20">
                <UserX className="w-4 h-4" />
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
                placeholder="Search students by name, email, phone, enrollment ID, or bus..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-xs w-full bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60 rounded-lg"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Group */}
            <div className="grid grid-cols-2 md:flex md:flex-row gap-2">
              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[155px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectItem value="all" className="text-xs">
                    All Statuses
                  </SelectItem>
                  <SelectItem value="active" className="text-xs text-emerald-500">
                    Active Access
                  </SelectItem>
                  <SelectItem value="soft_blocked" className="text-xs text-amber-500">
                    Soft Blocked
                  </SelectItem>
                  <SelectItem value="expired" className="text-xs text-orange-500">
                    Expired Pass
                  </SelectItem>
                  <SelectItem value="suspended" className="text-xs text-rose-500">
                    Access Suspended
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Shift Filter */}
              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[130px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Shift" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                  <SelectItem value="all" className="text-xs">
                    All Shifts
                  </SelectItem>
                  <SelectItem value="morning" className="text-xs text-blue-500">
                    Morning
                  </SelectItem>
                  <SelectItem value="evening" className="text-xs text-amber-500">
                    Evening
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Bus Filter */}
              <Select value={busFilter} onValueChange={setBusFilter}>
                <SelectTrigger className="h-9 text-xs w-full md:w-[180px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                  <SelectValue placeholder="Bus" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-h-60">
                  <SelectItem value="all" className="text-xs">
                    All Buses
                  </SelectItem>
                  {uniqueBuses.map((bId) => (
                    <SelectItem key={bId} value={bId} className="text-xs">
                      {getBusDisplay(bId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(statusFilter !== "all" ||
                shiftFilter !== "all" ||
                busFilter !== "all" ||
                searchTerm) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("all");
                    setShiftFilter("all");
                    setBusFilter("all");
                    setSearchTerm("");
                  }}
                  className="h-9 px-3 text-xs bg-rose-500/10 text-rose-500 dark:text-rose-400 hover:bg-rose-500/20 rounded-lg col-span-2 md:col-span-1"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          {/* ── STUDENTS TABLE ── */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50 dark:bg-zinc-800/50">
                  <TableRow className="h-9 border-b border-zinc-200 dark:border-zinc-800">
                    <TableHead className="text-[11px] font-bold py-2">Student</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Contact Details</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Enrollment & Shift</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Assigned Bus</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Session Period</TableHead>
                    <TableHead className="text-[11px] font-bold py-2">Portal Access</TableHead>
                    <TableHead className="text-[11px] font-bold py-2 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && uniqueFilteredStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="p-8">
                        <TableRowLoader rows={6} />
                      </TableCell>
                    </TableRow>
                  ) : uniqueFilteredStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-44 text-center">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <ShieldAlert className="w-8 h-8 text-muted-foreground/60" />
                          <p className="text-sm font-medium text-foreground">No students found</p>
                          <p className="text-xs text-muted-foreground">
                            Try adjusting your search terms or filters.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    uniqueFilteredStudents.map((student) => {
                      const currentStatus = (student.status || "active").toLowerCase();
                      const isActive = currentStatus === "active";
                      const isSoftBlocked = currentStatus === "soft_blocked";
                      const isExpired = currentStatus === "expired";
                      const isSuspended = currentStatus === "suspended" || currentStatus === "inactive";

                      const assignedBus = busById.get(student.busId);
                      const shift = (student.shift || "N/A").toLowerCase();
                      const isMorning = shift === "morning";

                      return (
                        <TableRow
                          key={student.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors border-b border-zinc-100 dark:border-zinc-800/60"
                        >
                          {/* Student Name & Email */}
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar
                                src={safeImageSrc(student.profilePhotoUrl || student.photoURL)}
                                name={student.name || student.fullName}
                                size="sm"
                                className="flex-shrink-0 border border-zinc-200 dark:border-zinc-700"
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-foreground truncate max-w-[170px] sm:max-w-none">
                                  {student.name || student.fullName || "Unnamed Student"}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate max-w-[170px] sm:max-w-none">
                                  {student.email || "No email"}
                                </div>
                              </div>
                            </div>
                          </TableCell>

                          {/* Contact */}
                          <TableCell className="py-2.5">
                            <div className="space-y-0.5">
                              <div className="text-[11px] font-medium text-foreground">
                                Ph: {student.phone || student.phoneNumber || "N/A"}
                              </div>
                              {(student.alternatePhone || student.altPhone) && (
                                <div className="text-[10px] text-muted-foreground">
                                  Alt: {student.alternatePhone || student.altPhone}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Enrollment ID & Shift */}
                          <TableCell className="py-2.5">
                            <div className="space-y-1">
                              <div className="font-mono text-[11px] font-semibold text-foreground">
                                {student.enrollmentId || student.enrollment_id || student.studentId || "N/A"}
                              </div>
                              <span
                                className={cn(
                                  "inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium",
                                  isMorning
                                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                )}
                              >
                                {student.shift ? student.shift.charAt(0).toUpperCase() + student.shift.slice(1) : "N/A"}
                              </span>
                            </div>
                          </TableCell>

                          {/* Assigned Bus */}
                          <TableCell className="py-2.5">
                            {assignedBus ? (
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1"
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
                            ) : student.busId ? (
                              <Badge
                                variant="outline"
                                className="bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                              >
                                {getBusDisplay(student.busId)}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/30 text-[10px] font-semibold px-2 py-0.5 rounded-md"
                              >
                                Not Assigned
                              </Badge>
                            )}
                          </TableCell>

                          {/* Session Period */}
                          <TableCell className="py-2.5">
                            <div className="space-y-0.5">
                              <div className="text-[11px] font-medium text-foreground">
                                {student.sessionStartYear && student.sessionEndYear
                                  ? `${student.sessionStartYear}-${student.sessionEndYear}`
                                  : student.session_start_year && student.session_end_year
                                  ? `${student.session_start_year}-${student.session_end_year}`
                                  : "N/A"}
                              </div>
                              {student.faculty && (
                                <div className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                  {student.faculty}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          {/* Access Status */}
                          <TableCell className="py-2.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 w-fit",
                                isActive
                                  ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30"
                                  : isSoftBlocked
                                  ? "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30"
                                  : isExpired
                                  ? "bg-orange-500/10 text-orange-500 dark:text-orange-400 border-orange-500/30"
                                  : "bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30"
                              )}
                            >
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full",
                                  isActive
                                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
                                    : isSoftBlocked
                                    ? "bg-amber-400"
                                    : isExpired
                                    ? "bg-orange-400"
                                    : "bg-rose-400"
                                )}
                              />
                              {isActive
                                ? "Active"
                                : isSoftBlocked
                                ? "Soft Blocked"
                                : isExpired
                                ? "Expired"
                                : "Suspended"}
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
                                    Student Controls
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator className="bg-zinc-100 dark:bg-zinc-800" />
                                  <DropdownMenuItem
                                    onClick={() => handleToggleStatus(student)}
                                    className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                  >
                                    {isActive ? (
                                      <>
                                        <Lock className="h-3.5 w-3.5 text-rose-500" />
                                        <span className="text-rose-500">Revoke Access</span>
                                      </>
                                    ) : (
                                      <>
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                        <span className="text-emerald-500">Restore Access</span>
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/admin/students/view/${encodeURIComponent(student.uid || student.id)}`}
                                      className="text-xs cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                    >
                                      <Eye className="h-3.5 w-3.5 text-blue-500" />
                                      View Details
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem asChild>
                                    <Link
                                      href={`/admin/students/edit/${encodeURIComponent(student.uid || student.id)}`}
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
                                        id: student.id,
                                        name: student.name || student.fullName || "Student",
                                      })
                                    }
                                    className="text-xs text-rose-500 hover:!bg-rose-500/10 cursor-pointer flex items-center gap-2 px-2 py-1.5"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete Student
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

          {/* Pagination / Load More Footer */}
          {!isSearching && (
            <div className="pt-3 pb-1 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-200/60 dark:border-zinc-800/60 px-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                Showing <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{uniqueFilteredStudents.length}</strong> of{" "}
                <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">{metrics.total.toLocaleString()}</strong> students
              </span>

              {hasMoreStudents && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchMoreStudents()}
                  disabled={loadingStudents}
                  className="text-xs border bg-white dark:bg-zinc-800 text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-700/80 rounded-lg px-4 h-8 cursor-pointer"
                >
                  {loadingStudents ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Loading next batch...
                    </>
                  ) : (
                    "Load More Students"
                  )}
                </Button>
              )}
            </div>
          )}
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
                  ? "Revoke Student Transport Access"
                  : "Restore Student Transport Access"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 pt-2">
              {statusConfirmItem?.targetStatus === "suspended" ? (
                <>
                  Are you sure you want to revoke transport access for{" "}
                  <strong className="text-white">{statusConfirmItem?.name}</strong>? They will be
                  immediately blocked from the student portal, live bus tracking, and bus pass verification.
                </>
              ) : (
                <>
                  Restore transport portal access for{" "}
                  <strong className="text-white">{statusConfirmItem?.name}</strong>? Their bus pass and
                  operational privileges will become active immediately.
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
                  <span className="h-3.5 w-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
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

      {/* ── DELETE CONFIRMATION DIALOG ── */}
      <Dialog open={Boolean(deleteItem)} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <DialogContent className="bg-slate-900 border-zinc-800 text-slate-100 max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30">
                <Trash2 className="w-5 h-5" />
              </div>
              <DialogTitle className="text-base font-bold text-white">Delete Student</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400 pt-2">
              Are you sure you want to permanently delete{" "}
              <strong className="text-white">{deleteItem?.name}</strong>? This action will remove
              all transport allocations, pass history, and profile records. This cannot be undone.
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
                  <span className="h-3.5 w-3.5 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                  <span>Deleting...</span>
                </div>
              ) : (
                "Delete Student"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MOBILE FAB ── */}
      <MobileActionFAB
        ariaLabel="Student management actions"
        actions={[
          {
            label: "Add New Student",
            icon: Plus,
            href: "/admin/students/add",
            color: "bg-blue-600 text-white",
          },
          {
            label: "Student Reassignment",
            icon: ArrowRightLeft,
            href: "/admin/smart-allocation",
            color: "bg-teal-600 text-white",
          },
          {
            label: "Verification",
            icon: QrCode,
            href: "/admin/verification",
            color: "bg-cyan-600 text-white",
          },
          {
            label: "Export Students",
            icon: Download,
            onClick: handleExportStudents,
            color: "bg-emerald-600 text-white",
          },
        ]}
      />
    </div>
  );
}
