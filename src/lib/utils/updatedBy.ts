import { getAdminById, getModeratorById, getUserById } from '@/domains/identity';

/**
 * Utility functions for managing the 'updatedBy' audit trail field
 * 
 * The updatedBy field is an array that tracks who modified a document and when.
 * Format for Admin: "{User-Name} ( Admin : Timestamp )"
 * Format for Moderator: "{User-Name} ( Employee-ID : Timestamp )"
 * Example: "Akash Deep ( Admin : 2026-01-26T23:00:00.000Z )"
 * Example: "John Doe ( EMP-123 : 2026-01-26T23:00:00.000Z )"
 */

/**
 * Creates a formatted updatedBy entry string
 */
export function createUpdatedByEntry(userName: string, roleOrEmployeeId: string = 'Admin'): string {
    const timestamp = new Date().toISOString();
    return `${userName} ( ${roleOrEmployeeId} : ${timestamp} )`;
}

/**
 * Creates the updatedBy array for new document creation
 */
export function getInitialUpdatedBy(userName: string, roleOrEmployeeId: string = 'Admin'): { updatedBy: string[] } {
    return {
        updatedBy: [createUpdatedByEntry(userName, roleOrEmployeeId)]
    };
}

/**
 * Returns Firestore FieldValue to append a new entry to the updatedBy array
 */
export function appendUpdatedBy(userName: string, roleOrEmployeeId: string = 'Admin'): { updatedBy: string[] } {
    return {
        updatedBy: [createUpdatedByEntry(userName, roleOrEmployeeId)]
    };
}

/**
 * Gets the user's display name for the updatedBy entry
 */
export function getUserDisplayName(userData: any): string {
    return userData?.fullName || userData?.name || userData?.email || 'Unknown User';
}

/**
 * Gets complete user info for updatedBy from admin/moderator document
 * Reads from PostgreSQL only — no Firestore dependency.
 */
export async function getUpdaterInfo(
    _adminDb: any,
    userId: string
): Promise<{ name: string; roleOrEmployeeId: string }> {
    const adminData = await getAdminById(userId);
    if (adminData) {
        return {
            name: (adminData as any).fullName || (adminData as any).name || 'Admin',
            roleOrEmployeeId: 'Admin'
        };
    }

    const modData = await getModeratorById(userId);
    if (modData) {
        return {
            name: (modData as any).fullName || (modData as any).name || 'Moderator',
            roleOrEmployeeId: (modData as any).employeeId || (modData as any).staffId || 'MOD'
        };
    }

    const userData = await getUserById(userId);
    if (userData) {
        return {
            name: (userData as any).fullName || (userData as any).name || (userData as any).email || 'Unknown User',
            roleOrEmployeeId: 'Unknown'
        };
    }

    return { name: 'Unknown User', roleOrEmployeeId: 'Unknown' };
}
