"use client";

import { useState, useEffect } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Hash,
  Clock,
  Edit,
  Trash2,
  User,
  Calendar,
  Activity
} from "lucide-react";
import Link from "next/link";
import { useToast } from '@/contexts/toast-context';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import RouteJourney from "@/components/RouteJourney";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getRouteById, deleteRoute, getAllBuses, getAllDrivers } from "@/lib/dataService";

interface Stop {
  stop_name: string;
  name: string;
  lat?: number;
  lng?: number;
  sequence: number;
}

interface Route {
  id: string;
  routeId: string;
  routeName: string;
  stops: Stop[];
  totalStops: number;
  assignedBuses: string[];
  status: string;
  createdAt: any;
  updatedAt: any;
}

interface Bus {
  id: string;
  busId: string;
  busNumber: string;
  model: string;
  capacity: number;
  color?: string;
  driverUID: string;
  assignedDriverId?: string;
  driverName: string;
  routeId: string;
  routeName: string;
  status: string;
  createdAt: any;
  updatedAt: any;
}

interface Driver {
  id: string;
  name: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  licenseNumber?: string;
  busId?: string;
  routeId?: string;
  employeeId?: string;
  joiningDate?: string;
  createdAt?: string;
}

export default function ViewRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { id } = use(params);
  const [route, setRoute] = useState<Route | null>(null);
  const [buses, setBuses] = useState<Bus[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const routeId = id;

        const [foundRoute, busesData, driversData] = await Promise.all([
          getRouteById(routeId),
          getAllBuses(),
          getAllDrivers()
        ]);

        if (foundRoute) {
          setRoute(foundRoute as Route);
        }

        setBuses(busesData as any);
        setDrivers(driversData as any);
      } catch (error) {
        console.error('Error fetching data:', error);
        addToast('Error fetching route data', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, addToast]);

  // Helper to format ID (bus_1 -> Bus-1)
  const formatId = (id: string) => {
    if (!id) return 'N/A';
    const parts = id.split('_');
    if (parts.length === 2) {
      return `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)}-${parts[1]}`;
    }
    return id;
  };

  // Get the first bus assigned to this route
  const getAssignedBus = () => {
    if (!route) return null;
    const busesForRoute = buses.filter(bus => bus.routeId === route.id || bus.routeId === route.routeId);
    return busesForRoute.length > 0 ? busesForRoute[0] : null;
  };

  // Get driver name from assigned bus
  const getDriverName = () => {
    const bus = getAssignedBus();
    if (!bus) return 'No Driver Assigned';

    const driverId = (bus as any).assignedDriverId || (bus as any).activeDriverId || (bus as any).driverUID;
    const driver = drivers.find(d => d.id === driverId || (d as any).uid === driverId);
    return driver ? ((driver as any).fullName || (driver as any).name || 'N/A') : 'No Driver Assigned';
  };

  const handleEdit = () => {
    router.push(`/admin/routes/edit/${id}`);
  };

  const handleDelete = () => {
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      const routeId = id;
      const success = await deleteRoute(routeId);

      if (success) {
        addToast('Route deleted successfully!', 'success');
        setIsDialogOpen(false);
        router.push("/admin/routes");
      } else {
        addToast('Failed to delete route', 'error');
      }
    } catch (error) {
      console.error('Error deleting route:', error);
      addToast('Failed to delete route', 'error');
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading route details..." subMessage="Fetching checkpoints..." />;
  }

  // Helper function to format Firestore timestamp
  const formatTimestamp = (timestamp: any): string => {
    if (!timestamp) return 'N/A';

    try {
      // Handle Firestore Timestamp object
      if (timestamp.toDate && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }

      // Handle timestamp with seconds property (JSON format)
      if (timestamp.seconds || timestamp._seconds) {
        const seconds = timestamp.seconds || timestamp._seconds;
        const date = new Date(seconds * 1000);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }

      // Handle ISO string or Date object
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }

      return 'N/A';
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return 'N/A';
    }
  };

  if (!route) {
    return (
      <div className="mt-15 min-h-screen flex items-center justify-center bg-[#010717]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Route not found</h1>
          <Link href="/admin/routes" className="text-purple-400 hover:text-purple-300 mt-4 inline-block">
            ← Back to Routes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-7 min-h-screen bg-transparent py-8 w-full overflow-x-hidden">
      {/* Header */}
      <div className="max-w-5xl mx-auto w-full max-w-[92vw] sm:max-w-5xl">
        <div className="flex items-center justify-between mb-8 gap-2">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white mb-1">Route Details</h1>
            <p className="text-gray-400 text-xs hidden md:block">Detailed information about {route.routeName}</p>
          </div>
          <div className="flex items-center space-x-2">
            <Link
              href="/admin/routes"
              className="inline-flex items-center px-3 py-1.5 text-sm bg-white hover:bg-gray-100 text-black font-medium rounded-lg transition-all duration-200 hover:shadow-lg"
            >
              &lt;- Back
            </Link>
            <Button
              onClick={handleEdit}
              className="hidden md:inline-flex bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-lg px-3 py-1.5 h-auto"
            >
              <Edit className="mr-1.5 h-3.5 w-3.5" />
              Edit Route
            </Button>
            <Button
              onClick={handleDelete}
              className="hidden md:inline-flex bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-lg px-3 py-1.5 h-auto"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete Route
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto w-full max-w-[92vw] sm:max-w-5xl">
        <div className="bg-gray-900/50 rounded-2xl shadow-xl border border-gray-700/50 p-6">
          {/* Premium Route Information Dashboard */}
          <div className="mb-8">
            {/* Hero Section */}
            <div className="relative bg-gray-800/60 rounded-xl p-4 border border-gray-700/30 mb-6">

              <div className="relative z-10">
                <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 min-w-0">
                  {/* Route Identity */}
                  <div className="flex items-center space-x-4 w-full sm:w-auto">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg border-2 border-emerald-400/30">
                        <MapPin className="h-6 w-6 text-white" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-blue-500 flex items-center justify-center shadow-md">
                        <Hash className="h-2.5 w-2.5 text-white" />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <h2 className="text-lg md:text-xl font-bold text-white mb-1 truncate">{route.routeName}</h2>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${(route.status?.toLowerCase() === 'active' || !route.status)
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                          : 'bg-red-500/20 text-red-300 border border-red-500/50'
                          }`}>
                          <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${(route.status?.toLowerCase() === 'active' || !route.status) ? 'bg-emerald-400' : 'bg-red-400'
                            }`} />
                          {route.status || 'Active'}
                        </span>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/50">
                          <Hash className="h-3 w-3 mr-1.5" />
                          {route.routeId}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Route Statistics */}
                  <div className="text-center w-full sm:w-auto mt-2 sm:mt-0">
                    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-3 border border-gray-700/50">
                      <h3 className="text-sm font-bold text-white mb-1">Route Statistics</h3>
                      <div className="flex items-center justify-center space-x-4">
                        <div className="text-center">
                          <p className="text-[10px] md:text-xs text-gray-400">Total Stops</p>
                          <p className="text-sm md:text-lg font-bold text-emerald-300">{route.stops?.length || route.totalStops || 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Statistics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              {/* Total Stops Card */}
              <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Stops</p>
                    <p className="text-lg font-bold text-white">{route.stops?.length || (route as any).totalStops || 0}</p>
                    <p className="text-xs text-emerald-300">waypoints</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                    <MapPin className="h-4 w-4 text-emerald-400" />
                  </div>
                </div>
              </div>

              {/* Assigned Buses Card */}
              <div className="bg-purple-500/10 rounded-lg p-3 border border-purple-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Buses</p>
                    <p className="text-lg font-bold text-white">
                      {buses.filter(bus => bus.routeId === route.id || bus.routeId === route.routeId).length}
                    </p>
                    <p className="text-xs text-purple-300">assigned</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
                    <User className="h-4 w-4 text-purple-400" />
                  </div>
                </div>
              </div>

              {/* Driver Assignment Card */}
              <div className="bg-orange-500/10 rounded-lg p-3 border border-orange-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Driver</p>
                    <p className="text-lg font-bold text-white">
                      {getDriverName() !== 'No Driver Assigned' ? 'Assigned' : 'Available'}
                    </p>
                    <p className="text-xs text-orange-300">status</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                    <Activity className="h-4 w-4 text-orange-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Information */}
            <div className="space-y-6">
              {/* Assigned Buses Table */}
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/30">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center">
                  <Activity className="h-4 w-4 mr-2 text-blue-400" />
                  Assigned Buses Details
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-gray-300">
                    <thead className="text-gray-400 uppercase bg-gray-800/40 border-b border-gray-700/50">
                      <tr>
                        <th className="px-3 py-3 whitespace-nowrap md:px-6">Sl. no</th>
                        <th className="px-3 py-3 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">Bus ID</th>
                        <th className="px-3 py-3 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">Bus Number</th>
                        <th className="px-3 py-3 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">Driver assigned</th>
                        <th className="px-3 py-3 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">Created at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/30">
                      {(() => {
                        const busesForRoute = buses.filter(bus => bus.routeId === route.id || bus.routeId === route.routeId);
                        if (busesForRoute.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="px-2 py-8 text-center text-gray-500 italic">
                                No buses assigned to this route
                              </td>
                            </tr>
                          );
                        }
                        return busesForRoute.map((bus: any, index: number) => {
                          const driverId = bus.assignedDriverId || (bus as any).activeDriverId || bus.driverUID;
                          const driverObj = drivers.find((d: any) => d.id === driverId || (d as any).uid === driverId);
                          const driverName = driverObj ? ((driverObj as any).fullName || (driverObj as any).name || 'N/A') : 'No Driver Assigned';

                          return (
                            <tr key={bus.id} className="hover:bg-blue-500/5 transition-colors border-b border-gray-700/20">
                              <td className="px-3 py-4 font-medium whitespace-nowrap md:px-6 text-gray-400">{index + 1}</td>
                              <td className="px-3 py-4 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">{formatId(bus.busId)}</td>
                              <td className="px-3 py-4 whitespace-nowrap md:px-6 md:border-l border-gray-700/30 text-blue-400 font-bold">{bus.busNumber}</td>
                              <td className="px-3 py-4 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">{driverName}</td>
                              <td className="px-3 py-4 whitespace-nowrap md:px-6 md:border-l border-gray-700/30">{formatTimestamp(bus.createdAt)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Route Detailed Information */}
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/30">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center">
                  <MapPin className="h-4 w-4 mr-2 text-green-400" />
                  Route Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 md:gap-0">
                  <div className="flex justify-between md:flex-col md:items-start md:justify-center items-center py-2 md:py-4 border-b md:border-b-0 md:border-r border-gray-700/50 md:border-gray-600/40 md:px-8">
                    <span className="text-xs text-gray-400 md:mb-1.5 uppercase tracking-wider">Route ID</span>
                    <span className="text-sm text-white font-semibold">{formatId(route.routeId)}</span>
                  </div>
                  <div className="flex justify-between md:flex-col md:items-start md:justify-center items-center py-2 md:py-4 border-b md:border-b-0 md:border-r border-gray-700/50 md:border-gray-600/40 md:px-8">
                    <span className="text-xs text-gray-400 md:mb-1.5 uppercase tracking-wider">Total Stops</span>
                    <span className="text-sm text-white font-semibold">{route.stops?.length || (route as any).totalStops || 0}</span>
                  </div>
                  <div className="flex justify-between md:flex-col md:items-start md:justify-center items-center py-2 md:py-4 md:px-8">
                    <span className="text-xs text-gray-400 md:mb-1.5 uppercase tracking-wider">Last Updated</span>
                    <span className="text-sm text-white font-semibold">{formatTimestamp(route.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Route Journey Section */}
          <div className="mt-8 pt-8 border-t border-gray-700">
            <RouteJourney
              stops={route.stops || []}
              routeName={route.routeName}
            />
          </div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Are you sure?</DialogTitle>
            <DialogDescription className="text-gray-400">
              This action cannot be undone. This will permanently delete the route &quot;{route.routeName}&quot; from the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              className="bg-gray-800 hover:bg-gray-700 text-white border border-gray-600"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
