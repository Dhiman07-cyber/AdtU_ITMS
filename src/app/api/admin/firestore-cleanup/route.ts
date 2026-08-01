import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema,FirestoreCleanupSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * DATABASE CLEANUP ROUTE (SUPABASE + FIRESTORE)
 * 
 * Target storage: Supabase (Operational data)
 * Target storage: Firestore (Legacy/Backup data)
 */
export const POST = withSecurity(
    async (request, { body }) => {
        const { cleanupType, daysOld } = body as any;
        const cleanupDays = daysOld || 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - cleanupDays);
        const isoCutoff = cutoffDate.toISOString();

        console.log(`🧹 Starting Database cleanup: ${cleanupType}, older than ${cleanupDays} days`);
        
        // Initialize Supabase client
        const supabase = getSupabaseServer();

        let results: any = {};

        // 1. Clean Active Trips / Sessions
        if (cleanupType === 'active_trips' || cleanupType === 'all') {
            const { count, error } = await supabase
                .from('active_trips')
                .delete({ count: 'exact' })
                .lt('start_time', isoCutoff);
            
            if (error) console.error('Error cleaning active_trips:', error);
            results.activeTripsDeleted = count || 0;

            // Also clean legacy Firestore trip_sessions
            try {
                const oldTripsSnapshot = await adminDb.collection('trip_sessions').where('endedAt', '<', cutoffDate).limit(400).get();
                if (oldTripsSnapshot.size > 0) {
                    const batch = adminDb.batch();
                    oldTripsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
                    await batch.commit();
                    results.firestoreTripSessionsDeleted = oldTripsSnapshot.size;
                }
            } catch (fsError) {
                console.warn('Firestore trip_sessions cleanup non-critical error:', fsError);
            }
        }

        // 2. Clean Reassignment / Audit Logs
        if (cleanupType === 'reassignment_logs' || cleanupType === 'all') {
            const { count, error } = await supabase
                .from('reassignment_logs')
                .delete({ count: 'exact' })
                .lt('created_at', isoCutoff);
            
            if (error) console.error('Error cleaning reassignment_logs:', error);
            results.reassignmentLogsDeleted = count || 0;
        }

        // 3. Clean Waiting Flags
        if (cleanupType === 'waiting_flags' || cleanupType === 'all') {
            const { count, error } = await supabase
                .from('waiting_flags')
                .delete({ count: 'exact' })
                .lt('created_at', isoCutoff);
            
            if (error) console.error('Error cleaning waiting_flags:', error);
            results.waitingFlagsDeleted = count || 0;
        }

        return NextResponse.json({
            success: true,
            message: `Database cleanup completed for ${cleanupType}`,
            results,
            cleanupDays,
            cutoffDate: isoCutoff
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: FirestoreCleanupSchema,
        rateLimit: RateLimits.CREATE,
        allowBodyToken: true
    }
);

export const GET = withSecurity(
    async () => {
        // Initialize Supabase client
        const supabase = getSupabaseServer();

        // Get counts from Supabase
        const [
            { count: activeTrips },
            { count: reassignmentLogs },
            { count: tripHistory },
            { count: waitingFlags }
        ] = await Promise.all([
            supabase.from('active_trips').select('*', { count: 'exact', head: true }),
            supabase.from('reassignment_logs').select('*', { count: 'exact', head: true }),
            supabase.from('driver_trip_history').select('*', { count: 'exact', head: true }),
            supabase.from('waiting_flags').select('*', { count: 'exact', head: true })
        ]);

        return NextResponse.json({
            success: true,
            stats: {
                activeTrips: activeTrips || 0,
                reassignmentLogs: reassignmentLogs || 0,
                tripHistory: tripHistory || 0,
                waitingFlags: waitingFlags || 0,
                total: (activeTrips || 0) + (reassignmentLogs || 0) + (tripHistory || 0) + (waitingFlags || 0)
            }
        });
    },
    {
        requiredRoles: ['admin', 'moderator'],
        schema: EmptySchema,
        rateLimit: RateLimits.READ
    }
);

