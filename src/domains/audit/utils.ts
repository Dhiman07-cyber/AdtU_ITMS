/**
 * Audit utility functions.
 *
 * resolveAuditActor — resolves an admin/moderator UID to their display name
 * and role by reading PostgreSQL identity tables.
 */
import { getAdminById,getModeratorById } from '@/domains/identity';
import type { AuditActorRole } from './services/audit.service.pg';

export async function resolveAuditActor(
  actorId: string
): Promise<{ name: string; role: AuditActorRole }> {
  try {
    const admin = await getAdminById(actorId);
    if (admin) {
      return { name: admin.fullName || admin.name || 'Admin', role: 'admin' };
    }

    const moderator = await getModeratorById(actorId);
    if (moderator) {
      return { name: moderator.fullName || moderator.name || 'Moderator', role: 'moderator' };
    }
  } catch (error) {
    console.error('Failed to resolve audit actor:', error);
    // Fallback — identity lookup failure is non-critical
  }
  return { name: 'Unknown', role: 'admin' };
}
