/**
 * SupabaseMigrationStore
 *
 * Implements the MigrationStore contract from Phase 4.1
 * using the existing Supabase server client (service-role key).
 *
 * Persists migration records to the `migration_log` table created
 * by 20260707_d2_calendar.sql.
 *
 * Infrastructure only — no business logic.
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { MigrationRecord } from './contracts';
import { MigrationStatus } from './contracts';
import type { MigrationStore } from './migration-runner';

export class SupabaseMigrationStore implements MigrationStore {
  private get db() {
    return getSupabaseServer();
  }

  async save(record: MigrationRecord): Promise<void> {
    const { error } = await this.db
      .from('migration_log')
      .upsert(
        {
          id:           record.id,
          version:      record.version,
          domain_id:    record.domainId,
          status:       record.status,
          started_at:   record.startedAt,
          completed_at: record.completedAt,
          error:        record.error,
        },
        { onConflict: 'id' }
      );

    if (error) {
      throw new Error(`SupabaseMigrationStore.save failed: ${error.message}`);
    }
  }

  async findById(id: string): Promise<MigrationRecord | null> {
    const { data, error } = await this.db
      .from('migration_log')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`SupabaseMigrationStore.findById failed: ${error.message}`);
    }
    if (!data) return null;

    return this.toRecord(data);
  }

  async findAll(): Promise<MigrationRecord[]> {
    const { data, error } = await this.db
      .from('migration_log')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`SupabaseMigrationStore.findAll failed: ${error.message}`);
    }

    return (data ?? []).map(this.toRecord);
  }

  // ─── Mapper ─────────────────────────────────────────────────────────────────
  private toRecord(row: Record<string, any>): MigrationRecord {
    return {
      id:          row.id,
      version:     row.version,
      domainId:    row.domain_id,
      status:      row.status as MigrationStatus,
      startedAt:   row.started_at ?? null,
      completedAt: row.completed_at ?? null,
      error:       row.error ?? null,
    };
  }
}
