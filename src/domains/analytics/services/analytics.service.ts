/**
 * D13 AnalyticsService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: platform analytics (GA4), payment analytics,
 * dashboard aggregation, operational statistics. ALL computation,
 * aggregation, and formatting lives here — never in the repository.
 *
 * ponytail: delegates data retrieval to analyticsRepository (raw data only),
 * performs all business computation internally — zero behavior change.
 */
import * as analyticsRepository from '../repositories/analytics.repository';
import { listActiveAssignments } from '@/domains/fleet/repositories/driver-assignment.repository';

export async function getPlatformAnalytics() {
  const raw = await analyticsRepository.fetchGA4RawData();

  if (!raw.configured || !raw.rows || raw.rows.length === 0) {
    return { chartData: [], totalActiveUsers: 0, totalSessions: 0, engagementRate: '0%' };
  }

  const chartData = raw.rows.map((row) => {
    const dateStr = row.dimensionValues[0].value;
    const date = new Date(
      parseInt(dateStr.substring(0, 4)),
      parseInt(dateStr.substring(4, 6)) - 1,
      parseInt(dateStr.substring(6, 8)),
    );
    return {
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      users: parseInt(row.metricValues[0].value, 10),
      sessions: parseInt(row.metricValues[1].value, 10),
    };
  });

  const totalActiveUsers = chartData.reduce((sum, day) => sum + day.users, 0);
  const totalSessions = chartData.reduce((sum, day) => sum + day.sessions, 0);
  const totalEngage = raw.rows.reduce((s, r) => s + parseFloat(r.metricValues[2].value), 0);
  const engagementRate = ((totalEngage / raw.rows.length) * 100).toFixed(1) + '%';

  return { chartData, totalActiveUsers, totalSessions, engagementRate };
}

export async function getPaymentAnalytics(mode: 'days' | 'months' = 'days') {
  const [stats, methodTrend, trend] = await Promise.all([
    analyticsRepository.fetchPaymentStatsRaw(),
    analyticsRepository.fetchPaymentMethodTrend(),
    analyticsRepository.fetchPaymentTrend(mode),
  ]);
  return { ...stats, trend, methodTrend };
}

export async function getPaymentStats() {
  const [stats, yearPayments] = await Promise.all([
    analyticsRepository.fetchPaymentStatsRaw(),
    analyticsRepository.fetchCompletedPaymentsForYear(),
  ]);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyData = months.map((m, i) => {
    const monthTotal = yearPayments.reduce((sum, p) => {
      const date = p.transaction_date ? new Date(p.transaction_date) :
        (p.created_at ? new Date(p.created_at) : new Date());
      return (date.getMonth() === i) ? sum + (p.amount || 0) : sum;
    }, 0);
    return { name: m, amount: monthTotal };
  });

  return {
    totalRevenue: stats.totalRevenue,
    completedCount: stats.completedPayments,
    pendingCount: stats.pendingPayments,
    monthlyData,
  };
}

export async function getDashboardCounts() {
  const raw = await analyticsRepository.fetchDashboardRawData();

  const allRoutes = raw.routes.map(route => ({
    ...route,
    id: route.id || route.routeId,
    routeId: route.routeId || route.id
  } as any));
  const allBuses: any[] = [];
  let operationalBuses = 0;
  let highLoadBusCount = 0;
  let activeDrivers = 0;

  const activeAssignments = await listActiveAssignments();
  activeDrivers = activeAssignments.length;

  for (const bus of raw.buses) {
    const currentMembers = bus.currentMembers || 0;
    const capacity = bus.capacity || 55;
    const usagePct = capacity > 0 ? Math.round((currentMembers / capacity) * 100) : 0;
    if (!['inactive', 'under-maintenance', 'maintenance'].includes((bus.status || '').toLowerCase())) operationalBuses++;
    if (usagePct >= 80) highLoadBusCount++;
    allBuses.push({ ...bus, currentMembers, totalCapacity: capacity, usagePct });
  }

  const activeTripData = raw.driverStatusData.map((status: any) => {
    const bus = allBuses.find(b => b.busId === status.bus_id);
    const route = allRoutes.find(r => r.routeId === status.route_id);
    return {
      id: status.id, busId: bus?.busNumber || status.bus_id || '?',
      routeName: route?.routeName || 'Tracking...', driverUid: status.driver_uid,
      startTime: status.started_at || new Date().toISOString(),
      studentCount: bus?.currentMembers || 0, status: 'In Motion',
    };
  });

  let onlinePayments = 0, offlinePayments = 0, totalRevenue = 0;
  raw.paymentsData.forEach((p: any) => {
    const method = (p.method || '').toLowerCase().trim();
    if (method === 'online') onlinePayments++;
    else offlinePayments++;
    totalRevenue += Number(p.amount || 0);
  });

  const systemData = raw.systemConfigDoc.exists ? raw.systemConfigDoc.data() : null;
  const dc = raw.deadlineConfig;
  const configDates = {
    academicYearEnd: `${new Date().getFullYear()}-${String(dc.academicYear.anchorMonth + 1).padStart(2, '0')}-${String(dc.academicYear.anchorDay).padStart(2, '0')}`,
    softBlock: `${new Date().getFullYear()}-${String(dc.softBlock.month + 1).padStart(2, '0')}-${String(dc.softBlock.day).padStart(2, '0')}`,
    hardBlock: `${new Date().getFullYear()}-${String(dc.hardDelete.month + 1).padStart(2, '0')}-${String(dc.hardDelete.day).padStart(2, '0')}`,
    busFee: Number(systemData?.busFee?.amount || systemData?.busFee || systemData?.amount || 0),
  };

  return {
    totalStudents: raw.totalStudentsCount,
    activeStudents: raw.activeStudentsCount,
    morningStudents: raw.morningStudentsCount,
    eveningStudents: raw.eveningStudentsCount,
    expiredStudents: raw.expiredStudentsCount,
    totalDrivers: raw.driversCount,
    activeDrivers,
    totalBuses: raw.buses.length,
    operationalBuses,
    activeBuses: raw.driverStatusData.length,
    enrouteBuses: raw.driverStatusData.length,
    pendingApplications: raw.pendingAppsCount,
    pendingVerifications: raw.verificationCount,
    renewalRequests: raw.renewalCount,
    feedbacksCount: raw.feedbackCount,
    highLoadBusCount,
    totalRevenue,
    onlinePayments,
    offlinePayments,
    configDates,
    allBuses,
    allRoutes,
    activeTrips: activeTripData,
  };
}
