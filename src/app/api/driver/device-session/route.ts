import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { DeviceSessionSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { invalidateCachedDeviceSession, setCachedDeviceSession } from '@/lib/services/device-session-cache';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { action, feature, deviceId } = body as any;
        const userId = auth.uid;

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        // Use service role key (bypasses RLS)
        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const supabase = getSupabaseServer();

        switch (action) {
            case 'check': {
                const { data, error } = await supabase
                    .from('device_sessions')
                    .select('device_id, last_active_at')
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
                const now = new Date();
                const nowIso = now.toISOString();
                const expiresAtIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
                const { error } = await supabase
                    .from('device_sessions')
                    .upsert({
                        user_id: userId,
                        device_id: deviceId,
                        feature: feature,
                        last_active_at: nowIso,
                        last_active: nowIso,
                        expires_at: expiresAtIso,
                        created_at: nowIso
                    }, {
                        onConflict: 'user_id,feature',
                        ignoreDuplicates: false
                    });

                if (error) {
                    console.error('Error registering device session:', error);
                    return NextResponse.json({ success: false, error: safeErrorMessage(error, 'Failed to register device session') }, { status: 500 });
                }

                if (feature === 'driver_location_share') {
                    setCachedDeviceSession(userId, deviceId, now.getTime());
                }

                return NextResponse.json({ success: true });
            }

            case 'heartbeat': {
                const now = new Date();
                const nowIso = now.toISOString();
                const expiresAtIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
                const { error } = await supabase
                    .from('device_sessions')
                    .update({
                        last_active_at: nowIso,
                        last_active: nowIso,
                        expires_at: expiresAtIso
                    })
                    .eq('user_id', userId)
                    .eq('feature', feature)
                    .eq('device_id', deviceId);

                if (error) {
                    console.error('Error heartbeating session:', error);
                    return NextResponse.json({ success: false, error: safeErrorMessage(error, 'Failed to update session') }, { status: 500 });
                }

                if (feature === 'driver_location_share') {
                    setCachedDeviceSession(userId, deviceId, now.getTime());
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

                if (feature === 'driver_location_share') {
                    invalidateCachedDeviceSession(userId);
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
