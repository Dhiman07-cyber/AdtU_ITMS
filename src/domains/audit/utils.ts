/**
 * Audit utility functions.
 *
 * resolveAuditActor — resolves an admin/moderator UID to their display name
 * and role by reading Firestore identity docs. Call BEFORE opening a
 * transaction (it performs reads).
 */
import { adminDb } from '@/lib/firebase-admin';
import type { AuditActorRole } from './services/audit.service.pg';

export async function resolveAuditActor(
  actorId: string
): Promise<{ name: string; role: AuditActorRole }> {
  try {
    const [adminSnap, modSnap] = await adminDb.getAll(
      adminDb.collection('admins').doc(actorId),
      adminDb.collection('moderators').doc(actorId)
    );

    if (adminSnap.exists) {
      const d = adminSnap.data();
      return { name: d?.fullName || d?.name || 'Admin', role: 'admin' };
    }
    if (modSnap.exists) {
      const d = modSnap.data();
      return { name: d?.fullName || d?.name || 'Moderator', role: 'moderator' };
    }
  } catch {
    // Fallback — identity lookup failure is non-critical
  }
  return { name: 'Unknown', role: 'admin' };
}
