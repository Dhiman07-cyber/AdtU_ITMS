import { describe, it, expect, beforeEach } from 'vitest';
import { RollbackManager } from '../rollback-manager';

describe('RollbackManager', () => {
  let manager: RollbackManager;

  beforeEach(() => {
    manager = new RollbackManager();
  });

  describe('canRollback', () => {
    it('returns false when no capability registered', async () => {
      const canRollback = await manager.canRollback('mig-1');
      expect(canRollback).toBe(false);
    });
  });

  describe('rollback', () => {
    it('returns error when no capability registered', async () => {
      const result = await manager.rollback('mig-1');
      expect(result.success).toBe(false);
      expect(result.errors).toContain('No rollback capability registered for mig-1');
    });
  });

  describe('register', () => {
    it('registers and uses a capability', async () => {
      manager.register('mig-1', {
        canRollback: async () => true,
        rollback: async () => ({
          success: true,
          recordsProcessed: 10,
          errors: [],
        }),
      });

      const canRollback = await manager.canRollback('mig-1');
      expect(canRollback).toBe(true);

      const result = await manager.rollback('mig-1');
      expect(result.success).toBe(true);
      expect(result.recordsProcessed).toBe(10);
    });

    it('respects canRollback returning false', async () => {
      manager.register('mig-1', {
        canRollback: async () => false,
        rollback: async () => ({
          success: true,
          recordsProcessed: 0,
          errors: [],
        }),
      });

      const canRollback = await manager.canRollback('mig-1');
      expect(canRollback).toBe(false);
    });
  });
});
