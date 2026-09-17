export const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production';

export const APP_NAME = isProduction ? "AdtU ItmS" : "ITMS Dev";
export const APP_ICON = isProduction ? "/Bus_Icon.png" : "/adtu-logo.png";
export const APP_VERSION = "v2.4.0";

export interface SystemConfig {
    appName: string;
    busFee: {
        amount: number;
        updatedAt?: string;
        updatedBy?: string;
        version?: number;
        history?: any[];
    };
    paymentExport?: {
        startYear: number;
        interval: number;
    };
    academicYearEnd?: string;
    renewalReminder?: string;
    renewalDeadline?: string;
    softBlock?: string;
    hardBlock?: string;
    version?: string;
    [key: string]: any;
}

let cachedConfig: SystemConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

export async function fetchSystemConfig(forceRefresh = false): Promise<SystemConfig> {
    if (!forceRefresh && cachedConfig && (Date.now() - cacheTimestamp < CACHE_TTL)) {
        return cachedConfig;
    }
    const res = await fetch('/api/settings/system-config');
    if (!res.ok) throw new Error('Failed to fetch system config');
    const data = await res.json();
    cachedConfig = data.config;
    cacheTimestamp = Date.now();
    return cachedConfig!;
}

export function getCachedSystemConfig(): SystemConfig | null {
    if (cachedConfig && (Date.now() - cacheTimestamp < CACHE_TTL)) {
        return cachedConfig;
    }
    return null;
}
