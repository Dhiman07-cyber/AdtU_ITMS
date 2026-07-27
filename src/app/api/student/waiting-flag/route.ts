import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { 
    WaitingFlagPostSchema, 
    WaitingFlagQuerySchema, 
    WaitingFlagDeleteSchema 
} from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { getByUid } from '@/domains/student';

/**
 * POST /api/student/waiting-flag
 *
 * Raises a waiting flag for a student.
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { busId, lat, lng, message, timestamp, routeId, stop_name, stopLat, stopLng } = body as any;
        const studentUid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Parallelize student profile fetch, duplicate flag check, and active trip lookup
        const [studentData, existingFlagRes, activeTripRes] = await Promise.all([
            getByUid(studentUid).catch(() => null),
            supabase.from('waiting_flags')
                .select('id')
                .eq('student_uid', studentUid)
                .eq('bus_id', busId)
                .in('status', ['raised', 'waiting', 'acknowledged'])
                .limit(1),
            supabase.from('active_trips')
                .select('trip_id')
                .eq('bus_id', busId)
                .eq('status', 'active')
                .maybeSingle()
        ]);

        if (!studentData) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

        // Phase 3 — raising a waiting flag is transport functionality; deny unless
        // the student currently owns transport access (canonical source of truth).
        const entitlement = getTransportEntitlement(studentData);
        if (!entitlement.entitled) {
            return NextResponse.json(
                { error: 'Transport access is not active for this account.', entitled: false, reason: entitlement.reason },
                { status: 403 }
            );
        }

        const studentBusId = studentData.busId || studentData.busId;
        
        if (!studentBusId || studentBusId !== busId) {
            return NextResponse.json({
                error: `Forbidden: You are not assigned to bus ${busId}. Your assigned bus is ${studentBusId || 'none'}.`
            }, { status: 403 });
        }

        if (existingFlagRes.data && existingFlagRes.data.length > 0) {
            return NextResponse.json({
                success: false,
                error: 'You already have an active waiting flag for this bus',
                existingFlagId: existingFlagRes.data[0].id
            }, { status: 409 });
        }

        // 2. Prepare flag data
        const currentTimestamp = timestamp || Date.now();
        const flagData: any = {
            student_uid: studentUid,
            student_name: studentData.fullName || studentData.name || 'Student',
            bus_id: busId,
            route_id: routeId || 'unknown',
            stop_name: stop_name || 'Unknown Stop',
            status: 'raised',
            trip_id: activeTripRes.data?.trip_id || null,
            created_at: new Date(currentTimestamp).toISOString(),
            message: message || null
        };

        // Determine coordinates
        if (lat !== undefined && lng !== undefined) {
            flagData.stop_lat = parseFloat(lat as any);
            flagData.stop_lng = parseFloat(lng as any);
        } else if (stopLat !== undefined && stopLng !== undefined) {
            flagData.stop_lat = parseFloat(stopLat as any);
            flagData.stop_lng = parseFloat(stopLng as any);
        } else {
            return NextResponse.json({ error: 'Location is required', code: 'LOCATION_REQUIRED' }, { status: 400 });
        }

        // 3. Atomic Insert
        const { data: insertData, error: insertError } = await supabase
            .from('waiting_flags')
            .insert(flagData)
            .select()
            .single();

        if (insertError) {
            console.error('Supabase insert error:', insertError);
            return NextResponse.json({ error: 'Failed to create waiting flag' }, { status: 500 });
        }

        // 4. Non-blocking Broadcast (Background)
        (async () => {
            try {
                const channel = supabase.channel(`waiting_flags_${busId}`);
                await channel.subscribe();
                await channel.send({
                    type: 'broadcast',
                    event: 'waiting_flag_created',
                    payload: insertData
                });
                await supabase.removeChannel(channel);
            } catch (err) {
                console.warn('Broadcast failed (non-critical):', err);
            }
        })();

        return NextResponse.json({
            success: true,
            flagId: insertData.id,
            flag: insertData
        });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagPostSchema,
        rateLimit: RateLimits.WAITING_FLAG,
        allowBodyToken: true
    }
);

/**
 * DELETE /api/student/waiting-flag
 * 
 * Cancels a waiting flag.
 */
export const DELETE = withSecurity(
    async (request, { auth, body }) => {
        const { flagId, busId } = body as any;
        const studentUid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Concurrent status update (audit-safe)
        const { data: updatedData, error: supabaseError } = await supabase
            .from('waiting_flags')
            .update({ status: 'cancelled' })
            .eq('id', flagId)
            .eq('student_uid', studentUid)
            .in('status', ['raised', 'acknowledged', 'waiting'])
            .select();

        if (supabaseError) {
            console.error('Supabase error:', supabaseError);
            return NextResponse.json({ error: 'Failed to cancel waiting flag' }, { status: 500 });
        }

        if (!updatedData || updatedData.length === 0) {
            return NextResponse.json({ error: 'Cannot cancel waiting flag that is already boarded, cancelled, or expired' }, { status: 409 });
        }

        // 2. Non-blocking Broadcast (Background)
        (async () => {
            try {
                const channel = supabase.channel(`waiting_flags_${busId}`);
                await channel.subscribe();
                await channel.send({
                    type: 'broadcast',
                    event: 'waiting_flag_removed',
                    payload: { flagId, studentUid }
                });
                await supabase.removeChannel(channel);
            } catch (err) {
                console.warn('Broadcast failed (non-critical):', err);
            }
        })();

        return NextResponse.json({ success: true });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagDeleteSchema,
        rateLimit: RateLimits.WAITING_FLAG,
        allowBodyToken: true
    }
);

/**
 * GET /api/student/waiting-flag
 * 
 * Fetches the current active flag for a student.
 */
export const GET = withSecurity(
    async (request, { auth, body }) => {
        const { studentUid } = body as any;
        const requesterUid = auth.uid;

        // SECURITY: IDOR prevention — students can only query their own flags
        if (requesterUid !== studentUid) {
            return NextResponse.json({ error: 'Forbidden: Cannot query another student\'s waiting flag' }, { status: 403 });
        }

        const supabase = getSupabaseServer();

        const { data, error } = await supabase
            .from('waiting_flags')
            .select('*')
            .eq('student_uid', studentUid)
            .in('status', ['waiting', 'raised', 'acknowledged'])
            .maybeSingle();

        if (error) {
            console.error('Error fetching waiting flag:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        return NextResponse.json({ data: data || null });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagQuerySchema,
        rateLimit: RateLimits.READ
    }
);