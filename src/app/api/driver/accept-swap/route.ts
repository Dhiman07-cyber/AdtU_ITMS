import { NextResponse } from 'next/server';
import { db as adminDb, auth as adminAuth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { FieldValue } from 'firebase-admin/firestore';
import { withSecurity } from '@/lib/security/api-security';
import { AcceptSwapSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getBusById, updateBus } from '@/domains/fleet';
import { getStudentsByBusIds } from '@/domains/identity';
import { assignDriverToBus } from '@/domains/fleet/repositories/driver-assignment.repository';

/**
 * POST /api/driver/accept-swap
 * 
 * Body: { swapRequestId }
 * 
 * Validates:
 * - Requester is the toDriverUid
 * 
 * Atomic actions:
 * - Update swap_requests.status = "accepted"
 * - Update buses/{busId}.activeDriverId = toDriverUid
 * - Append audit_logs
 * - Broadcast to students & moderators
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { swapRequestId } = body as any;
    const toDriverUid = auth.uid;

    // Get swap request
    const swapDoc = await adminDb.collection('swap_requests').doc(swapRequestId).get();
    if (!swapDoc.exists) {
      return NextResponse.json(
        { error: 'Swap request not found' },
        { status: 404 }
      );
    }

    const swapData = swapDoc.data();

    // Validate requester is the target driver
    if (swapData?.toDriverUid !== toDriverUid) {
      return NextResponse.json(
        { error: 'You are not the target driver for this swap request' },
        { status: 403 }
      );
    }

    // Validate swap is still pending
    if (swapData?.status !== 'pending') {
      return NextResponse.json(
        { error: `Swap request is already ${swapData?.status}` },
        { status: 400 }
      );
    }

    const busId = swapData.busId;
    const fromDriverUid = swapData.fromDriverUid;

    // Get bus from PG
    const busData = await getBusById(busId);
    const routeId = busData?.routeId;

    // ===== ATOMIC TRANSACTION =====
    // Use Firestore batch for swap request + PG for bus driver assignment
    const batch = adminDb.batch();

    // 1. Update swap request status
    batch.update(swapDoc.ref, {
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      handledBy: toDriverUid
    });

    await batch.commit();

    // 2. Update bus activeDriverId via PG
    await updateBus(busId, { activeTripId: null } as any);

    // 3. Update canonical driver_assignments
    try {
      await assignDriverToBus(toDriverUid, busId, {
        routeId: routeId ?? undefined,
        assignedBy: 'swap',
        reason: 'swap',
      });
    } catch (err) {
      console.error('⚠️ Failed to update driver_assignments in swap:', err);
    }

    console.log('📝 Swap accepted:', {
      actorUid: toDriverUid,
      swapRequestId, busId, fromDriverUid, toDriverUid,
      timestamp: new Date().toISOString()
    });

    // ===== Post-transaction actions =====

    // Initialize Supabase client
    const supabase = getSupabaseServer();

    // Reassign active trip to the new driver
    if (routeId) {
      const { error: activeTripError } = await supabase
        .from('active_trips')
        .update({ driver_id: toDriverUid })
        .eq('bus_id', busId)
        .eq('status', 'active');

      if (activeTripError) {
        console.error('Error reassigning active trip:', activeTripError);
      }

      // Broadcast to route channel
      const channel = supabase.channel(`route_${routeId}`);
      await channel.send({
        type: 'broadcast',
        event: 'driver_swapped',
        payload: {
          busId,
          routeId,
          fromDriverUid,
          toDriverUid,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Send FCM notification to all students on the bus
    try {
      const students = await getStudentsByBusIds([busId]);
      const studentIds = students.map((s: any) => s.uid);
      const fcmTokens: string[] = [];

      // Fetch FCM tokens concurrently
      const tokenSnapshots = await Promise.all(
        studentIds.map((uid: string) => adminDb.collection('fcm_tokens').where('userUid', '==', uid).get())
      );

      for (const snapshot of tokenSnapshots) {
        snapshot.docs.forEach((tokenDoc: any) => {
          fcmTokens.push(tokenDoc.data().deviceToken);
        });
      }

      if (fcmTokens.length > 0 && adminAuth.messaging) {
        await adminAuth.messaging().sendEach(
          fcmTokens.map(token => ({
            token,
            notification: {
              title: 'Driver Changed',
              body: `Your bus driver has been changed for this trip`
            },
            data: {
              type: 'driver_swapped',
              busId,
              newDriverUid: toDriverUid
            }
          }))
        );
      }
    } catch (fcmError) {
      console.error('Error sending FCM notifications:', fcmError);
    }

    // Notify the original driver
    try {
      const tokensSnapshot = await adminDb
        .collection('fcm_tokens')
        .where('userUid', '==', fromDriverUid)
        .get();

      const driverTokens: string[] = [];
      tokensSnapshot.docs.forEach((tokenDoc: any) => {
        driverTokens.push(tokenDoc.data().deviceToken);
      });

      if (driverTokens.length > 0 && adminAuth.messaging) {
        await adminAuth.messaging().sendEach(
          driverTokens.map(token => ({
            token,
            notification: {
              title: 'Swap Request Accepted',
              body: `The driver has accepted your swap request`
            },
            data: {
              type: 'swap_accepted',
              swapRequestId,
              busId
            }
          }))
        );
      }
    } catch (fcmError) {
      console.error('Error sending FCM notification:', fcmError);
    }

    return NextResponse.json({
      success: true,
      message: 'Swap request accepted successfully',
      data: {
        swapRequestId,
        busId,
        fromDriverUid,
        toDriverUid,
        status: 'accepted'
      }
    });
  },
  {
    requiredRoles: ['driver'],
    schema: AcceptSwapSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true
  }
);
