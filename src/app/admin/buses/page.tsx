"use client";

import { ExportButton } from '@/components/ExportButton';
import { TableRowLoader } from '@/components/LoadingSpinner';
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
import { useToast } from '@/contexts/toast-context';
import { deleteBus } from "@/lib/dataService";
import { exportToExcel } from '@/lib/export-helpers';
import {
  Bus,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  Edit,
  Eye,
  Filter,
  Loader2,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  Route as RouteIcon,
  Search,
  Trash2,
  Users,
  X
} from "lucide-react";
import { BusQRStickerModal } from '@/components/bus/BusQRStickerModal';
import { MobileActionFAB } from '@/components/layout/MobileActionFAB';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from "react";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '@/contexts/auth-context';
import { invalidateCollectionCache, useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useLocalAndServerSearch } from '@/hooks/useLocalAndServerSearch';
import { cn } from '@/lib/utils';

// Use local interfaces to avoid type conflicts
interface BusItem {
  id: string;
  busId: string;
  busNumber: string;
  model: string;
  capacity: number;
  driverUID: string;
  driverName: string;
  routeId: string;
  routeName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface DriverItem {
  id: string;
  name: string;
  fullName?: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  licenseNumber?: string;
  busId?: string;
  routeId?: string;
  employeeId?: string;
  joiningDate?: string;
  createdAt?: string;
  tripActive?: boolean;
  activeTripId?: string;
}

// Define our own extended route interface to match the actual API response
interface ExtendedRoute {
  id: string;
  routeId: string;
  routeName: string;
  route: string;
  stops: Array<{
    stop_name: string;
    name: string;
    lat: number;
    lng: number;
    sequence: number;
  }>;
  totalStops: number;
  assignedBuses: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function BusesPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { theme } = useTheme();
  const { currentUser, userData, loading: authLoading } = useAuth();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: buses, loading: loadingBuses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc', autoRefresh: false,
  });
  const { data: drivers, loading: loadingDrivers, refresh: refreshDrivers } = useApiCollection('drivers', {
    pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc', autoRefresh: false,
  });
  const { data: routes, loading: loadingRoutes, refresh: refreshRoutes } = useApiCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc', autoRefresh: false,
  });

  // Event-driven refresh: auto-refresh when mutations occur in other pages
  useEventDrivenRefresh({
    collectionName: 'buses',
    onRefresh: async () => {
      await Promise.all([refreshBuses(), refreshDrivers(), refreshRoutes()]);
    }
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [routeFilter, setRouteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [qrStickerBus, setQrStickerBus] = useState<{ id: string; busNumber: string; routeName?: string; model?: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading = loadingBuses || loadingDrivers || loadingRoutes;

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshBuses(), refreshDrivers(), refreshRoutes()]);
      addToast('Data refreshed', 'success');
    } catch (error) {
      console.error('Error refreshing buses:', error);
      addToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Helper function to extract number from string
  const extractNumber = (str: string): string => {
    if (!str) return '0';
    const match = str.match(/\d+/);
    return match ? match[0] : '0';
  };

  // O(1) lookup tables built once per data change. Previously every table row called
  // drivers.find()/routes.find() — O(buses × drivers) and O(buses × routes) work on
  // every keystroke/render. Indexing once turns each row lookup into a Map.get().
  const driverIndex = useMemo(() => {
    const byId = new Map<string, any>();
    const byBusId = new Map<string, any>();
    for (const d of drivers as any[]) {
      if (d.id) byId.set(d.id, d);
      if (d.busId) byBusId.set(d.busId, d);
    }
    return { byId, byBusId };
  }, [drivers]);

  const routeIndex = useMemo(() => {
    const byId = new Map<string, any>();
    for (const r of routes as any[]) {
      if (r.id) byId.set(r.id, r);
      if ((r as any).routeId) byId.set((r as any).routeId, r);
    }
    return byId;
  }, [routes]);

  // Unique routes for filter
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; name: string }> = [];
    (buses || []).forEach((b: any) => {
      const rId = b.route_id || b.routeId;
      const rName = b.routeName || b.route_name;
      if (rId && !seen.has(rId)) {
        seen.add(rId);
        list.push({ id: rId, name: rName || `Route ${rId}` });
      }
    });
    return list;
  }, [buses]);

  // Local matcher for Tier 1 search (0ms, 0 network calls)
  const busLocalMatcher = useMemo(() => {
    return (bus: any, q: string) => {
      const busNum = (bus.busNumber || bus.bus_number || '').toLowerCase();
      const rName = (bus.routeName || bus.route_name || '').toLowerCase();
      const busId = (bus.busId || bus.id || '').toLowerCase();
      const model = (bus.model || '').toLowerCase();
      const driver = driverIndex.byBusId.get(bus.id || bus.busId) || driverIndex.byId.get(bus.driverUID || bus.primary_driver_uid);
      const driverName = (driver?.name || driver?.fullName || '').toLowerCase();

      return (
        busNum.includes(q) ||
        rName.includes(q) ||
        busId.includes(q) ||
        model.includes(q) ||
        driverName.includes(q)
      );
    };
  }, [driverIndex]);

  const {
    results: searchedBuses,
    isSearchingServer,
    isServerFallback,
  } = useLocalAndServerSearch(
    buses,
    searchTerm,
    busLocalMatcher,
    "/api/buses",
    {
      extractItems: (json: any) => json.buses || json.data || [],
    }
  );

  // Filtered + sorted list recomputed only when inputs actually change
  const filteredBuses = useMemo(() => {
    const status = statusFilter.toLowerCase();
    return searchedBuses.filter(bus => {
      const busRouteId = bus.route_id || bus.routeId || '';
      const matchesRoute = routeFilter === "all" || busRouteId === routeFilter;
      const matchesStatus = statusFilter === "all" || (bus.status && bus.status.toLowerCase() === status);

      return matchesRoute && matchesStatus;
    }).sort((a, b) => {
      const numA = extractNumber(a.busId || a.id || '');
      const numB = extractNumber(b.busId || b.id || '');
      return parseInt(numA) - parseInt(numB);
    });
  }, [searchedBuses, routeFilter, statusFilter]);

  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const [isPaginating, setIsPaginating] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, routeFilter, statusFilter]);

  const totalPages = Math.max(currentPage, Math.max(1, Math.ceil(filteredBuses.length / PAGE_SIZE)));
  const validatedPage = Math.max(1, Math.min(currentPage, totalPages));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedBuses = useMemo(() => {
    const startIndex = (validatedPage - 1) * PAGE_SIZE;
    const slice = filteredBuses.slice(startIndex, startIndex + PAGE_SIZE);
    if (slice.length === 0 && filteredBuses.length > 0) {
      const fallbackStart = Math.max(0, filteredBuses.length - PAGE_SIZE);
      return filteredBuses.slice(fallbackStart);
    }
    return slice;
  }, [filteredBuses, validatedPage, PAGE_SIZE]);

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
    }, 200);
  };

  // Export buses data from Supabase
  const handleExportBuses = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      const token = await currentUser?.getIdToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

      const [busesRes, routesRes, driversRes] = await Promise.all([
        fetch('/api/buses', { headers: authHeaders }),
        fetch('/api/routes', { headers: authHeaders }),
        fetch('/api/drivers', { headers: authHeaders }),
      ]);

      const rawBuses = busesRes.ok ? (await busesRes.json()).buses || [] : [];
      const rawRoutes = routesRes.ok ? await routesRes.json() : [];
      const rawDrivers = driversRes.ok ? (await driversRes.json()).drivers || [] : [];

      const routeMap = new Map<string, any>((rawRoutes || []).map((r: any) => [r.id || r.routeId, r]));
      const driverMap = new Map<string, any>((rawDrivers || []).map((d: any) => [d.uid || d.id, d.full_name || d.name]));

      const busesData = (rawBuses || []).map((bus: any, index: number) => {
        const routeObj: any = routeMap.get(bus.route_id || bus.routeId);
        const routeName = routeObj?.route_name || routeObj?.routeName || routeObj?.route_number || routeObj?.routeNumber || 'Not Assigned';

        let stops = 'N/A';
        if (routeObj && routeObj.stops) {
          if (Array.isArray(routeObj.stops)) {
            stops = routeObj.stops.map((s: any) => s.stop_name || s.name || s).join(', ');
          } else if (typeof routeObj.stops === 'string') {
            stops = routeObj.stops;
          }
        }

        const driverName = driverMap.get(bus.driver_id) || 'Not Assigned';
        const status = bus.status || 'active';

        return [
          (index + 1).toString(),
          bus.bus_number || 'N/A',
          routeName,
          stops,
          driverName,
          bus.capacity ? bus.capacity.toString() : '0',
          status.charAt(0).toUpperCase() + status.slice(1)
        ];
      });

      // Add headers
      busesData.unshift([
        'Sl No', 'Bus Number', 'Route Assigned', 'Stops Summary', 'Driver Assigned', 'Capacity', 'Status'
      ]);

      // Add section header
      busesData.unshift(['ALL BUSES REPORT (SUPABASE)'], ['']);

      await exportToExcel(busesData, `ADTU_Buses_Report_${dateStr}`, 'Buses');

      addToast(
        `Exported ${(rawBuses || []).length} buses to ADTU_Buses_Report_${dateStr}.xlsx`,
        'success'
      );
    } catch (error) {
      console.error('❌ Error exporting buses from Supabase:', error);
      addToast(
        'Failed to export buses data. Please try again.',
        'error'
      );
    }
  };

  const commonBtnClass = "group h-8 px-3.5 bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-zinc-200 dark:border-zinc-700/60 shadow-xs text-xs font-semibold rounded-lg transition-all duration-200 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

  // Function to get driver name for a specific bus — O(1) via prebuilt indexes.
  const getDriverNameForBus = useCallback((bus: any) => {
    // Method 1: Check bus activeDriverId or assignedDriverId (CORRECT Firestore fields)
    const driverIdToFind = bus.activeDriverId || bus.assignedDriverId;
    if (driverIdToFind) {
      const driver = driverIndex.byId.get(driverIdToFind);
      if (driver) {
        return driver.fullName || driver.name || 'Unknown Driver';
      }
    }

    // Method 2: Reverse lookup - find driver with this busId assigned
    const driver = driverIndex.byBusId.get(bus.id);
    if (driver) {
      return driver.fullName || driver.name || 'Unknown Driver';
    }

    return 'No Driver Assigned';
  }, [driverIndex]);


  // Function to get route name for a specific bus — O(1) via prebuilt index.
  const getRouteNameForBus = (bus: any) => {
    // 1. Try finding in routes collection first (Canonical source)
    const routeIdToCheck = bus.routeId || bus.routeId;
    if (routeIdToCheck) {
      const foundRoute = routeIndex.get(routeIdToCheck);
      if (foundRoute) return foundRoute.routeName || (foundRoute as any).route || `Route ${routeIdToCheck}`;
    }

    // 2. Fallback to embedded data (Legacy)
    if (bus.route && bus.route.routeName) {
      return bus.route.routeName;
    }

    return 'No Route Assigned';
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteItem({ id, name });
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;

    try {
      const success = await deleteBus(deleteItem.id);
      if (success) {
        // Refresh data immediately after deletion
        invalidateCollectionCache('buses');
        await Promise.all([refreshBuses(), refreshDrivers(), refreshRoutes()]);
        addToast(`Bus ${deleteItem.name} deleted successfully`, 'success');
        console.log(`Successfully deleted bus: ${deleteItem.name} (${deleteItem.id})`);
      } else {
        console.error('Failed to delete bus');
        // Show error message to user
      }
    } catch (error) {
      console.error('Error deleting bus:', error);
      // Show error message to user
    } finally {
      setIsDialogOpen(false);
      setDeleteItem(null);
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

  return (
    <div className="itms-admin-container space-y-6">
      {/* Page Header */}
      <div className="itms-page-header-container">
        <div className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-600/10 border border-amber-500/20 text-amber-500">
                <Bus className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight">
                Fleet Management Hub
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage vehicle fleet readiness, onboard capacities, operator assignments, and transit status.
            </p>
          </div>

          {/* Desktop action toolbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Button
              className="cursor-pointer bg-amber-600 hover:bg-amber-700 text-white border border-amber-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 gap-1.5"
              onClick={() => router.push('/admin/buses/add')}
            >
              <Plus className="h-4 w-4" />
              <span>Add New Bus</span>
            </Button>
            <Button
              className="cursor-pointer bg-white/80 dark:bg-zinc-800/80 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/60 shadow-xs rounded-lg px-3 py-1.5 text-xs h-9 gap-1.5"
              onClick={() => router.push('/admin/smart-allocation?tab=buses')}
              title="Manage route reassignments for buses"
            >
              <RouteIcon className="h-4 w-4 text-emerald-500" />
              <span>Bus Reassignment</span>
            </Button>
            <ExportButton
              onClick={() => handleExportBuses()}
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
      </div>

      <Card className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 shadow-sm min-h-[480px] flex flex-col">
        <CardContent className="p-4 flex-1 flex flex-col min-h-0">
          <div className="mb-4">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-0">
                {isSearchingServer ? (
                  <Loader2 className="absolute left-3 top-2.5 h-4 w-4 text-blue-500 animate-spin" />
                ) : (
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                )}
                <Input
                  placeholder="Search buses by number, route, or bus ID..."
                  className="pl-9 pr-24 h-9 text-xs w-full bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60 rounded-lg"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
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

              {/* Filters */}
              <div className="grid grid-cols-2 gap-2 items-center w-full md:w-auto md:flex md:flex-row">
                {/* Route Filter */}
                <Select value={routeFilter} onValueChange={setRouteFilter}>
                  <SelectTrigger className="h-9 text-xs w-full md:w-[160px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                    <SelectValue placeholder="Assigned Route" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 max-h-60">
                    <SelectItem value="all" className="text-xs">All Routes</SelectItem>
                    {uniqueRoutes.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-xs">
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Status Filter */}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 text-xs w-full md:w-[140px] bg-slate-50 dark:bg-zinc-800/70 border-zinc-200 dark:border-zinc-700/60">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                    <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                    <SelectItem value="active" className="text-xs text-emerald-500">Active</SelectItem>
                    <SelectItem value="inactive" className="text-xs text-rose-500">Inactive</SelectItem>
                    <SelectItem value="maintenance" className="text-xs text-amber-500">Maintenance</SelectItem>
                  </SelectContent>
                </Select>

                {(routeFilter !== "all" || statusFilter !== "all" || searchTerm) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRouteFilter("all");
                      setStatusFilter("all");
                      setSearchTerm("");
                    }}
                    className="h-9 px-3 text-xs bg-rose-500/10 text-rose-500 dark:text-rose-400 hover:bg-rose-500/20 rounded-lg col-span-2 md:col-span-1"
                  >
                    Clear Filters
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="students-section flex-1 flex flex-col min-h-0">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs relative flex flex-col min-h-0">
              {/* Data Fetch / Pagination Top Progress Bar */}
              {isPaginating && (
                <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-blue-500/10 dark:bg-blue-400/10 overflow-hidden">
                  <div className="animate-progress w-full h-full bg-blue-500 dark:bg-blue-400 origin-left-right" />
                </div>
              )}

              <div
                className={cn(
                  "overflow-x-auto min-h-[520px] flex-1 flex flex-col transition-opacity duration-200",
                  isPaginating && "opacity-60 pointer-events-none"
                )}
                role="region"
                aria-label="Bus list"
              >
                <Table className="w-full table-fixed min-w-[850px]">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[26%]" />
                    <col className="w-[14%]" />
                    <col className="w-[20%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <TableHeader className="bg-slate-50 dark:bg-zinc-800/50">
                    <TableRow className="h-9 border-b border-zinc-200 dark:border-zinc-800">
                      <TableHead className="w-[18%] text-[11px] font-bold py-2">Bus Number</TableHead>
                      <TableHead className="w-[26%] text-[11px] font-bold py-2">Assigned Route</TableHead>
                      <TableHead className="w-[14%] text-[11px] font-bold py-2">Capacity</TableHead>
                      <TableHead className="w-[20%] text-[11px] font-bold py-2">Driver Assigned</TableHead>
                      <TableHead className="w-[12%] text-[11px] font-bold py-2">Operational Status</TableHead>
                      <TableHead className="w-[10%] text-[11px] font-bold py-2 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  {filteredBuses.length > 0 && (
                    <TableBody>
                      {paginatedBuses.map((bus) => (
                        <TableRow key={bus.id} className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors border-b border-zinc-100 dark:border-zinc-800/60" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}>
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                                <Bus className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="font-bold text-xs sm:text-sm text-foreground truncate block">{bus.busNumber}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{bus.model || 'Standard Coach'}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <RouteIcon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span className="font-medium text-xs truncate">{getRouteNameForBus(bus)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span>{bus.capacity || 50} seats</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden text-xs">
                            <span className={cn(
                              "font-medium truncate block",
                              getDriverNameForBus(bus) === 'Not Assigned' ? "text-muted-foreground italic" : "text-foreground"
                            )}>
                              {getDriverNameForBus(bus)}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden">
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0",
                              (bus.status === 'active' || bus.status === 'idle' || bus.status === 'enroute')
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : (bus.status === 'inactive' || bus.status === 'expired')
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                : (bus.status === 'maintenance')
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                : 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20'
                            )}>
                              {(() => {
                                const status = bus.status || 'active';
                                if (status.toLowerCase() === 'idle' || status.toLowerCase() === 'enroute') return 'Active';
                                return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
                              })()}
                            </span>
                          </TableCell>
                          <TableCell className="text-right overflow-hidden">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className={cn(
                                  "h-8 w-8 p-0 cursor-pointer",
                                  theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                                )}>
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className={cn(
                                "shadow-xl rounded-lg w-44",
                                theme === 'dark' ? "bg-gray-900 border-gray-600" : "bg-white border-[#E5E7EB]"
                              )}>
                                <DropdownMenuLabel className={cn("font-semibold px-2 py-1.5 text-sm", theme === 'dark' ? "text-white" : "text-[#111827]")}>Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
                                <DropdownMenuItem
                                  className={cn(
                                    "px-2 py-1.5 text-sm cursor-pointer",
                                    theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
                                  )}
                                  onClick={() => router.push(`/admin/buses/view/${bus.id}`)}
                                >
                                  <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className={cn(
                                    "px-2 py-1.5 text-sm cursor-pointer",
                                    theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
                                  )}
                                  onClick={() => router.push(`/admin/buses/edit/${bus.id}`)}
                                >
                                  <Edit className="mr-2 h-3.5 w-3.5 text-yellow-400" />
                                  Edit Bus
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className={cn(
                                    "px-2 py-1.5 text-sm cursor-pointer",
                                    theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
                                  )}
                                  onClick={() => setQrStickerBus(bus as any)}
                                >
                                  <QrCode className="mr-2 h-3.5 w-3.5 text-cyan-400" />
                                  Bus QR Sticker
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
                                <DropdownMenuItem
                                  className={cn(
                                    "px-2 py-1.5 text-sm cursor-pointer transition-colors",
                                    theme === 'dark' ? "text-white hover:!bg-red-600 focus:!bg-red-600" : "text-[#111827] hover:!bg-red-600 focus:!bg-red-600"
                                  )}
                                  onClick={() => handleDelete(bus.id, bus.busNumber)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Delete Bus
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  )}
                </Table>
                {filteredBuses.length === 0 && (
                  isLoading ? (
                    <div className="p-6">
                      <TableRowLoader rows={5} />
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground min-h-[220px]">
                      No buses found
                    </div>
                  )
                )}
              </div>

              {/* Pagination Footer */}
              {filteredBuses.length > 0 && (
                <div className="pt-3 pb-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-200/60 dark:border-zinc-800/60 px-4 bg-white dark:bg-zinc-900/50">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                    Showing{" "}
                    <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                      {(validatedPage - 1) * PAGE_SIZE + 1}–{Math.min(validatedPage * PAGE_SIZE, filteredBuses.length)}
                    </strong>{" "}
                    of{" "}
                    <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                      {filteredBuses.length}
                    </strong>{" "}
                    buses
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
                      <span>Next</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              {deleteItem && `This action cannot be undone. This will permanently delete the bus "${deleteItem.name}" from the system.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className={cn(
                "border",
                theme === 'dark' ? "bg-gray-800 border-gray-600 text-foreground hover:bg-gray-700" : "bg-white border-[#E5E7EB] text-[#111827] hover:bg-gray-50"
              )}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                "border font-medium",
                theme === 'dark' ? "bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700" : "bg-[#EF4444] hover:bg-[#DC2626] text-white border-[#EF4444] hover:border-[#DC2626]"
              )}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bus QR Sticker Modal */}
      <BusQRStickerModal
        isOpen={Boolean(qrStickerBus)}
        onClose={() => setQrStickerBus(null)}
        bus={qrStickerBus ? {
          id: qrStickerBus.id,
          busNumber: qrStickerBus.busNumber,
          routeName: getRouteNameForBus(qrStickerBus),
          model: qrStickerBus.model,
        } : null}
      />

      {/* Mobile Floating Action Button */}
      <MobileActionFAB
        actions={[
          {
            label: "Add New Bus",
            icon: Plus,
            onClick: () => router.push('/admin/buses/add'),
          },
          {
            label: "Bus Reassignment",
            icon: RouteIcon,
            onClick: () => router.push('/admin/smart-allocation?tab=buses'),
          },
          {
            label: "Fleet Map",
            icon: Compass,
            onClick: () => router.push('/admin/fleet-map'),
          },
          {
            label: "Export Buses",
            icon: Download,
            onClick: () => handleExportBuses(),
          },
        ]}
      />
    </div>
  );
}
