/**
 * Prometheus Metrics API Route (`/api/metrics`)
 * Exports all registered runtime and infrastructure metrics in standard Prometheus text format.
 */

import { NextResponse } from 'next/server';
import { metricsRegistry } from '@/lib/observability/metrics';
import { nodeRuntimeCollector } from '@/lib/observability/infrastructure/node';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Trigger on-demand collection of Node.js process metrics
    nodeRuntimeCollector.collect();

    const prometheusText = metricsRegistry.toPrometheusFormat();

    return new NextResponse(prometheusText, {
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
