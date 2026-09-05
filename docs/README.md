# ITMS Technical Documentation & System Manual

Welcome to the technical documentation for the **Assam Down Town University (AdtU) Intelligent Transport Management System (ITMS)**.

This repository powers real-time fleet tracking, student bus pass issuance, digital boarding pass validation, automated seat allocations, and payment renewals across the university's bus network.

---

## 🧭 Developer Onboarding: Where Should I Start?

If you are a new engineer or contributor joining the project, read through the system architecture in this recommended order:

```
  1. System Architecture Overview (This README)
       │
       ▼
  2. Identity & Authentication ────────► docs/03-identity-and-access/01-auth-architecture.md
       │                                 (Firebase Auth + PostgreSQL dual model, Edge proxy)
       ▼
  3. Trip Core Data Flow ──────────────► docs/01-trip-lifecycle/01-architecture-and-dataflow.md
       │                                 (End-to-end trip start, GPS broadcast, and student delivery)
       ▼
  4. GPS Telemetry Pipeline ───────────► docs/01-trip-lifecycle/04-gps-pipeline.md
       │                                 (Bounds checking, jump detection, throttling, packet guards)
       ▼
  5. WebSocket Cluster ────────────────► docs/01-trip-lifecycle/03-websocket-cluster.md
       │                                 (Wire protocol, session restoration, presence handshakes)
       ▼
  6. Redis Pub/Sub Relay ──────────────► docs/01-trip-lifecycle/02-redis-pubsub.md
       │                                 (Cross-node message broadcast and echo suppression)
       ▼
  7. Distributed Locks & Cleanup ──────► docs/01-trip-lifecycle/05-state-machine-and-cleanup.md
       │                                 (PostgreSQL RPCs, atomicity, and active trip locks)
       ▼
  8. Payments & Pass Renewals ─────────► docs/02-payments-and-subscriptions/01-razorpay-lifecycle.md
       │                                 (Razorpay webhook verification and immutable ledger)
       ▼
  9. Observability & Operations ───────► docs/05-operations-and-observability/01-telemetry-and-metrics.md
                                         (Prometheus scrape jobs, custom itms_* metrics, and runbooks)
```

---

## 📚 Complete Documentation Index

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
- **[02. Role Permissions & Security Matrix](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/03-identity-and-access/02-role-permissions-matrix.md)**: RBAC access rules for Students, Drivers, Moderators, and Admins; scanner context validation and PostgreSQL RLS policies.

### [04. Students & Allocation](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/)
- **[01. Student Applications & Digital Bus Passes](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/01-application-and-boarding.md)**: Registration workflow, application state machine, dynamic QR code contract, and mobile boarding scanners.
- **[02. Smart Seat Allocation & Routes](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/04-students-and-allocation/02-smart-seat-allocation.md)**: Route stops, atomic seat capacity counters (`bus_increment_capacity`), shift scheduling, and vehicle reallocations.

### [05. Operations & Observability](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/)
- **[01. Metrics Telemetry & Health Probes](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/01-telemetry-and-metrics.md)**: Prometheus scraping, custom `itms_*` metric catalogs, Alertmanager triggers, and Grafana dashboards.
- **[02. Operational Incident Runbooks](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/05-operations-and-observability/02-incident-runbooks.md)**: Step-by-step procedures for handling stranded driver locks, Redis partitions, ghost map pins, and scheduled maintenance toggles.

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
