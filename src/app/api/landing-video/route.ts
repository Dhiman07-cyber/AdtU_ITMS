import { getLandingConfig } from '@/domains/admin';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Supabase storage configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const BUCKET_NAME = 'adtu_bus_assets';
const DEFAULT_VIDEO_PATH = 'landing_video/Welcome_Final.mp4';

/**
 * GET /api/landing-video
 * Returns the public URL for the landing page video from Supabase Storage
 */
export async function GET() {
    try {
        let videoPath = DEFAULT_VIDEO_PATH;
        try {
            const landingConfigResult = await getLandingConfig();
            if (landingConfigResult.data && landingConfigResult.data.videoPath) {
                videoPath = landingConfigResult.data.videoPath;
            }
        } catch (e) {
            console.warn('Could not fetch landing config, using default video path:', e);
        }

        // Construct public video URL (or fallback)
        const baseUrl = SUPABASE_URL || 'https://supabase.co';
        const videoUrl = `${baseUrl}/storage/v1/object/public/${BUCKET_NAME}/${videoPath}`;

        return NextResponse.json({
            success: true,
            url: videoUrl
        }, {
            headers: {
                'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
            }
        });
    } catch (error) {
        console.error('Error getting landing video URL:', error);
        return NextResponse.json({
            success: true,
            url: ''
        });
    }
}
