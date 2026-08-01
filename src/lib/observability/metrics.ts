/**
 * Repository-Wide Metrics Library
 * Supports Counter, Gauge, Histogram, Summary, Timer, Observable Gauge.
 * Exposes automatic registration, Prometheus text format, and JSON snapshots.
 */

import { MetricDefinition, MetricType, MetricValue } from './types';
import { observabilityConfig } from './config';

class MetricRegistry {
  private definitions = new Map<string, MetricDefinition>();
  private counters = new Map<string, Map<string, number>>();
  private gauges = new Map<string, Map<string, number>>();
  private histograms = new Map<string, Map<string, number[]>>();
  private observableGauges = new Map<string, () => number>();

  private getFullMetricName(name: string): string {
    if (name.startsWith(observabilityConfig.metricPrefix)) return name;
    return `${observabilityConfig.metricPrefix}${name}`;
  }

  private serializeLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return '';
    const sorted = Object.entries(labels)
      .sort(([k1], [k2]) => k1.localeCompare(k2))
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join(',');
    return `{${sorted}}`;
  }

  register(def: MetricDefinition): void {
    const fullName = this.getFullMetricName(def.name);
    if (!this.definitions.has(fullName)) {
      this.definitions.set(fullName, { ...def, name: fullName });
    }
  }

  counter(name: string, help: string, labels?: Record<string, string>, value = 1): void {
    const fullName = this.getFullMetricName(name);
    this.register({ name: fullName, help, type: 'counter' });

    if (!this.counters.has(fullName)) {
      this.counters.set(fullName, new Map());
    }
    const store = this.counters.get(fullName)!;
    const labelKey = this.serializeLabels(labels);
    const current = store.get(labelKey) || 0;
    store.set(labelKey, current + value);
  }

  gauge(name: string, help: string, labels?: Record<string, string>, value = 1): void {
    const fullName = this.getFullMetricName(name);
    this.register({ name: fullName, help, type: 'gauge' });

    if (!this.gauges.has(fullName)) {
      this.gauges.set(fullName, new Map());
    }
    const store = this.gauges.get(fullName)!;
    const labelKey = this.serializeLabels(labels);
    store.set(labelKey, value);
  }

  observableGauge(name: string, help: string, callback: () => number): void {
    const fullName = this.getFullMetricName(name);
    this.register({ name: fullName, help, type: 'observable_gauge' });
    this.observableGauges.set(fullName, callback);
  }

  histogram(name: string, help: string, value: number, labels?: Record<string, string>): void {
    const fullName = this.getFullMetricName(name);
    this.register({ name: fullName, help, type: 'histogram' });

    if (!this.histograms.has(fullName)) {
      this.histograms.set(fullName, new Map());
    }
    const store = this.histograms.get(fullName)!;
    const labelKey = this.serializeLabels(labels);
    const list = store.get(labelKey) || [];
    list.push(value);
    // Amortized batch eviction: trim back to 1,000 only when array reaches 1,200
    if (list.length > 1200) {
      store.set(labelKey, list.slice(list.length - 1000));
    } else {
      store.set(labelKey, list);
    }
  }

  timer(name: string, help: string, durationMs: number, labels?: Record<string, string>): void {
    this.histogram(name, help, durationMs / 1000.0, labels);
  }

  getMetricsJSON(): MetricValue[] {
    const results: MetricValue[] = [];

    for (const [name, def] of this.definitions.entries()) {
      const values: MetricValue['values'] = [];

      if (def.type === 'counter') {
        const store = this.counters.get(name);
        if (store) {
          for (const [labelStr, val] of store.entries()) {
            values.push({ value: val });
          }
        }
      } else if (def.type === 'gauge') {
        const store = this.gauges.get(name);
        if (store) {
          for (const [labelStr, val] of store.entries()) {
            values.push({ value: val });
          }
        }
      } else if (def.type === 'observable_gauge') {
        const cb = this.observableGauges.get(name);
        if (cb) {
          values.push({ value: cb() });
        }
      } else if (def.type === 'histogram') {
        const store = this.histograms.get(name);
        if (store) {
          for (const [labelStr, list] of store.entries()) {
            const sum = list.reduce((acc, curr) => acc + curr, 0);
            const avg = list.length > 0 ? sum / list.length : 0;
            values.push({ value: avg });
          }
        }
      }

      results.push({
        name: def.name,
        help: def.help,
        type: def.type,
        values,
      });
    }

    return results;
  }

  toPrometheusFormat(): string {
    const lines: string[] = [];

    for (const [name, def] of this.definitions.entries()) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} ${def.type === 'timer' ? 'histogram' : def.type}`);

      if (def.type === 'counter') {
        const store = this.counters.get(name);
        if (store) {
          for (const [labels, val] of store.entries()) {
            lines.push(`${name}${labels} ${val}`);
          }
        }
      } else if (def.type === 'gauge') {
        const store = this.gauges.get(name);
        if (store) {
          for (const [labels, val] of store.entries()) {
            lines.push(`${name}${labels} ${val}`);
          }
        }
      } else if (def.type === 'observable_gauge') {
        const cb = this.observableGauges.get(name);
        if (cb) {
          lines.push(`${name} ${cb()}`);
        }
      } else if (def.type === 'histogram') {
        const store = this.histograms.get(name);
        if (store) {
          for (const [labels, list] of store.entries()) {
            const sum = list.reduce((acc, curr) => acc + curr, 0);
            lines.push(`${name}_sum${labels} ${sum}`);
            lines.push(`${name}_count${labels} ${list.length}`);
          }
        }
      }
    }

    return lines.join('\n');
  }
}

export const metricsRegistry = new MetricRegistry();

/**
 * Standard Metric Helper Shortcuts
 */
export const metrics = {
  counter: (name: string, help: string, labels?: Record<string, string>, value = 1) =>
    metricsRegistry.counter(name, help, labels, value),

  gauge: (name: string, help: string, labels?: Record<string, string>, value = 1) =>
    metricsRegistry.gauge(name, help, labels, value),

  histogram: (name: string, help: string, value: number, labels?: Record<string, string>) =>
    metricsRegistry.histogram(name, help, value, labels),

  timer: (name: string, help: string, durationMs: number, labels?: Record<string, string>) =>
    metricsRegistry.timer(name, help, durationMs, labels),

  recordApiRequest: (method: string, route: string, status: number, durationMs: number) => {
    metrics.counter('api_requests_total', 'Total HTTP requests', { method, route, status: String(status) });
    metrics.timer('api_request_duration_seconds', 'HTTP request duration', durationMs, { method, route });
  },

  recordTripStart: (routeId: string, shift: string) => {
    metrics.counter('trip_started_total', 'Total trips started', { route_id: routeId, shift });
  },

  recordTripEnd: (reason: string) => {
    metrics.counter('trip_completed_total', 'Total trips completed', { reason });
  },

  recordGpsUpdate: (accepted: boolean, reason?: string) => {
    if (accepted) {
      metrics.counter('gps_updates_total', 'Total accepted GPS updates', { result: 'accepted' });
    } else {
      metrics.counter('gps_rejected_total', 'Total rejected GPS updates', { reason: reason || 'unknown' });
    }
  },
};
