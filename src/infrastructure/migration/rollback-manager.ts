import { RollbackCapability, MigrationResult } from './contracts';

export class RollbackManager {
  private capabilities: Map<string, RollbackCapability> = new Map();

  register(migrationId: string, capability: RollbackCapability): void {
    this.capabilities.set(migrationId, capability);
  }

  async canRollback(migrationId: string): Promise<boolean> {
    const capability = this.capabilities.get(migrationId);
    if (!capability) return false;
    return capability.canRollback();
  }

  async rollback(migrationId: string): Promise<MigrationResult> {
    const capability = this.capabilities.get(migrationId);
    if (!capability) {
      return {
        success: false,
        recordsProcessed: 0,
        errors: [`No rollback capability registered for ${migrationId}`],
      };
    }
    return capability.rollback();
  }
}
