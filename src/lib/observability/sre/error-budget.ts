/**
 * PROGRAM-004 / PHASE-05: SRE Error Budget Tracking & Burn Rate Engine
 */

import { sloEngine, SLO_CATALOGUE, ErrorBudgetStatus } from './slo-engine';
import { logger } from '../logger';

export interface ErrorBudgetReport {
  timestamp: string;
  overallHealthScore: number;
  totalSLOs: number;
  healthySLOs: number;
  warningSLOs: number;
  exhaustedSLOs: number;
  criticalBurnSLOs: number;
  details: ErrorBudgetStatus[];
}

export class ErrorBudgetTracker {
  private mockSLIScores: Map<string, number> = new Map();

  constructor() {
    // Initialize default perfect SLI scores (100%)
    SLO_CATALOGUE.forEach(slo => {
      this.mockSLIScores.set(slo.id, 99.95);
    });
  }

  /**
   * Set simulated or recorded SLI value for testing/monitoring
   */
  public updateSLIValue(sloId: string, sliValue: number): void {
    this.mockSLIScores.set(sloId, Math.min(100, Math.max(0, sliValue)));
  }

  /**
   * Evaluates all error budgets across the platform catalogue
   */
  public evaluateAllErrorBudgets(): ErrorBudgetReport {
    const details: ErrorBudgetStatus[] = [];
    let healthyCount = 0;
    let warningCount = 0;
    let exhaustedCount = 0;
    let criticalBurnCount = 0;

    SLO_CATALOGUE.forEach(slo => {
      const currentSLI = this.mockSLIScores.get(slo.id) ?? slo.targetPercent;
      const status = sloEngine.calculateErrorBudget(slo, currentSLI);
      details.push(status);

      switch (status.status) {
        case 'HEALTHY':
          healthyCount++;
          break;
        case 'WARNING':
          warningCount++;
          break;
        case 'EXHAUSTED':
          exhaustedCount++;
          logger.warn('sre_error_budget', 'budget_exhausted', { sloId: slo.id, sloName: slo.name, remainingPercent: status.budgetRemainingPercent });
          break;
        case 'CRITICAL_BURN':
          criticalBurnCount++;
          logger.error('sre_error_budget', 'critical_burn_rate', { sloId: slo.id, sloName: slo.name, burnRate1h: status.burnRate1h });
          break;
      }
    });

    const total = SLO_CATALOGUE.length;
    const overallScore = Number(((healthyCount / total) * 100).toFixed(2));

    return {
      timestamp: new Date().toISOString(),
      overallHealthScore: overallScore,
      totalSLOs: total,
      healthySLOs: healthyCount,
      warningSLOs: warningCount,
      exhaustedSLOs: exhaustedCount,
      criticalBurnSLOs: criticalBurnCount,
      details
    };
  }
}

export const errorBudgetTracker = new ErrorBudgetTracker();
