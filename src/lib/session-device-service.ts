import { getCrypto } from '@/lib/security/random-id';

/**
 * Session Device Service
 * 
 * Handles single-device session management for:
 * 1. Driver live location sharing (only one device can broadcast at a time)
 * 2. Student live location viewing (only one device can view at a time)
 * 
 * Uses server-side API route with Supabase service_role key to bypass RLS.
 */

/**
 * Generate a unique device ID for the current browser/device
 * Persists in localStorage to maintain consistency across page refreshes
 */
export function getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') return 'server-side';

    const STORAGE_KEY = 'adtu_device_id';
    let deviceId = localStorage.getItem(STORAGE_KEY);

    if (!deviceId) {
        const cryptoObj = getCrypto();
        if (cryptoObj?.randomUUID) {
            deviceId = cryptoObj.randomUUID();
        } else if (cryptoObj?.getRandomValues) {
            const array = new Uint8Array(16);
            cryptoObj.getRandomValues(array);
            deviceId = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        } else {
            deviceId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        }
        localStorage.setItem(STORAGE_KEY, deviceId);
    }

    return deviceId;
}

/**
 * Helper to get the current user's ID token for API calls
 */
async function getIdToken(): Promise<string | null> {
    try {
        // Try to get token from Firebase Auth
        const { getAuth } = await import('firebase/auth');
        const auth = getAuth();
        const user = auth.currentUser;
        if (user) {
            return await user.getIdToken();
        }
    } catch {
        // Firebase not initialized or user not signed in
    }
    return null;
}

/**
 * Make API call to device-session endpoint
 */
async function callDeviceSessionAPI(
    action: string,
    userId: string,
    feature: 'driver_location_share' | 'student_location_view',
    idToken?: string | null
): Promise<any> {
    const deviceId = getOrCreateDeviceId();

    if (!idToken) {
        idToken = await getIdToken();
    }

    if (!idToken) {
        console.warn('No ID token available for device session API');
        return null;
    }

    const response = await fetch('/api/driver/device-session', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
            idToken,
            action,
            feature,
            deviceId
        })
    });

    return response.json();
}

export interface DeviceSessionCheckResult {
    isCurrentDevice: boolean;
    hasActiveSession: boolean;
    otherDeviceId?: string;
    sessionAge?: number;
    serviceUnavailable?: boolean;
    error?: string;
}

/**
 * Check if current device has an active session for a feature
 * Fails closed by default to prevent unauthorized session hijacking during network partitions.
 */
export async function checkDeviceSession(
    userId: string,
    feature: 'driver_location_share' | 'student_location_view',
    failClosed: boolean = true
): Promise<DeviceSessionCheckResult> {
    try {
        const result = await callDeviceSessionAPI('check', userId, feature);

        if (!result || result.error) {
            if (failClosed) {
                console.warn(`[DeviceSession] Service check failed for ${userId}/${feature}, failing closed.`);
                return { isCurrentDevice: false, hasActiveSession: true, serviceUnavailable: true, error: result?.error || 'Service unavailable' };
            }
            return { isCurrentDevice: true, hasActiveSession: false, serviceUnavailable: true };
        }

        return {
            isCurrentDevice: result.isCurrentDevice ?? false,
            hasActiveSession: result.hasActiveSession ?? false,
            otherDeviceId: result.otherDeviceId,
            sessionAge: result.sessionAge
        };
    } catch (err: any) {
        console.error('Exception checking device session:', err);
        if (failClosed) {
            return { isCurrentDevice: false, hasActiveSession: true, serviceUnavailable: true, error: err?.message || 'Network error' };
        }
        return { isCurrentDevice: true, hasActiveSession: false, serviceUnavailable: true };
    }
}

/**
 * Register/update device session for a feature
 * This claims the session for the current device
 */
export async function registerDeviceSession(
    userId: string,
    feature: 'driver_location_share' | 'student_location_view'
): Promise<{ success: boolean; error?: string }> {
    try {
        const result = await callDeviceSessionAPI('register', userId, feature);

        if (!result) {
            return { success: false, error: 'No response from server' };
        }

        return { success: result.success ?? false, error: result.error };
    } catch (err: any) {
        console.error('Exception registering device session:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Keep session alive by updating last_active_at
 * Should be called periodically (every 5-10 seconds) while feature is active
 */
export async function heartbeatDeviceSession(
    userId: string,
    feature: 'driver_location_share' | 'student_location_view'
): Promise<boolean> {
    try {
        const result = await callDeviceSessionAPI('heartbeat', userId, feature);
        return result?.success ?? false;
    } catch (err) {
        console.error('Exception heartbeating session:', err);
        return false;
    }
}

/**
 * Release device session when feature is no longer being used
 */
export async function releaseDeviceSession(
    userId: string,
    feature: 'driver_location_share' | 'student_location_view'
): Promise<void> {
    try {
        await callDeviceSessionAPI('release', userId, feature);
    } catch (err) {
        console.error('Exception releasing session:', err);
    }
}

/**
 * Hook to manage device session with automatic heartbeat
 * Usage: useDeviceSession(userId, 'driver_location_share', isActive)
 */
export function createDeviceSessionManager(
    userId: string,
    feature: 'driver_location_share' | 'student_location_view',
    onConflict?: (otherDeviceId: string) => void
) {
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isActive = false;

    const start = async () => {
        if (isActive) return true;

        // Check if another device is active
        const check = await checkDeviceSession(userId, feature);

        if (check.hasActiveSession && !check.isCurrentDevice) {
            // Another device is active
            if (onConflict && check.otherDeviceId) {
                onConflict(check.otherDeviceId);
            }
            return false;
        }

        // Register this device
        const result = await registerDeviceSession(userId, feature);
        if (!result.success) {
            return false;
        }

        isActive = true;

        // Start heartbeat (every 10 seconds)
        heartbeatInterval = setInterval(() => {
            heartbeatDeviceSession(userId, feature);
        }, 10000);

        return true;
    };

    const stop = async () => {
        isActive = false;

        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        await releaseDeviceSession(userId, feature);
    };

    const checkStatus = async () => {
        return checkDeviceSession(userId, feature);
    };

    return { start, stop, checkStatus };
}
