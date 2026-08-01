import { checkBusCapacity,incrementBusCapacity } from '@/domains/fleet';
import { getUserById } from '@/domains/identity';
import { getByUid as getStudentByUid,update as updateStudent } from '@/domains/student';
import { wasSeatReleased } from '@/lib/config/capacity-flags';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { CapacityFullError } from '@/lib/errors/sentinel-errors';
import { adminAuth } from '@/lib/firebase-admin';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { getSupabaseServer } from '@/lib/supabase-server';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { calculateRenewalDate,formatRenewalDate } from '@/lib/utils/renewal-utils';
import { normalizeShift } from '@/lib/utils/shift-utils';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

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
    const supabase = getSupabaseServer();
    if (!supabase) {
      return NextResponse.json({ success: false, error: 'Database connection failed' }, { status: 500 });
    }

    const opKey = (body.idempotencyKey as string) || crypto
      .createHash('sha256')
      .update(JSON.stringify({ actor: decodedToken.uid, paymentMode, transactionId: transactionId || null, renewals }))
      .digest('hex');

    const operationKey = `renew_${opKey}`;

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
        const renewalBusId = studentData.busId || studentData.currentBusId || studentData.busId || null;

        if (seatWasReleased && renewalBusId) {
          try {
            const shift = normalizeShift(studentData.shift);
            if (!shift) {
              throw new Error('Student profile missing valid shift assignment for renewal seat check.');
            }
            // ponytail: checkBusCapacity is a fast-fail optimization (STABLE read, no lock).
            // The real capacity guard is inside bus_increment_capacity (FOR UPDATE + re-check).
            // This check avoids the heavier locked increment when the bus is clearly full.
            // Note: there is a TOCTOU gap between check and increment — capacity could
            // change between the two calls.  bus_increment_capacity handles this correctly
            // by re-checking inside its FOR UPDATE lock.
            // TODO: pgIncrementBusCapacity throws generic Error on capacity full, not
            // CapacityFullError.  Fix fleet.repository.pg to throw CapacityFullError so
            // the catch block below can distinguish capacity errors from other failures.
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