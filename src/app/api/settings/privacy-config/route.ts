import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { getSystemConfig, getLegalConfig, updateLegalConfig } from '@/domains/admin';
import { sanitizeLegalConfig } from '@/lib/security/object-safety';
const FALLBACK_TITLE = 'Privacy Policy';

export async function GET(req: NextRequest) {
    try {
        let config = await getLegalConfig('privacy');
        let source = 'postgresql';

        // Inject App Name dynamically
        try {
            const systemConfig = await getSystemConfig();
            const appName = systemConfig?.appName || "AdtU Bus Services";
            if (config && typeof config === 'object') {
                let configStr = JSON.stringify(config);
                configStr = configStr.replace(/AdtU Bus Services/g, appName);
                config = JSON.parse(configStr);
            }
        } catch (e) {
            console.error('Error injecting app name into privacy config:', e);
        }

        return NextResponse.json({
            success: true,
            config,
            source
        });

    } catch (error: any) {
        console.error('Error reading privacy config:', error);
        return NextResponse.json({ success: false, error: 'Failed to read configuration' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin']);
        if (!auth.authenticated) return auth.response;

        const body = await req.json();
        const { config } = body;

        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            return NextResponse.json({ success: false, error: 'Invalid configuration data' }, { status: 400 });
        }

        const safeConfig = sanitizeLegalConfig(config, FALLBACK_TITLE);
        safeConfig.lastUpdated = new Date().toISOString().split('T')[0];

        await updateLegalConfig('privacy', safeConfig, auth.uid!);

        return NextResponse.json({ success: true, message: 'Configuration saved successfully', config: safeConfig });

    } catch (error: any) {
        console.error('Error saving privacy config:', error);
        return NextResponse.json({ success: false, error: 'Failed to save configuration' }, { status: 500 });
    }
}
