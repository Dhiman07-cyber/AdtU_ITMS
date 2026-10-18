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

    try {
      if (typeof window === 'undefined') {
        const fs = require('fs');
        const path = require('path');
        const flagFile = path.join(process.cwd(), '.maintenance-active');
        fs.writeFileSync(
          flagFile,
          JSON.stringify(
            {
              active: true,
              reason: options.reason,
              enabledAt: this.status.activatedAt,
              enabledBy: options.activatedBy,
            },
            null,
            2
          ),
          'utf8'
        );
      }
    } catch {
      // In non-writable environments, continue with in-memory status
    }

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

    try {
      if (typeof window === 'undefined') {
        const fs = require('fs');
        const path = require('path');
        const flagFile = path.join(process.cwd(), '.maintenance-active');
        if (fs.existsSync(flagFile)) {
          fs.rmSync(flagFile);
        }
      }
    } catch {
      // In non-writable environments, continue with in-memory status
    }

    logger.info('sre_maintenance', 'maintenance_disabled', { previousReason });

    return { ...this.status };
  }

  /**
   * Returns current maintenance status
   */
  public getStatus(): MaintenanceStatus {
    try {
      if (typeof window === 'undefined') {
        const fs = require('fs');
        const path = require('path');
        const flagFile = path.join(process.cwd(), '.maintenance-active');
        if (fs.existsSync(flagFile)) {
          const raw = fs.readFileSync(flagFile, 'utf8');
          const flag = JSON.parse(raw);
          if (flag.active !== false) {
            return {
              enabled: true,
              readOnly: true,
              draining: true,
              reason: flag.reason || 'Scheduled maintenance',
              activatedAt: flag.enabledAt,
              activatedBy: flag.enabledBy,
              estimatedDurationMinutes: 30,
              maintenanceBannerMessage:
                'The platform is currently undergoing scheduled maintenance. Write operations are disabled.',
            };
          }
        }
      }
    } catch {
      // Ignore FS errors and fall back to in-memory state
    }
    return { ...this.status };
  }

  /**
   * Check if write operations should be blocked
   */
  public isWriteBlocked(): boolean {
    const current = this.getStatus();
    return current.enabled && current.readOnly;
  }
}

export const maintenanceManager = new MaintenanceManager();
