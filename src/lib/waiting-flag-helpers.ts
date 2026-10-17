/**
 * Waiting Flag Expiry Guard
 * Authoritative 15-minute TTL evaluator for student waiting flags.
 * Handles valid ISO strings, missing/null values, and malformed (NaN) timestamps.
 */

export function isWaitingFlagExpired(
    flag: {
        expires_at?: string | null;
        created_at?: string | null;
    } | null | undefined,
    ttlMs: number = 15 * 60 * 1000
): boolean {
    if (!flag) return true;

    // 1. Check explicit expires_at timestamp if present
    if (flag.expires_at) {
        const expTime = new Date(flag.expires_at).getTime();
        if (!Number.isNaN(expTime)) {
            return expTime <= Date.now();
        }
        // Malformed expires_at string (NaN) -> fall through to created_at check
    }

    // 2. Fallback: Check created_at + 15m TTL if present
    if (flag.created_at) {
        const createTime = new Date(flag.created_at).getTime();
        if (!Number.isNaN(createTime)) {
            return (createTime + ttlMs) <= Date.now();
        }
        // Malformed created_at string (NaN)
        console.warn('[WaitingFlag] Malformed created_at timestamp encountered:', flag.created_at);
        return true;
    }

    // 3. Fail closed: If neither valid expires_at nor valid created_at exists, the record is malformed/unanchored
    console.warn('[WaitingFlag] Flag record missing valid temporal boundaries; failing closed as expired');
    return true;
}
