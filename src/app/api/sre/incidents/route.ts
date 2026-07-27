import { NextResponse } from 'next/server';
import { incidentManager, ESCALATION_MATRIX } from '@/lib/observability/sre/incident-framework';

export async function GET() {
  return NextResponse.json({
    activeIncidents: incidentManager.getActiveIncidents(),
    history: incidentManager.getIncidentHistory(),
    escalationMatrix: ESCALATION_MATRIX
  }, { status: 200 });
}
