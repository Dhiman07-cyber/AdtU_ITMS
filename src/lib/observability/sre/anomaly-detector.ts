/**
 * PROGRAM-004 / PHASE-05: SRE Anomaly Detection Engine
 */

import { logger } from '../logger';

export interface AnomalyReport {
  timestamp: string;
  metric: string;
  currentValue: number;
  expectedBaseline: number;
  deviationMultiplier: number;
  anomalyDetected: boolean;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  description: string;
}

export class AnomalyDetector {
  private baselines: Map<string, number> = new Map([
    ['api_request_rate', 50],
    ['ws_connection_rate', 20],
    ['gps_update_rate', 10],
    ['payment_volume_rate', 5],
    ['memory_rss_mb', 250],
    ['api_p95_latency_ms', 120]
  ]);

  /**
   * Evaluates metric against sliding baseline to detect anomalies
   */
  public evaluateMetric(metricName: string, currentValue: number): AnomalyReport {
    const baseline = this.baselines.get(metricName) ?? 50;
    const ratio = currentValue / Math.max(1, baseline);

    let anomalyDetected = false;
    let severity: 'P0' | 'P1' | 'P2' | 'P3' = 'P3';
    let description = 'Normal metric behavior within baseline parameters.';

    if (ratio >= 5.0 || ratio <= 0.05) {
      anomalyDetected = true;
      severity = 'P0';
      description = `CRITICAL ANOMALY: ${metricName} value (${currentValue}) is ${ratio.toFixed(1)}x expected baseline (${baseline}).`;
    } else if (ratio >= 3.0 || ratio <= 0.2) {
      anomalyDetected = true;
      severity = 'P1';
      description = `HIGH ANOMALY: ${metricName} value (${currentValue}) is ${ratio.toFixed(1)}x expected baseline (${baseline}).`;
    } else if (ratio >= 2.0 || ratio <= 0.5) {
      anomalyDetected = true;
      severity = 'P2';
      description = `MODERATE ANOMALY: ${metricName} value (${currentValue}) deviates from baseline (${baseline}).`;
    }

    if (anomalyDetected) {
      logger.warn('sre_anomaly_detector', 'anomaly_detected', {
        metricName,
        currentValue,
        baseline,
        severity,
        ratio
      });
    }

    return {
      timestamp: new Date().toISOString(),
      metric: metricName,
      currentValue,
      expectedBaseline: baseline,
      deviationMultiplier: Number(ratio.toFixed(2)),
      anomalyDetected,
      severity,
      description
    };
  }
}

export const anomalyDetector = new AnomalyDetector();
