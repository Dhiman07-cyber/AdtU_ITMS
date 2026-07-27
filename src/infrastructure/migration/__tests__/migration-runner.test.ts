import { beforeEach,describe,expect,it } from 'vitest';
import { MigrationDefinition,MigrationRecord,MigrationStatus } from '../contracts';
import { MigrationRunner,MigrationStore } from '../migration-runner';

function createMockStore(): MigrationStore & { records: MigrationRecord[] } {
  return {
    records: [],
    async save(record: MigrationRecord) {
      const idx = this.records.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        this.records[idx] = record;
      } else {
        this.records.push(record);
      }
    },
    async findById(id: string) {
      return this.records.find((r) => r.id === id) || null;
    },
    async findAll() {
      return [...this.records];
    },
  };
}

describe('MigrationRunner', () => {
  let store: ReturnType<typeof createMockStore>;
  let runner: MigrationRunner;

  beforeEach(() => {
    store = createMockStore();
    runner = new MigrationRunner(store);
  });

  describe('run', () => {
    it('executes a successful migration', async () => {
      const definition: MigrationDefinition = {
        id: 'mig-1',
        version: '1.0.0',
        domainId: 'domain-1',
        description: 'Test migration',
        up: async () => ({
          success: true,
          recordsProcessed: 100,
          errors: [],
        }),
      };

      const result = await runner.run(definition);

      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(100);

      const record = await runner.getStatus('mig-1');
      expect(record?.status).toBe(MigrationStatus.COMPLETED);
      expect(record?.version).toBe('1.0.0');
    });

    it('handles failed migration', async () => {
      const definition: MigrationDefinition = {
        id: 'mig-1',
        version: '1.0.0',
        domainId: 'domain-1',
        description: 'Test migration',
        up: async () => ({
          success: false,
          recordsProcessed: 50,
          errors: ['Test error'],
        }),
      };

      const result = await runner.run(definition);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Test error');

      const record = await runner.getStatus('mig-1');
      expect(record?.status).toBe(MigrationStatus.FAILED);
      expect(record?.error).toBe('Test error');
    });

    it('handles thrown errors', async () => {
      const definition: MigrationDefinition = {
        id: 'mig-1',
        version: '1.0.0',
        domainId: 'domain-1',
        description: 'Test migration',
        up: async () => {
          throw new Error('Migration crashed');
        },
      };

      const result = await runner.run(definition);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Migration crashed');

      const record = await runner.getStatus('mig-1');
      expect(record?.status).toBe(MigrationStatus.FAILED);
    });

    it('records timing', async () => {
      const definition: MigrationDefinition = {
        id: 'mig-1',
        version: '1.0.0',
        domainId: 'domain-1',
        description: 'Test migration',
        up: async () => ({
          success: true,
          recordsProcessed: 0,
          errors: [],
        }),
      };

      await runner.run(definition);
      const record = await runner.getStatus('mig-1');

      expect(record?.startedAt).not.toBeNull();
      expect(record?.completedAt).not.toBeNull();
    });
  });

  describe('runAll', () => {
    it('runs multiple migrations sequentially', async () => {
      const definitions: MigrationDefinition[] = [
        {
          id: 'mig-1',
          version: '1.0.0',
          domainId: 'domain-1',
          description: 'First',
          up: async () => ({ success: true, recordsProcessed: 50, errors: [] }),
        },
        {
          id: 'mig-2',
          version: '1.0.1',
          domainId: 'domain-1',
          description: 'Second',
          up: async () => ({ success: true, recordsProcessed: 75, errors: [] }),
        },
      ];

      const results = await runner.runAll(definitions);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('stops on first failure', async () => {
      const definitions: MigrationDefinition[] = [
        {
          id: 'mig-1',
          version: '1.0.0',
          domainId: 'domain-1',
          description: 'Failing',
          up: async () => ({ success: false, recordsProcessed: 0, errors: ['Failed'] }),
        },
        {
          id: 'mig-2',
          version: '1.0.1',
          domainId: 'domain-1',
          description: 'Second',
          up: async () => ({ success: true, recordsProcessed: 75, errors: [] }),
        },
      ];

      const results = await runner.runAll(definitions);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
    });
  });

  describe('listMigrations', () => {
    it('lists all migrations', async () => {
      const definition: MigrationDefinition = {
        id: 'mig-1',
        version: '1.0.0',
        domainId: 'domain-1',
        description: 'Test',
        up: async () => ({ success: true, recordsProcessed: 0, errors: [] }),
      };

      await runner.run(definition);
      const migrations = await runner.listMigrations();

      expect(migrations).toHaveLength(1);
    });
  });
});
