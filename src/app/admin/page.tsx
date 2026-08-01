"use client";

import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { useAuth } from '@/contexts/auth-context';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useState } from 'react';

import HighLoadAlert from '@/components/HighLoadAlert';

import DashboardHeader from '@/components/admin/dashboard/DashboardHeader';
import type { DashboardStats } from '@/components/admin/dashboard/types';
import { authApiFetch } from '@/lib/secure-api-client';

const DashboardPanelFallback = () => (
  <div className="min-h-[140px] rounded-xl border border-white/5 bg-white/[0.02] [contain:content]" />
);

const SystemHealthStrip = dynamic(() => import('@/components/admin/dashboard/SystemHealthStrip'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const KeyMetricsGrid = dynamic(() => import('@/components/admin/dashboard/KeyMetricsGrid'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const TransactionalAnalytics = dynamic(() => import('@/components/admin/dashboard/TransactionalAnalytics'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const BusUtilization = dynamic(() => import('@/components/admin/dashboard/BusUtilization'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const RouteOccupancy = dynamic(() => import('@/components/admin/dashboard/RouteOccupancy'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const StudentDistribution = dynamic(() => import('@/components/admin/dashboard/StudentDistribution'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const SystemLifecycleIntelligence = dynamic(() => import('@/components/admin/dashboard/SystemLifecycleIntelligence'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const QuickActions = dynamic(() => import('@/components/admin/dashboard/QuickActions'), {
  ssr: false,
  loading: DashboardPanelFallback,
});
const PlatformAnalytics = dynamic(() => import('@/components/admin/dashboard/PlatformAnalytics'), {
  ssr: false,
  loading: DashboardPanelFallback,
});

// ============================================================================
// DASHBOARD CACHING UTILITIES
// ============================================================================
import { createDashboardCache } from '@/lib/dashboard-cache';

interface AdminDashboardCounts {
    totalStudents: number;
    activeStudents: number;
    expiredStudents: number;
    totalDrivers: number;
    activeDrivers: number;
    totalBuses: number;
    activeBuses: number;
    enrouteBuses: number;
    operationalBuses: number;
    morningStudents: number;
    eveningStudents: number;
    pendingApplications: number;
    pendingVerifications: number;
    renewalRequests: number;
    totalRevenue: number;
    onlinePayments: number;
    offlinePayments: number;
    feedbacksCount: number;
    configDates: {
      academicYearEnd: any;
      softBlock: any;
      hardBlock: any;
      busFee: number;
    };
}

const dashboardCache = createDashboardCache<AdminDashboardCounts>('admin');

function getCachedDashboard() {
  return dashboardCache.getCached();
}

function setCachedDashboard(data: Parameters<typeof dashboardCache.setCached>[0]): void {
  dashboardCache.setCached(data);
}

export default function EnhancedAdminDashboard() {
  const { currentUser, userData, loading: authLoading } = useAuth();

  const router = useRouter();

  // State
  const [dateRange, setDateRange] = useState('today');
  const [shift, setShift] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Initialize from cache if available for instant display
  const cachedData = typeof window !== 'undefined' ? getCachedDashboard() : null;

  const [paymentTrends, setPaymentTrends] = useState<{ days: any[], months: any[] }>(
    cachedData?.paymentTrends || { days: [], months: [] }
  );
  const [trendMode, setTrendMode] = useState<'days' | 'months'>('days');

  // Accurate Counts State - Initialize from cache for instant display
  const [realCounts, setRealCounts] = useState(cachedData?.realCounts || {
    totalStudents: 0,
    activeStudents: 0,
    expiredStudents: 0,
    totalDrivers: 0,
    activeDrivers: 0,
    totalBuses: 0,
    activeBuses: 0,
    enrouteBuses: 0,
    operationalBuses: 0,
    morningStudents: 0,
    eveningStudents: 0,
    pendingApplications: 0,
    pendingVerifications: 0,
    renewalRequests: 0,
    totalRevenue: 0,
    onlinePayments: 0,
    offlinePayments: 0,
    feedbacksCount: 0,
    highLoadBusCount: 0,
    configDates: {
      academicYearEnd: null,
      softBlock: null,
      hardBlock: null,
      busFee: 0
    }
  });

  const [allBuses, setAllBuses] = useState<any[]>([]);
  const [allRoutes, setAllRoutes] = useState<any[]>([]);

  const fetchRealTotalCounts = useCallback(async (modeOverride?: 'days' | 'months') => {
    try {
      if (!currentUser) return;

      // PERF: Fire all API calls in parallel — dashboard-counts replaces 12 Firestore queries
      const [countsRes, resDays, resMonths] = await Promise.all([
        authApiFetch(currentUser, '/api/admin/dashboard-counts'),
        authApiFetch(currentUser, '/api/payment/analytics', { query: { mode: 'days' } }),
        authApiFetch(currentUser, '/api/payment/analytics', { query: { mode: 'months' } }),
      ]);

      const parseJsonSafely = async (res: Response) => {
        try {
          const data = await res.json();
          if (!res.ok) {
            return { success: false, error: data?.error || `HTTP ${res.status}: ${res.statusText}` };
          }
          return data;
        } catch {
          return { success: false, error: res.ok ? 'Failed to parse response' : `HTTP ${res.status}: ${res.statusText}` };
        }
      };

      // Parse all responses in parallel safely
      const [countsData, dataDays, dataMonths] = await Promise.all([
        parseJsonSafely(countsRes),
        parseJsonSafely(resDays),
        parseJsonSafely(resMonths),
      ]);

      if (!countsData?.success || !countsData.data) {
        console.error('Dashboard counts API error:', countsData?.error || 'Failed to load counts');
        return;
      }

      const d = countsData.data;

      // Payment analytics
      let totalRevenue = 0;
      let newTrends = { days: [] as any[], months: [] as any[] };
      if (dataDays?.success && dataDays.data) {
        totalRevenue = dataDays.data.totalRevenue || 0;
        newTrends.days = dataDays.data.trend || [];
      }
      if (dataMonths?.success && dataMonths.data) {
        newTrends.months = dataMonths.data.trend || [];
      }

      setPaymentTrends(newTrends);

      const onlineCount = dataDays?.data?.onlinePayments || 0;
      const offlineCount = dataDays?.data?.offlinePayments || 0;

      // Set buses and routes from server response (eliminates duplicate getDocs)
      setAllBuses(d.allBuses || []);
      setAllRoutes(d.allRoutes || []);
      setActiveTrips(d.activeTrips || []);

      const newRealCounts = {
        totalStudents: d.totalStudents,
        activeStudents: d.activeStudents,
        expiredStudents: d.expiredStudents,
        totalDrivers: d.totalDrivers,
        activeDrivers: d.activeDrivers,
        totalBuses: d.totalBuses,
        activeBuses: d.activeBuses,
        enrouteBuses: d.enrouteBuses,
        operationalBuses: d.operationalBuses,
        morningStudents: d.morningStudents,
        eveningStudents: d.eveningStudents,
        pendingApplications: d.pendingApplications,
        pendingVerifications: d.pendingVerifications,
        renewalRequests: d.renewalRequests,
        totalRevenue: d.totalRevenue || totalRevenue,
        onlinePayments: d.onlinePayments || onlineCount,
        offlinePayments: d.offlinePayments || offlineCount,
        feedbacksCount: d.feedbacksCount,
        highLoadBusCount: d.highLoadBusCount,
        configDates: d.configDates,
      };

      setRealCounts(newRealCounts);

      // Cache for instant loading on next visit
      setCachedDashboard({
        realCounts: newRealCounts,
        paymentTrends: newTrends,
      });

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  }, [currentUser]);

  useEffect(() => {
    // Fetch both modes on mount
    fetchRealTotalCounts();
  }, [fetchRealTotalCounts]);

  const allDataLoading = authLoading;

  const [stats, setStats] = useState({
    totalStudents: 0,
    activeStudents: 0,
    expiringStudents: 0,
    expiredStudents: 0,
    totalDrivers: 0,
    activeDrivers: 0,
    totalBuses: 0,
    activeBuses: 0,
    enrouteBuses: 0,
    operationalBuses: 0,
    totalRoutes: 0,
    totalNotifications: 0,
    unreadNotifications: 0,
    pendingVerifications: 0,
    pendingApplications: 0,
    approvedToday: 0,
    rejectedToday: 0,
    morningStudents: 0,
    eveningStudents: 0,
    totalRevenue: 0,
    onlinePayments: 0,
    offlinePayments: 0,
    academicYearEnd: null as any,
    softBlock: null as any,
    hardBlock: null as any,
    systemBusFee: 0,
    feedbacksCount: 0
  });

  // Manual refresh handler
  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await fetchRealTotalCounts();
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error refreshing dashboard:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const [busUtilization, setBusUtilization] = useState<any[]>([]);
  const [studentDistribution, setStudentDistribution] = useState<any[]>([]);
  const [routeOccupancy, setRouteOccupancy] = useState<any[]>([]);
  const [activeTrips, setActiveTrips] = useState<any[]>([]);


  // Memoized calculation functions
  const calculateStats = useCallback(() => {
    setStats({
      totalStudents: realCounts.totalStudents,
      activeStudents: realCounts.activeStudents,
      expiringStudents: 0,
      expiredStudents: realCounts.expiredStudents || 0,
      totalDrivers: realCounts.totalDrivers,
      activeDrivers: realCounts.activeDrivers || 0,
      totalBuses: realCounts.totalBuses,
      activeBuses: realCounts.enrouteBuses, // Repurposed for trips
      enrouteBuses: realCounts.enrouteBuses,
      operationalBuses: realCounts.operationalBuses,
      totalRoutes: allRoutes.length,
      totalNotifications: 0,
      unreadNotifications: 0,
      pendingVerifications: realCounts.renewalRequests, // Showing Renewal Requests as "Pending Verification" as requested
      pendingApplications: realCounts.pendingApplications,
      approvedToday: 0,
      rejectedToday: 0,
      morningStudents: realCounts.morningStudents,
      eveningStudents: realCounts.eveningStudents,
      totalRevenue: realCounts.totalRevenue,
      onlinePayments: realCounts.onlinePayments,
      offlinePayments: realCounts.offlinePayments,
      academicYearEnd: realCounts.configDates.academicYearEnd,
      softBlock: realCounts.configDates.softBlock,
      hardBlock: realCounts.configDates.hardBlock,
      systemBusFee: realCounts.configDates.busFee,
      feedbacksCount: realCounts.feedbacksCount
    });
  }, [realCounts, allRoutes.length]);

  // Memoized calculation functions
  const calculateCharts = useCallback(() => {
    // Bus utilization with enhanced data and sorting
    const busesToUse = allBuses;
    const busUtilData = busesToUse.map((bus: any) => {
      const currentMembers = bus.currentMembers || 0;
      let capacity = 55; // Default

      if (bus.totalCapacity) {
        capacity = bus.totalCapacity;
      } else if (bus.capacity) {
        if (typeof bus.capacity === 'string' && bus.capacity.includes('/')) {
          capacity = parseInt(bus.capacity.split('/')[1]) || 55;
        } else if (typeof bus.capacity === 'number') {
          capacity = bus.capacity;
        }
      }

      const utilization = capacity > 0 ? (currentMembers / capacity) * 100 : 0;
      const load = bus.load || {};
      const morningCount = Number(bus.morningLoad ?? bus.morning_load ?? load.morningCount ?? load.morning_count ?? 0);
      const eveningCount = Number(bus.eveningLoad ?? bus.evening_load ?? load.eveningCount ?? load.evening_count ?? 0);

      return {
        name: `Bus ${extractNumber(bus.busId || bus.id)}`,
        students: currentMembers,
        capacity,
        utilization: Math.round(utilization),
        morningCount,
        eveningCount
      };
    }).sort((a, b) => {
      const aNum = parseInt(a.name.replace(/\D/g, '')) || 0;
      const bNum = parseInt(b.name.replace(/\D/g, '')) || 0;
      return aNum - bNum;
    });
    setBusUtilization(busUtilData);

    // Student distribution by shift
    const morningCount = realCounts.morningStudents;
    const eveningCount = realCounts.eveningStudents;

    setStudentDistribution([
      { name: 'Evening', value: eveningCount || 0, color: '#3b82f6' }, // Blue
      { name: 'Morning', value: morningCount || 0, color: '#f97316' }  // Orange
    ]);

    // Route occupancy data - sorted by occupancy rate (highest first)
    const routesToUse = allRoutes;

    const routeOccupancyData = routesToUse.map((route: any) => {
      const routeBuses = allBuses.filter((b: any) => b.routeId === route.routeId || b.route?.routeId === route.routeId);

      if (routeBuses.length === 0) {
        return {
          name: route.routeName,
          occupancy: 0,
          students: 0,
          capacity: 0
        };
      }

      let totalCapacity = 0;
      let totalCurrentLoad = 0;

      routeBuses.forEach((bus: any) => {
        let capacity = 50; // Default
        if (bus.capacity) {
          if (typeof bus.capacity === 'string' && bus.capacity.includes('/')) {
            capacity = parseInt(bus.capacity.split('/')[1]) || 50;
          } else if (typeof bus.capacity === 'number') {
            capacity = bus.capacity;
          } else if (bus.totalCapacity) {
            capacity = bus.totalCapacity;
          }
        }

        totalCapacity += capacity;
        totalCurrentLoad += bus.currentMembers || 0;
      });

      const occupancy = totalCapacity > 0 ? Math.min(Math.round((totalCurrentLoad / totalCapacity) * 100), 100) : 0;

      return {
        name: route.routeName,
        occupancy,
        students: totalCurrentLoad,
        capacity: totalCapacity
      };
    })
      .filter(r => r.capacity > 0)
      .sort((a, b) => b.occupancy - a.occupancy)
      .slice(0, 8);
    setRouteOccupancy(routeOccupancyData);

  }, [allBuses, allRoutes, realCounts]);

  // Helper function for extracting numbers from strings
  const extractNumber = (str: string): string => {
    const match = str?.match(/\d+/);
    return match ? match[0] : '?';
  };

  // Calculate stats when data changes
  useEffect(() => {
    calculateStats();
    calculateCharts();
  }, [calculateStats, calculateCharts]);

  // Update timestamp when data changes
  useEffect(() => {
    if (!allDataLoading) {
      setLastUpdated(new Date());
    }
  }, [allDataLoading]);


  if (allDataLoading && realCounts.totalStudents === 0 && realCounts.totalBuses === 0) {
    return <PremiumPageLoader fullScreen message="Curating Dashboard Experience..." subMessage="Fetching system status and analytics..." />;
  }

  // Get first name from user data
  const getFirstName = () => {
    if (!userData) return 'Admin';
    const fullName = (userData as any).fullName || (userData as any).name || userData.email || '';
    return fullName.split(' ')[0] || 'Admin';
  };

  // Handle KPI card clicks
  const handleKpiClick = (path: string) => {
    router.push(path);
  };

  return (
    <div className="flex-1 bg-[#05060e] min-h-screen relative overflow-hidden">
      <div className="px-6 md:px-12 pt-17 md:pt-17 pb-20 relative z-10 max-w-screen-2xl mx-auto space-y-4">
        {/* HEADER AREA */}
        <DashboardHeader
          firstName={getFirstName()}
          lastUpdated={lastUpdated}
          isRefreshing={isRefreshing}
          onRefresh={handleRefreshAll}
          stats={stats as any as DashboardStats}
        />

        {/* SECTION 1: SYSTEM HEALTH STRIP */}
        <div className="w-full">
          <SystemHealthStrip stats={stats as any as DashboardStats} />
        </div>

        {/* SECTION: CRITICAL ALERT (Preserving unchanged) */}
        <div className="mb-2">
          <HighLoadAlert role="admin" className="animate-in fade-in duration-300 h-auto" />
        </div>



        {/* SECTION 2.1: PLATFORM ANALYTICS (GA4 INTEGRATION) */}
        <div className="w-full animate-in fade-in duration-300">
          <PlatformAnalytics />
        </div>

        {/* SECTION 3: KEY METRICS BLOCKS */}
        <KeyMetricsGrid stats={stats as any as DashboardStats} />

        {/* SECTION 4: TRANSACTIONAL ANALYTICS */}
        <TransactionalAnalytics paymentTrends={paymentTrends as any} />

        {/* ROW: BUS & ROUTE DYNAMICS */}
        <div className="grid grid-cols-1 gap-12">
          {/* SECTION 5: BUS UTILIZATION */}
          <BusUtilization busUtilization={busUtilization} />

          {/* SECTION 6: ROUTE OCCUPANCY */}
          <RouteOccupancy routeOccupancy={routeOccupancy} busUtilization={busUtilization} />
        </div>

        {/* ROW: DISTRIBUTION & STAFFING */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* SECTION 7: STUDENT DISTRIBUTION */}
          <StudentDistribution
            distribution={studentDistribution}
            totalStudents={stats.activeStudents}
          />

          {/* SECTION 8: SYSTEM LIFECYCLE INTELLIGENCE */}
          <SystemLifecycleIntelligence stats={stats as any as DashboardStats} />
        </div>

        {/* SECTION 10: QUICK ACTIONS */}
        <QuickActions />
      </div>
    </div>
  );
}
