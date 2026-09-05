"use client";

import Avatar from '@/components/Avatar';
import { ExportButton } from '@/components/ExportButton';
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
import { exportToExcel } from '@/lib/export-helpers';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
import { supabase } from '@/lib/supabase-client';
import { ArrowRightLeft,Edit,Eye,Filter,MoreHorizontal,Plus,RefreshCw,Search,Trash2 } from "lucide-react";
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { memo,useCallback,useEffect,useMemo,useState } from 'react';
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useTheme } from '@/components/theme-provider';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { cn } from '@/lib/utils';
import { formatDateDDMMYYYY } from '@/lib/utils/date-utils';

// Memoized table row — skips re-rendering for drivers whose data/handlers are
// unchanged, keeping search/filter typing smooth with a full page of rows.
const DriverRow = memo(function DriverRow({
  driver,
  theme,
  busDisplay,
  onDelete,
}: {
  driver: any;
  theme: string | undefined;
  busDisplay: string | null;
  onDelete: (item: { id: string; name: string }) => void;
}) {
  const joining = driver.joiningDate || driver.joinDate;
  const years = (() => {
    if (!joining) return 'N/A';
    const joinDate = new Date(joining);
    const y = Math.floor((Date.now() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return y > 0 ? `${y} year${y > 1 ? 's' : ''}` : '< 1 year';
  })();

  return (
    <TableRow>
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
        {busDisplay ? (
          <span className="text-[10px] whitespace-nowrap">
            {busDisplay}
          </span>
        ) : (
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
            theme === 'dark' ? "bg-green-100 text-green-800" : "bg-green-50 text-green-700"
          )}>
            Reserved
          </span>
        )}
      </TableCell>
      <TableCell className="py-2 text-center">
        <div className="inline-block text-left text-xs">
          <div className="font-medium text-foreground">{years}</div>
          <div className="text-[10px] text-muted-foreground">
            Since {new Date(joining).getFullYear() || 'N/A'}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={cn(
              "h-8 w-8 p-0 cursor-pointer",
              theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
            )}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(
            "shadow-xl rounded-lg w-44",
            theme === 'dark' ? "bg-gray-900 border-gray-600" : "bg-white border-[#E5E7EB]"
          )}>
            <DropdownMenuLabel className={cn("font-semibold px-2 py-1.5 text-sm", theme === 'dark' ? "text-white" : "text-[#111827]")}>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
            <DropdownMenuItem asChild>
              <Link href={`/admin/drivers/view/${driver.uid || driver.id}`} className={cn(
                "px-2 py-1.5 text-sm",
                theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
              )}>
                <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/drivers/edit/${driver.uid || driver.id}`} className={cn(
                "px-2 py-1.5 text-sm",
                theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
              )}>
                <Edit className="mr-2 h-3.5 w-3.5 text-yellow-400" />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
            <DropdownMenuItem
              className={cn(
                "px-2 py-1.5 text-sm cursor-pointer transition-colors",
                theme === 'dark' ? "text-white hover:!bg-red-600 focus:!bg-red-600" : "text-[#111827] hover:!bg-red-600 focus:!bg-red-600"
              )}
              onClick={() => onDelete({ id: driver.uid || driver.id, name: driver.name || driver.fullName })}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

export default function AdminDrivers() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  const { theme } = useTheme();

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
    try {
      invalidateCollectionCache('drivers');
      await Promise.all([refreshDrivers(), refreshBuses()]);
      addToast('Data refreshed', 'success');
    } catch (error) {
      console.error('Error refreshing drivers:', error);
      addToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

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
  // scanning the whole bus array for every driver row on every render.
  const busById = useMemo(() => {
    const map = new Map<string, any>();
    for (const b of buses) {
      if (b.busId) map.set(b.busId, b);
      if (b.id) map.set(b.id, b);
    }
    return map;
  }, [buses]);

  const getBusDisplay = useCallback((busId: string) => {
    if (!busId) return null; // Return null for reserved drivers

    const bus = busById.get(busId);
    if (!bus) return busId;

    const busNum = busId.replace(/[^0-9]/g, '') || '?';
    return `Bus-${busNum} (${bus.busNumber || 'N/A'})`;
  }, [busById]);

  // Calculate years of experience for filtering
  const getYearsOfExperience = (joiningDate: string) => {
    if (!joiningDate) return 0;
    const joinDate = new Date(joiningDate);
    const currentDate = new Date();
    return Math.floor((currentDate.getTime() - joinDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  };

  // Stable delete handler so memoized rows don't re-render on unrelated updates.
  const handleDeleteClick = useCallback((item: { id: string; name: string }) => {
    setDeleteItem(item);
    setIsDialogOpen(true);
  }, []);

  // Filter and sort drivers — memoized so it only recomputes when the data,
  // search term, or filter changes (not on every render).
  const filteredDrivers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return drivers
      .filter(driver => {
        // Search filter
        const matchesSearch = !searchTerm ||
          (driver.name && driver.name.toLowerCase().includes(term)) ||
          (driver.email && driver.email.toLowerCase().includes(term)) ||
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
      });
  }, [drivers, searchTerm, experienceFilter]);

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
          driver.joining_date ? formatDateDDMMYYYY(driver.joining_date) : 'N/A',
          status
        ];
      });

      // Add headers
      driversData.unshift([
        'Sl No', 'Name', 'Email', 'Phone', 'Driver ID', 'Assignment Mode', 'Joining Date', 'Status'
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

  // Helper function to format date
  const formatDate = formatDateDDMMYYYY;

  // Helper function to extract number from string
  const extractNumber = (str: string): string => {
    if (!str) return '0';
    const match = str.match(/\d+/);
    return match ? match[0] : '0';
  };

  if ((authLoading || isLoading) && drivers.length === 0) {
    return <PremiumPageLoader message="Curating Driver Registry..." subMessage="Fetching driver profiles and assignments..." />;
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
          <h1 className="text-3xl font-bold text-foreground">Driver Management</h1>
          <p className="text-muted-foreground mt-1">View and manage all drivers</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/drivers/add">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add New Driver
            </Button>
          </Link>
          <Link href="/admin/driver-assignment">
            <Button className="bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 border border-slate-700 dark:border-slate-600 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8">
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
              Driver Reassignment
            </Button>
          </Link>
          <ExportButton
            onClick={() => handleExportDrivers()}
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

      <Card className={cn("border min-h-[480px] flex flex-col", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-admin-bg border-admin-border")}>
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

                <Select value={experienceFilter} onValueChange={setExperienceFilter}>
                  <SelectTrigger className={cn(
                    "h-8 text-xs min-w-[100px] flex-1 md:w-[150px] md:bg-transparent border",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-[#E5E7EB]"
                  )}>
                    <SelectValue placeholder="Experience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Experience</SelectItem>
                    <SelectItem value="0-2" className="text-xs">0-2 Years</SelectItem>
                    <SelectItem value="2-5" className="text-xs">2-5 Years</SelectItem>
                    <SelectItem value="5+" className="text-xs">5+ Years</SelectItem>
                  </SelectContent>
                </Select>

                {(experienceFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExperienceFilter("all")}
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
          </div>

          <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
            <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0" role="region" aria-label="Driver list">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver Information</TableHead>
                    <TableHead className="text-center">Phone</TableHead>
                    <TableHead className="text-center">Employee ID</TableHead>
                    <TableHead className="text-center whitespace-nowrap">Assignment Mode</TableHead>
                    <TableHead className="text-center">Years of Service</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                {filteredDrivers.length > 0 && (
                  <TableBody>
                    {filteredDrivers.map((driver, index) => (
                      <DriverRow
                        key={driver.uid || driver.id || `driver-${index}`}
                        driver={driver}
                        theme={theme}
                        busDisplay="Dynamic (Trip Init)"
                        onDelete={handleDeleteClick}
                      />
                    ))}
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
                  await deleteDriver(deleteItem.id);
                  // Refresh data immediately after deletion
                  invalidateCollectionCache('drivers');
                  await refreshDrivers();
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
