import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUiConfig, updateUiConfig } from '@/domains/admin';

/**
 * GET /api/settings/ui-config
 * Returns the UI configuration from PostgreSQL
 */
export async function GET(req: NextRequest) {
    try {
        const config = await getUiConfig();

        if (!config) {
            return NextResponse.json(
                { message: 'UI configuration file not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            config,
            source: 'postgresql'
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

        const userDoc = await adminAuth.getUser(decodedToken.uid);
        const customClaims = userDoc.customClaims;
        if (customClaims?.role !== 'admin') {
            return NextResponse.json({ message: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { config } = await req.json();

        if (!config) {
            return NextResponse.json({ message: 'Config data required' }, { status: 400 });
        }

        const currentConfig = await getUiConfig();

        const updatedConfig = {
            ...currentConfig,
            ...config,
            version: config.version || currentConfig?.version || "1.0.0",
            lastUpdated: new Date().toISOString().split('T')[0],
            lastUpdatedBy: decodedToken.uid
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
