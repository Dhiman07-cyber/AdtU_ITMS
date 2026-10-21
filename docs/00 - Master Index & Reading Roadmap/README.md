# 00. Foundational Motivation, System Architecture & Operational Blueprint

Welcome to the foundational master documentation for the **Assam down town University Intelligent Transport Management System (ADTU ITMS)**.

This section provides the comprehensive academic and engineering rationale behind the platform. It documents why this platform was conceived, the lived commuter reality of university students and fleet operators in Guwahati, the mathematical capacity requirements for 2,000+ commuters, an unvarnished forensic analysis of current cloud hosting constraints (Vercel, Render, Supabase Free Tier), a cost-engineered Virtual Private Server (VPS) deployment model, and an exhaustive Low-Level Design (LLD) justifying every single component, API, and invariant across the codebase.

---

## 🧭 Faculty Reviewer & Technical Auditor Navigation Guide

This documentation has been structured specifically for rigorous academic and engineering evaluation by senior faculty reviewers, system architects, and defense committees:

```
docs/00/
├── 01-origin-and-problem-statement.md
│   └── The real-world origin story at AdtU (Panikhaiti, Guwahati). The daily commuter ordeal,
│       morning rush anxiety, driver distraction hazards, informal WhatsApp blind spots,
│       ₹50,000–₹65,000 annual transit fee stakes, single-counter bottlenecks, and the necessity
│       for incontrovertible geofenced stop dwell audit proof.
│
├── 02-scope-user-base-and-capacity-analysis.md
│   └── Formal system scope, 5 core stakeholder personas (Students, Drivers/Pilots, Moderators,
│       Admins, Automated Agents), 2,000-commuter capacity sizing, morning rush (07:15–09:15 AM)
│       traffic models, WebSocket fan-out mathematics, and bandwidth calculations.
│
├── 03-infrastructure-audit-and-vps-cost-engineering.md
│   └── Forensic breakdown of distributed cloud deployment: Vercel frontend, Render WebSocket server,
│       and Supabase PostgreSQL. Exhaustive analysis of Supabase Free Tier fatal boundaries
│       (200 concurrent connections, 2M messages/month, 1-week inactivity pause) and Render sleep cycles.
│       Detailed VPS pricing comparison (Hetzner vs DigitalOcean vs AWS Lightsail) and co-located Docker Compose blueprint.
│
├── 04-complete-system-components-and-justification.md
│   └── Exhaustive Low-Level Design (LLD) justifying every architectural tier, directory, service,
│       and API route across all 15 business domains. Provides exact code snippets, line numbers,
│       failure scenarios ("Why does the system fail without this component?"), and state taxonomy.
│
├── 05-faculty-defense-and-architectural-validation.md
│   └── Master technical defense document for the 40-year veteran faculty reviewer. Rigorous proofs
│       of ACID vs BASE boundaries, distributed lock leasing, CAP theorem trade-offs in transit telematics,
│       database trigger immutability, and answers to 12 senior engineering examination questions.
│
└── 06-integration-seams-and-unification-roadmap.md
    └── Deep architectural synthesis resolving system fragmentation doubts. Details the 4 unifying
        architectural glues (Identity Spine, Event Bus Relay, Authoritative RPC Contract, Golden Battery)
        that bind all micro-services, WebSockets, and database transactions into a single cohesive engine.
```

---

## 🗺️ Downstream Technical Documentation Mapping

After reviewing this foundational section, proceed to the detailed domain implementation manuals:

1. **[01. Trip Lifecycle & Telematics Pipeline](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/)**:
   - `README.md`: Domain charter, state machine transitions, Redis pub/sub topology, and 15 business domains.
   - `01-architecture-and-dataflow.md`: Start-trip initiation, three-way lock acquisition, live telemetry routing, and student live tracking frontend.
   - `02-redis-pubsub.md`: Authoritative GPS ingress, Redis Lua guard script (`gps_guard.lua`), channel topologies, and throttled 10s persistence.
   - `03-websocket-cluster.md`: Dedicated Node.js WebSocket cluster (WS1), handshake upgrade, room isolation, and FCM push fan-out alerting.
   - `04-gps-pipeline.md`: Telematics validation, Assam bounding box, velocity checks, Kalman smoothing, and incontrovertible stop dwell audit engine.
   - `05-state-machine-and-cleanup.md`: Full state machine, `end_trip_atomically`, automated stale-lock reaper, and unified `evictAllBusRuntimeState` aggregate.
   - `06-nginx-and-networking.md`: Reverse proxy, SSL termination, and WebSocket upgrade routing.
   - `07-waiting-flags-and-corridor-locks.md`: Student waiting flags, hands-free driver HUD alerts, 3-lock route corridor concurrency, and proximity auto-dismissal.
   - `08-database-schema-and-rpc-reference.md`: Active trips schema, three-way locks (`bus_id`, `driver_id`, `route_id`), stop dwell tables, and PL/pgSQL stored procedures.
   - `09-chaos-hardening-and-verification-gates.md`: 18-point chaos hardening, 24-hour continuous endurance test suite, 12 cross-pillar integration seam remediations, and production freeze.
   - `TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md`: Authoritative forensic codebase truth extraction covering all SQL RPCs, services, websocket frames, and invariants.

2. **[02. Payments & Financial Subscriptions](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/)**:
   - `README.md`: High-impact payment architecture, ledger invariants, and failure recovery loops.
   - `01-razorpay-lifecycle.md`: Online checkout, dynamic pricing engine, HMAC SHA-256 signatures, and dual-path webhook verification.
   - `02-ledger-and-renewals.md`: Double-entry ledger immutability (`protect_completed_payments`), atomic seat renewals (`approve_renewal_with_seat`), and refunds.
   - `03-payment-query-audit-and-accounting.md`: Full quantitative audit of Supabase SQL queries, RPC calls, external HTTP calls, per-page costs, and database index optimizations.
   - `04-offline-challan-and-moderator-workflow.md`: Physical bank challans, counter cash receipts, moderator verification queue, document audit, and approval RPCs.
   - `05-digital-boarding-pass-and-qr-issuance.md`: Digital boarding pass issuance, 128-bit rotating QR tokens, client-side PDF download, and 4-gate scanner verification.
   - `06-academic-lifecycle-crons-and-retention.md`: Automated daily lifecycle crons, session activation, 7d/3d expiry warnings, soft-block seat reclaim, and cascade deletion.
   - `07-database-schema-and-rpc-reference.md`: Complete relational schema, immutable ledger triggers, check constraints, and stored procedures (`COMPLETE_SCHEMA.sql`).
   - `08-chaos-hardening-and-verification-gates.md`: 16-point chaos hardening, payment network dropout recovery matrix, 12 cross-pillar integration seam remediations, and release freeze.
   - `PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md`: Master 14,000+ line forensic truth extraction covering events P1-P10, chaos remediations, and ledger immutability triggers.

3. **[03. Identity & Role-Based Access Control](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/)**:
   - `README.md`: Identity architecture overview, multi-tier RBAC taxonomy, session lifecycle, and security controls.
   - `01-auth-architecture.md`: Edge perimeter proxy (`proxy.ts`), anti-spoofing IP resolution, CSRF protection, dual identity spine, and timing-safe first admin bootstrap.
   - `02-role-permissions-matrix.md`: Granular 6-category moderator RBAC matrix, 60s LRU cache, instant session eviction (`4401`), and university audit logs.
   - `03-scanner-auth-and-device-sessions.md`: Digital student boarding pass lifecycle, 128-bit rotating QR tokens, single-device driver lock, and 4-gate scanner verification.
   - `04-moderator-permissions-and-cleanup.md`: Fleet, route & driver CRUD operations, in-flight trip mutation rejection triggers, driver phone verification, and cascading cleanup.
   - `05-operational-relief-pool-and-conductor.md`: Operational reserve driver relief pool, emergency substitute rostering, and dynamic conductor QR check-in architecture.
   - `06-notifications-and-anti-idor.md`: Push notifications, SMS/WhatsApp emergency alerts, in-app notifications, and anti-IDOR security protocol (`INV-NOTIF-001`).
   - `07-database-schema-and-rls-reference.md`: Relational tables, foreign keys, check constraints, Row-Level Security (RLS) policies, and administrative stored procedures.
   - `08-verification-suite-and-production-gates.md`: RBAC unit tests, token invalidation chaos tests, scanner tamper tests, and 4 production release gate certifications.
   - `IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md`: Ground-truth extraction covering dual-layer identity, role caches, relief pool drivers, QR scanner 4 gates, and anti-IDOR notifications.

4. **[04. Students, Capacity & Route Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/)**:
   - `README.md`: Commuter lifecycle, open seating rules, capacity safety, and calendar cascade.
   - `01-application-and-boarding.md`: Prospective onboarding, multi-step wizard, moderator verification codes, Cloudinary uploads, and full review/approval/rejection/staging state machine.
   - `02-smart-seat-allocation.md`: Capacity discovery, the "Full Bus / Single-Bus Stop / Alternative Bus" resolution engine, and fleet route/driver rostering allocation (`assign_drivers_atomically`, `assign_routes_atomically`).
   - `03-student-reassignment-domain.md`: Deadlock-free batch student reassignment (`reassign_students_atomically`), 1-click rollback engine (`execute_reassignment_rollback`), immutable audit snapshots, and shift parity math.
   - `04-academic-calendar-cascade-and-eligibility.md`: Dynamic academic calendar engine, simulation mode, deadline configuration, per-student milestone derivation, and global administrative settings.
   - `05-lifecycle-crons-and-retention.md`: Automated daily lifecycle crons, session activation (`verified_upcoming`), expiry warnings, soft-block seat release, hard cascade deletion (`delete_student_cascade_v1`), and bus load reconciliation (`adminReconcileBusLoads`).
   - `06-student-profiles-and-change-requests.md`: Student profile lifecycle, stop/shift change requests, administrative/moderator student CRUD, `SeatReclaimRequiredError`, and financial pass linking.
   - `07-database-schema-and-rpc-reference.md`: Complete relational schema, foreign keys, immutability check constraints, indexes, and PL/pgSQL stored procedures for academic allocation.
   - `08-hardening-verification-and-cross-pillar-gates.md`: 14-point hardening audit, invariant verification matrix, state machine proofs, Vitest test suite runs, and cross-pillar integration freeze certification.
   - `ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md`: Master 11,000+ line forensic truth extraction covering prospective onboarding, capacity discovery, admin review, calendar engine, lifecycle crons, and smart allocation.

5. **[05. Operations, Runbooks & Observability](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/)**:
   - `README.md`: Operational domain map, metrics taxonomy, dispatch lifecycle, and incident runbooks.
   - `01-telemetry-and-metrics.md`: Prometheus scrape jobs, custom `itms_*` metrics, Grafana dashboards.
   - `02-incident-runbooks.md`: Standard operating procedures for stranded locks, partitions, and outages.
   - `03-fleet-and-route-operations.md`: Vehicle and route lifecycle management, mutation guards (`INV-FLEET-001`, `INV-FLEET-002`), capacity invariants, and relief bus pool.
   - `04-driver-rosters-and-dispatch.md`: Driver duty state machine, roster shift assignments, stale lock reaper (`cleanup-stale-locks`), and opposite-shift 4-hour window.
   - `05-integrity-sweep-and-reconciliation.md`: Nightly diagnostic sweep, `reconcile_bus_seat_loads_v1` self-healing RPC, and append-only immutable audit logging.

6. **[06. System Invariants & Evidence Matrices](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/)**:
   - `README.md`: Formal verification methodology, 4 production release gates, and invariant register.
   - `01-system-invariants-ledger.md`: Canonical register of all 45 mandatory system invariants across 11 domains.
   - `02-verification-battery-and-concurrency.md`: Multi-tier verification architecture, Golden Battery (80 test files, 672 test cases, 100% pass rate), ACID row-lock concurrency proofs, verification runbook, and production gate.
   - `03-frontend-performance-and-responsive-matrix.md`: Next.js 16 App Router performance, Server Component LCP overhaul, 3.5s bounded UX, fluid layout engine, and breakpoint matrix.
   - `04-security-decisions-and-findings-ledger.md`: Formal security decisions (SEC-DEC-01 to 12), canonical findings ledger (FND-001 to 17 remediated), and schema reproducibility.

7. **[07. GPS & Location Integrity Forensics](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/)**:
   - `README.md`: Telematics pipeline overview, Kalman filter architecture, geofenced dwell proof, and edge-case defenses.
   - `01-telematics-ingestion-and-kalman-pipeline.md`: Assam/NE corridor bounding box, physical road speed limit (≤120 km/h), drift rejection, Kalman smoothing, and Redis Lua guard.
   - `02-stop-dwell-audit-proof-engine.md`: 80m geofence radius, `stop_dwell_logs` schema, incontrovertible dwell evidence (`arrived_at`, `dwell_seconds`, `departed_at`), and >85% throttled Redis writes.
   - `ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md`: Telemetry distribution analysis and road-snapping forensics.
   - `ADTU_ITMS_BUS_MARKER_ROUTE_ALIGNMENT_FINAL_REPORT.md`: Client-side interpolation dynamics and easing curves.

8. **[08. Admin System Configuration & Lifecycle Automation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/)**:
   - `README.md`: Pure PostgreSQL system configuration, zero Firestore dependency, Zero-Redis fee self-healing, and role-guarded endpoints.
   - `01-academic-calendar-and-deadlines.md`: Per-student year derivation and lifecycle milestone crons.
   - `02-bus-fees-and-pricing.md`: Server-authoritative fee engine, adjustment logs, and offline receipts.
   - `03-system-settings-and-maintenance.md`: SRE toggles, public landing config, and immutable audit logging.

9. **[09. Canonical Verification Suites](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/)**:
   - `README.md`: System verification charter, 80 test suites inventory, and chaos engineering matrix.
   - `01-test-suite-architecture-and-verification-gates.md`: Complete directory inventory of all 80 test files (672 assertions), unit/integration/chaos classification, and the 4 release gates.
   - `ITMS_SYSTEM_SPECIFICATION.md`: System overview, trip-first operational spine, open seating rules, and container topology.
   - `ITMS_FAILURE_AND_RESILIENCE_MATRIX.md`: Failure mode analysis, recovery actions, and verification results across Redis, PostgreSQL, and WebSocket clusters.

10. **[10. Performance & Security Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/)**:
    - `01-rendering-architecture-and-route-inventory.md`: Complete audit of all 222 compiled routes: Server Components vs Client Components, hydration costs, and component responsibilities.
    - `02-component-overhead-and-dead-weight-elimination.md`: Component resource consumption analysis, safe dead-weight elimination (Motion, Lenis on mobile, dual toasts, Recharts, exporters) without affecting consistency.
    - `03-caching-mechanisms-and-data-lifecycle.md`: Full 6-tier caching architecture (React 19 compiler, in-memory domain TTLs with scanner and config cache, Redis 7 Pub/Sub, HTTP keepalives, Turbopack, and image optimization).
    - `04-frontend-performance-and-cwv-benchmarks.md`: Core Web Vitals audit (LCP 0.8s, CLS 0.02, INP <50ms, TTIS ≤3.5s), velocity telemetry restoration, and container-query layout engine.
    - `05-full-stack-security-and-fail-closed-boundaries.md`: OWASP ASVS compliance: Edge proxy CSRF, timing-safe crypto, single-device driver locks, Redis fail-closed GPS ingress, and PostgreSQL 16 RLS.
    - `PERFORMANCE_RENDERING_CACHING_AND_UI_FORENSIC_CODEBASE_TRUTH.md`: Exhaustive ground-truth extraction covering Turbopack build, root layout, portal rendering audits, 6-tier cache matrix, component memory leak audit, and production gate results.
