import { getAdminById,getModeratorById,getUserById } from '@/domains/identity';

// ponytail: only getUpdaterInfo is used externally — 4 dead exports removed

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
