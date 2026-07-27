/**
 * PROGRAM-004 / PHASE-03 GPS Domain Observability & Pipeline Metrics
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class GpsDomainObservability {
  public recordUpdateReceived(driverId: string, busId: string): void {
    metrics.counter('gps_updates_received_total', 'Total GPS location updates received');
  }

  public recordUpdateAccepted(driverId: string, busId: string, tripId?: string, lat?: number, lng?: number, durationMs = 0): void {
    metrics.counter('gps_updates_accepted_total', 'Total accepted GPS updates');
    metrics.timer('gps_pipeline_duration_seconds', 'GPS pipeline processing time', durationMs);

    // Emit canonical GPSUpdated event
    const event = createCanonicalEvent(
      'GPSUpdated',
      { driverId, busId, tripId, lat, lng },
      { actor: { id: driverId, role: 'driver' }, target: { id: busId, type: 'bus' }, origin: 'gps' }
    );
    canonicalEventBus.publish(event);
  }

  public recordUpdateRejected(reason: string, errorClass: string, driverId?: string, busId?: string): void {
    metrics.counter('gps_updates_rejected_total', 'Total rejected GPS updates', {
      reason,
      error_type: errorClass,
    });
  }

  public recordStudentTrackingSession(studentId: string, busId: string): void {
    metrics.counter('gps_student_tracking_sessions_total', 'Total student live tracking map sessions');
  }
}

export const gpsDomainObservability = new GpsDomainObservability();
