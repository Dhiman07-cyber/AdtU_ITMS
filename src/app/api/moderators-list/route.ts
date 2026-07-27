import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenOnly } from '@/lib/security/api-auth';
import { getModeratorsByStatus } from '@/domains/identity';

export async function GET(request: NextRequest) {
  try {
    const user = await verifyTokenOnly(request);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const moderatorRows = await getModeratorsByStatus('active');

    const moderators: any[] = [];
    for (const data of moderatorRows) {
      const permissions = (data as any).permissions;
      const canAppearInList = !permissions || permissions.canAppearInModeratorList !== false;

      if (canAppearInList) {
        moderators.push({
          id: (data as any).uid,
          name: (data as any).fullName || (data as any).name || '',
        });
      }
    }

    return NextResponse.json(moderators);
  } catch (error) {
    console.error('Error fetching moderators:', error);
    return NextResponse.json({ error: 'Failed to fetch moderators' }, { status: 500 });
  }
}