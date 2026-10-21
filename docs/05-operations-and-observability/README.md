# Domain 05: Operations, Runbooks & System Observability

## Executive Overview
Domain 05 defines the operational backbone, site reliability engineering (SRE) frameworks, metrics collection, and disaster recovery procedures for the Assam down town University Intelligent Transport Management System (ADTU ITMS).

```mermaid
mindmap
  root((Domain 05: Operations & SRE))
    Telemetry & Metrics
      35+ OpenMetrics Prometheus Counters
      Event Loop Lag Sampling
      Liveness, Readiness & Startup Probes
      SLO & 30-Day Error Budget Tracking
    Incident Response & Runbooks
      P0 to P3 Severity Escalation Matrix
      SRE-01: Stranded Driver Trip Lock
      SRE-02: Redis Failover Recovery
      SRE-03: Ghost Bus Marker Cleanup
      SRE-04: Razorpay Webhook Drop
      SRE-05: DB Pool Exhaustion
      SRE-06: Maintenance Mode
    Fleet & Routes
      Fleet Master Schema & Polylines
      INV-FLEET-001: Active Trip Mutation Lock
      INV-FLEET-002: Seat Downscaling Floor
      Geofenced Stop Topology
    Drivers & Dispatch
      Duty FSM State Machine
      Single-Device Session Locking
      Parallel Stale Lock Reaper
    Self-Healing Integrity
      Nightly 03:00 UTC Audit Sweep
      adminReconcileBusLoads RPC
      Append-Only audit_events Table
```

## Forensic Document Roadmap

| Document | Focus & Key Implementation |
| :--- | :--- |
| [01-telemetry-and-metrics.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/01-telemetry-and-metrics.md) | OpenMetrics export, `MetricsService`, `HealthService`, Prometheus scrape config, Grafana alerts, SRE SLO catalog. |
| [02-incident-runbooks.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/02-incident-runbooks.md) | SRE runbooks SRE-01 through SRE-06, P0-P3 escalation matrix, maintenance mode activation. |
| [03-fleet-and-route-operations.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/03-fleet-and-route-operations.md) | Fleet master schema, route waypoints, geofences, mutation safety guards `INV-FLEET-001` and `INV-FLEET-002`. |
| [04-driver-rosters-and-dispatch.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/04-driver-rosters-and-dispatch.md) | Driver duty state machine, single-device session locks, relief pool, 60s parallel stale lock reaper. |
| [05-integrity-sweep-and-reconciliation.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/05-integrity-sweep-and-reconciliation.md) | Nightly diagnostic sweep, `reconcile_bus_seat_loads_v1` self-healing RPC, append-only immutable audit logging. |
