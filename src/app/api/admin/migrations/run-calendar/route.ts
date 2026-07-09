/**
 * POST /api/admin/migrations/run-calendar
 *
 * Executes the D2 Calendar migration (Firestore → PostgreSQL).
 * Admin-only.  Idempotent — safe to call multiple times.
 *
 * Query params:
 *   ?action=run       (default) — run the migration
 *   ?action=validate  — validate PG matches Firestore without migrating
 *   ?action=rollback  — delete the PG row (rollback)
 *   ?action=status    — return current migration record from migration_log
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { MigrationRunner } from '@/infrastructure/migration/migration-runner';
import { SupabaseMigrationStore } from '@/infrastructure/migration/supabase-migration-store';
import { RollbackManager } from '@/infrastructure/migration/rollback-manager';
import { calendarMigration } from '@/domains/calendar/migrations/d2-calendar.migration';

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userDoc  = await adminDb.collection('users').doc(decoded.uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'admin') return null;
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

  const store   = new SupabaseMigrationStore();
  const runner  = new MigrationRunner(store);
  const rollback = new RollbackManager();

  switch (action) {
    // ── RUN ──────────────────────────────────────────────────────────────────
    case 'run': {
      const result = await runner.run(calendarMigration);
      return NextResponse.json({ action: 'run', result });
    }

    // ── VALIDATE ─────────────────────────────────────────────────────────────
    case 'validate': {
      if (!calendarMigration.validate) {
        return NextResponse.json({ action: 'validate', valid: true, errors: [] });
      }
      const validation = await calendarMigration.validate();
      return NextResponse.json({ action: 'validate', ...validation });
    }

    // ── ROLLBACK ─────────────────────────────────────────────────────────────
    case 'rollback': {
      if (!calendarMigration.down) {
        return NextResponse.json(
          { action: 'rollback', message: 'No rollback defined for this migration' },
          { status: 400 }
        );
      }
      rollback.register(calendarMigration.id, {
        canRollback: async () => true,
        rollback: () => calendarMigration.down!(),
      });
      const result = await rollback.rollback(calendarMigration.id);
      return NextResponse.json({ action: 'rollback', result });
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
    case 'status': {
      const record = await runner.getStatus(calendarMigration.id);
      return NextResponse.json({ action: 'status', record });
    }

    default:
      return NextResponse.json(
        { message: `Unknown action: ${action}. Use run | validate | rollback | status` },
        { status: 400 }
      );
  }
}
