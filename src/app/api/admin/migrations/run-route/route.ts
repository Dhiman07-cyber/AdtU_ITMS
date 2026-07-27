/**
 * POST /api/admin/migrations/run-route
 *
 * Executes the D7 Route migration (Firestore → PostgreSQL).
 * Admin-only. Idempotent — safe to call multiple times.
 *
 * Query params:
 *   ?action=run       (default) — run the migration
 *   ?action=validate  — validate PG matches Firestore without migrating
 *   ?action=rollback  — delete the PG row (rollback)
 *   ?action=status    — return current migration record from migration_log
 */
import { routeMigration } from '@/domains/route/migrations/d7-route.migration';
import { MigrationRunner } from '@/infrastructure/migration/migration-runner';
import { RollbackManager } from '@/infrastructure/migration/rollback-manager';
import { SupabaseMigrationStore } from '@/infrastructure/migration/supabase-migration-store';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { NextRequest,NextResponse } from 'next/server';

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userRole = await resolveUserRole(decoded.uid);
    if (userRole.role !== 'admin') return null;
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const uid = await requireAdmin(req);
  if (!uid) {
    return NextResponse.json({ message: 'Unauthorized — admin only' }, { status: 403 });
  }

  const action = req.nextUrl.searchParams.get('action') ?? 'run';

  const store = new SupabaseMigrationStore();
  const runner = new MigrationRunner(store);
  const rollback = new RollbackManager();

  switch (action) {
    // ── RUN ──────────────────────────────────────────────────────────────────
    case 'run': {
      const result = await runner.run(routeMigration);
      return NextResponse.json({ action: 'run', result });
    }

    // ── VALIDATE ─────────────────────────────────────────────────────────────
    case 'validate': {
      if (!routeMigration.validate) {
        return NextResponse.json({ action: 'validate', valid: true, errors: [] });
      }
      const validation = await routeMigration.validate();
      return NextResponse.json({ action: 'validate', ...validation });
    }

    // ── ROLLBACK ─────────────────────────────────────────────────────────────
    case 'rollback': {
      if (!routeMigration.down) {
        return NextResponse.json(
          { action: 'rollback', message: 'No rollback defined for this migration' },
          { status: 400 }
        );
      }
      rollback.register(routeMigration.id, {
        canRollback: async () => true,
        rollback: () => routeMigration.down!(),
      });
      const result = await rollback.rollback(routeMigration.id);
      return NextResponse.json({ action: 'rollback', result });
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
    case 'status': {
      const record = await runner.getStatus(routeMigration.id);
      return NextResponse.json({ action: 'status', record });
    }

    default:
      return NextResponse.json(
        { message: `Unknown action: ${action}. Use run | validate | rollback | status` },
        { status: 400 }
      );
  }
}
