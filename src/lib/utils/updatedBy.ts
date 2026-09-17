import { getAdminById,getModeratorById,getUserById } from '@/domains/identity';

// ponytail: only getUpdaterInfo is used externally — 4 dead exports removed

export async function getUpdaterInfo(
    userId: string
): Promise<{ name: string; roleOrEmployeeId: string }> {
    const [adminData, modData, userData] = await Promise.all([
        getAdminById(userId),
        getModeratorById(userId),
        getUserById(userId),
    ]);

    if (adminData) {
        return {
            name: (adminData as any).fullName || (adminData as any).name || 'Admin',
            roleOrEmployeeId: 'Admin'
        };
    }

    if (modData) {
        return {
            name: (modData as any).fullName || (modData as any).name || 'Moderator',
            roleOrEmployeeId: (modData as any).employeeId || (modData as any).staffId || 'MOD'
        };
    }

    if (userData) {
        return {
            name: (userData as any).fullName || (userData as any).name || (userData as any).email || 'Unknown User',
            roleOrEmployeeId: (userData as any).role || 'Unknown'
        };
    }

    return { name: 'Unknown User', roleOrEmployeeId: 'Unknown' };
}
