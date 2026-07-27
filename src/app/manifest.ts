import { getSystemConfig } from '@/domains/admin';
import { MetadataRoute } from 'next';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
    let appName = 'AdtU Bus Services';
    let shortName = 'AdtU Bus';

    try {
        const systemConfigResult = await getSystemConfig();
        if (systemConfigResult.data?.appName) {
            appName = systemConfigResult.data.appName;
            shortName = systemConfigResult.data.appName;
        }
    } catch (e) {
        console.error('Error reading system config for manifest:', e);
    }

    // Determine environment (production deployment on Vercel vs development/testing/preview)
    const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'production';

    const displayName = isProduction ? `${appName} - Live Tracking` : `${appName} [DEV]`;
    const displayShortName = isProduction ? shortName : `${shortName} (DEV)`;

    const icon512Png = isProduction ? '/icons/icon-512x512.png' : '/icons/icon-dev-512x512.png';
    const icon192Png = isProduction ? '/icons/icon-192x192.png' : '/icons/icon-dev-192x192.png';
    const iconSvg = isProduction ? '/icons/icon-192x192.svg' : '/icons/icon-dev-192x192.svg';

    return {
        name: displayName,
        short_name: displayShortName,
        description: `Real-time bus tracking for ${shortName} students and drivers`,
        start_url: '/',
        display: 'standalone',
        background_color: '#05060e',
        theme_color: isProduction ? '#3B82F6' : '#F59E0B',
        orientation: 'portrait-primary',
        icons: [
            {
                src: iconSvg,
                sizes: '192x192 512x512',
                type: 'image/svg+xml',
                purpose: 'any' as any
            },
            {
                src: icon512Png,
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any' as any
            },
            {
                src: icon192Png,
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any' as any
            }
        ],
        categories: ['education', 'transportation', 'utilities'],
        shortcuts: [
            {
                name: 'Track Bus',
                short_name: 'Track',
                description: 'Track your bus in real-time',
                url: '/student/track-bus',
                icons: [{ src: icon192Png, sizes: '192x192' }]
            },
            {
                name: 'Live Tracking',
                short_name: 'Live',
                description: 'Driver live tracking',
                url: '/driver/live-tracking',
                icons: [{ src: icon192Png, sizes: '192x192' }]
            }
        ],
        prefer_related_applications: false,
    }
}
