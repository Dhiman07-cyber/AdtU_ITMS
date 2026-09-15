import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { diagnosticsEngine } from '@/lib/observability/tracing/root-cause';
import { distributedTracer } from '@/lib/observability/tracing/tracer';

export async function GET(req: Request, { params }: { params: Promise<{ traceId: string }> }) {
  const auth = await verifyApiAuth(req, ['admin', 'moderator']);
  if (!auth.authenticated) return auth.response;

  const { traceId } = await params;

  const latency = diagnosticsEngine.analyzeLatency(traceId);
  const diagnosis = diagnosticsEngine.diagnoseRootCause(traceId);
  const otlp = distributedTracer.exportOTLPJSON(traceId);

  if (!latency && !diagnosis) {
    return NextResponse.json({ error: 'Trace ID not found' }, { status: 404 });
  }

  return NextResponse.json({
    traceId,
    latencyBreakdown: latency,
    rootCauseDiagnosis: diagnosis,
    otlpPayload: otlp
  }, { status: 200 });
}
