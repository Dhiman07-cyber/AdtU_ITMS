/**
 * PROGRAM-004 / PHASE-03 Fleet & Driver-Bus Assignment Observability
 */

import { metrics } from '../metrics';
import { canonicalEventBus, createCanonicalEvent } from '../events';

class FleetDomainObservability {
  public recordDriverAssigned(driverId: string, busId: string, shift?: string, assignedBy?: string): void {
    metrics.counter('fleet_driver_assignments_total', 'Total driver-bus assignments', { shift: shift || 'all' });

    const event = createCanonicalEvent(
      'DriverAssigned',
      { driverId, busId, shift },
      { actor: { id: assignedBy || 'admin', role: 'admin' }, target: { id: driverId, type: 'driver' }, origin: 'fleet' }
    );
    canonicalEventBus.publish(event);
  }

  public recordBusAssigned(busId: string, routeId: string, assignedBy?: string): void {
    metrics.counter('fleet_bus_route_assignments_total', 'Total bus-route assignments', { route_id: routeId });

    const event = createCanonicalEvent(
      'BusAssigned',
      { busId, routeId },
      { actor: { id: assignedBy || 'admin', role: 'admin' }, target: { id: busId, type: 'bus' }, origin: 'fleet' }
    );
    canonicalEventBus.publish(event);
  }

  public recordAssignmentConflict(busId: string, driverId: string, reason: string): void {
    metrics.counter('fleet_assignment_conflicts_total', 'Total assignment conflicts detected', { reason });
  }

  public recordFleetUtilization(availableBuses: number, activeBuses: number, totalBuses: number): void {
    const ratio = totalBuses > 0 ? activeBuses / totalBuses : 0;
    metrics.gauge('fleet_total_buses', 'Total fleet buses count', {}, totalBuses);
    metrics.gauge('fleet_active_buses', 'Active operating buses count', {}, activeBuses);
    metrics.gauge('fleet_utilization_ratio', 'Fleet utilization ratio', {}, ratio);
  }
}

export const fleetDomainObservability = new FleetDomainObservability();
