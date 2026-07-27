/**
 * PROGRAM-004 / PHASE-06: Trace Sampling Strategy Engine
 */

export interface SamplingConfig {
  defaultRate: number;      // e.g., 1.0 in dev, 0.1 in prod
  errorRate: number;        // e.g., 1.0 (always sample errors)
  slowThresholdMs: number;  // e.g., 500ms
  highPriorityRoutes: string[];
}

export class TraceSampler {
  private config: SamplingConfig = {
    defaultRate: 1.0,
    errorRate: 1.0,
    slowThresholdMs: 500,
    highPriorityRoutes: ['/api/driver/initiate-trip', '/api/payment/razorpay/verify-payment', '/api/applications/submit-final']
  };

  public shouldSample(route: string, isError = false, durationMs = 0): boolean {
    if (isError) return true;
    if (durationMs >= this.config.slowThresholdMs) return true;
    if (this.config.highPriorityRoutes.some(r => route.includes(r))) return true;

    return Math.random() < this.config.defaultRate;
  }

  public updateConfig(newConfig: Partial<SamplingConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): SamplingConfig {
    return { ...this.config };
  }
}

export const traceSampler = new TraceSampler();
