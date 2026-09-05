import { getUiConfig,updateUiConfig } from '@/domains/admin';
import { getUserById } from '@/domains/identity';
import { adminAuth } from '@/lib/firebase-admin';
import { NextRequest,NextResponse } from 'next/server';

/**
 * GET /api/settings/ui-config
 * Returns the UI configuration from PostgreSQL
 */
export async function GET(req: NextRequest) {
    try {
        const result = await getUiConfig();

        if (!result) {
            return NextResponse.json(
                { message: 'UI configuration file not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            config: result.data,
            updatedAt: result.updatedAt,
            source: 'postgresql'
        }, {
            headers: {
                'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
            }
        });
    } catch (error: any) {
        console.error('Error reading UI config:', error);
        return NextResponse.json(
            { message: 'Failed to load UI configuration', error: 'An unexpected error occurred' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/settings/ui-config
 * Updates the UI configuration in PostgreSQL
 */
export async function POST(req: NextRequest) {
    try {
        const authHeader = req.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(token);

        const user = await getUserById(decodedToken.uid);
        if (!user || user.role !== 'admin') {
            return NextResponse.json({ message: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { config } = await req.json();

        if (!config) {
            return NextResponse.json({ message: 'Config data required' }, { status: 400 });
        }

        const uiConfigResult = await getUiConfig();
        const currentConfig = uiConfigResult?.data;

        const updatedConfig = {
            ...currentConfig,
            ...config,
            version: config.version || currentConfig?.version || "1.0.0",
        };

        await updateUiConfig(updatedConfig, decodedToken.uid);

        return NextResponse.json({
            message: 'UI configuration updated successfully',
            config: updatedConfig
        });
    } catch (error: any) {
        console.error('Error saving UI config:', error);
        return NextResponse.json(
            { message: 'Failed to save UI configuration', error: 'An unexpected error occurred' },
            { status: 500 }
        );
    }
}
