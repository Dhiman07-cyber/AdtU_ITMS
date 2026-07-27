import { NextResponse } from 'next/server';
import { traceStore } from '@/lib/observability/tracing/tracer';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const traceId = searchParams.get('traceId') || undefined;
  const hasErrorParam = searchParams.get('hasError');
  const hasError = hasErrorParam !== null ? hasErrorParam === 'true' : undefined;

  const results = traceStore.searchTraces({
    traceId,
    hasError,
    limit: 50
  });

  return NextResponse.json({ traces: results, count: results.length }, { status: 200 });
}
