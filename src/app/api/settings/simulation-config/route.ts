import { verifyApiAuth } from '@/lib/security/api-auth';
import { SimulationConfig } from '@/lib/types/simulation-config';
import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

// Path to the config file
const CONFIG_PATH = path.join(process.cwd(), 'src/app/admin/deadline-testing/simulation-config.json');

export async function GET(request: Request) {
    try {
        const auth = await verifyApiAuth(request, ['admin']);
        if (!auth.authenticated) return auth.response;

        const fileContent = await fs.readFile(CONFIG_PATH, 'utf-8');
        const config = JSON.parse(fileContent) as SimulationConfig;
        return NextResponse.json({ config });
    } catch (error) {
        console.error('Error reading simulation config:', error);
        return NextResponse.json(
            { error: 'Failed to load configuration' },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        const auth = await verifyApiAuth(request, ['admin']);
        if (!auth.authenticated) return auth.response;

        const body = await request.json();
        const newConfig = body.config as SimulationConfig;

        if (!newConfig) {
            return NextResponse.json(
                { error: 'Invalid configuration data' },
                { status: 400 }
            );
        }

        // Add metadata
        const configToSave: SimulationConfig = {
            ...newConfig,
            lastUpdated: new Date().toISOString(),
        };

        await fs.writeFile(CONFIG_PATH, JSON.stringify(configToSave, null, 2));

        return NextResponse.json({
            success: true,
            config: configToSave
        });
    } catch (error) {
        console.error('Error saving simulation config:', error);
        return NextResponse.json(
            { error: 'Failed to save configuration' },
            { status: 500 }
        );
    }
}
