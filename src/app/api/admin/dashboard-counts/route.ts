import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { getSystemConfig } from '@/domains/admin';
import { getAllBuses } from '@/domains/fleet';
import * as routeService from '@/domains/route';

/**
 * GET /api/admin/dashboard-counts
 * 
 * Optimized:
 * - Parallelized fetching across PostgreSQL and Firestore.
 * - Single pass processing of collection snapshots.
 * - Robust error handling with partial data fallback.
 */

export const dynamic = 'force-dynamic';

export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    try {
      const supabase = getSupabaseServer();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

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
        adminDb ? adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get().catch(() => ({ data: () => ({ count: 0 }) })) : Promise.resolve({ data: () => ({ count: 0 }) }),
        supabase.from('driver_status').select('*').in('status', ['enroute', 'on_trip']),
        supabase.from('payments').select('amount, method').or('status.eq.Completed,status.eq.completed'),
        getSystemConfig().catch(() => null),
        getDeadlineConfig()
      ]);

      // ── 2. Process Routes & Buses (from PG) ──
      const allRoutes = routesList || [];
      const allBuses: any[] = [];
      let operationalBuses = 0;
      let highLoadBusCount = 0;
      let activeDrivers = 0;

      for (const bus of allBusesFromPg) {
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
      const activeTripData = (statusSnap.data || []).map(status => {
        const bus = allBuses.find(b => b.busId === status.bus_id);
        const route = allRoutes.find(r => r.routeId === status.route_id);
        return {
          id: status.id, busId: bus?.busNumber || status.bus_id || '?',
          routeName: route?.routeName || 'Tracking...', driverUid: status.driver_uid,
          startTime: status.started_at || new Date().toISOString(),
          studentCount: bus?.currentMembers || 0, status: 'In Motion',
        };
      });

      // ── 5. Process Payments (Supabase) ──
      let onlinePayments = 0, offlinePayments = 0, totalRevenue = 0;
      (paymentsSnap.data || []).forEach(p => {
        const method = (p.method || '').toLowerCase().trim();
        if (method === 'online') onlinePayments++;
        else offlinePayments++;
        totalRevenue += Number(p.amount || 0);
      });

      // ── 6. Config Dates ──
      const configDates = {
        academicYearEnd: `${new Date().getFullYear()}-${String(deadlineConfig.academicYear.anchorMonth + 1).padStart(2, '0')}-${String(deadlineConfig.academicYear.anchorDay).padStart(2, '0')}`,
        softBlock: `${new Date().getFullYear()}-${String(deadlineConfig.softBlock.month + 1).padStart(2, '0')}-${String(deadlineConfig.softBlock.day).padStart(2, '0')}`,
        hardBlock: `${new Date().getFullYear()}-${String(deadlineConfig.hardDelete.month + 1).padStart(2, '0')}-${String(deadlineConfig.hardDelete.day).padStart(2, '0')}`,
        busFee: Number(systemConfigResult?.data?.busFee?.amount || 0)
      };

      const payload = {
        totalStudents, activeStudents, morningStudents, eveningStudents, expiredStudents,
        totalDrivers: driversSnap.count || 0, activeDrivers, totalBuses: allBusesFromPg.length,
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
