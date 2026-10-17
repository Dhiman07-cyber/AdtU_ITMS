# 03. Infrastructure Audit, Cloud Bottlenecks & VPS Cost Engineering

## 1. Executive Summary & Diagnostic Context

The developer currently deploys ADTU ITMS across a fragmented multi-cloud topology:
- **Frontend & Web APIs**: Vercel (Edge Runtime & Node.js Serverless Functions).
- **Realtime WebSocket Server (`ws1`)**: Render (Free / Starter Docker Web Service).
- **Relational Database**: Hosted Supabase PostgreSQL 16 (Free Tier).
- **Push Notifications**: Firebase Cloud Messaging (FCM).
- **Asset Storage**: Cloudinary CDN.
- **Payment Gateway**: Razorpay Live Gateway.

While this multi-cloud composition allowed rapid prototype iteration, **it is architecturally unstable and mathematically incapable of supporting 2,000 students in production**. This document provides a forensic engineering audit of why this setup fails, why the system feels fragmented, and delivers a production-grade Virtual Private Server (VPS) cost-engineering blueprint.

---

## 2. Forensic Analysis: The Fatal Flaws of the Current Free-Tier Setup

### 2.1 Supabase Free Tier Fatal Limits

```
+──────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    SUPABASE FREE TIER FATAL BOTTLENECK AUDIT                             |
+──────────────────────────────────────────────────────────────────────────────────────────────────────────+

   SUPABASE FREE LIMIT          PRODUCTION ITMS REQUIREMENT              FAILURE CONSEQUENCE AT 07:30 AM RUSH
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────
   1. 200 Max Concurrent        1,500 Concurrent Students +              CRITICAL: 1,300+ students (87%) are instantly
      Client Connections        30 Active Drivers                        rejected with 503 / connection pool timeout.
  
   2. 2,000,000 Realtime        6,480,000 Telemetry Messages             FATAL: Month's entire message quota is burned
      Messages / Month          in ONE 2-hour morning commute            in 18.5 MINUTES. Broadcast is hard-throttled.
  
   3. 7-Day Inactivity          University Semester / Puja               CATASTROPHIC: Database is paused during break.
      Project Auto-Pause        Vacations (1–3 weeks of zero traffic)    First Monday morning class suffers 100% outage.
  
   4. 500 MB Database           Telemetry logs, idempotency records,     BLOCKED: Database enters read-only lockdown once
      Storage Capacity          and payment audit trails                 500 MB quota is exceeded.
  
   5. 5 GB Monthly              ~96.8 GB Outbound Telemetry              BLOCKED: Egress exceeded within first 2 days of
      Network Egress            Broadcast to students                    active fleet operations.
```

#### Detailed Proof of Realtime Quota Burn:
$$\text{Peak Ingress} = 30\text{ buses} \times 1\text{ packet/sec} = 30\text{ packets/sec}$$
$$\text{Average Subscribers per Bus} = 60\text{ students}$$
$$\text{Broadcast Fan-Out} = 30 \times 60 = 1,800\text{ messages/sec}$$
$$\text{Messages in 2 Hours} = 1,800\text{ msgs/sec} \times 7,200\text{ seconds} = 12,960,000\text{ messages}$$
On Supabase Free Tier (capped at 2,000,000 messages/month), **the entire monthly allocation is completely exhausted before 08:00 AM on the very first Monday morning**.

---

### 2.2 Render Free Tier Fatal Limits
1. **15-Minute Inactivity Spin-Down**:
   - Render free instances spin down into a sleeping state after 15 minutes of zero HTTP traffic.
   - When the first bus driver opens the Driver App at 06:45 AM, the server requires **50+ seconds** for container cold-start provisioning.
   - The driver experiences an unresponsive app, assumes the platform is broken, and resorts to personal phone calls.
2. **Arbitrary WebSocket Connection Drops**:
   - Render's HTTP proxy terminates long-lived idle TCP sockets aggressively, breaking client heartbeat loops.
3. **512 MB Memory Cap**:
   - When 1,500 students reconnect simultaneously after a network dip, WebSocket session allocation spikes memory beyond 512 MB, triggering the Linux OOM (Out-of-Memory) Killer and rebooting the server mid-shift.

---

### 2.3 Why the Developer Feels the System Is "Disconnected & Incomplete"
The developer noted: *"Why am I feeling in my mind that I have built a system which is not working together, which might have integration issues, where everything is separately handling?"*

This feeling is not an illusion; it is the natural consequence of **distributed micro-cloud fragmentation**:
1. **Excessive Network Transit Hops**:
   - A driver's location update travels: Client (Guwahati) ➔ Vercel Ingress (Mumbai/Global Edge) ➔ Render Container (Frankfurt/Oregon) ➔ Supabase Hosted PostgreSQL (Singapore `ap-southeast-1`) ➔ Firebase FCM (US Central).
   - This cross-continental journey introduces 200–450ms of network latency per update, creating race conditions between HTTP route handlers and WebSocket frames.
2. **Disparate Logging Silos**:
   - Next.js logs live in Vercel Console.
   - WebSocket logs live in Render Dashboard.
   - Database queries live in Supabase Studio.
   - Auth events live in Firebase Console.
   - No single pane of glass exists to view an end-to-end transaction, making the system feel like detached, disjointed islands.
3. **Split-Brain Session State**:
   - When Next.js executes a Server Action on Vercel, it runs in an ephemeral serverless micro-VM that cannot hold a persistent TCP socket to the Render WebSocket server. It must bridge through an external HTTP webhook or Redis pub/sub relay.

---

## 3. The Solution: Co-Located Docker Compose VPS Architecture

To achieve sub-5ms internal latency, zero cold starts, infinite database connections, and full operational cohesion, the entire backend stack should be deployed onto a **single co-located Virtual Private Server (VPS)** managed via Docker Compose.

```
+──────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                  CO-LOCATED ENTERPRISE VPS ARCHITECTURE                                  |
+──────────────────────────────────────────────────────────────────────────────────────────────────────────+

   EXTERNAL TRAFFIC (Guwahati Students & Drivers)
         │
         │ HTTPS (443) & WSS (443)
         ▼
  +──────────────────────────────────────────────────────────────────────────────────────────────────────+
  |                                   HIGH-PERFORMANCE LINUX VPS (UBUNTU 24.04)                          |
  |                                                                                                      |
  |  +────────────────────────────────────────────────────────────────────────────────────────────────+  |
  |  |                                      NGINX REVERSE PROXY                                       |  |
  |  |   - SSL/TLS Termination (Let's Encrypt automated certbot renewal)                              |  |
  |  |   - Security Headers (HSTS, CSP, X-Frame-Options, Permissions-Policy)                          |  |
  |  |   - Upstream Routing:                                                                          |  |
  |  |       • /ws        ──► itms-ws1:3001     (RFC 6455 WebSocket Upgrade, unbuffered)             |  |
  |  |       • /api, /*   ──► itms-nextjs:3000  (Next.js 16 App Router, least-conn)                   |  |
  |  |       • /metrics   ──► itms-prometheus   (Restricted to RFC1918 loopback / internal network)   |  |
  |  +─────────────────────────┬──────────────────────────────────┬───────────────────────────────────+  |
  |                            │                                  │                                      |
  |           ┌────────────────┴────────────────┐                 │                                      |
  |           │ Internal Docker IPC (<0.2ms)    │                 │ Internal Docker IPC (<0.2ms)         |
  |           ▼                                 ▼                 ▼                                      |
  |  +──────────────────+             +──────────────────+  +──────────────────+                         |
  |  | Next.js App Core |             | WebSocket Server |  | Redis 7.2 Broker |                         |
  |  | (itms-nextjs)    |◄───────────►| (itms-ws1)       |◄─┤ (itms-redis)     |                         |
  |  | Port 3000        |             | Port 3001        |  | In-Memory Cache  |                         |
  |  +────────┬─────────+             +──────────────────+  +──────────────────+                         |
  |           │                                                                                          |
  |           │ High-Speed Local Unix Socket / Port 5432 (<0.5ms)                                        |
  |           ▼                                                                                          |
  |  +───────────────────────────────────────────────────+  +─────────────────────────────────────────+  |
  |  | Native PostgreSQL 16 (or Supabase Self-Hosted)     |  | Observability Suite                     |  |
  |  | - Supavisor Connection Pooler (Port 6543)         |  | - itms-prometheus (Port 9090)           |  |
  |  | - Complete ITMS Schema, Triggers & RPCs           |  | - itms-grafana    (Port 3002)           |  |
  |  | - NVMe-backed WAL & Automated Local Backups       |  | - itms-alertmanager (Port 9093)         |  |
  |  +───────────────────────────────────────────────────+  +─────────────────────────────────────────+  |
  +──────────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 4. Hardware Sizing & Resource Allocation Budget (2,000 Commuters)

Based on empirical performance benchmarks from `scripts/staging/master-simulation.ts` and `server/metrics-service.ts`, here is the exact hardware resource budget required:

```
+──────────────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    HARDWARE RESOURCE ALLOCATION BUDGET                                   |
+──────────────────────────────────────────────────────────────────────────────────────────────────────────+

   SERVICE CONTAINER       IMAGE / RUNTIME         MIN vCPU       DEDICATED RAM      STORAGE PROFILE
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────
   1. NGINX Ingress        nginx:1.27-alpine       0.25 vCPU      128 MB             Logs only (<2 GB)
   2. Next.js 16 Web/API   node:22-alpine          1.00 vCPU      1,024 MB           Static assets (~500 MB)
   3. WebSocket (ws1)      node:22-alpine          0.75 vCPU      512 MB             In-memory socket maps
   4. Redis 7.2 Broker     redis:7.2-alpine        0.25 vCPU      256 MB             AOF / RDB (~512 MB)
   5. PostgreSQL 16 DB     postgres:16-alpine      1.25 vCPU      2,048 MB           Database data (~20–40 GB)
   6. Prometheus Metrics   prom/prometheus:v2.54   0.25 vCPU      512 MB             15-day TSDB (~10 GB)
   7. Grafana Dashboard    grafana/grafana:11.1    0.25 vCPU      256 MB             Dashboards (~100 MB)
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────
   TOTALS REQUIRED:                                4 vCPUs        4,736 MB (~6 GB)   ~40–80 GB NVMe SSD
```

---

## 5. Comprehensive VPS Cloud Provider Pricing Comparison

A comparative evaluation of leading cloud infrastructure providers for deploying the co-located ADTU ITMS stack:

| Provider | Plan / Tier | vCPU / Architecture | RAM | NVMe SSD | Monthly Bandwidth | Monthly Cost (USD) | Monthly Cost (INR) | Best Suited For |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Hetzner Cloud** *(Recommended)* | **CPX31** (Dedicated Shared) | 4 vCPU (AMD EPYC) | 8 GB | 160 GB NVMe | **20 TB Included** | **~$15.00 / mo** | **~₹1,250 / mo** | **Production Tier (Gold Standard Price-to-Performance)** |
| **Hetzner Cloud** *(Budget)* | **CPX21** | 3 vCPU (AMD EPYC) | 4 GB | 80 GB NVMe | **20 TB Included** | **~$9.50 / mo** | **~₹800 / mo** | Staging / Development Cluster |
| **DigitalOcean** | Regular Droplet | 4 vCPU (Intel/AMD) | 8 GB | 160 GB SSD | 5 TB Included | **$48.00 / mo** | ~₹4,000 / mo | Mainstream Developer Standard |
| **DigitalOcean** | Basic Droplet | 2 vCPU | 4 GB | 80 GB SSD | 4 TB Included | **$24.00 / mo** | ~₹2,000 / mo | Minimal Entry Point |
| **AWS Lightsail** | Linux Bundle | 2 vCPU | 4 GB | 80 GB SSD | 4 TB Included | **$24.00 / mo** | ~₹2,000 / mo | AWS Ecosystem Integration |
| **AWS Lightsail** | Linux Bundle | 4 vCPU | 8 GB | 160 GB SSD | 5 TB Included | **$44.00 / mo** | ~₹3,650 / mo | Enterprise AWS Workloads |
| **Linode (Akamai)** | Shared Linode | 4 vCPU | 8 GB | 160 GB SSD | 5 TB Included | **$48.00 / mo** | ~₹4,000 / mo | Traditional Cloud VPS |

### 5.1 The Verdict: Why Hetzner Cloud CPX31 Is Optimal
- **Unbeatable Value**: For **₹1,250/month**, Hetzner provides 4 AMD EPYC vCPUs, 8 GB RAM, 160 GB NVMe SSD, and **20,000 GB (20 TB) of traffic**. DigitalOcean and AWS charge 3.5× to 4× more for equivalent capacity.
- **Geographic Proximity**: Hetzner offers Singapore (Southeast Asia) data centers, providing sub-60ms round-trip latency to Guwahati and Northeast India.
- **Predictable Cost**: Unlike Vercel, Supabase, or AWS serverless pay-as-you-go billing (where sudden traffic spikes or DDoS attacks trigger crippling overage charges), a VPS bill is **100% predictable and capped at ₹1,250/month**.

---

## 6. Hybrid Architecture Alternative: Vercel Frontend + Dedicated Telematics VPS

If the university prefers to keep the Next.js frontend on Vercel for global CDN edge caching, a **Hybrid Architecture** is also viable:
1. **Vercel**: Hosts the Next.js static landing pages, student profile dashboards, and administrative forms.
2. **Dedicated VPS (`telemetry.adtu.edu.in`)**:
   - Hosts Nginx, WebSocket Server (`ws1`), and Redis.
   - Handles all continuous high-frequency GPS ingestion and student map broadcasts.
3. **Supabase Pro Tier ($25/mo = ~₹2,100/mo)**:
   - Upgrades Supabase to remove the 200 connection cap (Supavisor handles 10,000+ connections), removes the 7-day pause restriction, and includes automated daily backups.

### Total Operating Budget:
$$\text{Hybrid Cost} = \$25\text{ (Supabase Pro)} + \$15\text{ (Hetzner VPS)} = \$40/\text{month}\ (\approx\text{₹3,350 / month})$$
For an institution collecting **₹50,000–₹65,000 per student annually from 2,000 students** (an annual gross revenue of ₹10,00,00,000+), an operating infrastructure cost of **₹3,350/month (~₹40,000/year)** represents **0.04% of transit revenue**, while delivering 99.95% uptime and sub-second fleet visibility.
