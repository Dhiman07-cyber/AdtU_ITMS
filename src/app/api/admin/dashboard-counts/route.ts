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

      // ── 1. Fire ALL distributed queries in parallel (PG RPCs + Firestore + Supabase) ──
      const [
        studentAggRes,
        applicationAggRes,
        driversSnap,
        allBusesFromPg,
        routesList,
        feedbackSnap,
        statusSnap,
        paymentsSnap,
        systemConfigResult,
        deadlineConfig
      ] = await Promise.all([
        safeQuery<any>(supabase.rpc('get_student_profile_counts'), { data: null, error: null }),
        safeQuery<any>(supabase.rpc('get_application_counts'), { data: null, error: null }),
        safeQuery(supabase.from('driver_profiles').select('*', { count: 'exact', head: true }), fallbackCount),
        safeQuery(getAllBuses(), []),
        safeQuery(routeService.getAll(), []),
        adminDb ? safeQuery(adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get().then(snap => ({ data: () => ({ count: snap.data().count }) })), { data: () => ({ count: 0 }) }) : Promise.resolve({ data: () => ({ count: 0 }) }),
        safeQuery(supabase.from('active_trips').select('trip_id, bus_id, route_id, driver_id, start_time').eq('status', 'active'), fallbackList),
        safeQuery(supabase.from('payments').select('amount, payment_method, method'), fallbackList),
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

      // ── 3. Process Students & Applications (PostgreSQL RPC counts) ──
      const studentAgg = (studentAggRes?.data as any)?.[0];
      const totalStudents = Number(studentAgg?.total_students || 0);
      const activeStudents = Number(studentAgg?.active_students || 0);
      const morningStudents = Number(studentAgg?.morning_students || 0);
      const eveningStudents = Number(studentAgg?.evening_students || 0);
      const expiredStudents = Number(studentAgg?.expired_students || 0);

      const appAgg = (applicationAggRes?.data as any)?.[0];
      const pendingApplications = Number(appAgg?.pending_apps || 0);
      const pendingVerifications = Number(appAgg?.verification_apps || 0);
      const renewalRequests = Number(appAgg?.renewal_apps || 0);


      // ── 4. Process Active Trips (Supabase active_trips) ──
      const activeTripData = (statusSnap.data || []).map((trip: any) => {
        const bus = allBuses.find(b => b.id === trip.bus_id || b.busId === trip.bus_id || b.bus_number === trip.bus_id);
        const route = allRoutes.find((r: any) => r.id === trip.route_id || r.routeId === trip.route_id);
        return {
          id: trip.trip_id || trip.id,
          busId: bus?.bus_number || trip.bus_id || '?',
          routeName: route?.route_name || route?.routeName || 'Tracking...',
          driverUid: trip.driver_id,
          startTime: trip.start_time || new Date().toISOString(),
          studentCount: bus?.currentMembers || 0,
          status: 'In Motion',
        };
      });

      // ── 5. Process Payments (Supabase payments ledger) ──
      let onlinePayments = 0, offlinePayments = 0, totalRevenue = 0;
      (paymentsSnap.data || []).forEach((p: any) => {
        const method = (p.payment_method || p.method || p.source || '').toLowerCase().trim();
        if (method === 'online' || method === 'razorpay') onlinePayments++;
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
        pendingApplications,
        pendingVerifications,
        renewalRequests,
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
