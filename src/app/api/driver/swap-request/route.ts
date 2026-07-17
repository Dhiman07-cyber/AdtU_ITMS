import { NextResponse } from 'next/server';
import { db as adminDb, auth as adminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { withSecurity } from '@/lib/security/api-security';
import { SwapRequestBodySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getBusById } from '@/domains/fleet';
import crypto from 'crypto';

/**
 * POST /api/driver/swap-request
 * 
 * Body: { busId, toDriverUid }
 * 
 * Creates a swap request from current driver to another driver
 * Notifies the target driver via FCM
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId, toDriverUid } = body as any;
    const fromDriverUid = auth.uid;

    // Verify user is a driver (already done by withSecurity, but double-checking role if needed)
    // Actually withSecurity with requiredRoles: ['driver'] takes care of this.

    // Verify target user is also a driver
    const { resolveUserRole } = await import('@/lib/security/role-cache');
    const toUserRole = await resolveUserRole(toDriverUid);
    if (toUserRole.role !== 'driver') {
      return NextResponse.json(
        { error: 'Target user is not a driver' },
        { status: 400 }
      );
    }

    // Verify bus exists and current driver is assigned (from PG)
    const busData = await getBusById(busId);
    if (!busData) {
      return NextResponse.json({ error: 'Bus not found' }, { status: 404 });
    }

    // Check assignment
    const isAssignedDriver =
      (busData as any).assignedDriverId === fromDriverUid ||
      (busData as any).activeDriverId === fromDriverUid ||
      busData.driverUID === fromDriverUid;

    if (!isAssignedDriver) {
      return NextResponse.json(
        { error: 'You are not assigned to this bus' },
        { status: 403 }
      );
    }

    // Check for existing pending swap requests
    const existingSwaps = await adminDb
      .collection('swap_requests')
      .where('busId', '==', busId)
      .where('fromDriverUid', '==', fromDriverUid)
      .where('status', '==', 'pending')
      .get();

    if (!existingSwaps.empty) {
      return NextResponse.json(
        { error: 'You already have a pending swap request for this bus' },
        { status: 400 }
      );
    }

    const requestId = `swap_${busId}_${crypto.randomUUID()}`;

    // Create swap request
    await adminDb.collection('swap_requests').doc(requestId).set({
      id: requestId,
      busId,
      fromDriverUid,
      toDriverUid,
      status: 'pending',
      requestedAt: FieldValue.serverTimestamp(),
      acceptedAt: null,
      handledBy: null
    });

    console.log('📝 Swap request created:', {
      actorUid: fromDriverUid,
      requestId, busId, toDriverUid,
      timestamp: new Date().toISOString()
    });

    // Send FCM notification to target driver
    try {
      const tokensSnapshot = await adminDb
        .collection('fcm_tokens')
        .where('userUid', '==', toDriverUid)
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
              title: 'Driver Swap Request',
              body: `A driver wants to swap bus duty with you`
            },
            data: {
              type: 'swap_request',
              requestId,
              fromDriverUid,
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
      message: 'Swap request created successfully',
      data: {
        requestId,
        busId,
        fromDriverUid,
        toDriverUid,
        status: 'pending'
      }
    });
  },
  {
    requiredRoles: ['driver'],
    schema: SwapRequestBodySchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true
  }
);
