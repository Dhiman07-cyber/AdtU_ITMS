import {
  MigrationDefinition,
  MigrationResult,
  MigrationStatus,
  MigrationRecord,
} from './contracts';

export interface MigrationStore {
  save(record: MigrationRecord): Promise<void>;
  findById(id: string): Promise<MigrationRecord | null>;
  findAll(): Promise<MigrationRecord[]>;
}

export class MigrationRunner {
  constructor(private store: MigrationStore) {}

  async run(definition: MigrationDefinition): Promise<MigrationResult> {
    const record: MigrationRecord = {
      id: definition.id,
      version: definition.version,
      domainId: definition.domainId,
      status: MigrationStatus.RUNNING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };

    await this.store.save(record);

    try {
      const result = await definition.up();

      record.status = result.success
        ? MigrationStatus.COMPLETED
        : MigrationStatus.FAILED;
      record.completedAt = new Date().toISOString();
      record.error = result.errors.length > 0 ? result.errors.join('; ') : null;

      await this.store.save(record);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      record.status = MigrationStatus.FAILED;
      record.completedAt = new Date().toISOString();
      record.error = message;

      await this.store.save(record);

      return {
        success: false,
        recordsProcessed: 0,
        errors: [message],
      };
    }
  }

  async runAll(definitions: MigrationDefinition[]): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];

    for (const definition of definitions) {
      const result = await this.run(definition);
      results.push(result);

      if (!result.success) break;
    }

    return results;
  }

  async getStatus(id: string): Promise<MigrationRecord | null> {
    return this.store.findById(id);
  }

  async listMigrations(): Promise<MigrationRecord[]> {
    return this.store.findAll();
  }
}
