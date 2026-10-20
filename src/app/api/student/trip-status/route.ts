import { requireTransportEntitlement } from '@/lib/entitlement/require-transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { TripStatusQuerySchema } from '@/lib/security/validation-schemas';
import { getStudentProfileAndShift } from '@/lib/student-shift-resolver';
import { getSupabaseServer } from '@/lib/supabase-server';
import { isShiftCompatible, isMatchingBusId } from '@/lib/utils';
import { getSharedBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import { NextResponse } from 'next/server';

/**
 * GET /api/student/trip-status
 * 
 * Check if there's an active trip for a given bus.
 * Uses service role key to bypass RLS policies.
 * Employs Singleflight deduplication and a 3s shared snapshot cache (Optimization 1).
 */
export const GET = withSecurity(
    async (request, { auth }) => {
        // Phase 3 — students may only see live trip status while they own transport
        // access. Staff (driver/admin/moderator) are exempt from this gate.
        let studentRecord: Record<string, any> | null = null;
        if (auth.role === 'student') {
            const gate = await requireTransportEntitlement(auth.uid);
            if (!gate.ok) return (gate as any).response;
            studentRecord = gate.student;
        }

        // Extract busId from URL parameters for GET request
        const url = new URL(request.url);
        const busId = url.searchParams.get('busId');

        if (!busId) {
            return NextResponse.json({
                tripActive: false,
                error: 'busId is required',
                tripData: null
            }, { status: 400 });
        }

        // Resolve student profile once — reused for both the bus-assignment security
        // check and the shift-compatibility check below.
        // PERF: Reuses the student record already loaded by requireTransportEntitlement()
        // to eliminate an unnecessary second PostgREST query to student_profiles.
        let studentProfile: { busId?: string | null; shift?: string | null } | null = null;
        if (auth.role === 'student') {
            if (studentRecord) {
                const { normalizeShift } = await import('@/lib/utils/shift-utils');
                studentProfile = {
                    busId: studentRecord.busId || studentRecord.bus_id || null,
                    shift: normalizeShift(studentRecord.shift),
                };
            } else {
                studentProfile = await getStudentProfileAndShift(auth.uid);
            }
            const studentBusId = studentProfile.busId;
            if (studentBusId && !isMatchingBusId(studentBusId, busId)) {
                return NextResponse.json({
                    tripActive: false,
                    error: 'Forbidden: You are not assigned to this bus',
                    tripData: null
                }, { status: 403 });
            }
        }

        // Optimization 1: Singleflight deduplication & 3-second shared bus snapshot.
        // If 60 students on the same bus reconnect or poll simultaneously, only 1 query
        // hits PostgreSQL; the other 59 resolve in <0.05ms from memory.
        const snapshot = await getSharedBusTripSnapshot(busId);

        if (!snapshot.tripActive || !snapshot.tripData) {
            return NextResponse.json({
                tripActive: false,
                tripData: null,
                activeWaitingFlag: null,
            });
        }

        // Check shift compatibility for student role using already-resolved profile.
        if (auth.role === 'student' && studentProfile) {
            if (studentProfile.shift && !isShiftCompatible(studentProfile.shift, snapshot.tripData.shift)) {
                return NextResponse.json({
                    tripActive: false,
                    tripData: null,
                    reason: 'shift_mismatch',
                    activeWaitingFlag: null,
                });
            }
        }

        let activeWaitingFlag: any = null;
        if (auth.role === 'student' && auth.uid) {
            activeWaitingFlag = snapshot.activeFlagsByStudentUid?.[auth.uid] || null;
        }

        return NextResponse.json({
            tripActive: true,
            tripData: snapshot.tripData,
            activeWaitingFlag,
        });
    },
    {
        requiredRoles: ['student', 'driver', 'admin', 'moderator'],
        schema: TripStatusQuerySchema,
        rateLimit: RateLimits.READ
    }
);
