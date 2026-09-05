"use client";

import Avatar from '@/components/Avatar';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
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
import { deleteDriver } from '@/lib/dataService';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { supabase } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";
import { ArrowRightLeft,Edit,Eye,Filter,Loader2,MoreHorizontal,Plus,RefreshCw,Search,Trash2 } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect,useMemo,useState } from 'react';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { ExportButton } from '@/components/ExportButton';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { exportToExcel } from '@/lib/export-helpers';
import { formatDateDDMMYYYY } from '@/lib/utils/date-utils';

export default function AdminDrivers() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const { canDriverView, canDriverAdd, canDriverEdit, canDriverDelete, canDriverReassign, loading: permsLoading } = useModeratorPermissions();
  const router = useRouter();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: drivers, loading: loadingDrivers, refresh: refreshDrivers } = useApiCollection('drivers', {
    pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc',
    autoRefresh: false, // EVENT-DRIVEN: Only refresh when mutations occur
  });
  const { data: buses, loading: loadingBuses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc',
    autoRefresh: false,
  });

  // Event-driven refresh: auto-refresh when navigating back from add/edit pages
  useEventDrivenRefresh({
    collectionName: 'drivers',
    onRefresh: async () => {
      await Promise.all([refreshDrivers(), refreshBuses()]);
    }
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteItem, setDeleteItem] = useState<{ id: string, name: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [experienceFilter, setExperienceFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading = loadingDrivers || loadingBuses;

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    invalidateCollectionCache('drivers');
    await Promise.all([refreshDrivers(), refreshBuses()]);
    addToast('Data refreshed', 'success');
    setIsRefreshing(false);
  };

  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push('/login');
    }

    if (userData && userData.role !== 'admin' && userData.role !== 'moderator') {
      router.push(`/${userData.role}`);
    }
  }, [currentUser, userData, authLoading, router]);

  // Real-time listeners handle data fetching automatically

  const getBusDisplay = (busId: string) => {
    if (!busId) return null; // Return null for reserved drivers

    const bus = buses.find(b => b.busId === busId || b.id === busId);
    if (!bus) return busId;

    const busNum = busId.replace(/[^0-9]/g, '') || '?';
    return `Bus-${busNum} (${bus.busNumber || 'N/A'})`;
  };

  // Calculate years of experience for filtering
  const getYearsOfExperience = (joiningDate: string) => {
    if (!joiningDate) return 0;
    const joinDate = new Date(joiningDate);
    const currentDate = new Date();
    return Math.floor((currentDate.getTime() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  };

  // Helper function to extract number from string
  const extractNumber = (str: string): string => {
    if (!str) return '0';
    const match = str.match(/\d+/);
    return match ? match[0] : '0';
  };

  // Helper function to format date
  const formatDate = formatDateDDMMYYYY;

  // Export drivers data from Supabase
  const handleExportDrivers = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Fetch all driver profiles from Supabase PostgreSQL table 'driver_profiles'
      const { data: rawDrivers, error } = await supabase
        .from('driver_profiles')
        .select('*')
        .order('full_name', { ascending: true });

      if (error) throw error;

      // Fetch buses to resolve assigned bus numbers
      const { data: rawBuses } = await supabase
        .from('buses')
        .select('id, bus_number, registration_number');

      const busMap = new Map((rawBuses || []).map((b: any) => [b.id, b.bus_number || b.registration_number]));

      const driversData = (rawDrivers || []).map((driver: any, index: number) => {
        const busAssigned = 'Dynamic (Trip Init)';
        const status = driver.status || 'Active';

        return [
          (index + 1).toString(),
          driver.full_name || driver.name || 'N/A',
          driver.email || 'N/A',
          driver.phone || driver.phoneNumber || 'N/A',
          driver.employee_id || driver.emp_id || driver.license_number || 'N/A',
          busAssigned,
          driver.joining_date ? formatDate(driver.joining_date) : 'N/A',
          status
        ];
      });

      // Add headers
      driversData.unshift([
        'Sl No', 'Name', 'Email', 'Phone', 'Driver ID', 'Bus Assigned', 'Joining Date', 'Status'
      ]);

      // Add section header
      driversData.unshift(['ALL DRIVERS REPORT (SUPABASE)'], ['']);

      await exportToExcel(driversData, `ADTU_Drivers_Report_${dateStr}`, 'Drivers');

      addToast(`Exported ${(rawDrivers || []).length} drivers to ADTU_Drivers_Report_${dateStr}.xlsx`, 'success');
    } catch (error) {
      console.error('❌ Error exporting drivers from Supabase:', error);
      addToast("Failed to export drivers data. Please try again.", 'error');
    }
  };

  const commonBtnClass = "group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 shadow-sm hover:shadow-lg hover:shadow-blue-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

  // Filter and sort drivers — memoized so the full list isn't re-scanned and
  // re-sorted on every unrelated re-render (only when data/filters change).
  const filteredDrivers = useMemo(() => drivers
    .filter(driver => {
      // Search filter
      const matchesSearch =
        (driver.name && driver.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (driver.email && driver.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (driver.phone && driver.phone.includes(searchTerm)) ||
        (driver.employeeId && driver.employeeId.includes(searchTerm)) ||
        (driver.empId && driver.empId.includes(searchTerm)) ||
        (driver.driverId && driver.driverId.includes(searchTerm));

      // Experience filter
      let matchesExperience = true;
      if (experienceFilter !== "all") {
        const years = getYearsOfExperience(driver.joiningDate || driver.joinDate);
        if (experienceFilter === "0-2") matchesExperience = years >= 0 && years <= 2;
        else if (experienceFilter === "3-5") matchesExperience = years >= 3 && years <= 5;
        else if (experienceFilter === "6-10") matchesExperience = years >= 6 && years <= 10;
        else if (experienceFilter === "10+") matchesExperience = years > 10;
      }

      return matchesSearch && matchesExperience;
    })
    .sort((a, b) => {
      // Sort: Bus-assigned first (by bus number), then reserved
      const aBusId = a.busId || a.busId;
      const bBusId = b.busId || b.busId;

      if (aBusId && !bBusId) return -1; // a has bus, b doesn't
      if (!aBusId && bBusId) return 1;  // b has bus, a doesn't
      if (!aBusId && !bBusId) return 0; // both reserved

      // Both have buses - sort by bus number
      const aBusNum = parseInt(aBusId.replace(/[^0-9]/g, '') || '999');
      const bBusNum = parseInt(bBusId.replace(/[^0-9]/g, '') || '999');
      return aBusNum - bBusNum;
    }), [drivers, searchTerm, experienceFilter]);

  if (authLoading || isLoading) {
    return <PremiumPageLoader message="Loading Drivers..." subMessage="Fetching driver records and assignments..." />;
  }

  if (!currentUser || !userData || (userData.role !== 'admin' && userData.role !== 'moderator')) {
    return null;
  }

  if (!permsLoading && !canDriverView) {
    return <PermissionDeniedCard title="Drivers Section Restricted" actionName="Viewing Drivers" showGoBack={false} />;
  }



  return (
    <div className="mt-12 space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Driver Management</h1>
          <p className="text-muted-foreground mt-1">View and manage all drivers</p>
        </div>
        <div className="flex gap-2">
          {canDriverAdd && (
            <Link href="/moderator/drivers/add">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add New Driver
              </Button>
            </Link>
          )}
          {canDriverReassign && (
            <Link href="/moderator/driver-assignment">
              <Button className="bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 border border-slate-700 dark:border-slate-600 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                Driver Reassignment
              </Button>
            </Link>
          )}
          <ExportButton
            onClick={() => handleExportDrivers()}
            label="EXPORT"
            className={commonBtnClass}
          />
          <Button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={commonBtnClass}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            REFRESH
          </Button>
        </div>
      </div>

      <Card className="bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 min-h-[480px] flex flex-col">
        <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
          <div className="mb-3">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar - Top (Full Width on Mobile) */}
              <div className="relative w-full md:flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search by name, email, phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-xs w-full"
                />
              </div>

              {/* Filters - Side by side on Mobile */}
              <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                <Filter className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />

                <Select value={experienceFilter} onValueChange={setExperienceFilter}>
                  <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Experience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Experience</SelectItem>
                    <SelectItem value="0-2" className="text-xs">0-2 years</SelectItem>
                    <SelectItem value="3-5" className="text-xs">3-5 years</SelectItem>
                    <SelectItem value="6-10" className="text-xs">6-10 years</SelectItem>
                    <SelectItem value="10+" className="text-xs">10+ years</SelectItem>
                  </SelectContent>
                </Select>

                {(experienceFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setExperienceFilter("all");
                    }}
                    className="h-8 px-3 text-xs bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
            <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0" role="region" aria-label="Driver list">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver Information</TableHead>
                    <TableHead className="text-center">Phone</TableHead>
                    <TableHead className="text-center">Employee ID</TableHead>
                    <TableHead className="text-center whitespace-nowrap">Bus Assigned</TableHead>
                    <TableHead className="text-center">Years of Service</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                {filteredDrivers.length > 0 && (
                  <TableBody>
                    {filteredDrivers.map((driver) => {
                      // Calculate years of service
                      const calculateYearsOfService = (joiningDate: string) => {
                        if (!joiningDate) return 'N/A';
                        const joinDate = new Date(joiningDate);
                        const currentDate = new Date();
                        const years = Math.floor((currentDate.getTime() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                        return years > 0 ? `${years} year${years > 1 ? 's' : ''}` : '< 1 year';
                      };

                      return (
                        <TableRow key={driver.id}>
                          <TableCell className="py-2">
                            <div className="flex flex-row items-center gap-2">
                              <Avatar
                                src={safeImageSrc(driver.profilePhotoUrl)}
                                name={driver.name || driver.fullName}
                                size="sm"
                                className="flex-shrink-0"
                              />
                              <div className="flex flex-col min-w-0">
                                <div className="font-medium text-foreground text-sm">{driver.name || driver.fullName}</div>
                                <div className="text-xs text-muted-foreground">{driver.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            <div className="inline-block text-left space-y-0.5">
                              <div className="font-semibold text-foreground text-xs">
                                Ph: {driver.phone || 'N/A'}
                              </div>
                              {driver.alternatePhone && (
                                <div className="text-xs text-muted-foreground">
                                  Alt: {driver.alternatePhone}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            <div className="font-mono text-xs text-foreground">
                              {driver.employeeId || driver.empId || driver.driverId || 'N/A'}
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {getBusDisplay(driver.busId || driver.busId) ? (
                              <span className="text-[10px] whitespace-nowrap">
                                {getBusDisplay(driver.busId || driver.busId)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic whitespace-nowrap">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            <div className="inline-block text-left space-y-0.5">
                              <div className="font-semibold text-foreground text-xs">
                                {calculateYearsOfService(driver.joiningDate || driver.joinDate)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                Since {new Date(driver.joiningDate || driver.joinDate).getFullYear() || 'N/A'}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right py-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-gray-800 dark:bg-gray-900 border-gray-700 dark:border-gray-600 shadow-xl rounded-lg w-44">
                                <DropdownMenuLabel className="text-white font-semibold px-2 py-1.5 text-sm">Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-gray-600" />
                                <DropdownMenuItem asChild>
                                  <Link href={`/moderator/drivers/view/${driver.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm !text-white">
                                    <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                                    View Details
                                  </Link>
                                </DropdownMenuItem>
                                {canDriverEdit && (
                                  <DropdownMenuItem asChild>
                                    <Link href={`/moderator/drivers/edit/${driver.id}`} className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm !text-white">
                                      <Edit className="mr-2 h-3.5 w-3.5 text-yellow-400" />
                                      Edit
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                                {canDriverDelete && (
                                  <>
                                    <DropdownMenuSeparator className="bg-gray-600" />
                                    <DropdownMenuItem
                                      className="text-white hover:!bg-red-600 focus:!bg-red-600 px-2 py-1.5 text-sm !text-white cursor-pointer transition-colors"
                                      onClick={() => {
                                        setDeleteItem({ id: driver.id, name: driver.name || driver.fullName });
                                        setIsDialogOpen(true);
                                      }}
                                    >
                                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                )}
              </Table>
              {filteredDrivers.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-gray-500 min-h-[220px]">
                  No drivers found
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Driver</DialogTitle>
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
                  await deleteDriver(deleteItem.id);
                  // Refresh data immediately after deletion
                  invalidateCollectionCache('drivers');
                  await Promise.all([refreshDrivers(), refreshBuses()]);
                  addToast('Driver deleted successfully', 'success');
                  setIsDialogOpen(false);
                  setDeleteItem(null);
                } catch (error) {
                  console.error('Error deleting driver:', error);
                  addToast('Error deleting driver', 'error');
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
