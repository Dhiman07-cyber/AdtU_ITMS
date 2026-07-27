import { describe, it, expect } from 'vitest';
import { sloEngine, SLO_CATALOGUE } from '../observability/sre/slo-engine';
import { errorBudgetTracker } from '../observability/sre/error-budget';
import { incidentManager } from '../observability/sre/incident-framework';
import { maintenanceManager } from '../observability/sre/maintenance-mode';
import { anomalyDetector } from '../observability/sre/anomaly-detector';

describe('SRE Platform Framework', () => {
  it('should calculate Error Budget correctly for 99.9% target with 100.0% current SLI', () => {
    const slo = SLO_CATALOGUE.find(s => s.id === 'slo-platform-availability')!;
    const status = sloEngine.calculateErrorBudget(slo, 100.0);

    expect(status.sloId).toBe('slo-platform-availability');
    expect(status.status).toBe('HEALTHY');
    expect(status.budgetRemainingPercent).toBe(100);
  });

  it('should detect EXHAUSTED error budget when SLI falls below target', () => {
    const slo = SLO_CATALOGUE.find(s => s.id === 'slo-platform-availability')!;
    const status = sloEngine.calculateErrorBudget(slo, 99.5); // Target is 99.9%

    expect(status.status).toBe('EXHAUSTED');
    expect(status.budgetRemainingPercent).toBe(0);
  });

  it('should evaluate platform-wide error budgets', () => {
    const report = errorBudgetTracker.evaluateAllErrorBudgets();

    expect(report.totalSLOs).toBeGreaterThan(0);
    expect(report.overallHealthScore).toBeGreaterThanOrEqual(0);
  });

  it('should trigger and track P0 incidents with escalation', () => {
    const incident = incidentManager.triggerIncident(
      'Database Connection Pool Exhaustion',
      'P0',
      'DATABASE',
      ['Database connection errors spike'],
      ['Supabase PostgreSQL', 'API Server']
    );

    expect(incident.id).toMatch(/^INC-/);
    expect(incident.severity).toBe('P0');
    expect(incident.status).toBe('OPEN');

    const active = incidentManager.getActiveIncidents();
    expect(active.some(i => i.id === incident.id)).toBe(true);

    incidentManager.updateStatus(incident.id, 'RESOLVED', 'Stale connections pruned');
    expect(incidentManager.getActiveIncidents().some(i => i.id === incident.id)).toBe(false);
  });

  it('should manage maintenance mode transitions', () => {
    expect(maintenanceManager.getStatus().enabled).toBe(false);

    maintenanceManager.enableMaintenance({
      reason: 'Database Migration',
      activatedBy: 'Lead SRE'
    });

    expect(maintenanceManager.getStatus().enabled).toBe(true);
    expect(maintenanceManager.isWriteBlocked()).toBe(true);

    maintenanceManager.disableMaintenance();
    expect(maintenanceManager.getStatus().enabled).toBe(false);
  });

  it('should detect statistical metric anomalies', () => {
    const normal = anomalyDetector.evaluateMetric('api_request_rate', 50);
    expect(normal.anomalyDetected).toBe(false);

    const spike = anomalyDetector.evaluateMetric('api_request_rate', 300);
    expect(spike.anomalyDetected).toBe(true);
    expect(spike.severity).toBe('P0');
  });
});
