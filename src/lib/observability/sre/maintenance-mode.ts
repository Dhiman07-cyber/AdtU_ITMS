/**
 * PROGRAM-004 / PHASE-05: Maintenance Mode & System Readiness Management
 */

import { logger } from '../logger';

export interface MaintenanceStatus {
  enabled: boolean;
  readOnly: boolean;
  draining: boolean;
  reason?: string;
  activatedAt?: string;
  activatedBy?: string;
  estimatedDurationMinutes?: number;
  maintenanceBannerMessage?: string;
}

export class MaintenanceManager {
  private status: MaintenanceStatus = {
    enabled: false,
    readOnly: false,
    draining: false,
  };

  /**
   * Enables maintenance mode
   */
  public enableMaintenance(options: {
    readOnly?: boolean;
    reason: string;
    activatedBy: string;
    durationMinutes?: number;
    bannerMessage?: string;
  }): MaintenanceStatus {
    this.status = {
      enabled: true,
      readOnly: options.readOnly ?? true,
      draining: true,
      reason: options.reason,
      activatedAt: new Date().toISOString(),
      activatedBy: options.activatedBy,
      estimatedDurationMinutes: options.durationMinutes ?? 30,
      maintenanceBannerMessage:
        options.bannerMessage ??
        'The platform is currently undergoing scheduled maintenance. Write operations are disabled.'
    };

    logger.warn('sre_maintenance', 'maintenance_enabled', {
      reason: options.reason,
      activatedBy: options.activatedBy,
      readOnly: this.status.readOnly
    });

    return { ...this.status };
  }

  /**
   * Disables maintenance mode and restores normal operation
   */
  public disableMaintenance(): MaintenanceStatus {
    const previousReason = this.status.reason;

    this.status = {
      enabled: false,
      readOnly: false,
      draining: false
    };

    logger.info('sre_maintenance', 'maintenance_disabled', { previousReason });

    return { ...this.status };
  }

  /**
   * Returns current maintenance status
   */
  public getStatus(): MaintenanceStatus {
    return { ...this.status };
  }

  /**
   * Check if write operations should be blocked
   */
  public isWriteBlocked(): boolean {
    return this.status.enabled && this.status.readOnly;
  }
}

export const maintenanceManager = new MaintenanceManager();
