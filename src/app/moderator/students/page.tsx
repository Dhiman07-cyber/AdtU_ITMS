"use client";

import { useAuth } from '@/contexts/auth-context';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { exportToExcel } from '@/lib/export-helpers';
import { ExportButton } from '@/components/ExportButton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { MoreHorizontal, Eye, Edit, Trash2, Search, Loader2, Plus, RefreshCw, Filter, X, Users, ArrowRightLeft, QrCode } from "lucide-react";
import { deleteStudent } from '@/lib/dataService';
import { useToast } from '@/contexts/toast-context';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import Avatar from '@/components/Avatar';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useApiCollection, invalidateCollectionCache } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

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


    // Search State
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
    const [searchResults, setSearchResults] = useState<any[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    const isLoading = loadingStudents || loadingBuses || isSearching;
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Manual refresh handler
    const handleRefresh = async () => {
        setIsRefreshing(true);
        invalidateCollectionCache('students');
        await Promise.all([refreshStudents(), refreshBuses()]);
        addToast('Data refreshed', 'success');
        setIsRefreshing(false);
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

        if (userData && userData.role !== 'moderator') {
            router.push(`/${userData.role}`);
        }
    }, [currentUser, userData, authLoading, router]);

    // Real-time listeners handle data fetching automatically

    const getBusDisplay = (busId: string) => {
        if (!busId) return 'Not Assigned';

        const bus = buses.find(b => b.busId === busId || b.id === busId);
        if (!bus) return busId;

        const busNum = busId.replace(/[^0-9]/g, '') || '?';
        return `Bus-${busNum} (${bus.busNumber || 'N/A'})`;
    };

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

    // Export students data
    const handleExportStudents = async () => {
        try {
            const currentDate = new Date();
            const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

            // Generate students data in the same format as the comprehensive report
            const studentsData = students.map((student, index) => {
                // Find assigned bus - check multiple possible fields
                const assignedBus = buses.find(b =>
                    b.id === student.busId ||
                    b.busId === student.busId ||
                    b.id === student.assignedBusId ||
                    b.busId === student.assignedBusId ||
                    b.id === student.currentBusId ||
                    b.busId === student.currentBusId
                );

                // Use actual status field from Firestore (not calculated)
                const status = student.status || 'N/A';

                // Use correct field name: durationYears (not sessionDuration)
                const yearsAvailed = student.durationYears ? `${student.durationYears} year${student.durationYears > 1 ? 's' : ''}` : 'N/A';

                return [
                    (index + 1).toString(),
                    student.fullName || student.name || 'N/A',
                    student.email || 'N/A',
                    student.phoneNumber || student.phone || 'N/A',
                    student.faculty || 'N/A',
                    student.enrollmentId || 'N/A',
                    assignedBus ? `Bus-${extractNumber(assignedBus.busId || assignedBus.id)}` : 'Not Assigned',
                    student.shift ? student.shift.charAt(0).toUpperCase() + student.shift.slice(1) : 'N/A',
                    student.sessionStartYear || 'N/A',
                    student.sessionEndYear || 'N/A',
                    yearsAvailed,
                    status
                ];
            });

            // Add headers
            studentsData.unshift([
                'Sl No', 'Name', 'Email', 'Phone', 'Faculty', 'Enrollment ID',
                'Bus Assigned', 'Shift', 'Session Start', 'Session End', 'Years Availed', 'Status'
            ]);

            // Add section header
            studentsData.unshift(['ALL STUDENTS'], ['']);

            // Export to Excel
            await exportToExcel(studentsData, `ADTU_Students_Report_${dateStr}`, 'Students');

            addToast(
                `Students data exported to ADTU_Students_Report_${dateStr}.xlsx`,
                'success'
            );
        } catch (error) {
            console.error('❌ Error exporting students:', error);
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

    if (!currentUser || !userData || userData.role !== 'moderator') {
        return null;
    }

    if (!permsLoading && !canStudentView) {
        return <PermissionDeniedCard title="Students Section Restricted" actionName="Viewing Students" showGoBack={false} />;
    }

    return (
        <div className="mt-12 space-y-6">
            {/* Page Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">Student Management</h1>
                    <p className="text-muted-foreground mt-1">View and manage all students</p>
                </div>
                <div className="flex gap-2">
                    {canStudentAdd && (
                        <Link href="/moderator/students/add">
                            <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                Add New Student
                            </Button>
                        </Link>
                    )}

                    {canStudentReassign && (
                        <Link href="/moderator/smart-allocation">
                            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white border-0 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25 rounded-md px-2.5 py-1.5 text-xs h-8">
                                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                                Student Reassignment
                            </Button>
                        </Link>
                    )}
                    <Link href="/moderator/verification">
                        <Button className="bg-cyan-600 hover:bg-cyan-700 text-white border border-cyan-700 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
                            <QrCode className="mr-1.5 h-3.5 w-3.5" />
                            Verification
                        </Button>
                    </Link>
                    <ExportButton
                        onClick={() => handleExportStudents()}
                        label="Export"
                        className="h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95"
                    />
                    <Button
                        size="sm"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95"
                    >
                        <RefreshCw className={`mr-2 h-3.5 w-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
                        Refresh
                    </Button>

                </div>
            </div>

            <Card className="bg-gray-50 dark:bg-gray-900 border-border">
                <CardContent className="pt-3">
                    <div className="mb-3">
                        {/* Search Bar and Filters */}
                        <div className="flex flex-col md:flex-row gap-3">
                            {/* Search Bar - Top (Full Width on Mobile) */}
                            <div className="relative w-full md:flex-1">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                                <Input
                                    placeholder="Search by name, email, or phone..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9 h-9 text-xs w-full"
                                />
                            </div>

                            {/* Filters - Side by side on Mobile */}
                            <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                                <Filter className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />

                                <Select value={shiftFilter} onValueChange={setShiftFilter}>
                                    <SelectTrigger className="h-8 text-xs min-w-[100px] flex-1 md:w-[150px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                                        <SelectValue placeholder="Shift" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all" className="text-xs">All Shifts</SelectItem>
                                        <SelectItem value="morning" className="text-xs">Morning</SelectItem>
                                        <SelectItem value="evening" className="text-xs">Evening</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Select value={busFilter} onValueChange={setBusFilter}>
                                    <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[250px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
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
                                        className="h-8 px-3 text-xs bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
                                    >
                                        Clear
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="students-section">
                        <div className="students-scroll-wrapper rounded-md border overflow-x-auto" role="region" aria-label="Student list">
                            <Table>
                                <TableHeader>
                                    <TableRow className="h-8">
                                        <TableHead className="text-[11px] py-1.5">Student</TableHead>
                                        <TableHead className="text-[11px] py-1.5">Phone</TableHead>
                                        <TableHead className="text-[11px] py-1.5">Enrollment ID</TableHead>
                                        <TableHead className="text-[11px] py-1.5">Bus Assigned</TableHead>
                                        <TableHead className="text-[11px] py-1.5">Shift</TableHead>
                                        <TableHead className="text-[11px] py-1.5">Session</TableHead>
                                        <TableHead className="text-[11px] py-1.5 text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {/* Show loader inside table when refreshing/searching with existing data */}
                                    {isLoading && (students.length > 0 || searchResults) && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-1 p-0">
                                                <div className="w-full h-1 bg-blue-100 dark:bg-blue-900 overflow-hidden">
                                                    <div className="animate-progress w-full h-full bg-blue-500 origin-left-right"></div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {uniqueFilteredStudents.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-6 text-[11px] text-gray-500">
                                                No students found
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        uniqueFilteredStudents.map((student) => (
                                            <TableRow key={student.id} className="h-auto">
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
                                                <TableCell className="py-1.5">
                                                    <div className="font-mono text-[10px] text-foreground whitespace-nowrap">
                                                        {student.enrollmentId || student.studentId || 'N/A'}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="py-1.5">
                                                    <div className="text-[10px] whitespace-nowrap">{getBusDisplay(student.busId)}</div>
                                                </TableCell>
                                                <TableCell className="py-1.5">
                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${student.shift?.toLowerCase() === 'morning' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                                                        }`}>
                                                        {student.shift || 'N/A'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="py-1.5">
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[9px] font-medium ${student.status === 'active' ? 'bg-green-500 text-white' :
                                                            student.status === 'expired' ? 'bg-red-500 text-white' :
                                                                student.status === 'maintenance' ? 'bg-yellow-500 text-white' :
                                                                    'bg-gray-100 text-gray-700'
                                                            }`}>
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
                                                            <Button variant="ghost" className="h-7 w-7 p-0 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                                                                <MoreHorizontal className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="bg-gray-800 dark:bg-gray-900 border-gray-700 dark:border-gray-600 shadow-xl rounded-lg w-40">
                                                            <DropdownMenuLabel className="text-white text-[11px] font-semibold px-2 py-1.5">Actions</DropdownMenuLabel>
                                                            <DropdownMenuSeparator className="bg-gray-600" />
                                                            <DropdownMenuItem asChild>
                                                                <Link href={`/moderator/students/view/${student.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
                                                                    <Eye className="mr-1.5 h-3 w-3 text-blue-400" />
                                                                    View Details
                                                                </Link>
                                                            </DropdownMenuItem>
                                                            {canStudentEdit && (
                                                                <DropdownMenuItem asChild>
                                                                    <Link href={`/moderator/students/edit/${student.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 !text-white text-[11px]">
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
                                        ))
                                    )}
                                </TableBody>
                            </Table>
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
                                className="text-xs bg-white text-black hover:bg-gray-200 border-gray-200"
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
        </div>
    );
}

