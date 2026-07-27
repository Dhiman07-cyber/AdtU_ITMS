import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getLandingConfig, updateLandingConfig } from '@/domains/admin';
import { getUserById } from '@/domains/identity';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const landingConfigResult = await getLandingConfig();

        return NextResponse.json({
            success: true,
            config: landingConfigResult.data,
            updatedAt: landingConfigResult.updatedAt
        });
    } catch (error: any) {
        console.error('Error fetching landing config:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch config' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(token);

        const user = await getUserById(decodedToken.uid);
        if (!user || user.role !== 'admin') {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { config } = body;

        if (!config) {
            return NextResponse.json({ success: false, error: 'Invalid data' }, { status: 400 });
        }

        await updateLandingConfig(config, decodedToken.uid);

        return NextResponse.json({ success: true, message: 'Config updated' });
    } catch (error: any) {
        console.error('Error updating landing config:', error);
        return NextResponse.json({ success: false, error: 'Failed to update config' }, { status: 500 });
    }
}
