import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { calculateRenewalDate, toFirestoreTimestamp, formatRenewalDate } from '@/lib/utils/renewal-utils';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { buildCapacityDelta } from '@/lib/busCapacityService';
import { getShiftLoad } from '@/lib/utils/shift-utils';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import crypto from 'crypto';
import { CapacityFullError } from '@/lib/errors/sentinel-errors';

/**
 * POST /api/renew-services
 * Renews bus service for multiple students
 * 
 * Request body:
 * {
 *   renewals: Array<{
 *     studentUid: string;
 *     durationYears: number;
 *     amount: number;
 *   }>;
 *   paymentMode: 'manual' | 'online';
 *   transactionId?: string;
 *   adminUid: string;
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);

    // Verify token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (error) {
      console.error('❌ Token verification failed:', error);
      return NextResponse.json(
        { success: false, error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Check if user is admin or moderator
    const userDoc = await adminDb.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const userData = userDoc.data();
    if (!userData || !['admin', 'moderator'].includes(userData.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Insufficient permissions' },
        { status: 403 }
      );
    }

    // Fetch deadline configuration
    const config = await getDeadlineConfig();

    const body = await request.json();
    const { renewals, paymentMode, transactionId, adminUid } = body;

    // Validate input
    if (!renewals || !Array.isArray(renewals) || renewals.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid renewals data' },
        { status: 400 }
      );
    }

    if (renewals.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Cannot process more than 100 renewals at once' },
        { status: 400 }
      );
    }

    if (!paymentMode || !['manual', 'online'].includes(paymentMode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid payment mode' },
        { status: 400 }
      );
    }

    // ── Idempotency claim ────────────────────────────────────────────────────
    // Renewal is NOT naturally idempotent: calculateRenewalDate advances validUntil
    // from its CURRENT value, so a double-click / network-retry resubmit would
    // double-extend every student. We claim a deterministic key (client-supplied or
    // derived from the exact payload) inside a transaction: the first request wins
    // and proceeds; an identical resubmit replays the stored result (if completed)
    // or is rejected with 409 (if still in flight) — never re-applied.
    const opKey = (body.idempotencyKey as string) || crypto
      .createHash('sha256')
      .update(JSON.stringify({ actor: decodedToken.uid, paymentMode, transactionId: transactionId || null, renewals }))
      .digest('hex');
    const opRef = adminDb.collection('processed_operations').doc(`renew_${opKey}`);

    const claim = await adminDb.runTransaction(async (txn) => {
      const snap = await txn.get(opRef);
      if (snap.exists) return { duplicate: true, data: snap.data() as any };
      txn.set(opRef, {
        type: 'renew-services',
        status: 'in_progress',
        actorUid: decodedToken.uid,
        renewalCount: renewals.length,
        createdAt: new Date().toISOString(),
      });
      return { duplicate: false, data: null as any };
    });

    if (claim.duplicate) {
      if (claim.data?.status === 'completed') {
        return NextResponse.json({ success: true, replayed: true, results: claim.data.results, summary: claim.data.summary });
      }
      // Staleness check: if the in_progress record is older than 5 minutes, allow retry
      const createdAt = claim.data?.createdAt ? new Date(claim.data.createdAt) : null;
      const isStale = createdAt && (Date.now() - createdAt.getTime()) > 5 * 60 * 1000;
      if (isStale) {
        await opRef.delete().catch(() => {});
        // Re-claim (will succeed since we just deleted)
        const retryClaim = await adminDb.runTransaction(async (txn) => {
          const snap = await txn.get(opRef);
          if (snap.exists) return { duplicate: true, data: snap.data() as any };
          txn.set(opRef, {
            type: 'renew-services',
            status: 'in_progress',
            actorUid: decodedToken.uid,
            renewalCount: renewals.length,
            createdAt: new Date().toISOString(),
          });
          return { duplicate: false, data: null as any };
        });
        if (retryClaim.duplicate) {
          return NextResponse.json(
            { success: false, error: 'An identical renewal request is already being processed.' },
            { status: 409 }
          );
        }
      } else {
        return NextResponse.json(
          { success: false, error: 'An identical renewal request is already being processed.' },
          { status: 409 }
        );
      }
    }

    // Process renewals
    const results: Array<{
      studentUid: string;
      success: boolean;
      error?: string;
      newValidUntil?: string;
    }> = [];

    const timestamp = new Date().toISOString();
    const batch = adminDb.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;
    // Track batched results separately so we only report success after commit
    const pendingBatchResults: Array<{ studentUid: string; newValidUntil: string }> = [];

    for (const renewal of renewals) {
      const { studentUid, durationYears, amount } = renewal;

      try {
        // Validate duration
        if (!Number.isInteger(durationYears) || durationYears < 1 || durationYears > 4) {
          results.push({
            studentUid,
            success: false,
            error: 'Invalid duration (must be 1-4 years)'
          });
          continue;
        }

        // Get student document
        const studentRef = adminDb.collection('students').doc(studentUid);
        const studentDoc = await studentRef.get();

        if (!studentDoc.exists) {
          results.push({
            studentUid,
            success: false,
            error: 'Student not found'
          });
          continue;
        }

        const studentData = studentDoc.data();
        if (!studentData) {
          results.push({
            studentUid,
            success: false,
            error: 'Student data unavailable'
          });
          continue;
        }

        // Check for existing pending renewal request for this student
        const pendingRenewalQuery = await adminDb
          .collection('renewal_requests')
          .where('studentId', '==', studentUid)
          .where('status', '==', 'pending')
          .limit(1)
          .get();

        if (!pendingRenewalQuery.empty) {
          results.push({
            studentUid,
            success: false,
            error: 'Student has a pending renewal request that must be resolved first'
          });
          continue;
        }

        // Verify payment exists for this renewal
        if (paymentMode === 'manual') {
          // Manual mode: require a transactionId (proof of offline payment received)
          if (!transactionId || transactionId.trim() === '') {
            results.push({
              studentUid,
              success: false,
              error: 'Transaction ID required for manual renewal (proof of payment)'
            });
            continue;
          }
        } else if (paymentMode === 'online') {
          // Online mode: verify a completed payment exists in Supabase
          const existingPayments = await paymentsSupabaseService.getPaymentsByStudentUid(studentUid);
          const completedPayment = existingPayments.find(
            p => p.status === 'Completed' && p.method === 'Online'
          );
          if (!completedPayment) {
            results.push({
              studentUid,
              success: false,
              error: 'No completed online payment found — student must pay before renewal'
            });
            continue;
          }
        }

        // Calculate new validUntil date
        const currentValidUntil = studentData.validUntil?.toDate?.()?.toISOString() || null;
        const { newValidUntil } = calculateRenewalDate(currentValidUntil, durationYears, config);

        // Calculate new sessionEndYear from validUntil (deadline from config: June 30th by default)
        const newValidUntilDate = new Date(newValidUntil);
        const newSessionEndYear = newValidUntilDate.getFullYear();

        // Compute block dates from the new validUntil
        const blockDates = computeBlockDatesFromValidUntil(newValidUntil, config);

        // Shared field updates for the student document.
        const studentUpdate: Record<string, any> = {
          validUntil: toFirestoreTimestamp(newValidUntil),
          durationYears: durationYears, // Store the renewed duration
          sessionEndYear: newSessionEndYear, // Update session end year based on new validUntil
          // CRITICAL: Always update block dates when validUntil changes
          softBlock: blockDates.softBlock,
          hardBlock: blockDates.hardBlock,
          status: 'active', // Reactivate if was blocked
          updatedAt: toFirestoreTimestamp(timestamp),
          lastRenewalDate: timestamp,
          // Update payment information for renewal
          paymentAmount: amount, // Update with the renewal amount
          paid_on: timestamp // Update with current renewal date
        };

        // ── Seat reclamation ────────────────────────────────────────────────
        // If the seat was released at soft block (marker set), this renewal must
        // re-acquire a bus seat. Such students CANNOT use the pure writeBatch (it
        // can't read capacity); they take an individual transaction that increments
        // the bus and updates the student atomically. A full bus fails that single
        // student's renewal (reported) — no validity change, stays soft_blocked —
        // so the admin can reassign and retry. Non-released students keep the fast
        // batch path with ZERO capacity action (unchanged behavior).
        const seatWasReleased = wasSeatReleased(studentData);
        const renewalBusId = studentData.busId || studentData.currentBusId || studentData.assignedBusId || null;

        if (seatWasReleased && renewalBusId) {
          try {
            const busRef = adminDb.collection('buses').doc(renewalBusId);
            await adminDb.runTransaction(async (txn) => {
              const busDoc = await txn.get(busRef);
              if (!busDoc.exists) throw new Error('Assigned bus not found');
              const busData = busDoc.data();
              // CANONICAL PER-SHIFT CAPACITY GATE: gate on the student's shift trip
              // counter, never on the combined total currentMembers. Students share the
              // same physical seats across Morning and Evening — each shift runs
              // independently up to `capacity` seats.
              const shiftLoad = getShiftLoad(busData, studentData.shift);
              if (shiftLoad >= (busData?.capacity || 55)) {
                throw new CapacityFullError();
              }
              const delta = buildCapacityDelta(busData, studentData.shift, 1);
              txn.update(busRef, delta.updates);
              txn.update(studentRef, { ...studentUpdate, seatReleasedAt: null });
            });
            results.push({ studentUid, success: true, newValidUntil });
            console.log(`✅ Renewed + reclaimed seat for ${studentUid.substring(0,8)}... on bus ${renewalBusId}`);
          } catch (txErr: any) {
            if (txErr instanceof CapacityFullError) {
              results.push({ studentUid, success: false, error: 'Original bus full — reassign required before renewal' });
            } else {
              console.error(`❌ Seat-reclaim renewal failed for ${studentUid}:`, txErr);
              results.push({ studentUid, success: false, error: 'Renewal failed during seat reclamation' });
            }
          }
          continue; // handled transactionally; do not add to batch
        }

        // Update student document with validUntil AND block dates (fast batch path)
        batch.update(studentRef, studentUpdate);
        batchCount++;
        pendingBatchResults.push({ studentUid, newValidUntil });

        // Commit batch if reaching limit
        if (batchCount >= MAX_BATCH_SIZE) {
          await batch.commit();
          console.log(`✅ Committed batch of ${batchCount} operations`);
          // Only NOW push results after successful commit
          for (const r of pendingBatchResults) {
            results.push({ studentUid: r.studentUid, success: true, newValidUntil: r.newValidUntil });
          }
          pendingBatchResults.length = 0;
          batchCount = 0;
        }

        console.log(`✅ Renewed service for ${studentUid.substring(0,8)}...: ${currentValidUntil ? formatRenewalDate(currentValidUntil) : 'Expired'} → ${formatRenewalDate(newValidUntil)}`);

      } catch (error: any) {
        console.error(`❌ Error renewing service for ${studentUid}:`, error);
        results.push({
          studentUid,
          success: false,
          error: 'Unknown error'
        });
      }
    }

    // Commit final batch
    if (batchCount > 0) {
      await batch.commit();
      console.log(`✅ Committed final batch of ${batchCount} operations`);
      // Only NOW push results after successful commit
      for (const r of pendingBatchResults) {
        results.push({ studentUid: r.studentUid, success: true, newValidUntil: r.newValidUntil });
      }
    }

    // Summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`🎉 Renewal process completed: ${successCount} success, ${failCount} failed`);

    const summary = { total: renewals.length, successful: successCount, failed: failCount };

    // Finalize the idempotency record so an identical resubmit replays this exact
    // result instead of re-applying (and double-extending) the renewals.
    try {
      await opRef.set(
        { status: 'completed', completedAt: new Date().toISOString(), results, summary },
        { merge: true }
      );
    } catch (finalErr) {
      // The renewals have already been committed. If finalization fails, the
      // idempotency record stays `in_progress` and a staleness retry could
      // double-extend. Return an error so the client knows the operation
      // completed in Firestore but the idempotency guard was not finalized.
      console.error('CRITICAL: Renewal idempotency finalization failed — renewals committed but record not finalized:', finalErr);
      return NextResponse.json({
        success: true,
        warning: 'Renewals processed but operation record could not be finalized. Do NOT retry — contact administrator.',
        results,
        summary
      });
    }

    return NextResponse.json({
      success: true,
      results,
      summary
    });

  } catch (error: any) {
    console.error('❌ Error processing renewals:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}