"use client";

import Avatar from '@/components/Avatar';
import { ExportButton } from '@/components/ExportButton';
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent
} from "@/components/ui/card";
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
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { deleteStudent } from '@/lib/dataService';
import { exportToExcel } from '@/lib/export-helpers';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { cn } from '@/lib/utils';
import { ArrowRightLeft, ChevronLeft, ChevronRight, ClipboardList, Clock, Download, Edit, Eye, Filter, GraduationCap, Loader2, MoreHorizontal, Plus, QrCode, RefreshCw, RotateCcw, Search, Trash2, UserCheck, Users, UserX } from "lucide-react";
import { MobileActionFAB } from '@/components/layout/MobileActionFAB';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { invalidateCollectionCache, useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useLocalAndServerSearch } from '@/hooks/useLocalAndServerSearch';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';

export default function AdminStudents() {
    const { currentUser, userData, loading: authLoading } = useAuth();
    const { addToast } = useToast();
    const { canStudentView, canStudentAdd, canStudentEdit, canStudentDelete, canStudentReassign, loading: permsLoading } = useModeratorPermissions();
    const router = useRouter();

    // Server-side API reads from PostgreSQL — no Firestore client reads
    const {
        data: students,
        loading: loadingStudents,
        refresh: refreshStudents,
        fetchNextPage: fetchMoreStudents,
        hasMore: hasMoreStudents
    } = useApiCollection('students', {
        pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc',
        autoRefresh: false, // EVENT-DRIVEN: Only refresh when mutations occur
    });
    const { data: buses, loading: loadingBuses, refresh: refreshBuses } = useApiCollection('buses', {
        pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc',
        autoRefresh: false,
    });

    // Event-driven refresh: auto-refresh when navigating back from add/edit pages
    useEventDrivenRefresh({
        collectionName: 'students',
        onRefresh: async () => {
            await Promise.all([refreshStudents(), refreshBuses()]);
        }
    });

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteItem, setDeleteItem] = useState<{ id: string, name: string } | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [shiftFilter, setShiftFilter] = useState<string>("all");
    const [busFilter, setBusFilter] = useState<string>("all");


    const [isRefreshing, setIsRefreshing] = useState(false);

    // Manual refresh handler
    const handleRefresh = async () => {
        setIsRefreshing(true);
        invalidateCollectionCache('students');
        await Promise.all([refreshStudents(), refreshBuses()]);
        addToast('Data refreshed', 'success');
        setIsRefreshing(false);
    };

    useEffect(() => {
        if (!authLoading && !currentUser) {
            router.push('/login');
        }

        if (userData && userData.role !== 'moderator') {
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
        if (!busId) return 'Not Assigned';
        const bus = busById.get(busId);
        if (!bus) return busId.startsWith("Bus-") ? busId : `Bus-${busId}`;
        const busNum = bus.busNumber || busId.replace(/[^0-9]/g, '') || '?';
        return `Bus ${busNum}${bus.routeNumber ? ` (R-${bus.routeNumber})` : ''}`;
    };

    // Local matcher for Tier 1 search (0ms, 0 network calls)
    const studentLocalMatcher = useMemo(() => {
        return (student: any, term: string) => {
            const name = (student.name || student.fullName || "").toLowerCase();
            const email = (student.email || "").toLowerCase();
            const phone = (student.phone || student.phoneNumber || "");
            const altPhone = (student.alternatePhone || student.altPhone || "");
            const enrollmentId = (student.enrollmentId || student.enrollment_id || student.studentId || "").toLowerCase();
            const assignedBus = busById.get(student.busId);
            const busText = assignedBus ? `${assignedBus.busNumber} ${assignedBus.routeNumber || ""}`.toLowerCase() : (student.busId || "").toLowerCase();

            return (
                name.includes(term) ||
                email.includes(term) ||
                phone.includes(term) ||
                altPhone.includes(term) ||
                enrollmentId.includes(term) ||
                busText.includes(term)
            );
        };
    }, [busById]);

    const {
        results: searchedStudents,
        isSearching,
        isSearchingServer,
        isServerFallback,
    } = useLocalAndServerSearch(
        students,
        searchTerm,
        studentLocalMatcher,
        "/api/students",
        {
            extractItems: (json: any) => json.students || json.data || [],
        }
    );

    const isLoading = loadingStudents || loadingBuses || isSearchingServer;

    // Get unique values for filters with proper numeric sorting
    const uniqueBuses = useMemo(() => Array.from(new Set(searchedStudents.map(s => s.busId).filter(Boolean)))
        .sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.replace(/\D/g, '')) || 0;
            return numA - numB;
        }), [searchedStudents]);

    const filteredStudents = useMemo(() => {
        return searchedStudents.filter(student => {
            const matchesShift = shiftFilter === "all" || (student.shift && student.shift.toLowerCase() === shiftFilter.toLowerCase());
            const matchesBus = busFilter === "all" || (student.busId && student.busId === busFilter);
            return matchesShift && matchesBus;
        });
    }, [searchedStudents, shiftFilter, busFilter]);

    // Role-Specific Metrics: Top 4 Control Cards for Students
    const metrics = useMemo(() => {
        const total = searchedStudents.length;
        const activeCount = searchedStudents.filter(s => (s.status || "active").toLowerCase() === "active").length;
        const softBlockedOrExpiredCount = searchedStudents.filter(s => {
            const st = (s.status || "active").toLowerCase();
            return st === "soft_blocked" || st === "expired";
        }).length;
        const suspendedCount = searchedStudents.filter(s => {
            const st = (s.status || "active").toLowerCase();
            return st === "suspended" || st === "inactive";
        }).length;

        return { total, activeCount, softBlockedOrExpiredCount, suspendedCount };
    }, [searchedStudents]);

    // Unique key safety
    const uniqueFilteredStudents = useMemo(() => filteredStudents.filter((student, index, self) =>
        index === self.findIndex((s) => s.id === student.id)
    ), [filteredStudents]);

    // Section-based pagination state
    const PAGE_SIZE = 25;
    const [currentPage, setCurrentPage] = useState(1);
    const [isPaginating, setIsPaginating] = useState(false);

    // Reset to first section when filters or search change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, shiftFilter, busFilter]);

    const totalPages = useMemo(() => {
        const loadedCount = uniqueFilteredStudents.length;
        const effectiveTotal = hasMoreStudents
            ? loadedCount + PAGE_SIZE
            : loadedCount;
        const calculated = Math.max(1, Math.ceil(effectiveTotal / PAGE_SIZE));
        return Math.max(currentPage, calculated);
    }, [uniqueFilteredStudents.length, hasMoreStudents, PAGE_SIZE, currentPage]);

    const validatedPage = Math.max(1, Math.min(currentPage, totalPages));

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const paginatedStudents = useMemo(() => {
        const startIndex = (validatedPage - 1) * PAGE_SIZE;
        const slice = uniqueFilteredStudents.slice(startIndex, startIndex + PAGE_SIZE);
        if (slice.length === 0 && uniqueFilteredStudents.length > 0) {
            const fallbackStart = Math.max(0, uniqueFilteredStudents.length - PAGE_SIZE);
            return uniqueFilteredStudents.slice(fallbackStart);
        }
        return slice;
    }, [uniqueFilteredStudents, validatedPage, PAGE_SIZE]);

    const handleNextPage = async (e?: React.MouseEvent) => {
        e?.preventDefault();
        if (loadingStudents || isPaginating) return;
        if (validatedPage >= totalPages && !hasMoreStudents) return;

        const targetPage = validatedPage + 1;
        const requiredItems = (targetPage - 1) * PAGE_SIZE + 1;

        setIsPaginating(true);
        try {
            if (uniqueFilteredStudents.length < requiredItems && hasMoreStudents) {
                await fetchMoreStudents();
                await new Promise((r) => setTimeout(r, 60));
            }
            setCurrentPage(targetPage);
        } catch (err) {
            console.error("Failed to fetch next section:", err);
        } finally {
            setTimeout(() => setIsPaginating(false), 200);
        }
    };

    const handlePrevPage = (e?: React.MouseEvent) => {
        e?.preventDefault();
        if (loadingStudents || isPaginating || validatedPage <= 1) return;
        setIsPaginating(true);
        setTimeout(() => {
            setCurrentPage((prev) => Math.max(1, prev - 1));
            setIsPaginating(false);
        }, 200);
    };

    // Export students data via authenticated API
    const handleExportStudents = async () => {
        try {
            const dateStr = new Date().toISOString().split('T')[0];
            const token = await currentUser?.getIdToken();
            const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

            const [studentsRes, busesRes] = await Promise.all([
                fetch('/api/students?limit=5000', { headers: authHeaders }),
                fetch('/api/buses', { headers: authHeaders }),
            ]);

            if (!studentsRes.ok) throw new Error('Failed to fetch students for export');
            const studentsJson = await studentsRes.json();
            const rawStudents = studentsJson.students || [];

            const busesJson = busesRes.ok ? await busesRes.json() : { buses: [] };
            const rawBuses = busesJson.buses || [];

            const busMap = new Map((rawBuses || []).map((b: any) => [b.id || b.busId, b.bus_number || b.busNumber || b.registration_number]));

            const studentsData = (rawStudents || []).map((student: any, index: number) => {
                const busId = student.bus_id || student.busId;
                const busDisplay = busMap.get(busId) || (busId ? `Bus-${busId}` : 'Not Assigned');
                const status = student.status || 'N/A';
                const sessionDuration = student.session_duration ? `${student.session_duration} year${Number(student.session_duration) > 1 ? 's' : ''}` : 'N/A';

                return [
                    (index + 1).toString(),
                    student.full_name || student.name || 'N/A',
                    student.email || 'N/A',
                    student.phone || student.phoneNumber || 'N/A',
                    student.faculty || 'N/A',
                    student.enrollment_id || student.enrollmentId || 'N/A',
                    busDisplay,
                    student.shift ? student.shift.charAt(0).toUpperCase() + student.shift.slice(1) : 'N/A',
                    student.sessionStartYear || student.session_start_year || 'N/A',
                    student.sessionEndYear || student.session_end_year || 'N/A',
                    sessionDuration,
                    status
                ];
            });

            // Add headers
            studentsData.unshift([
                'Sl No', 'Name', 'Email', 'Phone', 'Faculty', 'Enrollment ID',
                'Bus Assigned', 'Shift', 'Session Start', 'Session End', 'Session Duration', 'Status'
            ]);

            // Add section header
            studentsData.unshift(['ALL STUDENTS REPORT (SUPABASE)'], ['']);

            await exportToExcel(studentsData, `ADTU_Students_Report_${dateStr}`, 'Students');

            addToast(
                `Exported ${(rawStudents || []).length} students to ADTU_Students_Report_${dateStr}.xlsx`,
                'success'
            );
        } catch (error) {
            console.error('❌ Error exporting students from Supabase:', error);
            addToast(
                'Failed to export students data. Please try again.',
                'error'
            );
        }
    };

    if (authLoading && !currentUser) {
        return (
            <div className="itms-admin-container space-y-6 animate-pulse">
                <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
                <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
            </div>
        );
    }

    const commonBtnClass = "group h-8 px-3.5 bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 shadow-sm font-medium text-xs rounded-lg transition-colors active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

    return (
        <div className="itms-admin-container space-y-6">
            {/* Page Header */}
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
                        {canStudentAdd && (
                            <Link href="/moderator/students/add">
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 cursor-pointer gap-1.5">
                                    <Plus className="h-4 w-4" />
                                    <span>Add Student</span>
                                </Button>
                            </Link>
                        )}
                        <ExportButton
                            onClick={() => handleExportStudents()}
                            label="Export"
                            className={commonBtnClass}
                        />
                        <Button
                            size="sm"
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className={commonBtnClass}
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
                            <span>Refresh</span>
                        </Button>
                    </div>

                    {/* Mobile Refresh Button */}
                    <div className="flex md:hidden items-center shrink-0">
                        <Button
                            size="sm"
                            onClick={handleRefresh}
                            disabled={isRefreshing}
                            className="h-8 px-3 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-200 dark:border-zinc-700 shadow-sm rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all shrink-0"
                        >
                            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin text-blue-600" : "group-hover:rotate-180")} />
                            <span>Refresh</span>
                        </Button>
                    </div>
                </div>

                {/* ── TOP 4 ROLE-SPECIFIC CONTROL CARDS (STUDENTS) ── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 mt-4 sm:mt-5">
                    {/* Card 1: Total Enrolled */}
                    <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
                        <CardContent className="p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:justify-between">
                            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0 sm:order-2">
                                <Users className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1 sm:order-1">
                                <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                                    Total Enrolled
                                </p>
                                <p className="text-base sm:text-xl md:text-2xl font-black text-foreground mt-0.5 leading-tight">
                                    {metrics.total.toLocaleString()}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card 2: Active Access */}
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
                                    {metrics.activeCount.toLocaleString()}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card 3: Soft Blocked / Expired */}
                    <Card className="bg-white/60 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800/80 shadow-xs">
                        <CardContent className="p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:justify-between">
                            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0 sm:order-2">
                                <Clock className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1 sm:order-1">
                                <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                                    Service Expired / Restricted
                                </p>
                                <p className="text-base sm:text-xl md:text-2xl font-black text-amber-500 mt-0.5 leading-tight">
                                    {metrics.softBlockedOrExpiredCount.toLocaleString()}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card 4: Access Suspended */}
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
                                    {metrics.suspendedCount.toLocaleString()}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <Card className="bg-gray-50 dark:bg-gray-900 border-border min-h-[480px] flex flex-col">
                <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
                    <div className="mb-3">
                        {/* Search Bar and Filters */}
                        <div className="flex flex-col md:flex-row gap-3">
                            {/* Search Bar - Top (Full Width on Mobile) */}
                            <div className="relative w-full md:flex-1">
                                {isSearchingServer ? (
                                    <Loader2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-blue-500 animate-spin" />
                                ) : (
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                                )}
                                <Input
                                    placeholder="Search by name, email, or phone..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9 pr-24 h-9 text-xs w-full"
                                />
                                <div className="absolute right-2.5 top-2 flex items-center gap-1.5">
                                    {isServerFallback && (
                                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                                            Server Match
                                        </span>
                                    )}
                                    {searchTerm && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchTerm("")}
                                            className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Filters - Side by side on Mobile in the same line */}
                            <div className="grid grid-cols-2 gap-2 items-center w-full md:w-auto md:flex md:flex-row">
                                <Select value={shiftFilter} onValueChange={setShiftFilter}>
                                    <SelectTrigger className="h-9 md:h-8 text-xs w-full md:w-[140px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                                        <SelectValue placeholder="Shift" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all" className="text-xs">All Shifts</SelectItem>
                                        <SelectItem value="morning" className="text-xs">Morning</SelectItem>
                                        <SelectItem value="evening" className="text-xs">Evening</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Select value={busFilter} onValueChange={setBusFilter}>
                                    <SelectTrigger className="h-9 md:h-8 text-xs w-full md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                                        <SelectValue placeholder="Bus" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all" className="text-xs">All Buses</SelectItem>
                                        {uniqueBuses.map(busId => (
                                            <SelectItem key={busId} value={busId} className="text-xs">
                                                {getBusDisplay(busId)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {(shiftFilter !== "all" || busFilter !== "all") && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setShiftFilter("all");
                                            setBusFilter("all");
                                        }}
                                        className="h-8 px-3 text-xs col-span-2 md:col-span-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 dark:bg-red-500/20 dark:text-red-400 flex-shrink-0"
                                    >
                                        Clear
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
                        <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0 relative min-h-[540px]" role="region" aria-label="Student list">
                            {isPaginating && (
                                <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-blue-500/10 dark:bg-blue-400/10 overflow-hidden">
                                    <div className="animate-progress w-full h-full bg-blue-500 dark:bg-blue-400 origin-left-right" />
                                </div>
                            )}
                            <div className={cn("flex-1 flex flex-col transition-opacity duration-200", isPaginating && "opacity-60 pointer-events-none")}>
                                <Table className="w-full table-fixed min-w-[950px]">
                                <colgroup>
                                    <col className="w-[24%]" />
                                    <col className="w-[16%]" />
                                    <col className="w-[15%]" />
                                    <col className="w-[16%]" />
                                    <col className="w-[11%]" />
                                    <col className="w-[11%]" />
                                    <col className="w-[7%]" />
                                </colgroup>
                                <TableHeader>
                                    <TableRow className="h-9">
                                        <TableHead className="w-[24%] text-[11px] py-1.5 font-bold">Student</TableHead>
                                        <TableHead className="w-[16%] text-[11px] py-1.5 font-bold">Phone</TableHead>
                                        <TableHead className="w-[15%] text-[11px] py-1.5 font-bold">Enrollment ID</TableHead>
                                        <TableHead className="w-[16%] text-[11px] py-1.5 font-bold">Bus Assigned</TableHead>
                                        <TableHead className="w-[11%] text-[11px] py-1.5 font-bold">Shift</TableHead>
                                        <TableHead className="w-[11%] text-[11px] py-1.5 font-bold">Session</TableHead>
                                        <TableHead className="w-[7%] text-[11px] py-1.5 text-right font-bold">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                {uniqueFilteredStudents.length > 0 && (
                                    <TableBody>
                                        {/* Show loader inside table when refreshing/searching with existing data */}
                                        {isLoading && (students.length > 0 || searchedStudents.length > 0) && (
                                            <TableRow>
                                                <TableCell colSpan={7} className="h-1 p-0">
                                                    <div className="w-full h-1 bg-blue-100 dark:bg-blue-900 overflow-hidden">
                                                        <div className="animate-progress w-full h-full bg-blue-500 origin-left-right"></div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {paginatedStudents.map((student) => (
                                            <TableRow key={student.id} className="h-auto" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}>
                                                <TableCell className="py-2 overflow-hidden">
                                                    <div className="flex flex-row items-center gap-2 min-w-0">
                                                        <Avatar
                                                            src={safeImageSrc(student.profilePhotoUrl || student.photoURL)}
                                                            name={student.name || student.fullName}
                                                            size="xs"
                                                            className="flex-shrink-0"
                                                        />
                                                        <div className="flex flex-col min-w-0 flex-1">
                                                            <div className="text-sm font-medium text-foreground truncate">{student.name || student.fullName}</div>
                                                            <div className="text-xs text-muted-foreground truncate">{student.email}</div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 overflow-hidden">
                                                    <div className="space-y-0.5 truncate">
                                                        <div className="text-xs font-medium text-foreground truncate">
                                                            Ph: {student.phone || student.phoneNumber || 'N/A'}
                                                        </div>
                                                        {(student.alternatePhone || student.altPhone) && (
                                                            <div className="text-xs text-muted-foreground truncate">
                                                                Alt: {student.alternatePhone || student.altPhone}
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 overflow-hidden">
                                                    <div className="font-mono text-[10px] text-foreground truncate">
                                                        {student.enrollmentId || student.studentId || 'N/A'}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 overflow-hidden">
                                                    <div className="text-[10px] truncate">{getBusDisplay(student.busId)}</div>
                                                </TableCell>
                                                <TableCell className="py-2 overflow-hidden">
                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${student.shift?.toLowerCase() === 'morning' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                                        }`}>
                                                        {student.shift || 'N/A'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-2 overflow-hidden">
                                                    <div className="flex flex-col items-center gap-0.5 truncate">
                                                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-medium shrink-0 ${student.status === 'active' ? 'bg-green-500 text-white' :
                                                            student.status === 'expired' ? 'bg-red-500 text-white' :
                                                                student.status === 'maintenance' ? 'bg-yellow-500 text-white' :
                                                                    'bg-gray-100 text-gray-700'
                                                            }`}>
                                                            {student.status ? (student.status.charAt(0).toUpperCase() + student.status.slice(1)) : 'Unknown'}
                                                        </span>
                                                        <div className="text-[10px] text-muted-foreground truncate">
                                                            {student.sessionStartYear && student.sessionEndYear
                                                                ? `${student.sessionStartYear}-${student.sessionEndYear}`
                                                                : 'N/A'
                                                            }
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-2 text-right overflow-hidden">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" className="h-7 w-7 p-0 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="bg-gray-800 dark:bg-gray-900 border-gray-700 dark:border-gray-600 shadow-xl rounded-lg w-40">
                                                            <DropdownMenuLabel className="text-white text-[11px] font-semibold px-2 py-1.5">Actions</DropdownMenuLabel>
                                                            <DropdownMenuSeparator className="bg-gray-600" />
                                                            <DropdownMenuItem asChild>
                                                                <Link href={`/moderator/students/view/${encodeURIComponent(student.uid || student.id)}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
                                                                    <Eye className="mr-1.5 h-3 w-3 text-blue-400" />
                                                                    View Details
                                                                </Link>
                                                            </DropdownMenuItem>
                                                            {canStudentEdit && (
                                                                <DropdownMenuItem asChild>
                                                                    <Link href={`/moderator/students/edit/${encodeURIComponent(student.uid || student.id)}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
                                                                        <Edit className="mr-1.5 h-3 w-3 text-yellow-400" />
                                                                        Edit
                                                                    </Link>
                                                                </DropdownMenuItem>
                                                            )}
                                                            {canStudentDelete && (
                                                                <>
                                                                    <DropdownMenuSeparator className="bg-gray-600" />
                                                                    <DropdownMenuItem
                                                                        className="text-white hover:!bg-red-600 focus:!bg-red-600 px-2 py-1.5 !text-white text-[11px] cursor-pointer transition-colors"
                                                                        onClick={() => {
                                                                            setDeleteItem({ id: student.id, name: student.name });
                                                                            setIsDialogOpen(true);
                                                                        }}
                                                                    >
                                                                        <Trash2 className="mr-1.5 h-3 w-3" />
                                                                        Delete
                                                                    </DropdownMenuItem>
                                                                </>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                )}
                            </Table>
                            </div>
                            {uniqueFilteredStudents.length === 0 && (
                                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[11px] text-gray-500 min-h-[220px]">
                                    No students found
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section-Based Pagination Footer */}
                    {!isSearching && uniqueFilteredStudents.length > 0 && (
                        <div className="mt-4 pt-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-200 dark:border-zinc-800 px-2">
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                                Showing{" "}
                                <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                                    {(validatedPage - 1) * PAGE_SIZE + 1}–{Math.min(validatedPage * PAGE_SIZE, uniqueFilteredStudents.length)}
                                </strong>{" "}
                                of{" "}
                                <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                                    {uniqueFilteredStudents.length}
                                </strong>{" "}
                                students
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePrevPage}
                                    disabled={validatedPage <= 1 || loadingStudents || isPaginating}
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
                                    disabled={
                                        (validatedPage >= totalPages && !hasMoreStudents) ||
                                        loadingStudents ||
                                        isPaginating
                                    }
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
                </CardContent>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Student</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete {deleteItem?.name}? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            className="bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
                            onClick={() => setIsDialogOpen(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700 font-medium min-w-[80px]"
                            onClick={async () => {
                                if (!deleteItem) return;
                                setIsDeleting(true);
                                try {
                                    await deleteStudent(deleteItem.id);
                                    // Refresh data immediately after deletion
                                    invalidateCollectionCache('students');
                                    await Promise.all([refreshStudents(), refreshBuses()]);
                                    addToast(
                                        'The student has been removed from the system.',
                                        'success'
                                    );
                                    setIsDialogOpen(false);
                                    setDeleteItem(null);
                                } catch (error) {
                                    console.error('Error deleting student:', error);
                                    addToast(
                                        'Failed to delete the student. Please try again.',
                                        'error'
                                    );
                                } finally {
                                    setIsDeleting(false);
                                }
                            }}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <div className="flex items-center gap-2">
                                    <span className="h-4 w-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                                    <span>Deleting...</span>
                                </div>
                            ) : (
                                'Delete'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Mobile Floating Action Button (FAB) for Quick Moderator Actions */}
            <MobileActionFAB
                ariaLabel="Student management actions"
                actions={[
                    ...(canStudentAdd ? [{
                        label: "Add New Student",
                        icon: Plus,
                        href: "/moderator/students/add",
                        color: "bg-blue-600 text-white",
                    }] : []),
                    {
                        label: "Pass Renewal",
                        icon: RotateCcw,
                        href: "/moderator/renewal-service",
                        color: "bg-amber-600 text-white",
                    },
                    {
                        label: "Applications",
                        icon: ClipboardList,
                        href: "/moderator/applications",
                        color: "bg-orange-600 text-white",
                    },
                    {
                        label: "Verification",
                        icon: QrCode,
                        href: "/moderator/verification",
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

