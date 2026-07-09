import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { WaitingFlagPostSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getByUid } from '@/domains/student';

// Initialize Supabase client
const supabase = getSupabaseServer();

/**
 * GPS Accuracy Validator
 */
const isValidAccuracy = (accuracy: number) => accuracy >= 0 && accuracy <= 1000;

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    const startTime = Date.now();
    const studentUid = auth.uid;
    const {
      busId,
      routeId,
      stopName,
      accuracy,
      message
    } = body;

    try {
      // 1. Validate GPS accuracy (trusted from body)
      if (!isValidAccuracy(accuracy)) {
        return NextResponse.json({ success: false, error: 'Invalid GPS accuracy (must be 0-1000m)', requestId }, { status: 400 });
      }

      // 2. Resolve student profile and verify role
      const studentData = await getByUid(studentUid) as Record<string, any> | null;
      if (!studentData) {
        console.warn(`[${requestId}] Student profile not found for ${studentUid}`);
        return NextResponse.json({ success: false, error: 'Student profile not found', requestId }, { status: 404 });
      }

      const studentName = studentData.fullName || studentData.name || 'Student';

      // 3. Authorization: Is student assigned to this bus?
      const isAssigned = studentData.assignedBusId === busId || studentData.busId === busId;
      if (!isAssigned) {
        return NextResponse.json({ success: false, error: 'Authorization failed: Student not assigned to this bus', requestId }, { status: 403 });
      }

      // 4. Check for active trip in Supabase (authoritative source)
      const { data: activeTrip, error: tripError } = await supabase
        .from('active_trips')
        .select('trip_id')
        .eq('bus_id', busId)
        .eq('status', 'active')
        .single();

      if (tripError || !activeTrip) {
        return NextResponse.json({ success: false, error: 'This bus is not currently on an active trip', requestId }, { status: 400 });
      }

      const tripId = activeTrip.trip_id;

      // 5. Duplicate Check
      const { data: existingFlags } = await supabase
        .from('waiting_flags')
        .select('id')
        .eq('student_uid', studentUid)
        .eq('bus_id', busId)
        .in('status', ['raised', 'acknowledged'])
        .limit(1);

      if (existingFlags && existingFlags.length > 0) {
        return NextResponse.json({ 
          success: false, 
          error: 'You already have an active waiting flag for this bus', 
          requestId,
          flagId: existingFlags[0].id 
        }, { status: 409 });
      }

      // 6. Create Waiting Flag
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 min expiry

      const flagData = {
        student_uid: studentUid,
        student_name: studentName,
        bus_id: busId,
        route_id: routeId,
        stop_name: stopName || 'Current Location',
        accuracy,
        status: 'raised',
        message: message || null,
        trip_id: tripId,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString()
      };

      const { data: flag, error: insertError } = await supabase
        .from('waiting_flags')
        .insert(flagData)
        .select()
        .single();

      if (insertError) {
        console.error(`[${requestId}] Supabase insert error:`, insertError);
        return NextResponse.json({ success: false, error: 'Failed to record waiting flag', requestId }, { status: 500 });
      }

      // 7. Real-time Broadcast to Driver
      try {
        const channel = supabase.channel(`waiting_flags_${busId}`);
        await channel.send({
          type: 'broadcast',
          event: 'waiting_flag_created',
          payload: {
            flagId: flag.id,
            studentUid,
            studentName,
            stopName: flagData.stop_name,
            accuracy,
            message: flagData.message,
            timestamp: flagData.created_at
          }
        });
      } catch (broadcastError) {
        console.warn(`[${requestId}] Real-time broadcast failed (non-critical):`, broadcastError);
      }

      // 8. Legacy Backup (Firestore) - opportunistic
      try {
        await adminDb.collection('waiting_flags').doc(flag.id).set({
          ...flagData,
          supabaseId: flag.id,
          syncedAt: now.toISOString()
        });
      } catch (backupErr) {
        console.warn(`[${requestId}] Firestore backup write failed (non-critical, Supabase is source of truth):`, backupErr);
      }

      const elapsed = Date.now() - startTime;
      console.log(`✅ [${requestId}] Waiting flag ${flag.id} created in ${elapsed}ms`);

      return NextResponse.json({
        success: true,
        flagId: flag.id,
        message: 'Waiting flag raised successfully. The driver has been notified.',
        expiresAt: expiresAt.toISOString(),
        requestId
      });

    } catch (error: any) {
      console.error(`[${requestId}] Internal error in waiting-flag/create:`, error);
      return NextResponse.json({ success: false, error: 'An unexpected error occurred', requestId }, { status: 500 });
    }
  },
  {
    requiredRoles: ['student'],
    schema: WaitingFlagPostSchema,
    rateLimit: RateLimits.CREATE
  }
);
