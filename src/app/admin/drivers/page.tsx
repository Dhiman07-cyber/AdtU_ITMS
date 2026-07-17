"use client";

import { useAuth } from '@/contexts/auth-context';
import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { exportToExcel } from '@/lib/export-helpers';
import { ExportButton } from '@/components/ExportButton';
import { useToast } from '@/contexts/toast-context';
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
import { MoreHorizontal, Eye, Edit, Trash2, Search, Loader2, Plus, Filter, ArrowRightLeft, Users, RefreshCw } from "lucide-react";
import { deleteDriver } from '@/lib/dataService';
import Avatar from '@/components/Avatar';
import { safeImageSrc } from "@/lib/security/url-sanitizer";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useApiCollection, invalidateCollectionCache } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useTheme } from '@/components/theme-provider';
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
              <Link href={`/admin/drivers/view/${driver.id}`} className={cn(
                "px-2 py-1.5 text-sm",
                theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
              )}>
                <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                View Details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/admin/drivers/edit/${driver.id}`} className={cn(
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
              onClick={() => onDelete({ id: driver.id, name: driver.name || driver.fullName })}
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
        const aBusId = a.assignedBusId || a.busId;
        const bBusId = b.assignedBusId || b.busId;

        if (aBusId && !bBusId) return -1; // a has bus, b doesn't
        if (!aBusId && bBusId) return 1;  // b has bus, a doesn't
        if (!aBusId && !bBusId) return 0; // both reserved

        // Both have buses - sort by bus number
        const aBusNum = parseInt(aBusId.replace(/[^0-9]/g, '') || '999');
        const bBusNum = parseInt(bBusId.replace(/[^0-9]/g, '') || '999');
        return aBusNum - bBusNum;
      });
  }, [drivers, searchTerm, experienceFilter]);

  // Export drivers data
  const handleExportDrivers = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Generate drivers data in the same format as the comprehensive report
      const driversData = drivers.map((driver, index) => {
        // Find assigned bus - use CORRECT Firestore field names
        // Check: 1) Driver has busId/assignedBusId, 2) Bus has this driver as activeDriverId/assignedDriverId
        const assignedBus = buses.find(b =>
          b.id === driver.assignedBusId ||
          b.id === driver.busId ||
          b.busId === driver.assignedBusId ||
          b.activeDriverId === driver.id ||
          b.assignedDriverId === driver.id
        );

        // Show "Reserved" for drivers without bus, "Active" for drivers with bus
        const busAssignment = assignedBus ? `Bus-${extractNumber(assignedBus.busId || assignedBus.id)}` : 'Reserved';
        const status = assignedBus ? 'Active' : 'Reserved';

        return [
          (index + 1).toString(),
          driver.fullName || driver.name || 'N/A',
          driver.email || 'N/A',
          driver.phoneNumber || driver.phone || 'N/A',
          driver.driverId || driver.employeeId || driver.empId || 'N/A',
          busAssignment,
          driver.joiningDate ? formatDate(driver.joiningDate) : 'N/A',
        ];
      });

      // Add headers
      driversData.unshift([
        'Sl No', 'Name', 'Email', 'Phone', 'Driver ID', 'Bus Assigned', 'Joining Date'
      ]);

      // Add section header
      driversData.unshift(['ALL DRIVERS'], ['']);

      // Export to Excel
      await exportToExcel(driversData, `ADTU_Drivers_Report_${dateStr}`, 'Drivers');

      addToast(`Drivers data exported to ADTU_Drivers_Report_${dateStr}.xlsx`, 'success');
    } catch (error) {
      console.error('❌ Error exporting drivers:', error);
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

  return (
    <div className="mt-12 space-y-6">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Driver Management</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">View and manage all drivers</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/drivers/add">
            <Button className={cn(
              "border transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8",
              theme === 'dark' ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-700" : "bg-[#1E3A8A] hover:bg-[#1E40AF] text-white border-[#1E3A8A]"
            )}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add New Driver
            </Button>
          </Link>
          <Link href="/admin/driver-assignment">
            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white border-0 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25 rounded-md px-2.5 py-1.5 text-xs h-8">
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
              Driver Reassignment
            </Button>
          </Link>
          <ExportButton
            onClick={() => handleExportDrivers()}
            label="Export Drivers"
            className={cn(
              "border transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8",
              theme === 'dark' ? "bg-white hover:bg-gray-100 text-black border-gray-300" : "bg-white hover:bg-gray-50 text-[#111827] border-[#E5E7EB]"
            )}
          />
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={cn(
              "group h-8 px-4 border shadow-sm hover:shadow-lg font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95",
              theme === 'dark' ? "bg-white hover:bg-gray-50 text-black hover:text-purple-600 border-gray-200 hover:border-purple-200 hover:shadow-purple-500/10" : "bg-white hover:bg-gray-50 text-[#111827] hover:text-[#1E3A8A] border-[#E5E7EB] hover:border-[#1E3A8A] hover:shadow-[#1E3A8A]/10"
            )}
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className={cn("border min-h-[480px]", theme === 'dark' ? "bg-gray-900 border-gray-800" : "bg-admin-bg border-admin-border")}>
        <CardContent className="pt-3">
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

          <div className="students-section">
            <div className="students-scroll-wrapper rounded-md border" role="region" aria-label="Driver list">
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
                <TableBody>
                  {filteredDrivers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        No drivers found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDrivers.map((driver) => (
                      <DriverRow
                        key={driver.id}
                        driver={driver}
                        theme={theme}
                        busDisplay={getBusDisplay(driver.assignedBusId || driver.busId)}
                        onDelete={handleDeleteClick}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
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
