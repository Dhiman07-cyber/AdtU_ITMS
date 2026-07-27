import { NextResponse } from 'next/server';
import { diagnosticsEngine } from '@/lib/observability/tracing/root-cause';

export async function GET() {
  const serviceMap = diagnosticsEngine.generateServiceMap();
  return NextResponse.json(serviceMap, { status: 200 });
}
