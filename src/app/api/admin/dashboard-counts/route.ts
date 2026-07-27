import { getSystemConfig } from '@/domains/admin';
import { getAllBuses } from '@/domains/fleet';
import * as routeService from '@/domains/route';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * GET /api/admin/dashboard-counts
 * 
 * Optimized:
 * - Parallelized fetching across PostgreSQL and Firestore.
 * - Single pass processing of collection snapshots.
 * - Robust error handling with safe fallbacks per query.
 */

export const dynamic = 'force-dynamic';

export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const supabase = getSupabaseServer();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const safeQuery = <T>(promise: PromiseLike<T>, fallback: T): Promise<T> =>
        Promise.resolve(promise).then(
          (res: any) => (res && res.error ? fallback : res),
          () => fallback
        );

      const fallbackCount = { count: 0, data: null, error: null };
      const fallbackList = { data: [], count: 0, error: null };

      // ── 1. Fire ALL distributed queries in parallel (PG + Firestore + Supabase) ──
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
        systemConfigResult,
        deadlineConfig
      ] = await Promise.all([
        safeQuery(supabase.from('student_profiles').select('*', { count: 'exact', head: true }), fallbackCount),
        safeQuery(supabase.from('student_profiles').select('*', { count: 'exact', head: true }).eq('status', 'active'), fallbackCount),
        safeQuery(supabase.from('student_profiles').select('*', { count: 'exact', head: true }).ilike('shift', 'Morning'), fallbackCount),
        safeQuery(supabase.from('student_profiles').select('*', { count: 'exact', head: true }).ilike('shift', 'Evening'), fallbackCount),
        safeQuery(supabase.from('student_profiles').select('*', { count: 'exact', head: true }).eq('status', 'expired'), fallbackCount),
        safeQuery(supabase.from('driver_profiles').select('*', { count: 'exact', head: true }), fallbackCount),
        safeQuery(getAllBuses(), []),
        safeQuery(routeService.getAll(), []),
        safeQuery(supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'submitted'), fallbackCount),
        safeQuery(supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'awaiting_verification'), fallbackCount),
        safeQuery(supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'submitted').in('application_type', ['renewal', 'renewal_after_soft_block']), fallbackCount),
        adminDb ? safeQuery(adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get().then(snap => ({ data: () => ({ count: snap.data().count }) })), { data: () => ({ count: 0 }) }) : Promise.resolve({ data: () => ({ count: 0 }) }),
        safeQuery(supabase.from('driver_profiles').select('uid, bus_id, route_id, full_name, trip_active, active_trip_id').eq('trip_active', true), fallbackList),
        safeQuery(supabase.from('payments').select('amount, source'), fallbackList),
        safeQuery(getSystemConfig(), null),
        safeQuery<any>(getDeadlineConfig(), null)
      ]);

      // ── 2. Process Routes & Buses (from PG) ──
      const allRoutes = routesList || [];
      const allBuses: any[] = [];
      let operationalBuses = 0;
      let highLoadBusCount = 0;
      let activeDrivers = 0;

      const busesArray = Array.isArray(allBusesFromPg) ? allBusesFromPg : [];
      for (const bus of busesArray) {
        if (bus.driverUID || (bus as any).assignedDriverId || (bus as any).activeDriverId) {
          activeDrivers++;
        }
        const currentMembers = bus.currentMembers || 0;
        const capacity = bus.capacity || 55;
        const usagePct = capacity > 0 ? Math.round((currentMembers / capacity) * 100) : 0;
        if (!['inactive', 'under-maintenance', 'maintenance'].includes((bus.status || '').toLowerCase())) operationalBuses++;
        if (usagePct >= 80) highLoadBusCount++;

        allBuses.push({ ...bus, currentMembers, totalCapacity: capacity, usagePct });
      }

      // ── 3. Process Students (PostgreSQL counts) ──
      const totalStudents = totalStudentsSnap.count || 0;
      const activeStudents = activeStudentsSnap.count || 0;
      const morningStudents = morningStudentsSnap.count || 0;
      const eveningStudents = eveningStudentsSnap.count || 0;
      const expiredStudents = expiredStudentsSnap.count || 0;

      // ── 4. Process Active Trips (Supabase) ──
      const activeTripData = (statusSnap.data || []).map((driver: any) => {
        const bus = allBuses.find(b => b.id === driver.bus_id || b.busId === driver.bus_id);
        const route = allRoutes.find((r: any) => r.id === driver.route_id || r.routeId === driver.route_id);
        return {
          id: driver.active_trip_id || driver.uid,
          busId: bus?.bus_number || driver.bus_id || '?',
          routeName: route?.route_name || route?.routeName || 'Tracking...',
          driverUid: driver.uid,
          startTime: new Date().toISOString(),
          studentCount: bus?.currentMembers || 0,
          status: 'In Motion',
        };
      });

      // ── 5. Process Payments (Supabase processed_payments) ──
      let onlinePayments = 0, offlinePayments = 0, totalRevenue = 0;
      (paymentsSnap.data || []).forEach((p: any) => {
        const source = (p.source || p.method || '').toLowerCase().trim();
        if (source === 'online' || source === 'razorpay') onlinePayments++;
        else offlinePayments++;
        totalRevenue += Number(p.amount || 0);
      });

      // ── 6. Config Dates ──
      const configDates = {
        academicYearEnd: deadlineConfig?.academicYear
          ? `${new Date().getFullYear()}-${String((deadlineConfig.academicYear.anchorMonth ?? 5) + 1).padStart(2, '0')}-${String(deadlineConfig.academicYear.anchorDay ?? 30).padStart(2, '0')}`
          : `${new Date().getFullYear()}-06-30`,
        softBlock: deadlineConfig?.softBlock
          ? `${new Date().getFullYear()}-${String((deadlineConfig.softBlock.month ?? 6) + 1).padStart(2, '0')}-${String(deadlineConfig.softBlock.day ?? 15).padStart(2, '0')}`
          : `${new Date().getFullYear()}-07-15`,
        hardBlock: deadlineConfig?.hardDelete
          ? `${new Date().getFullYear()}-${String((deadlineConfig.hardDelete.month ?? 7) + 1).padStart(2, '0')}-${String(deadlineConfig.hardDelete.day ?? 1).padStart(2, '0')}`
          : `${new Date().getFullYear()}-08-01`,
        busFee: Number(systemConfigResult?.data?.busFee?.amount || 0)
      };

      const payload = {
        totalStudents, activeStudents, morningStudents, eveningStudents, expiredStudents,
        totalDrivers: driversSnap.count || 0, activeDrivers, totalBuses: busesArray.length,
        operationalBuses, activeBuses: statusSnap.data?.length || 0,
        enrouteBuses: statusSnap.data?.length || 0,
        pendingApplications: pendingAppsSnap.count || 0,
        pendingVerifications: verificationSnap.count || 0,
        renewalRequests: renewalSnap.count || 0,
        feedbacksCount: feedbackSnap.data ? feedbackSnap.data().count : 0,
        highLoadBusCount, totalRevenue, onlinePayments, offlinePayments,
        configDates, allBuses, allRoutes, activeTrips: activeTripData,
      };

      return NextResponse.json({ success: true, data: payload, requestId });
    } catch (error: any) {
      console.error(`[${requestId}] dashboard-counts error:`, error?.message);
      return NextResponse.json({ success: false, error: 'Failed to aggregate dashboard data', requestId }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.ADMIN,
  }
);
