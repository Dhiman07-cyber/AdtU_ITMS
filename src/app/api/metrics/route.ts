/**
 * Prometheus Metrics API Route (`/api/metrics`)
 * Exports all registered runtime and infrastructure metrics in standard Prometheus text format.
 *
 * SECURITY: Restricted to admin users OR requests from internal network IPs.
 * This endpoint leaks internal system telemetry (heap, Redis, GPS rates) and must
 * not be publicly accessible.
 */

import { verifyApiAuth } from '@/lib/security/api-auth';
import { getClientIp } from '@/lib/security/api-security';
import { NextRequest, NextResponse } from 'next/server';
import { metricsRegistry } from '@/lib/observability/metrics';
import { nodeRuntimeCollector } from '@/lib/observability/infrastructure/node';
import * as net from 'net';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function isInternalIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const cleanIp = ip.replace(/^::ffff:/, '').trim();
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('127.')) return true;
  if (cleanIp.startsWith('10.')) return true;
  if (cleanIp.startsWith('192.168.')) return true;
  const parts = cleanIp.split('.');
  if (parts.length === 4 && parts[0] === '172') {
    const secondOctet = parseInt(parts[1], 10);
    if (!isNaN(secondOctet) && secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }
  return false;
}

async function probeRedis(): Promise<{ usedMemory: number; totalCommands: number } | null> {
  const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
  let host = 'redis';
  let port = 6379;
  let password = '';
  try {
    const u = new URL(redisUrl);
    host = u.hostname || 'redis';
    port = parseInt(u.port || '6379', 10);
    if (u.password) password = u.password;
  } catch {}

  return new Promise((resolve) => {
    let socket: net.Socket;
    const timer = setTimeout(() => {
      try { socket?.destroy(); } catch {}
      resolve(null);
    }, 1200);

    try {
      socket = net.createConnection({ host, port }, () => {
        let cmd = '';
        if (password) cmd += `AUTH ${password}\r\n`;
        cmd += 'INFO memory\r\nINFO stats\r\nQUIT\r\n';
        socket.write(cmd);
      });

      let buf = '';
      socket.on('data', (d) => { buf += d.toString(); });
      socket.on('end', () => {
        clearTimeout(timer);
        const memMatch = buf.match(/used_memory:(\d+)/);
        const cmdMatch = buf.match(/total_commands_processed:(\d+)/);
        resolve({
          usedMemory: memMatch ? parseInt(memMatch[1], 10) : 0,
          totalCommands: cmdMatch ? parseInt(cmdMatch[1], 10) : 0,
        });
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export async function GET(request: NextRequest) {
  // Allow: (1) Bearer token matching METRICS_SECRET / AM_WEBHOOK_SECRET,
  //        (2) Verified internal network RFC1918 IP,
  //        (3) Authenticated admin user.
  let isAuthorized = false;

  const authHeader = request.headers.get('authorization') || '';
  const metricsSecret = process.env.METRICS_SECRET || process.env.AM_WEBHOOK_SECRET;
  if (metricsSecret && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (
      token.length === metricsSecret.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(metricsSecret))
    ) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    const clientIp = getClientIp(request);
    if (isInternalIp(clientIp)) {
      isAuthorized = true;
    } else {
      const auth = await verifyApiAuth(request, ['admin']);
      if (!auth.authenticated) {
        return new NextResponse('# Unauthorized: admin authentication or valid metrics secret required', {
          status: 401,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    }
  }

  try {
    // Trigger on-demand collection of Node.js process metrics
    nodeRuntimeCollector.collect();

    const prometheusText = metricsRegistry.toPrometheusFormat();

    // Export standard Node.js process aliases without itms_ prefix for standard Grafana templates
    const cpu = process.cpuUsage();
    const mem = process.memoryUsage();
    const cpuSeconds = ((cpu.user + cpu.system) / 1e6).toFixed(4);

    const standardAliases = [
      '# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds',
      '# TYPE process_cpu_seconds_total counter',
      `process_cpu_seconds_total ${cpuSeconds}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# HELP nodejs_heap_size_used_bytes Node.js heap memory used in bytes',
      '# TYPE nodejs_heap_size_used_bytes gauge',
      `nodejs_heap_size_used_bytes ${mem.heapUsed}`,
      '# HELP nodejs_heap_size_total_bytes Node.js heap memory total in bytes',
      '# TYPE nodejs_heap_size_total_bytes gauge',
      `nodejs_heap_size_total_bytes ${mem.heapTotal}`,
      '# HELP itms_buses_total Total buses fleet size',
      '# TYPE itms_buses_total gauge',
      'itms_buses_total 50',
    ];

    // Probe Redis telemetry
    const redisInfo = await probeRedis().catch(() => null);
    if (redisInfo) {
      standardAliases.push(
        '# HELP redis_memory_used_bytes Redis memory used in bytes',
        '# TYPE redis_memory_used_bytes gauge',
        `redis_memory_used_bytes ${redisInfo.usedMemory}`,
        '# HELP redis_commands_total Total Redis commands processed',
        '# TYPE redis_commands_total counter',
        `redis_commands_total ${redisInfo.totalCommands}`,
        '# HELP itms_redis_memory_used_bytes Redis memory used in bytes',
        '# TYPE itms_redis_memory_used_bytes gauge',
        `itms_redis_memory_used_bytes ${redisInfo.usedMemory}`,
        '# HELP itms_redis_commands_total Total Redis commands processed',
        '# TYPE itms_redis_commands_total counter',
        `itms_redis_commands_total ${redisInfo.totalCommands}`
      );
    }

    const fullText = `${prometheusText.trim()}\n${standardAliases.join('\n')}\n`;

    return new NextResponse(fullText, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: any) {
    return new NextResponse(`# Error generating metrics: ${err.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
