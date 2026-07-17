/**
 * D13 Analytics Repository
 *
 * Persistence only — no business logic. Returns raw data from underlying
 * data sources. All aggregation, formatting, and computation belongs in
 * the service layer.
 *
 * ponytail: wraps GA4 client, Supabase payment service, and Firestore/PG
 * count queries — returns raw responses without transformation.
 */
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import * as routeService from '@/domains/route';
import { getAllBuses } from '@/domains/fleet';
import type { Route, Bus } from '@/lib/types';

const formatPrivateKey = (key?: string) => {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n').replace(/"/g, '');
};

export interface GA4RawResponse {
  rows: any[] | null;
  configured: boolean;
}

export async function fetchGA4RawData(): Promise<GA4RawResponse> {
  const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GA_CLIENT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GA_PRIVATE_KEY);
  const projectId = process.env.GA_PROJECT_ID;

  if (!PROPERTY_ID || !clientEmail || !privateKey || !projectId) {
    return { rows: null, configured: false };
  }

  const analyticsDataClient = new BetaAnalyticsDataClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });

  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'engagementRate' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
  });

  return { rows: response.rows || null, configured: true };
}

export async function fetchPaymentStatsRaw() {
  return paymentsSupabaseService.getPaymentStats();
}

export async function fetchPaymentMethodTrend() {
  return paymentsSupabaseService.getPaymentMethodTrend();
}

export async function fetchPaymentTrend(mode: 'days' | 'months') {
  return mode === 'months'
    ? paymentsSupabaseService.getPaymentTrendMonthly()
    : paymentsSupabaseService.getPaymentTrend();
}

export async function fetchCompletedPaymentsForYear() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  return paymentsSupabaseService.getCompletedPaymentsForReporting(startOfYear, endOfYear);
}

export interface DashboardRawData {
  totalStudentsCount: number;
  activeStudentsCount: number;
  morningStudentsCount: number;
  eveningStudentsCount: number;
  expiredStudentsCount: number;
  driversCount: number;
  buses: Bus[];
  routes: Route[];
  pendingAppsCount: number;
  verificationCount: number;
  renewalCount: number;
  feedbackCount: number;
  driverStatusData: any[];
  paymentsData: any[];
  systemConfigDoc: FirebaseFirestore.DocumentSnapshot;
  deadlineConfig: any;
}

export async function fetchDashboardRawData(): Promise<DashboardRawData> {
  if (!adminDb) {
    throw new Error('Firebase Admin not initialized');
  }

  const supabase = getSupabaseServer();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    totalStudentsSnap,
    activeStudentsSnap,
    morningStudentsSnap,
    eveningStudentsSnap,
    expiredStudentsSnap,
    driversSnap,
    allBusesFromPg,
    routesList,
    pendingAppsSnap,
    verificationSnap,
    renewalSnap,
    feedbackSnap,
    statusSnap,
    paymentsSnap,
    sysSnap,
    deadlineConfig,
  ] = await Promise.all([
    supabase.from('student_profiles').select('*', { count: 'exact', head: true }),
    supabase.from('student_profiles').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('student_profiles').select('*', { count: 'exact', head: true }).eq('status', 'active').eq('shift', 'Morning'),
    supabase.from('student_profiles').select('*', { count: 'exact', head: true }).eq('status', 'active').eq('shift', 'Evening'),
    supabase.from('student_profiles').select('*', { count: 'exact', head: true }).eq('status', 'expired'),
    supabase.from('driver_profiles').select('*', { count: 'exact', head: true }),
    getAllBuses(),
    routeService.getAll(),
    supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'submitted'),
    supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'awaiting_verification'),
    supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'submitted').in('application_type', ['renewal', 'renewal_after_soft_block']),
    adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    supabase.from('driver_status').select('*').in('status', ['enroute', 'on_trip']),
    supabase.from('payments').select('amount, method').or('status.eq.Completed,status.eq.completed'),
    adminDb.collection('settings').doc('config').get(),
    getDeadlineConfig(),
  ]);

  return {
    totalStudentsCount: totalStudentsSnap.count || 0,
    activeStudentsCount: activeStudentsSnap.count || 0,
    morningStudentsCount: morningStudentsSnap.count || 0,
    eveningStudentsCount: eveningStudentsSnap.count || 0,
    expiredStudentsCount: expiredStudentsSnap.count || 0,
    driversCount: driversSnap.count || 0,
    buses: allBusesFromPg,
    routes: routesList,
    pendingAppsCount: pendingAppsSnap.count || 0,
    verificationCount: verificationSnap.count || 0,
    renewalCount: renewalSnap.count || 0,
    feedbackCount: (feedbackSnap as any).data ? (feedbackSnap as any).data().count : 0,
    driverStatusData: statusSnap.data || [],
    paymentsData: paymentsSnap.data || [],
    systemConfigDoc: sysSnap,
    deadlineConfig,
  };
}
