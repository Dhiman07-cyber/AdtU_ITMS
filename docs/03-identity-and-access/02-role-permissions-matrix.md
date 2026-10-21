# Role-Based Access Control (RBAC), Moderator Permission Matrix & Audit System (Forensic Truth)

**Module:** 6-Category Moderator Bitmasks, 60s LRU Cache, Realtime Session Eviction (`4401`) & University Audit Logs  
**File Authority:** `src/lib/auth/permissions.ts`, `src/lib/services/moderator-permission.service.ts`, `src/app/api/moderator/`  
**Database Tables:** `moderators`, `moderator_audit_logs`, `audit_events`  

---

# PART 4: Granular 6-Category Moderator RBAC Matrix, 60s LRU Cache & Instant Session Eviction (`4401`)

### 4.1 Sub-Domain Architecture & Exact Execution Pipeline

Moderators hold granular operational permissions divided into 6 distinct categories: `students`, `drivers`, `buses`, `routes`, `applications`, and `payments`.

```
Staff Request (with Bearer Token)
            │
            ▼
      withSecurity
            │
      Is role === 'moderator'?
            │
    ┌───────┴───────┐
   YES              NO ──> Proceed with standard role checks
    │
    ▼
isModeratorActive(uid)
    │
  Checks 60s LRU cache (backed by moderator_profiles.status)
    │
    ├─> status !== 'active' ──> REJECT with HTTP 403 ("Account suspended or inactive")
    │
    └─> status === 'active' ──> Check specific permission
                                  │
                                  ├─> requireModeratorPermission(auth, 'students', 'canReassign')
                                  │     ├─> ALLOW: Execute handler
                                  │     └─> DENY: Return HTTP 403 ("Moderator permission not granted")
```

---

### 4.2 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/lib/types/moderator-permissions.ts
// ============================================================================

export interface ModeratorPermissions {
  students: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;
  };
  drivers: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;
  };
  buses: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReassign: boolean;
  };
  routes: {
    canView: boolean;
    canAdd: boolean;
    canEdit: boolean;
    canDelete: boolean;
  };
  applications: {
    canView: boolean;
    canApprove: boolean;
    canReject: boolean;
    canGenerateVerificationCode: boolean;
    canAppearInModeratorList: boolean;
  };
  payments: {
    canApproveOfflinePayment: boolean;
    canRejectOfflinePayment: boolean;
  };
}

export const ZERO_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  students: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
  drivers: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
  buses: { canView: false, canAdd: false, canEdit: false, canDelete: false, canReassign: false },
  routes: { canView: false, canAdd: false, canEdit: false, canDelete: false },
  applications: { canView: false, canApprove: false, canReject: false, canGenerateVerificationCode: false, canAppearInModeratorList: false },
  payments: { canApproveOfflinePayment: false, canRejectOfflinePayment: false },
};
```

```typescript
// ============================================================================
// VERBATIM FROM src/lib/security/moderator-permissions.ts
// ============================================================================

import { getModeratorById } from '@/domains/identity';
import type { SecurityAuth } from '@/lib/security/api-security';
import {
	mergeWithDefaults,
	type ModeratorPermissions,
	ZERO_MODERATOR_PERMISSIONS,
} from '@/lib/types/moderator-permissions';
import { NextResponse } from 'next/server';

type PermissionCategory = keyof ModeratorPermissions;
type PermissionKey<C extends PermissionCategory> = keyof ModeratorPermissions[C];

const permissionCache = new Map<string, { permissions: ModeratorPermissions; expiresAt: number }>();
const PERMISSION_CACHE_TTL_MS = 60 * 1000; // 60 seconds

export async function getModeratorPermissions(uid: string): Promise<ModeratorPermissions> {
  const cached = permissionCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    permissionCache.delete(uid);
    permissionCache.set(uid, cached);
    return cached.permissions;
  }

  const moderator = await getModeratorById(uid);
  if (!moderator || (moderator.status && moderator.status !== 'active')) {
    permissionCache.set(uid, {
      permissions: ZERO_MODERATOR_PERMISSIONS,
      expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
    });
    return ZERO_MODERATOR_PERMISSIONS;
  }

  const permissions = mergeWithDefaults(
    moderator.permissions as Partial<ModeratorPermissions> | undefined
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

export async function isModeratorActive(uid: string): Promise<boolean> {
  const perms = await getModeratorPermissions(uid);
  const cached = permissionCache.get(uid);
  if (cached) {
    return perms !== ZERO_MODERATOR_PERMISSIONS;
  }
  const moderator = await getModeratorById(uid);
  return Boolean(moderator && (!moderator.status || moderator.status === 'active'));
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
```

---



---

# PART 8: Minimal High-Value Audit System & Human-Friendly University Terminology Overhaul

### 8.1 Sub-Domain Architecture & Exact Execution Pipeline

The audit subsystem (`src/domains/audit/`) writes to an immutable, append-only PostgreSQL table: `public.audit_events`.
- Exposes ONLY `pgInsertAuditEvent` and `pgQueryAuditEvents`.
- Intentionally omits `update`, `delete`, and `upsert` methods.
- Overrides harsh administrative terms with human-friendly university terminology:
  * Replaces `"Blocked"` or `"Suspended"` with: `"Service expired — dashboard & live tracking restricted until renewal"`.

---

### 8.2 Verbatim Source Code from Live Codebase

```typescript
// ============================================================================
// VERBATIM FROM src/domains/audit/repositories/audit.repository.pg.ts
// ============================================================================

export async function pgInsertAuditEvent(input: AuditEventInsert): Promise<string> {
  const db = getSupabaseServer();

  const row = {
    action: input.action,
    category: input.category,
    severity: input.severity,
    summary: input.summary || null,
    actor_id: input.actor_id,
    actor_name: input.actor_name || null,
    actor_role: input.actor_role,
    target_type: input.target_type || null,
    target_id: input.target_id || null,
    target_name: input.target_name || null,
    metadata: input.metadata || {},
  };

  const { data, error } = await db
    .from('audit_events')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    throw new Error(`AuditRepository (PG) insert failed: ${error.message}`);
  }

  return data.id as string;
}
```

---

