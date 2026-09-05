"use client";

import Avatar from '@/components/Avatar';
import { ExportButton } from '@/components/ExportButton';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
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
import { supabase } from '@/lib/supabase-client';
import { ArrowRightLeft,Edit,Eye,Filter,Loader2,MoreHorizontal,Plus,QrCode,RefreshCw,Search,Trash2 } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo,useCallback,useEffect,useMemo,useState } from 'react';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useTheme } from '@/components/theme-provider';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { cn } from '@/lib/utils';

// Memoized table row — skips re-rendering for students whose data and handlers
// are unchanged, keeping search/filter typing smooth even with a full page of rows.
const StudentRow = memo(function StudentRow({
  student,
  theme,
  busDisplay,
  onDelete,
}: {
  student: any;
  theme: string | undefined;
  busDisplay: string;
  onDelete: (item: { id: string; name: string }) => void;
}) {
  return (
    <TableRow className="h-auto">
      <TableCell className="py-1.5">
        <div className="flex flex-row items-center gap-2">
          <Avatar
            src={safeImageSrc(student.profilePhotoUrl || student.photoURL)}
            name={student.name || student.fullName}
            size="xs"
            className="flex-shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="text-sm font-medium text-foreground truncate max-w-[180px]">{student.name || student.fullName}</div>
            <div className="text-xs text-muted-foreground">{student.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div className="space-y-0.5">
          <div className="text-xs font-medium text-foreground">
            Ph: {student.phone || student.phoneNumber || 'N/A'}
          </div>
          {(student.alternatePhone || student.altPhone) && (
            <div className="text-xs text-muted-foreground">
              Alt: {student.alternatePhone || student.altPhone}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <div className="font-mono text-xs text-foreground whitespace-nowrap">
          {student.enrollmentId || student.studentId || 'N/A'}
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="text-[10px] whitespace-nowrap">{busDisplay}</div>
      </TableCell>
      <TableCell className="py-1.5">
        <span className={cn(
          "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium",
          student.shift?.toLowerCase() === 'morning'
            ? theme === 'dark' ? 'bg-blue-100 text-blue-800' : 'bg-blue-50 text-blue-700'
            : theme === 'dark' ? 'bg-orange-100 text-orange-800' : 'bg-orange-50 text-orange-700'
        )}>
          {student.shift || 'N/A'}
        </span>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="flex flex-col items-center gap-0.5">
          <span className={cn(
            "inline-block px-1.5 py-0.5 rounded-full text-[9px] font-medium",
            student.status === 'active' ? 'bg-green-500 text-white' :
              student.status === 'expired' ? 'bg-red-500 text-white' :
                student.status === 'maintenance' ? 'bg-yellow-500 text-white' :
                  theme === 'dark' ? 'bg-gray-100 text-gray-700' : 'bg-gray-200 text-gray-700'
          )}>
            {student.status ? (student.status.charAt(0).toUpperCase() + student.status.slice(1)) : 'Unknown'}
          </span>
          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
            {student.sessionStartYear && student.sessionEndYear
              ? `${student.sessionStartYear}-${student.sessionEndYear}`
              : 'N/A'
            }
          </div>
        </div>
      </TableCell>
      <TableCell className="py-1.5 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={cn(
              "h-7 w-7 p-0 cursor-pointer",
              theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
            )}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(
            "shadow-xl rounded-lg w-40",
            theme === 'dark' ? "bg-gray-900 border-gray-600" : "bg-white border-[#E5E7EB]"
          )}>
            <DropdownMenuLabel className={cn("text-[11px] font-semibold px-2 py-1.5", theme === 'dark' ? "text-white" : "text-[#111827]")}>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
            <DropdownMenuItem asChild>
              <Link href={`/admin/students/view/${encodeURIComponent(student.uid || student.id)}`} className={cn(
                "px-2 py-1.5 text-[11px]",
                theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
              )}>
                <Eye className="mr-1.5 h-3 w-3 text-blue-400" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/students/edit/${encodeURIComponent(student.uid || student.id)}`} className={cn(
                "px-2 py-1.5 text-[11px]",
                theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
              )}>
                <Edit className="mr-1.5 h-3 w-3 text-yellow-400" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
            <DropdownMenuItem
              className={cn(
                "px-2 py-1.5 text-[11px] cursor-pointer transition-colors",
                theme === 'dark' ? "text-white hover:!bg-red-600 focus:!bg-red-600" : "text-[#111827] hover:!bg-red-600 focus:!bg-red-600"
              )}
              onClick={() => onDelete({ id: student.id, name: student.name })}
            >
              <Trash2 className="mr-1.5 h-3 w-3" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

export default function AdminStudents() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const { theme } = useTheme();

  // SPARK PLAN SAFETY: Event-driven refresh - only fetches when mutations occur
  // No polling/auto-refresh to conserve Firestore quota
  // Server-side API reads from PostgreSQL — no Firestore client reads
  const {
    data: students,
    loading: loadingStudents,
    refresh: refreshStudents,
    fetchNextPage: fetchMoreStudents,
    hasMore: hasMoreStudents,
  } = useApiCollection('students', {
    pageSize: 50,
    orderByField: 'updatedAt',
    orderDirection: 'desc',
    autoRefresh: false, // EVENT-DRIVEN: Only refresh when mutations occur
  });

  const {
    data: buses,
    loading: loadingBuses,
    refresh: refreshBuses,
  } = useApiCollection('buses', {
    pageSize: 50,
    orderByField: 'busNumber',
    orderDirection: 'asc',
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

  // Stable handler so memoized rows don't re-render when unrelated state changes.
  const handleDeleteClick = useCallback((item: { id: string; name: string }) => {
    setDeleteItem(item);
    setIsDialogOpen(true);
  }, []);
  const [searchTerm, setSearchTerm] = useState("");
  const [shiftFilter, setShiftFilter] = useState<string>("all");
  const [busFilter, setBusFilter] = useState<string>("all");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);

  // Search State
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const isLoading = loadingStudents || loadingBuses || isSearching;
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache('students');
      await Promise.all([refreshStudents(), refreshBuses()]);
      addToast('Data refreshed', 'success');
    } catch (error) {
      console.error('Error refreshing students:', error);
      addToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Server-side search effect
  useEffect(() => {
    async function performSearch() {
      if (!debouncedSearchTerm || debouncedSearchTerm.trim() === '') {
        setSearchResults(null);
        return;
      }

      setIsSearching(true);
      try {
        const term = debouncedSearchTerm.trim();
        const token = await currentUser?.getIdToken();
        const res = await fetch('/api/students?q=' + encodeURIComponent(term), {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
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




  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push('/login');
    }

    if (userData && userData.role !== 'admin') {
      router.push(`/${userData.role}`);
    }
  }, [currentUser, userData, authLoading, router]);

  // Real-time listeners handle data fetching automatically

  // Index buses by both id fields once so per-row lookups are O(1) instead of
  // scanning the whole bus array for every student row on every render.
  const busById = useMemo(() => {
    const map = new Map<string, any>();
    for (const b of buses) {
      if (b.busId) map.set(b.busId, b);
      if (b.id) map.set(b.id, b);
    }
    return map;
  }, [buses]);

  const getBusDisplay = useCallback((busId: string) => {
    if (!busId) return 'Not Assigned';

    const bus = busById.get(busId);
    if (!bus) return busId;

    const busNum = busId.replace(/[^0-9]/g, '') || '?';
    return `Bus-${busNum} (${bus.busNumber || 'N/A'})`;
  }, [busById]);

  // Get unique values for filters with proper numeric sorting
  const uniqueBuses = useMemo(() => Array.from(new Set(students.map(s => s.busId).filter(Boolean)))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '')) || 0;
      const numB = parseInt(b.replace(/\D/g, '')) || 0;
      return numA - numB;
    }), [students]);

  // Decide source: Search Results (if available) OR Paginated List
  const sourceStudents = searchResults !== null ? searchResults : students;

  const filteredStudents = useMemo(() => {
    return sourceStudents.filter(student => {
      // Search filter - check both name and fullName fields
      const matchesSearch = !searchTerm ||
        (student.name && student.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (student.fullName && student.fullName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (student.email && student.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (student.phone && student.phone.includes(searchTerm)) ||
        (student.phoneNumber && student.phoneNumber.includes(searchTerm)) ||
        (student.enrollmentId && student.enrollmentId.toLowerCase().includes(searchTerm.toLowerCase()));

      // Shift filter
      const matchesShift = shiftFilter === "all" || (student.shift && student.shift.toLowerCase() === shiftFilter.toLowerCase());

      // Bus filter
      const matchesBus = busFilter === "all" || (student.busId && student.busId === busFilter);

      return matchesSearch && matchesShift && matchesBus;
    });
  }, [sourceStudents, searchTerm, shiftFilter, busFilter]);

  // Unique key safety
  const uniqueFilteredStudents = useMemo(() => filteredStudents.filter((student, index, self) =>
    index === self.findIndex((s) => s.id === student.id)
  ), [filteredStudents]);

  // Export students data from Supabase
  const handleExportStudents = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Fetch all students directly from Supabase PostgreSQL table 'student_profiles'
      const { data: rawStudents, error: studentsError } = await supabase
        .from('student_profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (studentsError) throw studentsError;

      // Fetch buses to map assigned bus IDs to bus numbers
      const { data: rawBuses } = await supabase
        .from('buses')
        .select('id, bus_number, registration_number');

      const busMap = new Map((rawBuses || []).map((b: any) => [b.id, b.bus_number || b.registration_number]));

      const studentsData = (rawStudents || []).map((student: any, index: number) => {
        const busId = student.bus_id || student.bus_id;
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

  // Helper function to extract number from string
  const extractNumber = (str: string): string => {
    if (!str) return '0';
    const match = str.match(/\d+/);
    return match ? match[0] : '0';
  };

  // Only show full page loader on initial load (when no data exists)
  // AND we are strictly in a loading state.
  // This prevents the page from "jumping" during search or refresh.
  const showFullPageLoader = authLoading || (isLoading && students.length === 0 && !searchResults);

  if (showFullPageLoader) {
    return <PremiumPageLoader message="Curating Student Directory..." subMessage="Fetching student profiles and status..." />;
  }

  if (!currentUser || !userData || userData.role !== 'admin') {
    return null;
  }

  const commonBtnClass = "group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 shadow-sm hover:shadow-lg hover:shadow-blue-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

  return (
    <div className="mt-12 space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Student Management</h1>
          <p className="text-muted-foreground mt-1">View and manage all students</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/students/add">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add New Student
            </Button>
          </Link>

          <Link href="/admin/smart-allocation">
            <Button className="bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 border border-slate-700 dark:border-slate-600 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
              Student Reassignment
            </Button>
          </Link>
          <Link href="/admin/verification">
            <Button className="bg-cyan-600 hover:bg-cyan-700 text-white border border-cyan-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
              <QrCode className="mr-1.5 h-3.5 w-3.5" />
              Verification
            </Button>
          </Link>
          <ExportButton
            onClick={handleExportStudents}
            label="EXPORT"
            className={commonBtnClass}
          />
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={commonBtnClass}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            REFRESH
          </Button>

        </div>
      </div>

      <Card className={cn("border-border min-h-[480px] flex flex-col", theme === 'dark' ? "bg-gray-900" : "bg-admin-bg")}>
        <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
          <div className="mb-3">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar - Top (Full Width on Mobile) */}
              <div className="relative w-full md:flex-1">
                <Search className={cn("absolute left-2.5 top-2.5 h-3.5 w-3.5", theme === 'dark' ? "text-gray-400" : "text-[#9CA3AF]")} />
                <Input
                  placeholder="Search by name, email, or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs w-full"
                />
              </div>

              {/* Filters - Side by side on Mobile */}
              <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                <Filter className={cn("h-3.5 w-3.5 flex-shrink-0", theme === 'dark' ? "text-gray-500" : "text-[#6B7280]")} />

                <Select value={shiftFilter} onValueChange={setShiftFilter}>
                  <SelectTrigger className={cn(
                    "h-8 text-xs min-w-[100px] flex-1 md:w-[150px] md:bg-transparent border",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-[#E5E7EB]"
                  )}>
                    <SelectValue placeholder="Shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Shifts</SelectItem>
                    <SelectItem value="morning" className="text-xs">Morning</SelectItem>
                    <SelectItem value="evening" className="text-xs">Evening</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={busFilter} onValueChange={setBusFilter}>
                  <SelectTrigger className={cn(
                    "h-8 text-xs min-w-[120px] flex-1 md:w-[250px] md:bg-transparent border",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-[#E5E7EB]"
                  )}>
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
                    className={cn(
                      "h-8 px-3 text-xs",
                      theme === 'dark' ? "bg-red-500 hover:bg-red-600" : "bg-[#EF4444] hover:bg-[#DC2626]"
                    )}
                  >

                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
              <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0" role="region" aria-label="Student list">
                <Table>
                  <TableHeader>
                    <TableRow className="h-10">
                      <TableHead className="text-xs font-semibold py-2">Student</TableHead>
                      <TableHead className="text-xs font-semibold py-2">Phone</TableHead>
                      <TableHead className="text-xs font-semibold py-2">Enrollment ID</TableHead>
                      <TableHead className="text-xs font-semibold py-2">Bus Assigned</TableHead>
                      <TableHead className="text-xs font-semibold py-2">Shift</TableHead>
                      <TableHead className="text-xs font-semibold py-2">Session</TableHead>
                      <TableHead className="text-xs font-semibold py-2 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  {uniqueFilteredStudents.length > 0 && (
                    <TableBody>
                      {/* Show loader inside table when refreshing/searching with existing data */}
                      {isLoading && (students.length > 0 || searchResults) && (
                        <TableRow>
                          <TableCell colSpan={7} className="h-1 p-0">
                            <div className={cn("w-full h-1 overflow-hidden", theme === 'dark' ? "bg-blue-900" : "bg-blue-100")}>
                              <div className="animate-progress w-full h-full bg-blue-500 origin-left-right"></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {uniqueFilteredStudents.map((student, index) => (
                        <StudentRow
                          key={student.uid || student.id || `student-${index}`}
                          student={student}
                          theme={theme}
                          busDisplay={getBusDisplay(student.busId)}
                          onDelete={handleDeleteClick}
                        />
                      ))}
                    </TableBody>
                  )}
                </Table>
                {uniqueFilteredStudents.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[11px] text-gray-500 min-h-[220px]">
                    No students found
                  </div>
                )}
              </div>
            </div>

            {/* Pagination / Load More */}
            {!isSearching && hasMoreStudents && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchMoreStudents()}
                  disabled={loadingStudents}
                  className={cn(
                    "text-xs border",
                    theme === 'dark' ? "bg-white text-black hover:bg-gray-200 border-gray-200" : "bg-white text-[#111827] hover:bg-gray-100 border-[#E5E7EB]"
                  )}
                >
                  {loadingStudents ? (
                    <>
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load More Students'
                  )}
                </Button>
              </div>
            )}
          </div>
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
              className={cn(
                "border font-medium",
                theme === 'dark' ? "bg-gray-800 hover:bg-gray-700 text-gray-100 border-gray-600" : "bg-white hover:bg-gray-50 text-[#111827] border-[#E5E7EB]"
              )}
              onClick={() => setIsDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                "border font-medium min-w-[80px]",
                theme === 'dark' ? "bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700" : "bg-[#EF4444] hover:bg-[#DC2626] text-white border-[#EF4444] hover:border-[#DC2626]"
              )}
              onClick={async () => {
                if (!deleteItem) return;
                setIsDeleting(true);
                try {
                  await deleteStudent(deleteItem.id);
                  // Refresh data immediately after deletion
                  invalidateCollectionCache('students');
                  await refreshStudents();
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
    </div>
  );
}

