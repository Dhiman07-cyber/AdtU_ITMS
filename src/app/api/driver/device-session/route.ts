import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { DeviceSessionSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * POST /api/driver/device-session
 * 
 * Server-side device session management using service_role key.
 * This bypasses RLS to avoid "permission denied for table device_sessions" errors.
 * 
 * Body: { action, feature, deviceId }
 * action: 'check' | 'register' | 'heartbeat' | 'release'
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { action, feature, deviceId } = body as any;
        const userId = auth.uid;

        // Use service role key (bypasses RLS)
        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const supabase = getSupabaseServer();

        switch (action) {
            case 'check': {
                const { data, error } = await supabase
                    .from('device_sessions')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('feature', feature)
                    .order('last_active_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (error || !data) {
                    if (error) console.error('Error checking device session:', error);
                    return NextResponse.json({ isCurrentDevice: true, hasActiveSession: false });
                }

                // Check if session is still valid (within last 30 seconds)
                const sessionAge = Date.now() - new Date(data.last_active_at).getTime();
                const SESSION_TIMEOUT_MS = 30000;

                if (sessionAge > SESSION_TIMEOUT_MS) {
                    return NextResponse.json({ isCurrentDevice: true, hasActiveSession: false });
                }

                const isCurrentDevice = data.device_id === deviceId;
                return NextResponse.json({
                    isCurrentDevice,
                    hasActiveSession: true,
                    otherDeviceId: isCurrentDevice ? undefined : data.device_id,
                    sessionAge
                });
            }

            case 'register': {
                const now = new Date().toISOString();
                const { error } = await supabase
                    .from('device_sessions')
                    .upsert({
                        user_id: userId,
                        device_id: deviceId,
                        feature: feature,
                        last_active_at: now,
                        created_at: now
                    }, {
                        onConflict: 'user_id,feature',
                        ignoreDuplicates: false
                    });

                if (error) {
                    console.error('Error registering device session:', error);
                    return NextResponse.json({ success: false, error: safeErrorMessage(error, 'Failed to register device session') }, { status: 500 });
                }

                return NextResponse.json({ success: true });
            }

            case 'heartbeat': {
                const { error } = await supabase
                    .from('device_sessions')
                    .update({ last_active_at: new Date().toISOString() })
                    .eq('user_id', userId)
                    .eq('feature', feature)
                    .eq('device_id', deviceId);

                if (error) {
                    console.error('Error heartbeating session:', error);
                    return NextResponse.json({ success: false, error: safeErrorMessage(error, 'Failed to update session') }, { status: 500 });
                }

                return NextResponse.json({ success: true });
            }

            case 'release': {
                const { error } = await supabase
                    .from('device_sessions')
                    .delete()
                    .eq('user_id', userId)
                    .eq('feature', feature)
                    .eq('device_id', deviceId);

                if (error) {
                    console.error('Error releasing session:', error);
                    return NextResponse.json({ success: false, error: safeErrorMessage(error, 'Failed to release session') }, { status: 500 });
                }

                return NextResponse.json({ success: true });
            }

            default:
                return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    },
    {
        requiredRoles: ['driver'],
        schema: DeviceSessionSchema,
        rateLimit: RateLimits.LOCATION_UPDATE, // High frequency for heartbeats
        allowBodyToken: true
    }
);
