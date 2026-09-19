import { getAllBuses } from '@/domains/fleet';
import { getStudentById } from '@/domains/identity';
import { db as adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * POST /api/driver/get-pending-profile-requests
 * 
 * Fetches pending profile update requests for students on the driver's assigned buses.
 */
export const POST = withSecurity(
  async (request, { auth }) => {
    const driverUid = auth.uid;

    if (!adminDb) {
      return NextResponse.json({ success: false, error: 'Firebase Admin not initialized' }, { status: 500 });
    }

    // Get all buses assigned to this driver (from PG)
    const allBuses = await getAllBuses();
    const driverBuses = allBuses.filter(b => (b as any).assignedDriverId === driverUid);
    const busIds = driverBuses.map(b => b.busId || b.id || '');
    console.log(`Driver ${driverUid} has buses:`, busIds);

    if (busIds.length === 0) {
      return NextResponse.json({
        success: true,
        requests: []
      });
    }

    // Query profile_update_requests directly by busId in parallel
    const requests: any[] = [];

    const busSnapshots = await Promise.all(
      busIds.map(busId =>
        adminDb.collection('profile_update_requests')
          .where('busId', '==', busId)
          .where('status', '==', 'pending')
          .get()
      )
    );

    for (const snapshot of busSnapshots) {
      snapshot.docs.forEach((doc: any) => {
        const data = doc.data();
        requests.push({
          requestId: doc.id,
          ...data,
          createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null,
          approvedAt: data.approvedAt ? (data.approvedAt.toDate ? data.approvedAt.toDate().toISOString() : data.approvedAt) : null,
          rejectedAt: data.rejectedAt ? (data.rejectedAt.toDate ? data.rejectedAt.toDate().toISOString() : data.rejectedAt) : null
        });
      });
    }

    // Also check for legacy requests without busId by looking at student_profiles in PostgreSQL
    // OPTIMIZATION: Single batch query with .in('bus_id', busIds) instead of sequential loop
    const supabase = getSupabaseServer();
    const { data: students } = await supabase
      .from('student_profiles')
      .select('uid, bus_id, "pendingProfileUpdate"')
      .in('bus_id', busIds)
      .not('pendingProfileUpdate', 'is', null);

    const pendingToFetch = (students || [])
      .map((s: any) => ({ pendingId: s.pendingProfileUpdate as string, busId: s.bus_id as string }))
      .filter(s => s.pendingId && !requests.some(r => r.requestId === s.pendingId));

    if (pendingToFetch.length > 0) {
      // Parallelize Firestore document lookups
      const requestDocs = await Promise.all(
        pendingToFetch.map(item => adminDb.collection('profile_update_requests').doc(item.pendingId).get())
      );

      for (let i = 0; i < requestDocs.length; i++) {
        const requestDoc = requestDocs[i];
        const item = pendingToFetch[i];
        if (requestDoc.exists) {
          const data = requestDoc.data();
          if (data && data.status === 'pending') {
            requests.push({
              requestId: requestDoc.id,
              ...data,
              busId: item.busId,
              createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null,
              approvedAt: data.approvedAt ? (data.approvedAt.toDate ? data.approvedAt.toDate().toISOString() : data.approvedAt) : null,
              rejectedAt: data.rejectedAt ? (data.rejectedAt.toDate ? data.rejectedAt.toDate().toISOString() : data.rejectedAt) : null
            });

            if (!data.busId) {
              adminDb.collection('profile_update_requests').doc(requestDoc.id).update({
                busId: item.busId
              }).catch((err: any) => console.error('Error backfilling busId:', err));
            }
          }
        }
      }
    }

    // FINAL FALLBACK: Check for orphaned requests
    if (requests.length === 0) {
      const orphanedRequestsSnapshot = await adminDb.collection('profile_update_requests')
        .where('status', '==', 'pending')
        .get();

      const candidateDocs = orphanedRequestsSnapshot.docs.filter((doc: any) => {
        const data = doc.data();
        if (requests.find(r => r.requestId === doc.id)) return false;
        if (data.busId && !busIds.includes(data.busId)) return false;
        return !!data.studentUid;
      });

      if (candidateDocs.length > 0) {
        const studentLookups = await Promise.all(
          candidateDocs.map((doc: any) => getStudentById(doc.data().studentUid).catch(() => null))
        );

        for (let i = 0; i < candidateDocs.length; i++) {
          const requestDoc = candidateDocs[i];
          const requestData = requestDoc.data();
          const studentData = studentLookups[i] as any;

          if (studentData) {
            const studentBusId = studentData.busId || studentData.bus_id;

            if (studentBusId && busIds.includes(studentBusId)) {
              requests.push({
                requestId: requestDoc.id,
                ...requestData,
                busId: studentBusId,
                createdAt: requestData.createdAt ? (requestData.createdAt.toDate ? requestData.createdAt.toDate().toISOString() : requestData.createdAt) : null,
                approvedAt: requestData.approvedAt ? (requestData.approvedAt.toDate ? requestData.approvedAt.toDate().toISOString() : requestData.approvedAt) : null,
                rejectedAt: requestData.rejectedAt ? (requestData.rejectedAt.toDate ? requestData.rejectedAt.toDate().toISOString() : requestData.rejectedAt) : null
              });

              adminDb.collection('profile_update_requests').doc(requestDoc.id).update({
                busId: studentBusId
              }).catch((err: any) => console.error('Error updating orphaned busId:', err));
            }
          }
        }
      }
    }

    console.log(`Found ${requests.length} pending profile update requests for driver ${driverUid}`);

    return NextResponse.json({
      success: true,
      requests
    });
  },
  {
    requiredRoles: ['driver'],
    schema: EmptySchema,
    rateLimit: RateLimits.READ,
    allowBodyToken: true
  }
);