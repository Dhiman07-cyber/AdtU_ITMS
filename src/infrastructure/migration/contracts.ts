export enum MigrationStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface MigrationDefinition {
  id: string;
  version: string;
  domainId: string;
  description: string;
  up: () => Promise<MigrationResult>;
  down?: () => Promise<MigrationResult>;
  validate?: () => Promise<ValidationResult>;
}

export interface MigrationResult {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface MigrationRecord {
  id: string;
  version: string;
  domainId: string;
  status: MigrationStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface RollbackCapability {
  canRollback(): Promise<boolean>;
  rollback(): Promise<MigrationResult>;
}
