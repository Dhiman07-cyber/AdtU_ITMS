import { NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getAllBuses } from '@/domains/fleet';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getStudentById } from '@/domains/identity';

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

    // Query profile_update_requests directly by assignedBusId
    const requests: any[] = [];

    for (const busId of busIds) {
      // Query pending requests for this bus
      const requestsSnapshot = await adminDb.collection('profile_update_requests')
        .where('assignedBusId', '==', busId)
        .where('status', '==', 'pending')
        .get();

      requestsSnapshot.docs.forEach((doc: any) => {
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

    // Also check for legacy requests without assignedBusId by looking at student_profiles in PostgreSQL
    const supabase = getSupabaseServer();
    for (const busId of busIds) {
      const { data: students } = await supabase
        .from('student_profiles')
        .select('*')
        .or(`assigned_bus_id.eq.${busId},bus_id.eq.${busId}`);

      for (const studentData of students || []) {
        const pendingProfileUpdate = studentData.extras?.pendingProfileUpdate || (studentData as any).pendingProfileUpdate;
        if (pendingProfileUpdate) {
          const existingRequest = requests.find(r => r.requestId === pendingProfileUpdate);
          if (!existingRequest) {
            const requestDoc = await adminDb.collection('profile_update_requests')
              .doc(pendingProfileUpdate)
              .get();

            if (requestDoc.exists) {
              const data = requestDoc.data();
              if (data && data.status === 'pending') {
                requests.push({
                  requestId: requestDoc.id,
                  ...data,
                  assignedBusId: busId,
                  createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null,
                  approvedAt: data.approvedAt ? (data.approvedAt.toDate ? data.approvedAt.toDate().toISOString() : data.approvedAt) : null,
                  rejectedAt: data.rejectedAt ? (data.rejectedAt.toDate ? data.rejectedAt.toDate().toISOString() : data.rejectedAt) : null
                });

                if (!data.assignedBusId) {
                  await adminDb.collection('profile_update_requests').doc(requestDoc.id).update({
                    assignedBusId: busId
                  });
                }
              }
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

      for (const requestDoc of orphanedRequestsSnapshot.docs) {
        const requestData = requestDoc.data();
        if (requests.find(r => r.requestId === requestDoc.id)) continue;
        if (requestData.assignedBusId && !busIds.includes(requestData.assignedBusId)) continue;

        if (requestData.studentUid) {
          const studentData = await getStudentById(requestData.studentUid);
          if (studentData) {
            const studentBusId = studentData.assignedBusId || studentData.busId;

            if (studentBusId && busIds.includes(studentBusId)) {
              requests.push({
                requestId: requestDoc.id,
                ...requestData,
                assignedBusId: studentBusId,
                createdAt: requestData.createdAt ? (requestData.createdAt.toDate ? requestData.createdAt.toDate().toISOString() : requestData.createdAt) : null,
                approvedAt: requestData.approvedAt ? (requestData.approvedAt.toDate ? requestData.approvedAt.toDate().toISOString() : requestData.approvedAt) : null,
                rejectedAt: requestData.rejectedAt ? (requestData.rejectedAt.toDate ? requestData.rejectedAt.toDate().toISOString() : requestData.rejectedAt) : null
              });

              await adminDb.collection('profile_update_requests').doc(requestDoc.id).update({
                assignedBusId: studentBusId
              });
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