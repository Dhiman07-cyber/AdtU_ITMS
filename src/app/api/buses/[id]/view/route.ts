import { NextResponse } from 'next/server';
import { getBusById } from '@/domains/fleet/services/fleet.service';

// D6 Fleet — Bus view (public/student-accessible). Runtime owner: PostgreSQL.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Bus ID is required' }, { status: 400 });

    const bus = await getBusById(id);
    if (!bus) return NextResponse.json({ error: 'Bus not found' }, { status: 404 });

    return NextResponse.json(bus);
  } catch (error: any) {
    console.error('Error fetching bus data:', error);
    return NextResponse.json({ error: 'Failed to fetch bus data' }, { status: 500 });
  }
}