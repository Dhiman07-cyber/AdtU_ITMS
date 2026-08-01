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
import { getAllBuses } from '@/domains/fleet';
import * as routeService from '@/domains/route';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { adminDb } from '@/lib/firebase-admin';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { getSupabaseServer } from '@/lib/supabase-server';
import type { Bus,Route } from '@/lib/types';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

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

  // Single aggregation query for student profile counts using Postgres FILTER
  // This replaces 5 separate count queries - executes as single SQL with FILTER clauses
  const { data: studentAgg } = await supabase.rpc('get_student_profile_counts');

  // Single aggregation query for application counts
  const { data: applicationAgg } = await supabase.rpc('get_application_counts');

  const [
    driversSnap,
    allBusesFromPg,
    routesList,
    feedbackSnap,
    statusSnap,
    paymentsSnap,
    sysSnap,
    deadlineConfig,
  ] = await Promise.all([
    supabase.from('driver_profiles').select('*', { count: 'exact', head: true }),
    getAllBuses(),
    routeService.getAll(),
    adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    supabase.from('active_trips').select('*').eq('status', 'active'),
    supabase.from('payments').select('amount, method').or('status.eq.Completed,status.eq.completed'),
    adminDb.collection('settings').doc('config').get(),
    getDeadlineConfig(),
  ]);

  return {
    totalStudentsCount: studentAgg?.[0]?.total_students || 0,
    activeStudentsCount: studentAgg?.[0]?.active_students || 0,
    morningStudentsCount: studentAgg?.[0]?.morning_students || 0,
    eveningStudentsCount: studentAgg?.[0]?.evening_students || 0,
    expiredStudentsCount: studentAgg?.[0]?.expired_students || 0,
    driversCount: driversSnap.count || 0,
    buses: allBusesFromPg,
    routes: routesList,
    pendingAppsCount: applicationAgg?.[0]?.pending_apps || 0,
    verificationCount: applicationAgg?.[0]?.verification_apps || 0,
    renewalCount: applicationAgg?.[0]?.renewal_apps || 0,
    feedbackCount: (feedbackSnap as any).data ? (feedbackSnap as any).data().count : 0,
    driverStatusData: statusSnap.data || [],
    paymentsData: paymentsSnap.data || [],
    systemConfigDoc: sysSnap,
    deadlineConfig,
  };
}
