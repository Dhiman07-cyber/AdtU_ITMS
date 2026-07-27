/**
 * PROGRAM-004 / PHASE-03 Trip Domain Observability & Event Emissions
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class TripDomainObservability {
  private activeTripsCount = 0;

  public recordTripInitiated(busId: string, driverId: string, routeId: string, shift: string): void {
    metrics.counter('trip_initiated_total', 'Total trips initiated', { route_id: routeId, shift });
  }

  public recordTripStarted(tripId: string, busId: string, driverId: string, routeId: string, shift: string): void {
    this.activeTripsCount++;
    metrics.counter('trip_started_total', 'Total trips started', { route_id: routeId, shift });
    metrics.gauge('trips_active', 'Current active trips gauge', { route_id: routeId, shift }, this.activeTripsCount);

    // Emit canonical TripStarted event
    const event = createCanonicalEvent(
      'TripStarted',
      { tripId, busId, driverId, routeId, shift },
      { actor: { id: driverId, role: 'driver' }, target: { id: busId, type: 'bus' }, origin: 'trip' }
    );
    canonicalEventBus.publish(event);
  }

  public recordTripCompleted(tripId: string, busId: string, driverId: string, durationMs: number, reason = 'normal'): void {
    this.activeTripsCount = Math.max(0, this.activeTripsCount - 1);
    metrics.counter('trip_completed_total', 'Total trips completed', { reason });
    metrics.gauge('trips_active', 'Current active trips gauge', {}, this.activeTripsCount);
    metrics.timer('trip_duration_seconds', 'Trip duration in seconds', durationMs);

    // Emit canonical TripEnded event
    const event = createCanonicalEvent(
      'TripEnded',
      { tripId, busId, driverId, durationMs, reason },
      { actor: { id: driverId, role: 'driver' }, target: { id: busId, type: 'bus' }, origin: 'trip' }
    );
    canonicalEventBus.publish(event);
  }

  public recordTripFailed(tripId: string, reason: string, errorClass?: string): void {
    this.activeTripsCount = Math.max(0, this.activeTripsCount - 1);
    metrics.counter('trip_failed_total', 'Total failed trips', { reason, error_type: errorClass || 'unknown' });
    metrics.gauge('trips_active', 'Current active trips gauge', {}, this.activeTripsCount);
  }

  public recordTripExpired(tripId: string, busId: string): void {
    this.activeTripsCount = Math.max(0, this.activeTripsCount - 1);
    metrics.counter('trip_expired_total', 'Total trips auto-expired due to heartbeat timeout', { bus_id: busId });
    metrics.gauge('trips_active', 'Current active trips gauge', {}, this.activeTripsCount);
  }

  public recordTripLockAcquisition(durationMs: number, success: boolean): void {
    metrics.timer('trip_lock_acquisition_duration_seconds', 'Trip lock acquisition latency', durationMs, {
      result: success ? 'success' : 'conflict',
    });
  }
}

export const tripDomainObservability = new TripDomainObservability();
