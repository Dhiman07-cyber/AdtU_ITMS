import { NextResponse } from 'next/server';
import { errorBudgetTracker } from '@/lib/observability/sre/error-budget';

export async function GET() {
  const report = errorBudgetTracker.evaluateAllErrorBudgets();
  return NextResponse.json(report, { status: 200 });
}
