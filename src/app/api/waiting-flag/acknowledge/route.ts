/**
 * POST /api/waiting-flag/acknowledge
 * 
 * Driver acknowledges a waiting flag with:
 * - Driver validation
 * - Status update
 * - Real-time broadcast to student
 * - Audit logging
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { checkRateLimit, createRateLimitId } from '@/lib/security/rate-limiter';
import { emitEvent } from '@/domains/realtime/event-emitter';

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { idToken, flagId, action } = body;

    // Validate required fields
    if (!idToken || !flagId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Input length validation to prevent oversized payloads
    if (typeof flagId !== 'string' || flagId.length > 128) {
      return NextResponse.json(
        { error: 'Invalid flag ID' },
        { status: 400 }
      );
    }

    // Validate action
    if (!['acknowledge', 'boarded', 'ignore'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }

    // Verify Firebase token
    const decodedToken = await auth.verifyIdToken(idToken);
    const driverUid = decodedToken.uid;

    // Rate limiting
    const rlId = createRateLimitId(driverUid, 'waiting-flag-ack');
    const rl = checkRateLimit(rlId, 30, 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait.' },
        { status: 429 }
      );
    }

    // SECURITY: Verify driver profile exists in Supabase (authoritative source).
    const supabase = getSupabaseServer();
    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('uid, bus_id, bus_id, full_name')
      .eq('uid', driverUid)
      .maybeSingle();

    if (!driverProfile) {
      return NextResponse.json(
        { error: 'User is not authorized as a driver' },
        { status: 403 }
      );
    }

    // Get flag details
    const { data: flag, error: fetchError } = await supabase
      .from('waiting_flags')
      .select('*')
      .eq('id', flagId)
      .single();

    if (fetchError || !flag) {
      return NextResponse.json(
        { error: 'Waiting flag not found' },
        { status: 404 }
      );
    }

    // Verify driver is assigned to this bus
    if (driverProfile.bus_id !== flag.bus_id &&
      driverProfile.bus_id !== flag.bus_id) {
      return NextResponse.json(
        { error: 'Driver is not assigned to this bus' },
        { status: 403 }
      );
    }

    // Validate state transition and check for idempotency
    let allowedPriorStatuses: string[] = [];
    if (action === 'acknowledge') {
      if (flag.status === 'acknowledged') {
        return NextResponse.json({ success: true, message: 'Flag acknowledge successfully', newStatus: 'acknowledged' });
      }
      if (['boarded', 'picked_up', 'cancelled', 'expired'].includes(flag.status)) {
        return NextResponse.json({ error: `Cannot acknowledge flag that is already ${flag.status}` }, { status: 400 });
      }
      allowedPriorStatuses = ['raised', 'waiting'];
    } else if (action === 'boarded') {
      if (flag.status === 'boarded' || flag.status === 'picked_up') {
        return NextResponse.json({ success: true, message: 'Flag boarded successfully', newStatus: flag.status });
      }
      if (['cancelled', 'expired'].includes(flag.status)) {
        return NextResponse.json({ error: `Cannot mark boarded: flag is ${flag.status}` }, { status: 400 });
      }
      allowedPriorStatuses = ['raised', 'acknowledged', 'waiting'];
    } else if (action === 'ignore') {
      if (flag.status === 'cancelled' || flag.status === 'expired') {
        return NextResponse.json({ success: true, message: 'Flag ignore successfully', newStatus: flag.status });
      }
      if (['boarded', 'picked_up'].includes(flag.status)) {
        return NextResponse.json({ error: `Cannot ignore flag that is ${flag.status}` }, { status: 400 });
      }
      allowedPriorStatuses = ['raised', 'acknowledged', 'waiting'];
    }

    // Update flag status based on action
    let newStatus = 'raised';
    let updateData: any = {
      ack_by_driver_uid: driverUid
    };

    switch (action) {
      case 'acknowledge':
        newStatus = 'acknowledged';
        updateData.acknowledged_at = new Date().toISOString();
        break;
      case 'boarded':
        newStatus = 'boarded';
        updateData.boarded_at = new Date().toISOString();
        break;
      case 'ignore':
        newStatus = 'cancelled';
        updateData.cancelled_at = new Date().toISOString();
        break;
    }

    updateData.status = newStatus;

    // Update in Supabase atomically
    const { data: updatedFlags, error: updateError } = await supabase
      .from('waiting_flags')
      .update(updateData)
      .eq('id', flagId)
      .in('status', allowedPriorStatuses)
      .select();

    if (updateError) {
      console.error('❌ Error updating flag:', updateError);
      return NextResponse.json(
        { error: 'Failed to update flag' },
        { status: 500 }
      );
    }

    if (!updatedFlags || updatedFlags.length === 0) {
      return NextResponse.json(
        { error: 'Flag already processed or state transition invalid' },
        { status: 409 }
      );
    }

    // Broadcast via WebSocket
    const ts = new Date().toISOString();
    const flagEvent = action === 'acknowledge' ? 'waiting_flag_acknowledged'
      : action === 'boarded' ? 'waiting_flag_boarded'
      : 'waiting_flag_cancelled';

    if (action === 'acknowledge') {
      emitEvent(`student_${flag.student_uid}`, 'flag_acknowledged', {
        flagId,
        driverUid,
        driverName: driverProfile.full_name || 'Driver',
        timestamp: ts
      }).catch(() => {});
    }

    emitEvent(`waiting_flags_${flag.bus_id}`, flagEvent, {
      flagId,
      status: newStatus,
      action,
      driverUid,
      timestamp: ts
    }).catch(() => {});

    // Log operation (audit_logs moved to Supabase)

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `Flag ${action} successfully`,
      newStatus
    });

  } catch (error: any) {
    console.error('❌ Error in waiting-flag/acknowledge:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
