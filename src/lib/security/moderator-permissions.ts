import { getModeratorById } from '@/domains/identity';
import type { SecurityAuth } from '@/lib/security/api-security';
import {
	DEFAULT_MODERATOR_PERMISSIONS,
	type ModeratorPermissions,
} from '@/lib/types/moderator-permissions';
import { NextResponse } from 'next/server';

type PermissionCategory = keyof ModeratorPermissions;
type PermissionKey<C extends PermissionCategory> = keyof ModeratorPermissions[C];

const permissionCache = new Map<string, { permissions: ModeratorPermissions; expiresAt: number }>();
const PERMISSION_CACHE_TTL_MS = 60 * 1000;

function mergeWithDefaults(partial?: Partial<ModeratorPermissions>): ModeratorPermissions {
  return {
    students: { ...DEFAULT_MODERATOR_PERMISSIONS.students, ...(partial?.students || {}) },
    drivers: { ...DEFAULT_MODERATOR_PERMISSIONS.drivers, ...(partial?.drivers || {}) },
    buses: { ...DEFAULT_MODERATOR_PERMISSIONS.buses, ...(partial?.buses || {}) },
    routes: { ...DEFAULT_MODERATOR_PERMISSIONS.routes, ...(partial?.routes || {}) },
    applications: { ...DEFAULT_MODERATOR_PERMISSIONS.applications, ...(partial?.applications || {}) },
    payments: { ...DEFAULT_MODERATOR_PERMISSIONS.payments, ...(partial?.payments || {}) },
  };
}

export async function getModeratorPermissions(uid: string): Promise<ModeratorPermissions> {
  const cached = permissionCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.permissions;
  }

  const moderator = await getModeratorById(uid);
  const permissions = mergeWithDefaults(
    moderator?.permissions as Partial<ModeratorPermissions> | undefined
  );

  permissionCache.set(uid, {
    permissions,
    expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
  });

  if (permissionCache.size > 1000) {
    const firstKey = permissionCache.keys().next().value;
    if (firstKey) permissionCache.delete(firstKey);
  }

  return permissions;
}

export async function requireAdminPermission(
  auth: SecurityAuth,
  requestId?: string
): Promise<NextResponse | null> {
  if (auth.role === 'admin') return null;

  return NextResponse.json(
    { success: false, error: 'Insufficient permissions', requestId },
    { status: 403 }
  );
}

export async function requireModeratorPermission<C extends PermissionCategory>(
  auth: SecurityAuth,
  category: C,
  permission: PermissionKey<C>,
  requestId?: string
): Promise<NextResponse | null> {
  if (auth.role === 'admin') return null;

  if (auth.role !== 'moderator') {
    return NextResponse.json(
      { success: false, error: 'Insufficient permissions', requestId },
      { status: 403 }
    );
  }

  const permissions = await getModeratorPermissions(auth.uid);
  const allowed = Boolean(permissions[category]?.[permission]);

  if (allowed) return null;

  return NextResponse.json(
    { success: false, error: 'Moderator permission not granted', requestId },
    { status: 403 }
  );
}
