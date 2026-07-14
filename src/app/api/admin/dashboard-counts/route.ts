import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { getSystemConfig } from '@/domains/admin';

/**
 * GET /api/admin/dashboard-counts
 * 
 * Optimized:
 * - Parallelized fetching across Firestore AND Supabase.
 * - Single pass processing of collection snapshots.
 * - Robust error handling with partial data fallback.
 */

export const dynamic = 'force-dynamic';

export const GET = withSecurity(
  async (request, { auth, requestId }) => {
    if (!adminDb) {
      return NextResponse.json({ success: false, error: 'Firebase Admin not initialized', requestId }, { status: 500 });
    }

    try {
      const supabase = getSupabaseServer();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // ── 1. Fire ALL distributed queries in parallel (Firestore & Supabase) ──
      const [
        totalStudentsSnap,
        activeStudentsSnap,
        morningStudentsSnap,
        eveningStudentsSnap,
        expiredStudentsSnap,
        driversSnap,
        busesSnap,
        routesSnap,
        pendingAppsSnap,
        verificationSnap,
        renewalSnap,
        feedbackSnap,
        statusSnap,
        paymentsSnap,
        systemConfig,
        deadlineConfig
      ] = await Promise.all([
        adminDb.collection('students').count().get(),
        adminDb.collection('students').where('status', '==', 'active').count().get(),
        adminDb.collection('students').where('status', '==', 'active').where('shift', '==', 'Morning').count().get(),
        adminDb.collection('students').where('status', '==', 'active').where('shift', '==', 'Evening').count().get(),
        adminDb.collection('students').where('status', '==', 'expired').count().get(),
        adminDb.collection('drivers').count().get(),
        adminDb.collection('buses').get(),
        adminDb.collection('routes').get(),
        adminDb.collection('applications').where('state', '==', 'submitted').count().get(),
        adminDb.collection('applications').where('state', '==', 'awaiting_verification').count().get(),
        supabase.from('applications').select('*', { count: 'exact', head: true }).eq('state', 'submitted').in('application_type', ['renewal', 'renewal_after_soft_block']),
        adminDb.collection('feedbacks').where('createdAt', '>=', sevenDaysAgo).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
        supabase.from('driver_status').select('*').in('status', ['enroute', 'on_trip']),
        supabase.from('payments').select('amount, method').or('status.eq.Completed,status.eq.completed'),
        getSystemConfig().catch(() => null),
        getDeadlineConfig()
      ]);

      // ── 2. Process Routes & Buses ──
      const allRoutes = routesSnap.docs.map(doc => ({ ...doc.data(), id: doc.id, routeId: doc.id }));
      const allBuses: any[] = [];
      let operationalBuses = 0;
      let highLoadBusCount = 0;
      let activeDrivers = 0;

      busesSnap.forEach(doc => {
        const d = doc.data();
        if (d.driverUID || d.assignedDriverId || d.activeDriverId) {
          activeDrivers++;
        }
        const currentMembers = d.currentMembers || 0;
        let capacity = 55;
        if (d.totalCapacity) capacity = d.totalCapacity;
        else if (d.capacity) {
            if (typeof d.capacity === 'string' && d.capacity.includes('/')) capacity = parseInt(d.capacity.split('/')[1]) || 55;
            else if (typeof d.capacity === 'number') capacity = d.capacity;
        }
        const usagePct = capacity > 0 ? Math.round((currentMembers / capacity) * 100) : 0;
        if (!['inactive', 'under-maintenance', 'maintenance'].includes((d.status || '').toLowerCase())) operationalBuses++;
        if (usagePct >= 80) highLoadBusCount++;

        allBuses.push({ ...d, id: doc.id, busId: doc.id, currentMembers, totalCapacity: capacity, usagePct });
      });

      // ── 3. Process Students (Optimized via count()) ──
      const totalStudents = totalStudentsSnap.data().count;
      const activeStudents = activeStudentsSnap.data().count;
      const morningStudents = morningStudentsSnap.data().count;
      const eveningStudents = eveningStudentsSnap.data().count;
      const expiredStudents = expiredStudentsSnap.data().count;

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
        busFee: Number(systemConfig?.busFee?.amount || 0)
      };

      const payload = {
        totalStudents, activeStudents, morningStudents, eveningStudents, expiredStudents,
        totalDrivers: driversSnap.data().count, activeDrivers, totalBuses: busesSnap.size,
        operationalBuses, activeBuses: statusSnap.data?.length || 0,
        enrouteBuses: statusSnap.data?.length || 0,
        pendingApplications: pendingAppsSnap.data().count,
        pendingVerifications: verificationSnap.data().count,
        renewalRequests: renewalSnap.count || 0,
        feedbacksCount: feedbackSnap.data().count,
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
