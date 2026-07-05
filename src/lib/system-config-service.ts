import { adminDb } from '@/lib/firebase-admin';
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';
import { SETTINGS_COLLECTION } from '@/config/firestore-collections';

const SYSTEM_DOC = 'config';

// Define strict interface for what we store
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
    mapProvider?: 'guwahati';
    lastUpdated?: string;
    updatedBy?: string;
    [key: string]: any;
}

/**
 * Clean configuration object before storage
 * - Removes UI-only fields like 'icon', 'gradient'
 * - Limits history arrays
 */
function cleanConfigForStorage(config: any): any {
    const cleaned = stripUnsafeObjectKeys({ ...config });

    // Remove UI fields explicitly if they exist at top level or nested
    // Based on user request: "values like 'icon': 'Users', or 'gradient'..."
    const uiFields = ['icon', 'gradient', 'color', 'description', 'label']; // Common UI fields to strip from system config

    // Recursive clean or just top level? System config is usually flat-ish.
    // Let's stick to top-level and known sub-objects for now to avoid breaking things.
    for (const key of Object.keys(cleaned)) {
        if (uiFields.includes(key)) {
            delete cleaned[key];
        }
    }

    // Limit Bus Fee History
    if (cleaned.busFee && Array.isArray(cleaned.busFee.history)) {
        // Keep only the last 5 entries (User asked for "max-to-max only last history", let's keep 5 for safety/revert, or just 1 as strictly requested? 
        // User said: "ensure max-to-max only last history is stored to revert bus-fee" -> keeping last 1 means current + previous = 2 items? 
        // "last history is stored" usually implies the previous state.
        // Let's keep the last 2 entries (current + 1 previous) to be safe.
        const historyLen = cleaned.busFee.history.length;
        if (historyLen > 2) {
            cleaned.busFee.history = cleaned.busFee.history.slice(historyLen - 2);
        }
    }

    return cleaned;
}

/**
 * Get system configuration from Firestore
 * NO FALLBACK - Firestore is the single source of truth
 */
export async function getSystemConfig(): Promise<SystemConfig> {
    try {
        const docRef = adminDb.collection(SETTINGS_COLLECTION).doc(SYSTEM_DOC);
        const doc = await docRef.get();

        if (doc.exists) {
            return doc.data() as SystemConfig;
        }

        // NO FALLBACK allowed - config must exist in Firestore
        throw new Error('System configuration missing in database');
    } catch (error) {
        console.error('Error fetching system config:', error);
        // THROW to prevent usage of stale/hardcoded data
        throw new Error('Unstable network detected, please try again later');
    }
}

/**
 * Update system configuration in Firestore
 */
export async function updateSystemConfig(config: any, uid: string): Promise<any> {
    try {
        const cleanedConfig = cleanConfigForStorage(config);

        // Ensure metadata
        cleanedConfig.lastUpdated = new Date().toISOString();
        cleanedConfig.updatedBy = uid;

        await adminDb.collection(SETTINGS_COLLECTION).doc(SYSTEM_DOC).set(cleanedConfig, { merge: true });

        return cleanedConfig;
    } catch (error) {
        console.error('Error updating system config:', error);
        throw error;
    }
}
