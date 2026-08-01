import { getDriverById } from '@/domains/identity';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { MarkBoardedSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * POST /api/driver/ack-flag
 * 
 * Body: { flagId }
 * 
 * Validates:
 * - Driver is authenticated and assigned to the route/bus
 * 
 * Actions:
 * - Update waiting_flags.status = "acknowledged"
 * - Set ackBy_driver_uid
 * - Broadcast update to route channel
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { flagId } = body as any;
    const driverUid = auth.uid;

    // Initialize Supabase client
    const supabase = getSupabaseServer();

    // Parallelize: fetch the flag, the active trip lock, and the driver profile in one shot
    const [flagResult, activeTripResult, driverData] = await Promise.all([
      supabase.from('waiting_flags').select('*').eq('id', flagId).single(),
      supabase.from('active_trips').select('trip_id').eq('driver_id', driverUid).eq('status', 'active').maybeSingle(),
      getDriverById(driverUid),
    ]);

    const { data: flagData, error: flagError } = flagResult;

    if (flagError || !flagData) {
      return NextResponse.json(
        { error: 'Waiting flag not found' },
        { status: 404 }
      );
    }

    const activeTrip = activeTripResult.data;
    const driverBusId = driverData?.bus_id || driverData?.busId;
    const driverClaimsBus = (activeTrip !== null && activeTrip?.trip_id) || driverBusId === flagData.bus_id;

    if (!driverClaimsBus) {
      console.error('Driver assignment validation failed:', { driverUid, busId: flagData.bus_id });
      return NextResponse.json(
        { error: 'Driver is not assigned to this bus' },
        { status: 403 }
      );
    }

    // Check current flag status for idempotency and state guards
    if (flagData.status === 'acknowledged') {
      return NextResponse.json({
        success: true,
        message: 'Flag already acknowledged',
        data: { flagId, studentUid: flagData.student_uid, ackByDriverUid: driverUid }
      });
    }
    if (['boarded', 'picked_up', 'cancelled', 'expired'].includes(flagData.status)) {
      return NextResponse.json({ error: `Cannot acknowledge flag that is already ${flagData.status}` }, { status: 400 });
    }

    // Update waiting flag status atomically
    const { data: updatedData, error: updateError } = await supabase
      .from('waiting_flags')
      .update({
        status: 'acknowledged',
        ack_by_driver_uid: driverUid
      })
      .eq('id', flagId)
      .in('status', ['raised', 'waiting'])
      .select();

    if (updateError) {
      console.error('Error acknowledging flag:', updateError);
      return NextResponse.json(
        { error: 'Failed to acknowledge flag' },
        { status: 500 }
      );
    }

    if (!updatedData || updatedData.length === 0) {
      return NextResponse.json(
        { success: true, message: 'Flag already processed or acknowledged', data: { flagId, studentUid: flagData.student_uid, ackByDriverUid: driverUid } }
      );
    }

    // Broadcast via WebSocket
    try {
      const ts = new Date().toISOString();
      await Promise.allSettled([
        emitEvent(`waiting_flags_${flagData.bus_id}`, 'waiting_flag_acknowledged', { flagId, studentUid: flagData.student_uid, status: 'acknowledged' }),
        emitEvent(`student_${flagData.student_uid}`, 'flag_acknowledged', { flagId, busId: flagData.bus_id, ackByDriverUid: driverUid, timestamp: ts, message: 'Driver has acknowledged your waiting flag!' }),
      ]);
    } catch (broadcastError) {
      console.error('Broadcast error (non-critical):', broadcastError);
    }

    console.log('✅ Flag acknowledged - student will see in-app toast via broadcast');

    return NextResponse.json({
      success: true,
      message: 'Flag acknowledged successfully',
      data: {
        flagId,
        studentUid: flagData.student_uid,
        ackByDriverUid: driverUid
      }
    });
  },
  {
    requiredRoles: ['driver'],
    schema: MarkBoardedSchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true
  }
);
