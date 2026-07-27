import { NextResponse } from 'next/server';
import { maintenanceManager } from '@/lib/observability/sre/maintenance-mode';

export async function GET() {
  return NextResponse.json(maintenanceManager.getStatus(), { status: 200 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.action === 'enable') {
      const status = maintenanceManager.enableMaintenance({
        reason: body.reason || 'Scheduled Maintenance',
        activatedBy: body.activatedBy || 'System Admin',
        durationMinutes: body.durationMinutes,
        readOnly: body.readOnly
      });
      return NextResponse.json(status, { status: 200 });
    } else if (body.action === 'disable') {
      const status = maintenanceManager.disableMaintenance();
      return NextResponse.json(status, { status: 200 });
    } else {
      return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
