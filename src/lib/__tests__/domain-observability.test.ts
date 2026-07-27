/**
 * PROGRAM-004 / PHASE-03 Domain Observability & Event Stream Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { observeDomainService } from '../observability/domains/service-observer';
import { tripDomainObservability } from '../observability/domains/trip-metrics';
import { gpsDomainObservability } from '../observability/domains/gps-metrics';
import { paymentDomainObservability } from '../observability/domains/payment-metrics';
import { applicationDomainObservability } from '../observability/domains/application-metrics';
import { identityDomainObservability } from '../observability/domains/identity-metrics';
import { fleetDomainObservability } from '../observability/domains/fleet-metrics';
import { notificationDomainObservability } from '../observability/domains/notification-metrics';
import { studentDriverObservability } from '../observability/domains/student-driver-metrics';
import { adminAuditObservability } from '../observability/domains/admin-audit-metrics';
import { canonicalEventBus } from '../observability/events';
import { metricsRegistry } from '../observability/metrics';

describe('Domain Observability & Business Event Framework', () => {
  it('observeDomainService measures successful execution and records latency', async () => {
    const result = await observeDomainService('testDomain', 'testOperation', async () => {
      return 'success_val';
    });
    expect(result).toBe('success_val');

    const prometheus = metricsRegistry.toPrometheusFormat();
    expect(prometheus).toContain('itms_domain_service_calls_total');
  });

  it('tripDomainObservability records trip lifecycle and emits canonical events', async () => {
    const spy = vi.fn();
    const unsubscribe = canonicalEventBus.subscribe('TripStarted', spy);

    tripDomainObservability.recordTripStarted('trip-100', 'bus-10', 'driver-10', 'route-5', 'morning');

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].eventName).toBe('TripStarted');
    expect(spy.mock.calls[0][0].payload.tripId).toBe('trip-100');

    unsubscribe();
  });

  it('paymentDomainObservability records revenue and emits PaymentCompleted event', async () => {
    const spy = vi.fn();
    const unsubscribe = canonicalEventBus.subscribe('PaymentCompleted', spy);

    paymentDomainObservability.recordPaymentCompleted('pay-999', 'student-55', 12500, 'online', 150);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].payload.amount).toBe(12500);

    const prometheus = metricsRegistry.toPrometheusFormat();
    expect(prometheus).toContain('itms_payment_revenue_total_inr');

    unsubscribe();
  });

  it('applicationDomainObservability tracks student application approval funnel', () => {
    applicationDomainObservability.recordSubmitted('app-1', 'student-1');
    applicationDomainObservability.recordApproved('app-1', 'mod-1', 4500);

    const json = metricsRegistry.getMetricsJSON();
    const approvedMetric = json.find((m) => m.name === 'itms_applications_approved_total');
    expect(approvedMetric).toBeDefined();
  });

  it('fleetDomainObservability calculates utilization ratio correctly', () => {
    fleetDomainObservability.recordFleetUtilization(5, 15, 20);

    const json = metricsRegistry.getMetricsJSON();
    const utilMetric = json.find((m) => m.name === 'itms_fleet_utilization_ratio');
    expect(utilMetric).toBeDefined();
    expect(utilMetric?.values[0].value).toBe(0.75);
  });

  it('notificationDomainObservability tracks waiting flag response time', () => {
    notificationDomainObservability.recordWaitingFlagRaised('flag-1', 'student-1', 'bus-1');
    notificationDomainObservability.recordWaitingFlagAcknowledged('flag-1', 'driver-1', 1200);

    const prometheus = metricsRegistry.toPrometheusFormat();
    expect(prometheus).toContain('itms_waiting_flags_raised_total');
  });

  it('adminAuditObservability records config updates and emits ConfigurationUpdated event', () => {
    const spy = vi.fn();
    const unsubscribe = canonicalEventBus.subscribe('ConfigurationUpdated', spy);

    adminAuditObservability.recordConfigurationChanged('bus_fee_amount', 'admin-1', 'bus_fees');

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].payload.key).toBe('bus_fee_amount');

    unsubscribe();
  });
});
