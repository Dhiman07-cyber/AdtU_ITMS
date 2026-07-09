import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/analytics.repository', () => {
  const mockBusesSnapshot = {
    size: 5,
    forEach: (cb: any) => cb({ data: () => ({ currentMembers: 20, totalCapacity: 55, status: 'active' }), id: 'b1' }),
    docs: [{ data: () => ({ currentMembers: 20, totalCapacity: 55, status: 'active' }), id: 'b1' }],
  };
  const mockRoutes = [
    { routeName: 'Route A', id: 'r1', routeId: 'r1', stops: [] }
  ];
  return {
    fetchGA4RawData: vi.fn().mockResolvedValue({
      rows: [
        { dimensionValues: [{ value: '20260101' }], metricValues: [{ value: '10' }, { value: '15' }, { value: '0.5' }] },
      ],
      configured: true,
    }),
    fetchPaymentStatsRaw: vi.fn().mockResolvedValue({ totalRevenue: 1000, completedPayments: 5, pendingPayments: 2 }),
    fetchPaymentMethodTrend: vi.fn().mockResolvedValue([]),
    fetchPaymentTrend: vi.fn().mockResolvedValue([]),
    fetchCompletedPaymentsForYear: vi.fn().mockResolvedValue([]),
    fetchDashboardRawData: vi.fn().mockResolvedValue({
      totalStudentsCount: 100,
      activeStudentsCount: 80,
      morningStudentsCount: 40,
      eveningStudentsCount: 40,
      expiredStudentsCount: 0,
      driversCount: 10,
      busesSnapshot: mockBusesSnapshot,
      routes: mockRoutes,
      pendingAppsCount: 3,
      verificationCount: 1,
      renewalCount: 2,
      feedbackCount: 0,
      driverStatusData: [],
      paymentsData: [],
      systemConfigDoc: { exists: false, data: () => null },
      deadlineConfig: { academicYear: { anchorMonth: 0, anchorDay: 1 }, softBlock: { month: 0, day: 1 }, hardDelete: { month: 0, day: 1 } },
    }),
  };
});

import {
  getPlatformAnalytics,
  getPaymentAnalytics,
  getPaymentStats,
  getDashboardCounts,
} from '../services/analytics.service';

describe('AnalyticsService', () => {
  it('delegates platform analytics to the repository and computes totals', async () => {
    const result = await getPlatformAnalytics();
    expect(result.totalActiveUsers).toBe(10);
    expect(result.totalSessions).toBe(15);
    expect(result.chartData).toHaveLength(1);
  });

  it('delegates payment analytics to the repository unchanged', async () => {
    const result = await getPaymentAnalytics('days');
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('methodTrend');
  });

  it('delegates payment stats and computes monthly aggregation', async () => {
    const result = await getPaymentStats();
    expect(result.totalRevenue).toBe(1000);
    expect(result.monthlyData).toHaveLength(12);
  });

  it('delegates dashboard counts to the repository and computes derived metrics', async () => {
    const result = await getDashboardCounts();
    expect(result.totalStudents).toBe(100);
    expect(result.activeStudents).toBe(80);
  });
});
