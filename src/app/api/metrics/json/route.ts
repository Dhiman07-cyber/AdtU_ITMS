/**
 * JSON Metrics API Route (`/api/metrics/json`)
 * Exports all registered runtime and infrastructure metrics as a JSON snapshot.
 */

import { NextResponse } from 'next/server';
import { metricsRegistry } from '@/lib/observability/metrics';
import { nodeRuntimeCollector } from '@/lib/observability/infrastructure/node';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    nodeRuntimeCollector.collect();
    const snapshot = metricsRegistry.getMetricsJSON();

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      metricsCount: snapshot.length,
      metrics: snapshot,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
