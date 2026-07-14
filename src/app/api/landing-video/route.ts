import { NextResponse } from 'next/server';
import { getLandingConfig } from '@/domains/admin';

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
        if (!SUPABASE_URL) {
            console.error('Supabase URL not configured');
            return NextResponse.json(
                { error: 'Storage not configured' },
                { status: 500 }
            );
        }

        // Fetch dynamic path from PostgreSQL
        let videoPath = DEFAULT_VIDEO_PATH;
        try {
            const landingConfig = await getLandingConfig();
            if (landingConfig && landingConfig.videoPath) {
                videoPath = landingConfig.videoPath;
            }
        } catch (e) {
            console.warn('Could not fetch landing config, using default video path:', e);
        }

        // Construct the public URL for the video
        const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${videoPath}`;

        // Add cache control headers to prevent caching issues during auth transitions
        return NextResponse.json({
            success: true,
            url: videoUrl
        }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Error getting landing video URL:', error);
        return NextResponse.json(
            { error: 'Failed to get video URL' },
            { status: 500 }
        );
    }
}
