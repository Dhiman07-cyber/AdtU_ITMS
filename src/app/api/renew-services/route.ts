import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { calculateRenewalDate, formatRenewalDate } from '@/lib/utils/renewal-utils';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { checkBusCapacity, incrementBusCapacity, decrementBusCapacity } from '@/domains/fleet';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import crypto from 'crypto';
import { CapacityFullError } from '@/lib/errors/sentinel-errors';
import { getUserById } from '@/domains/identity';
import { getByUid as getStudentByUid, update as updateStudent } from '@/domains/student';

/**
 * POST /api/renew-services
 * Renews bus service for multiple students
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

    // Check if user is admin or moderator via PostgreSQL (canonical source of truth)
    const userData = await getUserById(decodedToken.uid);
    if (!userData) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    if (!['admin', 'moderator'].includes(userData.role)) {
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
    const opKey = (body.idempotencyKey as string) || crypto
      .createHash('sha256')
      .update(JSON.stringify({ actor: decodedToken.uid, paymentMode, transactionId: transactionId || null, renewals }))
      .digest('hex');

    const opRef = adminDb ? adminDb.collection('processed_operations').doc(`renew_${opKey}`) : null;
    let claim = { duplicate: false, data: null as any };

    if (opRef) {
      claim = await adminDb.runTransaction(async (txn) => {
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
    }

    if (claim.duplicate) {
      if (claim.data?.status === 'completed') {
        return NextResponse.json({ success: true, replayed: true, results: claim.data.results, summary: claim.data.summary });
      }
      // Staleness check: if the in_progress record is older than 5 minutes, allow retry
      const createdAt = claim.data?.createdAt ? new Date(claim.data.createdAt) : null;
      const isStale = createdAt && (Date.now() - createdAt.getTime()) > 5 * 60 * 1000;
      if (isStale && opRef) {
        await opRef.delete().catch(() => {});
        // Re-claim
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

        // Get student profile from PostgreSQL (canonical source of truth)
        const studentData = await getStudentByUid(studentUid);

        if (!studentData) {
          results.push({
            studentUid,
            success: false,
            error: 'Student not found'
          });
          continue;
        }

        // D8: Check for existing pending renewal application from PostgreSQL
        const { getByApplicantUid } = await import('@/domains/application');
        const pendingRenewalApp = await getByApplicantUid(studentUid);

        if (pendingRenewalApp &&
          pendingRenewalApp.state === 'submitted' &&
          (pendingRenewalApp.applicationType === 'renewal' || pendingRenewalApp.applicationType === 'renewal_after_soft_block')
        ) {
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
        const currentValidUntil = studentData.validUntil || null;
        const { newValidUntil } = calculateRenewalDate(currentValidUntil, durationYears, config);

        // Calculate new sessionEndYear from validUntil (deadline from config: June 30th by default)
        const newValidUntilDate = new Date(newValidUntil);
        const newSessionEndYear = newValidUntilDate.getFullYear();

        // Compute block dates from the new validUntil
        const blockDates = computeBlockDatesFromValidUntil(newValidUntil, config);

        // Shared field updates for the student document.
        const studentUpdate: Record<string, any> = {
          validUntil: newValidUntil,
          durationYears: durationYears, // Store the renewed duration
          sessionEndYear: newSessionEndYear, // Update session end year based on new validUntil
          softBlock: blockDates.softBlock,
          hardBlock: blockDates.hardBlock,
          status: 'active', // Reactivate if was blocked
          updatedAt: timestamp,
          lastRenewalDate: timestamp,
          paymentAmount: amount, // Update with the renewal amount
          paid_on: timestamp // Update with current renewal date
        };

        // ── Seat reclamation ────────────────────────────────────────────────
        const seatWasReleased = wasSeatReleased(studentData);
        const renewalBusId = studentData.busId || studentData.currentBusId || studentData.assignedBusId || null;

        if (seatWasReleased && renewalBusId) {
          try {
            const shift = studentData.shift || 'Morning';
            // Gate: check capacity in PG (source of truth)
            const capCheck = await checkBusCapacity(renewalBusId, shift);
            if (!capCheck.available) {
              throw new CapacityFullError();
            }
            // Increment capacity in PG
            await incrementBusCapacity(renewalBusId, shift);
            // Update student in PostgreSQL (canonical)
            await updateStudent(studentUid, { ...studentUpdate, seatReleasedAt: null });

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
          continue;
        }

        // Standard renewal (no seat released)
        await updateStudent(studentUid, studentUpdate);

        results.push({ studentUid, success: true, newValidUntil });
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

    // Summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`🎉 Renewal process completed: ${successCount} success, ${failCount} failed`);

    const summary = { total: renewals.length, successful: successCount, failed: failCount };

    // Finalize the idempotency record
    if (opRef) {
      try {
        await opRef.set(
          { status: 'completed', completedAt: new Date().toISOString(), results, summary },
          { merge: true }
        );
      } catch (finalErr) {
        console.error('CRITICAL: Renewal idempotency finalization failed — renewals committed but record not finalized:', finalErr);
        return NextResponse.json({
          success: true,
          warning: 'Renewals processed but operation record could not be finalized. Do NOT retry — contact administrator.',
          results,
          summary
        });
      }
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