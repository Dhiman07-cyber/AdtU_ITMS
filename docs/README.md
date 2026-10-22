# ITMS Technical Documentation & System Manual

Welcome to the technical documentation for the **Assam Down Town University (AdtU) Intelligent Transport Management System (ITMS)**.

This repository powers real-time fleet tracking, student bus pass issuance, digital boarding pass validation, automated seat allocations, and payment renewals across the university's bus network.

---

## 🧭 Developer Onboarding: Where Should I Start?

If you are a new engineer, contributor, or academic evaluator reviewing the project, read through the system architecture in this recommended order:

```
  1. Foundational Motivation & Systems Architecture ─► docs/00/README.md
       │                                              (Origin story, 2000-commuter sizing, VPS audit, LLD)
       ▼
  2. Identity & Authentication ──────────────────────► docs/03-identity-and-access/01-auth-architecture.md
       │                                              (Firebase Auth + PostgreSQL dual model, Edge proxy)
       ▼
  3. Trip Core Data Flow ────────────────────────────► docs/01-trip-lifecycle/01-architecture-and-dataflow.md
       │                                              (End-to-end trip start, GPS broadcast, and student delivery)
       ▼
  4. GPS Telemetry Pipeline ─────────────────────────► docs/01-trip-lifecycle/04-gps-pipeline.md
       │                                              (Bounds checking, jump detection, throttling, packet guards)
       ▼
  5. WebSocket Cluster ──────────────────────────────► docs/01-trip-lifecycle/03-websocket-cluster.md
       │                                              (Wire protocol, session restoration, presence handshakes)
       ▼
  6. Redis Pub/Sub Relay ────────────────────────────► docs/01-trip-lifecycle/02-redis-pubsub.md
       │                                              (Cross-node message broadcast and echo suppression)
       ▼
  7. Distributed Locks & Cleanup ────────────────────► docs/01-trip-lifecycle/05-state-machine-and-cleanup.md
       │                                              (PostgreSQL RPCs, atomicity, and active trip locks)
       ▼
  8. Payments & Pass Renewals ───────────────────────► docs/02-payments-and-subscriptions/01-razorpay-lifecycle.md
       │                                              (Razorpay webhook verification and immutable ledger)
       ▼
  9. Observability & Operations ─────────────────────► docs/05-operations-and-observability/01-telemetry-and-metrics.md
                                                      (Prometheus scrape jobs, custom itms_* metrics, and runbooks)
```

---

## 🎨 Interactive System Architecture Visualizations (Archify)

The project includes interactive, browser-explorable architecture and lifecycle diagrams generated via **Archify**:
- 🌐 **[Interactive Enterprise System Architecture Diagram](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00/artifacts/adtu-itms-architecture.html)**: Explorable component topology, cloud/security boundaries, and real-time data flows.
- 🔄 **[Interactive Trip Lifecycle & State Machine Diagram](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00/artifacts/adtu-itms-trip-lifecycle.html)**: State transitions, stop dwell proofs, and deadlock recovery paths.

---

## 📚 Complete Documentation Index

### [00. Foundational Motivation, Capacity & VPS Engineering](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/)
- **[00. Foundational Master Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/README.md)**: Executive overview and navigation guide for senior evaluators.
- **[01. Origin Story, Commuter Reality & Problem Statement](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/01-origin-and-problem-statement.md)**: Real-world AdtU commuter experience, morning anxiety, skipping breakfast, driver distractions, unofficial WhatsApp blind spots, ₹50k-₹65k annual fees, counter queues, and student-driver disputes.
- **[02. System Scope, Personas & Capacity Sizing](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/02-scope-user-base-and-capacity-analysis.md)**: 5 core stakeholder personas, 2,000-commuter capacity sizing, morning rush (07:15–09:15 AM) traffic models, WebSocket fan-out mathematics, and bandwidth calculations.
- **[03. Infrastructure Audit, Cloud Bottlenecks & VPS Cost Engineering](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/03-infrastructure-audit-and-vps-cost-engineering.md)**: Forensic breakdown of Vercel + Render + Supabase Free Tier fatal boundaries (200 conns, 2M msgs/month, 1-week inactivity pause) vs co-located Docker Compose VPS (Hetzner CPX31 at ₹1,250/month).
- **[04. Complete System Components, LLD & Justification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/04-complete-system-components-and-justification.md)**: Exhaustive Low-Level Design (LLD) justifying every directory, service, and API across all 15 business domains with code snippets and failure scenarios.
- **[05. Master Faculty Defense & Architectural Verification Manual](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/05-faculty-defense-and-architectural-validation.md)**: Rigorous technical defense for the 40-year veteran reviewer covering ACID vs BASE, distributed lock leasing, CAP theorem, and answers to 12 tough examination questions.
- **[06. Integration Seams, Platform Unification & Synthesis](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/00%20-%20Master%20Index%20&%20Reading%20Roadmap/06-integration-seams-and-unification-roadmap.md)**: Resolving the developer's perception of system fragmentation through the 4 unifying architectural glues (Identity Spine, Redis Relay, PostgreSQL RPCs, and E2E Test Battery).

### [01. Trip Lifecycle (The Core Domain)](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/)
- **[00. Directory Master Index & Architecture Map](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/README.md)**: Executive overview, state taxonomy, invariant table, and operational flow.
- **[01. Architecture & End-to-End Data Flow](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/01-architecture-and-dataflow.md)**: Start-trip initiation, three-way lock acquisition, live telemetry routing, and student live tracking frontend.
- **[02. Redis Pub/Sub Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/02-redis-pubsub.md)**: Authoritative GPS ingress, Redis Lua guard script (`gps_guard.lua`), channel topologies, and throttled 10s persistence.
- **[03. WebSocket Cluster & Wire Protocol](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/03-websocket-cluster.md)**: Dedicated Node.js WebSocket cluster (WS1), handshake upgrade, room isolation, and FCM push fan-out alerting.
- **[04. GPS Pipeline & Client Ingestion Guards](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/04-gps-pipeline.md)**: Telematics validation, Assam bounding box, velocity checks, Kalman smoothing, and incontrovertible stop dwell audit engine.
- **[05. Trip State Machine & Cleanup Invariants](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/05-state-machine-and-cleanup.md)**: Full state machine, `end_trip_atomically`, automated stale-lock reaper, and unified `evictAllBusRuntimeState` aggregate.
- **[06. NGINX Reverse Proxy & Networking](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/06-nginx-and-networking.md)**: Upstream load balancing (`ip_hash`, `least_conn`), WebSocket upgrades, SSL termination, and security headers.
- **[07. Waiting Flags & Route Corridor Locks](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/07-waiting-flags-and-corridor-locks.md)**: Student waiting flags, hands-free driver HUD alerts, 3-lock route corridor concurrency, and proximity auto-dismissal.
- **[08. Database Schema & RPC Reference](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/08-database-schema-and-rpc-reference.md)**: Active trips schema, three-way locks (`bus_id`, `driver_id`, `route_id`), stop dwell tables, and PL/pgSQL stored procedures.
- **[09. Chaos Hardening & Verification Gates](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/09-chaos-hardening-and-verification-gates.md)**: 18-point chaos hardening, 24-hour continuous endurance test suite, 12 cross-pillar integration seam remediations, and production freeze.
- **[Forensic Truth: Trip Lifecycle](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md)**: Master ground-truth forensic codebase extraction of all SQL RPCs, services, websocket frames, and invariants.

### [02. Payments & Subscriptions](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/README.md)**: Executive roadmap, the 6 payment invariants, and bounded failure handling.
- **[01. Razorpay Payment Lifecycle](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/01-razorpay-lifecycle.md)**: Online checkout, dynamic pricing engine, HMAC SHA-256 signatures, and dual-path webhook verification.
- **[02. Financial Ledger & Pass Renewals](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/02-ledger-and-renewals.md)**: Double-entry ledger immutability (`protect_completed_payments`), atomic seat renewals (`approve_renewal_with_seat`), and refunds.
- **[03. End-to-End Query Audit & Financial Accounting](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/03-payment-query-audit-and-accounting.md)**: Master quantitative accounting of database reads, writes, RPCs, and external HTTP gateway calls per operation, per person, per page.
- **[04. Offline Bank Challan & Counter Receipts](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/04-offline-challan-and-moderator-workflow.md)**: Physical bank challans, counter cash receipts, moderator verification queue, document audit, and approval RPCs.
- **[05. Digital Boarding Pass & Cryptographic QR](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/05-digital-boarding-pass-and-qr-issuance.md)**: Digital boarding pass issuance, 128-bit rotating QR tokens, client-side PDF download, and 4-gate scanner verification.
- **[06. Automated Expiry Crons & Retention](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/06-academic-lifecycle-crons-and-retention.md)**: Automated daily lifecycle crons, session activation, 7d/3d expiry warnings, soft-block seat reclaim, and cascade deletion.
- **[07. Financial Ledger Schema & Atomic RPCs](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/07-database-schema-and-rpc-reference.md)**: Complete relational schema, immutable ledger triggers, check constraints, and stored procedures (`COMPLETE_SCHEMA.sql`).
- **[08. Payment Chaos Hardening & Verification Gates](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/08-chaos-hardening-and-verification-gates.md)**: 16-point chaos hardening, payment network dropout recovery matrix, 12 cross-pillar integration seam remediations, and release freeze.
- **[Forensic Truth: Payment Lifecycle & Accounting](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md)**: Master 14,000+ line forensic codebase extraction covering events P1-P10, chaos remediations, and ledger immutability triggers.

### [03. Identity & Access](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/)
- **[00. Directory Master Index & Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/README.md)**: Executive summary of multi-role identity, edge security, and single-device locking.
- **[01. Dual Authentication Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/01-auth-architecture.md)**: Edge perimeter proxy (`proxy.ts`), anti-spoofing IP resolution, CSRF protection, dual identity spine, and timing-safe first admin bootstrap.
- **[02. Role Permissions & Security Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/02-role-permissions-matrix.md)**: Granular 6-category moderator RBAC matrix, 60s LRU cache, instant session eviction (`4401`), and university audit logs.
- **[03. QR Scanner Auth, Vehicle Binding & Device Sessions](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/03-scanner-auth-and-device-sessions.md)**: Digital student boarding pass lifecycle, 128-bit rotating QR tokens, single-device driver lock, and 4-gate scanner verification.
- **[04. Moderator Permissions & Unauthenticated Account Lifecycle](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/04-moderator-permissions-and-cleanup.md)**: Fleet, route & driver CRUD operations, in-flight trip mutation rejection triggers, driver phone verification, and cascading cleanup.
- **[05. Operational Relief Pool & Dynamic Conductor Check-In](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/05-operational-relief-pool-and-conductor.md)**: Operational reserve driver relief pool, emergency substitute rostering, and dynamic conductor QR check-in architecture.
- **[06. Notification System Architecture & Anti-IDOR Protocol](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/06-notifications-and-anti-idor.md)**: Push notifications, SMS/WhatsApp emergency alerts, in-app notifications, and anti-IDOR security protocol (`INV-NOTIF-001`).
- **[07. Identity & Ops Schema & RLS Reference](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/07-database-schema-and-rls-reference.md)**: Relational tables, foreign keys, check constraints, Row-Level Security (RLS) policies, and administrative stored procedures.
- **[08. Identity Verification Suite & Production Gates](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/08-verification-suite-and-production-gates.md)**: RBAC unit tests, token invalidation chaos tests, scanner tamper tests, and 4 production release gate certifications.
- **[Forensic Truth: Identity, RBAC, Scanner & Ops](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md)**: Master forensic truth extraction covering dual-layer identity, role caches, relief pool drivers, QR scanner 4 gates, and anti-IDOR notifications.

### [04. Students & Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/README.md)**: Executive summary of student onboarding, capacity allocation, and calendar cascades.
- **[01. Student Applications & Prospective Onboarding](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/01-application-and-boarding.md)**: Prospective onboarding, multi-step wizard, moderator verification codes, Cloudinary uploads, and full review/approval/rejection/staging state machine.
- **[02. Bus Capacity Quota Management & Route Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/02-smart-seat-allocation.md)**: Capacity discovery, the "Full Bus / Single-Bus Stop / Alternative Bus" resolution engine, and fleet route/driver rostering allocation (`assign_drivers_atomically`, `assign_routes_atomically`).
- **[03. Admin & Moderator Student Reassignment Domain](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/03-student-reassignment-domain.md)**: Deadlock-free batch student reassignment (`reassign_students_atomically`), 1-click rollback engine (`execute_reassignment_rollback`), immutable audit snapshots, and shift parity math.
- **[04. Dynamic Academic Calendar Cascade & Application Eligibility](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/04-academic-calendar-cascade-and-eligibility.md)**: Dynamic academic calendar engine, simulation mode, deadline configuration, per-student milestone derivation, and global administrative settings.
- **[05. Automated Lifecycle Crons & Retention](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/05-lifecycle-crons-and-retention.md)**: Automated daily lifecycle crons, session activation (`verified_upcoming`), expiry warnings, soft-block seat release, hard cascade deletion (`delete_student_cascade_v1`), and bus load reconciliation (`adminReconcileBusLoads`).
- **[06. Student Profiles & Change Requests](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/06-student-profiles-and-change-requests.md)**: Student profile lifecycle, stop/shift change requests, administrative/moderator student CRUD, `SeatReclaimRequiredError`, and financial pass linking.
- **[07. Academic & Allocation Schema & RPC Reference](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/07-database-schema-and-rpc-reference.md)**: Complete relational schema, foreign keys, immutability check constraints, indexes, and PL/pgSQL stored procedures for academic allocation.
- **[08. Academic Hardening & Cross-Pillar Gates](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/08-hardening-verification-and-cross-pillar-gates.md)**: 14-point hardening audit, invariant verification matrix, state machine proofs, Vitest test suite runs, and cross-pillar integration freeze certification.
- **[Forensic Truth: Academic Lifecycle, Application & Smart Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md)**: Master 11,000+ line forensic truth extraction covering prospective onboarding, capacity discovery, admin review, calendar engine, lifecycle crons, and smart allocation.

### [05. Operations & Observability](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/README.md)**: Executive summary of fleet dispatch, driver rostering, and Prometheus observability.
- **[01. Metrics Telemetry & Health Probes](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/01-telemetry-and-metrics.md)**: Prometheus scraping, custom `itms_*` metric catalogs, Alertmanager triggers, and Grafana dashboards.
- **[02. Operational Incident Runbooks](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/02-incident-runbooks.md)**: Step-by-step procedures for handling stranded driver locks, Redis partitions, ghost map pins, and scheduled maintenance toggles.
- **[03. Fleet Operations, Route Topology & Mutation Safety Guards](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/03-fleet-and-route-operations.md)**: Low-Level Design of vehicle inventory, route geometry, geofenced stops, and mid-trip mutation safety guards (`INV-FLEET-001`, `INV-FLEET-002`).
- **[04. Driver Rostering, Duty Transitions & Stale Trip Reaper](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/04-driver-rosters-and-dispatch.md)**: Low-Level Design of driver rostering, duty status state machine, reserve relief pool, and stale-lock recovery.
- **[05. Integrity Sweep & Self-Healing Seat Reconciler](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/05-integrity-sweep-and-reconciliation.md)**: Nightly diagnostic integrity sweep, `reconcile_bus_seat_loads_v1` self-healing RPC, and append-only immutable audit logging.

### [06. Evidence & Verification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/README.md)**: Executive overview and navigation guide across all empirical evidence files.
- **[01. Canonical System Invariant Ledger](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/01-system-invariants-ledger.md)**: Permanent register of all 45 architectural, security, and business invariants across 11 core subsystems (`INV-AUTH`, `INV-WS`, `INV-TRIP`, `INV-GPS`, `INV-PAY`, `INV-CAP`).
- **[02. Multi-Tier Verification Battery, Concurrency Proofs & Production Gate](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/02-verification-battery-and-concurrency.md)**: 80 test suites (672 tests passing, exit code 0, 100% passing), Golden Test Battery, ACID row-lock concurrency proofs, executable verification runbook, and production release gate.
- **[03. Frontend Performance, Next.js 16 App Router & Responsive Layout Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/03-frontend-performance-and-responsive-matrix.md)**: Server Component LCP overhaul, 3.5s bounded UX loading architecture, continuous fluid layout engine, and master breakpoint matrix across 12 viewports.
- **[04. Security Decisions, Findings Ledger & Schema Reproducibility](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/04-security-decisions-and-findings-ledger.md)**: Formal security decisions (SEC-DEC-01 to 12), canonical findings ledger (FND-001 to 17 remediated), and `SECURITY DEFINER` isolated search path hardening.

### [07. GPS & Location Integrity](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/README.md)**: Executive overview of the GPS telemetry pipeline, Kalman filtering, and stop dwell verification.
- **[01. Telematics Ingestion, Spatial Bounds & Kalman Pipeline](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/01-telematics-ingestion-and-kalman-pipeline.md)**: Low-Level Design of the telematics ingestion pipeline, Assam bounding box, velocity checks, Kalman filtering, and atomic Redis Lua guards.
- **[02. Stop Dwell Audit Proof Engine & Geofence Telematics](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/02-stop-dwell-audit-proof-engine.md)**: Low-Level Design of the stop dwell audit proof engine, geofenced proximity, `stop_dwell_logs` schema, and throttled Redis synchronization (>85% write reduction).
- **[03. Trip Lifecycle & Route-Corridor Hardening LLD](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/03-trip-lifecycle-and-route-corridor-hardening-lld.md)**: Exhaustive Low-Level Design documenting directional progress math, lazy self-healing Redis hydration, and corridor waiting flag geofencing.
- **[GPS Forensic Audit & Verification Report](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md)**: Master audit report certifying Source-to-Screen pipeline, Playwright simulation, and route deviation hysteresis.
- **[Bus Marker Route Alignment Final Report](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/ADTU_ITMS_BUS_MARKER_ROUTE_ALIGNMENT_FINAL_REPORT.md)**: Comprehensive report detailing the MapLibre bus marker route alignment, interpolation dynamics, easing curves, and client-side telemetry smoothing.

### [08. Admin System Configuration](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/README.md)**: Executive overview of pure PostgreSQL system settings, dynamic deadlines, and zero-Redis self-healing.
- **[01. Academic Calendar, Deadlines & Lifecycle Automation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/01-academic-calendar-and-deadlines.md)**: Dynamic per-student year derivation, programmatic lifecycle milestones (`deriveAcademicLifecycle`), leap year normalization, and automated crons.
- **[02. Bus Fees, Pricing Engine & Financial Verification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/02-bus-fees-and-pricing.md)**: Server-authoritative fee storage, versioned adjustment history, zero-Redis fee self-healing, and offline challan verification.
- **[03. System Settings, SRE Controls & Audit Logging](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/03-system-settings-and-maintenance.md)**: Global system settings in PostgreSQL `public.system_settings`, UI presentation stripping, data retention crons, and immutable forensic audit logging.

### [09. Canonical Verification Suites](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/README.md)**: Executive overview of the 80 test suites, chaos batteries, and the 4 release gates.
- **[01. Test Suite Architecture, Chaos Verification & Release Gates](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/01-test-suite-architecture-and-verification-gates.md)**: Master catalogue of all 80 test files and 672 test cases, chaos simulation methodologies, and gate outputs.
- **[Master System Specification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/ITMS_SYSTEM_SPECIFICATION.md)**: System overview, trip-first operational spine, open seating rules, container topology, and state lifecycle.
- **[Master Failure & Resilience Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/ITMS_FAILURE_AND_RESILIENCE_MATRIX.md)**: Failure mode analysis, recovery actions, and verification results across Redis, PostgreSQL, and WebSocket clusters.

### [10. Performance & Security Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/README.md)**: Executive overview, performance benchmarks, and security verification roadmap.
- **[01. Rendering Architecture & Route Inventory](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/01-rendering-architecture-and-route-inventory.md)**: Complete audit of all 222 compiled routes: Server Components vs Client Components, hydration costs, and component responsibilities.
- **[02. Component Overhead & Dead-Weight Elimination](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/02-component-overhead-and-dead-weight-elimination.md)**: Component resource consumption analysis, safe dead-weight elimination without affecting consistency.
- **[03. Multi-Tier Caching Architecture & Data Lifecycle](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/03-caching-mechanisms-and-data-lifecycle.md)**: Full 6-tier caching architecture (React 19 compiler, in-memory domain TTLs, Redis 7 Pub/Sub, HTTP keepalives, Turbopack, and image optimization).
- **[04. Frontend Performance & Core Web Vitals Benchmarks](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/04-frontend-performance-and-cwv-benchmarks.md)**: Core Web Vitals audit (LCP 0.8s, CLS 0.02, INP <50ms, TTIS ≤3.5s), velocity telemetry restoration, and container-query layout engine.
- **[05. Full-Stack Security & Fail-Closed Boundaries](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/05-full-stack-security-and-fail-closed-boundaries.md)**: OWASP ASVS compliance: Edge proxy CSRF, timing-safe crypto, single-device driver locks, Redis fail-closed GPS ingress, and PostgreSQL 16 RLS.
- **[Forensic Truth: Performance, Rendering, Caching & UI](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/PERFORMANCE_RENDERING_CACHING_AND_UI_FORENSIC_CODEBASE_TRUTH.md)**: Exhaustive ground-truth extraction covering Turbopack build, root layout, portal rendering audits, 6-tier cache matrix, component memory leak audit, and production gate results.

---

## 🛠️ Essential Development & Operational Commands

```bash
# Run full development environment (Next.js + WebSocket Server)
npm run dev

# Run configuration and environment drift validation
npm run validate:config
npm run validate:env

# Check platform health endpoints with retry logic
npm run health:check

# Run end-to-end integration tests
npm run test:e2e:golden      # Full driver-student golden lifecycle
npm run test:e2e:isolation   # Cross-bus security boundary isolation
npm run test:e2e:redis       # Multi-node Redis relay test

# Collect full diagnostic snapshot for operational triage
npm run diagnose
```


### Production Verification Gates (All 4 Gates Passed)
- **Gate 1 (TypeScript Compilation)**: `npx tsc --noEmit` &rarr; **PASSED (Exit Code 0, 0 Errors)**
- **Gate 2 (ESLint Verification)**: `npm run lint` &rarr; **PASSED (Exit Code 0, 0 Errors)**
- **Gate 3 (Vitest Automated Tests)**: `npm run test:run` &rarr; **PASSED (82/82 Test Files, 687/687 Tests Passing, 0 Failures)**
- **Gate 4 (Production Build)**: `npm run build` &rarr; **PASSED (Next.js 16.4.2 Turbopack Production Build Clean across all 184 Routes)**
- **Authoritative Database Sync Script**: `supabase/PRODUCTION_SYNC.sql` (1,011 lines, idempotent DDL, constraints, RLS & RPCs)

### The Master Architecture & System Truth Authority
- **Master Engineering Authority**: `OVERHEAD_CACHING_N_PLUS_1_AND_DEEP_DEFECTS_FORENSIC_TRUTH.md` — Complete architectural authority covering the 4 Core System Rewires (Zero-Wait Handover, Web Worker Ingestion, Local-First Search Parity, Singleflight Caching) and 100 Hardened System Specifications.

### The 6 Authoritative Forensic Codebase Bibles
1. **Bible 1**: `docs/01-trip-lifecycle/TRIP_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md` — Complete Trip Lifecycle, GPS Pipeline, WebSockets & Realtime State
2. **Bible 2**: `docs/02-payments-and-subscriptions/PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md` — Razorpay Payment Lifecycle, Ledger & Subscription Crons
3. **Bible 3**: `docs/04-students-and-allocation/ACADEMIC_AND_ALLOCATION_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md` — Academic Calendar, Seat Allocation & Reassignment Engine
4. **Bible 4**: `docs/03-identity-and-access/IDENTITY_RBAC_SCANNER_AND_OPS_FORENSIC_CODEBASE_TRUTH.md` & `IDENTITY_RBAC_SCANNER_AND_FLEET_OPS_FORENSIC_CODEBASE_TRUTH.md` — Identity Spine, 6-Category RBAC, Scanner & Driver Ops
5. **Bible 5**: `docs/05-operations-and-observability/NOTIFICATIONS_ADMIN_CONFIG_OBSERVABILITY_AND_SRE_FORENSIC_CODEBASE_TRUTH.md` & `NOTIFICATIONS_ADMIN_CONFIG_OBSERVABILITY_AND_SRE_FORENSIC_CODEBASE_TRUTH.md` — Notification Engine, Admin Config, SRE Sweeps & Observability
6. **Bible 6**: `docs/10-performance-and-security/PERFORMANCE_RENDERING_CACHING_AND_UI_FORENSIC_CODEBASE_TRUTH.md` & `FRONTEND_RENDERING_CACHING_WEBGL_AND_UX_FORENSIC_CODEBASE_TRUTH.md` — Full-Stack Rendering, Caching, MapLibre WebGL & UI/UX Engine
