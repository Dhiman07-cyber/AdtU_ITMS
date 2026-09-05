/**
 * High-Scale Production Load & Stress Simulation Engine
 * Assam Down Town University ITMS Platform
 *
 * Configurable multi-role concurrency simulator:
 * - 100 Drivers (Streaming high-frequency GPS telemetry via HTTP/WebSocket)
 * - 3,000 Students (Querying schedules, route navigation, bus locations)
 * - 5 Admins (Monitoring fleet operations, bulk reassignments, analytics)
 * - 10 Moderators (Managing active routes, driver alerts, notifications)
 */

import http from 'http';
import https from 'https';
import WebSocket from 'ws';

export interface LoadGeneratorConfig {
  targetHost: string;
  wsHost: string;
  driverCount: number;
  studentCount: number;
  adminCount: number;
  moderatorCount: number;
  durationSeconds: number;
  gpsFrequencyHz: number;
  concurrencyPoolSize: number;
}

export interface SimulationStats {
  requestsSent: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  driverGpsUpdatesSent: number;
  studentQueriesSent: number;
  adminOperationsSent: number;
  moderatorOperationsSent: number;
  wsConnectionsActive: number;
}

export class LoadGenerator {
  private config: LoadGeneratorConfig;
  private isRunning = false;
  private stats: SimulationStats = {
    requestsSent: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalLatencyMs: 0,
    minLatencyMs: Infinity,
    maxLatencyMs: 0,
    driverGpsUpdatesSent: 0,
    studentQueriesSent: 0,
    adminOperationsSent: 0,
    moderatorOperationsSent: 0,
    wsConnectionsActive: 0,
  };

  constructor(config: Partial<LoadGeneratorConfig> = {}) {
    this.config = {
      targetHost: config.targetHost || process.env.TARGET_HOST || 'http://localhost:3000',
      wsHost: config.wsHost || process.env.WS_HOST || 'ws://localhost:3001',
      driverCount: config.driverCount ?? 100,
      studentCount: config.studentCount ?? 3000,
      adminCount: config.adminCount ?? 5,
      moderatorCount: config.moderatorCount ?? 10,
      durationSeconds: config.durationSeconds ?? 30,
      gpsFrequencyHz: config.gpsFrequencyHz ?? 1,
      concurrencyPoolSize: config.concurrencyPoolSize ?? 100,
    };
  }

  private async makeHttpRequest(method: string, urlPath: string, payload?: object): Promise<number> {
    const startTime = Date.now();
    const fullUrl = new URL(urlPath, this.config.targetHost);
    const client = fullUrl.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
      this.stats.requestsSent++;
      const bodyData = payload ? JSON.stringify(payload) : '';

      const req = client.request(
        fullUrl,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ITMS-Load-Generator/2.0',
            ...(payload ? { 'Content-Length': Buffer.byteLength(bodyData).toString() } : {}),
          },
          timeout: 5000,
        },
        (res) => {
          res.on('data', () => { });
          res.on('end', () => {
            const latency = Date.now() - startTime;
            if (res.statusCode && res.statusCode < 400) {
              this.stats.successfulRequests++;
            } else {
              this.stats.failedRequests++;
            }
            this.recordLatency(latency);
            resolve(latency);
          });
        }
      );

      req.on('error', () => {
        const latency = Date.now() - startTime;
        this.stats.failedRequests++;
        this.recordLatency(latency);
        resolve(latency);
      });

      req.on('timeout', () => {
        req.destroy();
        const latency = Date.now() - startTime;
        this.stats.failedRequests++;
        this.recordLatency(latency);
        resolve(latency);
      });

      if (payload) {
        req.write(bodyData);
      }
      req.end();
    });
  }

  private recordLatency(latency: number): void {
    this.stats.totalLatencyMs += latency;
    if (latency < this.stats.minLatencyMs) this.stats.minLatencyMs = latency;
    if (latency > this.stats.maxLatencyMs) this.stats.maxLatencyMs = latency;
  }

  public generateGpsCoordinate(driverId: string, index: number) {
    const baseLat = 26.1445;
    const baseLng = 91.7362;
    const delta = (index % 100) * 0.0001;

    return {
      busId: `BUS-${101 + (parseInt(driverId.replace('driver_', ''), 10) % 20)}`,
      routeId: `ROUTE-${1 + (parseInt(driverId.replace('driver_', ''), 10) % 5)}`,
      driverId,
      lat: Number((baseLat + delta).toFixed(6)),
      lng: Number((baseLng + delta).toFixed(6)),
      speed: 35.5,
      heading: 180,
      accuracy: 4.2,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Role 1: Driver Workload (High Frequency Telemetry Stream) ──────────────
  private async simulateDriverWorkers(endTime: number): Promise<void> {
    const driverPromises = Array.from({ length: this.config.driverCount }, async (_, driverIdx) => {
      const driverId = `driver_${driverIdx + 1}`;
      let tick = 0;

      while (Date.now() < endTime && this.isRunning) {
        const gpsPoint = this.generateGpsCoordinate(driverId, tick++);
        this.stats.driverGpsUpdatesSent++;
        await this.makeHttpRequest('POST', '/api/location/update', gpsPoint);
        await new Promise((res) => setTimeout(res, 1000 / this.config.gpsFrequencyHz));
      }
    });

    await Promise.all(driverPromises);
  }

  // ── Role 2: Student Workload (Route Queries, Schedules & Tracking) ────────
  private async simulateStudentWorkers(endTime: number): Promise<void> {
    const studentEndpoints = [
      '/api/routes',
      '/api/buses',
      '/api/get-bus-data',
      '/api/health?liveness=1',
      '/api/student/schedule',
      '/api/notifications',
    ];

    const studentTasks = Array.from({ length: this.config.studentCount }, async (_, studentIdx) => {
      while (Date.now() < endTime && this.isRunning) {
        const endpoint = studentEndpoints[studentIdx % studentEndpoints.length];
        this.stats.studentQueriesSent++;
        await this.makeHttpRequest('GET', endpoint);
        // Stagger student queries between 1s and 3s
        await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000));
      }
    });

    // Execute in batch pools to maintain high concurrency without overloading Node runtime limits
    const chunkSize = this.config.concurrencyPoolSize;
    for (let i = 0; i < studentTasks.length; i += chunkSize) {
      const chunk = studentTasks.slice(i, i + chunkSize);
      Promise.all(chunk).catch(() => { });
    }
  }

  // ── Role 3: Admin Workload (Analytics & Fleet Management) ──────────────────
  private async simulateAdminWorkers(endTime: number): Promise<void> {
    const adminEndpoints = [
      '/api/admin',
      '/api/analytics',
      '/api/reassignment-logs',
      '/api/sre',
      '/api/health',
    ];

    const adminPromises = Array.from({ length: this.config.adminCount }, async (_, adminIdx) => {
      while (Date.now() < endTime && this.isRunning) {
        const endpoint = adminEndpoints[adminIdx % adminEndpoints.length];
        this.stats.adminOperationsSent++;
        await this.makeHttpRequest('GET', endpoint);
        await new Promise((res) => setTimeout(res, 2000 + Math.random() * 1500));
      }
    });

    await Promise.all(adminPromises);
  }

  // ── Role 4: Moderator Workload (Route Supervision & Drivers Control) ──────
  private async simulateModeratorWorkers(endTime: number): Promise<void> {
    const moderatorEndpoints = [
      '/api/moderators',
      '/api/drivers',
      '/api/fleet',
      '/api/report-bus-issue',
    ];

    const moderatorPromises = Array.from({ length: this.config.moderatorCount }, async (_, modIdx) => {
      while (Date.now() < endTime && this.isRunning) {
        const endpoint = moderatorEndpoints[modIdx % moderatorEndpoints.length];
        this.stats.moderatorOperationsSent++;
        await this.makeHttpRequest('GET', endpoint);
        await new Promise((res) => setTimeout(res, 1500 + Math.random() * 2000));
      }
    });

    await Promise.all(moderatorPromises);
  }

  // ── Role 5: WebSocket Connection Load Simulator ─────────────────────────────
  private async simulateWebSocketLoad(endTime: number): Promise<void> {
    const wsSockets: WebSocket[] = [];
    const targetWsConnections = Math.min(100, this.config.driverCount + 20);

    for (let i = 0; i < targetWsConnections; i++) {
      try {
        const ws = new WebSocket(this.config.wsHost, { timeout: 3000 });
        ws.on('open', () => {
          this.stats.wsConnectionsActive++;
        });
        ws.on('error', () => { });
        ws.on('close', () => {
          if (this.stats.wsConnectionsActive > 0) this.stats.wsConnectionsActive--;
        });
        wsSockets.push(ws);
      } catch {
        // Socket connection fallback
      }
    }

    while (Date.now() < endTime && this.isRunning) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    wsSockets.forEach((ws) => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      } catch { }
    });
  }

  public async executeFullUniversityLoad(): Promise<SimulationStats> {
    console.log('\n================================================================');
    console.log('🚀 STARTING HIGH-SCALE ITMS SYSTEM LOAD GENERATION');
    console.log('================================================================');
    console.log(`📍 Target HTTP Host     : ${this.config.targetHost}`);
    console.log(`📡 Target WS Host       : ${this.config.wsHost}`);
    console.log(`🚌 Simulated Drivers    : ${this.config.driverCount}`);
    console.log(`🎓 Simulated Students   : ${this.config.studentCount}`);
    console.log(`🛡️ Simulated Admins     : ${this.config.adminCount}`);
    console.log(`👔 Simulated Moderators : ${this.config.moderatorCount}`);
    console.log(`⏱️ Duration             : ${this.config.durationSeconds} seconds`);
    console.log('================================================================\n');

    this.isRunning = true;
    const startTime = Date.now();
    const endTime = startTime + this.config.durationSeconds * 1000;

    // Live progress logger ticker
    const progressTimer = setInterval(() => {
      const elapsedSec = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
      const rps = (this.stats.requestsSent / elapsedSec).toFixed(1);
      const avgLat = this.stats.requestsSent > 0 ? (this.stats.totalLatencyMs / this.stats.requestsSent).toFixed(1) : '0';

      console.log(
        `[${elapsedSec}s/${this.config.durationSeconds}s] Sent: ${this.stats.requestsSent} | Success: ${this.stats.successfulRequests} | Fail: ${this.stats.failedRequests} | RPS: ${rps} | Avg Latency: ${avgLat}ms`
      );
    }, 3000);

    await Promise.all([
      this.simulateDriverWorkers(endTime),
      this.simulateStudentWorkers(endTime),
      this.simulateAdminWorkers(endTime),
      this.simulateModeratorWorkers(endTime),
      this.simulateWebSocketLoad(endTime),
    ]);

    clearInterval(progressTimer);
    this.isRunning = false;
    const totalDurationSec = Math.max(1, (Date.now() - startTime) / 1000);

    console.log('\n================================================================');
    console.log('🎉 LOAD SIMULATION COMPLETE — FINAL SYSTEM REPORT');
    console.log('================================================================');
    console.log(`Total Simulation Time   : ${totalDurationSec.toFixed(2)} seconds`);
    console.log(`Total Requests Sent     : ${this.stats.requestsSent}`);
    console.log(`Successful Requests (2xx): ${this.stats.successfulRequests}`);
    console.log(`Failed Requests (4xx/5xx): ${this.stats.failedRequests}`);
    console.log(`Overall Throughput (RPS): ${(this.stats.requestsSent / totalDurationSec).toFixed(2)} req/sec`);
    console.log(`Average Latency         : ${(this.stats.totalLatencyMs / (this.stats.requestsSent || 1)).toFixed(2)} ms`);
    console.log(`Min / Max Latency       : ${this.stats.minLatencyMs === Infinity ? 0 : this.stats.minLatencyMs} ms / ${this.stats.maxLatencyMs} ms`);
    console.log('----------------------------------------------------------------');
    console.log(`Driver GPS Telemetry updates: ${this.stats.driverGpsUpdatesSent}`);
    console.log(`Student Route queries       : ${this.stats.studentQueriesSent}`);
    console.log(`Admin Fleet operations      : ${this.stats.adminOperationsSent}`);
    console.log(`Moderator Operations        : ${this.stats.moderatorOperationsSent}`);
    console.log('================================================================\n');

    return this.stats;
  }
}

// ── CLI Execution Entrypoint ──────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback: number): number => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    if (found) return parseInt(found.split('=')[1], 10);
    return fallback;
  };
  const getArgStr = (flag: string, fallback: string): string => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    if (found) return found.split('=')[1];
    return fallback;
  };

  // Parse user args or use the exact user-specified role targets as default!
  const driverCount = getArg('drivers', 100);
  const studentCount = getArg('students', 3000);
  const adminCount = getArg('admins', 5);
  const moderatorCount = getArg('moderators', 10);
  const durationSeconds = getArg('duration', 30);
  const targetHost = getArgStr('target', process.env.TARGET_HOST || 'http://localhost:3000');
  const wsHost = getArgStr('ws', process.env.WS_HOST || 'ws://localhost:3001');

  const generator = new LoadGenerator({
    driverCount,
    studentCount,
    adminCount,
    moderatorCount,
    durationSeconds,
    targetHost,
    wsHost,
  });

  generator.executeFullUniversityLoad().catch(console.error);
}
