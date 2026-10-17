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
- **[01. Architecture & End-to-End Data Flow](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/01-architecture-and-dataflow.md)**: Conceptual walkthrough of how trips operate across drivers, students, API gateways, and WebSockets without code snippet clutter.
- **[02. Redis Pub/Sub Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/02-redis-pubsub.md)**: Multi-node message relaying, channel naming, payload envelopes, node identity, and echo prevention.
- **[03. WebSocket Cluster & Wire Protocol](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/03-websocket-cluster.md)**: Multi-node topology, handshake protocol, presence frames, reconnect tokens, and rate limits.
- **[04. GPS Pipeline & Client Ingestion Guards](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/04-gps-pipeline.md)**: Dual-path ingestion (WS vs HTTP), coordinate bounds, Haversine jump calculations, speed validations, and MapLibre animation guards.
- **[05. Trip State Machine & Cleanup Invariants](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/05-state-machine-and-cleanup.md)**: Full state machine, PostgreSQL transactional RPCs (`acquire_trip_lock`, `end_trip_atomically`), and post-trip cleanup.
- **[06. NGINX Reverse Proxy & Networking](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/01-trip-lifecycle/06-nginx-and-networking.md)**: Upstream load balancing (`ip_hash`, `least_conn`), WebSocket upgrades, SSL termination, and security headers.

### [02. Payments & Subscriptions](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/)
- **[01. Razorpay Payment Lifecycle](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/01-razorpay-lifecycle.md)**: Online checkout, HMAC SHA-256 webhook validation, and immutable transaction records.
- **[02. Financial Ledger & Pass Renewals](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/02-ledger-and-renewals.md)**: Academic terms, pass validity dates, soft/hard blocks, offline approval workflows, and automated expiry crons.

### [03. Identity & Access](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/)
- **[01. Dual Authentication Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/01-auth-architecture.md)**: Firebase Auth integration with Supabase PostgreSQL, Next.js 16 Edge proxy, and token verification flows.
- **[02. Role Permissions & Security Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/02-role-permissions-matrix.md)**: RBAC access rules, granular 6-category moderator permission matrix (`students`, `drivers`, `buses`, `routes`, `applications`, `payments`), unified `/admin/moderators` UI, status endpoints, and universal access block screen.

### [04. Students & Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/)
- **[01. Student Applications & Digital Bus Passes](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/01-application-and-boarding.md)**: Registration workflow, three application streams (Fresh, Upcoming Gated, Renewals), dynamic QR code contract, and open-seating boarding scanner validation.
- **[02. Bus Capacity Quota Management & Route Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/02-smart-seat-allocation.md)**: Open seating philosophy, route stop sequences, atomic shift load counters (`bus_increment_capacity`), the three allocation cases, and the 3-tab unified Smart Allocation hub (`/admin/smart-allocation`).
- **[03. Admin & Moderator Student Reassignment Domain](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/03-student-reassignment-domain.md)**: Single and bulk student reassignments, shift transfers, atomic stored procedure `reassign_students_atomically`, deadlock avoidance, rollback engine `execute_reassignment_rollback`, and soft-blocked seat release edge cases.

### [05. Operations & Observability](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/)
- **[01. Metrics Telemetry & Health Probes](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/01-telemetry-and-metrics.md)**: Prometheus scraping, custom `itms_*` metric catalogs, Alertmanager triggers, and Grafana dashboards.
- **[02. Operational Incident Runbooks](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/02-incident-runbooks.md)**: Step-by-step procedures for handling stranded driver locks, Redis partitions, ghost map pins, and scheduled maintenance toggles.

### [06. Evidence & Verification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/README.md)**: Executive overview and navigation guide across all empirical evidence files.
- **[01. Canonical System Invariant Ledger](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/01-system-invariants-ledger.md)**: Permanent register of all 45 architectural, security, and business invariants across 11 core subsystems (`INV-AUTH`, `INV-WS`, `INV-TRIP`, `INV-GPS`, `INV-PAY`, `INV-CAP`).
- **[02. Multi-Tier Verification Battery, Concurrency Proofs & Production Gate](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/02-verification-battery-and-concurrency.md)**: 48 test suites (314 tests passing, exit code 0), Golden Test Battery (G01–G29), ACID row-lock concurrency proofs (`bus_increment_capacity`, `reassign_students_atomically`), executable verification runbook, and production release gate.
- **[03. Frontend Performance, Next.js 16 App Router & Responsive Layout Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/03-frontend-performance-and-responsive-matrix.md)**: Server Component LCP overhaul (70% faster First Paint), 3.5s bounded UX loading architecture, full-pipeline speed telemetry, continuous fluid layout engine (`clamp()`), and master breakpoint matrix across 12 viewports.
- **[04. Security Decisions, Findings Ledger & Schema Reproducibility](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/06-evidence-and-verification/04-security-decisions-and-findings-ledger.md)**: Formal security decisions (SEC-DEC-01 to 12), canonical findings ledger (FND-001 to 17 remediated), `SECURITY DEFINER` isolated search path hardening, and clean-slate database schema reconstruction proof.

### [07. GPS & Location Integrity](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/)
- **[GPS Forensic Audit & Verification Report](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/ADTU_ITMS_GPS_FORENSIC_AUDIT_FINAL_REPORT.md)**: Master audit report certifying Source-to-Screen pipeline, answers to Sir's 10 questions with measured distributions, real-browser Playwright simulation, route deviation hysteresis, and hardware transition readiness.
- **[Bus Marker Route Alignment Final Report](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/07-gps-and-location-integrity/ADTU_ITMS_BUS_MARKER_ROUTE_ALIGNMENT_FINAL_REPORT.md)**: Comprehensive report detailing the MapLibre bus marker route alignment, interpolation dynamics, easing curves, and client-side telemetry smoothing.

### [08. Admin System Configuration](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/)
- **[01. Academic Calendar, Deadlines & Lifecycle Automation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/01-academic-calendar-and-deadlines.md)**: Dynamic per-student year derivation, programmatic lifecycle milestones (`deriveAcademicLifecycle`), leap year normalization, simulation mode, and automated crons.
- **[02. Bus Fees, Pricing Engine & Financial Verification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/02-bus-fees-and-pricing.md)**: Server-authoritative fee storage, versioned adjustment history, automated announcement broadcasts, Razorpay checkout calculations, and offline challan verification.
- **[03. System Settings, SRE Controls & Audit Logging](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/08-admin-system-configuration/03-system-settings-and-maintenance.md)**: Global system settings, public landing config, UI presentation stripping, data retention crons, in-memory caching with TTL, and immutable forensic audit logging.

### [09. Canonical Verification Suites](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/)
- **[Master System Specification](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/ITMS_SYSTEM_SPECIFICATION.md)**: System overview, trip-first operational spine, open seating rules, container topology, and state lifecycle.
- **[Master Failure & Resilience Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/09-system-verification/ITMS_FAILURE_AND_RESILIENCE_MATRIX.md)**: Failure mode analysis, recovery actions, and verification results across Redis, PostgreSQL, and WebSocket clusters.

### [10. Performance & Security Architecture](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/)
- **[00. Directory Master Index & Roadmap](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/README.md)**: Executive overview, performance benchmarks, and security verification roadmap.
- **[01. Rendering Architecture & Route Inventory](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/01-rendering-architecture-and-route-inventory.md)**: Complete audit of all 224 compiled routes: Server Components vs Client Components, hydration costs, and component responsibilities.
- **[02. Component Overhead & Dead-Weight Elimination](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/02-component-overhead-and-dead-weight-elimination.md)**: Component resource consumption analysis, safe dead-weight elimination (Motion, Lenis on mobile, dual toasts, Recharts, exporters) without affecting consistency.
- **[03. Multi-Tier Caching Architecture & Data Lifecycle](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/03-caching-mechanisms-and-data-lifecycle.md)**: Full 6-tier caching architecture (React 19 compiler, in-memory domain TTLs, Redis 7 Pub/Sub, HTTP keepalives, Turbopack, and image optimization).
- **[04. Frontend Performance & Core Web Vitals Benchmarks](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/04-frontend-performance-and-cwv-benchmarks.md)**: Core Web Vitals audit (LCP 0.8s, CLS 0.02, INP <50ms, TTIS ≤3.5s), velocity telemetry restoration, and container-query layout engine.
- **[05. Full-Stack Security & Fail-Closed Boundaries](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/10-performance-and-security/05-full-stack-security-and-fail-closed-boundaries.md)**: OWASP ASVS compliance: Edge proxy CSRF, timing-safe crypto, single-device driver locks, Redis fail-closed GPS ingress, and PostgreSQL 16 RLS.

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
